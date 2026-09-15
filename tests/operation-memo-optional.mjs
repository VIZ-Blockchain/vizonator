// Окно подтверждения (operation.html): сайт может пометить шифрование memo как ОПЦИОНАЛЬНОЕ
// (optional_memo_encoding) для transfer/award/fixed_award — тогда решает пользователь галочкой,
// а не сайт своим force_memo_encoding. Правила: галочка по умолчанию включена (шифровать), но
// показывается ТОЛЬКО когда у подписывающего аккаунта вообще есть memo-ключ — иначе шифровать
// нечем, и вместо бесполезной галочки остаётся обычное "не будет зашифрована". force_memo_encoding
// (сайт требует шифрование жёстко) всегда побеждает optional — галочки в этом случае нет.
// Вердикт = код возврата: 0 = PASS, 1 = FAIL.
// Запуск: node tests/operation-memo-optional.mjs
// Честный контроль: VZN_DIR=/путь/к/коду/до/фикса node tests/operation-memo-optional.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = process.env.VZN_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8925, DBG = 9325;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`); if (!ok) fails.push(name); };

try { const r = await fetch(`http://127.0.0.1:${DBG}/json`, { signal: AbortSignal.timeout(1200) }); if (r.ok) { console.error(`ERR: debug port ${DBG} занят другим браузером`); process.exit(1); } } catch (_) {}

const srv = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', DIR], { stdio: 'ignore' });
const chrome = spawn(process.env.CHROMIUM_BIN || 'chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dbus',
  `--remote-debugging-port=${DBG}`, '--user-data-dir=/tmp/vzn-memo-opt-' + process.pid, 'about:blank'],
  { stdio: 'ignore', detached: true });

let ws, msgId = 0; const pending = new Map(); const jsErrors = [];
const cmd = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
async function evalJS(expr, awaitPromise = true) {
  const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
}

// stub_memo_key: '' у withoutmemo моделирует аккаунт без заведённого memo-ключа.
const STUB = `
window.__lastSend=null;
//get_state в background.js СТРИПАЕТ memo_key в булев account.memo (ключи наружу не уходят) —
//стаб воспроизводит именно эту форму ответа, иначе тест проверял бы несуществующую форму.
window.__state={users:{withmemo:{memo:true,active:true},withoutmemo:{memo:false,active:true}},current_user:'withmemo',settings:{energy_step:20,award_energy:200,dark:false,lang:'ru'},rules:{},encoded:false,decoded:true};
window.chrome={runtime:{lastError:null,sendMessage:function(msg,cb){
  cb=cb||function(){};
  if(msg.get_state){ setTimeout(function(){cb({decoded:true,state:window.__state});},0); return; }
  if(msg.get_account_info){ setTimeout(function(){cb({current_energy:8000,current_shares:1000,current_balance:'100.000'});},0); return; }
  if(msg.inpage_action){ window.__lastSend=msg; setTimeout(function(){cb(true);},0); return; }
  setTimeout(function(){cb(false);},0);
},getURL:function(p){return p;}},
windows:{WINDOW_ID_CURRENT:-2,update:function(){}},
storage:{local:{get:function(k,cb){setTimeout(function(){cb({});},400);},set:function(o,cb){if(cb)cb();},remove:function(k,cb){if(cb)cb();}}}};
`;

const base = { operation: 'transfer', operation_type: ['transfer', 'active'], origin: 'https://dapp.example', event: 9, id: 1, to: 'bob', amount: '1.000 VIZ', memo: 'hello world' };

