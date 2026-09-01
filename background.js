'use strict';
/* MV3: localStorage polyfill backed by chrome.storage.local.
   Service workers have no localStorage; we keep an in-memory cache
   and sync writes to chrome.storage.local.
   IMPORTANT: Must be defined BEFORE importScripts() because viz.min.js uses localStorage. */
var _lsCache={};
var _localStorageProxy=new Proxy(_lsCache,{
	get:function(target,prop){
		if(prop==='getItem')return function(k){return target.hasOwnProperty(k)?target[k]:undefined;};
		if(prop==='setItem')return function(k,v){target[k]=String(v);chrome.storage.local.set({[k]:String(v)});};
		if(prop==='removeItem')return function(k){delete target[k];chrome.storage.local.remove(k);};
		return target[prop];
	},
	set:function(target,prop,value){
		target[prop]=String(value);
		chrome.storage.local.set({[prop]:String(value)});
		return true;
	},
	deleteProperty:function(target,prop){
		delete target[prop];
		chrome.storage.local.remove(prop);
		return true;
	}
});
try{
	Object.defineProperty(self,'localStorage',{value:_localStorageProxy,writable:true,configurable:true});
}catch(e){
	// Firefox: localStorage is a read-only getter in background context.
	// Can't override it. Imported scripts will use Firefox's built-in localStorage.
	// Our _lsCache + lsLoadAll still syncs state via chrome.storage.local.
}
function lsLoad(items){
	for(var k in items){_lsCache[k]=items[k];}
}
function lsLoadAll(cb){
	chrome.storage.local.get(null,function(items){
		lsLoad(items);
		if(cb)cb();
	});
}

/* MV3: detect browser API before importScripts so early listener works even if importScripts fails */
var ext_browser;
var ext_firefox=false;
if(typeof chrome !== 'undefined'){
	ext_browser=chrome;
}
else{
	if(typeof browser !== 'undefined'){
		ext_browser=browser;
		ext_firefox=true;
	}
}

/* MV3: load scripts that were background.scripts[] in MV2.
   Chrome service worker: importScripts is available, call it.
   NOTE: viz.min.js is NOT loaded here — it requires DOM APIs.
   In Chrome, it runs in an offscreen document (see setupOffscreen).
   In Firefox, it loads via manifest background.scripts[]. */
var importScripts_error=null;
if(typeof importScripts === 'function'){
	try{
		importScripts('ltmp_arr.js','ltmp_en.js','ltmp_ru.js');
	}catch(e){
		importScripts_error=e.message||String(e);
		console.error('importScripts failed:',importScripts_error);
	}
}

/* MV3 offscreen document (Chrome only): viz.min.js requires DOM APIs.
   In Chrome, we create an offscreen document that loads viz.min.js and handles RPC calls.
   In Firefox, viz.min.js loads via manifest background.scripts[] (background page has DOM). */
var use_offscreen = !ext_firefox && typeof chrome !== 'undefined' && typeof chrome.offscreen !== 'undefined';
var offscreen_ready = false;
var viz_call_queue = [];

var offscreen_setup_running = false;

function vizCall(method, args, callback, sync, retry) {
	var msg = {type: 'viz_call', method: method, args: args || []};
	if (sync) msg.sync = true;
	if (!offscreen_ready) {
		console.log('vizCall: queueing', method, 'offscreen not ready');
		viz_call_queue.push({method: method, args: args, callback: callback, sync: sync, retry: retry || 0});
		setupOffscreen();
		return;
	}
	console.log('vizCall: sending', method, args);
	chrome.runtime.sendMessage(msg, function(response) {
		var last_error = chrome.runtime.lastError;
		if (last_error || typeof response === 'undefined') {
			/* offscreen document is gone (service worker restarted, document closed):
			   re-create it and replay this call once instead of failing silently */
			console.warn('vizCall: no offscreen receiver for', method, last_error ? last_error.message : '');
			offscreen_ready = false;
			if ((retry || 0) < 3) {
				setTimeout(function() {
					vizCall(method, args, callback, sync, (retry || 0) + 1);
				}, 300);
			}
			else if (callback) {
				callback('offscreen_unavailable', undefined);
			}
			return;
		}
		console.log('vizCall: response for', method, response);
		if (callback) callback(response.error, response.result);
	});
}

function flushVizQueue() {
	while (viz_call_queue.length > 0) {
		var item = viz_call_queue.shift();
		vizCall(item.method, item.args, item.callback, item.sync, item.retry);
	}
}

function setupOffscreen() {
	if (!use_offscreen) return;
	if (offscreen_ready) return;
	if (offscreen_setup_running) return;
	offscreen_setup_running = true;

	var mark_ready = function(reason) {
		offscreen_setup_running = false;
		if (offscreen_ready) return;
		offscreen_ready = true;
		console.log('offscreen viz ready (' + reason + '), flushing queue');
		flushVizQueue();
	};

	var create = function() {
		chrome.offscreen.createDocument({
			url: 'offscreen.html',
			reasons: ['DOM_PARSER'],
			justification: 'VIZ blockchain library requires DOM APIs'
		}).then(function() {
			console.log('offscreen document created');
			offscreen_setup_running = false;
			/* readiness comes from the offscreen_ready message */
		}).catch(function(e) {
			var message = (e && e.message) ? e.message : String(e);
			console.error('offscreen document error:', message);
			offscreen_setup_running = false;
			if (message.indexOf('Only a single offscreen') !== -1 || message.indexOf('already') !== -1) {
				/* document already exists (SW restart) — it is alive and listening */
				mark_ready('already exists');
			}
		});
	};

	/* after a service worker restart the offscreen document may still be alive:
	   createDocument would reject and every viz call would hang in the queue */
	if (chrome.runtime.getContexts) {
		chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT']}).then(function(contexts) {
			if (contexts && contexts.length > 0) {
				mark_ready('existing document');
			}
			else {
				create();
			}
		}).catch(function(e) {
			console.error('getContexts error:', e);
			create();
		});
	}
	else {
		create();
	}
}

if (use_offscreen) {
	chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
		if (msg.type === 'offscreen_ready') {
			offscreen_setup_running = false;
			if (!offscreen_ready) {
				offscreen_ready = true;
				console.log('offscreen viz ready, flushing queue');
				flushVizQueue();
			}
		}
	});
	setupOffscreen();
}

/* Viz proxy: in Chrome, routes viz.* calls through offscreen document.
   Uses dynamic proxy to automatically wrap ANY viz.* method. */
if (use_offscreen) {
	function createVizProxy(path) {
		return new Proxy(function(){}, {
			get: function(target, prop) {
				if (prop === 'then' || prop === 'catch') return undefined;
				return createVizProxy(path ? path + '.' + prop : prop);
			},
			apply: function(target, thisArg, args) {
				var methodPath = path.indexOf('viz.') === 0 ? path.substring(4) : path;
				var lastArg = args[args.length - 1];
				var hasCallback = typeof lastArg === 'function';
				var isSync = (methodPath === 'config.set' || methodPath.indexOf('auth.') === 0 || methodPath.indexOf('memo.') === 0);
				
				if (methodPath === 'config.set') {
					vizCall(methodPath, args, null, true);
					return;
				}
				
				if (hasCallback) {
					var callback = args.pop();
					vizCall(methodPath, args, function(err, result) {
						if (methodPath.indexOf('auth.signature.') === 0 || methodPath === 'auth.signTransaction') {
							callback(result);
						} else if (methodPath.indexOf('memo.') === 0) {
							if (err) callback(null, err);
							else callback(result);
						} else if (methodPath === 'auth.isWif') {
							callback(result);
						} else {
							callback(err, result);
						}
					}, isSync);
				} else {
					return new Promise(function(resolve, reject) {
						vizCall(methodPath, args, function(err, result) {
							if (err) reject(err);
							else resolve(result);
						}, isSync);
					});
				}
			}
		});
	}
	var viz = createVizProxy('viz');
}

/* Firefox compatibility: wrap sync viz methods to also accept callbacks.
   This way calling code uses the same callback-based API in both Chrome and Firefox. */
if (!use_offscreen && typeof viz !== 'undefined') {
	var _orig_memo_encode = viz.memo.encode;
	var _orig_memo_decode = viz.memo.decode;
	var _orig_isWif = viz.auth.isWif;
	var _orig_sign = viz.auth.signature.sign;
	var _orig_recover = viz.auth.signature.recover;
	var _orig_signTx = viz.auth.signTransaction;

	viz.memo.encode = function(key1, key2, memo, callback) {
		if (callback) {
			try { var r = _orig_memo_encode.call(viz.memo, key1, key2, memo); callback(r); }
			catch(e) { callback(null, e.message || String(e)); }
		} else {
			return _orig_memo_encode.call(viz.memo, key1, key2, memo);
		}
	};
	viz.memo.decode = function(key, memo, callback) {
		if (callback) {
			try { var r = _orig_memo_decode.call(viz.memo, key, memo); callback(r); }
			catch(e) { callback(null, e.message || String(e)); }
		} else {
			return _orig_memo_decode.call(viz.memo, key, memo);
		}
	};
	viz.auth.isWif = function(key, callback) {
		if (callback) {
			callback(_orig_isWif.call(viz.auth, key));
		} else {
			return _orig_isWif.call(viz.auth, key);
		}
	};
	viz.auth.signature.sign = function(data, key, callback) {
		if (callback) {
			callback(_orig_sign.call(viz.auth.signature, data, key).toHex());
		} else {
			return _orig_sign.call(viz.auth.signature, data, key);
		}
	};
	viz.auth.signature.recover = function(data, sig, callback) {
		if (callback) {
			callback(_orig_recover.call(viz.auth.signature, data, sig).toPublicKeyString());
		} else {
			return _orig_recover.call(viz.auth.signature, data, sig);
		}
	};
	viz.auth.signTransaction = function(tx, keys, callback) {
		if (callback) {
			callback(_orig_signTx.call(viz.auth, tx, keys));
		} else {
			return _orig_signTx.call(viz.auth, tx, keys);
		}
	};
}

/* MV3: load localStorage cache from chrome.storage.local before init */
var bg_initialized=false;
var pending_messages=[];

/* Early message listener: respond to get_state even before full init.
   Registered before importScripts result is needed, so Chrome MV3 always sees a listener. */
if(typeof ext_browser !== 'undefined' && ext_browser.runtime && ext_browser.runtime.onMessage){
	ext_browser.runtime.onMessage.addListener(function(request,sender,sendResponse){
		if(!bg_initialized){
			if(typeof request.get_state !== 'undefined'){
				sendResponse({decoded:false,initializing:true,importScripts_error:importScripts_error});
				return true;
			}
			pending_messages.push({request:request,sender:sender,sendResponse:sendResponse});
			return true;
		}
	});
}
var extension_id = ext_browser.runtime.id;
var current_user='';
var account={
	regular_key:'',
	memo_key:'',
	active_key:'',
};
var settings={
	energy_step:20,
	award_energy:200,
	dark:false,
	lang:'en',
};
var rules={};
var users={};

