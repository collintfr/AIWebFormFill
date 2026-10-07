import manifest from './model-manifest.json';
export { manifest };
export const cacheName = `ai-fill-model-${manifest.revision}`;
export const downloadHosts = ['huggingface.co', 'cas-bridge.xethub.hf.co', 'cdn-lfs.huggingface.co', 'cdn-lfs-us-1.hf.co', 'us.aws.cdn.hf.co'];
export const downloadOrigins = downloadHosts.map(host => `https://${host}/*`);
export const assetUrl = (base, path) => `${base}models/${manifest.model}/${path}`;
// Cache.put accepts HTTP(S) keys, not moz-extension URLs. These names are lookup
// keys only: no request is ever sent to this reserved .invalid host.
const cacheUrl = path => `https://ai-form-fill-model.invalid/${manifest.revision}/${path}`;
export async function verifiedBytes(response, file) {
  if (!response?.ok) throw new Error('MODEL_DOWNLOAD_FAILED');
  const reader = response.body.getReader();
  const bytes = new Uint8Array(file.size);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.length > file.size) throw new Error('MODEL_INTEGRITY_FAILED');
      bytes.set(value, offset); offset += value.length;
    }
  } catch (error) { await reader.cancel(); throw error; }
  if (offset !== file.size) throw new Error('MODEL_INTEGRITY_FAILED');
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    byte => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== file.sha256) throw new Error('MODEL_INTEGRITY_FAILED');
  return bytes;
}
export async function modelReady(base) {
  const cache = await caches.open(cacheName);
  for (const file of manifest.files) {
    if (!await cache.match(cacheUrl(file.path))) return false;
  }
  return true;
}
export async function downloadModel(base, signal, progress = () => {}) {
  const cache = await caches.open(cacheName);
  try {
    for (let i = 0; i < manifest.files.length; i++) {
      const file = manifest.files[i];
      progress(`Downloading file ${i + 1} of ${manifest.files.length}`);
      const response = await fetch(file.url, { signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
        credentials: 'omit', referrerPolicy: 'no-referrer' });
      // CSP also limits intermediate redirect destinations. Only public, fixed GETs are used.
      const final = new URL(response.url);
      if (final.protocol !== 'https:' || !downloadHosts.includes(final.hostname)) throw new Error('MODEL_DESTINATION_BLOCKED');
      const bytes = await verifiedBytes(response, file);
      if (signal.aborted) throw new Error('MODEL_DOWNLOAD_CANCELLED');
      await cache.put(cacheUrl(file.path), new Response(bytes, { headers: {
        'Content-Type': file.path.endsWith('.json') ? 'application/json' : 'application/octet-stream'
      } }));
    }
    progress('Model ready for offline matching.');
  } catch (error) {
    await caches.delete(cacheName);
    if (signal.aborted) throw new Error('MODEL_DOWNLOAD_CANCELLED');
    if (error.name === 'TimeoutError') throw new Error('MODEL_DOWNLOAD_TIMED_OUT');
    if (['MODEL_INTEGRITY_FAILED', 'MODEL_DESTINATION_BLOCKED', 'MODEL_DOWNLOAD_FAILED', 'MODEL_DOWNLOAD_CANCELLED'].includes(error.message)) throw error;
    throw new Error('MODEL_DOWNLOAD_FAILED');
  }
}
export async function localModelFetch(base, input) {
  const url = typeof input === 'string' ? input : input.url;
  const file = manifest.files.find(file => assetUrl(base, file.path) === url);
  if (!file) return new Response('', { status: 404 });
  const response = await (await caches.open(cacheName)).match(cacheUrl(file.path));
  if (!response) throw new Error('MODEL_SETUP_REQUIRED');
  const bytes = await verifiedBytes(response, file);
  return new Response(bytes, { headers: response.headers });
}
