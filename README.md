# AI Worker

A desktop agent worker: takes a Jira Cloud ticket, has Claude Code analyse it,
plan, fix, test and open a GitHub pull request. One person, one machine — no
server, no shared database.

- `core/` — logic with no UI (network routing, GitHub, Claude account, …)
- `desktop/` — Electron main process, IPC, installers
- `web/` — the UI, a Next.js static export served over `app://`

## Run it

```sh
cd web && npm install
cd ../desktop && npm install
npm run build        # main process + UI
npx electron .       # or: npm start
```

## Networking

GitHub is only reachable through the company VPN's SOCKS tunnel (opened by
the VPN script, `127.0.0.1:1080` by default). The app routes the hosts in
Settings › VPN through it with a PAC script on its session, and everything
else direct. Tools the app runs get the same routing through their
environment (`core/src/network.ts` `toolEnv`).

## Claude account

AI Worker signs in to Claude with its own config folder
(`CLAUDE_CONFIG_DIR` = `<app data>/claude`) and an environment without the
shell's `ANTHROPIC_*` / `CLAUDE_*`, so the company account never mixes with
the Claude Code in your terminal. Data lives in
`~/Library/Application Support/AI Worker` (override: `AI_WORKER_DATA_DIR`).