var state={};
var current_energy=0;
var current_shares=0;
var current_income_shares=0;
var current_outcome_shares=0;
var current_effective_shares=0;
var current_balance=0;
var current_custom_sequence=0;

var current_withdraw=0;//to_withdraw, int
var current_withdrawn=0;//withdrawn, int
var current_withdraw_rate=0;//vesting_withdraw_rate, 0.000000 SHARES * 1000000 to int
var current_next_vesting_withdrawal=-1;//seconds to next withdraw

var current_total_reward_shares=0;
var current_total_reward_fund=0;

var ltmp_arr={};
var available_langs={
	'en':'English',
	'ru':'Русский',
};
var langs_arr={
	'en-gb':'en',
	'en-us':'en',
	'en':'en',
	'ru-ru':'ru',
	'ru':'ru',
};

function load_state(password,callback){
	password=typeof password==='undefined'?'':password;
	if(typeof callback === 'undefined'){callback=function(){};}

	console.log('init load_state old state',state,localStorage['state']);
	if(typeof localStorage['state'] === 'undefined'){
		state={};
		state.encoded=false;
		state.decoded=false;
		state.password='';

		current_user='';
		account={
			regular_key:'',
			memo_key:'',
			active_key:'',
		};
		settings={
			energy_step:20,
			award_energy:200,
			dark:false,
			lang:'en',
		};
		rules={};
		users={};

		state.users=users;
		state.current_user=current_user;
		state.settings=settings;
		state.rules=rules;

		let find_lang=false;
		let ui_lang=chrome.i18n.getUILanguage().toLowerCase();
		if(typeof langs_arr[ui_lang] !== 'undefined'){
			let try_lang=langs_arr[ui_lang];
			if(typeof available_langs[try_lang] !== 'undefined'){
				settings.lang=try_lang;
				find_lang=true;
			}
		}
		//load localization templates
		ltmp_arr=globalThis['ltmp_'+settings.lang+'_arr'];
		console.log('reinit load_state new state',state);
		callback(true);
	}
	else{
		state=JSON.parse(localStorage['state']);
		if(typeof state.encoded == 'undefined'){//old version?
			state.encoded=false;
		}
		if(state.encoded){
			if(''!=password){//got password, try to decrypt state
				decrypt(state.encoded_iv,state.encoded_json,password,function(error,result){
					if(error){
						state.decoded=false;
						state.password='';
						fill_vars();
						callback(false);
					}
					else{
						try{
							state=JSON.parse(result);
							state.decoded=true;
							state.password=password;
						}
						catch(e){
							state.decoded=false;
							state.password='';
						}
						fill_vars();
						callback(state.decoded);
						ext_browser.alarms.create('viz_timer',{when:Date.now()+1});
					}
				});
			}
			else{//empty password, extension init?
				state.decoded=false;
				state.password='';
				fill_vars();
				callback(false);
			}
		}
		else{
			state.decoded=false;
			state.password='';
			fill_vars();
			callback(true);
		}
	}
}

function fill_vars(){
	//fill variables to easy access
	if(typeof state.users !== 'undefined'){
		users=state.users;
	}
	if(typeof state.current_user !== 'undefined'){
		current_user=state.current_user;
	}
	if(typeof users[current_user] !== 'undefined'){
		account=users[current_user];
	}
	if(typeof state.settings !== 'undefined'){
		settings=state.settings;
	}

	if(typeof state.rules === 'undefined'){
		rules={};
	}
	else{
		rules=state.rules;
	}
	//load localization templates
	ltmp_arr=globalThis['ltmp_'+settings.lang+'_arr'];
	//load last energy value
	if(typeof localStorage['current_energy'] !== 'undefined'){
		current_energy=localStorage['current_energy'];
	}
	if(typeof localStorage['current_shares'] !== 'undefined'){
		current_shares=localStorage['current_shares'];
	}
	if(typeof localStorage['current_income_shares'] !== 'undefined'){
		current_income_shares=localStorage['current_income_shares'];
	}
	if(typeof localStorage['current_outcome_shares'] !== 'undefined'){
		current_outcome_shares=localStorage['current_outcome_shares'];
	}
	if(typeof localStorage['current_effective_shares'] !== 'undefined'){
		current_effective_shares=localStorage['current_effective_shares'];
	}
	if(typeof localStorage['current_balance'] !== 'undefined'){
		current_balance=localStorage['current_balance'];
	}
	if(typeof localStorage['current_custom_sequence'] !== 'undefined'){
		current_custom_sequence=localStorage['current_custom_sequence'];
	}

	if(typeof localStorage['current_withdraw'] !== 'undefined'){
		current_withdraw=localStorage['current_withdraw'];
	}
	if(typeof localStorage['current_withdrawn'] !== 'undefined'){
		current_withdrawn=localStorage['current_withdrawn'];
	}
	if(typeof localStorage['current_withdraw_rate'] !== 'undefined'){
		current_withdraw_rate=localStorage['current_withdraw_rate'];
	}
	if(typeof localStorage['current_next_vesting_withdrawal'] !== 'undefined'){
		current_next_vesting_withdrawal=localStorage['current_next_vesting_withdrawal'];
	}

	if(typeof localStorage['current_total_reward_fund'] !== 'undefined'){
		current_total_reward_fund=localStorage['current_total_reward_fund'];
	}
	if(typeof localStorage['current_total_reward_shares'] !== 'undefined'){
		current_total_reward_shares=localStorage['current_total_reward_shares'];
	}
	console.log('load_state, new state',state);
}

function encrypt(text_string,password,callback){
	//return iv and encoded text in hex
	if(typeof callback === 'undefined'){callback=function(){};}
	var iv = crypto.getRandomValues(new Uint8Array(16));
	var ivHex = bytesToHexString(iv);
	var pwUtf8 = new TextEncoder().encode(password);
	console.log('try encode with ivHex and pwUtf8',ivHex,pwUtf8);
	crypto.subtle.digest('SHA-256',pwUtf8)
		.then(function(hash){
			var pwHex = bytesToHexString(hash);
			var keyData = hexStringToUint8Array(pwHex);
			console.log('hashed password: ',pwHex);
			crypto.subtle.importKey("raw", keyData, "aes-gcm", false, ["encrypt"])
			.then(function(key){
				return crypto.subtle.encrypt({
					name: "aes-gcm",
					iv: iv
				}, key, new TextEncoder().encode(text_string));
			}, console.log)
			.then(function(encoded_result){
				callback(ivHex,bytesToHexString(encoded_result));
			}, console.log);
		});
}

function decrypt(iv_string,text_string,password,decrypt_callback){
	var pwUtf8 = new TextEncoder().encode(password);
	crypto.subtle.digest('SHA-256', pwUtf8)
	.then(function(hash){
		var pwHex = bytesToHexString(hash);
		var keyData = hexStringToUint8Array(pwHex);
		console.log('hashed password: ',pwHex);
		crypto.subtle.importKey("raw", keyData, "aes-gcm", false, ["decrypt"])
		.then(function(key){
			var iv = hexStringToUint8Array(iv_string);
			return crypto.subtle.decrypt({
				name: "aes-gcm",
				iv: iv
			}, key, hexStringToUint8Array(text_string));
			}, console.log)
			.then(function(decoded_result){
				decrypt_callback(false,new TextDecoder().decode(decoded_result));
			},function(error_result){
				decrypt_callback(true,false);
			});
		});
}

function save_state(callback){
	if(typeof callback === 'undefined'){callback=function(){};}
	localStorage['current_energy']=current_energy;
	localStorage['current_shares']=current_shares;
	localStorage['current_income_shares']=current_income_shares;
	localStorage['current_outcome_shares']=current_outcome_shares;
	localStorage['current_effective_shares']=current_effective_shares;
	localStorage['current_balance']=current_balance;
	localStorage['current_custom_sequence']=current_custom_sequence;
	localStorage['current_withdraw']=current_withdraw;
	localStorage['current_withdrawn']=current_withdrawn;
	localStorage['current_withdraw_rate']=current_withdraw_rate;
	localStorage['current_next_vesting_withdrawal']=current_next_vesting_withdrawal;

	//users[current_user]=account;//we dont use account as independ var
	//state={};//no need to clear, because need to save encoded decoded and password status
	let temp_state=JSON.parse(JSON.stringify(state));

	let password='';
	if(typeof temp_state.password !== 'undefined'){
		password=temp_state.password;
		delete temp_state.password;
	}
	temp_state.decoded=false;

	let state_json=JSON.stringify(temp_state);

	if(temp_state.encoded){
		if(''!=password){
			encrypt(state_json,password,function(iv_hex,encoded_result){
				let new_state={};
				new_state.encoded=true;
				new_state.encoded_iv=iv_hex;
				new_state.encoded_json=encoded_result;
				localStorage['state']=JSON.stringify(new_state);
				callback();
			});
		}
	}
	else{
		localStorage['state']=JSON.stringify(temp_state);
		callback();
	}
}

/* Common functions for encryption */
function hexStringToUint8Array(hexString) {
	if (hexString.length % 2 != 0)
		throw "Invalid hexString";
	var arrayBuffer = new Uint8Array(hexString.length / 2);

	for (var i = 0; i < hexString.length; i += 2) {
		var byteValue = parseInt(hexString.substr(i, 2), 16);
		if (byteValue == NaN)
		throw "Invalid hexString";
		arrayBuffer[i / 2] = byteValue;
	}

	return arrayBuffer;
}

function bytesToHexString(bytes) {
	if (!bytes)
		return null;

	bytes = new Uint8Array(bytes);
	var hexBytes = [];

	for (var i = 0; i < bytes.length; ++i) {
		var byteString = bytes[i].toString(16);
		if (byteString.length < 2)
		byteString = "0" + byteString;
		hexBytes.push(byteString);
	}

	return hexBytes.join("");
}

function asciiToUint8Array(str) {
	var chars = [];
	for (var i = 0; i < str.length; ++i)
		chars.push(str.charCodeAt(i));
	return new Uint8Array(chars);
}

function bytesToASCIIString(bytes) {
	return String.fromCharCode.apply(null, new Uint8Array(bytes));
}

/* Not state vars*/
var current_award_effective_shares=0;

var dgp={total_reward_shares:1000000};
var i=1;
var time_offset=15000;
var chrome_height_fix=0;

var js_framework='cash.min.js';
var js_contentscript='contentscript.js';
var js_inpage='inpage.js';

var api_http_gates=[
	'https://api.viz.world/',
	'https://node.viz.cx/',
	'https://viz.lexai.top/',
	'https://mirror.viz.world/',
];
var social_gates=[
	'social',
];
var social_gates_memo={
	'social':'VIZ8FzkC9Dgo4HgN8tUgebCJ7KnHHi43LDp8YAw3PL8wKDwwQM3gk',
};

