// Приёмка окна подтверждения (operation.html) для sign_data: пользователь обязан увидеть
// ВСЮ строку, которую подписывает, а не её начало. Проверяем три вещи, на которых стоял
// баг: данные не режутся на 200 символах, длинная строка без пробелов переносится (нет
// горизонтального обрезания), а высокий блок скроллится по вертикали.
// Вердикт = код возврата: 0 = PASS, 1 = FAIL.
// Запуск: node tests/operation-sign-data-window.mjs
// Честный контроль: VZN_DIR=/путь/к/коду/до/фикса node tests/operation-sign-data-window.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = process.env.VZN_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8919, DBG = 9319;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`); if (!ok) fails.push(name); };

// Сирота на отладочном порту молча подменит проверяемую страницу — отказываемся.
try { const r = await fetch(`http://127.0.0.1:${DBG}/json`, { signal: AbortSignal.timeout(1200) }); if (r.ok) { console.error(`ERR: debug port ${DBG} занят другим браузером`); process.exit(1); } } catch (_) {}

const srv = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', DIR], { stdio: 'ignore' });
const chrome = spawn(process.env.CHROMIUM_BIN || 'chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dbus',
  `--remote-debugging-port=${DBG}`, '--user-data-dir=/tmp/vzn-signdata-' + process.pid, 'about:blank'],
  { stdio: 'ignore', detached: true });

let ws, msgId = 0; const pending = new Map(); const jsErrors = [];
const cmd = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
async function evalJS(expr, awaitPromise = true) {
  const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
}
const waitFor = async (expr, tries = 30, ms = 300) => { for (let i = 0; i < tries; i++) { if (await evalJS(expr)) return true; await sleep(ms); } return false; };

const STUB = `
window.__sent=[];
window.__state={users:{alpha:{regular_key:'r',memo_key:'m',active_key:'a'}},current_user:'alpha',settings:{energy_step:20,award_energy:200,dark:false,lang:'ru'},rules:{},encoded:false,decoded:true};
window.chrome={runtime:{lastError:null,sendMessage:function(msg,cb){
  cb=cb||function(){};
  if(msg.get_state){ setTimeout(function(){cb({decoded:true,state:window.__state});},0); return; }
  window.__sent.push(msg);
  setTimeout(function(){cb(false);},0);
},getURL:function(p){return p;}},
windows:{WINDOW_ID_CURRENT:-2,update:function(){}},
storage:{local:{get:function(k,cb){cb({});},set:function(o,cb){if(cb)cb();},remove:function(k,cb){if(cb)cb();}}}};
`;

const signAction = data => ({
  operation: 'sign_data',
  operation_type: ['sign', 'account', 'regular'],
  origin: 'https://hub.viz.world', event: 7, id: 1,
  authority: 'regular', data_to_sign: data
});

const SHORT = 'hub.viz.world:inbox.list:1788328074';
// Длинная строка БЕЗ пробелов — именно она уезжала за край, если нет переноса.
const LONG = 'hub.viz.world:inbox.get:' + 'a1b2c3d4e5'.repeat(60) + ':1788328074';
const HUGE = 'x'.repeat(25000);

async function openAction(action) {
  await cmd('Page.navigate', { url: 'about:blank' });
  await sleep(150);
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
  await cmd('Page.navigate', { url: `http://127.0.0.1:${PORT}/operation.html#` + encodeURI(JSON.stringify(action)) });
  await sleep(1200);
  await waitFor(`!!document.querySelector('.approve-action')`);
}
const dataBox = () => evalJS(`(function(){var e=document.querySelectorAll('.action .limit-height');e=e[e.length-1];if(!e)return null;return {text:e.innerText,cw:e.clientWidth,sw:e.scrollWidth,ch:e.clientHeight,sh:e.scrollHeight,ov:getComputedStyle(e).overflowY};})()`);
const actionText = () => evalJS(`document.querySelector('.action').innerText`);

try {
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

  // --- короткая строка: видна целиком, без горизонтального выезда ---
  await openAction(signAction(SHORT));
  let box = await dataBox();
  check('короткая: блок данных отрисован', !!box);
  check('короткая: строка видна целиком', !!box && box.text.replace(/\s+/g, '') === SHORT, box && JSON.stringify(box.text));
  check('короткая: нет горизонтального обрезания', !!box && box.sw <= box.cw + 1, box && `sw=${box.sw} cw=${box.cw}`);
  check('короткая: без вертикального скролла (влезает)', !!box && box.sh <= box.ch + 1, box && `sh=${box.sh} ch=${box.ch}`);

  // --- длинная строка без пробелов: полный текст + вертикальный скролл ---
  await openAction(signAction(LONG));
  box = await dataBox();
  check('длинная: текст не обрезан на 200 символах', !!box && box.text.replace(/\s+/g, '') === LONG, box && `len=${box.text.replace(/\s+/g, '').length} ожидали ${LONG.length}`);
  check('длинная: без многоточия-заглушки', !!box && !box.text.includes('...'), box && box.text.slice(0, 60));
  check('длинная: нет горизонтального обрезания', !!box && box.sw <= box.cw + 1, box && `sw=${box.sw} cw=${box.cw}`);
  check('длинная: есть вертикальный скролл', !!box && box.sh > box.ch && box.ov === 'auto', box && `sh=${box.sh} ch=${box.ch} overflow-y=${box.ov}`);
  check('длинная: блок остался компактным (<=120px)', !!box && box.ch <= 120, box && `ch=${box.ch}`);
  const ltext = await actionText();
  check('длинная: показана длина данных', ltext.includes('(' + LONG.length + ')'), ltext.split('\n').find(l => l.startsWith('Data')));

  // --- гигантский вход: режем, но НЕ молча ---
  await openAction(signAction(HUGE));
  const htext = await actionText();
  check('огромная: обрезка подписана числами', htext.includes('20000 / 25000'), htext.split('\n').find(l => l.startsWith('Data')));

  // --- одобрение доносит данные без подмены ---
  await openAction(signAction(SHORT));
  await evalJS(`document.querySelector('.approve-action').dispatchEvent(new MouseEvent('click',{bubbles:true}))`, false);
  await sleep(400);
  const sent = JSON.parse(await evalJS(`JSON.stringify(window.__sent[window.__sent.length-1]||null)`) || 'null');
  check('одобрение ушло в background с теми же данными', !!sent && true === sent.approve && sent.data_to_sign === SHORT, sent && String(sent.data_to_sign).slice(0, 50));
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
