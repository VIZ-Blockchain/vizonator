// Приёмка слайдера энергии в окне подтверждения (operation.html и action.html).
// Баг: страница брала текущую энергию из localStorage-полифилла, который наполняется
// АСИНХРОННО из chrome.storage.local, поэтому на момент отрисовки лимит был 0 —
// слайдер выходил полностью серым, 0%, выбрать нечего. Живой источник — сообщение
// background'у get_account_info (им уже пользуется popup.js).
// Вердикт = код возврата: 0 = PASS, 1 = FAIL.
// Запуск: node tests/operation-award-energy.mjs
// Честный контроль: VZN_DIR=/путь/к/коду/до/фикса node tests/operation-award-energy.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = process.env.VZN_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8921, DBG = 9321;
const ENERGY = 8000;               // 80% на цепи
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`); if (!ok) fails.push(name); };

try { const r = await fetch(`http://127.0.0.1:${DBG}/json`, { signal: AbortSignal.timeout(1200) }); if (r.ok) { console.error(`ERR: debug port ${DBG} занят другим браузером`); process.exit(1); } } catch (_) {}

const srv = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', DIR], { stdio: 'ignore' });
const chrome = spawn(process.env.CHROMIUM_BIN || 'chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dbus',
  `--remote-debugging-port=${DBG}`, '--user-data-dir=/tmp/vzn-energy-' + process.pid, 'about:blank'],
  { stdio: 'ignore', detached: true });

let ws, msgId = 0; const pending = new Map(); const jsErrors = [];
const cmd = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
async function evalJS(expr, awaitPromise = true) {
  const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
}
const waitFor = async (expr, tries = 30, ms = 300) => { for (let i = 0; i < tries; i++) { if (await evalJS(expr)) return true; await sleep(ms); } return false; };

// chrome.storage.local отвечает С ЗАДЕРЖКОЙ и без current_energy — ровно так ведёт себя
// полифилл в реальном окне: кэш ещё пуст, когда страница уже рисует слайдер.
const STUB = `
window.__sent=[];
window.__state={users:{alpha:{regular_key:'r',memo_key:'m',active_key:'a'}},current_user:'alpha',settings:{energy_step:20,award_energy:200,dark:false,lang:'ru'},rules:{},encoded:false,decoded:true};
window.chrome={runtime:{lastError:null,sendMessage:function(msg,cb){
  cb=cb||function(){};
  if(msg.get_state){ setTimeout(function(){cb({decoded:true,state:window.__state});},0); return; }
  if(msg.get_account_info){ setTimeout(function(){cb({current_energy:${ENERGY},current_shares:1000,current_balance:0});},0); return; }
  window.__sent.push(msg);
  setTimeout(function(){cb(false);},0);
},getURL:function(p){return p;}},
windows:{WINDOW_ID_CURRENT:-2,update:function(){}},
storage:{local:{get:function(k,cb){setTimeout(function(){cb({});},400);},set:function(o,cb){if(cb)cb();},remove:function(k,cb){if(cb)cb();}}}};
`;

const awardAction = {
  operation: 'award', operation_type: ['award', 'account', 'regular'],
  origin: 'https://viz.world', event: 7, id: 1,
  receiver: 'bob', memo: 'hello', custom_sequence: 0, beneficiaries: [], energy: false
};
// Окно расширения (action.html) поднимается тем же кодом слайдера — проверяем оба.
const extAction = { tab_id: 0, origin: 'extension', id: 1, login: 'bob', sequence: 0, memo: 'hello', beneficiaries: [] };

async function open(page, action) {
  await cmd('Page.navigate', { url: 'about:blank' });
  await sleep(150);
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
  await cmd('Page.navigate', { url: `http://127.0.0.1:${PORT}/${page}#` + encodeURI(JSON.stringify(action)) });
  await sleep(1200);
  await waitFor(`!!document.querySelector('.select_energy')`);
}
const slider = () => evalJS(`(function(){var s=document.querySelector('.select_energy');if(!s)return null;
  var pct=document.querySelector('.spend_energy');
  return {limit:s.getAttribute('data-limit'),active:s.querySelectorAll('.energy_active').length,
    inactive:s.querySelectorAll('.energy_inactive').length,selected:s.querySelectorAll('.selected').length,
    pct:pct?pct.innerText:null};})()`);

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

  // --- окно операции со страницы (v.award(...) с сайта) ---
  await open('operation.html', awardAction);
  let s = await slider();
  check('operation: слайдер отрисован', !!s);
  check('operation: лимит = энергия аккаунта', !!s && parseInt(s.limit) === ENERGY, s && `data-limit=${s.limit}`);
  check('operation: есть выбираемые деления', !!s && s.active > 0, s && `active=${s.active} inactive=${s.inactive}`);
  check('operation: пресет из настроек выбран', !!s && s.selected > 0, s && `selected=${s.selected}`);
  check('operation: процент не нулевой', !!s && s.pct === '2%', s && `pct=${s.pct}`);

  // --- окно расширения (award из самого расширения) ---
  await open('action.html', extAction);
  s = await slider();
  check('action: лимит = энергия аккаунта', !!s && parseInt(s.limit) === ENERGY, s && `data-limit=${s.limit}`);
  check('action: есть выбираемые деления', !!s && s.active > 0, s && `active=${s.active} inactive=${s.inactive}`);
  check('action: процент не нулевой', !!s && s.pct === '2%', s && `pct=${s.pct}`);

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
