# Logix Assistant Bridge (VS Code extension)

Lets the Logix Assistant app use the **Claude Sonnet model from your VS Code / GitHub Copilot subscription** —
no separate API key. It runs a small server on `127.0.0.1:47821` inside VS Code and calls the model through VS Code's
Language Model API.

## Install

```bash
npm install
npm run package
code --install-extension logix-assistant-bridge-0.1.0.vsix
```

Then run **Logix Assistant: Open App (auto-pair)** from the Command Palette. The first chat message makes VS Code ask
whether the extension may use your Copilot models — choose **Allow**.

## Commands

| Command | What it does |
| --- | --- |
| Logix Assistant: Open App (auto-pair) | Opens the app and passes it the pairing token |
| Logix Assistant: Copy Pairing Token | Copies the token so you can paste it in the app's Settings |
| Logix Assistant: Regenerate Pairing Token | Invalidates the old token |
| Logix Assistant: Restart Bridge | Restarts the local server |

## Settings

- `logixAssistant.model` — preferred model (default `claude-sonnet-5.5`). Falls back to the newest Claude Sonnet,
  then any available model. The app shows which model answered.
- `logixAssistant.port` — default `47821`.
- `logixAssistant.appUrl` — URL opened by auto-pair (set to your Vercel URL for the deployed app).
- `logixAssistant.allowedOrigins` — web origins allowed to call the bridge. Add your Vercel URL here.

## Security

- Listens on `127.0.0.1` only, and rejects requests whose `Host` isn't loopback (DNS-rebinding protection).
- Browsers must come from an allowed origin, and every chat/model request needs the secret pairing token
  (stored in VS Code's SecretStorage, compared in constant time).
- The auto-pair token travels in the URL fragment, which browsers never send to servers.

## Develop

```bash
npm test    # builds and runs the bridge smoke test with a fake model
```
