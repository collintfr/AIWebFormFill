import { describe, expect, it } from 'vitest';
import { cleanMetadata, cosineSimilarity, exactMatch, originOf, sitePattern } from '../src/js/utils.js';
describe('Safe field matching', () => {
  it('excludes arbitrary attributes, values and HTML and bounds text', () => {
    expect(cleanMetadata({ name: 'fullName', label: 'x'.repeat(500), value: 'private',
      'data-applicant': 'private', outerHTML: 'private', selector: 'private' })).toEqual({ name: 'fullName', label: 'x'.repeat(256) });
  });
  it('handles zeros, negative vectors, nonfinite entries and invalid dimensions', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([1, -1], [-1, 1])).toBeCloseTo(-1);
    expect(cosineSimilarity([1, 2], [1, 2])).toBeCloseTo(1);
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
    expect(cosineSimilarity([NaN], [1])).toBe(0);
  });
  it('normalizes allowed metadata and never matches data-*', () => {
    const entry = { id: 'a', aliases: ['Full Name'] };
    expect(exactMatch({ name: 'full_name' }, [entry])).toBe(entry);
    expect(exactMatch({ 'data-token': 'Full Name' }, [entry])).toBeUndefined();
  });
  it('keeps exact origins and refuses credentials and unsupported protocols', () => {
    expect(originOf('https://10.attacker.example/path')).toBe('https://10.attacker.example');
    expect(originOf('http://127.0.0.1:9000/form')).toBe('http://127.0.0.1:9000');
    expect(sitePattern('http://127.0.0.1:9000')).toBe('http://127.0.0.1/*');
    expect(() => originOf('https://user:secret@example.com')).toThrow();
    expect(() => originOf('file:///secret')).toThrow();
  });
});
