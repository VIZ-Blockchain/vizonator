// Окно подтверждения (operation.html): длинная заметка не должна растягивать окно, и статус
// шифрования обязан быть виден ВСЕГДА, а не только когда страница просит шифровать.
// Баг со скриншота владельца (15.09.2026): перевод от hub.viz.world с длинным memo
// (`@on1x/file/<hash>`) без пробелов растягивал окно вбок, а про (не)шифрование не было сказано
// ни слова — пользователь не мог понять, уйдёт заметка в открытом виде или нет.
// Вердикт = код возврата: 0 = PASS, 1 = FAIL.
// Запуск: node tests/operation-memo-notice.mjs
// Честный контроль: VZN_DIR=/путь/к/коду/до/фикса node tests/operation-memo-notice.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = process.env.VZN_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8924, DBG = 9324;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`); if (!ok) fails.push(name); };

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

const STUB = `
window.__state={users:{alpha:{regular_key:'r',memo_key:'m',active_key:'a'}},current_user:'alpha',settings:{energy_step:20,award_energy:200,dark:false,lang:'ru'},rules:{},encoded:false,decoded:true};
window.chrome={runtime:{lastError:null,sendMessage:function(msg,cb){
  cb=cb||function(){};
  if(msg.get_state){ setTimeout(function(){cb({decoded:true,state:window.__state});},0); return; }
  if(msg.get_account_info){ setTimeout(function(){cb({current_energy:8000,current_shares:1000,current_balance:'100.000'});},0); return; }
  setTimeout(function(){cb(false);},0);
},getURL:function(p){return p;}},
windows:{WINDOW_ID_CURRENT:-2,update:function(){}},
storage:{local:{get:function(k,cb){setTimeout(function(){cb({});},400);},set:function(o,cb){if(cb)cb();},remove:function(k,cb){if(cb)cb();}}}};
`;

// Реальная длина такой заметки: '@on1x/file/' + 32-байтный hex-хэш, одно слово без пробелов.
const LONG_MEMO = '@on1x/file/83fd8fbda8800324a6ec97d412a8c9ee5d106829676e4a9c1c2b3d4e5f60718';
const base = { operation: 'transfer', operation_type: ['transfer', 'active'], origin: 'https://hub.viz.world', event: 9, id: 1, to: 'hub.viz.world', amount: '1.000 VIZ' };

async function open(action) {
  await cmd('Page.navigate', { url: 'about:blank' });
  await sleep(150);
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
  await cmd('Page.navigate', { url: `http://127.0.0.1:${PORT}/operation.html#` + encodeURI(JSON.stringify(action)) });
  await sleep(1000);
}

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

  // --- баг со скриншота: длинная заметка без шифрования (обычный dApp-перевод) ---
  await open({ ...base, memo: LONG_MEMO, force_memo_encoding: false });
  const box = await evalJS(`document.body.innerText.length>10`);
  check('окно отрисовалось', box);

  const memoBoxWidth = await evalJS(`(function(){
    var el=document.querySelector('.limit-height');
    return el ? Math.round(el.getBoundingClientRect().width) : -1;
  })()`);
  const windowWidth = await evalJS(`document.documentElement.scrollWidth`);
  check('заметка отрисована в ограниченном по высоте блоке (не голым текстом)', memoBoxWidth >= 0, 'width=' + memoBoxWidth);
  check('длинная заметка без пробелов НЕ растягивает окно вбок',
    windowWidth <= (await evalJS(`window.innerWidth`)) + 4, 'scrollWidth=' + windowWidth);
  check('длинное слово переносится (overflow-wrap), а не торчит одной строкой',
    await evalJS(`getComputedStyle(document.querySelector('.limit-height')).overflowWrap==='anywhere'`));

  check('memo-блок сообщает: заметка НЕ будет зашифрована',
    /не будет зашифрован/i.test(await evalJS(`document.body.innerText`)) ||
    /will not be encrypted/i.test(await evalJS(`document.body.innerText`)),
    (await evalJS(`document.body.innerText`)).slice(0, 200));
  check('предупреждение об открытой заметке показано заметно (класс warn)',
    await evalJS(`!!document.querySelector('.warn')`));

  // --- та же операция, но страница просит шифрование: должна появиться положительная строка ---
  await open({ ...base, memo: 'hello', force_memo_encoding: true });
  const textEnc = await evalJS(`document.body.innerText`);
  check('memo-блок сообщает: заметка будет зашифрована', /будет зашифрован/i.test(textEnc) || /will be encrypted/i.test(textEnc), textEnc.slice(0, 200));
  check('предупреждения про открытый текст при шифровании нет', !/не будет зашифрован/i.test(textEnc) && !/will not be encrypted/i.test(textEnc));

  // --- пустая заметка: никакого memo-блока и никакого статуса шифрования вообще ---
  await open({ ...base, memo: '', force_memo_encoding: false });
  const textEmpty = await evalJS(`document.body.innerText`);
  check('без заметки статус шифрования не показывается', !/зашифрован/i.test(textEmpty) && !/encrypted/i.test(textEmpty), textEmpty.slice(0, 200));

  // --- то же самое для award (тот же helper, другая операция) ---
  await open({ operation: 'award', operation_type: ['award', 'active'], origin: 'https://example.com', event: 10, id: 2,
    receiver: 'bob', energy: false, custom_sequence: 0, memo: LONG_MEMO, force_memo_encoding: false, beneficiaries: [] });
  const textAward = await evalJS(`document.body.innerText`);
  check('award с длинной заметкой тоже получает статус шифрования (не будет)',
    /не будет зашифрован/i.test(textAward) || /will not be encrypted/i.test(textAward), textAward.slice(0, 200));
  const awardWidth = await evalJS(`document.documentElement.scrollWidth`);
  check('award: длинная заметка тоже не растягивает окно', awardWidth <= (await evalJS(`window.innerWidth`)) + 4, 'scrollWidth=' + awardWidth);

  const fatal = jsErrors.filter(e => !/favicon|ERR_|net::/i.test(e));
  check('нет ошибок JS', fatal.length === 0, fatal.slice(0, 3).join(' | '));
} catch (e) {
  console.error('ERR:', e.message);
  fails.push(e.message);
} finally {
  try { ws && ws.close(); } catch (_) {}
  try { process.kill(-chrome.pid); } catch (_) {}
  try { srv.kill(); } catch (_) {}
}
console.log(fails.length ? `FAILED: ${fails.length} — ${fails.join('; ')}` : 'OK: memo notice passed');
process.exit(fails.length ? 1 : 0);
