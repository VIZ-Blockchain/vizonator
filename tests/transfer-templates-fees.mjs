// Gateway transfer templates: the fee hint must be built from the LIVE gateway tariff
// (/fees), with the dictionary strings as the fallback when that endpoint is down.
// Verdict = exit code (0 = PASS, 1 = FAIL).
//
// The load-bearing check is the CHANGED TARIFF one: serving a different /fees must move
// the numbers in the hint. A hint that merely happens to contain "45" would pass a static
// assertion but fail that one.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = process.env.VZN_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8923, DBG = 9323;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`); if (!ok) fails.push(name); };

try { const r = await fetch(`http://127.0.0.1:${DBG}/json`, { signal: AbortSignal.timeout(1200) }); if (r.ok) process.exit(1); } catch (_) {}
const srv = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', DIR], { stdio: 'ignore' });
const chrome = spawn(process.env.CHROMIUM_BIN || 'chromium', ['--headless=new','--no-sandbox','--disable-gpu','--disable-dbus',
  `--remote-debugging-port=${DBG}`, '--user-data-dir=/tmp/vzn-fees-' + process.pid, 'about:blank'], { stdio:'ignore', detached:true });

let ws, msgId=0; const pending=new Map(); const jsErrors=[];
const cmd=(method,params={})=>new Promise((res,rej)=>{const id=++msgId;pending.set(id,{res,rej});ws.send(JSON.stringify({id,method,params}));});
async function evalJS(expression){const r=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;}
const waitFor=async(expr)=>{for(let i=0;i<30;i++){if(await evalJS(expr))return true;await sleep(200);}return false;};

// The gateway serves /recon and /fees separately; the stub answers both by URL so a test
// can break exactly one of them.
const stub = (recon, fees) => `
window.__state={users:{alpha:{regular_key:'r',memo_key:'m',active_key:'a'}},current_user:'alpha',settings:{energy_step:20,award_energy:200,dark:false,lang:'ru'},rules:{},encoded:false,decoded:true};
window.__recon=${JSON.stringify(recon)};
window.__fees=${fees === null ? 'null' : JSON.stringify(fees)};
window.fetch=function(url){
	var body = String(url).indexOf('/fees')>=0 ? window.__fees : window.__recon;
	if(body===null){return Promise.resolve({ok:false,status:503,json:function(){return Promise.resolve({});}});}
	return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(body);}});
};
window.chrome={runtime:{lastError:null,sendMessage:function(msg,cb){cb=cb||function(){};if(msg.get_state){setTimeout(function(){cb({decoded:true,state:window.__state});},0);return;}if(msg.get_account_info){setTimeout(function(){cb({current_energy:8000,current_shares:1000,current_balance:'100.000'});},0);return;}setTimeout(function(){cb(false);},0);},getURL:function(p){return p;}},windows:{WINDOW_ID_CURRENT:-2,update:function(){}},storage:{local:{get:function(k,cb){cb({lang:'ru'});},set:function(o,cb){if(cb)cb();},remove:function(k,cb){if(cb)cb();}}}};
`;

const OK_RECON = {ok:true,paused:false,chains:{GRAM:{status:'OK'},SOLANA:{status:'OK'}}};
// Shape and values as served live on 14.09.2026.
const LIVE_FEES = {floorMilliViz:{GRAM:45000,SOLANA:10000},bps:20,activationSurchargeMilliViz:{GRAM:37500,SOLANA:40000},mintGasFloorMilliViz:{GRAM:1000,SOLANA:1000},refundFeeMilliViz:5000,decimals:3};
// A tariff that moved: the GRAM floor follows the VIZ/TON rate, so it can change.
const MOVED_FEES = {floorMilliViz:{GRAM:60000,SOLANA:10000},bps:20,activationSurchargeMilliViz:{GRAM:45000,SOLANA:40000},mintGasFloorMilliViz:{GRAM:1000,SOLANA:1000},refundFeeMilliViz:5000,decimals:3};
// Same, with the refund fee moved too — the refund line is its own number.
const MOVED_REFUND_FEES = {...LIVE_FEES, refundFeeMilliViz:7000};

