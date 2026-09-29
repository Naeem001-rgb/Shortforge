import { build } from 'esbuild';
import { mkdir, cp } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/background.ts', 'src/content.ts', 'src/popup.ts'], outdir: 'dist', bundle: true, target: 'chrome120', format: 'iife', sourcemap: true });
await cp('static', 'dist', { recursive: true });
console.log('Scout built. Load extension/dist in chrome://extensions.');
