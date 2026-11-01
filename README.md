# Logix Assistant

A branded **Rockwell/Logix** companion app — _developed by Charles R. Freeman, Software Engineer_.

It presents a FactoryTalk View–styled "HMI" shell with:

- An **LA** badge icon in the Rockwell color palette (brand red `#CD163F`, orange `#F58025`).
  - **Hover** → tooltip: _by Charles R. Freeman_.
  - **Click** → opens your local PDF library in VS Code via the `vscode://file/...` URI scheme.
- A center **marketing screen**: _Logix Assistant, developed by Charles R. Freeman, Software Engineer_.
- An **AI Assistant** panel defaulting to the **Claude Sonnet 5.5** agent.

## Tech

- React + TypeScript + Vite (deploys to Vercel).
- `api/chat.ts` serverless function proxies the assistant to Anthropic (key stays server-side).

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build -> dist/
```

## Deploy (Vercel)

1. Import the GitHub repo into Vercel (framework preset: **Vite**).
2. Add an environment variable `ANTHROPIC_API_KEY` to enable the AI Assistant.
3. Deploy.

## Resource library

The LA badge opens the folder set in **Settings** (default: [resources/](./resources)).
Drop your Rockwell official PDFs and program-file PDFs there. VS Code must be
installed on the viewing machine. See [resources/README.md](./resources/README.md).
