/**
 * File-system helpers for the Library explorer, built on the browser's
 * File System Access API (FileSystemDirectoryHandle). The same code works on a
 * user-picked disk folder and on the browser-private origin file system.
 */

export type DirHandle = FileSystemDirectoryHandle

export interface TreeNode {
  name: string
  /** Path relative to the library root, '/'-separated. */
  path: string
  kind: 'file' | 'directory'
  handle: FileSystemFileHandle | FileSystemDirectoryHandle
  children?: TreeNode[]
}

export type LibraryMode = 'picked' | 'private'

const MAX_DEPTH = 12
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

type PickerWindow = Window & {
  showDirectoryPicker?: (options?: {
    mode?: 'read' | 'readwrite'
    id?: string
  }) => Promise<DirHandle>
}

type PermissionHandle = FileSystemHandle & {
  queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>
}

export function canPickFolder(): boolean {
  return typeof (window as PickerWindow).showDirectoryPicker === 'function'
}

export function canUsePrivateStorage(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.storage &&
    typeof navigator.storage.getDirectory === 'function'
  )
}

export function pickFolder(): Promise<DirHandle> {
  const picker = (window as PickerWindow).showDirectoryPicker
  if (!picker) throw new Error('Folder access is not supported in this browser.')
  return picker.call(window, { mode: 'readwrite', id: 'logix-library' })
}

export async function getPrivateRoot(): Promise<DirHandle> {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle('LogixLibrary', { create: true })
}

export async function hasPermission(
  handle: FileSystemHandle,
  request = false,
): Promise<boolean> {
  const h = handle as PermissionHandle
  if (!h.queryPermission) return true
  const opts = { mode: 'readwrite' as const }
  if ((await h.queryPermission(opts)) === 'granted') return true
  if (request && h.requestPermission) {
    return (await h.requestPermission(opts)) === 'granted'
  }
  return false
}

/* ---------- Persistence of the chosen root (IndexedDB) ---------- */

const DB_NAME = 'logix-assist'
const STORE = 'handles'
const KEY = 'library-root'

export interface StoredRoot {
  handle: DirHandle
  mode: LibraryMode
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

export async function saveStoredRoot(value: StoredRoot): Promise<void> {
  await withStore('readwrite', (s) => s.put(value, KEY))
}

export async function loadStoredRoot(): Promise<StoredRoot | null> {
  const value = await withStore<StoredRoot | undefined>('readonly', (s) =>
    s.get(KEY),
  )
  return value ?? null
}

export async function clearStoredRoot(): Promise<void> {
  await withStore('readwrite', (s) => s.delete(KEY))
}

/* ---------- Names ---------- */

/** Returns an error message, or null when the name is a valid single segment. */
export function validateName(raw: string): string | null {
  const name = raw.trim()
  if (!name) return 'Enter a name.'
  if (name === '.' || name === '..') return 'That name is not allowed.'
  if (name.length > 120) return 'Name is too long (max 120 characters).'
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(name)) {
    return 'Names cannot contain < > : " / \\ | ? *'
  }
  if (/[. ]$/.test(name)) return 'Names cannot end with a dot or space.'
  if (RESERVED_NAMES.test(name)) return 'That name is reserved by Windows.'
  return null
}

function safeName(raw: string): string {
  const cleaned = raw.replace(INVALID_CHARS, '_').replace(/[. ]+$/, '').trim()
  return cleaned || 'untitled'
}

async function exists(dir: DirHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name)
    return true
  } catch {
    // not a file with this name
  }
  try {
    await dir.getDirectoryHandle(name)
    return true
  } catch {
    return false
  }
}

async function uniqueName(
  dir: DirHandle,
  name: string,
  isFile: boolean,
): Promise<string> {
  if (!(await exists(dir, name))) return name
  const dot = isFile ? name.lastIndexOf('.') : -1
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let i = 1; i < 1000; i++) {
    const candidate = `${stem} (${i})${ext}`
    if (!(await exists(dir, candidate))) return candidate
  }
  throw new Error(`Could not find a free name for "${name}".`)
}

/* ---------- Tree + operations ---------- */

export async function readTree(
  dir: DirHandle,
  base = '',
  depth = 0,
): Promise<TreeNode[]> {
  const nodes: TreeNode[] = []
  for await (const handle of dir.values()) {
    const path = base ? `${base}/${handle.name}` : handle.name
    if (handle.kind === 'directory') {
      const sub = handle as DirHandle
      nodes.push({
        name: handle.name,
        path,
        kind: 'directory',
        handle: sub,
        children: depth < MAX_DEPTH ? await readTree(sub, path, depth + 1) : [],
      })
    } else {
      nodes.push({
        name: handle.name,
        path,
        kind: 'file',
        handle: handle as FileSystemFileHandle,
      })
    }
  }
  return nodes.sort((a, b) =>
    a.kind === b.kind
      ? a.name.localeCompare(b.name, undefined, { numeric: true })
      : a.kind === 'directory'
        ? -1
        : 1,
  )
}

export async function resolveDir(root: DirHandle, path: string): Promise<DirHandle> {
  let dir = root
  for (const segment of path.split('/').filter(Boolean)) {
    dir = await dir.getDirectoryHandle(segment)
  }
  return dir
}

export async function createFolder(
  root: DirHandle,
  parentPath: string,
  rawName: string,
): Promise<void> {
  const problem = validateName(rawName)
  if (problem) throw new Error(problem)
  const parent = await resolveDir(root, parentPath)
  const name = rawName.trim()
  if (await exists(parent, name)) {
    throw new Error(`"${name}" already exists here.`)
  }
  await parent.getDirectoryHandle(name, { create: true })
}

