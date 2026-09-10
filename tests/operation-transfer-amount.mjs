// Приёмка ввода суммы перевода в окне подтверждения (operation.html).
// Страница может позвать v.transfer({to,memo}) без суммы — тогда сумму вводит сам
// пользователь, а разбор введённого повторяет popup.js (запятая как разделитель,
// проверка на ноль и на баланс). Указанная страницей сумма остаётся текстом, поля нет.
// Вердикт = код возврата: 0 = PASS, 1 = FAIL.
// Запуск: node tests/operation-transfer-amount.mjs
// Честный контроль: VZN_DIR=/путь/к/коду/до/фикса node tests/operation-transfer-amount.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = process.env.VZN_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8922, DBG = 9322;
const BALANCE = '100.000';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`); if (!ok) fails.push(name); };

try { const r = await fetch(`http://127.0.0.1:${DBG}/json`, { signal: AbortSignal.timeout(1200) }); if (r.ok) { console.error(`ERR: debug port ${DBG} занят другим браузером`); process.exit(1); } } catch (_) {}

const srv = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', DIR], { stdio: 'ignore' });
const chrome = spawn(process.env.CHROMIUM_BIN || 'chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dbus',
  `--remote-debugging-port=${DBG}`, '--user-data-dir=/tmp/vzn-amount-' + process.pid, 'about:blank'],
  { stdio: 'ignore', detached: true });

let ws, msgId = 0; const pending = new Map(); const jsErrors = [];
const cmd = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
async function evalJS(expr, awaitPromise = true) {
  const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
}
const waitFor = async (expr, tries = 30, ms = 300) => { for (let i = 0; i < tries; i++) { if (await evalJS(expr)) return true; await sleep(ms); } return false; };

// approve отвечает false, иначе окно закроется и проверять будет нечего.
const STUB = `
window.__sent=[];
window.__state={users:{alpha:{regular_key:'r',memo_key:'m',active_key:'a'}},current_user:'alpha',settings:{energy_step:20,award_energy:200,dark:false,lang:'ru'},rules:{},encoded:false,decoded:true};
window.chrome={runtime:{lastError:null,sendMessage:function(msg,cb){
  cb=cb||function(){};
  if(msg.get_state){ setTimeout(function(){cb({decoded:true,state:window.__state});},0); return; }
  if(msg.get_account_info){ setTimeout(function(){cb({current_energy:8000,current_shares:1000,current_balance:'${BALANCE}'});},0); return; }
  window.__sent.push(JSON.parse(JSON.stringify(msg)));
  setTimeout(function(){cb(false);},0);
},getURL:function(p){return p;}},
windows:{WINDOW_ID_CURRENT:-2,update:function(){}},
storage:{local:{get:function(k,cb){setTimeout(function(){cb({});},400);},set:function(o,cb){if(cb)cb();},remove:function(k,cb){if(cb)cb();}}}};
`;

const base = { operation: 'transfer', operation_type: ['transfer', 'active'], origin: 'https://viz.world', event: 9, id: 1, to: 'bob', memo: '', force_memo_encoding: false };
const noAmount = { ...base, amount: false };
const withAmount = { ...base, amount: '3.500 VIZ' };

async function open(action) {
  await cmd('Page.navigate', { url: 'about:blank' });
  await sleep(150);
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
  await cmd('Page.navigate', { url: `http://127.0.0.1:${PORT}/operation.html#` + encodeURI(JSON.stringify(action)) });
  await sleep(1200);
  await waitFor(`!!document.querySelector('.approve-action')`);
  await evalJS(`window.__sent.length=0;true`);
}
const type = v => evalJS(`(function(){var i=document.querySelector('.amount_input');i.value=${JSON.stringify(v)};
  i.dispatchEvent(new Event('input',{bubbles:true}));return i.value;})()`);
const approve = async () => { await evalJS(`document.querySelector('.approve-action').click();true`); await sleep(300); };
const sentAmount = () => evalJS(`(function(){var m=window.__sent.filter(function(x){return x.approve;});
  return m.length?(typeof m[0].amount==='string'?m[0].amount:JSON.stringify(m[0].amount)):null;})()`);
const errText = () => evalJS(`(function(){var e=document.querySelector('.amount_error');return e?e.innerText.trim():null;})()`);

try {
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

  // --- сумма не указана страницей: поле есть, баланс виден ---
  await open(noAmount);
  check('поле ввода отрисовано', !!(await evalJS(`!!document.querySelector('.amount_input')`)));
  check('поле в фокусе', await evalJS(`document.activeElement===document.querySelector('.amount_input')`));
  check('баланс показан', ((await evalJS(`(document.querySelector('.amount_balance')||{}).innerText||''`)) || '').includes(BALANCE));

  // пустое поле — подтверждать нечего
  await approve();
  check('пустая сумма не отправляется', (await sentAmount()) === null, 'sent=' + await sentAmount());
  check('пустая сумма подсвечена ошибкой', !!(await errText()), 'error=' + await errText());
  check('кнопка снова активна', !(await evalJS(`document.querySelector('.approve-action').classList.contains('disabled')`)));

  // ноль
  await type('0');
  await approve();
  check('ноль не отправляется', (await sentAmount()) === null, 'sent=' + await sentAmount());

  // больше баланса
  await type('1000');
  await approve();
  check('сумма больше баланса не отправляется', (await sentAmount()) === null, 'sent=' + await sentAmount());
  check('сказано про нехватку средств', ((await errText()) || '').length > 0, 'error=' + await errText());

  // мусор в поле чистится на лету, как в popup
  check('буквы в поле не остаются', (await type('12abc,5')) === '12,5');

  // запятая как десятичный разделитель → "12.500 VIZ"
  await approve();
  check('запятая принята как десятичный разделитель', (await sentAmount()) === '12.500 VIZ', 'sent=' + await sentAmount());

  // --- два разделителя ---
  await open(noAmount);
  await type('1.2.3');
  await approve();
  check('два разделителя отвергнуты', (await sentAmount()) === null, 'sent=' + await sentAmount());

  // --- точка как разделитель, обычный путь ---
  await open(noAmount);
  await type('7.25');
  await approve();
  check('точка принята, сумма нормализована', (await sentAmount()) === '7.250 VIZ', 'sent=' + await sentAmount());

  // --- сумма пришла со страницы: поля быть не должно ---
  await open(withAmount);
  check('с указанной суммой поля нет', !(await evalJS(`!!document.querySelector('.amount_input')`)));
  check('указанная сумма показана текстом', ((await evalJS(`document.body.innerText`)) || '').includes('3.500'));
  await approve();
  check('указанная сумма уходит как есть', (await sentAmount()) === '3.500 VIZ', 'sent=' + await sentAmount());

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