var default_api_gate=api_http_gates[0];
var best_gate=-1;
var best_gate_latency=-1;
var api_gate=default_api_gate;
console.log('using default node',default_api_gate);
viz.config.set('websocket',default_api_gate);

/* Load extension version and check if update version initialized asynchronously in startup sequence */
var global_version=1;
var version;
var version_update=false;//need update storage rules

function update_version(callback){
	if(typeof callback === 'undefined'){callback=function(){};}

	if(version<global_version){
		version_update=true;
	}
	if(version_update){
		if(1==version){
			version++;
			version_update=false;
			update_version(callback);
		}
	}
	else{
		callback();
	}
}

function auth_signature_check(hex){
	let byte=hex.substring(0,2);
	if('1f'==byte){
		return true;
	}
	if('20'==byte){
		return true;
	}
	return false;
}

function passwordless_auth(private_key,account,domain,authority,callback){
	var nonce=0;
	var timestamp=new Date().getTime() / 1000 | 0;
	function trySign(){
		var data=domain+':auth:'+account+':'+authority+':'+timestamp+':'+nonce;
		viz.auth.signature.sign(data,private_key,function(signature){
			if(auth_signature_check(signature)){
				callback({account:account,data:data,signature:signature});
			}
			else{
				nonce++;
				trySign();
			}
		});
	}
	trySign();
}

function viz_timer(){
	let need_encode=false;
	if(state.encoded){
		if(!state.decoded){
			need_encode=true;
			ext_browser.action.setBadgeBackgroundColor({color:"rgba(136,136,136,0.4)"});
			ext_browser.action.setBadgeText({text:"?"});
		}
	}
	if(!need_encode){
		if(''==current_user){
			ext_browser.action.setBadgeText({text:"?"});
		}
		else{
			viz.api.getAccount(current_user,'V',function(err,response){
				if(!err){
					if(typeof response !== 'undefined'){
						let last_vote_time=Date.parse(response.last_vote_time);
						let delta_time=parseInt((new Date().getTime() - last_vote_time+(new Date().getTimezoneOffset()*60000))/1000);
						let energy=response.energy;
						let new_energy=parseInt(energy+(delta_time*10000/432000));//CHAIN_ENERGY_REGENERATION_SECONDS 5 days
						if(new_energy>10000){
							new_energy=10000;
						}
						current_energy=new_energy;
						localStorage['current_energy']=current_energy;

						current_shares=parseFloat(response.vesting_shares).toFixed(3);
						localStorage['current_shares']=current_shares;
						current_income_shares=parseFloat(response.received_vesting_shares).toFixed(3);
						localStorage['current_income_shares']=current_income_shares;
						current_outcome_shares=parseFloat(response.delegated_vesting_shares).toFixed(3);
						localStorage['current_outcome_shares']=current_outcome_shares;
						current_effective_shares=parseFloat(parseFloat(current_shares)+parseFloat(current_income_shares)-parseFloat(current_outcome_shares)).toFixed(3);
						localStorage['current_effective_shares']=current_effective_shares;
						current_balance=parseFloat(response.balance).toFixed(3);
						localStorage['current_balance']=current_balance;
						current_custom_sequence=parseInt(response.custom_sequence_block_num);
						localStorage['current_custom_sequence']=current_custom_sequence;

						current_award_effective_shares=parseInt(1000000* (parseFloat(response['vesting_shares'])+parseFloat(response['received_vesting_shares'])-parseFloat(response['delegated_vesting_shares'])));

						current_withdraw=parseInt(response.to_withdraw);
						current_withdrawn=parseInt(response.withdrawn);
						current_withdraw_rate=parseInt(1000000*parseFloat(response.vesting_withdraw_rate));
						current_next_vesting_withdrawal=parseInt((Date.parse(response.next_vesting_withdrawal) - (new Date().getTimezoneOffset()*60000) - new Date().getTime())/1000);
						localStorage['current_withdraw']=current_withdraw;
						localStorage['current_withdrawn']=current_withdrawn;
						localStorage['current_withdraw_rate']=current_withdraw_rate;
						localStorage['current_next_vesting_withdrawal']=current_next_vesting_withdrawal;

						ext_browser.action.setBadgeBackgroundColor({color:"rgba(136,136,136,0.4)"});
						ext_browser.action.setBadgeText({text:''+parseInt(parseFloat(new_energy)/100)+'%'});
					}
				}
			});
		}
	}
	viz.api.getDynamicGlobalProperties(function(err,response){
		if(!err){
			dgp=response;
			current_total_reward_shares=dgp.total_reward_shares;
			localStorage['current_total_reward_shares']=current_total_reward_shares;
			current_total_reward_fund=dgp.total_reward_fund;
			localStorage['current_total_reward_fund']=current_total_reward_fund;
			console.log('dgp update',dgp);
		}
	});
	i++;
	ext_browser.alarms.create('viz_timer',{when:Date.now()+time_offset+(need_encode?time_offset:0)});
}

function doAwardBroadcast(encoded_memo,encrypt_memo,encrypt_memo_error,request,account,approximate_amount){
	if(encrypt_memo_error){
		ext_browser.tabs.get(request.tab_id,function(tab){
			if(ext_browser.runtime.lastError){
				console.log(ext_browser.runtime.lastError.message);
			}
			else{
				ext_browser.tabs.sendMessage(request.tab_id,{id:request.id,status:false,error:'Memo encode error'});
			}
		});
	}
	else{
		viz.broadcast.award(account.regular_key,current_user,request.login,parseInt(request.energy),parseInt(request.sequence),(encrypt_memo?encoded_memo:request.memo),request.beneficiaries,function(e,r){
			console.log(e);
			if(request.tab_id){
				ext_browser.tabs.get(request.tab_id,function(tab){
					if(ext_browser.runtime.lastError){
						console.log(ext_browser.runtime.lastError.message);
					}
					else{
						ext_browser.tabs.sendMessage(request.tab_id,{id:request.id,status:(!e),approximate_amount});
						if(!e){
							current_energy-=parseInt(request.energy);
							localStorage['current_energy']=current_energy;
							let new_energy=current_energy;
							ext_browser.action.setBadgeText({text:''+parseInt(parseFloat(new_energy)/100)+'%'});
						}
					}
				});
			}
		});
	}
}

