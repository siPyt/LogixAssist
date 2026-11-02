/**
 * Research loop for Logix Advisor. Instead of guessing from a keyword match, the
 * model plans searches (using Logix knowledge, so "heartbeat" also looks for
 * watchdogs, clocks and produced tags), the app runs them over the Explorer
 * files, and the model follows the leads (e.g. reading the exact rung) before
 * answering from what was actually found.
 */
import type { ChatMessage } from './bridge'
import type { TreeNode } from './fs'
import { buildContext, describeMatch, grepIndex, outline, readableFiles, readPage, readRung } from './libraryIndex'
import type { Match } from './libraryIndex'

/** Sends one prompt to the model and resolves to its full reply. */
export type Ask = (prompt: string) => Promise<string>

const MAX_ROUNDS = 4
const MAX_FINDINGS_CHARS = 45000
const BASELINE_CHARS = 12000
const MAX_AUTO_RUNGS = 6

/** Cross-reference line: Tag - Program/Routine - *35(OTL), 34(XIC). A leading * marks a write. */
const XREF = /(\S+) - \w+\/(\w+) - ((?:\*?\d+\([A-Z]+\)(?:, ?)?)+)/g

const PLAYBOOK = `How to read Rockwell/Studio 5000 project reports and exports:
- "Controller Organizer Listing" lists tasks, programs, routines, add-on instructions, data types and I/O modules (incl. Ethernet modules).
- "Tag Listing" is a cross reference. Lines look like: TagName - Program/Routine - rung(INSTRUCTION). A leading * means that rung WRITES the tag (OTE, MOV destination, TON, GSV...).
- "Ladder Diagram" pages list each routine's rungs, numbered, with instruction operands (Source / Dest / Timer ...).
- Tag lines also show properties such as "Maximum Consumers" (a produced tag shared with another controller or DCS/HMI).
- Communication heartbeat / watchdog / alive bits are often NOT named that way. Look for: names containing heart, beat, HB, watchdog, WDT, alive, ping, comm, keepalive, link, handshake, toggle, flash, pulse, blink, clock; a seconds/minute value from a GSV WallClockTime clock moved into a network/produced/buffer tag; a bit toggled by a timer or ONS each second; a counter that keeps incrementing; MSG/COP/MOV rungs in network or HMI/OIT buffer routines; produced/consumed tags; module connection-fault bits.
- To find where a value goes, search the tag (every "*" entry is a write), then read the rung.
- Typical comm-loss / heartbeat patterns, none of which need "heartbeat" in the name:
  1. Change detection: a self-resetting TON (its own /DN in series) opens a window; at DN the logic compares a value from the other device (a clock minute/second, a counter, a toggling bit: Current_* vs Previous_*) with a NEQ/EQU/MOV. No change for N windows (a CTU with a small preset) latches a "Communications" warning/alarm. Names like Comm_Timer, Comm_Counter, Previous_Minute, Warning_..._Communications are the heartbeat monitor.
  2. Toggle/produce: a timer/ONS flips a bit that is written into a produced, network, OIT/HMI or DCS buffer tag; the other side watches it.
  3. Module fault bits (GSV/ConnectionFaulted, ENBT/ENET status) driving a comms alarm.
- A free-running timer that drives a bit (Pulse, Flash, Blink) is usually just a lamp/horn flasher. It is NOT a heartbeat unless that bit is written to a network/produced/buffer tag or compared on a timeout. Read where the bit is used before calling it a heartbeat.`

const ANSWER_GUIDE = `Answer rules for Logix Advisor:
- Use the file evidence below. Name the exact tag, program/routine, rung number and the file page.
- Only state what a tag does or feeds if you saw that rung in the evidence. If the rung was not read, say it was not verified. Do not guess from a tag's name or from its timer pattern alone.
- Check the neighbouring rungs: a comm-loss alarm and its timer/counter/compare logic usually sit in the rungs right before the latch.
- If nothing is literally named what the user asked for, say so, then give the best candidate you found and why. Say clearly that it is inferred.
- Do not answer with a generic Studio 5000 how-to when evidence is provided. Only suggest next steps for what the files cannot show (for example binary .ACD files, or logic on the other side of a network link).`

interface Plan {
  searches?: { pattern?: unknown; file?: unknown }[]
  read?: { file?: unknown; page?: unknown; routine?: unknown; rung?: unknown }[]
  done?: unknown
}

