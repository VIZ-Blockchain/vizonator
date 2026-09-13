// Приёмка окна подтверждения (operation.html) для аккаунтов и passwordless_auth:
// пользователь обязан ВИДЕТЬ, какой домен просит подпись и чьим аккаунтом она будет
// сделана (для viz://-имени это единственное место, где оно вообще показано), а смена
// аккаунта — видеть и текущий, и запрошенный, без галочки «запомнить» (сайт не должен
// уметь молча переключать кошелёк).
// Вердикт = код возврата: 0 = PASS, 1 = FAIL.
// Запуск: node tests/operation-account-window.mjs
// Честный контроль: VZN_DIR=/путь/к/коду/до/фикса node tests/operation-account-window.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = process.env.VZN_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8921, DBG = 9321;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`); if (!ok) fails.push(name); };

// Сирота на отладочном порту молча подменит проверяемую страницу — отказываемся.
try { const r = await fetch(`http://127.0.0.1:${DBG}/json`, { signal: AbortSignal.timeout(1200) }); if (r.ok) { console.error(`ERR: debug port ${DBG} занят другим браузером`); process.exit(1); } } catch (_) {}

const srv = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', DIR], { stdio: 'ignore' });
const chrome = spawn(process.env.CHROMIUM_BIN || 'chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dbus',
  `--remote-debugging-port=${DBG}`, '--user-data-dir=/tmp/vzn-accwin-' + process.pid, 'about:blank'],
  { stdio: 'ignore', detached: true });

let ws, msgId = 0; const pending = new Map(); const jsErrors = [];
const cmd = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
async function evalJS(expr, awaitPromise = true) {
  const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
}
const waitFor = async (expr, tries = 30, ms = 300) => { for (let i = 0; i < tries; i++) { if (await evalJS(expr)) return true; await sleep(ms); } return false; };

// Кошелёк с двумя аккаунтами; ответы background'а подменены — окно проверяем само по себе.
const STUB = `
window.__sent=[];
window.__state={users:{alpha:{regular_key:'r',memo_key:'m',active_key:'a'},beta:{regular_key:'r2',memo_key:'',active_key:'a2'}},current_user:'alpha',settings:{energy_step:20,award_energy:200,dark:false,lang:'en'},rules:{},encoded:false,decoded:true};
window.chrome={runtime:{lastError:null,sendMessage:function(msg,cb){
  cb=cb||function(){};
  if(msg.get_state){ setTimeout(function(){cb({decoded:true,state:window.__state});},0); return; }
  if(msg.get_account_info){ setTimeout(function(){cb({current_energy:10000,current_balance:'100.000'});},0); return; }
  window.__sent.push(msg);
  setTimeout(function(){cb(false);},0);
},getURL:function(p){return p;}},
windows:{WINDOW_ID_CURRENT:-2,update:function(){}},
storage:{local:{get:function(k,cb){cb({});},set:function(o,cb){if(cb)cb();},remove:function(k,cb){if(cb)cb();}}}};
`;
delete globalThis.__sent;

const authAction = domain => ({
  operation: 'passwordless_auth',
  operation_type: ['auth', 'account', 'regular'],
  origin: 'hub.viz.world', event: 7, id: 1,
  authority: 'regular', domain: domain, account: 'alpha'
});
const switchAction = () => ({
  operation: 'switch_account',
  operation_type: ['account_switch'],
  origin: 'hub.viz.world', event: 8, id: 1,
  account: 'beta'
});
const accountsAction = () => ({
  operation: 'get_accounts',
  operation_type: ['accounts'],
  origin: 'hub.viz.world', event: 9, id: 1
});

async function openAction(action) {
  await cmd('Page.navigate', { url: 'about:blank' });
  await sleep(150);
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
  await cmd('Page.navigate', { url: `http://127.0.0.1:${PORT}/operation.html#` + encodeURI(JSON.stringify(action)) });
  await sleep(1000);
  await waitFor(`!!document.querySelector('.approve-action')`);
}
const actionText = () => evalJS(`document.querySelector('.action').innerText`);
const lineOf = (text, needle) => (text.split('\n').find(l => l.includes(needle)) || '').trim();

