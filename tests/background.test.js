import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createController } from '../src/background.js';
import { validateProfile, educationGroup, duplicate } from '../src/js/profile.js';
const listener = () => ({ addListener: vi.fn() });
function area(data) {
  return { get: vi.fn(async keys => keys === null ? { ...data } : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]]))),
    set: vi.fn(async values => Object.assign(data, values)),
    remove: vi.fn(async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }),
    clear: vi.fn(async () => { for (const key of Object.keys(data)) delete data[key]; }) };
}
function fixture(seed = {}) {
  const local = { preferences: { sites: ['https://trusted.example', 'https://frame.example'], threshold: 0.8 }, ...seed.local };
  const sync = { ...seed.sync }; const session = { ...seed.session };
  const api = {
    runtime: { id: 'fixture', getURL: path => `moz-extension://fixture/${path}`, sendMessage: vi.fn(async () => {}),
      onMessage: listener(), onInstalled: listener(), onStartup: listener(), openOptionsPage: vi.fn() },
    storage: { local: area(local), sync: area(sync), session: area(session), onChanged: listener() },
    tabs: { sendMessage: vi.fn(async (id, message) => message.action === 'collect'
      ? { origin: message.origin, token: 'document-a', sections: [{ id: 'section-a', label: 'Form' }], fields: [{ id: 'field-a', sectionId: 'section-a', type: 'text', metadata: { name: 'fullName', 'data-private': 'private' } }] }
      : { filled: message.items?.map(item => item.fieldId) ?? [] }), onRemoved: listener() },
    windows: { create: vi.fn(async () => {}) },
    permissions: { contains: vi.fn(async () => true), onRemoved: listener() },
    scripting: { registerContentScripts: vi.fn(async () => {}), unregisterContentScripts: vi.fn(async () => {}) },
    contextMenus: { create: vi.fn(), removeAll: vi.fn(async () => {}), onClicked: listener() }, action: { onClicked: listener() }
  };
  if (seed.cleanupFailure) api.storage.sync.clear.mockRejectedValue(new Error('Synthetic storage failure'));
  if (seed.noSession) delete api.storage.session;
  const controller = createController(api);
  // Synthetic unlocked fixture; cryptographic persistence is tested separately.
  controller.vault.key = {}; controller.vault.profile = validateProfile({ 'Zebra Example': ['lastName'], 'Applicant Example': ['fullName'] });
  const ui = { id: 'fixture', url: 'moz-extension://fixture/preview.html' };
  const call = (action, details = {}, sender = ui) => controller.handle({ action, ...details }, sender);
  async function preview(frame = false) {
    await controller.start({ menuItemId: 'previewForm', frameId: frame ? 3 : 0, frameUrl: frame ? 'https://frame.example/form' : undefined }, { id: 42, url: 'https://trusted.example/form' });
    const requestId = [...controller.pending.keys()].at(-1);
    const result = await call('collectPreview', { requestId, approveFrame: frame });
    return { requestId, result };
  }
  return { api, controller, local, sync, session, call, preview };
}
describe('Background authorization and frame isolation', () => {
  beforeEach(() => { globalThis.caches = { keys: vi.fn(async () => ['model-cache']), delete: vi.fn(async () => true) }; });
  it('rejects personal-data requests from pages, content scripts, other extensions and spoofed URLs', async () => {
    const app = fixture();
    for (const sender of [{ id: 'fixture', url: 'https://trusted.example/options.html' },
      { id: 'fixture', url: 'file:///options.html' }, { id: 'other', url: 'moz-extension://fixture/options.html' },
      { id: 'fixture', url: 'moz-extension://other/options.html' }, { id: 'fixture', url: 'moz-extension://fixture/background.js' }]) {
      await expect(app.call('profile', {}, sender)).rejects.toThrow('UNAUTHORIZED');
      await expect(app.call('fillAutoProposal', {}, sender)).rejects.toThrow('UNAUTHORIZED');
    }
    expect(app.api.tabs.sendMessage).not.toHaveBeenCalled();
  });
  it('collects from the selected frame, with metadata only, and sends no proposals to the page', async () => {
    const app = fixture(); const { result } = await app.preview(true);
    expect(app.api.tabs.sendMessage).toHaveBeenCalledWith(42, expect.objectContaining({ action: 'collect', origin: 'https://frame.example', scope: 'form' }), { frameId: 3 });
    expect(result.fields[0].metadata).toEqual({ name: 'fullName' });
    expect(JSON.stringify(app.api.tabs.sendMessage.mock.calls)).not.toContain('Applicant Example');
    expect(result.entries.find(entry => entry.value === 'Applicant Example').aliases).toEqual(['fullName']);
  });
  it('requires separate frame approval and current site permission', async () => {
    const app = fixture();
    await app.controller.start({ frameId: 3, frameUrl: 'https://frame.example', menuItemId: 'previewField' }, { id: 42, url: 'https://trusted.example' });
    const requestId = [...app.controller.pending.keys()][0];
    await expect(app.call('collectPreview', { requestId })).rejects.toThrow('FRAME_APPROVAL_REQUIRED');
    app.api.permissions.contains.mockResolvedValue(false);
    await expect(app.call('collectPreview', { requestId, approveFrame: true })).rejects.toThrow('PERMISSION_REQUIRED');
  });
  it('inserts exactly the selected value by stable ID and consumes the approval once', async () => {
    const app = fixture(); const { requestId, result } = await app.preview();
    const selected = result.entries.find(entry => entry.value === 'Applicant Example');
    const selections = [{ fieldId: 'field-a', entryId: selected.id, recordId: selected.recordId, nestedRecordIds: [], similarity: 1 }];
    await app.call('fill', { requestId, selections });
    expect(app.api.tabs.sendMessage).toHaveBeenLastCalledWith(42, expect.objectContaining({
      action: 'apply', token: 'document-a', items: [{ fieldId: 'field-a', value: 'Applicant Example' }]
    }), { frameId: 0 });
    await expect(app.call('fill', { requestId, selections })).rejects.toThrow('PREVIEW_EXPIRED');
  });
  it('blocks low confidence, unknown values, duplicate targets and changed destinations', async () => {
    const app = fixture(); const { requestId, result } = await app.preview();
    const selected = { fieldId: 'field-a', entryId: result.entries[0].id, recordId: result.entries[0].recordId, nestedRecordIds: [], similarity: 0.01 };
    await expect(app.call('fill', { requestId, selections: [selected] })).rejects.toThrow('INVALID_SELECTION');
    selected.similarity = 1; selected.entryId = 'missing';
    await expect(app.call('fill', { requestId, selections: [selected] })).rejects.toThrow('INVALID_SELECTION');
    selected.entryId = result.entries[0].id;
    await expect(app.call('fill', { requestId, selections: [selected, selected] })).rejects.toThrow('INVALID_SELECTION');
    app.api.tabs.sendMessage.mockResolvedValueOnce({ origin: 'https://attacker.example', token: 'changed', fields: [] });
    await expect(app.call('collectPreview', { requestId })).rejects.toThrow('INVALID_FIELDS');
  });
  it('locking cancels approvals and clears decrypted state and all UI sessions', async () => {
    const app = fixture(); const { requestId } = await app.preview();
    await app.call('lock');
    expect(app.controller.vault.profile).toBeNull(); expect(app.controller.pending.size).toBe(0);
    await expect(app.call('collectPreview', { requestId })).rejects.toThrow('LOCKED');
    expect(app.api.runtime.sendMessage).toHaveBeenCalledWith({ action: 'sessionChanged' });
  });
  it('permission revocation cancels existing previews and unregisters the site', async () => {
    const app = fixture(); const { requestId } = await app.preview();
    await app.call('revokeSite', { origin: 'https://trusted.example' });
    await expect(app.call('fill', { requestId, selections: [] })).rejects.toThrow('PREVIEW_EXPIRED');
    expect(app.local.preferences.sites).toEqual(['https://frame.example']);
    expect(app.api.scripting.unregisterContentScripts).toHaveBeenCalled();
  });
  it('startup erases all obsolete plaintext without reading it or touching the vault and preferences', async () => {
    const encryptedVault = { ciphertext: 'synthetic ciphertext' };
    const app = fixture({ local: { encryptedVault, AIFillForm: { name: 'Applicant Example' },
      AIFillForm_backup_old_format: { name: 'Applicant Example' }, backup_timestamp: 123,
      staticEmbeddings: { alias: [1, 2] }, settings: { model: 'old' }, aiSession: 'old metadata' },
      sync: { AIFillForm: { name: 'Applicant Example' }, settings: { model: 'old' } },
      session: { aiSession: 'metadata' } });
    const status = await app.call('status');
    expect(app.sync).toEqual({}); expect(app.session).toEqual({});
    expect(app.local).toEqual({ encryptedVault, preferences: { sites: ['https://trusted.example', 'https://frame.example'], threshold: 0.8 } });
    expect(app.api.storage.sync.get).not.toHaveBeenCalled();
    expect(app.api.storage.local.get.mock.calls.map(([key]) => key)).toEqual(['encryptedVault', 'preferences']);
    expect(status).not.toHaveProperty('legacy');
    await expect(app.call('deleteLegacy')).rejects.toThrow('UNKNOWN_ACTION');
  });
  it('automatically erases plaintext restored by sync or another old writer', async () => {
    const app = fixture(); await app.call('status');
    const onChanged = app.api.storage.onChanged.addListener.mock.calls[0][0];
    app.sync.AIFillForm = { name: 'Applicant Example' };
    onChanged({ AIFillForm: { newValue: app.sync.AIFillForm } }, 'sync');
    await app.call('status'); expect(app.sync).toEqual({});
    app.local.AIFillForm_backup_old_format = { name: 'Applicant Example' };
    onChanged({ AIFillForm_backup_old_format: { newValue: app.local.AIFillForm_backup_old_format } }, 'local');
    await app.call('status'); expect(app.local.AIFillForm_backup_old_format).toBeUndefined();
    const clears = app.api.storage.sync.clear.mock.calls.length;
    onChanged({ AIFillForm: { oldValue: { name: 'Applicant Example' } } }, 'sync');
    onChanged({ preferences: { newValue: app.local.preferences } }, 'local');
    await app.call('status'); expect(app.api.storage.sync.clear).toHaveBeenCalledTimes(clears);
  });
  it('blocks vault operations after cleanup failure and retries without exposing plaintext', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const app = fixture({ cleanupFailure: true, sync: { AIFillForm: { name: 'Applicant Example' } } });
      await expect(app.call('create', { passphrase: 'synthetic vault passphrase' })).rejects.toThrow('STORAGE_CLEANUP_FAILED');
      expect(app.api.storage.local.set).not.toHaveBeenCalled();
      app.api.storage.sync.clear.mockImplementation(async () => { for (const key of Object.keys(app.sync)) delete app.sync[key]; });
      await app.call('status'); expect(app.sync).toEqual({});
      expect(JSON.stringify(warn.mock.calls)).not.toContain('Applicant Example');
    } finally { warn.mockRestore(); }
  });
  it('supports browsers without session storage', async () => {
    const app = fixture({ noSession: true });
    expect(await app.call('status')).toHaveProperty('preferences');
  });
  it('clear-all covers every storage area, model cache and unlocked memory', async () => {
    const app = fixture(); app.local.AIFillForm = 'synthetic'; app.sync.AIFillForm = 'synthetic';
    await app.call('clearAll');
    expect(app.local).toEqual({}); expect(app.sync).toEqual({}); expect(app.session).toEqual({});
    expect(app.controller.vault.unlocked).toBe(false); expect(caches.delete).toHaveBeenCalledWith('model-cache');
  });
  it('initialization contains no value labels or all-site registration', async () => {
    const app = fixture(); await app.controller.initialize();
    expect(JSON.stringify(app.api.contextMenus.create.mock.calls)).not.toContain('Applicant Example');
    const script = app.api.scripting.registerContentScripts.mock.calls[0][0][0];
    expect(script.matches).toEqual(['https://trusted.example/*', 'https://frame.example/*']);
  });
  it('expired previews and browser-context restart require a fresh approval and unlock', async () => {
    const app = fixture(); const { requestId } = await app.preview();
    app.controller.pending.get(requestId).expires = Date.now() - 1;
    await expect(app.call('fill', { requestId, selections: [] })).rejects.toThrow('PREVIEW_EXPIRED');
    const restarted = createController(app.api);
    expect(restarted.vault.unlocked).toBe(false);
    expect(restarted.pending.size).toBe(0);
  });
  it('failed page operations never echo private error text or payloads to diagnostics', async () => {
    const app = fixture(); const { requestId } = await app.preview();
    app.api.tabs.sendMessage.mockRejectedValueOnce(new Error('Applicant Example private request body'));
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    const listener = app.api.runtime.onMessage.addListener.mock.calls[0][0];
    const reply = vi.fn();
    listener({ action: 'collectPreview', requestId }, { id: 'fixture', url: 'moz-extension://fixture/preview.html' }, reply);
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({ ok: false, error: 'OPERATION_FAILED' }));
    for (const log of logs) { expect(JSON.stringify(log.mock.calls)).not.toContain('Applicant Example'); log.mockRestore(); }
  });
  it('rejects attributes outside the assigned record and learns by attribute identity', async () => {
    const app = fixture(); const collection = educationGroup(); const first = collection.records[0];
    first.attributes[0].value = 'Synthetic School'; const second = duplicate(first); collection.records.push(second);
    app.controller.vault.profile = { version: 2, groups: [collection] };
    const { requestId, result } = await app.preview();
    const selection = { fieldId: 'field-a', entryIds: [first.attributes[0].id], recordId: second.id, nestedRecordIds: [], similarity: 1 };
    await expect(app.call('fill', { requestId, selections: [selection] })).rejects.toThrow('INVALID_SELECTION');
    selection.recordId = first.id;
    app.controller.vault.save = vi.fn(async profile => { app.controller.vault.profile = profile; });
    await app.call('fill', { requestId, selections: [selection], learn: true });
    expect(app.controller.vault.profile.groups[0].records[0].attributes[0].aliases).toContain('fullName');
    expect(app.controller.vault.profile.groups[0].records[1].attributes[0].aliases).not.toContain('fullName');
    expect(result.records.filter(record => record.parentId === null)).toHaveLength(2);
    expect(result.records.some(record => record.parentId === first.id)).toBe(true);
  });
  it('enforces explicit combination and prevents stale model choices from another degree', async () => {
    const app = fixture(); const { requestId, result } = await app.preview();
    const selection = { fieldId: 'field-a', entryIds: result.entries.map(entry => entry.id), recordId: result.records[0].id, nestedRecordIds: [], similarity: 1 };
    await expect(app.call('fill', { requestId, selections: [selection] })).rejects.toThrow('INVALID_SELECTION');
    selection.separator = '; '; await app.call('fill', { requestId, selections: [selection] });
    expect(app.api.tabs.sendMessage).toHaveBeenLastCalledWith(42, expect.objectContaining({ items: [{ fieldId: 'field-a', value: 'Zebra Example; Applicant Example' }] }), { frameId: 0 });
  });
  it('opens only after separate approval and validates revealed scope selection', async () => {
    const app = fixture(); await app.controller.start({ menuItemId: 'openSubform' }, { id: 42, url: 'https://trusted.example' });
    const requestId = [...app.controller.pending.keys()][0];
    await expect(app.call('openSubform', { requestId, approveOpen: true })).rejects.toThrow('INVALID_SELECTION');
    app.api.tabs.sendMessage.mockResolvedValueOnce({ origin: 'https://trusted.example', token: 'document-a', label: 'Add education' });
    await app.call('inspectOpener', { requestId });
    await expect(app.call('openSubform', { requestId })).rejects.toThrow('INVALID_SELECTION');
    app.api.tabs.sendMessage.mockResolvedValueOnce({ origin: 'https://trusted.example', token: 'document-a', scopes: [{ id: 'new', label: 'Education', count: 2 }] });
    await app.call('openSubform', { requestId, approveOpen: true });
    await expect(app.call('openSubform', { requestId, approveOpen: true })).rejects.toThrow('INVALID_SELECTION');
    await expect(app.call('collectPreview', { requestId, scopeId: 'other' })).rejects.toThrow('INVALID_SELECTION');
    const result = await app.call('collectPreview', { requestId, scopeId: 'new' }); expect(result.fields).toHaveLength(1);
    expect(JSON.stringify(app.api.tabs.sendMessage.mock.calls)).not.toContain('Applicant Example');
  });
  it('a lock interrupts a pending opening and cancels page observation', async () => {
    const app = fixture(); await app.controller.start({ menuItemId: 'openSubform' }, { id: 42, url: 'https://trusted.example' });
    const requestId = [...app.controller.pending.keys()][0];
    app.api.tabs.sendMessage.mockResolvedValueOnce({ origin: 'https://trusted.example', token: 'document-a', label: 'Add education' }); await app.call('inspectOpener', { requestId });
    let resolveOpen; app.api.tabs.sendMessage.mockImplementationOnce(() => new Promise(resolve => { resolveOpen = resolve; }));
    const opening = app.call('openSubform', { requestId, approveOpen: true }); await vi.waitFor(() => expect(resolveOpen).toBeTypeOf('function'));
    await app.call('lock'); resolveOpen({ origin: 'https://trusted.example', token: 'document-a', scopes: [{ id: 'new', label: 'Education', count: 1 }] });
    await expect(opening).rejects.toThrow('PREVIEW_EXPIRED');
    expect(app.api.tabs.sendMessage).toHaveBeenCalledWith(42, expect.objectContaining({ action: 'cancel', requestId }), { frameId: 0 });
  });
  it('cancel bypasses the mutation queue to interrupt a pending opening', async () => {
    const app = fixture(); await app.controller.start({ menuItemId: 'openSubform' }, { id: 42, url: 'https://trusted.example' });
    const requestId = [...app.controller.pending.keys()][0];
    app.api.tabs.sendMessage.mockResolvedValueOnce({ origin: 'https://trusted.example', token: 'document-a', label: 'Add education' }); await app.call('inspectOpener', { requestId });
    let resolveOpen; app.api.tabs.sendMessage.mockImplementationOnce(() => new Promise(resolve => { resolveOpen = resolve; }));
    const opening = app.call('openSubform', { requestId, approveOpen: true }); await vi.waitFor(() => expect(resolveOpen).toBeTypeOf('function'));
    await app.call('cancelPreview', { requestId }); expect(app.controller.pending.size).toBe(0);
    resolveOpen({ error: 'STALE_DOCUMENT' }); await expect(opening).rejects.toThrow('PREVIEW_EXPIRED');
  });
  it('a lock while reading preview settings prevents returning decrypted records', async () => {
    const app = fixture(); await app.controller.start({ menuItemId: 'previewForm' }, { id: 42, url: 'https://trusted.example' });
    const requestId = [...app.controller.pending.keys()][0]; let reads = 0; let resolveSettings;
    const get = app.api.storage.local.get.getMockImplementation();
    app.api.storage.local.get.mockImplementation(key => key === 'preferences' && ++reads === 2
      ? new Promise(resolve => { resolveSettings = resolve; }) : get(key));
    const collecting = app.call('collectPreview', { requestId }); await vi.waitFor(() => expect(resolveSettings).toBeTypeOf('function'));
    await app.call('lock'); resolveSettings({ preferences: app.local.preferences });
    await expect(collecting).rejects.toThrow('PREVIEW_EXPIRED'); expect(app.controller.vault.profile).toBeNull();
  });
});
