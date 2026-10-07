import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
await rm('dist', { recursive: true, force: true });
for (const browser of ['firefox', 'chrome']) {
  const dir = `dist/${browser}`;
  await mkdir(`${dir}/js`, { recursive: true });
  await cp('src/img', `${dir}/img`, { recursive: true });
  await cp('src/css/options.css', `${dir}/css/options.css`, { recursive: true });
  for (const page of ['options.html', 'preview.html']) await cp(`src/${page}`, `${dir}/${page}`);
  await cp(`${browser === 'firefox' ? 'Firefox' : 'Chrome'}/manifest.json`, `${dir}/manifest.json`);
  for (const entry of ['background.js', 'content.js', 'js/options.js', 'js/preview.js', 'js/inference-worker.js']) {
    await build({ entryPoints: [`src/${entry}`], outfile: `${dir}/${entry}`, bundle: true,
      format: entry.includes('inference-worker') ? 'esm' : 'iife', platform: 'browser',
      target: ['firefox128', 'chrome120'], legalComments: 'eof', minify: true,
      conditions: ['browser'], define: { 'process.env.NODE_ENV': '"production"' } });
  }
  await mkdir(`${dir}/runtime`, { recursive: true });
  // Executable runtime files are packaged, never fetched from a CDN.
  for (const file of await readdir('node_modules/onnxruntime-web/dist')) {
    if (/^ort-wasm.*\.(wasm|mjs)$/.test(file)) await cp(join('node_modules/onnxruntime-web/dist', file), `${dir}/runtime/${file}`);
  }
  const license = await readFile('node_modules/@huggingface/transformers/LICENSE', 'utf8');
  const ortLicense = await readFile('src/licenses/ONNX-Runtime.txt', 'utf8');
  const jinjaLicense = await readFile('node_modules/@huggingface/jinja/LICENSE', 'utf8');
  const tokenizerLicense = await readFile('node_modules/@huggingface/tokenizers/LICENSE', 'utf8');
  await writeFile(`${dir}/THIRD_PARTY_LICENSES.txt`, `Transformers.js\n${license}\nONNX Runtime\n${ortLicense}\nHugging Face Jinja\n${jinjaLicense}\nHugging Face Tokenizers\n${tokenizerLicense}`);
  execFileSync('zip', ['-qr', `../${browser}.zip`, '.'], { cwd: dir });
}
console.log('Built dist/firefox, dist/chrome and their ZIP packages.');
