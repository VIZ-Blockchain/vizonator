// Accessibility acceptance for the operation confirmation and settings pages.
// Verdict = exit code (0 = PASS, 1 = FAIL).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = process.env.VZN_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8920, DBG = 9320;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`); if (!ok) fails.push(name); };

try { const r = await fetch(`http://127.0.0.1:${DBG}/json`, { signal: AbortSignal.timeout(1200) }); if (r.ok) process.exit(1); } catch (_) {}
const srv = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', DIR], { stdio: 'ignore' });
const chrome = spawn(process.env.CHROMIUM_BIN || 'chromium', ['--headless=new','--no-sandbox','--disable-gpu','--disable-dbus',
  `--remote-debugging-port=${DBG}`, '--user-data-dir=/tmp/vzn-a11y-' + process.pid, 'about:blank'], { stdio:'ignore', detached:true });

let ws, msgId=0; const pending=new Map(); const jsErrors=[];
const cmd=(method,params={})=>new Promise((res,rej)=>{const id=++msgId;pending.set(id,{res,rej});ws.send(JSON.stringify({id,method,params}));});
async function evalJS(expression){const r=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;}
const waitFor=async(expr)=>{for(let i=0;i<30;i++){if(await evalJS(expr))return true;await sleep(200);}return false;};

const STUB=`
window.__sent=[];
window.__state={users:{alpha:{regular_key:'r',memo_key:'m',active_key:'a'}},current_user:'alpha',settings:{energy_step:20,award_energy:200,dark:false,lang:'ru'},rules:{},encoded:false,decoded:true};
window.chrome={runtime:{lastError:null,sendMessage:function(msg,cb){cb=cb||function(){};window.__sent.push(msg);if(msg.get_state){setTimeout(function(){cb({decoded:true,state:window.__state});},0);return;}if(msg.get_account_info){setTimeout(function(){cb({current_energy:8000,current_shares:1000,current_balance:'100.000'});},0);return;}setTimeout(function(){cb(false);},0);},getURL:function(p){return p;}},windows:{WINDOW_ID_CURRENT:-2,update:function(){}},storage:{local:{get:function(k,cb){cb({lang:'ru'});},set:function(o,cb){if(cb)cb();},remove:function(k,cb){if(cb)cb();}}}};
`;
const award={operation:'award',operation_type:['content','award','regular'],origin:'https://example.com',event:1,id:1,receiver:'bob',memo:'hello',custom_sequence:0,beneficiaries:[],energy:false};
const transfer={operation:'transfer',operation_type:['transfer','active'],origin:'https://example.com',event:2,id:2,to:'bob',amount:false,memo:'',force_memo_encoding:false};

async function open(url){await cmd('Page.navigate',{url:'about:blank'});await sleep(100);await cmd('Page.addScriptToEvaluateOnNewDocument',{source:STUB});await cmd('Page.navigate',{url});await sleep(900);}
const unnamed=()=>evalJS(`Array.from(document.querySelectorAll('a,button,input,select,textarea,[role="slider"]')).filter(function(el){if(el.type==='hidden')return false;var n=el.getAttribute('aria-label')||el.getAttribute('aria-labelledby')||el.getAttribute('title')||el.value||el.textContent.trim()||el.placeholder||el.closest('label');return !n;}).length`);