function vizonator_action(request){
	console.log(request);

	if(request.save){
		if(typeof rules[request.origin] === 'undefined'){
			rules[request.origin]={};
		}
		/*
		if(request.refuse){
			rules[request.origin]['vizonator']=false;
		}
		*/
		if(request.award){
			rules[request.origin]['vizonator']=true;
		}
		save_state();
	}
	if(request.award){
		let rshares=parseInt(current_award_effective_shares * request.energy / 10000);
		let approximate_amount=parseFloat(dgp.total_reward_fund) * (rshares / (rshares + parseInt(dgp.total_reward_shares)));
		approximate_amount=approximate_amount*0.995;
		approximate_amount=parseInt(approximate_amount*1000000);
		approximate_amount=approximate_amount/1000000;

		let encrypt_memo=false;
		let encrypt_memo_error=false;
		let recipient_memo='';
		if(typeof account['memo_key'] !== 'undefined'){
			if(''!=account.memo_key){
				encrypt_memo=true;
			}
		}

		if(-1!=social_gates.indexOf(request.login)){
			recipient_memo=social_gates_memo[request.login];
		}
		else{
			encrypt_memo=false;
		}

		let encoded_memo=request.memo;
		if(encrypt_memo){
			viz.memo.encode(account.memo_key,recipient_memo,'#'+request.memo,function(result,error){
				if(error){
					encrypt_memo_error=true;
				}
				else{
					encoded_memo=result;
				}
				doAwardBroadcast(encoded_memo,encrypt_memo,encrypt_memo_error,request,account,approximate_amount);
			});
			return;
		}
		doAwardBroadcast(encoded_memo,encrypt_memo,encrypt_memo_error,request,account,approximate_amount);
	}
	else
	if(request.refuse){
		ext_browser.tabs.get(request.tab_id,function(tab){
			if(ext_browser.runtime.lastError){
				console.log(ext_browser.runtime.lastError.message);
			}
			else{
				ext_browser.tabs.sendMessage(request.tab_id,{id:request.id,status:false,approximate_amount:0});
			}
		});
	}
}
function inpage_action(request){
	console.log('inpage_action',request);

	let response_error=true;
	let response_result=false;

	if(request.save){
		if(typeof rules[request.origin] === 'undefined'){
			rules[request.origin]={};
		}
		if(request.refuse){
			for(let i in request.operation_type){
				rules[request.origin][request.operation_type[i]]=false;
			}
		}
		if(request.approve){
			for(let i in request.operation_type){
				rules[request.origin][request.operation_type[i]]=true;
			}
		}
		save_state();
	}
	if(request.refuse){
		ext_browser.tabs.get(request.tab_id,function(tab){
			if(ext_browser.runtime.lastError){
				console.log(ext_browser.runtime.lastError.message);
			}
			else{
				let response={'error':'refuse','result':response_result}
				ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
			}
		});
	}
	else
	if('award'==request.operation){
		let rshares=parseInt(current_award_effective_shares * request.energy / 10000);
		let approximate_amount=parseFloat(dgp.total_reward_fund) * (rshares / (rshares + parseInt(dgp.total_reward_shares)));
		approximate_amount=approximate_amount*0.995;
		approximate_amount=parseInt(approximate_amount*1000000);
		approximate_amount=approximate_amount/1000000;

		viz.api.getAccount(request.receiver,'',function(err,account_response){
			let send_error=function(operation_error){
				let response={'error':operation_error,'result':response_result}
				ext_browser.tabs.get(request.tab_id,function(tab){
					if(ext_browser.runtime.lastError){
						console.log(ext_browser.runtime.lastError.message);
					}
					else{
						ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
					}
				});
			};
			if(err){
				send_error('recipient_error');
				return;
			}
			let recipient_memo=account_response.memo_key;
			let do_broadcast=function(encoded_memo){
				viz.broadcast.award(account.regular_key,current_user,request.receiver,parseInt(request.energy),parseInt(request.custom_sequence),encoded_memo,request.beneficiaries,function(e,r){
					console.log(e);
					if(request.tab_id){
						ext_browser.tabs.get(request.tab_id,function(tab){
							if(ext_browser.runtime.lastError){
								console.log(ext_browser.runtime.lastError.message);
							}
							else{
								response_error=(!!e);
								if(!response_error){
									response_result={approximate_amount};
								}
								let response={'error':response_error,'result':response_result}
								ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
								if(!e){//manual update account energy
									current_energy-=parseInt(request.energy);
									localStorage['current_energy']=current_energy;
									let new_energy=current_energy;
									ext_browser.action.setBadgeText({text:''+parseInt(parseFloat(new_energy)/100)+'%'});
								}
							}
						});
					}
				});
			};
			if(request.force_memo_encoding){
				if('VIZ1111111111111111111111111111111114T1Anm'==recipient_memo){
					send_error('recipient_memo_error');
					return;
				}
				viz.memo.encode(account.memo_key,recipient_memo,'#'+request.memo,function(result,error){
					if(error){
						send_error('encrypt_memo_error');
						return;
					}
					do_broadcast(result);
				});
				return;
			}
			do_broadcast(request.memo);
		});
	}
	else
	if('fixed_award'==request.operation){
		let rshares=parseInt(current_award_effective_shares * request.max_energy / 10000);
		let approximate_amount=parseFloat(dgp.total_reward_fund) * (rshares / (rshares + parseInt(dgp.total_reward_shares)));
		approximate_amount=approximate_amount;
		approximate_amount=parseInt(approximate_amount*1000000);
		approximate_amount=approximate_amount/1000000;
		let reward_amount_float=parseFloat(request.reward_amount);
		let approximate_energy=(reward_amount_float/approximate_amount)*request.max_energy;

		viz.api.getAccount(request.receiver,'',function(err,account_response){
			let send_error=function(operation_error){
				let response={'error':operation_error,'result':response_result}
				ext_browser.tabs.get(request.tab_id,function(tab){
					if(ext_browser.runtime.lastError){
						console.log(ext_browser.runtime.lastError.message);
					}
					else{
						ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
					}
				});
			};
			if(err){
				send_error('recipient_error');
				return;
			}
			let recipient_memo=account_response.memo_key;
			let do_broadcast=function(encoded_memo){
				viz.broadcast.fixedAward(account.regular_key,current_user,request.receiver,request.reward_amount,parseInt(request.max_energy),parseInt(request.custom_sequence),encoded_memo,request.beneficiaries,function(e,r){
					console.log(e);
					if(request.tab_id){
						ext_browser.tabs.get(request.tab_id,function(tab){
							if(ext_browser.runtime.lastError){
								console.log(ext_browser.runtime.lastError.message);
							}
							else{
								response_error=(!!e);
								if(!response_error){
									response_result={approximate_amount:parseFloat(request.reward_amount)};
								}
								let response={'error':response_error,'result':response_result}
								ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
								if(!e){
									current_energy-=parseInt(approximate_energy);
									localStorage['current_energy']=current_energy;
									let new_energy=current_energy;
									ext_browser.action.setBadgeText({text:''+parseInt(parseFloat(new_energy)/100)+'%'});
								}
							}
						});
					}
				});
			};
			if(request.force_memo_encoding){
				if('VIZ1111111111111111111111111111111114T1Anm'==recipient_memo){
					send_error('recipient_memo_error');
					return;
				}
				viz.memo.encode(account.memo_key,recipient_memo,'#'+request.memo,function(result,error){
					if(error){
						send_error('encrypt_memo_error');
						return;
					}
					do_broadcast(result);
				});
				return;
			}
			do_broadcast(request.memo);
		});
	}
	else
	if('transfer'==request.operation){
		viz.api.getAccount(request.to,'',function(err,account_response){
			let send_error=function(operation_error){
				let response={'error':operation_error,'result':response_result}
				ext_browser.tabs.get(request.tab_id,function(tab){
					if(ext_browser.runtime.lastError){
						console.log(ext_browser.runtime.lastError.message);
					}
					else{
						ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
					}
				});
			};
			if(err){
				send_error('recipient_error');
				return;
			}
			let recipient_memo=account_response.memo_key;
			let do_broadcast=function(encoded_memo){
				viz.broadcast.transfer(account.active_key,current_user,request.to,request.amount,encoded_memo,function(e,r){
					console.log(e);
					if(request.tab_id){
						ext_browser.tabs.get(request.tab_id,function(tab){
							if(ext_browser.runtime.lastError){
								console.log(ext_browser.runtime.lastError.message);
							}
							else{
								response_error=(!!e);
								if(!response_error){
									response_result={};
								}
								let response={'error':response_error,'result':response_result}
								ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
							}
						});
					}
				});
			};
			if(request.force_memo_encoding){
				if('VIZ1111111111111111111111111111111114T1Anm'==recipient_memo){
					send_error('recipient_memo_error');
					return;
				}
				viz.memo.encode(account.memo_key,recipient_memo,'#'+request.memo,function(result,error){
					if(error){
						send_error('encrypt_memo_error');
						return;
					}
					do_broadcast(result);
				});
				return;
			}
			do_broadcast(request.memo);
		});
	}
	else
	if('transfer_to_vesting'==request.operation){
		viz.api.getAccount(request.to,'',function(err,account_response){
			if(!err){
				viz.broadcast.transferToVesting(account.active_key,current_user,request.to,request.amount,function(e,r){
					console.log(e);
					if(request.tab_id){
						ext_browser.tabs.get(request.tab_id,function(tab){
							if(ext_browser.runtime.lastError){
								console.log(ext_browser.runtime.lastError.message);
							}
							else{
								response_error=(!!e);
								if(!response_error){
									response_result={};
								}
								let response={'error':response_error,'result':response_result}
								ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
							}
						});
					}
				});
			}
			else{
				let response={'error':'recipient_error','result':response_result}
				ext_browser.tabs.get(request.tab_id,function(tab){
					if(ext_browser.runtime.lastError){
						console.log(ext_browser.runtime.lastError.message);
					}
					else{
						ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
					}
				});
			}
		});
	}
	else
	if('withdraw_vesting'==request.operation){
		viz.broadcast.withdrawVesting(account.active_key,current_user,request.vesting_shares,function(e,r){
			console.log(e);
			if(request.tab_id){
				ext_browser.tabs.get(request.tab_id,function(tab){
					if(ext_browser.runtime.lastError){
						console.log(ext_browser.runtime.lastError.message);
					}
					else{
						response_error=(!!e);
						if(!response_error){
							response_result={};
						}
						let response={'error':response_error,'result':response_result}
						ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
					}
				});
			}
		});
	}
	else
	if('delegate_vesting_shares'==request.operation){
		viz.api.getAccount(request.delegatee,'',function(err,account_response){
			if(!err){
				viz.broadcast.delegateVestingShares(account.active_key,current_user,request.delegatee,request.vesting_shares,function(e,r){
					console.log(e);
					if(request.tab_id){
						ext_browser.tabs.get(request.tab_id,function(tab){
							if(ext_browser.runtime.lastError){
								console.log(ext_browser.runtime.lastError.message);
							}
							else{
								response_error=(!!e);
								if(!response_error){
									response_result={};
								}
								let response={'error':response_error,'result':response_result}
								ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
							}
						});
					}
				});
			}
			else{
				let response={'error':'recipient_error','result':response_result}
				ext_browser.tabs.get(request.tab_id,function(tab){
					if(ext_browser.runtime.lastError){
						console.log(ext_browser.runtime.lastError.message);
					}
					else{
						ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
					}
				});
			}
		});
	}
	else
	if('committee_vote_request'==request.operation){
		viz.api.getCommitteeRequest(request.request_id,0,function(err,request_response){
			if(!err){
				if(0!=request_response.status){
					let response={'error':'status_error','result':request_response.status}
					ext_browser.tabs.get(request.tab_id,function(tab){
						if(ext_browser.runtime.lastError){
							console.log(ext_browser.runtime.lastError.message);
						}
						else{
							ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
						}
					});
				}
				else{
					viz.broadcast.committeeVoteRequest(account.regular_key,current_user,request.request_id,request.vote_percent,function(e,r){
						console.log(e);
						if(request.tab_id){
							ext_browser.tabs.get(request.tab_id,function(tab){
								if(ext_browser.runtime.lastError){
									console.log(ext_browser.runtime.lastError.message);
								}
								else{
									response_error=(!!e);
									if(!response_error){
										response_result={};
									}
									let response={'error':response_error,'result':response_result}
									ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
								}
							});
						}
					});
				}
			}
			else{
				let response={'error':'request_error','result':response_result}
				ext_browser.tabs.get(request.tab_id,function(tab){
					if(ext_browser.runtime.lastError){
						console.log(ext_browser.runtime.lastError.message);
					}
					else{
						ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
					}
				});
			}
		});
	}
	else
	if('custom'==request.operation){
		if(('active'==request.authority)&&(''==account.active_key)){
			if(request.tab_id){
				ext_browser.tabs.get(request.tab_id,function(tab){
					if(ext_browser.runtime.lastError){
						console.log(ext_browser.runtime.lastError.message);
					}
					else{
						let response={'error':'no key','result':response_result}
						ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
					}
				});
			}
		}
		else{
			viz.broadcast.custom(
				('active'==request.authority?account.active_key:account.regular_key),
				('active'==request.authority?[current_user]:[]),
				('regular'==request.authority?[current_user]:[]),
				request.protocol_id,
				request.json,
				function(e,r){
					console.log(e);
					if(request.tab_id){
						ext_browser.tabs.get(request.tab_id,function(tab){
							if(ext_browser.runtime.lastError){
								console.log(ext_browser.runtime.lastError.message);
							}
							else{
								response_error=(!!e);
								if(!response_error){
									response_result={};
								}
								let response={'error':response_error,'result':response_result}
								ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
							}
						});
					}
				}
			);
		}
	}
	else
	if('account_metadata'==request.operation){
		viz.broadcast.accountMetadata(account.regular_key,current_user,request.json,function(e,r){
			console.log(e);
			if(request.tab_id){
				ext_browser.tabs.get(request.tab_id,function(tab){
					if(ext_browser.runtime.lastError){
						console.log(ext_browser.runtime.lastError.message);
					}
					else{
						response_error=(!!e);
						if(!response_error){
							response_result={};
						}
						let response={'error':response_error,'result':response_result}
						ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
					}
				});
			}
		});
	}
	else
	if('passwordless_auth'==request.operation){
		let error=false;
		let private_key=account.regular_key;
		if('active'==request.authority){
			if(''!=account.active_key){
				private_key=account.active_key;
			}
			else{
				error=true;
				if(request.tab_id){
					ext_browser.tabs.get(request.tab_id,function(tab){
						if(ext_browser.runtime.lastError){
							console.log(ext_browser.runtime.lastError.message);
						}
						else{
							let response={'error':'no key','result':response_result}
							ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
						}
					});
				}
			}
		}
		else{
			request.authority='regular';
		}

		if(!error)
		if(request.tab_id){
			ext_browser.tabs.get(request.tab_id,function(tab){
				if(ext_browser.runtime.lastError){
					console.log(ext_browser.runtime.lastError.message);
				}
				else{
					response_error=false;
					passwordless_auth(private_key,current_user,request.origin,request.authority,function(result){
						response_result=result;
						let response={'error':response_error,'result':response_result}
						ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
					});
				}
			});
		}
	}
	else
	if('sign_data'==request.operation){
		let error=false;
		let private_key=account.regular_key;
		if('active'==request.authority){
			if(''!=account.active_key){
				private_key=account.active_key;
			}
			else{
				error=true;
				if(request.tab_id){
					ext_browser.tabs.get(request.tab_id,function(tab){
						if(ext_browser.runtime.lastError){
							console.log(ext_browser.runtime.lastError.message);
						}
						else{
							let response={'error':'no key','result':null}
							ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
						}
					});
				}
			}
		}
		else{
			request.authority='regular';
		}

		if(!error)
		if(request.tab_id){
			ext_browser.tabs.get(request.tab_id,function(tab){
				if(ext_browser.runtime.lastError){
					console.log(ext_browser.runtime.lastError.message);
				}
				else{
					let data_to_sign=request.data_to_sign;
					viz.auth.signature.sign(data_to_sign,private_key,function(signature){
						viz.auth.signature.recover(data_to_sign,signature,function(public_key){
							response_error=false;
							response_result={
								account:current_user,
								signature:signature,
								public_key:public_key
							};
							let response={'error':response_error,'result':response_result}
							ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
						});
					});
				}
			});
		}
	}
	else
	if('get_custom_account'==request.operation){
		let target_account=request.account;
		if(false===target_account){
			target_account=current_user;
		}
		if(''==target_account){
			target_account=current_user;
		}
		let target_protocol_id=request.protocol_id;
		if(false===target_protocol_id){
			target_protocol_id='';
		}
		viz.api.getAccount(target_account,target_protocol_id,function(err,account_response){
			if(request.tab_id){
				ext_browser.tabs.get(request.tab_id,function(tab){
					if(ext_browser.runtime.lastError){
						console.log(ext_browser.runtime.lastError.message);
					}
					else{
						let response={'error':err,'result':account_response};
						ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
					}
				});
			}
		});
	}
	else
	if('get_account_history'==request.operation){
		let target_account=request.account;
		if(false===target_account){
			target_account=current_user;
		}
		if(''==target_account){
			target_account=current_user;
		}
		viz.api.getAccountHistory(target_account,request.from,request.limit,function(err,account_response){
			if(request.tab_id){
				ext_browser.tabs.get(request.tab_id,function(tab){
					if(ext_browser.runtime.lastError){
						console.log(ext_browser.runtime.lastError.message);
					}
					else{
						let response={'error':err,'result':account_response};
						ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
					}
				});
			}
		});
	}
	else
	if('get_accounts_on_sale'==request.operation){
		console.log(request);
		viz.api.getAccountsOnSale(request.from,request.limit,function(err,accounts_response){
			if(request.tab_id){
				ext_browser.tabs.get(request.tab_id,function(tab){
					if(ext_browser.runtime.lastError){
						console.log(ext_browser.runtime.lastError.message);
					}
					else{
						let response={'error':err,'result':accounts_response};
						ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
					}
				});
			}
		});
	}
	else
	if('get_subaccounts_on_sale'==request.operation){
		console.log(request);
		viz.api.getSubaccountsOnSale(request.from,request.limit,function(err,accounts_response){
			if(request.tab_id){
				ext_browser.tabs.get(request.tab_id,function(tab){
					if(ext_browser.runtime.lastError){
						console.log(ext_browser.runtime.lastError.message);
					}
					else{
						let response={'error':err,'result':accounts_response};
						ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
					}
				});
			}
		});
	}
	else
	if('get_account'==request.operation){
		if(request.tab_id){
			ext_browser.tabs.get(request.tab_id,function(tab){
				if(ext_browser.runtime.lastError){
					console.log(ext_browser.runtime.lastError.message);
				}
				else{
					let response={
						'error':false,
						'result':{
							login:current_user,
							energy:current_energy,
							memo:(''==account.memo_key?false:true),
							active:(''==account.active_key?false:true)
						}
					};
					ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
				}
			});
		}
	}
	else
	if('get_settings'==request.operation){
		if(request.tab_id){
			ext_browser.tabs.get(request.tab_id,function(tab){
				if(ext_browser.runtime.lastError){
					console.log(ext_browser.runtime.lastError.message);
				}
				else{
					let response={
						'error':false,
						'result':settings
					};
					ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
				}
			});
		}
	}
	else
	if('import_account'==request.operation){
		console.log(request);
		if(request.tab_id){
			ext_browser.tabs.get(request.tab_id,function(tab){
				if(ext_browser.runtime.lastError){
					console.log(ext_browser.runtime.lastError.message);
				}
				else{
					let new_user=request.account.trim();
					if('@'==new_user.substring(0,1)){
						new_user=new_user.substring(1);
					}
					new_user=new_user.toLowerCase();

					let regular_valid=false;
					let memo_valid=false;
					let active_valid=false;

					let regular_key=request.regular_key;
					if(typeof regular_key == 'string'){
						regular_key=regular_key.trim();
					}

					let memo_key=request.memo_key;
					if(typeof memo_key == 'string'){
						memo_key=memo_key.trim();
					}

					let active_key=request.active_key;
					if(typeof active_key == 'string'){
						active_key=active_key.trim();
					}

					viz.auth.isWif(regular_key,function(regular_valid){
						function checkMemoAndActive(){
							if(''==memo_key || false===memo_key){
								var memo_valid=true;
								checkActive(regular_valid,memo_valid,active_key,regular_key,memo_key);
							}
							else{
								viz.auth.isWif(memo_key,function(memo_valid){
									checkActive(regular_valid,memo_valid,active_key,regular_key,memo_key);
								});
							}
						}
						function checkActive(regular_valid,memo_valid,active_key,regular_key,memo_key){
							if(''==active_key || false===active_key){
								var active_valid=true;
								finishImport(regular_valid,memo_valid,active_valid,active_key,regular_key,memo_key,new_user,request.tab_id,request.event);
							}
							else{
								viz.auth.isWif(active_key,function(active_valid){
									finishImport(regular_valid,memo_valid,active_valid,active_key,regular_key,memo_key,new_user,request.tab_id,request.event);
								});
							}
						}
						checkMemoAndActive();
					});

				}
			});
		}
	}
}

