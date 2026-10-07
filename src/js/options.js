import { api, send, showError, downloadJson } from './ui.js';
import { originOf, sitePattern } from './utils.js';
import { downloadModel, modelReady, cacheName, downloadOrigins } from './model-store.js';
import { validateEnvelope } from './vault.js';
import { createProfileEditor } from './profile-editor.js';
const $ = id => document.getElementById(id);
const base = api.runtime.getURL('');
let currentEpoch;
let download;
const profileEditor = createProfileEditor($('recordEditor'), $('profile'), $('advanced'), error => showError(error, $('message')));
function clearEditor() { profileEditor.clear(); $('editor').disabled = true; }
function password(confirm = false) {
  const value = $('passphrase').value;
  const confirmation = $('confirmation').value;
  $('passphrase').value = ''; $('confirmation').value = '';
  if (confirm && value !== confirmation) throw new Error('PASSPHRASE_CONFIRMATION');
  return value;
}
async function refresh(load = false) {
  const status = await send('status');
  if (!status.unlocked || (currentEpoch !== undefined && currentEpoch !== status.epoch)) clearEditor();
  currentEpoch = status.epoch;
  $('vaultStatus').textContent = !status.exists ? 'No vault yet.' : status.unlocked ? 'Vault unlocked.' : 'Vault locked.';
  $('create').disabled = status.exists;
  $('unlock').disabled = !status.exists || status.unlocked;
  $('lock').disabled = !status.unlocked;
  $('changePassphrase').disabled = !status.unlocked;
  if (load && status.unlocked) {
    profileEditor.load(await send('profile'));
    $('editor').disabled = false;
  }
  if (document.activeElement !== $('threshold')) $('threshold').value = status.preferences.threshold;
  $('sites').replaceChildren();
  for (const origin of status.preferences.sites) {
    const li = document.createElement('li');
    li.append(document.createTextNode(`${origin} `));
    const button = document.createElement('button'); button.textContent = 'Revoke';
    button.addEventListener('click', () => run(async () => { await send('revokeSite', { origin }); await refresh(); }));
    li.append(button); $('sites').append(li);
  }
}
async function run(fn) {
  $('message').textContent = '';
  try { await fn(); } catch (error) { showError(error, $('message')); }
}
function on(id, fn) { $(id).addEventListener('click', () => run(fn)); }
on('create', async () => { await send('create', { passphrase: password(true) }); await refresh(true); });
on('unlock', async () => { await send('unlock', { passphrase: password() }); await refresh(true); });
on('lock', async () => { clearEditor(); password(); await send('lock'); await refresh(); });
on('changePassphrase', async () => { await send('changePassphrase', { passphrase: password(true) }); await refresh(true); $('message').textContent = 'Passphrase changed.'; });
on('save', async () => {
  let profile;
  try { profile = profileEditor.read(); } catch { throw new Error('INVALID_PROFILE'); }
  await send('save', { profile }); await refresh(true); $('message').textContent = 'Encrypted changes saved.';
});
on('reset', () => refresh(true));
on('export', async () => downloadJson(await send('export')));
on('import', async () => {
  const file = $('importFile').files[0];
  if (!file || file.size > 6000000) throw new Error('INVALID_BACKUP');
  let envelope;
  try { envelope = JSON.parse(await file.text()); } catch { throw new Error('INVALID_BACKUP'); }
  validateEnvelope(envelope);
  if (!confirm('Replace the current vault with this encrypted backup?')) return;
  await send('import', { envelope, passphrase: password(true) });
  $('importFile').value = ''; await refresh(true);
});
on('clearAll', async () => {
  if (!confirm('Permanently delete the vault, preferences, and model cache? Existing exported files and other devices are not erased.')) return;
  download?.abort(); clearEditor(); password(); await send('clearAll'); await refresh();
  $('modelStatus').textContent = 'Model removed.'; $('message').textContent = 'Personal data cleared.';
});
on('saveThreshold', async () => { await send('preferences', { threshold: Number($('threshold').value) }); await refresh(true); });
on('approveSite', async () => {
  const origin = originOf($('site').value);
  // Request immediately from the click gesture; do not await a message first.
  if (!await api.permissions.request({ origins: [sitePattern(origin)] })) throw new Error('PERMISSION_REQUIRED');
  await send('approveSite', { origin }); await refresh();
  $('message').textContent = 'Site approved. Reload its page before opening a field preview.';
});
on('downloadModel', async () => {
  if (download) return;
  if (!await api.permissions.request({ origins: downloadOrigins })) throw new Error('PERMISSION_REQUIRED');
  download = new AbortController(); $('downloadModel').disabled = true;
  try { await downloadModel(base, download.signal, text => { $('modelStatus').textContent = text; }); }
  finally { download = null; $('downloadModel').disabled = false; }
});
on('cancelDownload', async () => { download?.abort(); });
on('removeModel', async () => {
  download?.abort(); await caches.delete(cacheName); await send('invalidateModel');
  $('modelStatus').textContent = 'Model removed. Exact alias matching remains available.';
});
api.runtime.onMessage.addListener(message => {
  if (message.action === 'sessionChanged') { download?.abort(); clearEditor(); password(); }
});
window.addEventListener('pagehide', () => { download?.abort(); clearEditor(); password(); });
run(async () => {
  await refresh(true);
  $('modelStatus').textContent = await modelReady(base) ? 'Model installed; matching works offline.' : 'Model not installed. Exact alias matching is available.';
});
setInterval(() => refresh().catch(() => { clearEditor(); }), 2000);