try{
  let target;
  for(let i=0;i<100&&!target;i++){try{const list=await(await fetch(`http://127.0.0.1:${DBG}/json`)).json();target=list.find(t=>t.type==='page');}catch(_){}if(!target)await sleep(200);}
  if(!target)throw new Error('chromium did not start');
  const {WebSocket}=await import('ws').catch(()=>({WebSocket:globalThis.WebSocket}));
  ws=new WebSocket(target.webSocketDebuggerUrl,{maxPayload:64*1024*1024});
  await new Promise((res,rej)=>{ws.on? (ws.on('open',res),ws.on('error',rej)):(ws.onopen=res,ws.onerror=rej);});
  ws.on?ws.on('message',onMessage):(ws.onmessage=e=>onMessage(e.data));
  function onMessage(raw){const m=JSON.parse(raw.toString());if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.rej(new Error(JSON.stringify(m.error))):p.res(m.result);}if(m.method==='Runtime.exceptionThrown')jsErrors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);}
  await cmd('Page.enable');await cmd('Runtime.enable');

  await open(`http://127.0.0.1:${PORT}/operation.html#`+encodeURI(JSON.stringify(award)));
  check('award confirmation rendered',await waitFor(`!!document.querySelector('.approve-action')`));
  check('document language follows settings',await evalJS(`document.documentElement.lang==='ru'`));
  check('approve/refuse are keyboard buttons',await evalJS(`Array.from(document.querySelectorAll('.approve-action,.refuse-action')).every(function(el){return el.getAttribute('role')==='button'&&el.tabIndex===0;})`));
  check('energy is an accessible slider',await evalJS(`(function(){var s=document.querySelector('.select_energy');return s&&s.getAttribute('role')==='slider'&&s.tabIndex===0&&s.hasAttribute('aria-valuenow')&&s.hasAttribute('aria-valuetext');})()`));
  const before=await evalJS(`document.querySelector('.select_energy').getAttribute('aria-valuenow')`);
  await evalJS(`document.querySelector('.select_energy').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));true`);await sleep(100);
  const after=await evalJS(`document.querySelector('.select_energy').getAttribute('aria-valuenow')`);
  check('energy changes with arrow keys',Number(after)>Number(before),`${before} -> ${after}`);
  check('operation controls have accessible names',(await unnamed())===0,'unnamed='+await unnamed());

  await open(`http://127.0.0.1:${PORT}/operation.html#`+encodeURI(JSON.stringify(transfer)));
  check('transfer amount has name and error relation',await waitFor(`(function(){var i=document.querySelector('.amount_input');return i&&i.getAttribute('aria-label')&&i.getAttribute('aria-describedby')==='transfer-amount-balance transfer-amount-error';})()`));
  await evalJS(`document.querySelector('.approve-action').click();true`);await sleep(100);
  check('invalid amount is exposed',await evalJS(`document.querySelector('.amount_input').getAttribute('aria-invalid')==='true'&&document.querySelector('.amount_error').getAttribute('role')==='alert'`));

  await open(`http://127.0.0.1:${PORT}/options.html`);
  check('settings rendered',await waitFor(`!!document.querySelector('.account-form')`));
  check('settings fields have accessible names',(await unnamed())===0,'unnamed='+await unnamed());
  check('settings status is live',await evalJS(`document.querySelector('.settings_status').getAttribute('role')==='status'`));

  await open(`http://127.0.0.1:${PORT}/popup.html`);
  check('popup rendered',await waitFor(`!!document.querySelector('.accounts-list-action')`));
  await evalJS(`document.querySelector('.accounts-list-action').focus();document.querySelector('.accounts-list-action').click();true`);await sleep(150);
  check('popup modal is an accessible dialog',await evalJS(`(function(){var m=document.querySelector('.modal');return m&&m.getAttribute('role')==='dialog'&&m.getAttribute('aria-modal')==='true'&&m.getAttribute('aria-labelledby');})()`));
  check('modal close control has a name',await evalJS(`!!document.querySelector('.close-modal-action').getAttribute('aria-label')`));
  check('focus moves into modal',await evalJS(`document.querySelector('.modal').contains(document.activeElement)`));
  await evalJS(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true`);await sleep(150);
  check('Escape closes modal',await evalJS(`!document.querySelector('.modal')`));
  check('focus returns to modal trigger',await evalJS(`document.activeElement===document.querySelector('.accounts-list-action')`));

  await evalJS(`show_wallet_form();true`);await sleep(150);
  check('TON gateway template is selected by default',await evalJS(`(function(){var s=document.querySelector('[name="transfer-template"]');var a=document.querySelector('[name="form-account"]');var m=document.querySelector('[name="form-memo"]');return s&&s.value==='ton'&&a&&a.value==='gram.gate'&&m&&m.placeholder===ltmp_arr.transfer_template_ton_memo;})()`));
  check('memo encryption is disabled for TON gateway',await evalJS(`(function(){var e=document.querySelector('[name="encode-memo"]');return !e||e.disabled;})()`));
  await evalJS(`(function(){var s=document.querySelector('[name="transfer-template"]');s.value='regular';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);await sleep(50);
  check('regular transfer template clears gateway fields',await evalJS(`document.querySelector('[name="form-account"]').value===''&&document.querySelector('[name="form-memo"]').value===''`));
  await evalJS(`(function(){window.prompt=function(){return 'Мой <шаблон>';};document.querySelector('[name="form-account"]').value='friend';document.querySelector('[name="form-memo"]').value='hello';document.querySelector('.transfer-template-save').click();})()`);await sleep(50);
  check('custom transfer template is saved locally',await evalJS(`(function(){var t=JSON.parse(localStorage['viz_transfer_templates']);var o=document.querySelector('option[data-custom]');return t.length===1&&t[0].name==='Мой <шаблон>'&&t[0].account==='friend'&&t[0].memo==='hello'&&o&&o.textContent==='Мой <шаблон>'&&!o.querySelector('img')&&!document.querySelector('.transfer-template-remove').disabled;})()`));
  await evalJS(`document.querySelector('.transfer-template-remove').click();true`);await sleep(50);
  check('custom transfer template can be deleted',await evalJS(`JSON.parse(localStorage['viz_transfer_templates']).length===0&&!document.querySelector('option[data-custom]')&&document.querySelector('[name="transfer-template"]').value==='regular'`));
  await evalJS(`(function(){var s=document.querySelector('[name="transfer-template"]');s.value='ton';s.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.transfer-action').click();})()`);await sleep(50);
  check('TON gateway requires an unencrypted address memo',await evalJS(`document.querySelector('.error-caption').textContent===ltmp_arr.transfer_template_ton_memo_error&&document.activeElement===document.querySelector('[name="form-memo"]')`));
  await evalJS(`(function(){document.querySelector('[name="form-amount"]').value='1';document.querySelector('[name="form-memo"]').value='UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';document.querySelector('.transfer-action').click();})()`);await sleep(100);
  check('TON template sends plain address memo to gram.gate',await evalJS(`(function(){var m=window.__sent.filter(function(item){return item.operation==='transfer';}).pop();return m&&m.to==='gram.gate'&&m.memo==='UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'&&m.force_memo_encoding===false;})()`));
  check('popup controls have accessible names',(await unnamed())===0,'unnamed='+await unnamed());
  check('no JS errors',jsErrors.length===0,jsErrors.join(' | '));
}catch(e){console.error('ERR:',e.message);fails.push(e.message);}finally{try{ws&&ws.close();}catch(_){}try{process.kill(-chrome.pid);}catch(_){}try{srv.kill();}catch(_){}}
console.log(fails.length?`FAILED: ${fails.length} — ${fails.join('; ')}`:'OK: accessibility checks passed');
process.exit(fails.length?1:0);
