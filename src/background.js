import { Vault } from './js/vault.js';
import { cleanMetadata, originOf, sitePattern } from './js/utils.js';

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
        scope: info.menuItemId === 'previewForm' ? 'form' : 'field', expires: Date.now() + 120000,
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
      case 'collectPreview': {
        if (!vault.unlocked) throw new Error('LOCKED');
        const op = request(message.requestId);
        if (!await authorized(op.origin)) throw new Error('PERMISSION_REQUIRED');
        // An embedded destination must be approved for this particular operation, too.
        if (op.origin !== op.topOrigin && message.approveFrame !== true) throw new Error('FRAME_APPROVAL_REQUIRED');
        const result = await api.tabs.sendMessage(op.tabId, { action: 'collect', requestId: op.id,
          origin: op.origin, scope: op.scope }, { frameId: op.frameId });
        request(op.id);
        if (result?.error) throw new Error(result.error);
        if (result?.origin !== op.origin || typeof result.token !== 'string' || !Array.isArray(result.fields) || result.fields.length > 200) {
          throw new Error('INVALID_FIELDS');
        }
        op.token = result.token;
        op.fields = result.fields.map(field => ({ id: field.id, metadata: cleanMetadata(field.metadata) }));
        if (op.fields.some(field => typeof field.id !== 'string' || field.id.length > 100) ||
            new Set(op.fields.map(field => field.id)).size !== op.fields.length) throw new Error('INVALID_FIELDS');
        op.entries = Object.entries(vault.profile).map(([value, aliases]) => ({ id: crypto.randomUUID(), value, aliases }));
        return { fields: op.fields, entries: op.entries, threshold: (await settings()).threshold };
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
          const entry = op.entries.find(entry => entry.id === selection.entryId);
          if (!field || !entry || ids.has(field.id) || !Number.isFinite(selection.similarity) || selection.similarity < threshold || selection.similarity > 1) {
            throw new Error('INVALID_SELECTION');
          }
          ids.add(field.id);
          return { fieldId: field.id, value: entry.value };
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
            const entry = op.entries.find(entry => entry.id === selection.entryId);
            const alias = field.metadata.name || field.metadata.id || field.metadata['aria-label'];
            if (alias && profile[entry.value].length < 100 && !profile[entry.value].includes(alias)) profile[entry.value].push(alias);
          }
          try { await vault.save(profile); learned = true; } catch { /* Insertion already succeeded; do not misreport it. */ }
        }
        return { filled: result?.filled?.length ?? 0, learned };
      }
      default: throw new Error('UNKNOWN_ACTION');
    }
  }
  function handle(message, sender) {
    // Lock is immediate; ongoing async work must fail its epoch check.
    if (message?.action === 'lock' && uiSender(sender)) return dispatch(message, sender);
    const task = queue.then(async () => {
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
    handle(message, sender).then(value => respond({ ok: true, value }), error => respond({
      ok: false, error: codes.has(error.message) ? error.message : 'OPERATION_FAILED'
    }));
    return true;
  });
  async function initialize() {
    await ensureCleanStorage();
    await api.contextMenus.removeAll();
    for (const [id, title] of [['previewField', 'Preview this field'], ['previewForm', 'Preview this form']]) {
      api.contextMenus.create({ id, title, contexts: ['editable'] });
    }
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
