# Logix Assistant

A branded **Rockwell/Logix** companion app — _developed by Charles R. Freeman, Software Engineer_.

A FactoryTalk View–styled "HMI" shell with three panels:

- **Library (left)** — a file explorer for your Rockwell official PDFs and program-file PDFs.
  Create folders, add files (button or drag-and-drop), delete, and click a PDF to read it in the center panel.
- **Center** — marketing screen (_Logix Assistant, developed by Charles R. Freeman, Software Engineer_) or the file viewer.
- **AI Assistant (right)** — defaults to the **Claude Sonnet 5.5** agent.

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

## First-time setup

1. **Library folder** — in the left panel click **Choose library folder** and pick the folder that holds your PDFs
   (e.g. `resources/` in this project). Use **Chrome or Edge**. The app remembers the folder; after a browser restart
   click **Reconnect folder** once to re-grant access. Other browsers can use **Use browser storage instead**.
2. **VS Code path** — open **Settings** and set the absolute path of that same folder so the LA badge opens it in VS Code.
3. **AI assistant** — copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`. Restart `npm run dev`.
   The model defaults to `claude-sonnet-5.5`; override with `ANTHROPIC_MODEL` if your API account uses a different id.

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
2. Add `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`) under Settings → Environment Variables.
3. Deploy. The `api/chat.ts` function keeps the key server-side.

On Vercel the Library panel still works (it uses your browser's folder access), but the LA badge's
`vscode://` link only works on a machine that has VS Code installed.

## Tech

React + TypeScript + Vite. Library uses the browser File System Access API. `api/chat.ts` is the Vercel
serverless function; `vite.config.ts` serves it at `/api/chat` during `npm run dev`.
