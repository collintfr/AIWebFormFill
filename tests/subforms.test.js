import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { installContent } from '../src/content.js';

function fixture(html) {
  const doc = new JSDOM(html, { url: 'https://trusted.example' }).window.document;
  doc.defaultView.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 25, top: 10, left: 10, bottom: 35, right: 110 });
  const spy = vi.spyOn(doc, 'addEventListener'); const api = { runtime: { id: 'fixture', onMessage: { addListener: vi.fn() } } };
  const { handle } = installContent(api, doc);
  const contextmenu = spy.mock.calls.find(([event]) => event === 'contextmenu')[1];
  const click = (id, isTrusted = true) => contextmenu({ target: doc.getElementById(id), isTrusted });
  const call = (action, details = {}) => handle({ action, origin: doc.location.origin, requestId: 'request', ...details });
  return { doc, click, call };
}
describe('Scoped groups and native controls', () => {
  it('collects repeated sections separately and skips moved targets', () => {
    const app = fixture('<form><fieldset id="first"><legend>First degree</legend><input id="school" name="school"></fieldset><fieldset id="second"><legend>Second degree</legend><input name="school"></fieldset></form>');
    app.click('school'); const collected = app.call('collect', { scope: 'form' });
    expect(collected.sections.map(section => section.label)).toEqual(['First degree', 'Second degree']);
    expect(collected.fields[0].sectionId).not.toBe(collected.fields[1].sectionId);
    app.doc.getElementById('second').append(app.doc.getElementById('school'));
    expect(app.call('apply', { token: collected.token, items: [{ fieldId: collected.fields[0].id, value: 'Synthetic University' }] }).filled).toEqual([]);
  });
  it('scopes form-free modal fields together', () => {
    const app = fixture('<div role="dialog"><input id="school"><input id="major"></div><input id="outside">');
    app.click('school'); expect(app.call('collect', { scope: 'form' }).fields).toHaveLength(2);
  });
  it('fills selected native options and ISO dates with input/change events', () => {
    const app = fixture('<form><select id="major"><option value="">Choose</option><option value="math">Mathematics</option></select><input id="date" type="date"><input id="month" type="month"></form>');
    app.click('major'); const result = app.call('collect', { scope: 'form' });
    expect(result.fields.map(field => field.type)).toEqual(['select-one', 'date', 'month']);
    const changed = vi.fn(); app.doc.getElementById('major').addEventListener('change', changed);
    const items = [{ fieldId: result.fields[0].id, value: 'math', optionIds: ['1'] }, { fieldId: result.fields[1].id, value: '2024-02-29' }, { fieldId: result.fields[2].id, value: '2024-06' }];
    expect(app.call('apply', { token: result.token, items }).filled).toHaveLength(3);
    expect(app.doc.getElementById('major').value).toBe('math'); expect(changed).toHaveBeenCalledOnce();
  });
  it('skips populated selects, changed options and invalid dates', () => {
    const app = fixture('<form><select id="major"><option value="">Choose</option><option value="math">Mathematics</option></select><input id="date" type="date"></form>');
    app.click('major'); const result = app.call('collect', { scope: 'form' }); app.doc.getElementById('major').options[1].textContent = 'Changed';
    expect(app.call('apply', { token: result.token, items: [{ fieldId: result.fields[0].id, value: 'math', optionIds: ['1'] }, { fieldId: result.fields[1].id, value: '2024-02-30' }] }).filled).toEqual([]);
    app.doc.getElementById('major').value = 'math'; expect(app.call('collect').error).toBe('SELECT_EMPTY_VISIBLE_FIELD');
  });
  it('fills native multiselect values only through exact option references', () => {
    const app = fixture('<select id="major" multiple><option value="math">Mathematics</option><option value="physics">Physics</option></select>');
    app.click('major'); const result = app.call('collect');
    expect(app.call('apply', { token: result.token, items: [{ fieldId: result.fields[0].id, value: 'physics, math', optionIds: ['1', '0'] }] }).filled).toHaveLength(1);
    expect([...app.doc.getElementById('major').selectedOptions].map(option => option.value)).toEqual(['math', 'physics']);
  });
});

