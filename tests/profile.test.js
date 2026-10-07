import { describe, expect, it, vi } from 'vitest';
import { attribute, record, group, emptyProfile, educationGroup, duplicate, validateProfile, flattenProfile } from '../src/js/profile.js';
import { allowedEntries, destinationValue } from '../src/js/matching.js';
import { exactMatch } from '../src/js/utils.js';
import { createProfileEditor } from '../src/js/profile-editor.js';

function education() {
  const profile = emptyProfile(); const collection = educationGroup(); profile.groups.push(collection);
  const first = collection.records[0]; first.label = 'Example University / BS'; first.attributes[0].value = 'Example University'; first.attributes.find(leaf => leaf.label === 'GPA').value = '3.8';
  first.records[0].attributes[0].value = 'Mathematics';
  const secondMajor = duplicate(first.records[0]); secondMajor.label = 'Major 2'; secondMajor.attributes[0].value = 'Physics'; first.records.push(secondMajor);
  const second = duplicate(first); second.label = 'Example University / MS'; second.attributes.find(leaf => leaf.label === 'GPA').value = '3.9'; collection.records.push(second);
  return { profile, first, second };
}
describe('Structured records and scoped matching', () => {
  it('preserves freeform multiline awards as one field belonging to the degree', () => {
    const profile = { version: 2, groups: [educationGroup()] }; const degree = profile.groups[0].records[0];
    const awards = degree.attributes.find(leaf => leaf.label === 'Awards');
    const text = 'Synthetic Academic Award\nExample scholarship — awarded for research'; awards.value = text;
    const { entries, records } = flattenProfile(validateProfile(profile));
    const match = exactMatch({ name: 'honorsAndAwards' }, allowedEntries(entries, records, degree.id));
    expect(match.id).toBe(awards.id); expect(destinationValue({ type: 'textarea' }, [match]).value).toBe(text);
    expect(degree.records.some(item => item.label === 'Awards')).toBe(false);
  });
  it('covers the education fields, split dates and ordinal majors/minors without ambiguous aliases', () => {
    const profile = { version: 2, groups: [educationGroup()] }; const degree = profile.groups[0].records[0];
    const all = degree.attributes.concat(degree.records.flatMap(item => item.attributes));
    const wanted = ['School', 'Country', 'City', 'State', 'Level of study', 'Degree', 'GPA', 'GPA scale', 'Class rank', 'Class size',
      'Major', '2nd Major', 'Minor', '2nd Minor', 'Start month', 'Start year', 'End month', 'End year', 'Graduation month', 'Graduation year'];
    expect(all.map(leaf => leaf.label)).toEqual(expect.arrayContaining(wanted));
    expect(validateProfile(profile)).toEqual(profile);
    all.forEach(leaf => { leaf.value = `Synthetic ${leaf.label}`; });
    const { entries, records } = flattenProfile(profile); const candidates = allowedEntries(entries, records, degree.id, degree.records.map(item => item.id));
    for (const [metadata, label] of [
      [{ label: 'Institution' }, 'School'], [{ label: 'Degree Received/Anticipated' }, 'Degree'],
      [{ label: 'Overall/Cumulative GPA' }, 'GPA'], [{ label: 'GPA Scale' }, 'GPA scale'],
      [{ label: '2nd Major' }, '2nd Major'], [{ label: '2nd Minor' }, '2nd Minor'],
      [{ label: 'Start Date', name: 'startDateMonth' }, 'Start month'],
      [{ label: 'Start Date', name: 'startDateYear' }, 'Start year'],
      [{ name: 'expectedGraduationMonth' }, 'Graduation month'], [{ name: 'expectedGraduationYear' }, 'Graduation year']
    ]) expect(exactMatch(metadata, candidates)?.label).toBe(label);
  });
  it('omits empty optional template values from matching candidates', () => {
    const profile = { version: 2, groups: [educationGroup()] }; const degree = profile.groups[0].records[0];
    degree.attributes[0].value = 'Example School'; const { entries, records } = flattenProfile(profile);
    expect(allowedEntries(entries, records, degree.id, degree.records.map(item => item.id)).map(entry => entry.label)).toEqual(['School']);
  });
  it('keeps equal school names separate and identities stable after reordering', () => {
    const { profile, first, second } = education(); const before = flattenProfile(validateProfile(profile));
    profile.groups[0].records.reverse(); const after = flattenProfile(validateProfile(profile));
    expect(after.entries.map(entry => entry.id).sort()).toEqual(before.entries.map(entry => entry.id).sort());
    expect(first.attributes[0].value).toBe(second.attributes[0].value); expect(first.id).not.toBe(second.id);
    expect(first.attributes[0].id).not.toBe(second.attributes[0].id);
  });
  it('only matches assigned records and explicitly included descendants', () => {
    const { profile, first, second } = education(); const { entries, records } = flattenProfile(profile);
    const base = allowedEntries(entries, records, first.id);
    expect(exactMatch({ label: 'GPA' }, base).value).toBe('3.8');
    expect(exactMatch({ label: 'Major' }, base)).toBeUndefined();
    const one = allowedEntries(entries, records, first.id, [first.records[0].id]);
    expect(exactMatch({ label: 'Major' }, one).value).toBe('Mathematics');
    const both = allowedEntries(entries, records, first.id, first.records.map(item => item.id));
    expect(exactMatch({ label: 'Major' }, both)).toBeUndefined();
    expect(allowedEntries(entries, records, first.id, [second.records[0].id])).toEqual([]);
  });
  it('requires explicit combination and matches native choices without guessing', () => {
    const values = [{ value: 'Mathematics' }, { value: 'Physics' }];
    expect(destinationValue({ type: 'text' }, values)).toBeNull();
    expect(destinationValue({ type: 'text' }, values, '; ').value).toBe('Mathematics; Physics');
    const field = { type: 'select-multiple', options: [{ id: 'a', value: 'math', label: 'Mathematics', disabled: false },
      { id: 'b', value: 'physics', label: 'Physics', disabled: false }] };
    expect(destinationValue(field, values).optionIds).toEqual(['a', 'b']);
    expect(destinationValue({ ...field, type: 'select-one' }, values)).toBeNull();
    field.options.push({ ...field.options[0], id: 'c' }); expect(destinationValue(field, [values[0]])).toBeNull();
  });
  it('validates dates and months without silently transforming values', () => {
    for (const value of ['2024-02-30', '02/01/2024', '2024-13-01']) expect(destinationValue({ type: 'date' }, [{ value }])).toBeNull();
    expect(destinationValue({ type: 'date' }, [{ value: '2024-02-29' }]).value).toBe('2024-02-29');
    expect(destinationValue({ type: 'month' }, [{ value: '2024-06' }]).value).toBe('2024-06');
    expect(destinationValue({ type: 'month' }, [{ value: '2024-06-01' }])).toBeNull();
  });
  it('converts flat profiles without using values as identities', () => {
    const migrated = validateProfile({ 'Example University': ['school'] });
    expect(migrated.version).toBe(2); expect(migrated.groups[0].label).toBe('Ungrouped');
    expect(flattenProfile(migrated).entries[0].value).toBe('Example University');
    expect(validateProfile(migrated)).toEqual(migrated);
  });
  it('rejects duplicate IDs, oversized attributes, excess nesting and malformed nodes', () => {
    const { profile, first } = education();
    const bad = structuredClone(profile); bad.groups[0].records[1].id = first.id; expect(() => validateProfile(bad)).toThrow();
    first.attributes[0].value = 'x'.repeat(20001); expect(() => validateProfile(profile)).toThrow();
    const deep = emptyProfile(); const collection = group(); deep.groups.push(collection); let item = record(); collection.records.push(item);
    for (let i = 0; i < 8; i++) { const child = record(); item.records.push(child); item = child; }
    expect(() => validateProfile(deep)).toThrow();
    expect(() => validateProfile({ version: 2, groups: [null] })).toThrow();
    const many = emptyProfile(); const g = group(); const r = record(); r.attributes = Array.from({ length: 1001 }, () => attribute()); g.records.push(r); many.groups.push(g);
    expect(() => validateProfile(many)).toThrow();
  });
});

