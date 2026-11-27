// Run under Xvfb with WebKitWebDriver on PATH. Exercise the actual installed WebView.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';

const binary = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const profile = await mkdtemp(join(tmpdir(), 'didaske-smoke-'));
const url = 'http://127.0.0.1:4459';
const driver = spawn('WebKitWebDriver', ['--host=127.0.0.1', '--port=4459'], {
  env: { ...process.env, TAURI_WEBVIEW_AUTOMATION: 'true', XDG_CONFIG_HOME: profile,
    XDG_DATA_HOME: join(profile, 'data'), XDG_CACHE_HOME: join(profile, 'cache') },
  stdio: ['ignore', 'inherit', 'inherit']
});
const stopped = once(driver, 'exit');
let session;
async function request(path, body, method = 'POST') {
  const response = await fetch(url + path, { method, signal: AbortSignal.timeout(125000),
    headers: { 'Content-Type':'application/json' }, body:body && JSON.stringify(body) });
  const { value } = await response.json();
  if (!response.ok || value?.error) {
    throw Object.assign(new Error(value?.message ?? JSON.stringify(value)), {code: value?.error});
  }
  return value;
}
async function execute(script, args = []) {
  return request('/session/' + session + '/execute/sync', { script, args });
}
async function until(read) {
  for (let attempt = 0; attempt < 240; attempt++) {
    if (await read()) return;
    await delay(250);
  }
  throw new Error('Timed out waiting for the native reader: ' + (session ? await execute('return document.documentElement.outerHTML.slice(0,3500)') : 'no session'));
}
async function waitForReader(paths, selector) {
  await until(async () => {
    try {
      return await execute(`
        const [paths, selector] = arguments;
        return paths.includes(location.pathname)
          && document.documentElement.lang === location.pathname.split('/')[1]
          && !!document.querySelector(selector);
      `, [paths, selector]);
    } catch (error) {
      // WebKit can discard the previous document while handling a navigation.
      if (error.code === 'no such frame' && /unload/i.test(error.message)) return false;
      throw error;
    }
  });
}
try {
  await mkdir(output, {recursive:true});
  await until(() => fetch(url + '/status').then(r => r.ok, () => false));
  ({sessionId: session} = await request('/session', {capabilities:{alwaysMatch:{
    'webkitgtk:browserOptions':{binary}
  }}}));
  await waitForReader(['/pl/', '/en/'], '#main-content .editions a.edition');
  assert.equal(await execute("return typeof window.__TAURI__?.core.invoke"), 'function');
  await request('/session/' + session + '/timeouts', { script:120000 });
  const auth = await request('/session/' + session + '/execute/async', {
    script: "const done=arguments[0]; window.__TAURI__.core.invoke('github_status').then(done,e=>done({error:String(e)}))", args:[]
  });
  assert.equal(typeof auth.configured, 'boolean');
  assert.equal(auth.user, null);
  const origin = await execute('return location.origin');
  for (const [locale, label] of [['pl','Otwórz pełną stronę'],['en','Open full page']]) {
    const path = '/' + locale + '/Biblia/TNP/J/3/';
    const selector = '#v16 a[data-detail][href^="/' + locale + '/Study/TNP/J/3/16/notes/"]';
    await request('/session/' + session + '/url', {url: origin + path});
    await waitForReader([path], selector);
    const diagnostics = await request('/session/' + session + '/execute/async', {
      script: "const done=arguments[0]; window.__TAURI__.core.invoke('read_public',{name:'translations',params:[]}).then(rows=>done({count:rows.length}),e=>done({error:String(e)}))", args:[]
    });
    assert.equal(diagnostics.count, 4, JSON.stringify(diagnostics));
    await execute('document.querySelector(arguments[0]).click()', [selector]);
    await until(() => execute("return !!document.querySelector('dialog[open] a[data-full]')"));
    assert.equal(await execute("return document.querySelector('dialog[open] a[data-full]').textContent"), label);
    const screenshot = await request('/session/' + session + '/screenshot', undefined, 'GET');
    await writeFile(join(output, locale + '-footnote.png'), Buffer.from(screenshot, 'base64'));
  }
  console.log('Verified native offline chapter, modal and full-page link in PL and EN.');
} finally {
  if (session) await request('/session/' + session, undefined, 'DELETE').catch(() => {});
  driver.kill();
  await stopped;
  await rm(profile, {recursive:true,force:true});
}
