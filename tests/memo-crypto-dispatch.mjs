/* Does the encrypt/decrypt request actually reach the crypto and answer the page?
 * Runs background.js in the same stubbed service-worker sandbox as background-ops.mjs.
 *
 *   node tests/memo-crypto-dispatch.mjs
 *   node tests/memo-crypto-dispatch.mjs /path/to/old/background.js   # honest control
 *
 * Exit code: 0 = PASS, 1 = FAIL.
 * The crypto itself is proven in tests/memo-crypto.mjs against node's own primitives;
 * what is checked here is the wiring — the account comes from the session and not from
 * the page, one bad letter does not kill a batch, and every branch answers the caller
 * (a branch that silently returns leaves the page hanging forever).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);

const root=path.join(import.meta.dirname,'..');
const target=process.argv[2]||path.join(root,'background.js');

require(path.join(root,'secp256k1.js'));
require(path.join(root,'memo_crypto.js'));
const C=globalThis.VizMemoCrypto;

let failures=0;
function check(name,ok,detail){
	if(ok){
		console.log('  ok   '+name);
	}
	else{
		failures++;
		console.log('  FAIL '+name+(detail?' — '+detail:''));
	}
}

const B58='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58encode(bytes){
	let num=0n;
	for(const b of bytes){
		num=num*256n+BigInt(b);
	}
	let out='';
	while(num>0n){
		out=B58[Number(num%58n)]+out;
		num=num/58n;
	}
	for(const b of bytes){
		if(b===0)out='1'+out;
		else break;
	}
	return out;
}
function checksum(buf){
	return crypto.createHash('ripemd160').update(buf).digest().slice(0,4);
}
function viz_pubkey(compressed){
	return 'VIZ'+b58encode(Buffer.concat([compressed,checksum(compressed)]));
}
function wif(priv){
	const body=Buffer.concat([Buffer.from([0x80]),priv]);
	const cs=crypto.createHash('sha256').update(crypto.createHash('sha256').update(body).digest()).digest().slice(0,4);
	return b58encode(Buffer.concat([body,cs]));
}
function pub_of(priv){
	return Buffer.from(globalThis.nobleSecp256k1.getPublicKey(new Uint8Array(priv),true));
}

const ME_priv=crypto.randomBytes(32);
const PEER_priv=crypto.randomBytes(32);
const ME_wif=wif(ME_priv);
const ME_pub=viz_pubkey(pub_of(ME_priv));
const PEER_pub=viz_pubkey(pub_of(PEER_priv));

function letter_from_peer(text){
	const ec=crypto.createECDH('secp256k1');
	ec.setPrivateKey(PEER_priv);
	const key=crypto.createHash('sha512').update(ec.computeSecret(pub_of(ME_priv))).digest().slice(0,32);
	const iv=crypto.randomBytes(12);
	const c=crypto.createCipheriv('aes-256-gcm',key,iv);
	const ct=Buffer.concat([c.update(text,'utf8'),c.final(),c.getAuthTag()]);
	return {from:PEER_pub,ct:ct.toString('base64'),iv:iv.toString('base64')};
}

function build_context(memo_key){
	const src=fs.readFileSync(target,'utf8');
	const pm_ops_src=fs.readFileSync(path.join(path.dirname(target),'pm_ops.js'),'utf8');
	const chrome={
		runtime:{id:'testext',lastError:undefined,
			onMessage:{addListener:()=>{}},onInstalled:{addListener:()=>{}},onStartup:{addListener:()=>{}},
			onSuspend:{addListener:()=>{}},onConnect:{addListener:()=>{}},
			getURL:(p)=>'chrome-extension://testext/'+p,
			getContexts:()=>Promise.resolve([{contextType:'OFFSCREEN_DOCUMENT'}]),
			sendMessage:(msg,cb)=>{if(cb)setTimeout(()=>cb({error:false,result:null}),0);}},
		storage:{local:{get:(k,cb)=>cb({}),set:(o,cb)=>cb&&cb(),remove:(k,cb)=>cb&&cb()}},
		alarms:{create:()=>{},clear:()=>{},onAlarm:{addListener:()=>{}}},
		action:{setBadgeText:()=>{},setBadgeBackgroundColor:()=>{},setIcon:()=>{},setTitle:()=>{}},
		tabs:{get:(id,cb)=>cb({id:id}),sendMessage:()=>{},query:(q,cb)=>cb([]),onActivated:{addListener:()=>{}},onUpdated:{addListener:()=>{}}},
		scripting:{executeScript:()=>Promise.resolve()},
		offscreen:{createDocument:()=>Promise.resolve()},
		windows:{onFocusChanged:{addListener:()=>{}}},
		i18n:{getUILanguage:()=>'en'}
	};
	const ctx={
		chrome:chrome,
		console:{log:()=>{},error:()=>{},warn:()=>{}},
		setTimeout:setTimeout,clearTimeout:clearTimeout,setInterval:setInterval,clearInterval:clearInterval,
		Date:Date,JSON:JSON,Math:Math,Promise:Promise,
		crypto:crypto.webcrypto,
		TextEncoder:TextEncoder,TextDecoder:TextDecoder,
		atob:atob,btoa:btoa,
		XMLHttpRequest:function(){this.open=()=>{};this.send=()=>{};this.setRequestHeader=()=>{};},
		fetch:()=>Promise.reject(new Error('no network in test'))
	};
	ctx.globalThis=ctx;
	ctx.self=ctx;
	vm.createContext(ctx);
	/* importScripts has no sandbox equivalent — load what the worker would load */
	vm.runInContext(pm_ops_src,ctx,{filename:'pm_ops.js'});
	vm.runInContext(fs.readFileSync(path.join(root,'secp256k1.js'),'utf8'),ctx,{filename:'secp256k1.js'});
	vm.runInContext(fs.readFileSync(path.join(root,'memo_crypto.js'),'utf8'),ctx,{filename:'memo_crypto.js'});
	vm.runInContext(src,ctx,{filename:'background.js'});
	ctx.bg_initialized=true;
	ctx.offscreen_ready=true;
	ctx.current_user='me';
	ctx.account={regular_key:'5Kregular',memo_key:memo_key,active_key:'5Kactive'};
	ctx.users={me:ctx.account};
	return ctx;
}

