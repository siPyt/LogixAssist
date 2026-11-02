import * as vscode from 'vscode'
import { randomBytes } from 'node:crypto'
import type * as http from 'node:http'
import {
  BRIDGE_NAME,
  createBridge,
  type ChatMessage,
  type LlmProvider,
  type ModelInfo,
  type ModelList,
} from './server'

const TOKEN_KEY = 'logixAssistant.pairingToken'
/** Local dev servers on any port (Vite moves to 5174, 5175... when 5173 is busy). */
const LOOPBACK_ORIGINS = ['http://localhost:*', 'http://127.0.0.1:*']
const SYSTEM_PROMPT =
  'You are Logix Assistant, a helpful assistant for Rockwell Automation / Studio 5000 Logix programming, created by Charles R. Freeman.'

const FILES_PROMPT =
  "The user's project files are open in the Logix Assistant Explorer. Below is the file list plus the excerpts from those files that best match their question. " +
  'Answer from these excerpts and name the file and page/line you found things in. Follow the answer rules included with them exactly. ' +
  "If the excerpts don't contain the answer, say what you looked at and which file the user should open or export, rather than saying you have no access to their files."

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The only model Logix Assistant is allowed to use. There is no fallback to other models. */
export const REQUIRED_MODEL = 'Claude Sonnet 5.5'
const REQUIRED_KEY = normalize(REQUIRED_MODEL)

function toInfo(m: vscode.LanguageModelChat): ModelInfo {
  return { id: m.id, name: m.name, family: m.family, vendor: m.vendor }
}

function pickModel(models: vscode.LanguageModelChat[]): vscode.LanguageModelChat | undefined {
  return models.find((m) => [m.family, m.name, m.id].some((v) => normalize(v).includes(REQUIRED_KEY)))
}

class CopilotProvider implements LlmProvider {
  async listModels(): Promise<ModelList> {
    const selected = pickModel(await vscode.lm.selectChatModels())
    return { models: selected ? [toInfo(selected)] : [], selected: selected ? toInfo(selected) : null }
  }

  async chat(
    messages: ChatMessage[],
    options: { context?: string; signal: AbortSignal },
    onDelta: (text: string) => void,
  ): Promise<{ model: string }> {
    const model = pickModel(await vscode.lm.selectChatModels())
    if (!model) {
      throw new Error(
        `${REQUIRED_MODEL} is not available in VS Code. Sign in to GitHub Copilot and enable ${REQUIRED_MODEL} in the Copilot model picker. Logix Assistant will not use any other model.`,
      )
    }

    // The LM API has no system role, so the instructions ride on the first user turn.
    const preface = options.context ? `${SYSTEM_PROMPT}\n\n${FILES_PROMPT}\n\n${options.context}` : SYSTEM_PROMPT
    const chatMessages = messages.map((m, i) =>
      m.role === 'assistant'
        ? vscode.LanguageModelChatMessage.Assistant(m.content)
        : vscode.LanguageModelChatMessage.User(i === 0 ? `${preface}\n\n${m.content}` : m.content),
    )
    if (messages[0]?.role === 'assistant') {
      chatMessages.unshift(vscode.LanguageModelChatMessage.User(preface))
    }

    const cancel = new vscode.CancellationTokenSource()
    const onAbort = () => cancel.cancel()
    options.signal.addEventListener('abort', onAbort)
    try {
      const response = await model.sendRequest(
        chatMessages,
        { justification: 'Logix Assistant answers your questions with your Copilot model.' },
        cancel.token,
      )
      for await (const chunk of response.text) onDelta(chunk)
      return { model: model.name }
    } catch (err) {
      if (err instanceof vscode.LanguageModelError) {
        if (err.code === vscode.LanguageModelError.NoPermissions.name) {
          throw new Error('Permission to use the language model was declined in VS Code.')
        }
        throw new Error(err.message)
      }
      throw err
    } finally {
      options.signal.removeEventListener('abort', onAbort)
      cancel.dispose()
    }
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = () => vscode.workspace.getConfiguration('logixAssistant')
  const output = vscode.window.createOutputChannel('Logix Assistant Bridge')
  context.subscriptions.push(output)

  let token = (await context.secrets.get(TOKEN_KEY)) ?? ''
  const ensureToken = async (regenerate = false) => {
    if (!token || regenerate) {
      token = randomBytes(32).toString('hex')
      await context.secrets.store(TOKEN_KEY, token)
    }
    return token
  }
  await ensureToken()

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50)
  status.command = 'logixAssistant.showStatus'
  context.subscriptions.push(status)

