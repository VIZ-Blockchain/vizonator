// Приёмка окна подтверждения (operation.html) для операций рынка предсказаний:
// пользователь должен УВИДЕТЬ, что подписывает (какая операция, чей ключ, суммы),
// а по «одобрить» ровно эти параметры обязаны уйти в background.
// Вердикт = код возврата: 0 = PASS, 1 = FAIL.
// Запуск: node tests/operation-pm-window.mjs
// Честный контроль: VZN_DIR=/путь/к/коду/без/pm_ops node tests/operation-pm-window.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = process.env.VZN_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8913, DBG = 9313;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`); if (!ok) fails.push(name); };

// Сирота на отладочном порту молча подменит проверяемую страницу — отказываемся.
try { const r = await fetch(`http://127.0.0.1:${DBG}/json`, { signal: AbortSignal.timeout(1200) }); if (r.ok) { console.error(`ERR: debug port ${DBG} занят другим браузером`); process.exit(1); } } catch (_) {}

const srv = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', DIR], { stdio: 'ignore' });
const chrome = spawn('chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dbus',
  `--remote-debugging-port=${DBG}`, '--user-data-dir=/tmp/vzn-op-' + process.pid, 'about:blank'],
  { stdio: 'ignore', detached: true });

let ws, msgId = 0; const pending = new Map(); const jsErrors = [];
const cmd = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
async function evalJS(expr, awaitPromise = true) {
  const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
}
const waitFor = async (expr, tries = 30, ms = 300) => { for (let i = 0; i < tries; i++) { if (await evalJS(expr)) return true; await sleep(ms); } return false; };

// Заглушка chrome.*: окно живёт на get_state, а одобрение/отказ уходит тем же
// sendMessage — его и перехватываем, это и есть то, что увидит background.
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

const BET = {
  operation: 'pm_place_bet',
  operation_type: ['prediction_market', 'pm_place_bet', 'active'],
  origin: 'https://forecaster.win',
  event: 7,
  id: 1,
  pm_params: {market_id: 268633, side: 1, outcome_index: 0, amount: '12.500 VIZ', min_tokens: 9000}
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

  // --- окно ставки ---
  await openAction(BET);
  const rendered = await waitFor(`!!document.querySelector('.approve-action')`);
  check('окно отрисовано, есть кнопка одобрения', rendered);
  const text = rendered ? await actionText() : '';
  check('видно название операции по-русски', text.includes('Ставка'), text.split('\n')[0]);
  check('виден источник запроса', text.includes('forecaster.win'));
  check('видно техническое имя операции', text.includes('pm_place_bet'));
  check('видно, каким ключом подписываем', text.includes('active'));
  check('видна сумма', /12\.500/.test(text) && text.includes('Ƶ'), (text.match(/.*12\.500.*/) || [''])[0]);
  check('виден рынок', text.includes('268633'));
  check('видна защита от проскальзывания', text.includes('9000'));
  // omitted optional-ish field must not be invented on screen
  check('не показано поле, которого страница не прислала', !text.includes('mode'), text);
  check('без JS-ошибок', jsErrors.length === 0, jsErrors.join(' | '));

  // --- одобрение отдаёт background ровно те же параметры ---
  await clickBtn('.approve-action');
  await sleep(400);
  const sent = await evalJS(`JSON.stringify(window.__sent[window.__sent.length-1]||null)`);
  const msg = sent ? JSON.parse(sent) : null;
  check('одобрение ушло в background', !!msg && true === msg.approve && true === msg.inpage_action, sent && sent.slice(0, 120));
  check('параметры не подменились по дороге', !!msg && JSON.stringify(msg.pm_params) === JSON.stringify(BET.pm_params), msg ? JSON.stringify(msg.pm_params) : '');
  check('операция названа та же', !!msg && 'pm_place_bet' === msg.operation);

  // --- отказ ---
  await openAction(BET);
  await waitFor(`!!document.querySelector('.refuse-action')`);
  await clickBtn('.refuse-action');
  await sleep(400);
  const refused = JSON.parse(await evalJS(`JSON.stringify(window.__sent[window.__sent.length-1]||null)`) || 'null');
  check('отказ ушёл в background', !!refused && true === refused.refuse && false === refused.approve);

  // --- операция с ключом regular: окно обязано это показать ---
  jsErrors.length = 0;
  await openAction({
    operation: 'pm_dispute_vote',
    operation_type: ['prediction_market', 'pm_dispute_vote', 'regular'],
    origin: 'https://forecaster.win', event: 8, id: 2,
    pm_params: {market_id: 5, vote_outcome: 1, vote_percent: 10000}
  });
  await waitFor(`!!document.querySelector('.approve-action')`);
  const voteText = await actionText();
  check('спорное голосование: показан regular-ключ', voteText.includes('regular') && !voteText.includes('active'), voteText.replace(/\n/g, ' | '));
  check('спорное голосование: без JS-ошибок', jsErrors.length === 0, jsErrors.join(' | '));
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
