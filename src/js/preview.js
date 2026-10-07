import { api, send, showError } from './ui.js';
import { exactMatch, sitePattern } from './utils.js';
import { allowedEntries, destinationValue } from './matching.js';
import { modelReady } from './model-store.js';
const $ = id => document.getElementById(id);
const requestId = new URL(location.href).searchParams.get('request');
let info, data, worker, epoch, frameApproved = false, generation = 0;
const rows = new Map(); const sections = new Map(); const fieldSections = new Map();
const el = (tag, text) => { const node = document.createElement(tag); if (text) node.textContent = text; return node; };
function option(select, value, text) { const node = el('option', text); node.value = value; select.append(node); }
function clear() {
  generation++; worker?.terminate(); worker = null; data = null; rows.clear(); sections.clear(); fieldSections.clear();
  $('fields').replaceChildren(); $('sections').replaceChildren(); $('fill').disabled = true; $('addSection').hidden = true;
}
async function run(fn) {
  $('message').textContent = '';
  try { await fn(); } catch (error) { clear(); showError(error, $('message')); }
}
function candidates(field) {
  const section = sections.get(fieldSections.get(field.id));
  return section ? allowedEntries(data.entries, data.records, section.recordId, section.nestedRecordIds) : [];
}
function selected(row) { return [...row.select.selectedOptions].map(node => data.entries.find(entry => entry.id === node.value)).filter(Boolean); }
function validateRow(row) {
  const destination = destinationValue(row.field, selected(row), row.combine.checked ? row.separator.value : null);
  row.destination.textContent = destination ? `Will insert: ${destination.value}` : 'Select a valid value; combining requires a separator. Dropdown choices must match an available option.';
  if (!destination) row.approve.checked = false;
  return destination;
}
function showMatches(matches) {
  if (!data) return;
  for (const match of matches) {
    const row = rows.get(match.fieldId);
    if (!row || !match.entryId || match.similarity < data.threshold || row.edited || !candidates(row.field).some(entry => entry.id === match.entryId)) continue;
    row.select.value = match.entryId; row.similarity = match.similarity; row.score.textContent = match.similarity.toFixed(2);
    row.approve.checked = !!validateRow(row);
  }
}
async function match() {
  worker?.terminate(); worker = null; const current = ++generation;
  showMatches(data.fields.map(field => {
    const entry = exactMatch(field.metadata, candidates(field));
    return { fieldId: field.id, entryId: entry?.id, similarity: entry ? 1 : 0 };
  }));
  const snapshot = data;
  const candidateIds = new Set(data.fields.flatMap(field => candidates(field).map(entry => entry.id)));
  if (!candidateIds.size) return;
  if (!await modelReady(api.runtime.getURL('')) || data !== snapshot || generation !== current) return;
  worker = new Worker(api.runtime.getURL('js/inference-worker.js'), { type: 'module' });
  worker.onmessage = ({ data: result }) => {
    if (current !== generation || !data) return;
    if (result.ok) showMatches(result.matches);
    $('message').textContent = result.ok ? 'Review the proposed values and approve fields to fill.' : 'Local similarity matching is unavailable. Exact matches and manual selection remain available.';
    worker?.terminate(); worker = null;
  };
  worker.onerror = () => { worker?.terminate(); worker = null; $('message').textContent = 'Local matching could not run. Select values manually.'; };
  worker.postMessage({ fields: data.fields.map(field => ({ id: field.id, metadata: field.metadata, entryIds: candidates(field).map(entry => entry.id) })),
    entries: data.entries.filter(entry => candidateIds.has(entry.id)).map(({ id, aliases }) => ({ id, aliases })) });
}
function renderFields() {
  rows.clear(); $('fields').replaceChildren();
  for (const field of data.fields) {
    const tr = el('tr'); const label = field.metadata.label || field.metadata['aria-label'] || field.metadata.name || field.metadata.id || 'Unnamed field';
    const labelCell = el('td', label); const assign = el('select'); assign.setAttribute('aria-label', `Section for ${label}`);
    for (const [id, section] of sections) option(assign, id, section.label);
    assign.value = fieldSections.get(field.id);
    assign.addEventListener('change', () => { fieldSections.set(field.id, assign.value); renderFields(); });
    labelCell.append(assign); tr.append(labelCell);
    const select = el('select'); select.multiple = true; select.size = 3; select.setAttribute('aria-label', `Values for ${label}`);
    for (const entry of candidates(field).filter(entry => entry.value)) option(select, entry.id, `${entry.path}: ${entry.value}`);
    const valueCell = el('td'); valueCell.append(select);
    const combineLabel = el('label', 'Combine selected values '); const combine = el('input'); combine.type = 'checkbox'; combineLabel.prepend(combine);
    const separator = el('input'); separator.value = ', '; separator.maxLength = 32; separator.setAttribute('aria-label', `Separator for ${label}`);
    separator.disabled = true; const destination = el('p');
    if (!field.type.startsWith('select-') && !['date', 'month'].includes(field.type)) valueCell.append(combineLabel, separator);
    valueCell.append(destination); tr.append(valueCell);
    const score = el('td', '—'); tr.append(score);
    const approve = el('input'); approve.type = 'checkbox'; approve.setAttribute('aria-label', `Approve ${label}`);
    const approveCell = el('td'); approveCell.append(approve); tr.append(approveCell);
    const copy = el('button', 'Copy'); const copyCell = el('td'); copyCell.append(copy); tr.append(copyCell);
    const row = { field, select, score, approve, combine, separator, destination, similarity: 0, edited: false };
    function changed() {
      row.edited = true; row.similarity = 1; score.textContent = 'Manual'; separator.disabled = !combine.checked;
      approve.checked = !!validateRow(row);
    }
    select.addEventListener('change', changed); combine.addEventListener('change', changed); separator.addEventListener('input', changed);
    approve.addEventListener('change', () => { if (!validateRow(row)) approve.checked = false; });
    copy.addEventListener('click', () => run(async () => {
      const status = await send('status'); if (!status.unlocked) throw new Error('LOCKED'); if (status.epoch !== epoch) throw new Error('SESSION_CHANGED');
      const value = validateRow(row); if (value) { await navigator.clipboard.writeText(value.value); $('message').textContent = 'Copied. Clipboard history may retain this value.'; }
    }));
    rows.set(field.id, row); $('fields').append(tr); validateRow(row);
  }
  $('fill').disabled = !data.fields.length; match().catch(() => { $('message').textContent = 'Select values manually.'; });
}
function descendants(id) {
  const result = [];
  function visit(parent) { for (const item of data.records.filter(record => record.parentId === parent)) { result.push(item); visit(item.id); } }
  visit(id); return result;
}
function renderSections() {
  $('sections').replaceChildren();
  for (const section of sections.values()) {
    const box = el('fieldset'); box.append(el('legend', section.label));
    const label = el('label', 'Saved record '); const select = el('select'); select.setAttribute('aria-label', `Record for ${section.label}`);
    option(select, '', 'Choose a record'); for (const record of data.records) option(select, record.id, record.label); select.value = section.recordId;
    label.append(select); box.append(label);
    select.addEventListener('change', () => { section.recordId = select.value; section.nestedRecordIds = []; renderSections(); renderFields(); });
    for (const nested of descendants(section.recordId)) {
      const label = el('label', `Include ${nested.label} `); const check = el('input'); check.type = 'checkbox'; check.checked = section.nestedRecordIds.includes(nested.id);
      check.addEventListener('change', () => { section.nestedRecordIds = check.checked ? [...section.nestedRecordIds, nested.id] : section.nestedRecordIds.filter(id => id !== nested.id); renderFields(); });
      label.prepend(check); box.append(label);
    }
    $('sections').append(box);
  }
}
function render() {
  for (const section of data.sections) sections.set(section.id, { ...section, recordId: '', nestedRecordIds: [] });
  // A converted flat vault retains its former exact/manual workflow.
  if (data.records.length === 1 && data.records[0].label.startsWith('Ungrouped / ')) for (const section of sections.values()) section.recordId = data.records[0].id;
  data.fields.forEach(field => fieldSections.set(field.id, field.sectionId));
  $('addSection').hidden = false; renderSections(); renderFields();
}
async function approveFrame() {
  if (info.origin !== info.topOrigin && !frameApproved) {
    frameApproved = confirm(`Allow this preview to act on the embedded destination ${info.origin}? The top-level site is ${info.topOrigin}.`);
    return frameApproved;
  }
  return true;
}
$('addSection').addEventListener('click', () => {
  const id = crypto.randomUUID(); sections.set(id, { label: `Manual section ${sections.size + 1}`, recordId: '', nestedRecordIds: [] }); renderSections(); renderFields();
});
$('options').addEventListener('click', () => api.runtime.openOptionsPage());
$('cancel').addEventListener('click', () => { clear(); send('cancelPreview', { requestId }).catch(() => {}); window.close(); });
$('approveSite').addEventListener('click', () => run(async () => {
  if (!await api.permissions.request({ origins: [sitePattern(info.origin)] })) throw new Error('PERMISSION_REQUIRED');
  await send('approveSite', { origin: info.origin }); $('message').textContent = 'Destination approved. Reload the page and open a new preview.';
  $('collect').disabled = true; $('approveSite').hidden = true;
}));
$('collect').addEventListener('click', () => run(async () => {
  clear(); if (!await approveFrame()) return; epoch = (await send('status')).epoch;
  if (info.scope === 'opener') {
    const opener = await send('inspectOpener', { requestId, approveFrame: frameApproved });
    $('openerLabel').textContent = `Open page control: ${opener.label}`; $('opening').hidden = false; $('collect').hidden = true; return;
  }
  data = await send('collectPreview', { requestId, approveFrame: frameApproved, scopeId: $('scope').value }); render();
  $('message').textContent = 'Assign records to sections. Select repeated items individually, or explicitly combine them. Review before filling.';
}));
$('openSubform').addEventListener('click', () => run(async () => {
  $('openSubform').disabled = true;
  const result = await send('openSubform', { requestId, approveFrame: frameApproved, approveOpen: true });
  info.scope = 'opened'; $('opening').hidden = true; $('scope').replaceChildren();
  for (const scope of result.scopes) option($('scope'), scope.id, `${scope.label} (${scope.count} fields)`);
  if (result.scopes.length > 1) { option($('scope'), '', 'Choose a revealed section'); $('scope').value = ''; }
  $('scopeLabel').hidden = false; $('collect').hidden = false;
  $('message').textContent = 'Choose the revealed subform and prepare a fresh preview. You save or submit it yourself.';
}));
$('fill').addEventListener('click', () => run(async () => {
  worker?.terminate(); worker = null; generation++;
  const selections = [...rows].filter(([, row]) => row.approve.checked && validateRow(row)).map(([fieldId, row]) => {
    const section = sections.get(fieldSections.get(fieldId));
    return { fieldId, entryIds: selected(row).map(entry => entry.id), recordId: section.recordId, nestedRecordIds: section.nestedRecordIds,
      separator: row.combine.checked ? row.separator.value : null, similarity: row.similarity };
  });
  if (!selections.length) { $('message').textContent = 'Select and approve a valid value first.'; return; }
  const learn = $('learn').checked;
  const result = await send('fill', { requestId, selections, learn }); clear(); $('collect').disabled = true;
  $('message').textContent = `${result.filled} field(s) filled. Changed or populated fields were skipped. Save the subform yourself; open a new preview for another record.${learn && !result.learned ? ' Mappings were not saved.' : ''}`;
}));
function end(text) { clear(); $('collect').disabled = true; $('openSubform').disabled = true; $('message').textContent = text; }
api.runtime.onMessage.addListener(message => { if (message.action === 'sessionChanged') end('The vault or permissions changed. Open a new preview.'); });
window.addEventListener('pagehide', () => { clear(); send('cancelPreview', { requestId }).catch(() => {}); });
setTimeout(() => { end('Preview expired. Open a new one from the destination page.'); send('cancelPreview', { requestId }).catch(() => {}); }, 120000);
run(async () => {
  info = await send('previewInfo', { requestId }); $('destination').textContent = `Destination: ${info.origin}`;
  $('frameNotice').textContent = info.origin !== info.topOrigin ? `Embedded destination. Top-level site: ${info.topOrigin}. Separate approval is required.` : `Preview scope: ${info.scope}.`;
  $('approveSite').hidden = info.approved; $('collect').disabled = !info.approved;
  if (info.scope === 'opener') $('collect').textContent = 'Inspect Add/Edit control';
});
setInterval(async () => {
  try { const status = await send('status'); if (epoch !== undefined && (!status.unlocked || status.epoch !== epoch)) end('Vault session ended. Open a new preview.'); }
  catch { end('The extension is unavailable. Open a new preview.'); }
}, 2000);
