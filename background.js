'use strict';
/* Extensions state vars */
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
		for(let i in window.navigator.languages){
			if(typeof langs_arr[window.navigator.languages[i].toLowerCase()] !== 'undefined'){
				let try_lang=langs_arr[window.navigator.languages[i].toLowerCase()];
				if(typeof available_langs[try_lang] !== 'undefined'){
					settings.lang=langs_arr[try_lang];
					find_lang=true;
					break;
				}
			}
		}
		if(!find_lang){
			if(typeof langs_arr[window.navigator.language.toLowerCase()] !== 'undefined'){
				let try_lang=langs_arr[window.navigator.language.toLowerCase()];
				if(typeof available_langs[try_lang] !== 'undefined'){
					settings.lang=langs_arr[try_lang];
				}
			}
		}
		//load localization templates
		ltmp_arr=window['ltmp_'+settings.lang+'_arr'];
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
	ltmp_arr=window['ltmp_'+settings.lang+'_arr'];
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

var api_http_gates=[
	'https://api.viz.world/',
	'https://node.viz.plus/',
	'https://node.viz.cx/',
	'https://viz.lexai.host/',
	'https://vizrpc.lexai.host/',
	'https://viz-node.dpos.space/',
	'https://node.viz.media/',
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

/* Load extension version and check if update is needed */
var global_version=1;
var version=localStorage['version'];
var version_update=false;//need update storage rules
if(typeof version === 'undefined'){
	version=1;
	version_update=true;
	localStorage['version']=version;
}

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

function passwordless_auth(private_key,account,domain,authority){
	var nonce=0;
	var data='';
	var signature='';
	while(!auth_signature_check(signature)){
		data=domain+':auth:'+account+':'+authority+':'+(new Date().getTime() / 1000 | 0)+':'+nonce;
		signature=viz.auth.signature.sign(data,private_key).toHex();
		nonce++;
	}
	return {account,data,signature};
}

function viz_timer(){
	let need_encode=false;
	if(state.encoded){
		if(!state.decoded){
			need_encode=true;
			ext_browser.browserAction.setBadgeBackgroundColor({color:"rgba(136,136,136,0.4)"});
			ext_browser.browserAction.setBadgeText({text:"?"});
		}
	}
	if(!need_encode){
		if(''==current_user){
			ext_browser.browserAction.setBadgeText({text:"?"});
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

						ext_browser.browserAction.setBadgeBackgroundColor({color:"rgba(136,136,136,0.4)"});
						ext_browser.browserAction.setBadgeText({text:''+parseInt(parseFloat(new_energy)/100)+'%'});
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
			try{
				encoded_memo=viz.memo.encode(account.memo_key,recipient_memo,'#'+request.memo);
			}
			catch(e){
				encrypt_memo_error=true;
			}
		}
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
								ext_browser.browserAction.setBadgeText({text:''+parseInt(parseFloat(new_energy)/100)+'%'});
							}
						}
					});
				}
			});
		}
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
			let operation_error=false;
			if(!err){
				let encoded_memo=request.memo;
				let recipient_memo=account_response.memo_key;
				if(request.force_memo_encoding){
					if('VIZ1111111111111111111111111111111114T1Anm'==recipient_memo){
						operation_error='recipient_memo_error';
					}
					else{
						try{
							encoded_memo=viz.memo.encode(account.memo_key,recipient_memo,'#'+request.memo);
						}
						catch(e){
							operation_error='encrypt_memo_error';
						}
					}
				}
				if(false===operation_error){
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
										ext_browser.browserAction.setBadgeText({text:''+parseInt(parseFloat(new_energy)/100)+'%'});
									}
								}
							});
						}
					});
				}
			}
			else{
				operation_error='recipient_error';
			}
			if(false!==operation_error){
				let response={'error':operation_error,'result':response_result}
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
	if('fixed_award'==request.operation){
		let rshares=parseInt(current_award_effective_shares * request.max_energy / 10000);
		let approximate_amount=parseFloat(dgp.total_reward_fund) * (rshares / (rshares + parseInt(dgp.total_reward_shares)));
		approximate_amount=approximate_amount;
		approximate_amount=parseInt(approximate_amount*1000000);
		approximate_amount=approximate_amount/1000000;
		let reward_amount_float=parseFloat(request.reward_amount);
		let approximate_energy=(reward_amount_float/approximate_amount)*request.max_energy;

		viz.api.getAccount(request.receiver,'',function(err,account_response){
			let operation_error=false;
			if(!err){
				let encoded_memo=request.memo;
				let recipient_memo=account_response.memo_key;
				if(request.force_memo_encoding){
					if('VIZ1111111111111111111111111111111114T1Anm'==recipient_memo){
						operation_error='recipient_memo_error';
					}
					else{
						try{
							encoded_memo=viz.memo.encode(account.memo_key,recipient_memo,'#'+request.memo);
						}
						catch(e){
							operation_error='encrypt_memo_error';
						}
					}
				}
				if(false===operation_error){
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
									if(!e){//manual update account energy
										current_energy-=parseInt(approximate_energy);
										localStorage['current_energy']=current_energy;

										let new_energy=current_energy;
										ext_browser.browserAction.setBadgeText({text:''+parseInt(parseFloat(new_energy)/100)+'%'});
									}
								}
							});
						}
					});
				}
			}
			else{
				operation_error='recipient_error';
			}
			if(false!==operation_error){
				let response={'error':operation_error,'result':response_result}
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
	if('transfer'==request.operation){
		viz.api.getAccount(request.to,'',function(err,account_response){
			let operation_error=false;
			if(!err){
				let encoded_memo=request.memo;
				let recipient_memo=account_response.memo_key;
				if(request.force_memo_encoding){
					if('VIZ1111111111111111111111111111111114T1Anm'==recipient_memo){
						operation_error='recipient_memo_error';
					}
					else{
						try{
							encoded_memo=viz.memo.encode(account.memo_key,recipient_memo,'#'+request.memo);
						}
						catch(e){
							operation_error='encrypt_memo_error';
						}
					}
				}
				if(false===operation_error){
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
				}
			}
			else{
				operation_error='recipient_error';
			}
			if(false!==operation_error){
				let response={'error':operation_error,'result':response_result}
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
					response_result=passwordless_auth(private_key,current_user,request.origin,request.authority);
					let response={'error':response_error,'result':response_result}
					ext_browser.tabs.sendMessage(request.tab_id,{event:request.event,data:response});
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

		let xhr = new XMLHttpRequest();
		xhr.overrideMimeType('text/plain');
		xhr.open('POST',current_gate_url);
		xhr.setRequestHeader('accept','application/json, text/plain, */*');
		xhr.setRequestHeader('content-type','application/json');
		xhr.onreadystatechange = function() {
			if(4==xhr.readyState && 200==xhr.status){
				latency=new Date().getTime() - latency_start;
				console.log('check node',current_gate_url,'latency: ',latency);
				if(best_gate!=current_gate){
					if((best_gate_latency>latency)||(best_gate==-1)){
						try{
							let json=JSON.parse(xhr.response);
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
			}
		}
		xhr.send('{"id":1,"method":"call","jsonrpc":"2.0","params":["database_api","get_dynamic_global_properties",[]]}');
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
		ext_browser.browserAction.setIcon({path:"images/icon128.png"});
		if(''==current_user){
			ext_browser.browserAction.setBadgeBackgroundColor({color:"rgba(187,0,0,0.4)"});
		}
		else{
			ext_browser.browserAction.setBadgeBackgroundColor({color:"rgba(32,160,0,0.4)"});
		}
	};
	let not_found=function(){
		ext_browser.browserAction.setIcon({path:"images/gray128.png"});
		ext_browser.browserAction.setBadgeBackgroundColor({color:"rgba(136,136,136,0.4)"});
	}
	ext_browser.tabs.get(tab_id,function(tab){
		if(ext_browser.runtime.lastError){
			console.log(ext_browser.runtime.lastError.message);
		}
		else{
			if(tab.id>0){
				ext_browser.tabs.executeScript(tab.id,{file:js_framework},function(){
					if(ext_browser.runtime.lastError){
						console.log(ext_browser.runtime.lastError.message);
						not_found();
					}
					else{
						ext_browser.tabs.executeScript(tab.id,{file:'gates/'+domain+'.js'},function(){
							if(ext_browser.runtime.lastError){
								console.log(ext_browser.runtime.lastError.message);
								if(subdomain!=domain){
									ext_browser.tabs.executeScript(tab.id,{file:'subgates/'+subdomain+'.js'},function(){
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
				ext_browser.tabs.executeScript(tab.id,{file:js_contentscript},function(){
					if(ext_browser.runtime.lastError){
						console.log('contentscript NOT injected');
					}
					else{
						console.log('contentscript injected');
					}
				});
			}
		}
	});
}

update_version(function(){
	load_state('',function(encode_status){
		console.log('main init load_state',encode_status,state);
		main_app();
	});
});

function main_app(){
	select_best_gate();
	ext_browser.browserAction.setIcon({path:"images/gray128.png"});
	ext_browser.browserAction.setBadgeBackgroundColor({color:"rgba(136,136,136,0.4)"});
	ext_browser.browserAction.setBadgeText({text:"..."});
	ext_browser.alarms.create('viz_timer',{when:Date.now()+1});

	ext_browser.runtime.onMessage.addListener(function(request,sender,sendResponse){
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
							let operation_error=false;
							if(!err){
								let encoded_memo=request.memo;
								let recipient_memo=account_response.memo_key;
								if(request.force_memo_encoding){
									if('VIZ1111111111111111111111111111111114T1Anm'==recipient_memo){
										operation_error='recipient_memo_error';
									}
									else{
										try{
											encoded_memo=viz.memo.encode(account.memo_key,recipient_memo,'#'+request.memo);
										}
										catch(e){
											operation_error='encrypt_memo_error';
										}
									}
								}
								if(false===operation_error){
									viz.broadcast.award(account.regular_key,current_user,request.receiver,parseInt(request.energy),parseInt(request.custom_sequence),encoded_memo,request.beneficiaries,function(e,r){
										console.log(e);
										response_error=(!!e);
										if(!response_error){
											response_result={approximate_amount};
										}
										let response={'error':response_error,'result':response_result}
										sendResponse(response);
										if(!e){//manual update account energy
											current_energy-=parseInt(request.energy);
											localStorage['current_energy']=current_energy;

											let new_energy=current_energy;
											ext_browser.browserAction.setBadgeText({text:''+parseInt(parseFloat(new_energy)/100)+'%'});
										}
									});
								}
							}
							else{
								operation_error='default_recipient_error';
							}
							if(false!==operation_error){
								let response={'error':operation_error,'result':response_result}
								sendResponse(response);
							}
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
							let operation_error=false;
							if(!err){
								let encoded_memo=request.memo;
								let recipient_memo=account_response.memo_key;
								if(request.force_memo_encoding){
									if('VIZ1111111111111111111111111111111114T1Anm'==recipient_memo){
										operation_error='recipient_memo_error';
									}
									else{
										try{
											encoded_memo=viz.memo.encode(account.memo_key,recipient_memo,'#'+request.memo);
										}
										catch(e){
											operation_error='encrypt_memo_error';
										}
									}
								}
								if(false===operation_error){
									viz.broadcast.fixedAward(account.regular_key,current_user,request.receiver,request.reward_amount,parseInt(request.max_energy),parseInt(request.custom_sequence),encoded_memo,request.beneficiaries,function(e,r){
										console.log(e);
										response_error=(!!e);
										if(!response_error){
											response_result={approximate_amount};
										}
										let response={'error':response_error,'result':response_result}
										sendResponse(response);
										if(!e){//manual update account energy
											current_energy-=parseInt(approximate_energy);
											localStorage['current_energy']=current_energy;

											let new_energy=current_energy;
											ext_browser.browserAction.setBadgeText({text:''+parseInt(parseFloat(new_energy)/100)+'%'});
										}
									});
								}
							}
							else{
								operation_error='default_recipient_error';
							}
							if(false!==operation_error){
								let response={'error':operation_error,'result':response_result}
								sendResponse(response);
							}
						});
					}
					if('transfer'==request.operation){
						viz.api.getAccount(request.to,'',function(err,account_response){
							let operation_error=false;
							if(!err){
								let encoded_memo=request.memo;
								let recipient_memo=account_response.memo_key;
								if(request.force_memo_encoding){
									if('VIZ1111111111111111111111111111111114T1Anm'==recipient_memo){
										operation_error='recipient_memo_error';
									}
									else{
										try{
											encoded_memo=viz.memo.encode(account.memo_key,recipient_memo,'#'+request.memo);
										}
										catch(e){
											operation_error='encrypt_memo_error';
										}
									}
								}
								if(false===operation_error){
									viz.broadcast.transfer(account.active_key,current_user,request.to,request.amount,encoded_memo,function(e,r){
										console.log(e);
										response_error=(!!e);
										if(!response_error){
											response_result={};
										}
										let response={'error':response_error,'result':response_result}
										sendResponse(response);
										if(!e){//manual update account energy
											current_balance=parseFloat(current_balance)-parseFloat(request.amount).toFixed(3);
											localStorage['current_balance']=current_balance;
										}
									});
								}
							}
							else{
								operation_error='default_recipient_error';
							}
							if(false!==operation_error){
								let response={'error':operation_error,'result':response_result}
								sendResponse(response);
							}
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
						let decoded_memo='';
						let error=false;
						if(''==users[current_user].memo_key){
							error=true;
						}
						else{
							try{
								decoded_memo=viz.memo.decode(users[current_user].memo_key,request.memo);
							}
							catch(e){
								error=true;
							}
						}
						sendResponse({'error':error,'result':decoded_memo});
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
									let signed_tx=viz.auth.signTransaction(prepaired_tx,[account.regular_key]);
									viz.api.broadcastTransactionSynchronous(signed_tx,function(e,r){
										console.log(e);
										response_error=(!!e);
										if(!response_error){
											response_result=r;//id:string:tx hash, block_num:int, trx_num:int, expired:bool
										}
										let response={'error':response_error,'result':response_result}
										sendResponse(response);
										if(!e){//manual update account
											ext_browser.alarms.create('viz_timer',{when:Date.now()+5});
										}
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
	});

	ext_browser.tabs.onActivated.addListener(function(active_info){
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

		ext_browser.browserAction.setBadgeText({text:'?'});
		ext_browser.tabs.query({active:true},function(tabs){
			let tab=tabs[0];
			check_viz_url(tab.id,tab.url);
		});
		ext_browser.alarms.create('viz_timer',{when:Date.now()+1});
	});

	ext_browser.runtime.onSuspend.addListener(function(){
		console.log('onSuspend');
		ext_browser.browserAction.setBadgeBackgroundColor({color:"rgba(136,136,136,0.4)"});
	});

	ext_browser.runtime.onStartup.addListener(function(){
		console.log('onStartup');
		ext_browser.browserAction.setBadgeText({text:""});
		ext_browser.tabs.query({active:true},function(tabs){
			let tab=tabs[0];
			check_viz_url(tab.id,tab.url);
		});
		ext_browser.alarms.create('viz_timer',{when:Date.now()+1});
	});

	ext_browser.alarms.onAlarm.addListener(function(alarm){
		if('viz_timer'==alarm.name){
			viz_timer();
		}
	});
}