function finishImport(regular_valid,memo_valid,active_valid,active_key,regular_key,memo_key,new_user,tab_id,event){
	//fix if only active key is provided
	if(!regular_valid){
		if(active_valid){
			regular_valid=true;
			regular_key=active_key;
		}
	}

	if(regular_valid && memo_valid && active_valid){
		current_user=new_user;
		state.current_user=current_user;
		users[current_user]={'regular_key':regular_key,'memo_key':memo_key,'active_key':active_key};

		save_state(function(){
			let response={
				'error':false,
				'result':true
			};
			ext_browser.tabs.sendMessage(tab_id,{event:event,data:response});
		});
	}
	else{
		let response={
			'error':'invalid keys',
			'result':false
		};
		ext_browser.tabs.sendMessage(tab_id,{event:event,data:response});
	}
}

function update_api_gate(value=false){
	if(false==value){
		api_gate=api_http_gates[best_gate];
	}
	else{
		api_gate=value;
	}
	console.log('using new node',api_gate,'latency: ',best_gate_latency);
	viz.config.set('websocket',api_gate);
}

function select_best_gate(){
	for(i in api_http_gates){
		let current_gate=i;
		let current_gate_url=api_http_gates[i];
		let latency_start=new Date().getTime();
		let latency=-1;

		fetch(current_gate_url,{
			method:'POST',
			headers:{
				'accept':'application/json, text/plain, */*',
				'content-type':'application/json'
			},
			body:'{"id":1,"method":"call","jsonrpc":"2.0","params":["database_api","get_dynamic_global_properties",[]]}'
		})
		.then(function(response){
			if(response.ok){
				latency=new Date().getTime()-latency_start;
				console.log('check node',current_gate_url,'latency: ',latency);
				return response.json();
			}
			throw new Error('HTTP '+response.status);
		})
		.then(function(json){
			if(best_gate!=current_gate){
				if((best_gate_latency>latency)||(best_gate==-1)){
					try{
						dgp=json.result;
						best_gate=current_gate;
						best_gate_latency=latency;
						update_api_gate();
					}
					catch(e){
						console.log('select_best_gate node error',current_gate_url,e);
					}
				}
			}
		})
		.catch(function(error){
			console.log('select_best_gate fetch error',current_gate_url,error);
		});
	}
}

function check_viz_url(tab_id,url){
	/*
	//need to inject anyway for buttons, if not — user can forgot about installed vizonator
	if(state.encoded){
		if(!state.decoded){
			return;
		}
	}
	*/
	if(typeof tab_id === 'undefined'){
		return;
	}
	if(typeof url === 'undefined'){
		return;
	}
	if(-1==url.indexOf('://')){
		return false;
	}
	console.log('check_viz_url',tab_id,url);
	let protocol=url;
	protocol=protocol.substr(0,protocol.indexOf('://'));
	if('chrome'==protocol){
		return false;
	}
	if('chrome-extension'==protocol){
		return false;
	}
	let domain=url;
	domain=domain.substr(3+domain.indexOf('://'));
	if(-1!=domain.indexOf('/')){
		domain=domain.substr(0,domain.indexOf('/'));
	}
	if(0==domain.indexOf('www.')){
		domain=domain.substr(4);
	}
	let subdomain=domain;
	if(2<subdomain.split('.').length){
		subdomain=subdomain.substr(1+subdomain.lastIndexOf('.',subdomain.lastIndexOf('.')-1))
	}
	let found=function(tab_id,path){
		ext_browser.action.setIcon({path:"images/icon128.png"});
		if(''==current_user){
			ext_browser.action.setBadgeBackgroundColor({color:"rgba(187,0,0,0.4)"});
		}
		else{
			ext_browser.action.setBadgeBackgroundColor({color:"rgba(32,160,0,0.4)"});
		}
	};
	let not_found=function(){
		ext_browser.action.setIcon({path:"images/gray128.png"});
		ext_browser.action.setBadgeBackgroundColor({color:"rgba(136,136,136,0.4)"});
	}
	ext_browser.tabs.get(tab_id,function(tab){
		if(ext_browser.runtime.lastError){
			console.log(ext_browser.runtime.lastError.message);
		}
		else{
			if(tab.id>0){
				ext_browser.scripting.executeScript({target:{tabId:tab.id},files:[js_framework]},function(){
					if(ext_browser.runtime.lastError){
						console.log(ext_browser.runtime.lastError.message);
						not_found();
					}
					else{
						ext_browser.scripting.executeScript({target:{tabId:tab.id},files:['gates/'+domain+'.js']},function(){
							if(ext_browser.runtime.lastError){
								console.log(ext_browser.runtime.lastError.message);
								if(subdomain!=domain){
									ext_browser.scripting.executeScript({target:{tabId:tab.id},files:['subgates/'+subdomain+'.js']},function(){
										if(ext_browser.runtime.lastError){
											console.log(ext_browser.runtime.lastError.message);
											not_found();
										}
										else{
											found();
										}
									});
								}
								else{
									not_found();
								}
							}
							else{
								found();
							}
						});
					}
				});
				ext_browser.scripting.executeScript({target:{tabId:tab.id},files:[js_contentscript]},function(){
					if(ext_browser.runtime.lastError){
						console.log('contentscript NOT injected');
					}
					else{
						console.log('contentscript injected');
					}
				});
				ext_browser.scripting.executeScript({target:{tabId:tab.id},files:[js_inpage],world:'MAIN'},function(){
					if(ext_browser.runtime.lastError){
						console.log('inpage NOT injected',ext_browser.runtime.lastError.message);
					}
					else{
						console.log('inpage injected (MAIN world)');
					}
				});
			}
		}
	});
}