  let server: http.Server | undefined
  let retry: NodeJS.Timeout | undefined
  let loggedBusy = false
  const stop = () =>
    new Promise<void>((resolve) => {
      clearTimeout(retry)
      retry = undefined
      if (!server) return resolve()
      server.close(() => resolve())
      server.closeAllConnections?.()
      server = undefined
    })

  const start = async () => {
    await stop()
    // The token is shared between VS Code windows; pick up a regenerated one.
    token = (await context.secrets.get(TOKEN_KEY)) ?? token
    const port = config().get<number>('port', 47821)
    const next = createBridge({
      port,
      getToken: () => token,
      getAllowedOrigins: () => [...LOOPBACK_ORIGINS, ...config().get<string[]>('allowedOrigins', [])],
      provider: new CopilotProvider(),
    })
    await new Promise<void>((resolve) => {
      next.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          // Another VS Code window owns the bridge: keep trying so this one takes over if it closes.
          if (!loggedBusy) {
            output.appendLine(`Port ${port} is in use by another window; will take over if it frees up.`)
            loggedBusy = true
          }
          status.text = '$(sync) Logix Bridge: standby'
          status.tooltip = `Another VS Code window is running the bridge on port ${port}. This window takes over if it closes.`
          status.show()
          retry = setTimeout(() => void start(), 5000)
        } else {
          output.appendLine(`Bridge could not start: ${err.message}`)
          status.text = '$(circle-slash) Logix Bridge: off'
          status.tooltip = `Logix Assistant Bridge is not running: ${err.message}`
          status.show()
        }
        resolve()
      })
      next.listen(port, '127.0.0.1', () => {
        server = next
        loggedBusy = false
        output.appendLine(`Bridge (${BRIDGE_NAME}) listening on http://127.0.0.1:${port}`)
        status.text = '$(plug) Logix Bridge'
        status.tooltip = `Logix Assistant Bridge on 127.0.0.1:${port} (click for options)`
        status.show()
        resolve()
      })
    })
  }

  const appUrl = () => config().get<string>('appUrl', 'http://localhost:5173')

  const openApp = async (base: string) => {
    // The token rides in the URL fragment, which browsers never send to servers.
    const url = `${base.replace(/\/+$/, '')}/#pair=${await ensureToken()}`
    await vscode.env.openExternal(vscode.Uri.parse(url))
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('logixAssistant.copyToken', async () => {
      await vscode.env.clipboard.writeText(await ensureToken())
      vscode.window.showInformationMessage('Logix Assistant pairing token copied to the clipboard.')
    }),
    vscode.commands.registerCommand('logixAssistant.openApp', () => openApp(appUrl())),
    vscode.commands.registerCommand('logixAssistant.regenerateToken', async () => {
      await ensureToken(true)
      vscode.window.showInformationMessage(
        'New pairing token created. Pair the app again using "Logix Assistant: Open App (auto-pair)".',
      )
    }),
    vscode.commands.registerCommand('logixAssistant.restart', async () => {
      await start()
    }),
    vscode.commands.registerCommand('logixAssistant.showStatus', async () => {
      const pick = await vscode.window.showQuickPick(
        [
          { label: '$(link-external) Open App (auto-pair)', id: 'logixAssistant.openApp' },
          { label: '$(copy) Copy pairing token', id: 'logixAssistant.copyToken' },
          { label: '$(refresh) Restart bridge', id: 'logixAssistant.restart' },
          { label: '$(key) Regenerate pairing token', id: 'logixAssistant.regenerateToken' },
        ],
        { placeHolder: status.tooltip?.toString() ?? 'Logix Assistant Bridge' },
      )
      if (pick) await vscode.commands.executeCommand(pick.id)
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('logixAssistant.port')) void start()
    }),
    { dispose: () => void stop() },
  )

  await start()
}

export function deactivate(): void {
  // The server is closed through the subscription registered in activate().
}
