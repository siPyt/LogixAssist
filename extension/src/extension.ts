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
const SYSTEM_PROMPT =
  'You are Logix Assistant, a helpful assistant for Rockwell Automation / Studio 5000 Logix programming, created by Charles R. Freeman.'

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function toInfo(m: vscode.LanguageModelChat): ModelInfo {
  return { id: m.id, name: m.name, family: m.family, vendor: m.vendor }
}

/** Highest dotted version found in a model family/name, e.g. "claude-sonnet-4.5" -> 4.5 */
function versionOf(m: vscode.LanguageModelChat): number {
  const match = /(\d+(?:\.\d+)?)/.exec(m.family) ?? /(\d+(?:\.\d+)?)/.exec(m.name)
  return match ? parseFloat(match[1]) : 0
}

function pickModel(
  models: vscode.LanguageModelChat[],
  requestedId: string | undefined,
  preferred: string,
): vscode.LanguageModelChat | undefined {
  if (requestedId) {
    const exact = models.find((m) => m.id === requestedId)
    if (exact) return exact
  }
  const want = normalize(preferred)
  const preferredMatch = models.find(
    (m) => normalize(m.family) === want || normalize(m.name) === want || normalize(m.id) === want,
  )
  if (preferredMatch) return preferredMatch
  const sonnets = models
    .filter((m) => /sonnet/i.test(m.family) || /sonnet/i.test(m.name))
    .sort((a, b) => versionOf(b) - versionOf(a))
  return sonnets[0] ?? models[0]
}

class CopilotProvider implements LlmProvider {
  private preferred(): string {
    return vscode.workspace.getConfiguration('logixAssistant').get<string>('model', 'claude-sonnet-5.5')
  }

  async listModels(): Promise<ModelList> {
    const models = await vscode.lm.selectChatModels()
    const selected = pickModel(models, undefined, this.preferred())
    return { models: models.map(toInfo), selected: selected ? toInfo(selected) : null }
  }

  async chat(
    messages: ChatMessage[],
    options: { modelId?: string; signal: AbortSignal },
    onDelta: (text: string) => void,
  ): Promise<{ model: string }> {
    const models = await vscode.lm.selectChatModels()
    const model = pickModel(models, options.modelId, this.preferred())
    if (!model) {
      throw new Error(
        'No VS Code language models are available. Make sure you are signed in to GitHub Copilot in VS Code.',
      )
    }

    // The LM API has no system role, so the instructions ride on the first user turn.
    const chatMessages = messages.map((m, i) =>
      m.role === 'assistant'
        ? vscode.LanguageModelChatMessage.Assistant(m.content)
        : vscode.LanguageModelChatMessage.User(i === 0 ? `${SYSTEM_PROMPT}\n\n${m.content}` : m.content),
    )
    if (messages[0]?.role === 'assistant') {
      chatMessages.unshift(vscode.LanguageModelChatMessage.User(SYSTEM_PROMPT))
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
  const stop = () =>
    new Promise<void>((resolve) => {
      if (!server) return resolve()
      server.close(() => resolve())
      server.closeAllConnections?.()
      server = undefined
    })

  const start = async () => {
    await stop()
    const port = config().get<number>('port', 47821)
    const next = createBridge({
      port,
      getToken: () => token,
      getAllowedOrigins: () => config().get<string[]>('allowedOrigins', []),
      provider: new CopilotProvider(),
    })
    await new Promise<void>((resolve) => {
      next.once('error', (err: NodeJS.ErrnoException) => {
        const reason =
          err.code === 'EADDRINUSE'
            ? `port ${port} is already in use (another VS Code window may be running the bridge)`
            : err.message
        output.appendLine(`Bridge could not start: ${reason}`)
        status.text = '$(circle-slash) Logix Bridge: off'
        status.tooltip = `Logix Assistant Bridge is not running: ${reason}`
        status.show()
        resolve()
      })
      next.listen(port, '127.0.0.1', () => {
        server = next
        output.appendLine(`Bridge (${BRIDGE_NAME}) listening on http://127.0.0.1:${port}`)
        status.text = '$(plug) Logix Bridge'
        status.tooltip = `Logix Assistant Bridge on 127.0.0.1:${port} (click for options)`
        status.show()
        resolve()
      })
    })
  }

  const appUrl = () => config().get<string>('appUrl', 'http://localhost:5173')

  context.subscriptions.push(
    vscode.commands.registerCommand('logixAssistant.copyToken', async () => {
      await vscode.env.clipboard.writeText(await ensureToken())
      vscode.window.showInformationMessage('Logix Assistant pairing token copied to the clipboard.')
    }),
    vscode.commands.registerCommand('logixAssistant.openApp', async () => {
      // The token rides in the URL fragment, which browsers never send to servers.
      const url = `${appUrl().replace(/\/+$/, '')}/#pair=${await ensureToken()}`
      await vscode.env.openExternal(vscode.Uri.parse(url))
    }),
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
