// Приёмка страницы настроек: управление аккаунтами сессии (добавить/переключить/
// изменить/удалить) + фолбэк локали (неизвестный lang не должен ронять рендер).
// Вердикт = код возврата: 0 = PASS, 1 = FAIL.
// Запуск: node tests/options-accounts.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = process.env.VZN_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8912, DBG = 9312;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`); if (!ok) fails.push(name); };

// Сирота на отладочном порту молча подменит проверяемую страницу — отказываемся.
try { const r = await fetch(`http://127.0.0.1:${DBG}/json`, { signal: AbortSignal.timeout(1200) }); if (r.ok) { console.error(`ERR: debug port ${DBG} занят другим браузером`); process.exit(1); } } catch (_) {}

const srv = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', DIR], { stdio: 'ignore' });
const chrome = spawn('chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dbus',
  `--remote-debugging-port=${DBG}`, '--user-data-dir=/tmp/vzn-opt-' + process.pid, 'about:blank'],
  { stdio: 'ignore', detached: true });

let ws, msgId = 0; const pending = new Map(); const jsErrors = [];
const cmd = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
async function evalJS(expr, awaitPromise = true) {
  const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
}
const waitFor = async (expr, tries = 30, ms = 300) => { for (let i = 0; i < tries; i++) { if (await evalJS(expr)) return true; await sleep(ms); } return false; };

// Заглушка chrome.* — страница настроек живёт на runtime.sendMessage (get_state/save_state).
const STUB = `
window.__state={users:{},current_user:'',settings:{energy_step:20,award_energy:200,dark:false,lang:'LANGPLACEHOLDER'},rules:{},encoded:false,decoded:true};
window.__confirm=true;
window.confirm=function(){return window.__confirm;};
window.chrome={runtime:{lastError:null,sendMessage:function(msg,cb){
  cb=cb||function(){};
  if(msg.get_state){ setTimeout(function(){cb({decoded:true,state:window.__state});},0); return; }
  if(msg.save_state){ window.__state=msg.state; setTimeout(function(){cb(true);},0); return; }
  setTimeout(function(){cb(true);},0);
},getURL:function(p){return p;}},storage:{local:{get:function(k,cb){cb({});},set:function(o,cb){if(cb)cb();},remove:function(k,cb){if(cb)cb();}}}};
`;

async function bootPage(lang) {
  await cmd('Page.navigate', { url: 'about:blank' });
  await sleep(150);
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: STUB.replace('LANGPLACEHOLDER', lang) });
  await cmd('Page.navigate', { url: `http://127.0.0.1:${PORT}/options.html` });
  await sleep(1200);
}
const rows = () => evalJS(`Array.from(document.querySelectorAll('.account-row')).map(function(r){return r.getAttribute('data-login')+(r.classList.contains('current')?'*':'');}).join(',')`);
async function fillForm(login, reg, memo, act) {
  await evalJS(`(function(){var f=document.querySelector('.account-form');
    if(f.getAttribute('data-mode')==='add'){f.querySelector('.login').value=${JSON.stringify(login)};}
    f.querySelector('.regular_key').value=${JSON.stringify(reg)};
    f.querySelector('.memo_key').value=${JSON.stringify(memo)};
    f.querySelector('.active_key').value=${JSON.stringify(act)};
    f.querySelector('.save-account').dispatchEvent(new MouseEvent('click',{bubbles:true}));})()`, false);
  await sleep(500);
}