/** Routine/rung pairs where a searched tag is written, so the logic around them can be read. */
function writeRungs(hits: Match[]): { routine: string; rung: number; file: string }[] {
  const out: { routine: string; rung: number; file: string }[] = []
  for (const hit of hits) {
    for (const m of hit.text.matchAll(XREF)) {
      for (const w of m[3].matchAll(/\*(\d+)\(/g)) {
        out.push({ routine: m[2], rung: Number(w[1]), file: hit.path })
      }
    }
  }
  return out
}

function parsePlan(reply: string): Plan | null {
  const match = /\{[\s\S]*\}/.exec(reply)
  if (!match) return null
  try {
    return JSON.parse(match[0]) as Plan
  } catch {
    return null
  }
}

function conversation(history: ChatMessage[]): string {
  return history
    .slice(-5)
    .map((m) => `${m.role === 'user' ? 'User' : 'Advisor'}: ${m.content.slice(0, 600)}`)
    .join('\n')
}

function plannerPrompt(
  history: ChatMessage[],
  tree: TreeNode[],
  openPath: string | null,
  findings: string,
  round: number,
): string {
  return `You are the search planner for Logix Advisor. The user's project files (PDF reports and text exports) are already read and searchable. Plan searches that find the answer to the user's latest question.

${PLAYBOOK}

Conversation:
${conversation(history)}

${openPath ? `File open in the viewer: ${openPath}\n` : ''}Files that can be searched:
${readableFiles().slice(0, 60).join('\n') || '(none read yet)'}

Folders and files:
${outline(tree).slice(0, 3000)}

${findings ? `Results so far (round ${round}):\n${findings}\n` : 'No searches have been run yet.\n'}
Reply with ONLY a JSON object, no prose:
{"searches":[{"pattern":"case-insensitive regex","file":"optional substring of a file path"}],"read":[{"file":"substring of a file path","page":12},{"routine":"_080_Alarms_Warnings","rung":34,"file":"optional"}],"done":false}
- Up to 8 searches. Use several alternative spellings/synonyms in one regex with |.
- "read" with routine+rung returns the ladder page holding that rung (and the next page). "read" with file+page returns a whole page. Use these once a search shows where something is.
- Searches already read the "*" (write) rungs automatically. Also read the rungs just before and after any latch/alarm/candidate (n-3 .. n+1) and where a candidate bit is used (XIC entries) so you know what it actually drives.
- Scope searches with "file" when the question names a program or folder (e.g. "3CSG").
- Set "done": true only after you have read the rungs behind your best candidate.`
}

/**
 * Runs the search rounds and returns the context text to send with the question.
 * Falls back to the plain keyword excerpts if the planner fails.
 */
export async function researchFiles(opts: {
  history: ChatMessage[]
  tree: TreeNode[]
  openPath: string | null
  indexing: Parameters<typeof buildContext>[3]
  ask: Ask
  onStatus: (text: string) => void
  signal: AbortSignal
}): Promise<string> {
  const { history, tree, openPath, indexing, ask, onStatus, signal } = opts
  const question = history[history.length - 1]?.content ?? ''
  const baseline = buildContext(question, tree, openPath, indexing, BASELINE_CHARS)

  let findings = ''
  const seen = new Set<string>()
  try {
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      if (signal.aborted) break
      onStatus(round === 1 ? 'Planning file search…' : 'Following leads in the files…')
      const plan = parsePlan(await ask(plannerPrompt(history, tree, openPath, findings, round - 1)))
      if (!plan) break

      let added = ''
      let readSomething = false
      const hitsThisRound: Match[] = []
      const readKeys = new Set<string>()
      const addRung = (routine: string, rung: number, file?: string) => {
        const m = readRung(routine, rung, file)
        if (!m) return false
        const key = `p:${m.path}|${m.at}`
        if (seen.has(key)) return true
        seen.add(key)
        readKeys.add(key)
        added += `### Ladder: ${routine} rung ${rung}\n${describeMatch(m)}\n\n`
        return true
      }
      for (const s of (plan.searches ?? []).slice(0, 8)) {
        if (typeof s.pattern !== 'string' || !s.pattern.trim()) continue
        const file = typeof s.file === 'string' && s.file.trim() ? s.file.trim() : undefined
        const key = `s:${s.pattern}|${file ?? ''}`
        if (seen.has(key)) continue
        seen.add(key)
        onStatus(`Searching files for ${s.pattern.slice(0, 40)}…`)
        const hits = grepIndex(s.pattern, file)
        hitsThisRound.push(...hits)
        added +=
          hits.length > 0
            ? `### Search /${s.pattern}/${file ? ` in ${file}` : ''}\n${hits.map(describeMatch).join('\n\n')}\n\n`
            : `### Search /${s.pattern}/${file ? ` in ${file}` : ''}: no matches\n\n`
      }
      for (const r of (plan.read ?? []).slice(0, 6)) {
        const file = typeof r.file === 'string' && r.file.trim() ? r.file.trim() : undefined
        if (typeof r.routine === 'string' && Number.isFinite(Number(r.rung))) {
          onStatus(`Reading ${r.routine} rung ${Number(r.rung)}…`)
          if (addRung(r.routine, Number(r.rung), file)) readSomething = true
          else added += `### Read ${r.routine} rung ${Number(r.rung)}: not found\n\n`
          continue
        }
        const page = Number(r.page)
        if (!file || !Number.isFinite(page)) continue
        const key = `r:${file}|${page}`
        if (seen.has(key)) continue
        seen.add(key)
        const m = readPage(file, page)
        if (m) readSomething = true
        added += m ? `### Read\n${describeMatch(m)}\n\n` : `### Read ${file} ${page}: not found\n\n`
      }

      // A cross-reference only says where a tag is written. Read those rungs so the logic around them is seen.
      let auto = 0
      for (const w of writeRungs(hitsThisRound)) {
        if (auto >= MAX_AUTO_RUNGS) break
        const before = readKeys.size
        onStatus(`Reading ${w.routine} rung ${w.rung}…`)
        addRung(w.routine, w.rung, w.file)
        if (readKeys.size > before) {
          auto++
          readSomething = true
        }
      }

      if (!added) break
      findings = (findings + added).slice(-MAX_FINDINGS_CHARS)
      // Don't accept "done" on search hits alone; the rungs must have been read at least once.
      if (plan.done === true && (readSomething || round > 1)) break
    }
  } catch {
    // Search planning is best-effort; the baseline excerpts still go out.
  }

  const evidence = findings ? `\n\nSearch results gathered for this question:\n\n${findings}` : ''
  return `${ANSWER_GUIDE}\n\n${baseline.text}${evidence}`
}
