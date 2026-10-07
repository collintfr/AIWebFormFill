// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
const { extract } = vi.hoisted(() => ({ extract: vi.fn(async () => ({ data: [1, 0] })) }));
vi.mock('@huggingface/transformers', () => ({ env: { backends: { onnx: { wasm: {} } } }, pipeline: vi.fn(async () => extract) }));
vi.mock('../src/js/model-store.js', () => ({ manifest: { model: 'synthetic-model' }, localModelFetch: vi.fn() }));

describe('Inference respects explicit degree assignments', () => {
  async function match(fields, entries) {
    vi.resetModules();
    const postMessage = vi.fn(); globalThis.self = { postMessage };
    await import('../src/js/inference-worker.js');
    try { await self.onmessage({ data: { fields, entries } }); return postMessage.mock.calls[0][0]; }
    finally { delete globalThis.self; }
  }
  it('restricts exact matches to the assigned degree even when aliases are identical', async () => {
    const result = await match([{ id: 'gpa', entryIds: ['degree-b-gpa'], metadata: { label: 'GPA' } }],
      [{ id: 'degree-a-gpa', aliases: ['GPA'] }, { id: 'degree-b-gpa', aliases: ['GPA'] }]);
    expect(result.matches).toEqual([{ fieldId: 'gpa', entryId: 'degree-b-gpa', similarity: 1 }]);
  });
  it('restricts semantic matches to the assigned degree', async () => {
    const result = await match([{ id: 'score', entryIds: ['degree-b-gpa'], metadata: { label: 'Academic score' } }],
      [{ id: 'degree-a-gpa', aliases: ['Grade point average'] }, { id: 'degree-b-gpa', aliases: ['Grade point average'] }]);
    expect(result.matches[0].entryId).toBe('degree-b-gpa');
  });
  it('leaves exact collisions and semantic ties for explicit major selection', async () => {
    const result = await match([{ id: 'major', entryIds: ['major-a', 'major-b'], metadata: { label: 'Major' } },
      { id: 'study', entryIds: ['major-a', 'major-b'], metadata: { label: 'Academic concentration' } }],
    [{ id: 'major-a', aliases: ['Major'] }, { id: 'major-b', aliases: ['Major'] }]);
    expect(result.matches).toEqual([]);
  });
  it('does not initialize inference for unassigned fields', async () => {
    extract.mockClear(); const result = await match([{ id: 'score', entryIds: [], metadata: { label: 'Academic score' } }], [{ id: 'gpa', aliases: ['GPA'] }]);
    expect(result.matches).toEqual([]); expect(extract).not.toHaveBeenCalled();
  });
});