const TIMEOUT=4000;
function call_inpage(ctx,request){
	return new Promise((resolve)=>{
		let answered=false;
		const timer=setTimeout(()=>{if(!answered)resolve(false);},TIMEOUT);
		ctx.chrome.tabs.sendMessage=(tab_id,payload)=>{
			if(answered)return;
			answered=true;
			clearTimeout(timer);
			resolve(payload?payload.data:false);
		};
		try{
			ctx.inpage_action(request);
		}
		catch(e){
			answered=true;
			clearTimeout(timer);
			resolve({error:'THROW: '+e.message});
		}
	});
}

const ctx=build_context(ME_wif);
let event=1;

console.log('1. encrypt');
{
	const r=await call_inpage(ctx,{operation:'encrypt',account:false,to:PEER_pub,message:'письмо',items:[],tab_id:1,event:++event});
	check('page gets an answer',!!r,'no answer within '+TIMEOUT+'ms');
	check('no error',r&&r.error===false,r&&JSON.stringify(r.error));
	if(r&&r.result&&r.result.result){
		const out=r.result.result;
		const ec=crypto.createECDH('secp256k1');
		ec.setPrivateKey(PEER_priv);
		const key=crypto.createHash('sha512').update(ec.computeSecret(pub_of(ME_priv))).digest().slice(0,32);
		const raw=Buffer.from(out.ct,'base64');
		const d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(out.iv,'base64'));
		d.setAuthTag(raw.slice(raw.length-16));
		const text=Buffer.concat([d.update(raw.slice(0,raw.length-16)),d.final()]).toString('utf8');
		check('the recipient can read it',text==='письмо',text);
	}
	else{
		check('the recipient can read it',false,'no ciphertext in the answer');
	}
}