try {
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json(); target = list.find(t => t.type === 'page'); } catch (_) {}
    if (!target) await sleep(300);
  }
  if (!target) throw new Error('chromium не поднялся');
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

  // --- passwordless_auth: домен подписи и аккаунт подписи видно ---
  await openAction(authAction('hub.viz.world'));
  let text = await actionText();
  check('auth: домен подписи показан', lineOf(text, 'Domain to sign').includes('hub.viz.world'), lineOf(text, 'Domain to sign'));
  check('auth: аккаунт подписи показан', lineOf(text, 'Signing account').includes('alpha'), lineOf(text, 'Signing account'));
  check('auth: сайт показан', lineOf(text, 'Origin').includes('hub.viz.world'), lineOf(text, 'Origin'));
  check('auth: подписи за свой хост предупреждение не сопутствует', 0 === await evalJS(`document.querySelectorAll('.warn').length`));

  // --- viz:// имя: пользователь обязан его увидеть ---
  await openAction(authAction('viz://on1x'));
  text = await actionText();
  check('auth viz://: имя домена видно целиком', lineOf(text, 'Domain to sign').includes('viz://on1x'), lineOf(text, 'Domain to sign'));

  // --- поддомен подписывает за ГЛАВНЫЙ домен: оранжевое предупреждение обязательно ---
  await openAction(Object.assign(authAction('viz.world'), {auth_main_domain: true}));
  text = await actionText();
  check('главный домен: домен подписи показан', lineOf(text, 'Domain to sign').includes('viz.world'), lineOf(text, 'Domain to sign'));
  const warn = await evalJS(`(function(){var w=document.querySelector('.warn');if(!w)return null;var s=getComputedStyle(w);return {text:w.innerText,color:s.color};})()`);
  check('главный домен: предупреждение показано', !!warn && /main domain/i.test(warn.text), warn && warn.text);
  check('главный домен: предупреждение оранжевое', !!warn && 'rgb(255, 102, 0)' === warn.color, warn && warn.color);

  // --- switch_account: текущий, запрошенный и НЕТ галочки «запомнить» ---
  await openAction(switchAction());
  text = await actionText();
  check('switch: запрошенный аккаунт показан', lineOf(text, 'Switch to').includes('beta'), lineOf(text, 'Switch to'));
  check('switch: текущий аккаунт показан', lineOf(text, 'Current account').includes('alpha'), lineOf(text, 'Current account'));
  const trust = await evalJS(`document.querySelectorAll('.trust input[name="save"]').length`);
  check('switch: галочки «запомнить» нет (правило не сохраняется)', trust === 0, 'checkbox: ' + trust);
  const approve = await evalJS(`document.querySelectorAll('.approve-action').length`);
  check('switch: кнопка одобрения на месте', approve === 1);

  // --- одобрение смены уходит в background с аккаунтом ---
  await evalJS(`document.querySelector('.approve-action').dispatchEvent(new MouseEvent('click',{bubbles:true}))`, false);
  await sleep(400);
  const sent = JSON.parse(await evalJS(`JSON.stringify(window.__sent[window.__sent.length-1]||null)`) || 'null');
  check('switch: одобрение ушло с аккаунтом и флагом approve', !!sent && true === sent.approve && 'beta' === sent.account, sent && JSON.stringify({approve: sent.approve, account: sent.account}));

  // --- get_accounts: окно без ключей и без «данных» ---
  await openAction(accountsAction());
  text = await actionText();
  check('get_accounts: окно открыто и назван сайт', lineOf(text, 'Origin').includes('hub.viz.world'), lineOf(text, 'Origin'));
  check('get_accounts: сказано, что ключи не отдаются', /never leave/.test(text), text.split('\n').filter(Boolean).slice(-2).join(' / '));

  // --- sign_data по-прежнему рисуется (старый путь не сломан) ---
  await openAction({operation: 'sign_data', operation_type: ['sign', 'account', 'regular'], origin: 'hub.viz.world', event: 5, id: 1, authority: 'regular', data_to_sign: 'hub.viz.world:inbox.list:1788328074'});
  text = await actionText();
  check('sign_data: строка по-прежнему видна целиком', text.includes('hub.viz.world:inbox.list:1788328074'));
  check('без JS-ошибок', jsErrors.length === 0, jsErrors.join(' | '));
} catch (e) {
  console.error('ERR:', e.message);
  fails.push('исключение: ' + e.message);
} finally {
  try { ws && ws.close(); } catch (_) {}
  try { process.kill(-chrome.pid); } catch (_) {}
  try { srv.kill(); } catch (_) {}
}

console.log(fails.length ? `FAILED: ${fails.length} — ${fails.join('; ')}` : 'OK: все проверки пройдены');
process.exit(fails.length ? 1 : 0);
