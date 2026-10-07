// Fresh temporary browser profile and synthetic fixtures only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
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
async function openPreview(frame = false) {
  await driver.get(`${origin}/form`);
  await driver.wait(until.elementLocated(By.id('name')), 10000);
  if (frame) await driver.switchTo().frame(await driver.findElement(By.css('iframe')));
  await driver.actions().contextClick(await driver.findElement(By.id('name'))).perform();
  // Use Firefox's actual native extension context-menu command, not a test-only runtime action.
  await driver.setContext('chrome');
  await driver.executeScript(`
    const menu = document.getElementById('contentAreaContextMenu');
    const item = [...menu.querySelectorAll('menuitem')].find(el => el.getAttribute('label') === 'Preview this form');
    if (!item) throw new Error('Extension context menu missing');
    item.doCommand(); menu.hidePopup();`);
  await driver.setContext('content');
  await driver.switchTo().defaultContent();
  return driver.wait(async () => {
    for (const handle of await driver.getAllWindowHandles()) {
      await driver.switchTo().window(handle);
      if ((await driver.getCurrentUrl()).includes('preview.html')) return handle;
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
