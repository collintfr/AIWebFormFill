import { env, pipeline } from '@huggingface/transformers';
import { manifest, localModelFetch } from './model-store.js';
import { cosineSimilarity, cleanMetadata, exactMatch } from './utils.js';

const base = new URL('../', import.meta.url).href;
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = `${base}models/`;
env.useBrowserCache = false;
env.useFSCache = false;
env.useWasmCache = false;
env.fetch = input => localModelFetch(base, input);
env.backends.onnx.wasm.wasmPaths = `${base}runtime/`;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
env.logLevel = 50;
let extractor;
let initializing;
const vectors = new Map();
async function vector(text) {
  if (vectors.has(text)) return vectors.get(text);
  initializing ??= pipeline('feature-extraction', manifest.model, { device: 'wasm', dtype: 'q8' });
  extractor ??= await initializing;
  const result = Array.from((await extractor(text, { pooling: 'mean', normalize: true })).data);
  if (vectors.size >= 2000) vectors.clear();
  vectors.set(text, result);
  return result;
}
self.onmessage = async ({ data }) => {
  try {
    const matches = [];
    // Embed each distinct alias once. Avoid cache thrashing on large profiles.
    let aliases;
    for (const field of data.fields) {
      const candidates = data.entries.filter(entry => !field.entryIds || field.entryIds.includes(entry.id));
      if (!candidates.length) continue;
      const direct = exactMatch(field.metadata, candidates);
      if (direct) { matches.push({ fieldId: field.id, entryId: direct.id, similarity: 1 }); continue; }
      // Exact collisions must remain explicit choices, even when the model is present.
      if (candidates.filter(entry => exactMatch(field.metadata, [entry])).length > 1) continue;
      if (!aliases) {
        const unique = [...new Set(data.entries.flatMap(entry => entry.aliases))];
        if (unique.length > 2000) throw new Error('MODEL_PROFILE_LIMIT');
        const byAlias = new Map();
        for (const alias of unique) byAlias.set(alias, await vector(alias));
        aliases = data.entries.flatMap(entry => entry.aliases.map(alias => ({ id: entry.id, vector: byAlias.get(alias) })));
      }
      let best = { fieldId: field.id, entryId: '', similarity: 0 };
      let second = 0;
      for (const text of Object.values(cleanMetadata(field.metadata)).filter(Boolean)) {
        const fieldVector = await vector(text);
        for (const alias of aliases) {
          if (!candidates.some(entry => entry.id === alias.id)) continue;
          const similarity = cosineSimilarity(fieldVector, alias.vector);
          if (similarity > best.similarity) {
            if (best.entryId !== alias.id) second = best.similarity;
            best = { fieldId: field.id, entryId: alias.id, similarity };
          } else if (best.entryId !== alias.id) second = Math.max(second, similarity);
        }
      }
      if (best.similarity - second >= 0.05) matches.push(best);
    }
    self.postMessage({ ok: true, matches });
  } catch { self.postMessage({ ok: false, error: 'LOCAL_MATCHING_UNAVAILABLE' }); }
};
