/**
 * App configuration and small shared constants.
 */

export const AUTHOR = 'Charles R. Freeman'
export const AUTHOR_TITLE = 'Software Engineer'
export const APP_NAME = 'Logix Assistant'

/** Friendly label for the default agent (the model actually used is reported by the bridge). */
export const DEFAULT_AI_MODEL_LABEL = 'Claude Sonnet 5.5'

export type AiBackend = 'vscode' | 'cloud'

/** Where the local VS Code bridge extension listens. */
export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:47821'

const BACKEND_KEY = 'logix.aiBackend'
const BRIDGE_URL_KEY = 'logix.bridgeUrl'
const BRIDGE_TOKEN_KEY = 'logix.bridgeToken'

/** Fired whenever AI settings change so open panels can re-check the connection. */
export const AI_SETTINGS_EVENT = 'logix-ai-settings'

function readSetting(key: string): string | null {
  return typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
}

function writeSetting(key: string, value: string): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(key, value)
  window.dispatchEvent(new Event(AI_SETTINGS_EVENT))
}

export function getAiBackend(): AiBackend {
  return readSetting(BACKEND_KEY) === 'cloud' ? 'cloud' : 'vscode'
}

export function setAiBackend(value: AiBackend): void {
  writeSetting(BACKEND_KEY, value)
}

export function getBridgeUrl(): string {
  return (readSetting(BRIDGE_URL_KEY) || DEFAULT_BRIDGE_URL).replace(/\/+$/, '')
}

export function setBridgeUrl(value: string): void {
  writeSetting(BRIDGE_URL_KEY, value.trim())
}

export function getBridgeToken(): string {
  return readSetting(BRIDGE_TOKEN_KEY) ?? ''
}

export function setBridgeToken(value: string): void {
  writeSetting(BRIDGE_TOKEN_KEY, value.trim())
}

/**
 * Default local folder (absolute path) that holds the Rockwell official PDFs
 * and the user's program-file PDFs. Clicking the LA icon opens this folder in
 * VS Code via the `vscode://file/...` URI scheme. Editable in Settings and
 * persisted to localStorage, so it travels with the machine, not the deploy.
 */
export const DEFAULT_RESOURCES_PATH =
  'C:\\Users\\cfree\\OneDrive\\Desktop\\LogixAssist\\resources'

const RESOURCES_PATH_KEY = 'logix.resourcesPath'

export function getResourcesPath(): string {
  if (typeof localStorage === 'undefined') return DEFAULT_RESOURCES_PATH
  return localStorage.getItem(RESOURCES_PATH_KEY) ?? DEFAULT_RESOURCES_PATH
}

export function setResourcesPath(path: string): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(RESOURCES_PATH_KEY, path)
}

/**
 * Build a `vscode://file/...` URI that opens the given absolute folder path in
 * VS Code. Works from a browser when VS Code is installed on the machine.
 */
export function buildVsCodeFolderUri(absolutePath: string): string {
  // VS Code expects forward slashes and a leading slash for the file authority.
  let normalized = absolutePath.replace(/\\/g, '/')
  if (!normalized.startsWith('/')) normalized = '/' + normalized
  return 'vscode://file' + encodeURI(normalized)
}
