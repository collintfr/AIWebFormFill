import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installContent } from '../src/content.js';
import { JSDOM } from 'jsdom';
function content() {
  const doc = new JSDOM('', { url: 'https://trusted.example' }).window.document;
  doc.body.innerHTML = '<form id="a"><input id="name" name="fullName" placeholder="Your name" data-applicant="private"><input id="email" type="email"></form><form id="b"><input id="unrelated"></form><input id="outside"><input id="password" type="password">';
  for (const el of doc.querySelectorAll('input')) el.getBoundingClientRect = () => ({ width: 100, height: 25, top: 10, left: 10, bottom: 35, right: 110 });
  const events = vi.spyOn(doc, 'addEventListener');
  const api = { runtime: { id: 'fixture', onMessage: { addListener: vi.fn() }, sendMessage: vi.fn() } };
  const { handle } = installContent(api, doc);
  const contextmenu = events.mock.calls.find(([type]) => type === 'contextmenu')[1];
  const click = (id = 'name', isTrusted = true) => contextmenu({ target: doc.getElementById(id), isTrusted });
  const collect = (scope = 'form', requestId = 'request-a') => handle({ action: 'collect', scope, origin: doc.location.origin, requestId });
  const apply = (result, items, extra = {}) => handle({ action: 'apply', origin: doc.location.origin,
    requestId: 'request-a', token: result.token, items, ...extra });
  return { doc, api, click, collect, apply, handle };
}
describe('A01/A02/A05 page isolation regressions', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  it('focusing an input never requests or exposes a private value', () => {
    const app = content(); const field = app.doc.getElementById('name');
    field.dispatchEvent(new FocusEvent('focus'));
    expect(app.api.runtime.sendMessage).not.toHaveBeenCalled();
    expect(field.placeholder).toBe('Your name'); expect(field.hasAttribute('data-suggestion')).toBe(false);
    expect(app.handle({ action: 'showProposal', origin: app.doc.location.origin, value: 'Applicant Example' }).error).toBe('UNKNOWN_ACTION');
  });
  it('rejects page-generated context selection', () => {
    const app = content(); app.click('name', false);
    expect(app.collect().error).toBe('SELECT_EMPTY_VISIBLE_FIELD');
  });
  it('collects only the clicked form and excludes arbitrary metadata', () => {
    const app = content(); app.click(); const result = app.collect();
    expect(result.fields).toHaveLength(2);
    expect(result.fields[0].metadata).toMatchObject({ name: 'fullName', id: 'name' });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(JSON.stringify(result)).not.toContain('unrelated');
    expect(JSON.stringify(result)).not.toContain('outerHtml');
    expect(app.doc.getElementById('name').value).toBe('');
  });
  it('uses single-field scope for form-free fields and excludes passwords', () => {
    const app = content(); app.click('outside'); expect(app.collect().fields).toHaveLength(1);
    app.click('password'); expect(app.collect().error).toBe('SELECT_EMPTY_VISIBLE_FIELD');
  });
  it('checks visibility, viewport, disabled and readonly states', () => {
    const app = content(); const field = app.doc.getElementById('name'); app.click();
    field.style.display = 'none'; expect(app.collect().error).toBe('SELECT_EMPTY_VISIBLE_FIELD');
    field.style.display = ''; field.disabled = true; expect(app.collect().error).toBe('SELECT_EMPTY_VISIBLE_FIELD');
    field.disabled = false; field.readOnly = true; expect(app.collect().error).toBe('SELECT_EMPTY_VISIBLE_FIELD');
    field.readOnly = false; field.getBoundingClientRect = () => ({ width: 100, height: 25, top: 10000, left: 10, bottom: 10025, right: 110 });
    expect(app.collect().error).toBe('SELECT_EMPTY_VISIBLE_FIELD');
  });
  it('fills exact approved references only once and dispatches input/change', () => {
    const app = content(); app.click(); const result = app.collect();
    const field = app.doc.getElementById('name'); const input = vi.fn(); const change = vi.fn();
    field.addEventListener('input', input); field.addEventListener('change', change);
    const items = [{ fieldId: result.fields[0].id, value: 'Applicant Example' }];
    expect(app.apply(result, items).filled).toEqual([result.fields[0].id]);
    expect(field.value).toBe('Applicant Example'); expect(app.doc.getElementById('unrelated').value).toBe('');
    expect(input).toHaveBeenCalledOnce(); expect(change).toHaveBeenCalledOnce();
    expect(app.apply(result, items).error).toBe('STALE_DOCUMENT');
  });
  it('skips populated, removed, relabeled and moved elements', () => {
    for (const mutation of ['populate', 'remove', 'relabel', 'move']) {
      const app = content(); app.click(); const result = app.collect(); const field = app.doc.getElementById('name');
      if (mutation === 'populate') field.value = 'Page-owned text';
      if (mutation === 'remove') field.remove();
      if (mutation === 'relabel') field.name = 'other';
      if (mutation === 'move') app.doc.getElementById('b').append(field);
      expect(app.apply(result, [{ fieldId: result.fields[0].id, value: 'Applicant Example' }]).filled).toEqual([]);
      expect(field.value).not.toBe('Applicant Example');
    }
  });
  it('rejects changed origins, document tokens and uncollected fields', () => {
    const app = content(); app.click(); const result = app.collect();
    expect(app.apply(result, [], { origin: 'https://attacker.example' }).error).toBe('ORIGIN_CHANGED');
    expect(app.apply(result, [], { token: 'other-document' }).error).toBe('STALE_DOCUMENT');
    app.click(); const second = app.collect();
    expect(app.apply(second, [{ fieldId: 'unrelated', value: 'Applicant Example' }]).filled).toEqual([]);
  });
});
