import { Vault } from './js/vault.js';
import { cleanMetadata, originOf, sitePattern } from './js/utils.js';
import { flattenProfile, findAttribute } from './js/profile.js';
import { allowedEntries, destinationValue } from './js/matching.js';

export function createController(api) {
  const vault = new Vault(api.storage.local);
  const pending = new Map();
  let queue = Promise.resolve();
  const obsoleteLocalKeys = ['AIFillForm', 'AIFillForm_backup_old_format', 'backup_timestamp',
    'staticEmbeddings', 'settings', 'aiSession'];
  let cleanup;
  function ensureCleanStorage() {
    cleanup ??= (async () => {
      // Delete without loading plaintext into background memory. Version 2 uses
      // neither sync nor session storage; retain only its local vault/preferences.
      await api.storage.sync.clear();
      await api.storage.local.remove(obsoleteLocalKeys);
      if (api.storage.session) await api.storage.session.clear();
    })().catch(() => {
      cleanup = null;
      throw new Error('STORAGE_CLEANUP_FAILED');
    });
    return cleanup;
  }
  ensureCleanStorage().catch(() => console.warn('STORAGE_CLEANUP_FAILED'));
  api.storage.onChanged.addListener((changes, area) => {
    const reintroduced = Object.entries(changes).some(([key, change]) =>
      change.newValue !== undefined && (area === 'sync' || area === 'session' ||
        (area === 'local' && obsoleteLocalKeys.includes(key))));
    if (reintroduced) {
      cleanup = null;
      ensureCleanStorage().catch(() => console.warn('STORAGE_CLEANUP_FAILED'));
    }
  });
  const uiSender = sender => {
    if (sender.id !== api.runtime.id || !sender.url) return false;
    const url = new URL(sender.url);
    return ['options.html', 'preview.html'].some(page => {
      const expected = new URL(api.runtime.getURL(page));
      return url.protocol === expected.protocol && url.host === expected.host && url.pathname === expected.pathname;
    });
  };
  async function invalidate(lock = false) {
    if (lock) vault.lock(); else vault.epoch++;
    for (const op of pending.values()) api.tabs.sendMessage(op.tabId, { action: 'cancel',
      requestId: op.id, origin: op.origin }, { frameId: op.frameId }).catch(() => {});
    pending.clear();
    await api.runtime.sendMessage({ action: 'sessionChanged' }).catch(() => {});
  }
  async function settings() {
    const stored = (await api.storage.local.get('preferences')).preferences ?? {};
    return { threshold: Number.isFinite(stored.threshold) ? Math.max(0, Math.min(1, stored.threshold)) : 0.5,
      sites: Array.isArray(stored.sites) ? stored.sites : [] };
  }
  async function authorized(origin) {
    return (await settings()).sites.includes(origin) && await api.permissions.contains({ origins: [sitePattern(origin)] });
  }
  async function registerSites() {
    await api.scripting.unregisterContentScripts();
    const patterns = [];
    for (const origin of (await settings()).sites) {
      if (await authorized(origin)) patterns.push(sitePattern(origin));
    }
    if (patterns.length) await api.scripting.registerContentScripts([{ id: 'approved-sites',
      matches: [...new Set(patterns)], js: ['content.js'], allFrames: true, runAt: 'document_start' }]);
  }
  function request(id) {
    const op = pending.get(id);
    if (!op || op.expires < Date.now() || op.epoch !== vault.epoch) {
      pending.delete(id); throw new Error('PREVIEW_EXPIRED');
    }
    return op;
  }
  async function start(info, tab) {
    try {
      await ensureCleanStorage();
      const origin = originOf(info.frameUrl || tab.url);
      const topOrigin = originOf(tab.url);
      const id = crypto.randomUUID();
      for (const [key, op] of pending) if (op.expires < Date.now()) pending.delete(key);
      if (pending.size >= 20) pending.clear();
      pending.set(id, { id, origin, topOrigin, frameId: info.frameId ?? 0, tabId: tab.id,
        scope: info.menuItemId === 'openSubform' ? 'opener' : info.menuItemId === 'previewForm' ? 'form' : 'field', expires: Date.now() + 120000,
        epoch: vault.epoch });
      setTimeout(() => pending.delete(id), 120000);
      await api.windows.create({ url: api.runtime.getURL(`preview.html?request=${id}`), type: 'popup', width: 780, height: 700 });
    } catch { console.warn('PREVIEW_UNAVAILABLE'); }
  }
  async function dispatch(message, sender) {
    if (!uiSender(sender)) throw new Error('UNAUTHORIZED');
    switch (message.action) {
      case 'status': {
        return { exists: await vault.exists(), unlocked: vault.unlocked, epoch: vault.epoch,
          preferences: await settings() };
      }
      case 'create': await vault.create(message.passphrase); return true;
      case 'unlock': await vault.unlock(message.passphrase); return true;
      case 'lock': await invalidate(true); return true;
      case 'invalidateModel': await invalidate(); return true;
      case 'profile': if (!vault.unlocked) throw new Error('LOCKED'); return vault.profile;
      case 'save': await vault.save(message.profile); await invalidate(); return true;
      case 'changePassphrase':
        if (!vault.unlocked) throw new Error('LOCKED');
        await vault.replace(vault.profile, message.passphrase); await invalidate(); return true;
      case 'export': return vault.export();
      case 'import': await vault.import(message.envelope, message.passphrase); await invalidate(); return true;
      case 'clearAll':
        await invalidate(true);
        await api.storage.sync.clear(); await api.storage.local.clear();
        if (api.storage.session) await api.storage.session.clear();
        for (const key of await caches.keys()) await caches.delete(key);
        await api.scripting.unregisterContentScripts();
        return true;
      case 'preferences': {
        const prefs = await settings();
        if (!Number.isFinite(message.threshold) || message.threshold < 0 || message.threshold > 1) throw new Error('INVALID_THRESHOLD');
        prefs.threshold = message.threshold;
        await api.storage.local.set({ preferences: prefs }); await invalidate(); return true;
      }
      case 'approveSite': {
        const origin = originOf(message.origin);
        if (!await api.permissions.contains({ origins: [sitePattern(origin)] })) throw new Error('PERMISSION_REQUIRED');
        const prefs = await settings();
        prefs.sites = [...new Set([...prefs.sites, origin])];
        await api.storage.local.set({ preferences: prefs }); await registerSites(); return true;
      }
      case 'revokeSite': {
        const prefs = await settings();
        prefs.sites = prefs.sites.filter(site => site !== message.origin);
        await api.storage.local.set({ preferences: prefs });
        await invalidate(); await registerSites(); return true;
      }
      case 'previewInfo': {
        const op = request(message.requestId);
        return { origin: op.origin, topOrigin: op.topOrigin, approved: await authorized(op.origin), scope: op.scope };
      }
      case 'cancelPreview': {
        const op = pending.get(message.requestId);
        if (op) { pending.delete(op.id); await api.tabs.sendMessage(op.tabId, { action: 'cancel', requestId: op.id,
          origin: op.origin }, { frameId: op.frameId }).catch(() => {}); }
        return true;
      }
      case 'inspectOpener':
      case 'openSubform': {
        if (!vault.unlocked) throw new Error('LOCKED');
        const op = request(message.requestId);
        if (!await authorized(op.origin)) throw new Error('PERMISSION_REQUIRED');
        if (op.origin !== op.topOrigin && message.approveFrame !== true) throw new Error('FRAME_APPROVAL_REQUIRED');
        if (op.scope !== 'opener' || (message.action === 'openSubform' && (!op.openerToken || op.openUsed || message.approveOpen !== true))) throw new Error('INVALID_SELECTION');
        request(op.id);
        if (message.action === 'openSubform') op.openUsed = true;
        const result = await api.tabs.sendMessage(op.tabId, { action: message.action, requestId: op.id,
          origin: op.origin, token: op.openerToken }, { frameId: op.frameId });
        request(op.id);
        if (!await authorized(op.origin)) throw new Error('PERMISSION_REQUIRED');
        request(op.id);
        if (result?.error) throw new Error(result.error);
        if (result?.origin !== op.origin || typeof result.token !== 'string' || result.token.length > 100) throw new Error('INVALID_FIELDS');
        if (message.action === 'inspectOpener') {
          if (typeof result.label !== 'string' || result.label.length > 256) throw new Error('INVALID_FIELDS');
          op.openerToken = result.token; return { label: result.label };
        }
        if (result.token !== op.openerToken || !Array.isArray(result.scopes) || !result.scopes.length || result.scopes.length > 20 ||
            result.scopes.some(scope => typeof scope.id !== 'string' || scope.id.length > 100 || typeof scope.label !== 'string' || scope.label.length > 256 || !Number.isInteger(scope.count) || scope.count < 1 || scope.count > 200) ||
            new Set(result.scopes.map(scope => scope.id)).size !== result.scopes.length) throw new Error('INVALID_FIELDS');
        op.scope = 'opened'; op.scopes = result.scopes.map(({ id, label, count }) => ({ id, label, count }));
        return { scopes: op.scopes };
      }
      case 'collectPreview': {
        if (!vault.unlocked) throw new Error('LOCKED');
        const op = request(message.requestId);
        if (!await authorized(op.origin)) throw new Error('PERMISSION_REQUIRED');
        // An embedded destination must be approved for this particular operation, too.
        if (op.origin !== op.topOrigin && message.approveFrame !== true) throw new Error('FRAME_APPROVAL_REQUIRED');
        if (op.scope === 'opener' || (op.scope === 'opened' && !op.scopes?.some(scope => scope.id === message.scopeId))) throw new Error('INVALID_SELECTION');
        const result = await api.tabs.sendMessage(op.tabId, { action: 'collect', requestId: op.id,
          origin: op.origin, scope: op.scope, ...(op.scope === 'opened' ? { scopeId: message.scopeId, token: op.openerToken } : {}) }, { frameId: op.frameId });
        request(op.id);
        if (result?.error) throw new Error(result.error);
        if (result?.origin !== op.origin || typeof result.token !== 'string' || !result.token || result.token.length > 100 || !Array.isArray(result.fields) || result.fields.length > 200) {
          throw new Error('INVALID_FIELDS');
        }
        op.token = result.token;
        if (!Array.isArray(result.sections) || result.sections.length > 200 || result.sections.some(section =>
          typeof section.id !== 'string' || section.id.length > 100 || typeof section.label !== 'string' || section.label.length > 256) ||
          new Set(result.sections.map(section => section.id)).size !== result.sections.length) throw new Error('INVALID_FIELDS');
        op.sections = result.sections.map(({ id, label }) => ({ id, label }));
        op.fields = result.fields.map(field => {
          if (!op.sections.some(section => section.id === field.sectionId) || !['text', 'email', 'tel', 'number', 'url', 'search', 'date', 'month', 'textarea', 'select-one', 'select-multiple'].includes(field.type)) throw new Error('INVALID_FIELDS');
          const clean = { id: field.id, sectionId: field.sectionId, type: field.type, metadata: cleanMetadata(field.metadata) };
          if (['select-one', 'select-multiple'].includes(field.type)) {
            if (!Array.isArray(field.options) || field.options.length > 200 || field.options.some(option =>
              typeof option.id !== 'string' || option.id.length > 100 || typeof option.value !== 'string' || option.value.length > 256 ||
              typeof option.label !== 'string' || option.label.length > 256 || typeof option.disabled !== 'boolean') ||
              new Set(field.options.map(option => option.id)).size !== field.options.length) throw new Error('INVALID_FIELDS');
            clean.options = field.options.map(({ id, value, label, disabled }) => ({ id, value, label, disabled }));
          }
          return clean;
        });
        if (op.fields.some(field => typeof field.id !== 'string' || field.id.length > 100) ||
            new Set(op.fields.map(field => field.id)).size !== op.fields.length) throw new Error('INVALID_FIELDS');
        const flattened = flattenProfile(vault.profile); op.entries = flattened.entries; op.records = flattened.records;
        const threshold = (await settings()).threshold;
        request(op.id);
        return { fields: op.fields, sections: op.sections, entries: op.entries, records: op.records, threshold };
      }
      case 'fill': {
        if (!vault.unlocked) throw new Error('LOCKED');
        const op = request(message.requestId);
        if (!op.fields || !await authorized(op.origin) || !Array.isArray(message.selections) || message.selections.length > 200) {
          throw new Error('INVALID_SELECTION');
        }
        const threshold = (await settings()).threshold;
        const ids = new Set();
        const items = message.selections.map(selection => {
          const field = op.fields.find(field => field.id === selection.fieldId);
          const entryIds = selection.entryIds ?? [selection.entryId];
          if (!Array.isArray(entryIds) || !entryIds.length || entryIds.length > 1000 || new Set(entryIds).size !== entryIds.length ||
              !Array.isArray(selection.nestedRecordIds) || selection.nestedRecordIds.length > 2000) throw new Error('INVALID_SELECTION');
          const candidates = allowedEntries(op.entries, op.records, selection.recordId, selection.nestedRecordIds);
          const entries = entryIds.map(id => candidates.find(entry => entry.id === id));
          if (!field || entries.some(entry => !entry) || ids.has(field.id) || !Number.isFinite(selection.similarity) || selection.similarity < threshold || selection.similarity > 1) {
            throw new Error('INVALID_SELECTION');
          }
          ids.add(field.id);
          const destination = destinationValue(field, entries, selection.separator);
          if (!destination) throw new Error('INVALID_SELECTION');
          return { fieldId: field.id, ...destination };
        });
        request(op.id);
        pending.delete(op.id);
        const result = await api.tabs.sendMessage(op.tabId, { action: 'apply', requestId: op.id,
          origin: op.origin, token: op.token, items }, { frameId: op.frameId });
        if (result?.error) throw new Error(result.error);
        let learned = false;
        if (message.learn === true && result?.filled?.length && vault.unlocked && vault.epoch === op.epoch) {
          vault.check(op.epoch);
          const profile = structuredClone(vault.profile);
          for (const selection of message.selections) {
            if (!result.filled.includes(selection.fieldId)) continue;
            const field = op.fields.find(field => field.id === selection.fieldId);
            const selectedIds = selection.entryIds ?? [selection.entryId];
            if (selectedIds.length !== 1) continue;
            const entry = findAttribute(profile, selectedIds[0]);
            const alias = field.metadata.name || field.metadata.id || field.metadata['aria-label'];
            if (entry && alias && entry.aliases.length < 100 && !entry.aliases.includes(alias)) entry.aliases.push(alias);
          }
          try { await vault.save(profile); learned = true; } catch { /* Insertion already succeeded; do not misreport it. */ }
        }
        return { filled: result?.filled?.length ?? 0, learned };
      }
      default: throw new Error('UNKNOWN_ACTION');
    }
  }
  function handle(message, sender) {
    // Cancellation and lock must interrupt an opening rather than queue behind its observer.
    if (['lock', 'cancelPreview'].includes(message?.action) && uiSender(sender)) return dispatch(message, sender);
    // Stop active page work immediately, but keep storage mutations serialized.
    const interrupted = ['revokeSite', 'clearAll'].includes(message?.action) && uiSender(sender)
      ? invalidate(message.action === 'clearAll') : Promise.resolve();
    const task = queue.then(async () => {
      await interrupted;
      if (!uiSender(sender)) throw new Error('UNAUTHORIZED');
      await ensureCleanStorage();
      return dispatch(message ?? {}, sender);
    });
    queue = task.catch(() => {});
    return task;
  }
  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.action === 'sessionChanged') return;
    const codes = new Set(['LOCKED', 'PASSPHRASE_LENGTH', 'UNLOCK_FAILED', 'INVALID_PROFILE',
      'ENCRYPTED_BACKUP_REQUIRED', 'INVALID_BACKUP', 'PREVIEW_EXPIRED', 'PERMISSION_REQUIRED',
      'FRAME_APPROVAL_REQUIRED', 'SELECT_EMPTY_VISIBLE_FIELD', 'STALE_DOCUMENT', 'ORIGIN_CHANGED',
      'INVALID_SELECTION', 'VAULT_EXISTS', 'SESSION_CHANGED', 'STORAGE_CLEANUP_FAILED']);
    codes.add('SELECT_OPEN_CONTROL'); codes.add('SUBFORM_NOT_FOUND');
    handle(message, sender).then(value => respond({ ok: true, value }), error => respond({
      ok: false, error: codes.has(error.message) ? error.message : 'OPERATION_FAILED'
    }));
    return true;
  });
  async function initialize() {
    await ensureCleanStorage();
    await api.contextMenus.removeAll();
    for (const [id, title] of [['previewField', 'Preview this field'], ['previewForm', 'Preview this form']]) {
      // Native select/date controls do not consistently count as "editable" across browsers.
      api.contextMenus.create({ id, title, contexts: ['all'] });
    }
    api.contextMenus.create({ id: 'openSubform', title: 'Preview opening this Add/Edit control', contexts: ['all'] });
    await registerSites();
  }
  api.runtime.onInstalled.addListener(() => {
    initialize().catch(() => console.warn('INITIALIZATION_FAILED'));
    api.runtime.openOptionsPage();
  });
  api.runtime.onStartup.addListener(() => initialize().catch(() => console.warn('INITIALIZATION_FAILED')));
  api.contextMenus.onClicked.addListener(start);
  api.action.onClicked.addListener(() => api.runtime.openOptionsPage());
  api.permissions.onRemoved.addListener(() => invalidate().then(registerSites).catch(() => {}));
  api.tabs.onRemoved.addListener(tabId => {
    for (const [id, op] of pending) if (op.tabId === tabId) pending.delete(id);
  });
  return { handle, start, vault, pending, initialize };
}

if ((globalThis.browser ?? globalThis.chrome)?.runtime) createController(globalThis.browser ?? globalThis.chrome);
