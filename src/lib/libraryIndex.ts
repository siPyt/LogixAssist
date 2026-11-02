/**
 * Lets Logix Advisor "read" the files in the Explorer. Text is extracted in the
 * browser (PDF pages via pdf.js, plain text for Logix exports and similar),
 * split into chunks, and searched per question. The best-matching excerpts are
 * sent to the model along with the question.
 */
import type { TreeNode } from './fs'

export interface IndexProgress {
  done: number
  total: number
  current: string
}

interface Chunk {
  /** 1-based page for PDFs, 1-based starting line for text files. */
  at: number
  text: string
  lower: string
}

interface IndexedFile {
  path: string
  signature: string
  kind: 'pdf' | 'text'
  chunks: Chunk[]
}

const PDF_EXT = /\.pdf$/i
const TEXT_EXT =
  /\.(txt|md|json|csv|log|xml|l5x|l5k|l5t|ini|yml|yaml|st|ld|sc|cfg|tsv|html?|rtf)$/i

const MAX_PDF_BYTES = 200 * 1024 * 1024
const MAX_PDF_PAGES = 3000
const MAX_TEXT_BYTES = 8 * 1024 * 1024
const CHUNK_CHARS = 1800
const CONTEXT_CHARS = 60000
const OUTLINE_CHARS = 6000
const MAX_EXCERPT_CHARS = 5000

const STOP_WORDS = new Set(
  'a an and are as at be by can do does for from how i in is it its me my of on or our program programs project show tell that the this to was what when where which who why with you your find look about there their any'.split(
    ' ',
  ),
)

const index = new Map<string, IndexedFile>()
const unreadable = new Set<string>()
let running: Promise<void> | null = null
let rerun: { nodes: TreeNode[]; first: string | null; onProgress?: (p: IndexProgress | null) => void } | null = null
let pdfjs: Promise<typeof import('pdfjs-dist')> | null = null

function loadPdfjs() {
  pdfjs ??= (async () => {
    const lib = await import('pdfjs-dist')
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    lib.GlobalWorkerOptions.workerSrc = worker.default
    return lib
  })()
  return pdfjs
}

function signatureOf(file: File): string {
  return `${file.size}:${file.lastModified}`
}

function makeChunk(at: number, text: string): Chunk {
  return { at, text, lower: text.toLowerCase() }
}

function splitText(text: string): Chunk[] {
  const chunks: Chunk[] = []
  const lines = text.split(/\r?\n/)
  let buffer: string[] = []
  let size = 0
  let start = 1
  lines.forEach((line, i) => {
    if (buffer.length === 0) start = i + 1
    buffer.push(line)
    size += line.length + 1
    if (size >= CHUNK_CHARS) {
      chunks.push(makeChunk(start, buffer.join('\n')))
      buffer = []
      size = 0
    }
  })
  if (buffer.some((l) => l.trim())) chunks.push(makeChunk(start, buffer.join('\n')))
  return chunks
}

function stripBoilerplate(text: string): string {
  // Every report page repeats the project file path, which would match any folder-name search.
  return text.replace(/[A-Za-z]:\\[^\n]*?\.(?:acd|l5x|l5k|pdf)\b/gi, '')
}

async function extractPdf(file: File): Promise<Chunk[]> {
  const lib = await loadPdfjs()
  const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const doc = await task.promise
  const chunks: Chunk[] = []
  try {
    const pages = Math.min(doc.numPages, MAX_PDF_PAGES)
    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      let text = ''
      for (const item of content.items) {
        if ('str' in item) text += item.str + (item.hasEOL ? '\n' : ' ')
      }
      page.cleanup()
      text = stripBoilerplate(text).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim()
      for (let i = 0; i < text.length; i += CHUNK_CHARS) {
        const piece = text.slice(i, i + CHUNK_CHARS)
        if (piece.trim()) chunks.push(makeChunk(n, piece))
      }
    }
  } finally {
    void task.destroy()
  }
  return chunks
}

function collectFiles(nodes: TreeNode[], out: TreeNode[] = []): TreeNode[] {
  for (const node of nodes) {
    if (node.kind === 'directory') collectFiles(node.children ?? [], out)
    else if (PDF_EXT.test(node.name) || TEXT_EXT.test(node.name)) out.push(node)
  }
  return out
}

function folderOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const inflight = new Map<string, Promise<void>>()

/** Shares one read between the background indexer and a question that needs the same file now. */
function indexNode(node: TreeNode): Promise<void> {
  let job = inflight.get(node.path)
  if (!job) {
    job = readNode(node).finally(() => inflight.delete(node.path))
    inflight.set(node.path, job)
  }
  return job
}

