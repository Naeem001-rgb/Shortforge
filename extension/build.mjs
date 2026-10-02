import { build } from 'esbuild';
import { mkdir, cp, rm, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const dashboard = fileURLToPath(new URL('../dashboard', import.meta.url));
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/background.ts', 'src/content.ts', 'src/popup.ts'], outdir: 'dist', bundle: true, target: 'chrome120', format: 'iife' });
await cp('static', 'dist', { recursive: true });
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-b'], { cwd: dashboard, stdio: 'inherit' });
execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--base=./', '--outDir=../extension/dist/studio', '--emptyOutDir'], { cwd: dashboard, stdio: 'inherit' });
// Vite preserves the early theme bootstrap. Externalize it for strict MV3 CSP.
let html = await readFile('dist/studio/index.html', 'utf8');
let scriptIndex = 0;
for (const match of [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]) {
  const filename = `bootstrap-${scriptIndex++}.js`;
  await writeFile(`dist/studio/${filename}`, match[1]);
  html = html.replace(match[0], `<script src="./${filename}"></script>`);
}
await writeFile('dist/studio/index.html', html);
console.log('Scout and Studio built. Load extension/dist in chrome://extensions. Only the local engine is required.');
