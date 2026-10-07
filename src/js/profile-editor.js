import { attribute, record, group, duplicate, educationGroup, validateProfile } from './profile.js';

export function createProfileEditor(root, json, advanced, report) {
  const doc = root.ownerDocument;
  let profile = null;
  const element = (tag, text, className) => {
    const el = doc.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el;
  };
  function button(parent, text, action) {
    const el = element('button', text); el.type = 'button';
    el.addEventListener('click', () => { try { action(); } catch (error) { report(error); } }); parent.append(el); return el;
  }
  function sync() { if (profile) json.value = JSON.stringify(profile, null, 2); }
  function input(parent, title, value, update, { multiline = false, max = 256, legend } = {}) {
    const label = element('label', title); const control = element(multiline ? 'textarea' : 'input');
    control.value = value; control.autocomplete = 'off'; control.spellcheck = false; control.maxLength = max;
    if (multiline) control.rows = 2;
    control.addEventListener('input', () => {
      update(control.value); if (legend) legend.textContent = control.value || 'Unnamed'; sync();
    });
    label.append(control); parent.append(label); return control;
  }
  function controls(parent, items, item, kind) {
    const manage = element('details', '', 'entry-manage'); manage.append(element('summary', `Manage ${kind}`)); parent.append(manage);
    const actions = element('div', '', 'actions'); manage.append(actions);
    button(actions, 'Duplicate', () => { items.splice(items.indexOf(item) + 1, 0, duplicate(item)); render(); });
    for (const [text, delta] of [['Move up', -1], ['Move down', 1]]) {
      const el = button(actions, text, () => {
        const index = items.indexOf(item); const other = index + delta;
        if (other >= 0 && other < items.length) { [items[index], items[other]] = [items[other], items[index]]; render(); }
      });
      el.disabled = items.indexOf(item) + delta < 0 || items.indexOf(item) + delta >= items.length;
    }
    button(actions, 'Delete', () => {
      if (!doc.defaultView.confirm('Delete this item and its children from the editor? Save to persist the deletion.')) return;
      items.splice(items.indexOf(item), 1); render();
    }).className = 'danger';
  }
  function card(parent, item, kind, depth = 0) {
    const box = element('fieldset', '', `entry-card entry-${kind}`); box.dataset.depth = String(depth);
    if (kind === 'record') box.classList.add(depth % 2 ? 'record-odd' : 'record-even');
    const legend = element('legend', item.label || 'Unnamed'); box.append(legend); parent.append(box);
    return { box, legend };
  }
  function section(parent, title, help, className) {
    const area = element('div', '', `entry-section ${className}`); const heading = element('h3', title, 'entry-section-title');
    area.append(heading); if (help) area.append(element('p', help, 'entry-help')); parent.append(area); return area;
  }
  function drawAttribute(parent, items, leaf, primary = false) {
    const { box, legend } = card(parent, leaf, 'attribute'); if (primary) box.classList.add('attribute-primary');
    const fields = element('div', '', 'attribute-fields'); box.append(fields);
    input(fields, 'Attribute name', leaf.label, value => { leaf.label = value; }, { legend });
    const value = input(fields, 'Value', leaf.value, value => { leaf.value = value; }, { multiline: true, max: 20000 });
    if (leaf.label === 'Awards') {
      box.classList.add('attribute-wide'); value.rows = 4; value.placeholder = 'Type your awards, honors, or scholarships here.';
    }
    if (/^(Start|End|Graduation) month$/i.test(leaf.label)) value.placeholder = 'Month name, e.g. January';
    if (/^(Start|End|Graduation) year$/i.test(leaf.label)) value.placeholder = 'YYYY';
    if (/^(Start|End|Graduation) date$/i.test(leaf.label)) value.placeholder = 'Optional: YYYY-MM-DD for a single date field';
    const aliases = element('details', '', 'attribute-aliases'); aliases.append(element('summary', 'Field aliases')); box.append(aliases);
    input(aliases, 'Aliases (one per line)', leaf.aliases.join('\n'), value => { leaf.aliases = value.split('\n').map(s => s.trim()).filter(Boolean); }, { multiline: true, max: 25700 });
    controls(box, items, leaf, 'attribute');
  }
  function drawRecord(parent, items, item, depth) {
    const { box, legend } = card(parent, item, 'record', depth);
    const header = element('div', '', 'entry-header'); box.append(header);
    header.append(element('span', depth === 1 ? 'Record' : 'Nested record', 'entry-kind'));
    input(header, 'Record name', item.label, value => { item.label = value; }, { legend }); controls(header, items, item, 'record');
    if (item.attributes.length || !item.records.length) {
      const main = section(box, 'Main value', depth === 1 ? 'The first attribute identifies this entry.' : '', 'entry-main');
      if (item.attributes[0]) drawAttribute(main, item.attributes, item.attributes[0], true);
      else main.append(element('p', 'Add an attribute to give this record a value.', 'entry-empty'));
    }
    if (item.attributes.length > 1) {
      const attributes = section(box, 'Additional attributes', depth === 1 ? 'Details belonging to this record.' : '', 'entry-attributes');
      const list = element('div', '', 'attribute-list'); attributes.append(list);
      item.attributes.slice(1).forEach(leaf => drawAttribute(list, item.attributes, leaf));
    }
    if (item.records.length) {
      const children = section(box, 'Related details', 'Nested records stay separate from the main value and its attributes.', 'entry-children');
      item.records.forEach(child => drawRecord(children, item.records, child, depth + 1));
    }
    const footer = element('div', '', 'actions entry-footer'); box.append(footer);
    button(footer, 'Add attribute', () => { item.attributes.push(attribute('New attribute')); render(); });
    const add = button(footer, 'Add nested record', () => { item.records.push(record()); render(); }); add.disabled = depth >= 8;
  }
  function render() {
    root.replaceChildren(); if (!profile) return;
    if (!profile.groups.length) root.append(element('p', 'Start with an education template, or create your own group.', 'entry-empty'));
    for (const collection of profile.groups) {
      const { box, legend } = card(root, collection, 'group');
      const header = element('div', '', 'entry-header'); box.append(header); header.append(element('span', 'Group', 'entry-kind'));
      input(header, 'Group name', collection.label, value => { collection.label = value; }, { legend }); controls(header, profile.groups, collection, 'group');
      const records = section(box, 'Records', 'One entry per degree, school qualification, or job.', 'entry-records');
      collection.records.forEach(item => drawRecord(records, collection.records, item, 1));
      if (!collection.records.length) records.append(element('p', 'No records yet.', 'entry-empty'));
      button(records, 'Add record', () => { collection.records.push(record()); render(); });
    }
    const actions = element('div', '', 'actions editor-additions'); root.append(actions);
    button(actions, 'Add group', () => { profile.groups.push(group()); render(); });
    button(actions, 'Add education template', () => { profile.groups.push(educationGroup()); render(); }); sync();
  }
  advanced.addEventListener('change', () => {
    try {
      if (!advanced.checked && profile) { profile = validateProfile(JSON.parse(json.value)); render(); }
      root.hidden = advanced.checked; json.parentElement.hidden = !advanced.checked;
    } catch (error) { advanced.checked = true; report(error); }
  });
  return {
    load(value) { profile = validateProfile(value); render(); },
    read() { return validateProfile(advanced.checked ? JSON.parse(json.value) : profile); },
    clear() { profile = null; root.replaceChildren(); json.value = ''; }
  };
}
