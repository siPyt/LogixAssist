# Logix Assistant

A branded **Rockwell/Logix** companion app — _developed by Charles R. Freeman, Software Engineer_.

A FactoryTalk View–styled "HMI" shell with three panels:

- **Library (left)** — a VS Code–style explorer for your Rockwell official PDFs and program-file PDFs.
  Create files and folders inline, rename, delete, drag to move, and click a PDF to read it in the center panel.
- **Center** — marketing screen (_Logix Assistant, developed by Charles R. Freeman, Software Engineer_) or the file viewer.
- **AI Assistant (right)** — uses the **Claude Sonnet** model from your VS Code (GitHub Copilot) subscription via the
  bundled bridge extension, with live streaming replies.

The **LA** badge (Rockwell brand red `#CD163F` / orange `#F58025`):

- **Hover** → _by Charles R. Freeman_.
- **Click** → opens your library folder in VS Code via `vscode://file/...`.
- Installable as a desktop, mobile, or web app (PWA) — see below.

## Run it

Double-click **`start.bat`**, or:

```bash
npm install
npm run dev      # http://localhost:5173
```

Other scripts: `npm run build` (production build to `dist/`), `npm run preview`.

`npm run dev` opens the app in its **own window** (Chrome or Edge app mode, no tabs or address bar), so Windows shows
the **LA icon** on the taskbar instead of the browser's logo. Right-click the taskbar icon → **Pin to taskbar** to keep
it. Set `LOGIX_NO_OPEN=1` to skip opening a window.

## Layout

- **Resize** either side panel by dragging the divider (double-click it to reset; arrow keys work when focused).
  Drag a panel narrower than ~120px and it collapses, like VS Code.
- **Collapse / show** with the two panel buttons in the top bar, **Ctrl+B** (Explorer) and **Ctrl+Alt+B** (AI Assistant).
  Sizes and open/closed state are remembered.
- **Explorer** works like VS Code's: hover for the New File / New Folder / Upload / Refresh / Collapse All buttons,
  right-click for the menu, **F2** to rename, **Delete** to delete, arrow keys to move around, and drag a file or folder
  onto another folder to move it (drop files from Windows to add them).

## First-time setup

1. **Library folder** — in the left panel click **Choose library folder** and pick the folder that holds your PDFs
   (e.g. `resources/` in this project). Use **Chrome or Edge**. The app remembers the folder; after a browser restart
   click **Reconnect folder** once to re-grant access. Other browsers can use **Use browser storage instead**.
2. **VS Code path** — open **Settings** and set the absolute path of that same folder so the LA badge opens it in VS Code.
3. **AI assistant (uses your VS Code Claude Sonnet — no API key)** — install the bridge extension once:

   ```bash
   cd extension
   npm install
   npm run package
   code --install-extension logix-assistant-bridge-0.1.0.vsix
   ```

   The app pairs itself automatically as soon as it sees the bridge — there is nothing to click. The first
   message triggers a one-time VS Code prompt asking to allow the extension to use your Copilot
   models — choose **Allow**. See [extension/README.md](./extension/README.md).

   The Anthropic API (`ANTHROPIC_API_KEY`, see `.env.example`) is only an optional fallback, for phones or
   machines without VS Code. Choose it in **Settings → Connect through**.

## Install it as an app (desktop, mobile, or web)

Logix Assistant is a PWA, so one codebase covers all three. Open the deployed Vercel site (or a production build),
then:

- **Windows / Mac / Linux desktop** — in Edge or Chrome click **Install app** in the top bar (or the install icon in the
  address bar). It gets its own window, Start-menu entry, and LA icon, and the shell works offline.
- **Android** — Chrome menu → **Install app** / **Add to Home screen**.
- **iPhone / iPad** — Safari **Share** → **Add to Home Screen**.
- **Web** — just use the site.

Notes: the install prompt only appears on the deployed (HTTPS) site or a production build, not under `npm run dev`.
Phones can't open folders on disk, so they use **browser storage** for the Library, and the LA badge's
`vscode://` link only applies on a computer with VS Code. iOS Safari's file-write support is limited, so adding
files on iPhone may not work.

## Deploy (Vercel)

1. Import the GitHub repo into Vercel (framework preset: **Vite**).
2. Deploy. To use your VS Code model from the deployed site, add the Vercel URL to the VS Code setting
   **Logix Assistant: Allowed Origins** (and **App Url** to auto-pair it). The browser talks to the bridge on your own
   machine, so VS Code must be open on the computer you're using.
3. Optional fallback for devices without VS Code: add `ANTHROPIC_API_KEY` under Settings → Environment Variables.
   The `api/chat.ts` function keeps the key server-side.

On Vercel the Library panel still works (it uses your browser's folder access), but the LA badge's
`vscode://` link only works on a machine that has VS Code installed.

## Tech

React + TypeScript + Vite. Library uses the browser File System Access API. `api/chat.ts` is the Vercel
serverless function; `vite.config.ts` serves it at `/api/chat` during `npm run dev`.