async function writeFileUnique(dir: DirHandle, file: File): Promise<void> {
  const name = await uniqueName(dir, safeName(file.name), true)
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  try {
    await writable.write(file)
  } finally {
    await writable.close()
  }
}

export async function addFiles(
  root: DirHandle,
  parentPath: string,
  files: File[],
): Promise<void> {
  const parent = await resolveDir(root, parentPath)
  for (const file of files) await writeFileUnique(parent, file)
}

async function copyEntry(dest: DirHandle, handle: FileSystemHandle, depth = 0) {
  if (depth > MAX_DEPTH) return
  if (handle.kind === 'file') {
    await writeFileUnique(dest, await (handle as FileSystemFileHandle).getFile())
    return
  }
  const name = await uniqueName(dest, safeName(handle.name), false)
  const sub = await dest.getDirectoryHandle(name, { create: true })
  for await (const child of (handle as DirHandle).values()) {
    await copyEntry(sub, child, depth + 1)
  }
}

type DropItem = DataTransferItem & {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>
}

/**
 * Copies dropped files and folders into the library. Handles must be requested
 * synchronously inside the drop event, so this takes the DataTransfer directly.
 */
export async function addDropped(
  root: DirHandle,
  parentPath: string,
  dt: DataTransfer,
): Promise<void> {
  const pending = Array.from(dt.items)
    .filter((item) => item.kind === 'file')
    .map((item) => {
      const it = item as DropItem
      return { handle: it.getAsFileSystemHandle?.(), file: it.getAsFile() }
    })
  const parent = await resolveDir(root, parentPath)
  for (const entry of pending) {
    const handle = entry.handle ? await entry.handle : null
    if (handle) await copyEntry(parent, handle)
    else if (entry.file) await writeFileUnique(parent, entry.file)
  }
}

export async function removeEntry(root: DirHandle, path: string): Promise<void> {
  const segments = path.split('/').filter(Boolean)
  const name = segments.pop()
  if (!name) throw new Error('Nothing to delete.')
  const parent = await resolveDir(root, segments.join('/'))
  await parent.removeEntry(name, { recursive: true })
}

export function parentOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

export async function createFile(
  root: DirHandle,
  parentPath: string,
  rawName: string,
): Promise<void> {
  const problem = validateName(rawName)
  if (problem) throw new Error(problem)
  const parent = await resolveDir(root, parentPath)
  const name = rawName.trim()
  if (await exists(parent, name)) throw new Error(`"${name}" already exists here.`)
  const handle = await parent.getFileHandle(name, { create: true })
  await (await handle.createWritable()).close()
}

type MovableHandle = FileSystemHandle & {
  move?: (destinationOrName: DirHandle | string, name?: string) => Promise<void>
}

async function getEntry(dir: DirHandle, name: string): Promise<FileSystemHandle> {
  try {
    return await dir.getFileHandle(name)
  } catch {
    return await dir.getDirectoryHandle(name)
  }
}

async function copyExact(dest: DirHandle, handle: FileSystemHandle, name: string, depth = 0) {
  if (depth > MAX_DEPTH) return
  if (handle.kind === 'file') {
    const file = await (handle as FileSystemFileHandle).getFile()
    const out = await dest.getFileHandle(name, { create: true })
    const writable = await out.createWritable()
    try {
      await writable.write(file)
    } finally {
      await writable.close()
    }
    return
  }
  const sub = await dest.getDirectoryHandle(name, { create: true })
  for await (const child of (handle as DirHandle).values()) {
    await copyExact(sub, child, child.name, depth + 1)
  }
}

/** Moves/renames with the native move() when available, else copy then delete. */
async function relocate(
  handle: FileSystemHandle,
  srcParent: DirHandle,
  destDir: DirHandle,
  name: string,
  sameDir: boolean,
): Promise<void> {
  const movable = handle as MovableHandle
  if (typeof movable.move === 'function') {
    try {
      if (sameDir) await movable.move(name)
      else await movable.move(destDir, name)
      return
    } catch {
      // not supported for this handle: fall back to copy + delete
    }
  }
  const original = handle.name
  await copyExact(destDir, handle, name)
  await srcParent.removeEntry(original, { recursive: true })
}

export async function renameEntry(
  root: DirHandle,
  path: string,
  rawName: string,
): Promise<void> {
  const problem = validateName(rawName)
  if (problem) throw new Error(problem)
  const name = rawName.trim()
  const parentPath = parentOf(path)
  const parent = await resolveDir(root, parentPath)
  const oldName = path.slice(parentPath ? parentPath.length + 1 : 0)
  if (name === oldName) return
  if (await exists(parent, name)) throw new Error(`"${name}" already exists here.`)
  await relocate(await getEntry(parent, oldName), parent, parent, name, true)
}

export async function moveEntry(
  root: DirHandle,
  srcPath: string,
  destDirPath: string,
): Promise<void> {
  const srcParentPath = parentOf(srcPath)
  if (srcParentPath === destDirPath) return
  if (destDirPath === srcPath || destDirPath.startsWith(srcPath + '/')) {
    throw new Error('A folder cannot be moved into itself.')
  }
  const srcParent = await resolveDir(root, srcParentPath)
  const dest = await resolveDir(root, destDirPath)
  const name = srcPath.slice(srcParentPath ? srcParentPath.length + 1 : 0)
  if (await exists(dest, name)) throw new Error(`"${name}" already exists in the destination folder.`)
  await relocate(await getEntry(srcParent, name), srcParent, dest, name, false)
}