describe('One-use guided Add/Edit opening', () => {
  it('requires trusted selection and excludes submit and navigation controls', () => {
    const app = fixture('<button id="add" type="button">Add school</button><button id="submit">Add and submit</button><a id="link" href="/other">Edit school</a>');
    app.click('add', false); expect(app.call('inspectOpener').error).toBe('SELECT_OPEN_CONTROL');
    for (const id of ['submit', 'link']) { app.click(id); expect(app.call('inspectOpener').error).toBe('SELECT_OPEN_CONTROL'); }
    app.click('add'); expect(app.call('inspectOpener').label).toBe('Add school');
  });
  it.each(['inline', 'modal'])('opens a %s scope without filling, then collects only revealed fields', async kind => {
    const app = fixture('<button id="add" type="button">Add school</button><form><input id="old"></form><div id="new" hidden></div>');
    const root = app.doc.getElementById('new'); if (kind === 'modal') root.setAttribute('role', 'dialog'); else root.setAttribute('role', 'group');
    app.doc.getElementById('add').addEventListener('click', () => { root.hidden = false; root.innerHTML = '<input id="school" name="school"><input id="gpa" name="gpa">'; });
    app.click('add'); const inspected = app.call('inspectOpener');
    const opened = await app.call('openSubform', { token: inspected.token });
    expect(opened.scopes).toHaveLength(1); expect(app.doc.getElementById('school').value).toBe('');
    expect(app.call('openSubform', { token: inspected.token }).error).toBe('STALE_DOCUMENT');
    const collected = app.call('collect', { scope: 'opened', token: opened.token, scopeId: opened.scopes[0].id });
    expect(collected.fields).toHaveLength(2); expect(JSON.stringify(collected)).not.toContain('"old"');
    expect(app.call('apply', { token: collected.token, items: [{ fieldId: collected.fields[0].id, value: 'Synthetic University' }] }).filled).toHaveLength(1);
    expect(app.doc.getElementById('old').value).toBe(''); app.doc.defaultView.close();
  });
  it('requires scope selection when more than one group appears', async () => {
    const app = fixture('<button id="add" type="button">Add school</button>');
    app.doc.getElementById('add').addEventListener('click', () => {
      const wrap = app.doc.createElement('div'); wrap.innerHTML = '<fieldset><legend>A</legend><input></fieldset><fieldset><legend>B</legend><input></fieldset>'; app.doc.body.append(wrap);
    });
    app.click('add'); const inspected = app.call('inspectOpener'); const opened = await app.call('openSubform', { token: inspected.token });
    expect(opened.scopes).toHaveLength(2);
    expect(app.call('collect', { scope: 'opened', token: opened.token }).error).toBe('STALE_DOCUMENT');
    expect(app.call('collect', { scope: 'opened', token: opened.token, scopeId: opened.scopes[1].id }).fields).toHaveLength(1); app.doc.defaultView.close();
  });
  it('rejects relabeled, moved and expired openers', () => {
    for (const mutation of ['label', 'move', 'type', 'token']) {
      const app = fixture('<button id="add" type="button">Add school</button><div id="other"></div>'); app.click('add'); const inspected = app.call('inspectOpener');
      const button = app.doc.getElementById('add');
      if (mutation === 'label') button.textContent = 'Edit school';
      if (mutation === 'move') app.doc.getElementById('other').append(button);
      if (mutation === 'type') button.type = 'submit';
      expect(app.call('openSubform', { token: mutation === 'token' ? 'changed' : inspected.token }).error).toBe('STALE_DOCUMENT');
    }
  });
  it('times out and disconnects rather than collecting unrelated fields later', async () => {
    vi.useFakeTimers();
    try {
      const app = fixture('<button id="add" type="button">Add school</button>'); app.click('add'); const inspected = app.call('inspectOpener');
      const opening = app.call('openSubform', { token: inspected.token }); await vi.advanceTimersByTimeAsync(10000);
      expect(await opening).toEqual({ error: 'SUBFORM_NOT_FOUND' });
      const input = app.doc.createElement('input'); app.doc.body.append(input); await vi.advanceTimersByTimeAsync(200);
      expect(app.call('collect', { scope: 'opened', token: inspected.token, scopeId: 'unknown' }).error).toBe('STALE_DOCUMENT'); app.doc.defaultView.close();
    } finally { vi.useRealTimers(); }
  });
  it('cancels observation and exact field references when the session ends', async () => {
    const app = fixture('<button id="add" type="button">Add school</button>'); app.click('add'); const inspected = app.call('inspectOpener');
    const opening = app.call('openSubform', { token: inspected.token }); app.call('cancel');
    expect(await opening).toEqual({ error: 'STALE_DOCUMENT' }); app.doc.defaultView.close();
  });
});
