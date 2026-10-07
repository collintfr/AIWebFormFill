// Fresh temporary browser profile and synthetic fixtures only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { educationGroup } from '../src/js/profile.js';
import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  if (req.url === '/education-details') {
    const inputs = [
      ['institution', 'Institution'], ['country', 'Country', ['example-country', 'Example Country']],
      ['city', 'City'], ['state', 'State', ['example-state', 'Example State']],
      ['studyLevel', 'Level of Study', ['example-level', 'Example level']],
      ['startDateMonth', 'Start Date', ['09', 'September']], ['startDateYear', 'Start Date', ['2020', '2020']],
      ['endDateMonth', 'End Date', ['06', 'June']], ['endDateYear', 'End Date', ['2024', '2024']],
      ['expectedGraduationMonth', 'Graduation Date / Expected Graduation Date', ['07', 'July']],
      ['expectedGraduationYear', 'Graduation Date / Expected Graduation Date', ['2024', '2024']],
      ['degree', 'Degree Received/Anticipated', ['example-degree', 'Example degree']],
      ['major', 'Major'], ['minor', 'Minor'], ['major2', '2nd Major'], ['minor2', '2nd Minor'],
      ['gpa', 'Overall/Cumulative GPA'], ['gpaScale', 'GPA Scale'], ['classRank', 'Class Rank'], ['classSize', 'Class Size']
    ];
    res.end(`<html><head><style>form{display:grid;grid-template-columns:1fr 1fr;gap:14px}label{display:block}input,select{display:block;width:95%;padding:6px}</style></head><body><form>${inputs.map(([name, label, choice]) => `<label>${label}${choice ? `<select id="${name}" name="${name}"><option value="">Choose</option><option value="${choice[0]}">${choice[1]}</option></select>` : `<input id="${name}" name="${name}">`}</label>`).join('')}</form></body></html>`); return;
  }
  if (req.url === '/education') {
    res.end('<html><body><form><fieldset><legend>First degree</legend><label>School<input id="school1" name="school"></label><label>GPA<input id="gpa1" name="gpa"></label></fieldset><fieldset><legend>Second degree</legend><label>School<input id="school2" name="school"></label><label>GPA<input id="gpa2" name="gpa"></label></fieldset></form></body></html>'); return;
  }
  if (['/inline', '/modal'].includes(req.url)) {
    const modal = req.url === '/modal';
    res.end(`<html><body><button id="add" type="button">Add education</button><input id="unrelated">${modal ? '<dialog id="details" aria-label="Education">' : '<div id="details" hidden role="group" aria-label="Education">'}<form id="education"><label>School<input id="school" name="school"></label><label>GPA<input id="gpa" name="gpa"></label><label>Graduation month<input id="month" type="month" name="graduationMonth"></label><label>Major<select id="major" name="major"><option value="">Choose</option><option value="math">Mathematics</option></select></label><button id="save" type="submit">Save education</button></form>${modal ? '</dialog>' : '</div>'}<script>window.saved=0;document.getElementById('add').addEventListener('click',()=>{${modal ? "document.getElementById('details').showModal()" : "document.getElementById('details').hidden=false"}});document.getElementById('education').addEventListener('submit',e=>{e.preventDefault();window.saved++});</script></body></html>`); return;
  }
  res.end(`<html><body><form id="main"><label>Full name <input name="fullName" id="name"></label><input id="email" name="email"></form><form><input id="unrelated" name="fullName"></form>${req.url === '/frame' ? '' : `<iframe src="http://localhost:${server.address().port}/frame"></iframe>`}</body></html>`);
});
await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const frameOrigin = `http://localhost:${server.address().port}`;
const options = new firefox.Options().addArguments('-headless')
  .setPreference('datareporting.policy.dataSubmissionEnabled', false)
  .setPreference('toolkit.telemetry.enabled', false)
  .setPreference('browser.shell.checkDefaultBrowser', false);
const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options)
  .setFirefoxService(new firefox.ServiceBuilder().addArguments('--allow-system-access')).build();
