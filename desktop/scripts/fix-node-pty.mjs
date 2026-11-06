// node-pty's prebuilt spawn-helper (macOS) arrives from npm without its
// execute bit, and every terminal then fails with "posix_spawnp failed".
// Run after install (package.json postinstall); the packaged app keeps the
// bit it had here.
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'node_modules', 'node-pty', 'prebuilds');
for (const dir of fs.existsSync(root) ? fs.readdirSync(root) : []) {
  const helper = path.join(root, dir, 'spawn-helper');
  if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
}
