export const normalize = text => String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export const metadataKeys = ['name', 'id', 'autocomplete', 'label', 'aria-label'];
export function cleanMetadata(raw) {
  const result = {};
  for (const key of metadataKeys) {
    if (typeof raw?.[key] === 'string') result[key] = raw[key].slice(0, 256);
  }
  return result;
}
export function cosineSimilarity(a, b) {
  if (!a?.length || a.length !== b?.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) return 0;
    dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i];
  }
  return aa && bb ? Math.max(-1, Math.min(1, dot / Math.sqrt(aa * bb))) : 0;
}
export function exactMatch(metadata, entries) {
  const clean = cleanMetadata(metadata);
  // A month/year pair often shares a label such as "Start Date". Its individual
  // control name or ID identifies the component more precisely than that label.
  for (const key of ['name', 'id', 'autocomplete', 'aria-label', 'label']) {
    const token = normalize(clean[key]); if (!token) continue;
    const matches = entries.filter(entry => entry.aliases.some(alias => normalize(alias) === token));
    if (matches.length) return matches.length === 1 ? matches[0] : undefined;
  }
  return undefined;
}
export function originOf(url) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('UNSUPPORTED_SITE');
  }
  return parsed.origin;
}
export function sitePattern(origin) {
  const url = new URL(originOf(origin));
  return `${url.protocol}//${url.hostname}/*`;
}
