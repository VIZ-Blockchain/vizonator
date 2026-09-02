// Приёмка окна подтверждения (operation.html) для encrypt/decrypt: пользователь обязан
// УВИДЕТЬ, что именно он разрешает — какой сайт, каким ключом, кому пишет или сколько
// чужих писем читает. Пустое окно (как было у pm-операций до фикса) = провал.
// Вердикт = код возврата: 0 = PASS, 1 = FAIL.
// Запуск: node tests/operation-memo-window.mjs
// Честный контроль: VZN_DIR=/путь/к/коду/без/веток node tests/operation-memo-window.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = process.env.VZN_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8917, DBG = 9317;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`); if (!ok) fails.push(name); };

// Сирота на отладочном порту молча подменит проверяемую страницу — отказываемся.
try { const r = await fetch(`http://127.0.0.1:${DBG}/json`, { signal: AbortSignal.timeout(1200) }); if (r.ok) { console.error(`ERR: debug port ${DBG} занят другим браузером`); process.exit(1); } } catch (_) {}

const srv = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', DIR], { stdio: 'ignore' });
const chrome = spawn(process.env.CHROMIUM_BIN || 'chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dbus',
  `--remote-debugging-port=${DBG}`, '--user-data-dir=/tmp/vzn-memo-' + process.pid, 'about:blank'],
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

const PEER = 'VIZ5RWLQudhUehv8bFcVwqJWBor8VTy4psRS2J2s9PwahRhw6fEVp';
const ENCRYPT = {
  operation: 'encrypt',
  operation_type: ['memo_crypto', 'encrypt', 'memo'],
  origin: 'https://hub.viz.world', event: 3, id: 1,
  account: false, to: PEER, message: 'секретное письмо', items: []
};
const DECRYPT = {
  operation: 'decrypt',
  operation_type: ['memo_crypto', 'decrypt', 'memo'],
  origin: 'https://hub.viz.world', event: 4, id: 2,
  account: false, to: false, message: false,
  items: [{ id: 1, from: PEER, ct: 'AAAA', iv: 'AAAAAAAAAAAAAAAB' }, { id: 2, from: PEER, ct: 'BBBB', iv: 'AAAAAAAAAAAAAAAB' }]
};

async function openAction(action) {
  await cmd('Page.navigate', { url: 'about:blank' });
  await sleep(150);
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
  await cmd('Page.navigate', { url: `http://127.0.0.1:${PORT}/operation.html#` + encodeURI(JSON.stringify(action)) });
  await sleep(1200);
}
const actionText = () => evalJS(`document.querySelector('.action').innerText`);
const clickBtn = sel => evalJS(`document.querySelector('${sel}').dispatchEvent(new MouseEvent('click',{bubbles:true}))`, false);

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

  // --- окно шифрования ---
  await openAction(ENCRYPT);
  check('окно отрисовано, есть кнопка одобрения', await waitFor(`!!document.querySelector('.approve-action')`));
  const text = await actionText();
  check('окно не пустое', text.trim().length > 20, JSON.stringify(text.slice(0, 60)));
  check('видно название операции по-русски', text.includes('Зашифровать'), text.split('\n')[0]);
  check('виден источник запроса', text.includes('hub.viz.world'));
  check('видно, каким ключом', text.includes('memo'));
  check('виден получатель', text.includes(PEER.slice(0, 12)));
  check('виден сам текст письма', text.includes('секретное письмо'));
  check('без JS-ошибок', jsErrors.length === 0, jsErrors.join(' | '));

  // одобрение доносит параметры без подмены
  await clickBtn('.approve-action');
  await sleep(400);
  const sent = JSON.parse(await evalJS(`JSON.stringify(window.__sent[window.__sent.length-1]||null)`) || 'null');
  check('одобрение ушло в background', !!sent && true === sent.approve && true === sent.inpage_action);
  check('текст письма не подменился', !!sent && sent.message === ENCRYPT.message, sent && String(sent.message).slice(0, 40));
  check('получатель не подменился', !!sent && sent.to === PEER);

  // --- окно расшифровки пачки ---
  jsErrors.length = 0;
  await openAction(DECRYPT);
  await waitFor(`!!document.querySelector('.approve-action')`);
  const dtext = await actionText();
  check('расшифровка: окно не пустое', dtext.trim().length > 20, JSON.stringify(dtext.slice(0, 60)));
  check('расшифровка: название по-русски', dtext.includes('Расшифровать'), dtext.split('\n')[0]);
  check('видно, сколько писем читают', /2/.test(dtext) && dtext.includes('Сообщений'), dtext.replace(/\n/g, ' | '));
  check('виден ключ отправителя', dtext.includes(PEER.slice(0, 12)));
  check('расшифровка: без JS-ошибок', jsErrors.length === 0, jsErrors.join(' | '));

  // --- отказ ---
  await clickBtn('.refuse-action');
  await sleep(400);
  const refused = JSON.parse(await evalJS(`JSON.stringify(window.__sent[window.__sent.length-1]||null)`) || 'null');
  check('отказ ушёл в background', !!refused && true === refused.refuse && false === refused.approve);
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
