# FJ AI Worker — roadmap and handoff

The state of the project, how to work on it, and what comes next, so that any session can pick
the work up. Updated 2026-11-07, after **1.0.0**.

## Where it stands

**1.0.0 is released** (2026-11-07). It is tag `v1.0.0`, with a GitHub release on
`nnsitem/FJ-ai-worker` carrying `FJ-AI-Worker-1.0.0-arm64.dmg`. It runs on Apple Silicon only
and is ad-hoc signed.

| Milestone | State |
|---|---|
| M1 | Done: shell, VPN, GitHub and Claude sign-in. |
| M2 | Done: tickets, entered by hand (Jira is on hold). |
| M3 | Done: steps 1–3 (analyse → plan → human review of the plan). |
| M4 | Done: steps 4–5 (fix → tests with baseline and failure sorting). |
| M5 | Done: step 5½ AI review, step 6 draft PR after your go, and step 7 PR review (fixes comments, delete branch). |
| M6 | Partly done: the macOS arm64 installer. Not done: Intel, Windows and auto-update. |
| Copilot | Done: GitHub Copilot as a second engine, with its own sign-in. The full flow 1–7 was tested on bf9-application (PR #801). |
| UI | Done: AI Office's design system ported. Pages: Tasks (like Sessions), Workflow board with minimap and step settings, Artifacts, Agents & skills, Project context, Connections, Settings, terminal dock. Brand logos. |

Verified for real:
- Draft PR #799 (Claude) and PR #801 (Copilot) on TMA-TH/bf9-application. Both were closed and their branches deleted.
- The packaged app, checked: VPN from the in-app terminal, GitHub through the VPN, Claude and Copilot turns, Copilot remembering an earlier turn, and the terminal.

## Rules that always apply

- **bf9-application** is at `/Users/metisn/Workspace/Fujitsu/RPPMS/bf9-application`.
  - Test only from the latest `develop`. **Never merge.** PRs are drafts, and the user closes them.
  - Never touch the user's checkout. It is on its own branch, with local changes.
  - The app works in its own worktree under `<data>/worktrees/<task id>`.
- **Pushing to TMA-TH or opening a PR needs the user's OK each time.** The workflow's `pr.confirm` gate exists for this.
- **Never print secrets or tokens.**
  - The PAT embedded in bf9's `origin` URL leaked into a log once. Treat it as burnt and don't use it.
  - Secrets are sealed in `<data>/secrets.json` (safeStorage).
- **Commit and push this repo as you go**: `git -c http.https://github.com/.proxy= push`.
  - The remote URL carries `nnsitem@`, whose credential is in the macOS keychain.
  - The `gh` CLI is signed in as the company account (`metis-nak-fth_onero`), which gets a 403 here. Use the API with the keychain credential instead (see Release).
- Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Reply to the user in Thai. The code, commits and docs are in English.
- Don't kill `/Applications/AI Office.app`. It is a different app; this one is fully separate from AI Office and shares no code at runtime.

## Run, check, build, release

```sh
# dev
cd desktop && npm run build                 # main (esbuild) + UI (next export) — or build:main / build:renderer
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . --remote-debugging-port=9334

# checks (all must pass before a commit)
cd web && npx tsc --noEmit && npx eslint .
cd desktop && npx tsc --noEmit -p . && npx vitest run      # 37 tests

# installer
cd desktop && npm run package:mac            # → desktop/release/FJ-AI-Worker-<version>-arm64.dmg (gitignored)
```

- **Driving the running app** (dev or packaged): connect over CDP on port 9334.
  - `window.aiWorker.<call>(…)` returns `{ok, value}` or `{ok: false, error}`.
  - Take screenshots through CDP's `Page.captureScreenshot`. It hangs while the window is hidden.
  - AI Office's dev app uses 9333.
- **Data** lives in `~/Library/Application Support/FJ AI Worker`. Dev and packaged share it, so quit one before starting the other (single-instance lock).
- **Release:**
  1. Bump `desktop/package.json` `version`, commit, then `git tag -a vX.Y.Z` and push `--follow-tags`.
  2. Create the release and upload the .dmg through the GitHub API, with the token from `git credential fill` (host github.com, username nnsitem), passed through the environment and never echoed.
  3. Parse the response with Python, not zsh `echo`, which mangles JSON.
  4. Release notes describe what the user gets.

## How it's built (where to look)

- **`core/src/`** — logic with no Electron in it.
  - `runs.ts` — the task engine: steps, chat, Claude/Copilot turns, subagent tracking, tests, AI review, PR, PR review.
    - Every step does `claim(r)` (an AbortController in `live`), then `live.delete`, then `void nextStep(r)`.
    - `conversation(r)` gives the current engine's own session (Claude's `sessionId`, or `copilotSessionId`).
  - `copilot.ts` — the Copilot SDK runtime (one client), its sign-in (`session.rpc.accounts.login`), and `copilotTurn` (the permission handler enforces the same rules as Claude's).
    - A runtime restart is refused while turns are running.
  - `processes.ts` — runs test commands in their own process group; `sweep` kills leftover processes in a task's folder on Stop and on delete. The in-app terminals are protected from it.
  - `network.ts` — VPN status and Disconnect, PAC routing, `toolEnv`.
  - `socks-bridge.ts` — an HTTP CONNECT proxy to the SOCKS tunnel, used by Copilot.
  - `repos.ts` — clones and worktrees. git gets config and the token through `GIT_CONFIG_*` env, never through argv.
  - `pull-requests.ts`, `github.ts`, `claude-account.ts` (isolated `CLAUDE_CONFIG_DIR`), `settings.ts`, `secrets.ts`, `library.ts` (agents and skills), `project-context.ts`, `artifacts.ts`, `jira.ts`/`adf.ts` (built, but unused until Jira is allowed).
- **`desktop/src/`** — Electron.
  - `main.ts` — the app:// protocol, the bundled Claude binary, and the unpacked Copilot runtime (`COPILOT_CLI_PATH`).
  - `ipc.ts` + `channels.json` + `preload.cjs` — every channel. Add a channel in all three plus `web/src/lib/bridge.ts`.
  - `terminal.ts` — node-pty terminals. The VPN script runs under `trap '' HUP`, so the tunnel survives.
- **`web/src/`** — the Next.js 16 static export. Read `web/node_modules/next/dist/docs/` before using a Next.js API; it differs from older versions.
  - `app/<page>/` — the pages.
  - `components/` — the UI pieces.
  - `components/icons.tsx` — Solar icons, plus brand marks from Simple Icons (CC0).
  - `app/styles/` — AI Office's `ao-` design system. App-specific CSS goes in `worker.css`.
- **Packaging** — `desktop/electron-builder.yml`. Both SDKs and node-pty are `asarUnpack`ed. Only the arm64 platform packages are installed.

## Next — in order of value

1. **A real ticket: BF9MAINPU2-67** on bf9-application, from the latest `develop` (a draft PR, never merged).
   - Needs from the user: the ticket text, and the build/test commands (e.g. `mvn -q compile` / `mvn -q test`).
   - Not yet seen live:
     - The "environment" failure sorting.
     - Fixing PR review comments and pushing to the same PR (step 7), on Claude and on Copilot.
     - The secret block.
2. **Workflow improvements:**
   - **Wait for CI** (GitHub Actions) after the draft PR: green → Ready for review; red → back to the fix.
   - **Reproduce first:** a failing test for the bug before the fix.
   - **Risk-based plan review:** DB schema, migrations and permissions always need a person, even with review off.
   - **Rebase/conflict check** against `develop` before pushing.
3. **Installers, continued (M6):**
   - Intel build: install the x64 platform packages of `@anthropic-ai/claude-agent-sdk-*` and `@github/copilot-sdk-*`, then build per arch.
   - Windows: the VPN script is macOS-only, and node-pty needs a rebuild.
   - Auto-update from this repo's GitHub Releases. The repo is private, so it needs a token or a public release feed.
   - Developer ID signing and notarisation, if one becomes available.
4. **Copilot follow-ups:**
   - Copilot isn't shown in the top-bar readiness pill.
   - Only one engine per task; per step (e.g. Copilot fixes, Claude reviews) isn't possible.
   - Ephemeral turns (the AI review) don't show their subagents.
5. **Jira — needs the owner's permission and an API token** (email `metis_nak_fth@toyota-asia.com`, site `https://tdem.atlassian.net`):
   - Move tickets to In progress / Review automatically.
   - A ticket readiness check that asks back in the ticket.
   - Comment on the ticket: plan, PR link, test results.
   - Pull tickets straight in. The code is in `core/src/jira.ts`.
6. **Loose ends:**
   - The user should revoke the token in bf9-application's `origin` URL.
   - Some imported skills reference ai-tools repo files that weren't copied.
   - Chat has no attachments and no rewind.
   - A Copilot turn whose resume fails falls back to a new session, without the task's brief.

## Gotchas learnt the hard way

- **Copilot sign-in:**
  - Copilot refuses classic PATs ("Personal Access Tokens are not supported").
  - Its sign-in is its own OAuth: `accounts.login.begin({kind: 'githubDotCom'})` opens a URL, then `advance` until `completed`.
  - `sendAndWait(…, 0)` times out at once; give it a real limit.
- **Packaged Copilot:** the SDK resolves its runtime inside `app.asar` and fails with ENOTDIR. `main.ts` passes the unpacked path through `setCopilotRuntime`.
- **Stopping a step:** killing only the shell leaves `mvn`, a JVM or a dev server running. Use `runInGroup` or `sweep`. Claude Code may also background a command itself and end its turn.
- **VPN script:** its ssh `-f` outlives the script. Disconnect kills the ssh that listens on the SOCKS port, and nothing else. The script's global git proxy (`http.https://github.com/.proxy`) stays, so git to github.com outside the app needs the VPN.
- **GitHub on TMA-TH:** needs SSO authorisation of the token (done 2026-11-07). The status check uses `HEAD github.com`; the API rate-limits the company's shared VPN address.
- **Linked local folders:** the app makes a worktree from `origin/<base>`; the person's checkout is untouched. Pushes use the app's token through extraheader in the env.