await driver.manage().setTimeouts({ script: 180000, pageLoad: 30000 });
await driver.manage().window().setRect({ width: 1280, height: 1100 });
let base;
async function call(action, details = {}) {
  const result = await driver.executeAsyncScript(`
    const done = arguments[arguments.length - 1];
    browser.runtime.sendMessage(arguments[0]).then(done, () => done({ok:false,error:'MESSAGE_FAILED'}));`, { action, ...details });
  if (!result?.ok) throw new Error(result?.error ?? 'MESSAGE_FAILED');
  return result.value;
}
async function grant(origins, remove = false) {
  await driver.setContext('chrome');
  const result = await driver.executeAsyncScript(`
    const done = arguments[arguments.length - 1];
    const {ExtensionPermissions} = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
    const extension = WebExtensionPolicy.getByID('ask.ivo@gmail.com').extension;
    ExtensionPermissions[arguments[1] ? 'remove' : 'add'](extension.id, {origins:arguments[0], permissions:[]}, extension)
      .then(() => done(true), error => done(String(error)));`, origins, remove);
  await driver.setContext('content');
  assert.equal(result, true);
}
async function openPreview(frame = false, target = 'name', menuTitle = 'Preview this form', path = '/form') {
  await driver.get(`${origin}${path}`);
  await driver.wait(until.elementLocated(By.id(target)), 10000);
  if (frame) await driver.switchTo().frame(await driver.findElement(By.css('iframe')));
  await driver.actions().contextClick(await driver.findElement(By.id(target))).perform();
  // Use Firefox's actual native extension context-menu command, not a test-only runtime action.
  await driver.setContext('chrome');
  await driver.executeScript(`
    const menu = document.getElementById('contentAreaContextMenu');
    const item = [...menu.querySelectorAll('menuitem')].find(el => el.getAttribute('label') === arguments[0]);
    if (!item) throw new Error('Extension context menu missing');
    item.doCommand(); menu.hidePopup();`, menuTitle);
  await driver.setContext('content');
  await driver.switchTo().defaultContent();
  return driver.wait(async () => {
    for (const handle of await driver.getAllWindowHandles()) {
      await driver.switchTo().window(handle);
      if ((await driver.getCurrentUrl()).includes('preview.html')) {
        const prepare = await driver.findElements(By.id('collect'));
        if (prepare.length && await prepare[0].isEnabled()) return handle;
      }
    }
    return false;
  }, 10000, 'Preview window missing');
}
try {
  await driver.installAddon(resolve('dist/firefox.zip'), true);
  await driver.setContext('chrome');
  const hostname = await driver.executeScript("return WebExtensionPolicy.getByID('ask.ivo@gmail.com').mozExtensionHostname;");
  await driver.setContext('content'); base = `moz-extension://${hostname}/`;
  await driver.get(`${base}options.html`);
  await driver.wait(until.elementLocated(By.id('create')), 10000);
  await call('create', { passphrase: 'synthetic browser passphrase' });
  await call('save', { profile: { 'Applicant Example': ['fullName'], 'applicant@example.test': ['email'] } });
  await grant(['http://127.0.0.1/*', 'http://localhost/*']);
  await call('approveSite', { origin }); await call('approveSite', { origin: frameOrigin });
  const optionsHandle = await driver.getWindowHandle();
  const previewHandle = await openPreview();
  await driver.findElement(By.id('collect')).click();
  await driver.wait(async () => (await driver.findElements(By.css('#fields tr'))).length === 2, 15000);
  assert.match(await driver.findElement(By.id('destination')).getText(), /127\.0\.0\.1/);
  // Before approval, the page must contain no private suggestions or values.
  // The original options handle was navigated to the fixture by openPreview.
  await driver.switchTo().window(optionsHandle);
  assert.equal(await driver.findElement(By.id('name')).getAttribute('value'), '');
  assert.equal(await driver.findElement(By.id('name')).getAttribute('data-suggestion'), null);
  await driver.switchTo().window(previewHandle); await driver.findElement(By.id('fill')).click();
  await driver.wait(until.elementTextContains(await driver.findElement(By.id('message')), '2 field(s) filled'), 10000);
  await driver.switchTo().window(optionsHandle);
  assert.equal(await driver.findElement(By.id('name')).getAttribute('value'), 'Applicant Example');
  assert.equal(await driver.findElement(By.id('unrelated')).getAttribute('value'), '');
  await driver.switchTo().frame(await driver.findElement(By.css('iframe')));
  assert.equal(await driver.findElement(By.id('name')).getAttribute('value'), '');
  await driver.switchTo().defaultContent();
  console.log('PASS: real context selection, preview secrecy, selected-form fill and frame isolation');

  await driver.switchTo().window(previewHandle); await driver.close(); await driver.switchTo().window(optionsHandle);
  const embedded = await openPreview(true);
  await driver.findElement(By.id('collect')).click();
  await driver.switchTo().alert().accept();
  await driver.wait(async () => (await driver.findElements(By.css('#fields tr'))).length === 2, 15000);
  await driver.findElement(By.id('fill')).click();
  await driver.wait(until.elementTextContains(await driver.findElement(By.id('message')), '2 field(s) filled'), 10000);
  await driver.switchTo().window(optionsHandle);
  assert.equal(await driver.findElement(By.id('name')).getAttribute('value'), '');
  await driver.switchTo().frame(await driver.findElement(By.css('iframe')));
  assert.equal(await driver.findElement(By.id('name')).getAttribute('value'), 'Applicant Example');
  await driver.switchTo().defaultContent();
  console.log('PASS: separate embedded-origin approval and frame-targeted insertion');
  await driver.switchTo().window(embedded); await driver.close(); await driver.switchTo().window(optionsHandle);

  const stale = await openPreview();
  await driver.findElement(By.id('collect')).click();
  await driver.wait(async () => (await driver.findElements(By.css('#fields tr'))).length === 2, 15000);
  await driver.switchTo().window(optionsHandle); await driver.navigate().refresh();
  await driver.switchTo().window(stale); await driver.findElement(By.id('fill')).click();
  await driver.wait(until.elementTextContains(await driver.findElement(By.id('message')), 'page changed'), 10000);
  await driver.switchTo().window(optionsHandle); assert.equal(await driver.findElement(By.id('name')).getAttribute('value'), '');
  console.log('PASS: navigation cancels stale insertion');

  await driver.switchTo().window(stale); await driver.close(); await driver.switchTo().window(optionsHandle);
  await driver.get(`${base}options.html`);
  const schoolRecord = (id, gpa) => ({ id, label: id === 'degree-a' ? 'Example University / BS' : 'Example University / MS',
    attributes: [{ id: `${id}-school`, label: 'School', value: 'Example University', aliases: ['school'] },
      { id: `${id}-gpa`, label: 'GPA', value: gpa, aliases: ['gpa'] },
      { id: `${id}-month`, label: 'Graduation month', value: '2024-06', aliases: ['graduationMonth'] }],
    records: [{ id: `${id}-major`, label: 'Major 1', attributes: [{ id: `${id}-major-value`, label: 'Major', value: 'Mathematics', aliases: ['major'] }], records: [] }] });
  await call('save', { profile: { version: 2, groups: [{ id: 'education', label: 'Education', records: [schoolRecord('degree-a', '3.8'), schoolRecord('degree-b', '3.9')] }] } });
  await driver.navigate().refresh();
  await driver.wait(async () => (await driver.findElements(By.css('#recordEditor fieldset'))).length > 0, 10000);
  assert.ok((await driver.findElements(By.css('#recordEditor input'))).length > 10);
  const grouped = await openPreview(false, 'school1', 'Preview this form', '/education');
  await driver.findElement(By.id('collect')).click();
  await driver.wait(async () => (await driver.findElements(By.css('#fields tr'))).length === 4, 10000);
  assert.equal((await driver.findElements(By.css('#fields input[type=checkbox]:checked'))).length, 0);
  await driver.executeScript(`
    const selectors=[...document.querySelectorAll('#sections select')];
    selectors[0].value='degree-a';selectors[0].dispatchEvent(new Event('change'));
    const second=document.querySelectorAll('#sections select')[1];second.value='degree-b';second.dispatchEvent(new Event('change'));`);
  await driver.findElement(By.id('fill')).click();
  await driver.wait(until.elementTextContains(await driver.findElement(By.id('message')), '4 field(s) filled'), 10000);
  await driver.switchTo().window(optionsHandle);
  assert.equal(await driver.findElement(By.id('school1')).getAttribute('value'), 'Example University');
  assert.equal(await driver.findElement(By.id('school2')).getAttribute('value'), 'Example University');
  assert.equal(await driver.findElement(By.id('gpa1')).getAttribute('value'), '3.8');
  assert.equal(await driver.findElement(By.id('gpa2')).getAttribute('value'), '3.9');
  console.log('PASS: visual editor, duplicate school names and per-section degree assignments');
  await driver.switchTo().window(grouped); await driver.close(); await driver.switchTo().window(optionsHandle);

  for (const path of ['/inline', '/modal']) {
    const subform = await openPreview(false, 'add', 'Preview opening this Add/Edit control', path);
    await driver.findElement(By.id('collect')).click();
    await driver.wait(until.elementIsVisible(await driver.findElement(By.id('openSubform'))), 10000);
    await driver.switchTo().window(optionsHandle);
    assert.equal(await driver.findElement(By.id('school')).getAttribute('value'), '');
    assert.equal(await driver.findElement(By.id('school')).isDisplayed(), false);
    await driver.switchTo().window(subform); await driver.findElement(By.id('openSubform')).click();
    await driver.wait(until.elementIsVisible(await driver.findElement(By.id('scope'))), 15000);
    await driver.switchTo().window(optionsHandle);
    assert.equal(await driver.findElement(By.id('school')).getAttribute('value'), '');
    assert.equal(await driver.executeScript('return window.saved'), 0);
    await driver.switchTo().window(subform); await driver.findElement(By.id('collect')).click();
    await driver.wait(async () => (await driver.findElements(By.css('#fields tr'))).length === 4, 10000);
    await driver.executeScript(`const select=document.querySelector('#sections select');select.value='degree-b';select.dispatchEvent(new Event('change'));
      const check=document.querySelector('#sections input[type=checkbox]');check.click();`);
    await driver.findElement(By.id('fill')).click();
    await driver.wait(until.elementTextContains(await driver.findElement(By.id('message')), '4 field(s) filled'), 10000);
    await driver.switchTo().window(optionsHandle);
    assert.equal(await driver.findElement(By.id('school')).getAttribute('value'), 'Example University');
    assert.equal(await driver.findElement(By.id('gpa')).getAttribute('value'), '3.9');
    assert.equal(await driver.findElement(By.id('month')).getAttribute('value'), '2024-06');
    assert.equal(await driver.findElement(By.id('major')).getAttribute('value'), 'math');
    assert.equal(await driver.findElement(By.id('unrelated')).getAttribute('value'), '');
    assert.equal(await driver.executeScript('return window.saved'), 0);
    await driver.findElement(By.id('save')).click(); assert.equal(await driver.executeScript('return window.saved'), 1);
    console.log(`PASS: ${path.slice(1)} opening approval, nested major, native controls and manual save`);
    await driver.switchTo().window(subform); await driver.close(); await driver.switchTo().window(optionsHandle);
  }

  await driver.get(`${base}options.html`);
  const template = educationGroup(); const qualification = template.records[0]; qualification.label = 'Example College / Example degree';
  const templateValues = { School: 'Example College', Country: 'Example Country', City: 'Example City', State: 'Example State',
    'Level of study': 'Example level', Degree: 'Example degree', GPA: '3.2', 'GPA scale': '4', 'Class rank': '12', 'Class size': '200',
    Major: 'Economics', '2nd Major': 'Philosophy', Minor: 'History', '2nd Minor': 'Linguistics',
    'Start month': 'September', 'Start year': '2020', 'End month': 'June', 'End year': '2024', 'Graduation month': 'July', 'Graduation year': '2024' };
  for (const leaf of [...qualification.attributes, ...qualification.records.flatMap(item => item.attributes)]) leaf.value = templateValues[leaf.label] ?? '';
  await call('save', { profile: { version: 2, groups: [template] } }); await driver.navigate().refresh();
  await driver.wait(async () => (await driver.findElements(By.css('#recordEditor .entry-group'))).length === 1, 10000);
  const surfaces = await driver.executeScript(`return ['.entry-group','.entry-record','.entry-attribute','.record-even'].map(selector=>getComputedStyle(document.querySelector('#recordEditor '+selector)).backgroundColor)`);
  assert.equal(new Set(surfaces).size, 4);
  const widths = await driver.executeScript('return [document.documentElement.scrollWidth,document.documentElement.clientWidth]'); assert.ok(widths[0] <= widths[1]);
  if (process.argv.includes('--editor-screenshots')) {
    await driver.executeScript("document.querySelector('#recordEditor .entry-group').scrollIntoView()");
    await writeFile('/tmp/ai-form-editor-main.png', Buffer.from(await driver.takeScreenshot(), 'base64'));
    await driver.executeScript("document.querySelector('#recordEditor .entry-children').scrollIntoView()");
    await writeFile('/tmp/ai-form-editor-details.png', Buffer.from(await driver.takeScreenshot(), 'base64'));
  }
  await driver.manage().window().setRect({ width: 390, height: 1000 });
  const mobileWidths = await driver.executeScript('return [document.documentElement.scrollWidth,document.documentElement.clientWidth]'); assert.ok(mobileWidths[0] <= mobileWidths[1]);
  if (process.argv.includes('--editor-screenshots')) {
    await driver.executeScript("document.querySelector('#recordEditor .entry-group').scrollIntoView()");
    await writeFile('/tmp/ai-form-editor-mobile.png', Buffer.from(await driver.takeScreenshot(), 'base64'));
  }
  await driver.manage().window().setRect({ width: 1280, height: 1100 });
  const complete = await openPreview(false, 'institution', 'Preview this form', '/education-details');
  await driver.findElement(By.id('collect')).click();
  await driver.wait(async () => (await driver.findElements(By.css('#fields tr'))).length === 20, 10000);
  await driver.executeScript(`const select=document.querySelector('#sections select');select.value=arguments[0];select.dispatchEvent(new Event('change'));
    for(const check of document.querySelectorAll('#sections input[type=checkbox]')) check.click();`, qualification.id);
  await driver.findElement(By.id('fill')).click();
  await driver.wait(until.elementTextContains(await driver.findElement(By.id('message')), '20 field(s) filled'), 10000);
  await driver.switchTo().window(optionsHandle);
  for (const [name, value] of Object.entries({ institution: 'Example College', country: 'example-country', city: 'Example City', state: 'example-state',
    studyLevel: 'example-level', startDateMonth: '09', startDateYear: '2020', endDateMonth: '06', endDateYear: '2024',
    expectedGraduationMonth: '07', expectedGraduationYear: '2024', degree: 'example-degree', major: 'Economics', minor: 'History', major2: 'Philosophy',
    minor2: 'Linguistics', gpa: '3.2', gpaScale: '4', classRank: '12', classSize: '200' })) assert.equal(await driver.findElement(By.id(name)).getAttribute('value'), value);
  console.log('PASS: full education template, split month/year controls, ordinal majors/minors and responsive hierarchy colors');
  await driver.switchTo().window(complete); await driver.close(); await driver.switchTo().window(optionsHandle);

  await driver.get(`${base}options.html`); await call('lock');
  assert.equal((await call('status')).unlocked, false);
  await call('unlock', { passphrase: 'synthetic browser passphrase' });
  const exported = await call('export'); assert.ok(!JSON.stringify(exported).includes('Applicant Example'));
  await grant(['http://127.0.0.1/*'], true);
  await driver.wait(async () => !(await driver.executeAsyncScript(`const done=arguments[arguments.length-1]; browser.permissions.contains({origins:['http://127.0.0.1/*']}).then(done);`)), 10000);
  console.log('PASS: vault locking, encrypted export and permission revocation');
  if (process.argv.includes('--model')) {
    await grant(['https://huggingface.co/*', 'https://cas-bridge.xethub.hf.co/*', 'https://cdn-lfs.huggingface.co/*', 'https://cdn-lfs-us-1.hf.co/*', 'https://us.aws.cdn.hf.co/*']);
    const connectivity = await driver.executeAsyncScript(`
      const done=arguments[arguments.length-1];
      fetch('https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/751bff37182d3f1213fa05d7196b954e230abad9/config.json',
        {credentials:'omit',referrerPolicy:'no-referrer'})
        .then(async r=>done({status:r.status,length:(await r.arrayBuffer()).byteLength}),e=>done({error:e.name+': '+e.message}));`);
    assert.equal(connectivity.status, 200, JSON.stringify(connectivity));
    await driver.findElement(By.id('downloadModel')).click();
    await driver.wait(async () => {
      const status = await driver.findElement(By.id('modelStatus')).getText();
      const error = await driver.findElement(By.id('message')).getText();
      if (error) throw new Error(`Model setup (${status}): ${error}`);
      return status.includes('Model ready');
    }, 180000);
    await driver.setContext('chrome');
    await driver.executeScript('Services.io.offline = true;');
    await driver.setContext('content');
    const matched = await driver.executeAsyncScript(`
      const done=arguments[arguments.length-1];
      const worker=new Worker(browser.runtime.getURL('js/inference-worker.js'),{type:'module'});
      worker.onmessage=e=>{worker.terminate();done(e.data)};
      worker.onerror=e=>{worker.terminate();done({ok:false,error:e.message})};
      worker.postMessage({fields:[{id:'field',metadata:{label:'Given name'}}],entries:[{id:'entry',aliases:['first name']}]});`);
    assert.equal(matched.ok, true, JSON.stringify(matched));
    assert.ok(Number.isFinite(matched.matches[0].similarity));
    await driver.setContext('chrome');
    await driver.executeScript('Services.io.offline = false;');
    await driver.setContext('content');
    console.log('PASS: verified setup download and local WASM embedding inference with Firefox offline');
  }
  const preservedVault = await call('export');
  await driver.executeAsyncScript(`
    const done=arguments[arguments.length-1];
    (async()=>{
      await browser.storage.local.set({AIFillForm:{name:'Applicant Example'},
        AIFillForm_backup_old_format:{name:'Applicant Example'},backup_timestamp:123,
        staticEmbeddings:{alias:[1,2]},settings:{model:'obsolete'},aiSession:'synthetic metadata'});
      await browser.storage.sync.set({AIFillForm:{name:'Applicant Example'},settings:{model:'obsolete'}});
      if(browser.storage.session) await browser.storage.session.set({aiSession:'synthetic metadata'});
      const page=await browser.runtime.getBackgroundPage();page.location.reload();done(true);
    })().catch(()=>done(false));`);
  await driver.wait(async () => {
    try { const status=await call('status'); return status.exists && !status.unlocked; } catch { return false; }
  }, 10000);
  await call('unlock', { passphrase: 'synthetic browser passphrase' });
  console.log('PASS: background restart discards the key but preserves the encrypted vault');
  const storage = await driver.executeAsyncScript(`
    const done=arguments[arguments.length-1];
    Promise.all([browser.storage.local.get(null),browser.storage.sync.get(null),
      browser.storage.session ? browser.storage.session.get(null) : Promise.resolve({})])
      .then(areas=>done(areas.map(area=>Object.keys(area))));`);
  assert.deepEqual(storage[0].sort(), ['encryptedVault', 'preferences']);
  assert.deepEqual(storage[1], []); assert.deepEqual(storage[2], []);
  assert.deepEqual(await call('export'), preservedVault);
  assert.ok(!await driver.findElements(By.id('deleteLegacy')).then(elements=>elements.length));
  console.log('PASS: automatic plaintext purge preserves encrypted vault and preferences');
  await call('clearAll'); assert.equal((await call('status')).exists, false);
  console.log('PASS: complete personal-data deletion');
} finally { await driver.quit(); await new Promise(resolve => server.close(resolve)); }
