// Explicit maintenance command; never run automatically during install/build.
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const model = 'Xenova/all-MiniLM-L6-v2';
const revision = '751bff37182d3f1213fa05d7196b954e230abad9';
const files = [];
for (const path of ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'onnx/model_quantized.onnx']) {
  const url = `https://huggingface.co/${model}/resolve/${revision}/${path}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Model asset status ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  files.push({ path, url, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  console.log(`Pinned ${path}: ${bytes.length} bytes`);
}
await writeFile('src/js/model-manifest.json', `${JSON.stringify({ model, revision, files }, null, 2)}\n`);
