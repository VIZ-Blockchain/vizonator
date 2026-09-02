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
const chrome = spawn(process.env.CHROMIUM_BIN || 'chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dbus',
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
  // зеркалим настоящий background: приватные ключи НЕ покидают ядро расширения —
  // get_state отдаёт состояние без ключей (только флаги memo/active), а save_state
  // подставляет сохранённый ключ обратно, когда пришло пустое значение
  if(msg.get_state){ setTimeout(function(){
    var tmp=JSON.parse(JSON.stringify(window.__state));
    for(var u in tmp.users){
      tmp.users[u].memo=(typeof tmp.users[u].memo_key!=='undefined' && ''!=tmp.users[u].memo_key);
      tmp.users[u].active=(typeof tmp.users[u].active_key!=='undefined' && ''!=tmp.users[u].active_key);
      delete tmp.users[u].memo_key; delete tmp.users[u].active_key; delete tmp.users[u].regular_key;
    }
    cb({decoded:true,state:tmp});},0); return; }
  if(msg.save_state){
    var next=JSON.parse(JSON.stringify(msg.state));
    for(var u2 in next.users){
      var old=window.__state.users[u2];
      ['regular_key','memo_key','active_key'].forEach(function(k){
        if((typeof next.users[u2][k]==='undefined'||''==next.users[u2][k]) && old && typeof old[k]!=='undefined'){ next.users[u2][k]=old[k]; }
        if(typeof next.users[u2][k]==='undefined'){ next.users[u2][k]=''; }
      });
      delete next.users[u2].memo; delete next.users[u2].active;
    }
    window.__state=next; setTimeout(function(){cb(true);},0); return; }
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
  for (let i = 0; i < 100 && !target; i++) {
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

  // как при обычном открытии страницы: состояние перечитано из background (ключи вырезаны)
  await evalJS(`new Promise(function(r){get_state(function(){main_app();r(1);});})`);
  await sleep(200);
  await evalJS(`document.querySelector('.account-row[data-login="beta"] .edit-account').dispatchEvent(new MouseEvent('click',{bubbles:true}))`, false);
  await sleep(300);
  const editMode = await evalJS(`document.querySelector('.account-form').getAttribute('data-mode')+':'+document.querySelector('.account-form .login').value`);
  check('форма правки открылась с фиксированным логином', editMode === 'edit:beta', editMode);

  // регрессия: в поля ключей писалось undefined (get_state их вырезает) —
  // теперь поля пустые, а факт сохранённого ключа показан отметкой ✔️
  const editVals = await evalJS(`(function(){var f=document.querySelector('.account-form');
    return ['regular_key','memo_key','active_key'].map(function(c){return f.querySelector('.'+c).value;}).join('|');})()`);
  check('поля ключей в правке пустые (не undefined)', editVals === '||', editVals);
  const marks = await evalJS(`document.querySelectorAll('.account-form .exist').length`);
  check('сохранённые ключи отмечены ✔️', marks === 3, String(marks));

  // пустой regular = «оставить как есть», меняем только memo
  await fillForm('beta', '', C.memo, '');
  const savedBeta = await evalJS(`JSON.stringify(window.__state.users['beta'])`);
  const beta = JSON.parse(savedBeta);
  check('правка memo-ключа сохранена', beta.memo_key === C.memo, beta.memo_key);
  check('пустой regular не затирает сохранённый ключ', beta.regular_key === B.regular, beta.regular_key);
  check('пустой active не затирает сохранённый ключ', beta.active_key === B.active, beta.active_key);
  check('правка НЕ меняет текущий аккаунт', (await rows()) === 'alpha*,beta', await rows());

  // бейджи строки аккаунта считаются по флагам, а не по вырезанным ключам
  const badges = await evalJS(`document.querySelector('.account-row[data-login="beta"]').innerHTML`);
  check('бейджи по флагам: +memo/+active', badges.indexOf('+memo') > -1 && badges.indexOf('+active') > -1, badges.replace(/<[^>]+>/g, ' ').trim());

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