async function readNode(node: TreeNode): Promise<void> {
  const file = await (node.handle as FileSystemFileHandle).getFile()
  const signature = signatureOf(file)
  const existing = index.get(node.path)
  if (existing?.signature === signature) return
  const isPdf = PDF_EXT.test(node.name)
  if (isPdf ? file.size > MAX_PDF_BYTES : file.size > MAX_TEXT_BYTES) {
    unreadable.add(node.path)
    return
  }
  const chunks = isPdf ? await extractPdf(file) : splitText(await file.text())
  index.set(node.path, { path: node.path, signature, kind: isPdf ? 'pdf' : 'text', chunks })
  unreadable.delete(node.path)
}

async function runIndex(
  nodes: TreeNode[],
  first: string | null,
  onProgress?: (p: IndexProgress | null) => void,
): Promise<void> {
  const files = collectFiles(nodes)
  const live = new Set(files.map((f) => f.path))
  for (const path of [...index.keys()]) if (!live.has(path)) index.delete(path)

  // The open file's folder goes first so the answer can use it soonest.
  const focus = first ? folderOf(first) : null
  files.sort((a, b) => {
    const score = (n: TreeNode) =>
      n.path === first ? 0 : focus !== null && folderOf(n.path) === focus ? 1 : 2
    return score(a) - score(b)
  })

  let done = 0
  for (const node of files) {
    onProgress?.({ done, total: files.length, current: node.name })
    try {
      await indexNode(node)
    } catch {
      unreadable.add(node.path)
    }
    done++
    await yieldToUi()
  }
  onProgress?.(null)
}

/** Reads any new or changed files in the tree. Calls are coalesced; the latest request wins. */
export function indexLibrary(
  nodes: TreeNode[],
  firstPath: string | null,
  onProgress?: (p: IndexProgress | null) => void,
): Promise<void> {
  if (running) {
    rerun = { nodes, first: firstPath, onProgress }
    return running
  }
  running = (async () => {
    try {
      await runIndex(nodes, firstPath, onProgress)
      while (rerun) {
        const next = rerun
        rerun = null
        await runIndex(next.nodes, next.first, next.onProgress)
      }
    } finally {
      running = null
    }
  })()
  return running
}

const MAX_PRIORITY_FILES = 12

/**
 * Files whose folder or file name the question mentions (e.g. "meco"). They are read
 * immediately, ahead of the background pass, so the answer never lacks the file it was asked about.
 */
function mentionedFiles(nodes: TreeNode[], question: string): TreeNode[] {
  const words = [...new Set((question.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []).filter((w) => !STOP_WORDS.has(w)))]
  if (words.length === 0) return []
  return collectFiles(nodes)
    .filter((n) => {
      const segments = n.path.toLowerCase().replace(/\.[^./]+$/, '').split('/')
      return words.some((w) => segments.some((s) => s === w || (w.length >= 4 && s.includes(w))))
    })
    .slice(0, MAX_PRIORITY_FILES)
}

/** Reads the files the question names, resolving when they are all read (or have failed). */
export async function indexMentioned(nodes: TreeNode[], question: string): Promise<boolean> {
  const wanted = mentionedFiles(nodes, question)
  await Promise.all(
    wanted.map((n) =>
      indexNode(n).catch(() => {
        unreadable.add(n.path)
      }),
    ),
  )
  return wanted.length > 0
}

function termsOf(question: string): string[] {
  const words = (question.toLowerCase().match(/[a-z0-9_:.\-]{2,}/g) ?? []).filter(
    (w) => !STOP_WORDS.has(w),
  )
  const terms = new Set<string>()
  for (const w of words) {
    terms.add(w)
    if (w.length > 3 && w.endsWith('s')) terms.add(w.slice(0, -1))
    for (const part of w.split(/[_:.\-]/)) if (part.length >= 3 && !STOP_WORDS.has(part)) terms.add(part)
  }
  // "heart beat" should also find "HeartBeat".
  for (let i = 0; i + 1 < words.length; i++) terms.add(words[i].replace(/[^a-z0-9]/g, '') + words[i + 1].replace(/[^a-z0-9]/g, ''))
  return [...terms].filter((t) => t.length >= 2)
}

function countOf(haystack: string, needle: string): number {
  let count = 0
  for (let i = haystack.indexOf(needle); i >= 0 && count < 50; i = haystack.indexOf(needle, i + needle.length)) {
    count++
  }
  return count
}

