/**
 * App configuration and small shared constants.
 */

export const AUTHOR = 'Charles R. Freeman'
export const AUTHOR_TITLE = 'Software Engineer'
export const APP_NAME = 'Logix Assistant'

/** Default AI agent for the assistant panel. */
export const DEFAULT_AI_MODEL = 'claude-sonnet-5.5'

/** Friendly label for the default agent. */
export const DEFAULT_AI_MODEL_LABEL = 'Claude Sonnet 5.5'

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