console.log('2. decrypt, single letter');
{
	const letter=letter_from_peer('одно письмо');
	const r=await call_inpage(ctx,{operation:'decrypt',account:false,items:[{id:null,from:letter.from,ct:letter.ct,iv:letter.iv,single:true}],tab_id:1,event:++event});
	check('plain text comes back',r&&r.error===false&&r.result&&r.result.result==='одно письмо',JSON.stringify(r));
	const bad=await call_inpage(ctx,{operation:'decrypt',account:false,items:[{id:null,from:letter.from,ct:letter.ct,iv:'AAAAAAAAAAAAAAAB',single:true}],tab_id:1,event:++event});
	check('a single unreadable letter is an error, not an empty string',bad&&bad.error==='auth_failed',JSON.stringify(bad));
}

console.log('3. batch of 50 where 3 are broken (§6.4)');
{
	const items=[];
	for(let i=0;i<50;i++){
		const letter=letter_from_peer('letter '+i);
		if(i===7||i===23||i===41){
			/* damaged in transit: valid base64, wrong bytes */
			const raw=Buffer.from(letter.ct,'base64');
			raw[0]^=0xff;
			letter.ct=raw.toString('base64');
		}
		items.push({id:i,from:letter.from,ct:letter.ct,iv:letter.iv});
	}
	const r=await call_inpage(ctx,{operation:'decrypt',account:false,items:items,tab_id:1,event:++event});
	const answers=(r&&r.result&&r.result.result)||[];
	const ok=answers.filter(a=>a.ok);
	const failed=answers.filter(a=>!a.ok);
	check('every letter is answered',answers.length===50,'got '+answers.length);
	check('47 decrypted',ok.length===47,'got '+ok.length);
	check('3 reported as failed',failed.length===3,'got '+failed.length);
	check('failures carry a code',failed.every(a=>a.error==='auth_failed'),JSON.stringify(failed.map(a=>a.error)));
	check('ids are preserved',failed.map(a=>a.id).join(',')==='7,23,41',failed.map(a=>a.id).join(','));
	check('text is right',ok.every(a=>a.message==='letter '+a.id));
}

console.log('4. the account comes from the session, not from the page');
{
	const letter=letter_from_peer('x');
	const r=await call_inpage(ctx,{operation:'decrypt',account:'somebody_else',items:[{id:1,from:letter.from,ct:letter.ct,iv:letter.iv}],tab_id:1,event:++event});
	check('another account is refused',r&&r.error==='unknown_account',JSON.stringify(r));
	const mine=await call_inpage(ctx,{operation:'encrypt',account:'me',to:PEER_pub,message:'x',items:[],tab_id:1,event:++event});
	check('naming the current account is fine',mine&&mine.error===false,JSON.stringify(mine));
}

console.log('5. no memo key in the session');
{
	const empty=build_context('');
	const r=await call_inpage(empty,{operation:'encrypt',account:false,to:PEER_pub,message:'x',items:[],tab_id:1,event:1});
	check('encrypt refuses with no_memo_key',r&&r.error==='no_memo_key',JSON.stringify(r));
	const letter=letter_from_peer('x');
	const d=await call_inpage(empty,{operation:'decrypt',account:false,items:[{id:1,from:letter.from,ct:letter.ct,iv:letter.iv}],tab_id:1,event:2});
	check('a batch is refused whole, not per item',d&&d.error==='no_memo_key',JSON.stringify(d));
}

console.log('6. bad input from the page still answers');
{
	const r=await call_inpage(ctx,{operation:'encrypt',account:false,to:'VIZnonsense',message:'x',items:[],tab_id:1,event:++event});
	check('garbage recipient key → bad_public_key',r&&r.error==='bad_public_key',JSON.stringify(r));
	const letter=letter_from_peer('x');
	const b=await call_inpage(ctx,{operation:'decrypt',account:false,items:[{id:1,from:letter.from,ct:'!!!!',iv:letter.iv}],tab_id:1,event:++event});
	const answers=(b&&b.result&&b.result.result)||[];
	check('unreadable line inside a batch → bad_ciphertext',answers.length===1&&answers[0].error==='bad_ciphertext',JSON.stringify(b));
}

console.log(failures?('FAIL — '+failures+' check(s) failed'):'PASS — encrypt/decrypt dispatch works');
process.exit(failures?1:0);
