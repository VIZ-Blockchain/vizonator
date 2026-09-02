// Приёмка размера окна подтверждения (operation.html): окно обязано садиться
// РОВНО по содержимому — без пустой полосы снизу, без зазоров по краям и без скролла.
// Проверяется то, что окно реально просит у браузера (chrome.windows.update),
// на экране с масштабом 125% (--force-device-scale-factor=1.25) — именно там
// прежняя формула с devicePixelRatio раздувала окно на четверть.
// Вердикт = код возврата: 0 = PASS, 1 = FAIL.
// Запуск: node tests/operation-window-size.mjs
// Честный контроль: VZN_DIR=/tmp/vzn-old node tests/operation-window-size.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = process.env.VZN_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8914, DBG = 9314, SCALE = 1.25;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`); if (!ok) fails.push(name); };

try { const r = await fetch(`http://127.0.0.1:${DBG}/json`, { signal: AbortSignal.timeout(1200) }); if (r.ok) { console.error(`ERR: debug port ${DBG} занят другим браузером`); process.exit(1); } } catch (_) {}

const srv = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', DIR], { stdio: 'ignore' });
const chrome = spawn(process.env.CHROMIUM_BIN || 'chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dbus',
  `--force-device-scale-factor=${SCALE}`, '--window-size=346,486',
  `--remote-debugging-port=${DBG}`, '--user-data-dir=/tmp/vzn-size-' + process.pid, 'about:blank'],
  { stdio: 'ignore', detached: true });

let ws, msgId = 0; const pending = new Map(); const jsErrors = [];
const cmd = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
async function evalJS(expr, awaitPromise = true) {
  const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
}
const waitFor = async (expr, tries = 30, ms = 300) => { for (let i = 0; i < tries; i++) { if (await evalJS(expr)) return true; await sleep(ms); } return false; };

// Заглушка chrome.*: запоминаем ПОСЛЕДНИЙ запрошенный размер окна.
const STUB = `
window.__resize=[];
window.__state={users:{alpha:{regular_key:'r',memo_key:'m',active_key:'a'}},current_user:'alpha',settings:{energy_step:20,award_energy:200,dark:false,lang:'ru'},rules:{},encoded:false,decoded:true};
window.chrome={runtime:{lastError:null,sendMessage:function(msg,cb){
  cb=cb||function(){};
  if(msg.get_state){ setTimeout(function(){cb({decoded:true,state:window.__state});},0); return; }
  setTimeout(function(){cb(false);},0);
},getURL:function(p){return p;}},
windows:{WINDOW_ID_CURRENT:-2,update:function(id,info){window.__resize.push(info);}},
storage:{local:{get:function(k,cb){cb({});},set:function(o,cb){if(cb)cb();},remove:function(k,cb){if(cb)cb();}}}};
`;

const BET = {
  operation: 'pm_place_bet',
  operation_type: ['prediction_market', 'pm_place_bet', 'active'],
  origin: 'https://forecaster.win',
  event: 7, id: 1,
  pm_params: {market_id: 268633, side: 1, outcome_index: 0, amount: '12.500 VIZ', min_tokens: 9000}
};

try {
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json(); target = list.find(t => t.type === 'page'); } catch (_) {}
    if (!target) await sleep(300);
  }
  if (!target) throw new Error('не поднялся chromium');
  const { WebSocket } = await import('ws').catch(() => ({ WebSocket: globalThis.WebSocket }));
  ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.on ? (ws.on('open', res), ws.on('error', rej)) : (ws.onopen = res, ws.onerror = rej); });
  const onMsg = raw => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    if (m.method === 'Runtime.exceptionThrown') jsErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  ws.on ? ws.on('message', onMsg) : (ws.onmessage = e => onMsg(e.data));
  await cmd('Page.enable'); await cmd('Runtime.enable');

  await cmd('Page.navigate', { url: 'about:blank' });
  await sleep(150);
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
  await cmd('Page.navigate', { url: `http://127.0.0.1:${PORT}/operation.html#` + encodeURI(JSON.stringify(BET)) });
  await sleep(1200);

  check('окно отрисовано', await waitFor(`!!document.querySelector('.approve-action')`));
  const m = JSON.parse(await evalJS(`JSON.stringify({
    dpr:window.devicePixelRatio,
    frameW:Math.max(0,window.outerWidth-window.innerWidth),
    frameH:Math.max(0,window.outerHeight-window.innerHeight),
    bodyW:document.body.offsetWidth,
    bodyH:Math.max(document.body.offsetHeight,document.body.scrollHeight),
    asked:window.__resize[window.__resize.length-1]||null
  })`));
  check('масштаб экрана действительно 125% (иначе проверка бессмысленна)', Math.abs(m.dpr - SCALE) < 0.01, 'dpr=' + m.dpr);
  check('окно попросило размер', !!m.asked, JSON.stringify(m.asked));

  const frameH = m.frameH || 36;
  const wantW = m.bodyW + m.frameW, wantH = m.bodyH + frameH;
  check('ширина = содержимое + рамка (нет зазоров по краям)', !!m.asked && Math.abs(m.asked.width - wantW) <= 1, `asked=${m.asked?.width} want=${wantW}`);
  check('высота = содержимое + рамка (нет пустой полосы снизу)', !!m.asked && Math.abs(m.asked.height - wantH) <= 1, `asked=${m.asked?.height} want=${wantH}`);
  check('размер не умножен на devicePixelRatio', !!m.asked && m.asked.height < wantH * 1.1, `asked=${m.asked?.height} inflated=${Math.round(wantH * SCALE)}`);
  check('содержимое не обрезано (нет вертикального скролла)', !!m.asked && m.asked.height >= wantH, `asked=${m.asked?.height} content=${m.bodyH}`);
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
