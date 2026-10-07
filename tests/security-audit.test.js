// Audit reproductions: these assertions record vulnerable behavior, not safety
// guarantees. When fixing a finding, replace its assertion with a safety test.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const source = file => readFileSync(join(process.cwd(), 'src', file), 'utf8');
const syntheticValue = 'Applicant Example';

function runtimeContext(file, extra = {}) {
  const local = {};
  const sync = {};
  const area = data => ({
    get: vi.fn(async keys => Object.fromEntries(keys.map(key => [key, data[key]]))),
    set: vi.fn(async values => Object.assign(data, values)),
    remove: vi.fn(async keys => keys.forEach(key => delete data[key]))
  });
  const chrome = {
    runtime: {
      getManifest: () => ({ name: 'Audit fixture', version: '1.29.15' }),
      onInstalled: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
      sendMessage: vi.fn(),
    },
    storage: {
      sync: area(sync), local: area(local), session: area({}),
      onChanged: { addListener: vi.fn() }
    },
    contextMenus: { create: vi.fn(), onClicked: { addListener: vi.fn() } },
    tabs: { sendMessage: vi.fn().mockResolvedValue(undefined) }
  };
  const context = vm.createContext({
    chrome,
    console: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
    fetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ embedding: [1, 1] }) }),
    setTimeout: vi.fn(() => 1), clearTimeout: vi.fn(),
    ...extra
  });
  vm.runInContext(source(file), context, { filename: file });
  return { context, chrome, local, sync, run: code => vm.runInContext(code, context) };
}

function contentContext() {
  // Prevent startup listeners; individual real handlers are invoked below.
  const doc = new Proxy(document, {
    get(target, key) {
      if (key === 'readyState') return 'loading';
      if (key === 'addEventListener') return vi.fn();
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  return runtimeContext('content.js', {
    document: doc, window, CSS: { escape: value => value }, Event, navigator
  });
}

describe('Security audit reproductions (known unsafe behavior)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('exposes a rejected, low-confidence suggestion to page scripts before acceptance', () => {
    document.body.innerHTML = '<input id="fullName" type="text">';
    const app = contentContext();
    app.run('AIHelperSettings = { calcOnLoad: true };');
    app.context.proposal = {
      input: { id: 'fullName' },
      data: JSON.stringify({ closest: syntheticValue, similarity: 0.01, threshold: 0.9 })
    };
    app.run('showProposal(proposal);');
    const pageInput = document.getElementById('fullName');
    expect(pageInput.value).toBe('');
    expect(pageInput.getAttribute('data-suggestion')).toBe(syntheticValue);
    expect(pageInput.placeholder).toContain(syntheticValue);
  });

  it('accepts a page-created focus event as a request for personal-data suggestions', () => {
    document.body.innerHTML = '<input id="fullName" type="text">';
    const app = contentContext();
    app.run('setAutoSimilarityProposalOn(document, true);');
    const event = new FocusEvent('focus');
    expect(event.isTrusted).toBe(false);
    document.getElementById('fullName').dispatchEvent(event);
    expect(app.chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      action: 'fillAutoProposal', element: expect.stringContaining('fullName')
    }));
  });

  it('broadcasts personal-data proposals without specifying the requesting frame', async () => {
    const app = runtimeContext('background.js');
    app.run(`AIFillFormOptions = { 'Applicant Example': ['fullName'] };
      AIHelperSettings = { threshold: 0.5 };`);
    await app.run('setProposalValue([{ input: { id: "fullName" } }], { id: 42 });');
    const args = app.chrome.tabs.sendMessage.mock.calls[0];
    expect(args).toHaveLength(2);
    expect(args[1].action).toBe('showProposal');
    expect(args[1].element[0].data).toContain(syntheticValue);
  });

  it('collects bulk-fill candidates from all frames rather than the clicked frame', async () => {
    const app = runtimeContext('background.js');
    await app.run('executeFormFillRequest({ frameId: 0 }, { id: 42 }, "fieldsCollected");');
    expect(app.chrome.tabs.sendMessage).toHaveBeenCalledWith(42, { action: 'collectFields' });
  });

  it('retains the migration backup after the user clears the current form values', async () => {
    const app = runtimeContext('background.js');
    app.sync.AIFillForm = { fullName: syntheticValue };
    await app.run('getOptions();');
    app.sync.AIFillForm = {};
    expect(await app.run('getOptions();')).toEqual({});
    expect(app.local.AIFillForm_backup_old_format).toEqual({ fullName: syntheticValue });
  });

  it('sends saved aliases to the AI endpoint without directly sending saved values', async () => {
    const app = runtimeContext('background.js');
    app.run(`AIFillFormOptions = { 'Applicant Example': ['fullName'] };
      AIHelperSettings = { embeddings: [] };
      apiUrl = 'http://127.0.0.1:1234/v1/embeddings';`);
    await app.run('getStaticEmbeddings();');
    const [url, options] = app.context.fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:1234/v1/embeddings');
    expect(JSON.parse(options.body)).toEqual({ input: 'fullname' });
    expect(options.body).not.toContain(syntheticValue);
  });

  it('includes sensitive arbitrary data-* metadata in AI requests', async () => {
    const app = runtimeContext('background.js');
    app.run(`AIFillFormOptions = {};
      AIHelperSettings = { embeddings: [] };
      apiUrl = 'https://endpoint.example/embeddings';`);
    await app.run('getAttributeBestMatch({ "data-applicant": "privateSurname" });');
    expect(JSON.parse(app.context.fetch.mock.calls[0][1].body)).toEqual({ input: 'privatesurname' });
  });

  it('writes learned personal values to diagnostic logs', async () => {
    const app = runtimeContext('background.js');
    await app.run('learnFieldMapping("Applicant Example", { input: { name: "fullName" } });');
    expect(app.context.console.log).toHaveBeenCalledWith(expect.stringContaining(syntheticValue));
  });

  it('inserts a different private value than the label shown in the manual menu', async () => {
    const app = runtimeContext('background.js');
    app.run(`AIFillFormOptions = {
      'Zebra Example': ['lastName'], 'Applicant Example': ['fullName']
    }; AIHelperSettings = { threshold: 0.5 };`);
    await app.run('addDataAsMenu();');
    const menu = app.chrome.contextMenus.create.mock.calls
      .map(([item]) => item).find(item => item.id === 'value_0');
    expect(menu.title).toContain('Applicant Example');
    app.chrome.tabs.sendMessage.mockResolvedValueOnce([{ input: { id: 'fullName' } }]);
    await app.run('getAndProcessClickedElement({ id: 42 }, { menuItemId: "value_0", frameId: 0 });');
    const fill = app.chrome.tabs.sendMessage.mock.calls.find(([, message]) => message.action === 'fillFields');
    expect(JSON.parse(fill[1].data[0].data).closest).toBe('Zebra Example');
  });

  it('misclassifies a public hostname beginning with 10. as a local endpoint', () => {
    const realHelper = source('js/options.js').match(
      /function isLocalOrSecureEndpoint\(urlString\)\{[\s\S]*?\n    \}/
    )[0];
    const result = vm.runInNewContext(
      `${realHelper}\nisLocalOrSecureEndpoint("https://10.attacker.example/embeddings")`,
      { URL: globalThis.URL }
    );
    expect(result.isLocal).toBe(true);
    expect(result.isSecure).toBe(true);
  });
});