lsLoadAll(function(){
	version=localStorage['version'];
	if(typeof version === 'undefined'){
		version=1;
		version_update=true;
		localStorage['version']=version;
	}
	update_version(function(){
		load_state('',function(encode_status){
			console.log('main init load_state',encode_status,state);
			bg_initialized=true;
			main_app();
			// Process queued messages
			while(pending_messages.length>0){
				var item=pending_messages.shift();
				handle_message(item.request,item.sender,item.sendResponse);
			}
		});
	});
});


function handle_message(request,sender,sendResponse){
	console.log('onMessage',request);
	let need_encode=false;
	if(state.encoded){
		if(!state.decoded){
			need_encode=true;
		}
	}

	if(typeof request.encode_state !== 'undefined'){
			state.password=request.password;
			load_state(state.password,function(encode_status){
				sendResponse({status:encode_status});
			});
		}
		else
		if(typeof request.clear_state !== 'undefined'){
			delete localStorage['state'];
			state={};
			state.encoded=false;
			state.decoded=false;
			state.password='';
			state.users={};
			state.current_user='';
			state.settings={lang:'en',dark:false};
			state.rules={};
			sendResponse({status:'cleared'});
		}
		else
		if(typeof request.get_account_info !== 'undefined'){
			sendResponse({
				current_energy: current_energy,
				current_shares: current_shares,
				current_balance: current_balance,
				current_income_shares: typeof current_income_shares !== 'undefined' ? current_income_shares : 0,
				current_outcome_shares: typeof current_outcome_shares !== 'undefined' ? current_outcome_shares : 0,
				current_effective_shares: typeof current_effective_shares !== 'undefined' ? current_effective_shares : 0,
				current_custom_sequence: typeof current_custom_sequence !== 'undefined' ? current_custom_sequence : 0,
				current_withdraw: typeof current_withdraw !== 'undefined' ? current_withdraw : 0,
				current_withdrawn: typeof current_withdrawn !== 'undefined' ? current_withdrawn : 0,
				current_withdraw_rate: typeof current_withdraw_rate !== 'undefined' ? current_withdraw_rate : 0,
				current_next_vesting_withdrawal: typeof current_next_vesting_withdrawal !== 'undefined' ? current_next_vesting_withdrawal : 0
			});
		}
		else
		if(typeof request.reload_state !== 'undefined'){
			load_state(state.password,function(encode_status){
				sendResponse({status:encode_status});
			});
		}
		else
		if(typeof request.save_state !== 'undefined'){
			let temp_state=request.state;
			for(let user_i in temp_state.users){
				//if memo_key is setted, not change it
				if(typeof temp_state.users[user_i].memo_key === 'undefined'){
					//unwrap users and copy memo keys from actual state
					if(temp_state.users[user_i].memo){
						if(typeof state.users[user_i] !== 'undefined')
						if(typeof state.users[user_i].memo_key !== 'undefined'){
							temp_state.users[user_i].memo_key=state.users[user_i].memo_key;
						}
					}
					else{
						temp_state.users[user_i].memo_key='';
					}
				}
				else{
					if(''==temp_state.users[user_i].memo_key){
						if(typeof state.users[user_i] !== 'undefined')
						if(typeof state.users[user_i].memo_key !== 'undefined'){
							temp_state.users[user_i].memo_key=state.users[user_i].memo_key;
						}
					}
				}
				if(typeof temp_state.users[user_i].memo !== 'undefined'){
					delete temp_state.users[user_i].memo;
				}

				//if active_key is setted, not change it
				if(typeof temp_state.users[user_i].active_key === 'undefined'){
					//unwrap users and copy active keys from actual state
					if(temp_state.users[user_i].active){
						if(typeof state.users[user_i] !== 'undefined')
						if(typeof state.users[user_i].active_key !== 'undefined'){
							temp_state.users[user_i].active_key=state.users[user_i].active_key;
						}
					}
					else{
						temp_state.users[user_i].active_key='';
					}
				}
				else{
					if(''==temp_state.users[user_i].active_key){
						if(typeof state.users[user_i] !== 'undefined')
						if(typeof state.users[user_i].active_key !== 'undefined'){
							temp_state.users[user_i].active_key=state.users[user_i].active_key;
						}
					}
				}
				if(typeof temp_state.users[user_i].active !== 'undefined'){
					delete temp_state.users[user_i].active;
				}

				//if regular_key is setted, not change it
				if(typeof temp_state.users[user_i].regular_key === 'undefined'){
					//unwrap users and copy regular keys from actual state
					if(typeof state.users[user_i] !== 'undefined')
					if(typeof state.users[user_i].regular_key !== 'undefined'){
						temp_state.users[user_i].regular_key=state.users[user_i].regular_key;
					}
				}
				else{
					if(''==temp_state.users[user_i].regular_key){
						if(typeof state.users[user_i] !== 'undefined')
						if(typeof state.users[user_i].regular_key !== 'undefined'){
							temp_state.users[user_i].regular_key=state.users[user_i].regular_key;
						}
					}
				}
			}
			//if state is encoded and no new password is setted, copy it from actual state
			if(temp_state.encoded){
				if(typeof temp_state.password !== 'undefined'){
					if(''==temp_state.password){
						temp_state.decoded=true;
						temp_state.password=state.password;
					}
					else{
						temp_state.decoded=true;
					}
				}
				else{
					if(typeof state.password !== 'undefined'){
						temp_state.decoded=true;
						temp_state.password=state.password;
					}
					else{
						//strange imposible status, seems never will be executed
						temp_state.encoded=false;
						temp_state.decoded=false;
						temp_state.password='';
					}
				}
			}
			else{
				//or clear password
				temp_state.decoded=false;
				temp_state.password='';
			}
			console.log('trying save temp_state',temp_state,temp_state.users);
			state=JSON.parse(JSON.stringify(temp_state));
			save_state(function(){
				load_state(state.password,function(encode_status){
					sendResponse({status:encode_status});
				});
			});
		}
		else
		if(typeof request.vizonator !== 'undefined'){
			if(request.vizonator){
				let tab_id=0;
				if(typeof sender.tab !== 'undefined'){
					if(typeof sender.tab.id !== 'undefined'){
						tab_id=sender.tab.id;
					}
				}
				if(0==tab_id){
					sendResponse({decoded:true,status:true});
					let origin='extension';
					let action_request={
						tab_id,
						origin,
						id:request.id,
						login:request.login,
						sequence:request.sequence,
						memo:request.memo,
						beneficiaries:JSON.parse(request.beneficiaries)
					};
					ext_browser.windows.create({
						url:ext_browser.runtime.getURL("action.html#"+JSON.stringify(action_request)),
						type:"popup",
						focused:true,
						width:request.action_width,
						height:request.action_height+chrome_height_fix,
						top:Math.max(request.action_top, 0),
						left:Math.max(request.action_left, 0)
					});
				}
				else{
					sendResponse({decoded:true,status:true});
					ext_browser.tabs.get(tab_id,function(tab){
						if(ext_browser.runtime.lastError){
							console.log(ext_browser.runtime.lastError.message);
						}
						else{
							let origin=tab.url;
							origin=origin.substr(3+origin.indexOf('://'));
							if(-1!=origin.indexOf('/')){
								origin=origin.substr(0,origin.indexOf('/'));
							}
							let action_request={
								tab_id,
								origin,
								id:request.id,
								login:request.login,
								sequence:request.sequence,
								memo:request.memo,
								beneficiaries:JSON.parse(request.beneficiaries)
							};

							let trustline=false;
							if(typeof rules[origin] !== 'undefined'){
								if(typeof rules[origin]['vizonator'] !== 'undefined'){
									if(rules[origin]['vizonator']){
										trustline='approve';
									}
								}
								console.log('Trustline found fot vizonator:',origin);
							}
							if('approve'==trustline){//vizonator gates can be only approved
								action_request.vizonator_action=true;
								action_request.award=true;
								action_request.refuse=false;

								action_request.energy=settings.award_energy;

								vizonator_action(action_request);
							}
							else{
								ext_browser.windows.create({
									url:ext_browser.runtime.getURL("action.html#"+JSON.stringify(action_request)),
									type:"popup",
									focused:true,
									width:request.action_width,
									height:request.action_height+chrome_height_fix,
									top:Math.max(request.action_top, 0),
									left:Math.max(request.action_left, 0)
								});
							}
						}
					});
				}
			}
		}
		else
		if(typeof request.popup !== 'undefined'){
			if(request.popup){//new popup action
				if(extension_id==sender.id){//working ops from extension popup
					//sendResponse({error:false,response:true});
					let response_error=true;
					let response_result=false;
					if('award'==request.operation){
						let rshares=parseInt(current_award_effective_shares * request.energy / 10000);
						let approximate_amount=parseFloat(dgp.total_reward_fund) * (rshares / (rshares + parseInt(dgp.total_reward_shares)));
						approximate_amount=approximate_amount*0.995;
						approximate_amount=parseInt(approximate_amount*1000000);
						approximate_amount=approximate_amount/1000000;

						viz.api.getAccount(request.receiver,'',function(err,account_response){
							let send_error=function(operation_error){
								sendResponse({'error':operation_error,'result':response_result});
							};
							if(err){
								send_error('default_recipient_error');
								return;
							}
							let recipient_memo=account_response.memo_key;
							let do_broadcast=function(encoded_memo){
								viz.broadcast.award(account.regular_key,current_user,request.receiver,parseInt(request.energy),parseInt(request.custom_sequence),encoded_memo,request.beneficiaries,function(e,r){
									console.log(e);
									response_error=(!!e);
									if(!response_error){
										response_result={approximate_amount};
									}
									let response={'error':response_error,'result':response_result}
									sendResponse(response);
									if(!e){
										current_energy-=parseInt(request.energy);
										localStorage['current_energy']=current_energy;
										let new_energy=current_energy;
										ext_browser.action.setBadgeText({text:''+parseInt(parseFloat(new_energy)/100)+'%'});
									}
								});
							};
							if(request.force_memo_encoding){
								if('VIZ1111111111111111111111111111111114T1Anm'==recipient_memo){
									send_error('recipient_memo_error');
									return;
								}
								viz.memo.encode(account.memo_key,recipient_memo,'#'+request.memo,function(result,error){
									if(error){
										send_error('encrypt_memo_error');
										return;
									}
									do_broadcast(result);
								});
								return;
							}
							do_broadcast(request.memo);
						});
					}
					if('fixed_award'==request.operation){
						let rshares=parseInt(current_award_effective_shares * request.max_energy / 10000);
						let approximate_amount=parseFloat(dgp.total_reward_fund) * (rshares / (rshares + parseInt(dgp.total_reward_shares)));
						approximate_amount=approximate_amount*0.995;
						approximate_amount=parseInt(approximate_amount*1000000);
						approximate_amount=approximate_amount/1000000;
						let reward_amount_float=parseFloat(request.reward_amount);
						let approximate_energy=(reward_amount_float/approximate_amount)*request.max_energy;

						viz.api.getAccount(request.receiver,'',function(err,account_response){
							let send_error=function(operation_error){
								sendResponse({'error':operation_error,'result':response_result});
							};
							if(err){
								send_error('default_recipient_error');
								return;
							}
							let recipient_memo=account_response.memo_key;
							let do_broadcast=function(encoded_memo){
								viz.broadcast.fixedAward(account.regular_key,current_user,request.receiver,request.reward_amount,parseInt(request.max_energy),parseInt(request.custom_sequence),encoded_memo,request.beneficiaries,function(e,r){
									console.log(e);
									response_error=(!!e);
									if(!response_error){
										response_result={approximate_amount};
									}
									let response={'error':response_error,'result':response_result}
									sendResponse(response);
									if(!e){
										current_energy-=parseInt(approximate_energy);
										localStorage['current_energy']=current_energy;
										let new_energy=current_energy;
										ext_browser.action.setBadgeText({text:''+parseInt(parseFloat(new_energy)/100)+'%'});
									}
								});
							};
							if(request.force_memo_encoding){
								if('VIZ1111111111111111111111111111111114T1Anm'==recipient_memo){
									send_error('recipient_memo_error');
									return;
								}
								viz.memo.encode(account.memo_key,recipient_memo,'#'+request.memo,function(result,error){
									if(error){
										send_error('encrypt_memo_error');
										return;
									}
									do_broadcast(result);
								});
								return;
							}
							do_broadcast(request.memo);
						});
					}
					if('transfer'==request.operation){
						viz.api.getAccount(request.to,'',function(err,account_response){
							let send_error=function(operation_error){
								sendResponse({'error':operation_error,'result':response_result});
							};
							if(err){
								send_error('default_recipient_error');
								return;
							}
							let recipient_memo=account_response.memo_key;
							let do_broadcast=function(encoded_memo){
								viz.broadcast.transfer(account.active_key,current_user,request.to,request.amount,encoded_memo,function(e,r){
									console.log(e);
									response_error=(!!e);
									if(!response_error){
										response_result={};
									}
									let response={'error':response_error,'result':response_result}
									sendResponse(response);
									if(!e){
										current_balance=parseFloat(parseFloat(current_balance)-parseFloat(request.amount)).toFixed(3);
										localStorage['current_balance']=current_balance;
									}
								});
							};
							if(request.force_memo_encoding){
								if('VIZ1111111111111111111111111111111114T1Anm'==recipient_memo){
									send_error('recipient_memo_error');
									return;
								}
								viz.memo.encode(account.memo_key,recipient_memo,'#'+request.memo,function(result,error){
									if(error){
										send_error('encrypt_memo_error');
										return;
									}
									do_broadcast(result);
								});
								return;
							}
							do_broadcast(request.memo);
						});
					}
					if('transfer_to_vesting'==request.operation){
						viz.api.getAccount(request.to,'',function(err,account_response){
							if(!err){
								viz.broadcast.transferToVesting(account.active_key,current_user,request.to,request.amount,function(e,r){
									console.log(e);
									response_error=(!!e);
									if(!response_error){
										response_result={};
									}
									let response={'error':response_error,'result':response_result}
									sendResponse(response);
									if(!e){//manual update account
										current_balance=parseFloat(parseFloat(current_balance)-parseFloat(request.amount)).toFixed(3);
										current_shares=parseFloat(parseFloat(current_shares)+parseFloat(request.amount)).toFixed(3);
										current_effective_shares=parseFloat(parseFloat(current_shares)+parseFloat(current_income_shares)-parseFloat(current_outcome_shares)).toFixed(3);

										localStorage['current_shares']=current_shares;
										localStorage['current_effective_shares']=current_effective_shares;
										localStorage['current_balance']=current_balance;
									}
								});
							}
							else{
								let response={'error':'default_recipient_error','result':response_result}
								sendResponse(response);
							}
						});
					}
					if('withdraw_vesting'==request.operation){
						viz.broadcast.withdrawVesting(users[current_user].active_key,current_user,request.amount,function(e,r){
							console.log(e);
							response_error=(!!e);
							if(!response_error){
								response_result={};
							}
							let response={'error':response_error,'result':response_result}
							sendResponse(response);
							if(!e){//manual update account
								if('0.000000 SHARES'==request.amount){//stop unstake
									current_withdraw=0;
									current_withdrawn=0;
									current_withdraw_rate=0;
									current_next_vesting_withdrawal=-1;
									localStorage['current_withdraw']=current_withdraw;
									localStorage['current_withdrawn']=current_withdrawn;
									localStorage['current_withdraw_rate']=current_withdraw_rate;
									localStorage['current_next_vesting_withdrawal']=current_next_vesting_withdrawal;
								}
								else{
									ext_browser.alarms.create('viz_timer',{when:Date.now()+1});
								}
							}
						});
					}
					if('delegate_vesting_shares'==request.operation){
						viz.api.getAccount(request.delegatee,'',function(err,account_response){
							if(!err){
								viz.broadcast.delegateVestingShares(account.active_key,current_user,request.delegatee,request.vesting_shares,function(e,r){
									console.log(e);
									response_error=(!!e);
									if(!response_error){
										response_result={};
									}
									let response={'error':response_error,'result':response_result}
									sendResponse(response);
									if(!e){//manual update account
										ext_browser.alarms.create('viz_timer',{when:Date.now()+1});
									}
								});
							}
							else{
								let response={'error':'default_recipient_error','result':response_result}
								sendResponse(response);
							}
						});
					}
					if('load_history'==request.operation){
						let from=request.last_id;
						let limit=100;
						if(-1!=from){
							from-=limit;
							from=Math.max(from,0);
						}
						viz.api.getAccountHistory(current_user,from,limit,function(err,history_response){
							response_error=(!!err);
							sendResponse({'error':response_error,'result':history_response});
						});
					}
					if('decode_memo'==request.operation){
						if(''==users[current_user].memo_key){
							sendResponse({'error':true,'result':''});
						}
						else{
							viz.memo.decode(users[current_user].memo_key,request.memo,function(result,error){
								if(error) sendResponse({'error':true,'result':''});
								else sendResponse({'error':false,'result':result});
							});
						}
					}
					if('publish_voice'==request.operation){
						viz.api.getAccount(current_user,'V',function(err,response){
							if(!err){
								let previous=parseInt(response.custom_sequence_block_num);
								current_custom_sequence=previous;
								localStorage['current_custom_sequence']=current_custom_sequence;

								let object_json={};
								if(previous>0){
									object_json.p=previous;
								}
								let object_data={};
								object_data.t=request.text;
								if(false!=request.share){
									object_data.s=request.share;
								}
								object_json.d=object_data;

								//new custom operation broadcast, get block num from response
								let raw_tx={'operations':[
									['custom',{required_active_auths:[],required_regular_auths:[current_user],id:'V',json:JSON.stringify(object_json)}]
								],'extensions':[]};

								viz.broadcast._prepareTransaction(raw_tx).then((prepaired_tx)=>{
									viz.auth.signTransaction(prepaired_tx,[account.regular_key],function(signed_tx){
										viz.api.broadcastTransactionSynchronous(signed_tx,function(e,r){
											console.log(e);
											response_error=(!!e);
											if(!response_error){
												response_result=r;
											}
											let response={'error':response_error,'result':response_result}
											sendResponse(response);
											if(!e){
												ext_browser.alarms.create('viz_timer',{when:Date.now()+5});
											}
										});
									});
								});
								/*
								viz.broadcast.custom(
									account.regular_key,
									[],
									[current_user],
									'V',
									JSON.stringify(object_json),
									function(e,r){
										console.log(e);
										response_error=(!!e);
										if(!response_error){
											response_result={};
										}
										let response={'error':response_error,'result':response_result}
										sendResponse(response);
										if(!e){//manual update account
											ext_browser.alarms.create('viz_timer',{when:Date.now()+5});
										}
									}
								);
								*/
							}
							else{
								let response={'error':response_error,'result':response_result}
								sendResponse(response);
							}
						});
					}
				}
				//end of popup executions
			}
		}
		else
		if(typeof request.inpage !== 'undefined'){
			if(request.inpage){//new inpage action
				let tab_id=0;
				//console.log('inpage action sender',sender);
				if(typeof sender.tab !== 'undefined'){
					if(typeof sender.tab.id !== 'undefined'){
						tab_id=sender.tab.id;
					}
				}
				if(0!=tab_id){
					console.log('inpage request from tab: '+tab_id,request);
					sendResponse({decoded:true,status:true});
					ext_browser.tabs.get(tab_id,function(tab){
						if(ext_browser.runtime.lastError){
							console.log(ext_browser.runtime.lastError.message);
						}
						else{
							let origin=tab.url;
							origin=origin.substr(3+origin.indexOf('://'));
							if(-1!=origin.indexOf('/')){
								origin=origin.substr(0,origin.indexOf('/'));
							}
							let action_request={
								tab_id,
								origin,
								id:request.id,
								operation:request.operation,
								operation_type:request.operation_type,
								event:request.event,
							};

							let find_error=false;
							let trustline=false;
							if(typeof rules[origin] !== 'undefined'){
								let need_weight=request.operation_type.length;
								let approve_weight=0;
								let refuse_weight=0;
								for(let i in request.operation_type){
									if(typeof rules[origin][request.operation_type[i]] !== 'undefined'){
										if(rules[origin][request.operation_type[i]]){
											approve_weight++;
										}
										else{
											refuse_weight++;
										}
									}
								}
								if(approve_weight==need_weight){
									trustline='approve';
								}
								if(refuse_weight==need_weight){
									trustline='refuse';
								}
								console.log('Trustline found:',origin,rules[origin],need_weight,trustline);
							}

							if('award'==request.operation){
								if(request.force_memo_encoding){
									if(''==account.memo_key){
										find_error=true;
										let response={'error':'empty_memo_key','result':false}
										ext_browser.tabs.sendMessage(tab_id,{event:request.event,data:response});
									}
								}
								if(current_energy < request.energy){
									find_error=true;
									let response={'error':'energy_error','result':false}
									ext_browser.tabs.sendMessage(tab_id,{event:request.event,data:response});
								}
								action_request={
									tab_id,
									origin,
									id:request.id,
									operation:request.operation,
									operation_type:request.operation_type,
									event:request.event,

									receiver:request.receiver,
									energy:(request.energy?request.energy:false),//if false, use default value from settings
									custom_sequence:request.custom_sequence,
									memo:request.memo,
									beneficiaries:JSON.parse(request.beneficiaries),

									force_memo_encoding:request.force_memo_encoding,
								};
							}
							if('fixed_award'==request.operation){
								if(request.force_memo_encoding){
									if(''==account.memo_key){
										find_error=true;
										let response={'error':'empty_memo_key','result':false}
										ext_browser.tabs.sendMessage(tab_id,{event:request.event,data:response});
									}
								}
								if(current_energy < request.max_energy){
									find_error=true;
									let response={'error':'energy_error','result':false}
									ext_browser.tabs.sendMessage(tab_id,{event:request.event,data:response});
								}
								action_request={
									tab_id,
									origin,
									id:request.id,
									operation:request.operation,
									operation_type:request.operation_type,
									event:request.event,

									receiver:request.receiver,
									reward_amount:request.reward_amount,
									max_energy:(request.max_energy?request.max_energy:false),//if false, use default value from settings
									custom_sequence:request.custom_sequence,
									memo:request.memo,
									beneficiaries:JSON.parse(request.beneficiaries),

									force_memo_encoding:request.force_memo_encoding,
								};
							}
							if('transfer'==request.operation){
								if(request.force_memo_encoding){
									if(''==account.memo_key){
										find_error=true;
										let response={'error':'empty_memo_key','result':false}
										ext_browser.tabs.sendMessage(tab_id,{event:request.event,data:response});
									}
								}
								action_request={
									tab_id,
									origin,
									id:request.id,
									operation:request.operation,
									operation_type:request.operation_type,
									event:request.event,

									to:request.to,
									amount:request.amount,
									memo:request.memo,

									force_memo_encoding:request.force_memo_encoding,
								};
							}
							if('transfer_to_vesting'==request.operation){
								action_request={
									tab_id,
									origin,
									id:request.id,
									operation:request.operation,
									operation_type:request.operation_type,
									event:request.event,

									to:request.to,
									amount:request.amount,
								};
							}
							if('withdraw_vesting'==request.operation){
								action_request={
									tab_id,
									origin,
									id:request.id,
									operation:request.operation,
									operation_type:request.operation_type,
									event:request.event,

									vesting_shares:request.vesting_shares,
								};
							}
							if('delegate_vesting_shares'==request.operation){
								action_request={
									tab_id,
									origin,
									id:request.id,
									operation:request.operation,
									operation_type:request.operation_type,
									event:request.event,

									delegatee:request.delegatee,
									vesting_shares:request.vesting_shares,
								};
							}
							if('committee_vote_request'==request.operation){
								action_request={
									tab_id,
									origin,
									id:request.id,
									operation:request.operation,
									operation_type:request.operation_type,
									event:request.event,

									request_id:request.request_id,
									vote_percent:request.vote_percent,
								};
							}
							if('custom'==request.operation){
								action_request={
									tab_id,
									origin,
									id:request.id,
									operation:request.operation,
									operation_type:request.operation_type,
									event:request.event,

									authority:request.authority,
									protocol_id:request.protocol_id,
									json:request.json,
								};
							}
							if('account_metadata'==request.operation){
								action_request={
									tab_id,
									origin,
									id:request.id,
									operation:request.operation,
									operation_type:request.operation_type,
									event:request.event,

									json:request.json,
								};
							}
							if('passwordless_auth'==request.operation){
								action_request={
									tab_id,
									origin,
									id:request.id,
									operation:request.operation,
									operation_type:request.operation_type,
									event:request.event,

									authority:request.authority,
								};
							}
							if('sign_data'==request.operation){
								action_request={
									tab_id,
									origin,
									id:request.id,
									operation:request.operation,
									operation_type:request.operation_type,
									event:request.event,

									authority:request.authority,
									data_to_sign:request.data_to_sign,
								};
							}
							if('get_custom_account'==request.operation){
								action_request={
									tab_id,
									origin,
									id:request.id,
									operation:request.operation,
									operation_type:request.operation_type,
									event:request.event,

									account:request.account,
									protocol_id:request.protocol_id,
								};
							}
							if('get_account_history'==request.operation){
								action_request={
									tab_id,
									origin,
									id:request.id,
									operation:request.operation,
									operation_type:request.operation_type,
									event:request.event,

									account:request.account,
									from:request.from,
									limit:request.limit,
								};
							}
							if('get_accounts_on_sale'==request.operation){
								action_request={
									tab_id,
									origin,
									id:request.id,
									operation:request.operation,
									operation_type:request.operation_type,
									event:request.event,

									from:request.from,
									limit:request.limit,
								};
							}
							if('get_subaccounts_on_sale'==request.operation){
								action_request={
									tab_id,
									origin,
									id:request.id,
									operation:request.operation,
									operation_type:request.operation_type,
									event:request.event,

									from:request.from,
									limit:request.limit,
								};
							}
							if('get_account'==request.operation){
								action_request={
									tab_id,
									origin,
									id:request.id,
									operation:request.operation,
									operation_type:request.operation_type,
									event:request.event,
								};
							}
							if('get_settings'==request.operation){
								action_request={
									tab_id,
									origin,
									id:request.id,
									operation:request.operation,
									operation_type:request.operation_type,
									event:request.event,
								};
							}
							if('import_account'==request.operation){
								action_request={
									tab_id,
									origin,
									id:request.id,
									operation:request.operation,
									operation_type:request.operation_type,
									event:request.event,

									account:request.account,
									regular_key:request.regular_key,
									active_key:request.active_key,
									memo_key:request.memo_key,
								};
							}
							if(false===trustline){//no trustline for origin, ask user
								if(!find_error){
									ext_browser.windows.create({
										url:ext_browser.runtime.getURL("operation.html#"+JSON.stringify(action_request)),
										type:"popup",
										focused:true,
										width:request.action_width,
										height:request.action_height+chrome_height_fix,
										top:Math.max(request.action_top, 0),
										left:Math.max(request.action_left, 0)
									});
								}
							}
							if('approve'==trustline){//trustline approved for origin, auto execute inpage action
								action_request.inpage_action=true;
								action_request.approve=true;
								action_request.refuse=false;

								if('award'==action_request.operation){
									action_request.energy=settings.award_energy;
								}
								inpage_action(action_request);
							}
							if('refuse'==trustline){//trustline refused for origin
								ext_browser.tabs.get(tab_id,function(tab){
									if(ext_browser.runtime.lastError){
										console.log(ext_browser.runtime.lastError.message);
									}
									else{
										let response={'error':'refuse','result':false}
										ext_browser.tabs.sendMessage(tab_id,{event:request.event,data:response});
									}
								});
							}
						}
					});
				}
			}
		}
		else
		if(!need_encode){//need to encode state first
			if(typeof request.get_state !== 'undefined'){
				//save_state(function(){
					let temp_state=JSON.parse(JSON.stringify(state));
					for(let user_i in temp_state.users){
						temp_state.users[user_i].memo=false;
						if(typeof temp_state.users[user_i].memo_key !== 'undefined')
						if(''!=temp_state.users[user_i].memo_key){
							temp_state.users[user_i].memo=true;
						}
						delete temp_state.users[user_i].memo_key;

						temp_state.users[user_i].active=false;
						if(typeof temp_state.users[user_i].active_key !== 'undefined')
						if(''!=temp_state.users[user_i].active_key){
							temp_state.users[user_i].active=true;
						}
						delete temp_state.users[user_i].active_key;

						delete temp_state.users[user_i].regular_key;
					}
					delete temp_state.password;
					console.log('get_state, temp_state',temp_state);
					sendResponse({decoded:true,state:temp_state});
				//});
			}

			if(typeof request.vizonator_account !== 'undefined'){
				sendResponse({
					decoded:true,
					'account':{
						login:current_user,
						energy:current_energy,
						memo:(''==account.memo_key?false:true),
						active:(''==account.active_key?false:true)
					},
					'settings':settings
				});
			}

			if(typeof request.vizonator_action !== 'undefined'){
				sendResponse({decoded:true,status:true});
				vizonator_action(request);
			}
			//console.log('check typeof request.inpage_action',typeof request.inpage_action);
			if(typeof request.inpage_action !== 'undefined'){
				sendResponse({decoded:true,status:true});
				inpage_action(request);
			}
		}
		else{//need to encode first
			sendResponse({decoded:false});
		}
		return true;
}

