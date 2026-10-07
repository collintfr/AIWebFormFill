import { cleanMetadata } from './js/utils.js';

export function installContent(api, doc = document) {
  if (doc.__aiFillInstalled) return;
  Object.defineProperty(doc, '__aiFillInstalled', { value: true });
  const token = crypto.randomUUID();
  const collections = new Map();
  let clicked = null;
  const selector = 'input, textarea, [contenteditable="true"]';
  const eligible = el => {
    if (!el?.isConnected || el.ownerDocument !== doc || el.disabled || el.readOnly) return false;
    if (el.tagName === 'INPUT' && !['text', 'email', 'tel', 'number', 'url', 'search'].includes(el.type)) return false;
    if ('value' in el ? el.value !== '' : el.textContent !== '') return false;
    if (el.closest('[hidden], [inert]')) return false;
    const style = doc.defaultView.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) !== 0 &&
      rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 &&
      rect.top < doc.defaultView.innerHeight && rect.left < doc.defaultView.innerWidth;
  };
  const metadata = el => cleanMetadata({ name: el.getAttribute('name'), id: el.id,
    autocomplete: el.getAttribute('autocomplete'), 'aria-label': el.getAttribute('aria-label'),
    label: el.labels?.[0]?.textContent?.trim() });

  doc.addEventListener('contextmenu', event => {
    if (!event.isTrusted) return;
    clicked = event.target?.closest?.(selector) ?? null;
  }, true);

  function handle(message) {
    if (message.origin !== doc.location.origin) return { error: 'ORIGIN_CHANGED' };
    if (message.action === 'collect') {
      if (!eligible(clicked)) return { error: 'SELECT_EMPTY_VISIBLE_FIELD' };
      for (const [id, collection] of collections) {
        if (collection.expires < Date.now()) collections.delete(id);
      }
      if (collections.size >= 10) collections.clear();
      const form = clicked.form ?? null;
      const candidates = message.scope === 'form' && form
        ? Array.from(form.elements).filter(el => el.matches(selector) && el.form === form)
        : [clicked];
      const targets = new Map();
      const fields = candidates.filter(eligible).slice(0, 200).map(el => {
        const id = crypto.randomUUID();
        const info = metadata(el);
        targets.set(id, { el, form: el.form ?? null, metadata: JSON.stringify(info) });
        return { id, metadata: info };
      });
      collections.set(message.requestId, { targets, expires: Date.now() + 120000 });
      return { token, origin: doc.location.origin, fields };
    }
    if (message.action === 'apply') {
      const collection = collections.get(message.requestId);
      collections.delete(message.requestId);
      if (message.token !== token || !collection || collection.expires < Date.now()) {
        return { error: 'STALE_DOCUMENT' };
      }
      const filled = [];
      for (const item of (Array.isArray(message.items) ? message.items.slice(0, 200) : [])) {
        const target = collection.targets.get(item.fieldId);
        if (!target || typeof item.value !== 'string' || item.value.length > 20000 ||
            !eligible(target.el) || (target.el.form ?? null) !== target.form ||
            JSON.stringify(metadata(target.el)) !== target.metadata) continue;
        const el = target.el;
        if ('value' in el) {
          const proto = el.tagName === 'TEXTAREA' ? doc.defaultView.HTMLTextAreaElement.prototype : doc.defaultView.HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, item.value);
        } else el.textContent = item.value;
        el.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
        el.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
        filled.push(item.fieldId);
      }
      return { filled };
    }
    return { error: 'UNKNOWN_ACTION' };
  }
  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== api.runtime.id) return;
    try { respond(handle(message)); } catch { respond({ error: 'FIELD_OPERATION_FAILED' }); }
  });
  return { handle };
}

if (typeof document !== 'undefined' && (globalThis.browser ?? globalThis.chrome)?.runtime) {
  installContent(globalThis.browser ?? globalThis.chrome);
}
