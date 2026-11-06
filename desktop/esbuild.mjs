import { build } from 'esbuild';
import { cp } from 'node:fs/promises';

// The agent SDK runs a platform-specific `claude` binary from next to itself,
// and node-pty is a native addon — neither survives being inlined; both stay
// in node_modules.
const EXTERNAL = ['electron', '@anthropic-ai/claude-agent-sdk', 'node-pty'];

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: EXTERNAL,
  sourcemap: true,
  logLevel: 'info',
});

// Preload is plain CommonJS, copied as written; it reads channels.json beside it.
await cp('src/preload.cjs', 'dist/preload.cjs');
await cp('src/channels.json', 'dist/channels.json');