try {
  // подключаемся к странице
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json(); target = list.find(t => t.type === 'page'); } catch (_) {}
    if (!target) await sleep(300);
  }
  if (!target) throw new Error('не поднялся chromium');
  const { WebSocket } = await import('ws').catch(() => ({ WebSocket: globalThis.WebSocket }));
  ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.on ? (ws.on('open', res), ws.on('error', rej)) : (ws.onopen = res, ws.onerror = rej); });
  const onMsg = raw => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    if (m.method === 'Runtime.exceptionThrown') jsErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  ws.on ? ws.on('message', onMsg) : (ws.onmessage = e => onMsg(e.data));
  await cmd('Page.enable'); await cmd('Runtime.enable');

  // --- сценарий 1: неизвестная локаль не роняет страницу (регрессия ltmp_str) ---
  await bootPage('xx');
  const langOk = await waitFor(`!!document.querySelector('.account-form')`);
  check('неизвестный lang: страница рендерится (фолбэк en)', langOk);
  check('неизвестный lang: без JS-ошибок', jsErrors.length === 0, jsErrors.join(' | '));

  if (process.env.ONLY === 'lang') throw new Error('__only_lang__');

  // --- сценарий 2: управление аккаунтами ---
  jsErrors.length = 0;
  await bootPage('ru');
  await waitFor(`!!document.querySelector('.account-form')`);
  const keys = await evalJS(`(function(){var a=viz.auth.getPrivateKeys('alpha','pwd-alpha',['regular','memo','active']);
    var b=viz.auth.getPrivateKeys('beta','pwd-beta',['regular','memo','active']);
    var c=viz.auth.getPrivateKeys('beta','pwd-beta-2',['memo']);
    return {a:a,b:b,c:c};})()`);
  const A = keys.a, B = keys.b, C = keys.c;

  await fillForm('alpha', A.regular, A.memo, A.active);
  check('добавлен первый аккаунт, стал текущим', (await rows()) === 'alpha*', await rows());

  await fillForm('beta', B.regular, B.memo, B.active);
  check('добавлен второй аккаунт', (await rows()) === 'alpha,beta*', await rows());

  await evalJS(`document.querySelector('.account-row[data-login="alpha"] .select-account').dispatchEvent(new MouseEvent('click',{bubbles:true}))`, false);
  await sleep(400);
  check('переключение на другой аккаунт', (await rows()) === 'alpha*,beta', await rows());

  await evalJS(`document.querySelector('.account-row[data-login="beta"] .edit-account').dispatchEvent(new MouseEvent('click',{bubbles:true}))`, false);
  await sleep(300);
  const editMode = await evalJS(`document.querySelector('.account-form').getAttribute('data-mode')+':'+document.querySelector('.account-form .login').value`);
  check('форма правки открылась с фиксированным логином', editMode === 'edit:beta', editMode);
  await fillForm('beta', B.regular, C.memo, B.active);
  const savedMemo = await evalJS(`window.__state.users['beta'].memo_key`);
  check('правка ключа сохранена', savedMemo === C.memo);
  check('правка НЕ меняет текущий аккаунт', (await rows()) === 'alpha*,beta', await rows());

  await evalJS(`document.querySelector('.account-row[data-login="beta"] .delete-account').dispatchEvent(new MouseEvent('click',{bubbles:true}))`, false);
  await sleep(400);
  check('удаление не-текущего аккаунта', (await rows()) === 'alpha*', await rows());

  await evalJS(`document.querySelector('.account-row[data-login="alpha"] .delete-account').dispatchEvent(new MouseEvent('click',{bubbles:true}))`, false);
  await sleep(400);
  const wiped = await evalJS(`document.querySelectorAll('.account-row').length+':'+(document.querySelector('.control').innerHTML.indexOf('refresh-page')>-1)`);
  check('удаление последнего аккаунта чистит данные', wiped === '0:true', wiped);

  // отказ на невалидном ключе
  await bootPage('ru');
  await waitFor(`!!document.querySelector('.account-form')`);
  await fillForm('gamma', 'not-a-wif', '', '');
  const err = await evalJS(`document.querySelector('.account-form .error').innerHTML`);
  check('невалидный regular-ключ отвергнут', err.indexOf('regular') > -1 && (await evalJS(`Object.keys(window.__state.users).length`)) === 0, err);

  check('сценарий аккаунтов: без JS-ошибок', jsErrors.length === 0, jsErrors.join(' | '));
} catch (e) {
  if (e.message !== '__only_lang__') { console.error('ERR', e.message); fails.push('исключение: ' + e.message); }
} finally {
  try { process.kill(-chrome.pid); } catch (_) {}
  try { srv.kill(); } catch (_) {}
}
console.log(fails.length ? `FAILED: ${fails.length} (${fails.join('; ')})` : 'OK: все проверки пройдены');
process.exit(fails.length ? 1 : 0);