interface Hit {
  file: IndexedFile
  chunk: Chunk
  score: number
}

function search(question: string, openPath: string | null): Hit[] {
  const terms = termsOf(question)
  if (terms.length === 0) return []

  let total = 0
  const docFreq = new Map<string, number>()
  for (const file of index.values()) {
    for (const chunk of file.chunks) {
      total++
      for (const t of terms) if (chunk.lower.includes(t)) docFreq.set(t, (docFreq.get(t) ?? 0) + 1)
    }
  }

  const hits: Hit[] = []
  for (const file of index.values()) {
    const pathLower = file.path.toLowerCase()
    const pathBonus = terms.filter((t) => pathLower.includes(t)).length
    for (const chunk of file.chunks) {
      let score = 0
      for (const t of terms) {
        const tf = countOf(chunk.lower, t)
        if (tf === 0) continue
        const idf = Math.log(1 + total / (docFreq.get(t) ?? 1))
        // Longer terms (identifiers) are stronger evidence than short common words.
        score += idf * (1 + Math.log(tf)) * (t.length >= 6 ? 1.5 : 1)
      }
      if (score === 0) continue
      score += pathBonus * 0.5
      if (file.path === openPath) score *= 1.3
      hits.push({ file, chunk, score })
    }
  }
  return hits.sort((a, b) => b.score - a.score)
}

export function outline(nodes: TreeNode[]): string {
  const lines: string[] = []
  let size = 0
  const walk = (list: TreeNode[], depth: number) => {
    for (const n of list) {
      if (size > OUTLINE_CHARS) return
      const line = `${'  '.repeat(depth)}${n.kind === 'directory' ? n.name + '/' : n.name}`
      lines.push(line)
      size += line.length + 1
      if (n.kind === 'directory' && n.children) walk(n.children, depth + 1)
    }
  }
  walk(nodes, 0)
  if (size > OUTLINE_CHARS) lines.push('  … (list truncated)')
  return lines.join('\n')
}

export interface LibraryContext {
  text: string
  files: number
  excerpts: number
}

/** Builds the context block sent to the model alongside a question. */
export function buildContext(
  question: string,
  nodes: TreeNode[],
  openPath: string | null,
  indexing: IndexProgress | null,
  budget = CONTEXT_CHARS,
): LibraryContext {
  const parts: string[] = []
  parts.push(`Files in the user's Logix Assistant Explorer:\n${outline(nodes)}`)
  if (openPath) parts.push(`The user currently has this file open: ${openPath}`)

  const readable = [...index.values()]
  const missing = collectFiles(nodes).filter((n) => !index.has(n.path))
  const notRead = missing.filter((n) => !unreadable.has(n.path)).map((n) => n.path)
  const failed = missing.filter((n) => unreadable.has(n.path)).map((n) => n.path)
  parts.push(
    `${readable.length} file(s) were read (PDF and text). ` +
      (indexing ? `Still reading: ${indexing.done}/${indexing.total} files, so results may be incomplete. ` : '') +
      (unreadable.size > 0 ? `${unreadable.size} file(s) could not be read (too large or unreadable). ` : '') +
      'Binary controller files (.ACD, .mer, etc.) cannot be read directly; their exported reports (PDF) or L5X/L5K exports can.',
  )
  if (notRead.length > 0) {
    parts.push(
      `These files have NOT been read yet (still queued), so "no matches" says nothing about them:\n${notRead.slice(0, 20).join('\n')}`,
    )
  }
  if (failed.length > 0) parts.push(`These files failed to read:\n${failed.slice(0, 20).join('\n')}`)

  const hits = search(question, openPath)
  const picked: Hit[] = []
  let used = 0
  const perFile = new Map<string, number>()
  for (const hit of hits) {
    if (used >= budget - MAX_EXCERPT_CHARS) break
    if ((perFile.get(hit.file.path) ?? 0) >= 12) continue
    picked.push(hit)
    perFile.set(hit.file.path, (perFile.get(hit.file.path) ?? 0) + 1)
    used += hit.chunk.text.length + 60
  }

  // Nothing matched: fall back to the start of the open file so "this file" questions still work.
  if (picked.length === 0 && openPath) {
    const open = index.get(openPath)
    if (open) {
      for (const chunk of open.chunks.slice(0, 8)) {
        picked.push({ file: open, chunk, score: 0 })
      }
    }
  }

  // Group by file (best-scoring file first), then read order within each file.
  const fileRank = new Map<string, number>()
  picked.forEach((h) => {
    if (!fileRank.has(h.file.path)) fileRank.set(h.file.path, fileRank.size)
  })
  picked.sort(
    (a, b) =>
      fileRank.get(a.file.path)! - fileRank.get(b.file.path)! || a.chunk.at - b.chunk.at,
  )
  if (picked.length > 0) {
    const body = picked
      .map((h) => {
        const where = h.file.kind === 'pdf' ? `page ${h.chunk.at}` : `line ${h.chunk.at}`
        return `--- ${h.file.path} (${where}) ---\n${h.chunk.text}`
      })
      .join('\n\n')
    parts.push(`Excerpts from the files most relevant to the question:\n\n${body}`)
  } else {
    parts.push('No file text matched the question.')
  }

  return { text: parts.join('\n\n'), files: readable.length, excerpts: picked.length }
}

