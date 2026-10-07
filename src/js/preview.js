import { api, send, showError } from './ui.js';
import { exactMatch, sitePattern } from './utils.js';
import { modelReady } from './model-store.js';
const $ = id => document.getElementById(id);
const requestId = new URL(location.href).searchParams.get('request');
let info, data, worker, epoch;
const rows = new Map();
function clear() {
  worker?.terminate(); worker = null; data = null; rows.clear(); $('fields').replaceChildren(); $('fill').disabled = true;
}
async function run(fn) {
  $('message').textContent = '';
  try { await fn(); } catch (error) { clear(); showError(error, $('message')); }
}
function showMatches(matches) {
  for (const match of matches) {
    const row = rows.get(match.fieldId);
    if (!row || !match.entryId || match.similarity < data.threshold || row.edited) continue;
    row.select.value = match.entryId; row.similarity = match.similarity;
    row.score.textContent = match.similarity.toFixed(2); row.approve.checked = true;
  }
}
function render() {
  for (const field of data.fields) {
    const tr = document.createElement('tr');
    const label = field.metadata.label || field.metadata['aria-label'] || field.metadata.name || field.metadata.id || 'Unnamed field';
    const labelCell = document.createElement('td'); labelCell.textContent = label; tr.append(labelCell);
    const select = document.createElement('select'); select.setAttribute('aria-label', `Value for ${label}`);
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Leave unchanged'; select.append(empty);
    for (const entry of data.entries) {
      const option = document.createElement('option'); option.value = entry.id; option.textContent = entry.value; select.append(option);
    }
    const valueCell = document.createElement('td'); valueCell.append(select); tr.append(valueCell);
    const score = document.createElement('td'); score.textContent = '—'; tr.append(score);
    const approve = document.createElement('input'); approve.type = 'checkbox'; approve.setAttribute('aria-label', `Approve ${label}`);
    const approveCell = document.createElement('td'); approveCell.append(approve); tr.append(approveCell);
    const copy = document.createElement('button'); copy.textContent = 'Copy';
    copy.addEventListener('click', () => run(async () => {
      const status = await send('status');
      if (!status.unlocked) throw new Error('LOCKED');
      if (status.epoch !== epoch) throw new Error('SESSION_CHANGED');
      const entry = data?.entries.find(entry => entry.id === select.value);
      if (entry) { await navigator.clipboard.writeText(entry.value); $('message').textContent = 'Copied. Clipboard history may retain this value.'; }
    }));
    const copyCell = document.createElement('td'); copyCell.append(copy); tr.append(copyCell);
    const row = { select, score, approve, similarity: 0, edited: false };
    select.addEventListener('change', () => {
      row.edited = true; row.similarity = select.value ? 1 : 0; score.textContent = select.value ? 'Manual' : '—'; approve.checked = !!select.value;
    });
    rows.set(field.id, row); $('fields').append(tr);
  }
  $('fill').disabled = !data.fields.length;
  showMatches(data.fields.map(field => {
    const entry = exactMatch(field.metadata, data.entries);
    return { fieldId: field.id, entryId: entry?.id, similarity: entry ? 1 : 0 };
  }));
}
$('options').addEventListener('click', () => api.runtime.openOptionsPage());
$('cancel').addEventListener('click', () => { clear(); window.close(); });
$('approveSite').addEventListener('click', () => run(async () => {
  if (!await api.permissions.request({ origins: [sitePattern(info.origin)] })) throw new Error('PERMISSION_REQUIRED');
  await send('approveSite', { origin: info.origin });
  $('message').textContent = 'Destination approved. Reload the application page and open a new preview.';
  $('collect').disabled = true; $('approveSite').hidden = true;
}));
$('collect').addEventListener('click', () => run(async () => {
  clear();
  if (info.origin !== info.topOrigin && !confirm(`Allow this preview to fill the embedded destination ${info.origin}? The top-level site is ${info.topOrigin}.`)) return;
  epoch = (await send('status')).epoch;
  data = await send('collectPreview', { requestId, approveFrame: info.origin !== info.topOrigin });
  render();
  if (await modelReady(api.runtime.getURL(''))) {
    worker = new Worker(api.runtime.getURL('js/inference-worker.js'), { type: 'module' });
    worker.onmessage = ({ data: result }) => {
      if (!data) return;
      if (result.ok) { showMatches(result.matches); $('message').textContent = 'Review the proposed values, then click Fill approved values.'; }
      else $('message').textContent = 'Local similarity matching is unavailable. Exact matches and manual selection remain available.';
      worker?.terminate(); worker = null;
    };
    worker.onerror = () => { worker?.terminate(); worker = null; $('message').textContent = 'Model could not run. Exact matches and manual selection remain available.'; };
    worker.postMessage({ fields: data.fields, entries: data.entries.map(({ id, aliases }) => ({ id, aliases })) });
    $('message').textContent = 'Calculating local similarities… You may select values manually.';
  } else $('message').textContent = 'Exact alias matches shown. Download the model in Options for similarity matching.';
}));
$('fill').addEventListener('click', () => run(async () => {
  worker?.terminate(); worker = null;
  const selections = [...rows].filter(([, row]) => row.approve.checked && row.select.value).map(([fieldId, row]) => ({
    fieldId, entryId: row.select.value, similarity: row.similarity
  }));
  if (!selections.length) { $('message').textContent = 'Select and approve a value first.'; return; }
  const result = await send('fill', { requestId, selections, learn: $('learn').checked });
  clear(); $('collect').disabled = true;
  $('message').textContent = `${result.filled} field(s) filled. Changed or populated fields were skipped.${$('learn').checked && !result.learned ? ' Mappings were not saved.' : ''}`;
}));
api.runtime.onMessage.addListener(message => {
  if (message.action === 'sessionChanged') { clear(); $('collect').disabled = true; $('message').textContent = 'The vault or permissions changed. Open a new preview.'; }
});
window.addEventListener('pagehide', clear);
setTimeout(() => { clear(); $('collect').disabled = true; $('message').textContent = 'Preview expired. Right-click the field to open a new one.'; }, 120000);
run(async () => {
  info = await send('previewInfo', { requestId });
  $('destination').textContent = `Destination: ${info.origin}`;
  $('frameNotice').textContent = info.origin !== info.topOrigin ? `Embedded form. Top-level site: ${info.topOrigin}. Separate approval is required.` : `Preview scope: ${info.scope}.`;
  $('approveSite').hidden = info.approved; $('collect').disabled = !info.approved;
});
setInterval(async () => {
  try {
    const status = await send('status');
    if (data && (!status.unlocked || status.epoch !== epoch)) { clear(); $('message').textContent = 'Vault session ended. Open a new preview.'; }
  } catch { clear(); }
}, 2000);
