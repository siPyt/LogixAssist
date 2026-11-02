/**
 * Research loop for Logix Advisor. Instead of guessing from a keyword match, the
 * model plans searches (using Logix knowledge, so "heartbeat" also looks for
 * watchdogs, clocks and produced tags), the app runs them over the Explorer
 * files, and the model follows the leads (e.g. reading the exact rung) before
 * answering from what was actually found.
 */
import type { ChatMessage } from './bridge'
import type { TreeNode } from './fs'
import { buildContext, describeMatch, grepIndex, outline, readableFiles, readPage } from './libraryIndex'

/** Sends one prompt to the model and resolves to its full reply. */
export type Ask = (prompt: string) => Promise<string>

const MAX_ROUNDS = 3
const MAX_FINDINGS_CHARS = 45000
const BASELINE_CHARS = 12000

const PLAYBOOK = `How to read Rockwell/Studio 5000 project reports and exports:
- "Controller Organizer Listing" lists tasks, programs, routines, add-on instructions, data types and I/O modules (incl. Ethernet modules).
- "Tag Listing" is a cross reference. Lines look like: TagName - Program/Routine - rung(INSTRUCTION). A leading * means that rung WRITES the tag (OTE, MOV destination, TON, GSV...).
- "Ladder Diagram" pages list each routine's rungs, numbered, with instruction operands (Source / Dest / Timer ...).
- Tag lines also show properties such as "Maximum Consumers" (a produced tag shared with another controller or DCS/HMI).
- Communication heartbeat / watchdog / alive bits are often NOT named that way. Look for: names containing heart, beat, HB, watchdog, WDT, alive, ping, comm, keepalive, link, handshake, toggle, flash, pulse, blink, clock; a seconds/minute value from a GSV WallClockTime clock moved into a network/produced/buffer tag; a bit toggled by a timer or ONS each second; a counter that keeps incrementing; MSG/COP/MOV rungs in network or HMI/OIT buffer routines; produced/consumed tags; module connection-fault bits.
- To find where a value goes, search the tag (every "*" entry is a write), then read the rung.`

const ANSWER_GUIDE = `Answer rules for Logix Advisor:
- Use the file evidence below. Name the exact tag, program/routine, rung number and the file page.
- If nothing is literally named what the user asked for, say so, then give the best candidate you found and why. Say clearly that it is inferred.
- Do not answer with a generic Studio 5000 how-to when evidence is provided. Only suggest next steps for what the files cannot show (for example binary .ACD files, or logic on the other side of a network link).`

interface Plan {
  searches?: { pattern?: unknown; file?: unknown }[]
  read?: { file?: unknown; page?: unknown }[]
  done?: unknown
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
{"searches":[{"pattern":"case-insensitive regex","file":"optional substring of a file path"}],"read":[{"file":"substring of a file path","page":12}],"done":false}
- Up to 8 searches. Use several alternative spellings/synonyms in one regex with |.
- "read" returns a whole page or block, so use it to read a rung or routine once a search shows where it is.
- Scope searches with "file" when the question names a program or folder (e.g. "3CSG").
- Set "done": true when the results already answer the question, or more searching would not help.`
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
      for (const s of (plan.searches ?? []).slice(0, 8)) {
        if (typeof s.pattern !== 'string' || !s.pattern.trim()) continue
        const file = typeof s.file === 'string' && s.file.trim() ? s.file.trim() : undefined
        const key = `s:${s.pattern}|${file ?? ''}`
        if (seen.has(key)) continue
        seen.add(key)
        onStatus(`Searching files for ${s.pattern.slice(0, 40)}…`)
        const hits = grepIndex(s.pattern, file)
        added +=
          hits.length > 0
            ? `### Search /${s.pattern}/${file ? ` in ${file}` : ''}\n${hits.map(describeMatch).join('\n\n')}\n\n`
            : `### Search /${s.pattern}/${file ? ` in ${file}` : ''}: no matches\n\n`
      }
      for (const r of (plan.read ?? []).slice(0, 4)) {
        const page = Number(r.page)
        if (typeof r.file !== 'string' || !Number.isFinite(page)) continue
        const key = `r:${r.file}|${page}`
        if (seen.has(key)) continue
        seen.add(key)
        const m = readPage(r.file, page)
        added += m ? `### Read\n${describeMatch(m)}\n\n` : `### Read ${r.file} ${page}: not found\n\n`
      }

      if (!added) break
      findings = (findings + added).slice(-MAX_FINDINGS_CHARS)
      if (plan.done === true) break
    }
  } catch {
    // Search planning is best-effort; the baseline excerpts still go out.
  }

  const evidence = findings ? `\n\nSearch results gathered for this question:\n\n${findings}` : ''
  return `${ANSWER_GUIDE}\n\n${baseline.text}${evidence}`
}
