# Backlog (noted 2026-11-07, not started)

1. **Real ticket run** — BF9MAINPU2-67 on bf9-application from latest `develop` (draft PR, never merge). Needs: ticket text, build/test commands (e.g. `mvn -q compile` / `mvn -q test`). Not yet seen live: "environment" failure sorting, Claude fixing PR review comments and pushing to the same PR, secret block.
2. **Workflow ideas not done**
   - Reproduce first: Claude writes a failing test for the bug before fixing.
   - Wait for CI (GitHub Actions) after the draft PR; green → Ready for review; red → back to the fix.
   - Risk-based plan review: DB schema / migration / permissions always need a person, even with review off.
   - Rebase / conflict check against `develop` before pushing.
3. **Needs Jira (owner's permission + API token)** — In progress when work starts; ticket readiness check (ask back in the ticket); comments to the ticket (plan, PR link, test results); tickets pulled straight in.
4. **M6 installers** — build .dmg/.exe and check in the installed app: in-app terminal (node-pty), bundled Claude, the Copilot runtime (@github/copilot-sdk-<platform>, unpacked from asar), separate Claude and Copilot sign-ins, keychain tokens; auto-update (GitHub Releases of FJ-ai-worker?); Windows VPN (script is macOS only).
5. **Loose ends** — revoke the token embedded in bf9-application's origin URL (it showed up in a log); some imported skills reference ai-tools repo files not copied; chat has no attachments or rewind.
6. **Copilot follow-ups** (engine tested end to end 2026-11-07, PR #801) — not in the top-bar readiness pill; one engine per task (no per-step engine, e.g. Copilot fixes / Claude reviews); a Copilot review comment fix (step 7) not seen live.