function main_app(){
	select_best_gate();
	ext_browser.action.setIcon({path:"images/gray128.png"});
	ext_browser.action.setBadgeBackgroundColor({color:"rgba(136,136,136,0.4)"});
	ext_browser.action.setBadgeText({text:"..."});
	ext_browser.alarms.create('viz_timer',{when:Date.now()+1});
}

/* MV3: All event listeners registered synchronously at top level */
if(typeof ext_browser !== 'undefined'){
	ext_browser.runtime.onMessage.addListener(function(request,sender,sendResponse){
		if(!bg_initialized) return true;
		handle_message(request,sender,sendResponse);
		return true;
	});

	ext_browser.tabs.onActivated.addListener(function(active_info){
		if(!bg_initialized) return;
		console.log('onActivated',active_info);
		ext_browser.tabs.get(active_info.tabId,function(tab){
			if(ext_browser.runtime.lastError){
				console.log(ext_browser.runtime.lastError.message);
			}
			else{
				check_viz_url(tab.id,tab.url);
			}
		});
	});

	ext_browser.tabs.onUpdated.addListener(function(tabId,change_info,tab){
		if(!bg_initialized) return;
		console.log('onUpdated',tabId,change_info,tab);
		if(ext_browser.runtime.lastError){
			console.log(ext_browser.runtime.lastError.message);
		}
		else{
			if(typeof change_info.status !== 'undefined'){
				if(change_info.status=='complete'){
					check_viz_url(tab.id,tab.url);
				}
			}
		}
	});

	ext_browser.runtime.onInstalled.addListener(function(reason){
		console.log('onInstalled');

		switch(reason){
			case "install":
				ext_browser.tabs.create({
					url:ext_browser.runtime.getURL('options.html'),
				});
			break;
		}

		ext_browser.action.setBadgeText({text:'?'});
		ext_browser.tabs.query({active:true},function(tabs){
			let tab=tabs[0];
			check_viz_url(tab.id,tab.url);
		});
		ext_browser.alarms.create('viz_timer',{when:Date.now()+1});
	});

	ext_browser.runtime.onSuspend.addListener(function(){
		console.log('onSuspend');
		ext_browser.action.setBadgeBackgroundColor({color:"rgba(136,136,136,0.4)"});
	});

	ext_browser.runtime.onStartup.addListener(function(){
		console.log('onStartup');
		ext_browser.action.setBadgeText({text:""});
		ext_browser.tabs.query({active:true},function(tabs){
			let tab=tabs[0];
			check_viz_url(tab.id,tab.url);
		});
		ext_browser.alarms.create('viz_timer',{when:Date.now()+1});
	});

	ext_browser.alarms.onAlarm.addListener(function(alarm){
		if(!bg_initialized) return;
		if('viz_timer'==alarm.name){
			viz_timer();
		}
	});
}