describe('Visual editor and JSON synchronization', () => {
  function editor() {
    document.body.innerHTML = '<div id="visual"></div><div hidden><textarea id="json"></textarea></div><input id="advanced" type="checkbox">';
    const root = document.getElementById('visual'); const json = document.getElementById('json'); const advanced = document.getElementById('advanced'); const report = vi.fn();
    const instance = createProfileEditor(root, json, advanced, report);
    return { root, json, advanced, report, instance, click: text => [...root.querySelectorAll('button')].find(button => button.textContent === text).click() };
  }
  it('creates a template, duplicates degrees and clears all private editor state', () => {
    const app = editor(); app.instance.load(emptyProfile()); app.click('Add education template');
    const before = app.instance.read(); expect(before.groups[0].records[0].records).toHaveLength(7);
    const degree = [...app.root.querySelectorAll('fieldset')].find(box => box.querySelector(':scope > legend')?.textContent === 'School — degree');
    [...degree.querySelectorAll(':scope > .entry-header > .entry-manage button')].find(button => button.textContent === 'Duplicate').click();
    expect(app.instance.read().groups[0].records).toHaveLength(2);
    app.instance.clear(); expect(app.root.textContent).toBe(''); expect(app.json.value).toBe('');
  });
  it('preserves edits across JSON and visual views and leaves invalid JSON visible', () => {
    const app = editor(); app.instance.load(education().profile);
    const input = app.root.querySelector('input'); input.value = 'Education updated'; input.dispatchEvent(new Event('input'));
    app.advanced.checked = true; app.advanced.dispatchEvent(new Event('change'));
    expect(JSON.parse(app.json.value).groups[0].label).toBe('Education updated');
    const value = JSON.parse(app.json.value); value.groups[0].label = 'From JSON'; app.json.value = JSON.stringify(value);
    app.advanced.checked = false; app.advanced.dispatchEvent(new Event('change'));
    expect(app.instance.read().groups[0].label).toBe('From JSON');
    app.advanced.checked = true; app.advanced.dispatchEvent(new Event('change')); app.json.value = '{broken';
    app.advanced.checked = false; app.advanced.dispatchEvent(new Event('change'));
    expect(app.advanced.checked).toBe(true); expect(app.report).toHaveBeenCalled(); expect(app.json.value).toBe('{broken');
  });
});