async function openWith(stubSrc, template){
	await cmd('Page.navigate',{url:'about:blank'});
	await sleep(80);
	await cmd('Page.addScriptToEvaluateOnNewDocument',{source:stubSrc});
	await cmd('Page.navigate',{url:`http://127.0.0.1:${PORT}/popup.html`});
	await sleep(700);
	await evalJS(`(function(){var b=document.querySelector('.show-wallet-form'); if(b){b.click();} else if(typeof show_wallet_form==='function'){show_wallet_form();}})();true`);
	await sleep(200);
	if(!await waitFor(`!!document.querySelector('[name="transfer-template"]')`)){
		return null;
	}
	if(template){
		await evalJS(`(function(){var s=document.querySelector('[name="transfer-template"]');s.value=${JSON.stringify(template)};s.dataset.userChanged='true';s.dispatchEvent(new Event('change',{bubbles:true}));})();true`);
		await sleep(150);
	}
	return evalJS(`document.querySelector('.transfer-template-hint').textContent`);
}

try {
	let target;
	for(let i=0;i<100&&!target;i++){try{const list=await(await fetch(`http://127.0.0.1:${DBG}/json`)).json();target=list.find(t=>t.type==='page');}catch(_){}if(!target)await sleep(200);}
	if(!target)throw new Error('chromium did not start');
	const {WebSocket}=await import('ws').catch(()=>({WebSocket:globalThis.WebSocket}));
	ws=new WebSocket(target.webSocketDebuggerUrl,{maxPayload:64*1024*1024});
	await new Promise((res,rej)=>{ws.on? (ws.on('open',res),ws.on('error',rej)):(ws.onopen=res,ws.onerror=rej);});
	ws.on?ws.on('message',onMessage):(ws.onmessage=e=>onMessage(e.data));
	function onMessage(raw){const m=JSON.parse(raw.toString());if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.rej(new Error(JSON.stringify(m.error))):p.res(m.result);}if(m.method==='Runtime.exceptionThrown')jsErrors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);}
	await cmd('Page.enable');await cmd('Runtime.enable');

	// --- live tariff drives both hints
	const tonLive = await openWith(stub(OK_RECON, LIVE_FEES), 'ton');
	check('TON hint rendered', 'string'===typeof tonLive, tonLive ? tonLive.slice(0,50) : 'no hint');
	check('TON hint carries live floor, surcharge and minimums',
		!!tonLive && /45\b/.test(tonLive) && /37,5/.test(tonLive) && /\b46\b/.test(tonLive) && /83,5/.test(tonLive),
		tonLive);
	check('TON hint has no unsubstituted placeholder', !!tonLive && tonLive.indexOf('{')<0, tonLive);
	check('ru locale uses a comma decimal separator', !!tonLive && /37,5/.test(tonLive) && !/37\.5/.test(tonLive));

	const solLive = await openWith(stub(OK_RECON, LIVE_FEES), 'solana');
	check('Solana hint carries live floor, surcharge and minimums',
		!!solLive && /\b10 VIZ\b/.test(solLive) && /\b40 VIZ\b/.test(solLive) && /\b11 VIZ\b/.test(solLive) && /\b51 VIZ\b/.test(solLive),
		solLive);

	// --- refund fee: its own line, after the minimum (owner chose B, not folded into the fee line)
	check('refund line present with the live refund fee',
		!!tonLive && /вернёт его за вычетом 5 VIZ/.test(tonLive), tonLive);
	check('refund line comes after the minimum',
		!!tonLive && tonLive.indexOf('Минимальная сумма')>=0
			&& tonLive.indexOf('Минимальная сумма') < tonLive.indexOf('за вычетом'),
		tonLive);
	check('Solana hint carries the refund line too',
		!!solLive && /вернёт его за вычетом 5 VIZ/.test(solLive), solLive);

	const movedRefund = await openWith(stub(OK_RECON, MOVED_REFUND_FEES), 'ton');
	check('moved refund fee moves the refund line (live, not baked)',
		!!movedRefund && /за вычетом 7 VIZ/.test(movedRefund) && !/за вычетом 5 VIZ/.test(movedRefund),
		movedRefund);

	// a tariff that omits the refund fee must drop the line rather than print a wrong number
	const noRefundFees = {...LIVE_FEES}; delete noRefundFees.refundFeeMilliViz;
	const noRefund = await openWith(stub(OK_RECON, noRefundFees), 'ton');
	check('missing refund fee drops the line instead of guessing',
		!!noRefund && noRefund.indexOf('за вычетом')<0 && noRefund.indexOf('{')<0, noRefund);

	// --- the load-bearing one: a moved tariff must move the text
	// Match on the surrounding phrases, not bare numbers: 45 VIZ is a legal value in the moved
	// tariff too (as the surcharge), so only "максимум из 45 VIZ" proves the floor is stale.
	const moved = await openWith(stub(OK_RECON, MOVED_FEES), 'ton');
	check('moved tariff moves the TON hint (hint is live, not baked)',
		!!moved && /максимум из 60 VIZ/.test(moved) && /\b61 VIZ/.test(moved) && /106 VIZ/.test(moved)
			&& !/максимум из 45 VIZ/.test(moved) && !/\b46 VIZ/.test(moved),
		moved);

	// --- fallback: /fees down -> dictionary strings, and they must still carry numbers
	const tonDown = await openWith(stub(OK_RECON, null), 'ton');
	const solDown = await openWith(stub(OK_RECON, null), 'solana');
	check('TON falls back to the dictionary when /fees is down',
		!!tonDown && /45 VIZ/.test(tonDown) && /46 VIZ/.test(tonDown) && /83,5/.test(tonDown)
			&& /за вычетом 5 VIZ/.test(tonDown), tonDown);
	check('Solana falls back to the dictionary when /fees is down',
		!!solDown && /10 VIZ/.test(solDown) && /51 VIZ/.test(solDown)
			&& /за вычетом 5 VIZ/.test(solDown), solDown);
	check('fallback and live hints agree on the base sentence',
		!!tonLive && !!tonDown && tonLive.split(' Комиссия')[0]===tonDown.split(' Комиссия')[0],
		'live="' + (tonLive||'').split(' Комиссия')[0] + '" fallback="' + (tonDown||'').split(' Комиссия')[0] + '"');
	check('fallback and live Solana hints agree on the base sentence',
		!!solLive && !!solDown && solLive.split(' Комиссия')[0]===solDown.split(' Комиссия')[0]);

	// --- a dead tariff must not hide the templates (availability stays fail-open)
	const tonDisabled = await openWith(stub(OK_RECON, null), null);
	check('gateway templates stay available when only /fees is down', 'string'===typeof tonDisabled);
	const sel = await evalJS(`(function(){var o=document.querySelector('option[value=ton]');return o?(!o.hidden&&!o.disabled):null;})()`);
	check('TON option still enabled when only /fees is down', sel===true, 'ton option available=' + sel);

	// --- /recon down still hides the templates and says so
	const noRecon = await openWith(stub(false, LIVE_FEES), null);
	check('/recon failure hides the gateway templates',
		!!noRecon && /подтвердить не удалось/.test(noRecon), noRecon);
	check('hidden templates are not selected when /recon is down',
		await evalJS(`(function(){var s=document.querySelector('[name="transfer-template"]');return s.value==='regular';})()`));

	const fatal = jsErrors.filter(e=>!/favicon|ERR_|net::/i.test(e));
	check('no JS errors', fatal.length===0, fatal.slice(0,3).join(' | '));
} catch(e) {
	console.error('ERR:', e.message);
	fails.push(e.message);
} finally {
	try { ws && ws.close(); } catch(_) {}
	try { process.kill(-chrome.pid); } catch(_) {}
	try { srv.kill(); } catch(_) {}
}
console.log(fails.length ? `FAILED: ${fails.length} — ${fails.join('; ')}` : 'OK: gateway tariff hints passed');
process.exit(fails.length ? 1 : 0);
