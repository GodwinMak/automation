# LIT Terminal (Electron)

Desktop SSH client built by Liquid Intelligence Technologies with Electron, SSH2, and xterm.js.

## Features in this scaffold

- Desktop app window with a terminal-style dark interface
- Session sidebar and session tabs
- Quick Connect flow
- SSH connect/disconnect per tab
- Interactive terminal via xterm.js
- Secure preload bridge (contextIsolation enabled)

## Project structure

- main.js: Electron main process and SSH lifecycle
- preload.js: Safe IPC bridge exposed to renderer
- renderer/index.html: UI template based on your design
- renderer/renderer.js: UI logic + terminal + session actions

## Run locally

1. Install dependencies

```bash
cd desktop-terminal-core
npm install
```

2. Start app

```bash
npm start
```

## Notes

- Existing sample sessions in main.js use placeholder private network IPs. Replace with your real hosts.
- Password input currently uses prompt for speed of setup. You can replace with a custom modal next.
- If you want SFTP transfer, saved credential vault, and multi-pane terminals, those can be added in phase 2.
