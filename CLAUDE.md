# FJ AI Worker

Read `docs/ROADMAP.md` first. It holds the current state, the rules that always apply, how to run, check,
build and release, where things live, and what to do next.

The rules that matter most:

- **bf9-application:** test only from the latest `develop`. Never merge. Never touch the user's own checkout.
- **TMA-TH repos:** pushing or opening a PR needs the user's OK each time.
- **Secrets:** never print tokens or secrets.
- **This repo:** commit and push as you go with `git -c http.https://github.com/.proxy= push`.
- **Before committing:** run the checks — `web`: `npx tsc --noEmit && npx eslint .`; `desktop`: `npx tsc --noEmit -p . && npx vitest run`.
- **Language:** reply to the user in Thai; write code, commits and docs in English.
- **Roadmap:** when something on the roadmap is done or newly decided, update `docs/ROADMAP.md` in the same commit.
