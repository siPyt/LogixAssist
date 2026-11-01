# LogixAssist Resource Library

This folder is the library that the **LA** badge opens in VS Code.

Put your PDFs here:

- **Rockwell official PDFs** — manuals, reference guides, instruction sets, etc.
- **Program-file PDFs** — exported/printed copies of your Logix program files.
  _(You add these yourself.)_

## How the "open in VS Code" action works

Clicking the **LA** icon in the app launches:

```
vscode://file/<absolute path to this folder>
```

VS Code must be installed on the machine viewing the app. If you move this
folder, update the path in the app's **Settings** panel (it is saved in your
browser's localStorage, so it stays local to your machine and is not part of
the Vercel deployment).
