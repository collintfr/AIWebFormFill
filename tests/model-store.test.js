// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifiedBytes, localModelFetch, downloadModel, modelReady, manifest, cacheName, assetUrl } from '../src/js/model-store.js';
describe('Model network and cache boundary', () => {
  beforeEach(() => {
    globalThis.caches = { open: vi.fn(async () => ({ match: vi.fn(async () => undefined), put: vi.fn(async () => {}) })), delete: vi.fn(async () => true) };
    globalThis.fetch = vi.fn();
  });
  it('accepts only exact-size, SHA-256-authenticated assets', async () => {
    const bytes = new TextEncoder().encode('synthetic asset');
    const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
    const file = { size: bytes.length, sha256 };
    expect(await verifiedBytes(new Response(bytes), file)).toEqual(bytes);
    await expect(verifiedBytes(new Response('corrupt'), file)).rejects.toThrow('MODEL_INTEGRITY_FAILED');
    await expect(verifiedBytes(new Response('synthetic asset with extras'), file)).rejects.toThrow('MODEL_INTEGRITY_FAILED');
    await expect(verifiedBytes(new Response('synthetic asseX'), file)).rejects.toThrow('MODEL_INTEGRITY_FAILED');
  });
  it('never falls back to network for missing models or unknown local paths', async () => {
    const base = 'moz-extension://fixture/';
    await expect(localModelFetch(base, assetUrl(base, manifest.files[0].path))).rejects.toThrow('MODEL_SETUP_REQUIRED');
    expect((await localModelFetch(base, 'https://attacker.example/model')).status).toBe(404);
    expect((await localModelFetch(base, `${base}models/unlisted.json`)).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
    expect(await modelReady(base)).toBe(false);
  });
  it('downloads only a fixed public GET with omitted credentials and referrer', async () => {
    fetch.mockResolvedValue({ url: 'https://attacker.example/payload' });
    const signal = new AbortController().signal;
    await expect(downloadModel('moz-extension://fixture/', signal)).rejects.toThrow('MODEL_DESTINATION_BLOCKED');
    expect(fetch).toHaveBeenCalledExactlyOnceWith(manifest.files[0].url, {
      signal: expect.any(AbortSignal), credentials: 'omit', referrerPolicy: 'no-referrer'
    });
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('Applicant Example');
    expect(caches.delete).toHaveBeenCalledWith(cacheName);
  });
  it('rejects corrupt downloads and removes incomplete caches', async () => {
    const response = new Response('corrupt');
    Object.defineProperty(response, 'url', { value: manifest.files[0].url });
    fetch.mockResolvedValue(response);
    await expect(downloadModel('moz-extension://fixture/', new AbortController().signal)).rejects.toThrow('MODEL_INTEGRITY_FAILED');
    expect(caches.delete).toHaveBeenCalledWith(cacheName);
  });
  it('cancellation and network failure leave no incomplete model', async () => {
    const abort = new AbortController(); abort.abort();
    fetch.mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
    await expect(downloadModel('moz-extension://fixture/', abort.signal)).rejects.toThrow();
    expect(caches.delete).toHaveBeenCalledWith(cacheName);
  });
});