async function open(action, user) {
  await cmd('Page.navigate', { url: 'about:blank' });
  await sleep(150);
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: STUB + (user ? `window.__state.current_user=${JSON.stringify(user)};` : '') });
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

  // --- optional=true, у аккаунта ЕСТЬ memo-ключ: галочка есть, включена по умолчанию ---
  await open({ ...base, force_memo_encoding: false, optional_memo_encoding: true }, 'withmemo');
  check('галочка выбора шифрования показана', await evalJS(`!!document.querySelector('.encode_memo_input')`));
  check('галочка включена по умолчанию (мемо есть)', await evalJS(`document.querySelector('.encode_memo_input').checked===true`));
  let text = await evalJS(`document.body.innerText`);
  check('статус по умолчанию: будет зашифрована', /будет зашифрован/i.test(text) && !/не будет зашифрован/i.test(text), text.slice(0, 250));

  // --- снимаем галочку вживую: статус обязан перевернуться без перезагрузки окна ---
  await evalJS(`(function(){var el=document.querySelector('.encode_memo_input');el.checked=false;el.dispatchEvent(new Event('change'));})()`);
  await sleep(150);
  text = await evalJS(`document.body.innerText`);
  check('снятая галочка тут же меняет статус на "не будет зашифрована"', /не будет зашифрован/i.test(text), text.slice(0, 250));
  check('warn-класс появляется на снятой галочке', await evalJS(`!!document.querySelector('.encode_memo_status.warn')`));

  // --- approve с снятой галочкой шлёт background encrypt_memo:false ---
  await evalJS(`document.querySelector('.approve-action').click()`);
  await sleep(150);
  const sentOff = await evalJS(`window.__lastSend && window.__lastSend.encrypt_memo`);
  check('одобрение с выключенной галочкой шлёт encrypt_memo=false', sentOff === false, 'sent=' + JSON.stringify(sentOff));

  // --- ту же операцию заново, галочку оставляем включённой — approve шлёт encrypt_memo:true ---
  await open({ ...base, force_memo_encoding: false, optional_memo_encoding: true }, 'withmemo');
  await evalJS(`document.querySelector('.approve-action').click()`);
  await sleep(150);
  const sentOn = await evalJS(`window.__lastSend && window.__lastSend.encrypt_memo`);
  check('одобрение с включённой (по умолчанию) галочкой шлёт encrypt_memo=true', sentOn === true, 'sent=' + JSON.stringify(sentOn));

  // --- optional=true, но у аккаунта НЕТ memo-ключа: галочки нет вообще, обычный warn ---
  await open({ ...base, force_memo_encoding: false, optional_memo_encoding: true }, 'withoutmemo');
  check('без memo-ключа галочка НЕ показывается', await evalJS(`!document.querySelector('.encode_memo_input')`));
  text = await evalJS(`document.body.innerText`);
  check('без memo-ключа статус — обычное предупреждение "не будет зашифрована"',
    /не будет зашифрован/i.test(text), text.slice(0, 250));

  // --- force_memo_encoding побеждает optional: галочки нет, шифрование безусловное ---
  await open({ ...base, force_memo_encoding: true, optional_memo_encoding: true }, 'withmemo');
  check('force=true перебивает optional: галочки нет', await evalJS(`!document.querySelector('.encode_memo_input')`));
  text = await evalJS(`document.body.innerText`);
  check('force=true: статус — будет зашифрована безусловно', /будет зашифрован/i.test(text) && !/не будет зашифрован/i.test(text), text.slice(0, 250));

  // --- обычный сайт без optional_memo_encoding: поведение как раньше, без галочки ---
  await open({ ...base, force_memo_encoding: false }, 'withmemo');
  check('без optional_memo_encoding — как раньше, без галочки', await evalJS(`!document.querySelector('.encode_memo_input')`));

  // --- то же самое для award (тот же helper) ---
  await open({ operation: 'award', operation_type: ['award', 'active'], origin: 'https://dapp.example', event: 10, id: 2,
    receiver: 'bob', energy: false, custom_sequence: 0, memo: 'award memo', force_memo_encoding: false, optional_memo_encoding: true, beneficiaries: [] }, 'withmemo');
  check('award: галочка тоже показывается', await evalJS(`!!document.querySelector('.encode_memo_input')`));

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
console.log(fails.length ? `FAILED: ${fails.length} — ${fails.join('; ')}` : 'OK: optional memo encoding passed');
process.exit(fails.length ? 1 : 0);
