import { cleanMetadata } from './js/utils.js';

export function installContent(api, doc = document) {
  if (doc.__aiFillInstalled) return;
  Object.defineProperty(doc, '__aiFillInstalled', { value: true });
  const token = crypto.randomUUID();
  const collections = new Map(); const openers = new Map(); const opened = new Map(); const watches = new Map();
  let clicked = null; let control = null;
  const selector = 'input, textarea, select, [contenteditable="true"]';
  const containers = 'fieldset, form, dialog, [role="dialog"], [role="group"]';
  const visible = el => {
    if (!el?.isConnected || el.ownerDocument !== doc || el.closest('[hidden], [inert]')) return false;
    for (let parent = el; parent; parent = parent.parentElement) {
      const style = doc.defaultView.getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity || 1) === 0) return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 &&
      rect.top < doc.defaultView.innerHeight && rect.left < doc.defaultView.innerWidth;
  };
  const eligible = el => {
    if (!visible(el) || el.disabled || el.readOnly || el.matches(':disabled')) return false;
    if (el.tagName === 'INPUT' && !['text', 'email', 'tel', 'number', 'url', 'search', 'date', 'month'].includes(el.type)) return false;
    if (el.tagName === 'SELECT') return el.options.length <= 200 && [...el.options].every(option => option.value.length <= 256) &&
      (el.multiple ? ![...el.selectedOptions].some(option => option.value !== '') : el.value === '');
    return 'value' in el ? el.value === '' : el.textContent === '';
  };
  const metadata = el => cleanMetadata({ name: el.getAttribute('name'), id: el.id,
    autocomplete: el.getAttribute('autocomplete'), 'aria-label': el.getAttribute('aria-label'),
    label: el.labels?.[0]?.textContent?.trim() });
  const type = el => el.tagName === 'SELECT' ? el.multiple ? 'select-multiple' : 'select-one' : el.type || 'text';
  const optionData = el => el.tagName === 'SELECT' ? [...el.options].map((option, index) => ({
    id: String(index), value: option.value, label: option.textContent.trim().slice(0, 256),
    disabled: option.disabled || option.parentElement?.disabled === true
  })) : undefined;
  const snapshot = el => JSON.stringify({ metadata: metadata(el), type: type(el), options: optionData(el) });
  const sectionLabel = el => (el?.getAttribute('aria-label') || el?.querySelector(':scope > legend')?.textContent ||
    (el?.tagName === 'DIALOG' || el?.getAttribute('role') === 'dialog' ? 'Dialog' : 'Form section')).trim().slice(0, 256);
  const controlLabel = el => (el?.getAttribute('aria-label') || el?.textContent || '').trim().slice(0, 256);
  const openingControl = el => visible(el) && !el.disabled && !el.matches(':disabled') &&
    (el.tagName !== 'BUTTON' || el.type === 'button') && /\b(add|edit)\b/i.test(controlLabel(el)) &&
    !/\b(save|submit|delete|remove|send|apply|purchase|pay)\b/i.test(controlLabel(el)) &&
    (el.tagName !== 'A' || (!el.target && (!el.getAttribute('href') || el.getAttribute('href').startsWith('#'))));

  doc.addEventListener('contextmenu', event => {
    if (!event.isTrusted) return;
    clicked = event.target?.closest?.(selector) ?? null;
    control = event.target?.closest?.('button, a, [role="button"]') ?? null;
  }, true);
  function prune(map) {
    for (const [id, item] of map) if (item.expires < Date.now()) map.delete(id);
    if (map.size >= 10) map.clear();
  }
  function collect(message, candidates, root) {
    prune(collections);
    const targets = new Map(); const sectionIds = new Map(); const sections = [];
    const fields = candidates.filter(eligible).slice(0, 200).map(el => {
      const section = el.closest(containers) || root || el;
      if (!sectionIds.has(section)) {
        const id = crypto.randomUUID(); sectionIds.set(section, id); sections.push({ id, label: sectionLabel(section) });
      }
      const id = crypto.randomUUID();
      targets.set(id, { el, form: el.form ?? null, section, root, metadata: snapshot(el) });
      return { id, sectionId: sectionIds.get(section), metadata: metadata(el), type: type(el), options: optionData(el) };
    });
    collections.set(message.requestId, { targets, expires: Date.now() + 120000 });
    return { token, origin: doc.location.origin, fields, sections };
  }
  function detectSubform(message, opener) {
    const before = new Set([...doc.querySelectorAll(selector)].filter(eligible));
    return new Promise(resolve => {
      let settle; let finished = false;
      const finish = result => {
        if (finished) return; finished = true; observer.disconnect(); clearTimeout(timeout); clearTimeout(settle);
        watches.delete(message.requestId); resolve(result);
      };
      const scan = () => {
        const fresh = [...doc.querySelectorAll(selector)].filter(el => eligible(el) && !before.has(el)).slice(0, 200);
        if (!fresh.length) return;
        const roots = new Map();
        for (const el of fresh) {
          const root = el.closest('dialog, [role="dialog"]') || el.closest(containers) || el.parentElement;
          if (!roots.has(root)) roots.set(root, []); roots.get(root).push(el);
        }
        const scopes = [...roots].slice(0, 20).map(([root, fields]) => ({ id: crypto.randomUUID(), root, fields }));
        prune(opened); opened.set(message.requestId, { scopes, expires: Date.now() + 120000 });
        finish({ token, origin: doc.location.origin, scopes: scopes.map(scope => ({ id: scope.id, label: sectionLabel(scope.root), count: scope.fields.length })) });
      };
      const observer = new doc.defaultView.MutationObserver(() => { clearTimeout(settle); settle = setTimeout(scan, 150); });
      const timeout = setTimeout(() => finish({ error: 'SUBFORM_NOT_FOUND' }), 10000);
      watches.set(message.requestId, () => finish({ error: 'STALE_DOCUMENT' }));
      observer.observe(doc.body, { subtree: true, childList: true, attributes: true });
      try { opener.click(); settle = setTimeout(scan, 150); } catch { finish({ error: 'FIELD_OPERATION_FAILED' }); }
    });
  }
  function handle(message) {
    if (message.origin !== doc.location.origin) return { error: 'ORIGIN_CHANGED' };
    if (message.action === 'cancel') {
      watches.get(message.requestId)?.(); collections.delete(message.requestId); openers.delete(message.requestId); opened.delete(message.requestId); return {};
    }
    if (message.action === 'inspectOpener') {
      if (!openingControl(control)) return { error: 'SELECT_OPEN_CONTROL' };
      prune(openers); openers.set(message.requestId, { el: control, label: controlLabel(control),
        htmlType: control.getAttribute('type'), href: control.getAttribute('href'), parent: control.parentElement, expires: Date.now() + 120000 });
      return { token, origin: doc.location.origin, label: controlLabel(control) };
    }
    if (message.action === 'openSubform') {
      const opener = openers.get(message.requestId); openers.delete(message.requestId);
      if (!opener || message.token !== token || opener.expires < Date.now() || !openingControl(opener.el) ||
          controlLabel(opener.el) !== opener.label || opener.el.parentElement !== opener.parent ||
          opener.el.getAttribute('href') !== opener.href || opener.el.getAttribute('type') !== opener.htmlType) return { error: 'STALE_DOCUMENT' };
      return detectSubform(message, opener.el);
    }
    if (message.action === 'collect') {
      if (message.scope === 'opened') {
        const operation = opened.get(message.requestId);
        const scope = operation?.scopes.find(scope => scope.id === message.scopeId);
        if (message.token !== token || !scope || operation.expires < Date.now() || !scope.root.isConnected) return { error: 'STALE_DOCUMENT' };
        return collect(message, scope.fields.filter(el => scope.root.contains(el)), scope.root);
      }
      if (!eligible(clicked)) return { error: 'SELECT_EMPTY_VISIBLE_FIELD' };
      const form = clicked.form ?? null;
      const root = message.scope === 'form' ? clicked.closest('dialog, [role="dialog"]') || form || clicked.closest(containers) : null;
      const candidates = root ? [...root.querySelectorAll(selector)].filter(el => !form || el.form === form ||
        (el.matches('[contenteditable="true"]') && el.closest('form') === form)) : [clicked];
      if (root === form && form) for (const el of form.elements) if (el.matches(selector) && !candidates.includes(el)) candidates.push(el);
      return collect(message, candidates, root);
    }
    if (message.action === 'apply') {
      const collection = collections.get(message.requestId); collections.delete(message.requestId); opened.delete(message.requestId);
      if (message.token !== token || !collection || collection.expires < Date.now()) return { error: 'STALE_DOCUMENT' };
      const filled = [];
      for (const item of (Array.isArray(message.items) ? message.items.slice(0, 200) : [])) {
        const target = collection.targets.get(item.fieldId);
        if (!target || typeof item.value !== 'string' || item.value.length > 20000 || !eligible(target.el) ||
            (target.el.form ?? null) !== target.form || (target.el.closest(containers) || target.root || target.el) !== target.section ||
            (target.root && !target.root.contains(target.el) && target.el.form !== target.root) || snapshot(target.el) !== target.metadata) continue;
        const el = target.el;
        if (el.tagName === 'SELECT') {
          const options = optionData(el);
          if (!Array.isArray(item.optionIds) || !item.optionIds.length || new Set(item.optionIds).size !== item.optionIds.length ||
              (!el.multiple && item.optionIds.length !== 1) || item.optionIds.some(id => !options.some(option => option.id === id && !option.disabled))) continue;
          const approved = item.optionIds.map(id => options.find(option => option.id === id).value);
          if (item.value !== approved.join(', ')) continue;
          for (let i = 0; i < el.options.length; i++) el.options[i].selected = item.optionIds.includes(String(i));
        } else if ('value' in el) {
          const proto = el.tagName === 'TEXTAREA' ? doc.defaultView.HTMLTextAreaElement.prototype : doc.defaultView.HTMLInputElement.prototype;
          if (['date', 'month', 'number'].includes(el.type)) {
            const check = doc.createElement('input'); check.type = el.type; check.value = item.value;
            if (check.value !== item.value || !check.validity.valid) continue;
          }
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, item.value);
        } else el.textContent = item.value;
        el.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
        el.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true })); filled.push(item.fieldId);
      }
      return { filled };
    }
    return { error: 'UNKNOWN_ACTION' };
  }
  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== api.runtime.id) return;
    try { Promise.resolve(handle(message)).then(respond, () => respond({ error: 'FIELD_OPERATION_FAILED' })); }
    catch { respond({ error: 'FIELD_OPERATION_FAILED' }); }
    return true;
  });
  doc.defaultView.addEventListener('pagehide', () => {
    for (const cancel of watches.values()) cancel(); collections.clear(); opened.clear(); openers.clear(); clicked = control = null;
  });
  return { handle };
}

if (typeof document !== 'undefined' && (globalThis.browser ?? globalThis.chrome)?.runtime) installContent(globalThis.browser ?? globalThis.chrome);