export function indexedFileCount(): number {
  return index.size
}

export interface Match {
  path: string
  /** Page (PDF) or starting line (text). */
  at: number
  kind: 'pdf' | 'text'
  text: string
}

function safeRegex(pattern: string): RegExp {
  const p = pattern.slice(0, 160)
  try {
    return new RegExp(p, 'i')
  } catch {
    return new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  }
}

/** Line-level regex search over every read file, with a few lines of surrounding context. */
export function grepIndex(pattern: string, fileFilter?: string, maxChars = 5000, around = 3): Match[] {
  const re = safeRegex(pattern)
  const filter = fileFilter?.toLowerCase()
  const out: Match[] = []
  let used = 0
  for (const file of index.values()) {
    if (filter && !file.path.toLowerCase().includes(filter)) continue
    for (const chunk of file.chunks) {
      const lines = chunk.text.split('\n')
      const keep = new Set<number>()
      lines.forEach((line, i) => {
        if (re.test(line)) {
          for (let j = Math.max(0, i - around); j <= Math.min(lines.length - 1, i + around); j++) keep.add(j)
        }
      })
      if (keep.size === 0) continue
      const text = [...keep].sort((a, b) => a - b).map((i) => lines[i]).join('\n')
      if (used + text.length > maxChars) return out
      used += text.length + 40
      out.push({ path: file.path, at: chunk.at, kind: file.kind, text })
    }
  }
  return out
}

/** Whole page (PDF) or the chunk starting at a line (text) of the first file whose path contains `fileFilter`. */
export function readPage(fileFilter: string, at: number, maxChars = 6000): Match | null {
  const filter = fileFilter.toLowerCase()
  for (const file of index.values()) {
    if (!file.path.toLowerCase().includes(filter)) continue
    const parts = file.chunks.filter((c) => (file.kind === 'pdf' ? c.at === at : at >= c.at && at < c.at + 60))
    if (parts.length === 0) continue
    return { path: file.path, at, kind: file.kind, text: parts.map((p) => p.text).join('\n').slice(0, maxChars) }
  }
  return null
}

function pageText(file: IndexedFile, at: number): string {
  return file.chunks.filter((c) => c.at === at).map((c) => c.text).join('\n')
}

/**
 * The ladder-report page that holds a given rung of a routine, plus the next page because
 * a rung's instructions often continue there. PDF reports only.
 */
export function readRung(routine: string, rung: number, fileFilter?: string, maxChars = 6000): Match | null {
  const filter = fileFilter?.toLowerCase()
  const header = `${routine.trim().split('/').pop()} - Ladder Diagram`.toLowerCase()
  const start = new RegExp(`(^|\\n)${Math.trunc(rung)}(\\s|$)`)
  for (const file of index.values()) {
    if (file.kind !== 'pdf' || (filter && !file.path.toLowerCase().includes(filter))) continue
    const pages = [...new Set(file.chunks.map((c) => c.at))].sort((a, b) => a - b)
    for (const n of pages) {
      const text = pageText(file, n)
      if (!text.toLowerCase().includes(header) || !start.test(text)) continue
      const next = pageText(file, n + 1)
      const both = next.toLowerCase().includes(header) ? `${text}\n${next}` : text
      return { path: file.path, at: n, kind: 'pdf', text: both.slice(0, maxChars) }
    }
  }
  return null
}

export function describeMatch(m: Match): string {
  return `--- ${m.path} (${m.kind === 'pdf' ? 'page' : 'line'} ${m.at}) ---\n${m.text}`
}

/** One line per read file, so the model knows what can be searched. */
export function readableFiles(): string[] {
  return [...index.values()].map(
    (f) => `${f.path} (${f.kind === 'pdf' ? `${new Set(f.chunks.map((c) => c.at)).size} pages` : `${f.chunks.length} blocks`})`,
  )
}
