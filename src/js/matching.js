import { normalize } from './utils.js';

export function allowedEntries(entries, records, recordId, nestedRecordIds = []) {
  const descendants = new Set();
  function descend(id) { for (const child of records.filter(item => item.parentId === id)) { descendants.add(child.id); descend(child.id); } }
  if (!records.some(item => item.id === recordId)) return [];
  descend(recordId);
  if (nestedRecordIds.some(id => !descendants.has(id))) return [];
  return entries.filter(entry => entry.value && (entry.recordId === recordId || nestedRecordIds.includes(entry.recordId)));
}

// Return the exact destination representation, or null when it needs manual handling.
export function destinationValue(field, entries, separator = null) {
  if (!entries.length || entries.some(entry => !entry.value)) return null;
  const values = entries.map(entry => entry.value);
  if (field.type === 'select-one' || field.type === 'select-multiple') {
    if (field.type === 'select-one' && values.length !== 1) return null;
    const options = values.map(value => {
      const exact = field.options.filter(option => !option.disabled && option.value && (option.value === value || option.label === value));
      const matches = exact.length ? exact : field.options.filter(option => !option.disabled && option.value &&
        (normalize(option.value) === normalize(value) || normalize(option.label) === normalize(value)));
      return matches.length === 1 ? matches[0] : null;
    });
    if (options.some(option => !option) || new Set(options.map(option => option.id)).size !== options.length) return null;
    return { value: options.map(option => option.value).join(', '), optionIds: options.map(option => option.id) };
  }
  if (values.length > 1 && (typeof separator !== 'string' || !separator || separator.length > 32)) return null;
  const value = values.join(separator ?? '');
  if (value.length > 20000) return null;
  if (['date', 'month'].includes(field.type)) {
    if (values.length !== 1 || !/^\d{4}-\d{2}(?:-\d{2})?$/.test(value) || Number(value.slice(0, 4)) === 0) return null;
    const date = new Date(`${value}${field.type === 'month' ? '-01' : ''}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, field.type === 'month' ? 7 : 10) !== value) return null;
  }
  return { value };
}
