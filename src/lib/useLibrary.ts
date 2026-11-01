import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addDropped,
  addFiles,
  canPickFolder,
  canUsePrivateStorage,
  clearStoredRoot,
  createFile,
  createFolder,
  getPrivateRoot,
  hasPermission,
  loadStoredRoot,
  moveEntry,
  pickFolder,
  readTree,
  removeEntry,
  renameEntry,
  saveStoredRoot,
  type DirHandle,
  type LibraryMode,
  type StoredRoot,
  type TreeNode,
} from './fs'

export type LibraryStatus =
  | 'loading'
  | 'disconnected'
  | 'needs-permission'
  | 'ready'

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.'
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

export function useLibrary() {
  const [status, setStatus] = useState<LibraryStatus>('loading')
  const [root, setRoot] = useState<DirHandle | null>(null)
  const [mode, setMode] = useState<LibraryMode>('picked')
  const [pending, setPending] = useState<StoredRoot | null>(null)
  const [tree, setTree] = useState<TreeNode[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<DirHandle | null>(null)

  const activate = useCallback(async (handle: DirHandle, m: LibraryMode) => {
    rootRef.current = handle
    setRoot(handle)
    setMode(m)
    setPending(null)
    setTree(await readTree(handle))
    setStatus('ready')
  }, [])

  const refresh = useCallback(async () => {
    if (!rootRef.current) return
    setTree(await readTree(rootRef.current))
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const stored = await loadStoredRoot()
        if (cancelled) return
        if (!stored) return setStatus('disconnected')
        if (stored.mode === 'private' || (await hasPermission(stored.handle))) {
          await activate(stored.handle, stored.mode)
        } else {
          setPending(stored)
          setStatus('needs-permission')
        }
      } catch (err) {
        if (!cancelled) {
          setError(messageOf(err))
          setStatus('disconnected')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activate])

  const guard = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true)
      setError(null)
      try {
        await fn()
        await refresh()
      } catch (err) {
        if (!isAbort(err)) setError(messageOf(err))
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  const connectFolder = useCallback(async () => {
    setError(null)
    try {
      const handle = await pickFolder()
      await saveStoredRoot({ handle, mode: 'picked' })
      await activate(handle, 'picked')
    } catch (err) {
      if (!isAbort(err)) setError(messageOf(err))
    }
  }, [activate])

  const connectPrivate = useCallback(async () => {
    setError(null)
    try {
      const handle = await getPrivateRoot()
      await saveStoredRoot({ handle, mode: 'private' })
      await activate(handle, 'private')
    } catch (err) {
      setError(messageOf(err))
    }
  }, [activate])

  const reconnect = useCallback(async () => {
    if (!pending) return
    setError(null)
    try {
      if (await hasPermission(pending.handle, true)) {
        await activate(pending.handle, pending.mode)
      } else {
        setError('Permission was not granted for that folder.')
      }
    } catch (err) {
      setError(messageOf(err))
    }
  }, [pending, activate])

  const disconnect = useCallback(async () => {
    await clearStoredRoot()
    rootRef.current = null
    setRoot(null)
    setTree([])
    setPending(null)
    setStatus('disconnected')
  }, [])

  const makeFolder = useCallback(
    (parentPath: string, name: string) =>
      guard(async () => {
        if (!rootRef.current) return
        await createFolder(rootRef.current, parentPath, name)
      }),
    [guard],
  )

  const makeFile = useCallback(
    (parentPath: string, name: string) =>
      guard(async () => {
        if (!rootRef.current) return
        await createFile(rootRef.current, parentPath, name)
      }),
    [guard],
  )

  const rename = useCallback(
    (path: string, name: string) =>
      guard(async () => {
        if (!rootRef.current) return
        await renameEntry(rootRef.current, path, name)
      }),
    [guard],
  )

  const move = useCallback(
    (path: string, destDirPath: string) =>
      guard(async () => {
        if (!rootRef.current) return
        await moveEntry(rootRef.current, path, destDirPath)
      }),
    [guard],
  )

  const uploadFiles = useCallback(
    (parentPath: string, files: File[]) =>
      guard(async () => {
        if (!rootRef.current || files.length === 0) return
        await addFiles(rootRef.current, parentPath, files)
      }),
    [guard],
  )

  const dropItems = useCallback(
    (parentPath: string, dt: DataTransfer) =>
      guard(async () => {
        if (!rootRef.current) return
        await addDropped(rootRef.current, parentPath, dt)
      }),
    [guard],
  )

  const remove = useCallback(
    (path: string) =>
      guard(async () => {
        if (!rootRef.current) return
        await removeEntry(rootRef.current, path)
      }),
    [guard],
  )

  return {
    status,
    mode,
    rootName: root?.name ?? pending?.handle.name ?? '',
    pendingName: pending?.handle.name ?? '',
    tree,
    busy,
    error,
    clearError: () => setError(null),
    canPickFolder: canPickFolder(),
    canUsePrivateStorage: canUsePrivateStorage(),
    connectFolder,
    connectPrivate,
    reconnect,
    disconnect,
    refresh: () => guard(async () => undefined),
    makeFolder,
    makeFile,
    rename,
    move,
    uploadFiles,
    dropItems,
    remove,
  }
}

export type Library = ReturnType<typeof useLibrary>
