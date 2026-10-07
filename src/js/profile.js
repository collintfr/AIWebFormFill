// Only authenticated legacy vaults reach this conversion. Plaintext backups stay rejected.
export const uid = () => crypto.randomUUID();
export const emptyProfile = () => ({ version: 2, groups: [] });
export const attribute = (label = '', value = '', aliases = []) => ({ id: uid(), label, value, aliases });
export const record = (label = 'New record') => ({ id: uid(), label, attributes: [], records: [] });
export const group = (label = 'New group') => ({ id: uid(), label, records: [] });
const object = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const text = (value, max) => typeof value === 'string' && value.length <= max;
const aliasesValid = aliases => Array.isArray(aliases) && aliases.length <= 100 &&
  aliases.every(alias => text(alias, 256) && alias.trim());

export function validateProfile(input) {
  if (!object(input)) throw new Error('INVALID_PROFILE');
  let profile = input;
  if (input.version !== 2) {
    const values = Object.entries(input);
    if (values.length > 1000 || values.some(([value, aliases]) => !value || !text(value, 20000) || !aliasesValid(aliases))) {
      throw new Error('INVALID_PROFILE');
    }
    profile = emptyProfile();
    if (values.length) {
      const loose = group('Ungrouped'); const item = record('Saved values');
      item.attributes = values.map(([value, aliases]) => attribute(aliases[0] || 'Value', value, aliases));
      loose.records.push(item); profile.groups.push(loose);
    }
  }
  const ids = new Set(); let leaves = 0; let nodes = 0;
  function node(value, keys) {
    if (!object(value) || Object.keys(value).some(key => !keys.includes(key)) ||
        !text(value.id, 100) || !value.id || ids.has(value.id) || !text(value.label, 256) || ++nodes > 2000) {
      throw new Error('INVALID_PROFILE');
    }
    ids.add(value.id);
  }
  function visit(item, depth) {
    node(item, ['id', 'label', 'attributes', 'records']);
    if (depth > 8 || !Array.isArray(item.attributes) || !Array.isArray(item.records)) throw new Error('INVALID_PROFILE');
    for (const leaf of item.attributes) {
      node(leaf, ['id', 'label', 'value', 'aliases']);
      if (++leaves > 1000 || !text(leaf.value, 20000) || !aliasesValid(leaf.aliases)) throw new Error('INVALID_PROFILE');
    }
    item.records.forEach(child => visit(child, depth + 1));
  }
  if (Object.keys(profile).some(key => !['version', 'groups'].includes(key)) || !Array.isArray(profile.groups)) throw new Error('INVALID_PROFILE');
  for (const collection of profile.groups) {
    node(collection, ['id', 'label', 'records']);
    if (!Array.isArray(collection.records)) throw new Error('INVALID_PROFILE');
    collection.records.forEach(item => visit(item, 1));
  }
  if (JSON.stringify(profile).length > 1000000) throw new Error('INVALID_PROFILE');
  return structuredClone(profile);
}

export function flattenProfile(profile) {
  const entries = []; const records = [];
  function visit(item, parentId, path) {
    const display = [...path, item.label];
    records.push({ id: item.id, parentId, label: display.join(' / ') });
    for (const leaf of item.attributes) entries.push({ ...leaf, recordId: item.id,
      path: [...display, leaf.label].join(' / '), aliases: [...new Set([leaf.label, ...leaf.aliases].filter(Boolean))] });
    item.records.forEach(child => visit(child, item.id, display));
  }
  profile.groups.forEach(collection => collection.records.forEach(item => visit(item, null, [collection.label])));
  return { entries, records };
}

export function findAttribute(profile, id) {
  function visit(item) {
    return item.attributes.find(leaf => leaf.id === id) || item.records.map(visit).find(Boolean);
  }
  return profile.groups.flatMap(collection => collection.records).map(visit).find(Boolean);
}

export function duplicate(item) {
  const copy = structuredClone(item);
  function renew(node) { node.id = uid(); node.attributes?.forEach(renew); node.records?.forEach(renew); }
  renew(copy); return copy;
}

export function educationGroup() {
  const collection = group('Education'); const degree = record('School — degree');
  degree.attributes = [attribute('School', '', ['school', 'institution', 'university']),
    attribute('Country', '', ['country', 'institution country', 'school country']),
    attribute('City', '', ['city', 'institution city', 'school city']),
    attribute('State', '', ['state', 'province', 'state province', 'school state']),
    attribute('Level of study', '', ['level of study', 'study level', 'education level']),
    attribute('Degree', '', ['degree', 'degree received', 'degree anticipated', 'degree received/anticipated']),
    attribute('GPA', '', ['gpa', 'overall/cumulative gpa', 'cumulative gpa', 'overall gpa', 'grade point average']),
    attribute('GPA scale', '', ['gpa scale', 'grading scale', 'grade point average scale']),
    attribute('Class rank', '', ['class rank', 'class ranking']),
    attribute('Class size', '', ['class size', 'graduating class size']),
    attribute('Awards', '', ['awards', 'award', 'honors', 'honours', 'academic awards', 'honors and awards', 'scholarships'])];
  for (const [name, label, aliases] of [
    ['Major 1', 'Major', ['major', 'primary major', 'field of study']],
    ['Major 2', '2nd Major', ['2nd major', 'second major', 'major 2', 'secondary major']],
    ['Minor 1', 'Minor', ['minor', 'primary minor']],
    ['Minor 2', '2nd Minor', ['2nd minor', 'second minor', 'minor 2', 'secondary minor']]
  ]) {
    const detail = record(name); detail.attributes = [attribute(label, '', aliases)]; degree.records.push(detail);
  }
  for (const [name, prefix, alternate] of [
    ['Start date', 'Start', 'Enrollment'], ['End date', 'End', 'Attendance end'],
    ['Graduation / expected graduation', 'Graduation', 'Expected graduation']
  ]) {
    const detail = record(name);
    detail.attributes = [
      attribute(`${prefix} month`, '', [`${prefix} month`, `${prefix} date month`, `${alternate} month`, `${alternate} date month`]),
      attribute(`${prefix} year`, '', [`${prefix} year`, `${prefix} date year`, `${alternate} year`, `${alternate} date year`, ...(prefix === 'Graduation' ? ['year of graduation'] : [])]),
      attribute(`${prefix} date`, '', [`${prefix} date`, `${alternate} date`, ...(prefix === 'Graduation' ? ['graduation date / expected graduation date'] : [])])
    ];
    degree.records.push(detail);
  }
  collection.records.push(degree); return collection;
}
