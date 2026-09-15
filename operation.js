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
var current_user='';
/* Потолок показа данных sign_data: страница может прислать мегабайты, а в innerHTML
   такое класть незачем. Обрезка ниже потолка НЕ молчаливая — счётчик символов виден. */
var SIGN_DATA_VIEW_LIMIT=20000;
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
var current_balance='0.000';

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

//Живая энергия аккаунта есть только у background. localStorage-полифилл наполняется
//АСИНХРОННО из chrome.storage.local, поэтому на момент отрисовки слайдера кэш обычно ещё
//пуст: лимит выходил 0, слайдер серый, выбрать нечего. Спрашиваем background напрямую,
//как это уже делает popup.js; кэш остаётся фолбэком, если ответа нет.
function load_account_energy(callback){
	let done=false;
	let finish=function(){
		if(done){return;}
		done=true;
		callback();
	};
	try{
		ext_browser.runtime.sendMessage({get_account_info:true},function(info){
			if(info && typeof info.current_energy !== 'undefined'){
				current_energy=info.current_energy;
			}
			if(info && typeof info.current_balance !== 'undefined'){
				current_balance=info.current_balance;
			}
			finish();
		});
	}
	catch(e){
		finish();
	}
}

function get_state(callback){
	if(typeof callback === 'undefined'){callback=function(){};}
	ext_browser.runtime.sendMessage({get_state:true},function(response){
		console.log('get_state response',response);
		if(null===response){
			return;
		}
		if(false!==response.decoded){
			state=response.state;
			users=state.users;
			current_user=state.current_user;
			if(typeof users !== 'undefined'){
				if(typeof users[current_user] !== 'undefined'){
					account=users[current_user];
				}
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
			ltmp_arr=ltmp_lang_arr(settings.lang);

			if(typeof localStorage['current_energy'] !== 'undefined'){
				current_energy=localStorage['current_energy'];
			}
			load_account_energy(function(){
				callback(true);
			});
		}
		else{
			if(typeof localStorage['lang'] !== 'undefined'){
				settings.lang=localStorage['lang'];
			}
			ltmp_arr=ltmp_lang_arr(settings.lang);
			if(typeof localStorage['dark'] !== 'undefined'){
				settings.dark=localStorage['dark'];
				if(typeof settings.dark == 'string'){
					if('false'==settings.dark){
						settings.dark=false;
					}
					else{
						settings.dark=true;
					}
				}
			}
			callback(false);
		}
	});
}

var action={};
var energy=100;//default
var options=function(){
	if(ext_browser.runtime.openOptionsPage){
		ext_browser.runtime.openOptionsPage();
	}
	else{
		window.open(ext_browser.runtime.getURL('options.html'));
	}
	window.close();
}

var unlock_action=function(){
	let password=$('.decode_password').val();
	if(''!=password){
		$('.decode_password').removeClass('error');
		ext_browser.runtime.sendMessage({encode_state:true,password:password},function(response){
			console.log('unlock_action response',response);
			if(null===response){
				return;
			}
			get_state(function(status){
				console.log('get_state return',status);

				if(settings.dark){
					$('body').addClass('dark');
				}
				else{
					$('body').removeClass('dark');
				}

				if(status){
					easter_egg();
					main_app();
				}
				else{
					$('.decode_password').addClass('error');
				}
				resize_app();
			});
		});
	}
}

var need_encode=function(){
	if(turbo_cat){
		$('.logo img').attr('src','/images/turbo-cat/password.png');
		resize_app();
	}
	let result='';
	result+='<p class="red">'+ltmp_arr.need_encode_state+'<p>';
	result+='<hr>'+ltmp(ltmp_arr.unlock_form,{icon:ltmp_icons.icon_unlock});
	$('.info').html(result);
	$('.action').html('');

	$('.unlock-action').off('click',unlock_action);
	$('.unlock-action').on('click',unlock_action);
	$('.decode_password').off('keypress');
	$('.decode_password').on('keypress',function(e){
		if(e.keyCode == 13){
			let event=document.createEvent('MouseEvents');
			event.initEvent('click',true,true);
			$('.unlock-action')[0].dispatchEvent(event);
		}
	});
}

var need_configure=function(){
	let result='';
	result+='<hr>';
	result+='<a class="options" href="#">'+ltmp_arr.configure_account+'</a>';
	$('.info').html(result);
	$('.options').off('click');
	$('.options').on('click',options);
}

var assigned_account=function(){
	let result='';
	result+='<hr>';
	result+='<span class="current-account">'+ltmp_arr.used_account+': <b>'+current_user+'</b></span>';
	$('.info').html(result);
}

function escape_html(text) {
	var map = {
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#039;'
	};
	return text.replace(/[&<>"']/g,function(m){return map[m];});
}

function select_energy_view(selected){
	selected=typeof selected!=='undefined'?selected:false;
	let result='';
	let min=parseInt($('.select_energy').attr('data-min'));
	let default_value=parseInt($('.select_energy').attr('data-default'));
	let max=parseInt($('.select_energy').attr('data-max'));
	let step=parseInt($('.select_energy').attr('data-step'));
	let limit=parseInt($('.select_energy').attr('data-limit'));
	if(!selected){
		if(default_value>max){
			default_value=max;
		}
	}
	for(let i=min;i<=max;i+=step){
		let i_class='energy_active';
		if(i>limit){
			i_class='energy_inactive';
		}
		result+='<div class="'+i_class+'" rel="'+i+'"></div>';
	}
	if(!selected){
		$('.select_energy').html(result);
		$('.energy_active').off('click');
		$('.energy_active').on('click',function(){
			$('.energy_active').removeClass('selected');
			energy=$(this).attr('rel');
			for(let j=min;j<=energy;j+=step){
				$('.energy_active[rel="'+j+'"]').addClass('selected');
			}
			$('.spend_energy').html((energy/100)+'%');
		});
		$('.energy_inactive').off('click');
		$('.energy_inactive').on('click',function(){
			$('.energy_active').removeClass('selected');
			energy=limit;
			for(let j=min;j<=energy;j+=step){
				$('.energy_active[rel="'+j+'"]').addClass('selected');
			}
			$('.spend_energy').html((energy/100)+'%');
		});
		var event=document.createEvent('MouseEvents');
		event.initEvent('click',true,true);
		if(default_value>limit){
			$('.energy_inactive[rel="'+default_value+'"]')[0].dispatchEvent(event);
		}
		else{
			$('.energy_active[rel="'+default_value+'"]')[0].dispatchEvent(event);
		}
	}
	else{
		$('.select_energy').remove();
		energy=default_value;
		$('.spend_energy').html((default_value/100)+'%');
	}
}

function refuse_action(){
	action.inpage_action=true;
	action.refuse=true;
	action.approve=false;

	ext_browser.runtime.sendMessage(action,function(response){
		console.log('refuse_action response',response);
		if(null===response){
			return;
		}
		if(response){
			action_executed=true;
			window.close();
		}
	});
}

var action_executed=false;
window.onbeforeunload=function(){
	if(!action_executed){
		refuse_action();
	}
}

//Разбор суммы перевода повторяет popup.js: чистим ввод, запятую считаем десятичным
//разделителем, второй разделитель и ноль отвергаем, сверяем с балансом. Возвращает
//строку "N.NNN VIZ" либо false. show_error=false — тихая проверка (для живого ввода).
function check_transfer_amount(show_error){
	let field=$('.amount_input');
	if(0==field.length){
		return false;
	}
	let error_box=$('.amount_error');
	let fail=function(message){
		field.addClass('error');
		field.attr('aria-invalid','true');
		if(show_error){
			error_box.html(message);
		}
		return false;
	};
	let raw=(''+field.val()).trim().replace(/[^0-9\,\.]/g,'');
	field.val(raw);
	field.removeClass('error');
	field.attr('aria-invalid','false');
	error_box.html('');
	if(''==raw){
		return show_error?fail(ltmp_arr.default_check_amount):false;
	}
	if(-1==raw.indexOf('.')){
		if(2<raw.split(',').length){
			return fail(ltmp_arr.default_check_amount);
		}
		raw=raw.split(',').join('.');
	}
	else{
		raw=raw.split(',').join('');
	}
	if(2<raw.split('.').length){
		return fail(ltmp_arr.default_check_amount);
	}
	let value=parseFloat(raw);
	if(isNaN(value) || value<=0){
		return fail(ltmp_arr.default_check_amount);
	}
	if(value>parseFloat(current_balance)){
		return fail(ltmp_arr.default_insufficient_funds);
	}
	return ''+value.toFixed(3)+' VIZ';
}

function bind_amount_input(){
	let field=$('.amount_input');
	if(0==field.length){
		return;
	}
	field.off('input');
	field.on('input',function(){
		check_transfer_amount(false);
	});
	field.off('keydown');
	field.on('keydown',function(e){
		if(13==e.keyCode){
			$('.approve-action').click();
		}
	});
	focus_amount_input();
}

//cash.js (в отличие от jQuery) метода .focus() не имеет — фокусируем сам узел.
function focus_amount_input(){
	let node=$('.amount_input')[0];
	if(node){
		node.focus();
	}
}

//Опциональное шифрование memo: статусная строка следует за галочкой вживую, иначе юзер
//снял бы галочку и не увидел, что теперь пишет "НЕ будет зашифрована".
function bind_encode_memo_input(){
	let field=$('.encode_memo_input');
	if(0==field.length){
		return;
	}
	let update=function(){
		let status=$('.encode_memo_status');
		if(field.prop('checked')){
			status.removeClass('warn');
			status.html(ltmp_arr.encode_memo_yes);
		}
		else{
			status.addClass('warn');
			status.html(ltmp_arr.encode_memo_no);
		}
	};
	field.off('change');
	field.on('change',update);
	update();
}

function bind_actions(){
	$('.refuse-action').off('click');
	$('.refuse-action').on('click',function(){
		if(!$('.refuse-action').hasClass('disabled')){
			$('.approve-action').addClass('disabled');
			$('.refuse-action').addClass('disabled');

			if($('.trust input[name="save"]').prop("checked")){
				action.save=true;
			}

			refuse_action();
		}
	});
	$('.approve-action').off('click');
	$('.approve-action').on('click',function(){
		if(!$('.approve-action').hasClass('disabled')){
			$('.approve-action').addClass('disabled');
			$('.refuse-action').addClass('disabled');
			action.inpage_action=true;
			action.approve=true;
			action.refuse=false;

			if('award'==action.operation){
				action.energy=energy;
			}

			if($('.amount_input').length>0){
				//Сумму ввёл пользователь: не одобряем, пока она не валидна.
				let checked_amount=check_transfer_amount(true);
				if(false===checked_amount){
					$('.approve-action').removeClass('disabled');
					$('.refuse-action').removeClass('disabled');
					focus_amount_input();
					return;
				}
				action.amount=checked_amount;
			}

			if($('.encode_memo_input').length>0){
				//Опциональное шифрование: решение принял пользователь в этом окне,
				//а не сайт (сайт только разрешил выбор через optional_memo_encoding).
				action.encrypt_memo=$('.encode_memo_input').prop('checked');
			}

			if($('.trust input[name="save"]').prop("checked")){
				action.save=true;
			}

			ext_browser.runtime.sendMessage(action,function(response){
				console.log('.approve-action response',response);
				if(null===response){
					return;
				}
				if(response){
					action_executed=true;
					window.close();
				}
			});
		}
	});
}

// Shared by award/fixed_award/transfer. Two things the user must always be able to see
// without scrolling the window wider: the memo text itself (capped height, not inline —
// a long dApp-generated memo, like a hash from hub.viz.world, otherwise stretches the
// fixed-width confirmation window) and whether it leaves encrypted or in the clear. The
// encoding line used to appear ONLY when force_memo_encoding was true, so a plain transfer
// (the common case) said nothing at all — the user had no way to tell it goes in plaintext.
//
// optional_memo_encoding: the site leaves the choice to the user instead of forcing it
// either way. Shown ONLY when encryption is actually possible (the signing account has a
// memo key, account.memo) — offering a checkbox that can never do anything would be worse
// than no checkbox. Defaults to checked (encrypt), matching "encrypt unless told otherwise".
function render_memo_block(memo,force_memo_encoding,optional_memo_encoding){
	if(''==memo){
		return '';
	}
	let result='<p>'+ltmp_arr.memo_caption+':</p><span class="gray monospace limit-height">'+escape_html(memo)+'</span>';
	if(force_memo_encoding){
		result+='<p>'+ltmp_arr.encode_memo_yes+'</p>';
	}
	else if(optional_memo_encoding && account.memo){
		result+='<p><label class="unselectable"><input type="checkbox" class="encode_memo_input" checked> &mdash; '+ltmp_arr.award_form_encode_memo+'</label></p>';
		result+='<p class="encode_memo_status">'+ltmp_arr.encode_memo_yes+'</p>';
	}
	else{
		result+='<p class="warn">'+ltmp_arr.encode_memo_no+'</p>';
	}
	return result;
}

function action_info(){
	let hash=window.location.hash.substring(1);
	if(''!=hash){
		hash=decodeURI(hash);
		action=JSON.parse(hash);
		action.origin=escape_html(action.origin);
		console.log(action);

		let operation_str=escape_html(action.operation);
		operation_str=operation_str.substring(0,1).toUpperCase()+operation_str.substring(1);
		if('transfer'==action.operation){
			operation_str=ltmp_arr.operations_caption.transfer;
		}
		if('transfer_to_vesting'==action.operation){
			operation_str=ltmp_arr.operations_caption.transfer_to_vesting;
		}
		if('withdraw_vesting'==action.operation){
			operation_str=ltmp_arr.operations_caption.withdraw_vesting;
		}
		if('delegate_vesting_shares'==action.operation){
			operation_str=ltmp_arr.operations_caption.delegate_vesting_shares;
			if('0.000000 SHARES'==action.vesting_shares){
				operation_str=ltmp_arr.operations_caption.undelegate_vesting_shares;
			}
		}
		if('committee_vote_request'==action.operation){
			operation_str=ltmp_arr.operations_caption.committee_vote_request;
		}
		if('custom'==action.operation){
			operation_str=ltmp_arr.operations_caption.custom;
			if('regular'!=action.auth){
				action.auth='active';
			}
		}
		if('get_custom_account'==action.operation){
			operation_str=ltmp_arr.operations_caption.get_custom_account;
			if(false===action.account){
				action.account='';
			}
			if(''==action.account){
				operation_str=ltmp_arr.operations_caption.get_custom_current_account;
			}
		}
		if('get_account'==action.operation){
			operation_str=ltmp_arr.operations_caption.get_account;
		}
		if('get_settings'==action.operation){
			operation_str=ltmp_arr.operations_caption.get_settings;
		}
		if('get_accounts'==action.operation){
			operation_str=ltmp_arr.operations_caption.get_accounts;
		}
		if('switch_account'==action.operation){
			operation_str=ltmp_arr.operations_caption.switch_account;
		}
		if('import_account'==action.operation){
			operation_str=ltmp_arr.operations_caption.import_account;
		}
		if('account_metadata'==action.operation){
			operation_str=ltmp_arr.operations_caption.account_metadata;
		}
		if('get_account_history'==action.operation){
			operation_str=ltmp_arr.operations_caption.get_account_history;
			if(false===action.account){
				action.account='';
			}
			if(''==action.account){
				operation_str=ltmp_arr.operations_caption.get_current_account_history;
			}
		}
		if('get_accounts_on_sale'==action.operation){
			operation_str=ltmp_arr.operations_caption.get_accounts_on_sale;
		}
		if('get_subaccounts_on_sale'==action.operation){
			operation_str=ltmp_arr.operations_caption.get_subaccounts_on_sale;
		}
		if('passwordless_auth'==action.operation){
			operation_str=ltmp_arr.operations_caption.passwordless_auth;
		}
		if('sign_data'==action.operation){
			operation_str=ltmp_arr.operations_caption.sign_data;
		}
		if('encrypt'==action.operation){
			operation_str=ltmp_arr.operations_caption.encrypt;
		}
		if('decrypt'==action.operation){
			operation_str=ltmp_arr.operations_caption.decrypt;
		}
		if(typeof VIZ_PM_OPS !== 'undefined' && typeof VIZ_PM_OPS.ops[action.operation] !== 'undefined'){
			if(typeof ltmp_arr.operations_caption[action.operation] !== 'undefined'){
				operation_str=ltmp_arr.operations_caption[action.operation];
			}
		}

		let result='';
		if('award'==action.operation){
			result+='<p class="caption">'+operation_str+' '+escape_html(action.receiver)+'</p>';
			result+=render_memo_block(action.memo,action.force_memo_encoding,action.optional_memo_encoding);
			if(action.custom_sequence>0){
				result+='<p class="gray">'+ltmp_arr.sequence_caption+': '+parseInt(action.custom_sequence)+'</p>';
			}
			if(action.beneficiaries.length>0){
				result+='<p>'+ltmp_arr.beneficiaries_caption+':</p><span class="gray monospace limit-height">'+escape_html(JSON.stringify(action.beneficiaries))+'</span>';
			}
			result+='<p class="orange">'+ltmp_arr.origin_caption+': '+action.origin+'</p>';
			result+='<p class="blue">'+ltmp_arr.spend_energy_caption+': <span class="spend_energy">&hellip;</span></p>';
			let set_energy=settings.award_energy;
			if(typeof action.energy !== 'undefined'){
				if(false!=action.energy){
					set_energy=action.energy;
				}
				if(isNaN(action.energy)){
					set_energy=action.energy;
				}
			}
			result+='<p><div class="select_energy" data-min="'+settings.energy_step+'" data-default="'+set_energy+'" data-step="'+settings.energy_step+'" data-max="'+(Math.min(settings.energy_step*100,10000))+'" data-limit="'+current_energy+'"></div></p>';
			result+='</div>';
		}
		if('fixed_award'==action.operation){
			result+='<p class="caption">'+operation_str+' '+escape_html(action.receiver)+'</p>';
			result+=render_memo_block(action.memo,action.force_memo_encoding,action.optional_memo_encoding);
			if(action.custom_sequence>0){
				result+='<p class="gray">'+ltmp_arr.sequence_caption+': '+parseInt(action.custom_sequence)+'</p>';
			}
			if(action.beneficiaries.length>0){
				result+='<p>'+ltmp_arr.beneficiaries_caption+':</p><span class="gray monospace limit-height">'+escape_html(JSON.stringify(action.beneficiaries))+'</span>';
			}
			result+='<p class="orange">'+ltmp_arr.origin_caption+': '+action.origin+'</p>';
			result+='<p class="blue">'+ltmp_arr.max_energy_caption+': <span class="spend_energy">'+action.max_energy+'</span></p>';
			result+='<p class="blue">'+ltmp_arr.reward_amount_caption+': <span class="">'+escape_html(action.reward_amount.replace('VIZ','Ƶ'))+'</span></p>';
			result+='</div>';
		}
		if('transfer'==action.operation){
			result+='<p class="caption">'+operation_str+' '+escape_html(action.to)+'</p>';
			result+=render_memo_block(action.memo,action.force_memo_encoding,action.optional_memo_encoding);
			result+='<p class="orange">'+ltmp_arr.origin_caption+': '+action.origin+'</p>';
			if(false===action.amount || ''===action.amount){
				//Страница не назвала сумму — пользователь вводит её сам.
				result+='<p class="blue">'+ltmp_arr.amount_caption+':</p>';
				result+='<p><input type="text" class="amount_input" name="transfer-amount" autocomplete="off" inputmode="decimal" placeholder="0.000 Ƶ" aria-label="'+ltmp_arr.amount_caption+'" aria-describedby="transfer-amount-balance transfer-amount-error"></p>';
				result+='<p class="gray amount_balance" id="transfer-amount-balance">'+ltmp_arr.balance_caption+': '+escape_html(current_balance)+' Ƶ</p>';
				result+='<p class="red amount_error" id="transfer-amount-error" role="alert" aria-live="assertive"></p>';
			}
			else{
				result+='<p class="blue">'+ltmp_arr.amount_caption+': <span class="">'+escape_html(action.amount.replace('VIZ','Ƶ'))+'</span></p>';
			}
			result+='</div>';
		}
		if('transfer_to_vesting'==action.operation){
			result+='<p class="caption">'+operation_str+' '+escape_html(action.to)+'</p>';
			result+='<p class="orange">'+ltmp_arr.origin_caption+': '+action.origin+'</p>';
			result+='<p class="blue">'+ltmp_arr.amount_caption+': <span class="">'+escape_html(action.amount.replace('VIZ','Ƶ'))+'</span></p>';
			result+='</div>';
		}
		if('withdraw_vesting'==action.operation){
			result+='<p class="caption">'+operation_str+' '+current_user+'</p>';
			result+='<p class="orange">'+ltmp_arr.origin_caption+': '+action.origin+'</p>';
			result+='<p class="blue">'+ltmp_arr.amount_caption+': <span class="">'+escape_html(action.vesting_shares.replace('SHARES','Ƶ'))+'</span></p>';
			result+='</div>';
		}
		if('delegate_vesting_shares'==action.operation){
			result+='<p class="caption">'+operation_str+' '+escape_html(action.delegatee)+'</p>';
			result+='<p class="orange">'+ltmp_arr.origin_caption+': '+action.origin+'</p>';
			if('0.000000 SHARES'!=action.vesting_shares){
				result+='<p class="blue">'+ltmp_arr.amount_caption+': <span class="">'+escape_html(action.vesting_shares.replace('SHARES','Ƶ'))+'</span></p>';
			}
			result+='</div>';
		}
		if('committee_vote_request'==action.operation){
			result+='<p class="caption">'+operation_str+' #'+escape_html(''+action.request_id)+'</p>';
			result+='<p class="orange">'+ltmp_arr.origin_caption+': '+action.origin+'</p>';
			result+='<p class="blue">'+ltmp_arr.vote_percent_caption+': <span class="">'+escape_html(''+(action.vote_percent/100))+'%</span></p>';
			result+='</div>';
		}
		if('custom'==action.operation){
			result+='<p class="caption">'+operation_str+' '+current_user+'</p>';
			result+='<p class="orange">'+ltmp_arr.origin_caption+': '+action.origin+'</p>';
			result+='<p class="blue">'+ltmp_arr.authority_caption+': <span class="'+('active'==action.authority?'red':'')+'">'+escape_html(action.authority)+'</span></p>';
			result+='<p>'+ltmp_arr.protocol_caption+': <span class="">'+escape_html(action.protocol_id)+'</span></p>';
			result+='<p>'+ltmp_arr.json_caption+':<br><span class="gray monospace limit-height">'+escape_html(action.json)+'</span></p>';
			result+='</div>';
		}
		if('account_metadata'==action.operation){
			result+='<p class="caption">'+operation_str+' '+current_user+'</p>';
			result+='<p class="orange">'+ltmp_arr.origin_caption+': '+action.origin+'</p>';
			result+='<p>'+ltmp_arr.json_caption+':<br><span class="gray monospace limit-height">'+escape_html(action.json)+'</span></p>';
			result+='</div>';
		}
		if('get_custom_account'==action.operation){
			result+='<p class="caption">'+operation_str+' '+escape_html(action.account?action.account:'')+'</p>';
			result+='<p class="orange">'+ltmp_arr.origin_caption+': '+action.origin+'</p>';
			if(action.protocol_id){
				result+='<p>'+ltmp_arr.protocol_caption+': <span class="">'+escape_html(action.protocol_id)+'</span></p>';
			}
			result+='</div>';
		}
		if('get_account'==action.operation){
			result+='<p class="caption">'+operation_str+'</p>';
			result+='<p class="orange">'+ltmp_arr.origin_caption+': '+action.origin+'</p>';
			result+='</div>';
		}
		if('get_settings'==action.operation){
			result+='<p class="caption">'+operation_str+'</p>';
			result+='<p class="orange">'+ltmp_arr.origin_caption+': '+action.origin+'</p>';
			result+='</div>';
		}
		if('get_accounts'==action.operation){
			result+='<p class="caption">'+operation_str+'</p>';
			result+='<p class="orange">'+ltmp_arr.origin_caption+': '+action.origin+'</p>';
			result+='<p class="gray">'+ltmp_arr.accounts_no_keys_caption+'</p>';
			result+='</div>';
		}
		if('switch_account'==action.operation){
			/* Смена аккаунта: пользователь видит и текущий, и запрошенный — окно
			   единственное место, где это решение принимается. */
			result+='<p class="caption">'+operation_str+'</p>';
			result+='<p class="orange">'+ltmp_arr.origin_caption+': '+action.origin+'</p>';
			result+='<p class="gray">'+ltmp_arr.current_account_caption+': <span class="monospace">'+escape_html(current_user)+'</span></p>';
			result+='<p class="blue">'+ltmp_arr.switch_account_target_caption+': <span class="">'+escape_html(action.account?action.account:'')+'</span></p>';
			result+='</div>';
		}
		if('import_account'==action.operation){
			result+='<p class="caption">'+operation_str+' '+escape_html(action.account?action.account:'')+'</p>';
			result+='<p class="orange">'+ltmp_arr.origin_caption+': '+action.origin+'</p>';
			if(typeof action.regular_key !== 'undefined'){
				if(false!==action.regular_key){
					result+='<p class="blue">'+ltmp_arr.form_regular_key_short+'</p>';
				}
			}
			if(typeof action.active_key !== 'undefined'){
				if(false!==action.active_key){
					result+='<p class="blue">'+ltmp_arr.form_active_key_short+'</p>';
				}
			}
			if(typeof action.memo_key !== 'undefined'){
				if(false!==action.memo_key){
					result+='<p class="blue">'+ltmp_arr.form_memo_key_short+'</p>';
				}
			}
			result+='</div>';
		}
		if('get_account_history'==action.operation){
			result+='<p class="caption">'+operation_str+' '+escape_html(action.account?action.account:'')+'</p>';
			result+='<p class="orange">'+ltmp_arr.origin_caption+': '+action.origin+'</p>';
			result+='</div>';
		}
		if('get_accounts_on_sale'==action.operation){
			result+='<p class="caption">'+operation_str+'</p>';
			result+='<p class="orange">'+ltmp_arr.origin_caption+': '+action.origin+'</p>';
			result+='<p class="blue">'+ltmp_arr.from_caption+': <span class="">'+escape_html(''+action.from)+'</span></p>';
			result+='<p class="blue">'+ltmp_arr.limit_caption+': <span class="">'+escape_html(''+action.limit)+'</span></p>';
			result+='</div>';
		}
		if('get_subaccounts_on_sale'==action.operation){
			result+='<p class="caption">'+operation_str+'</p>';
			result+='<p class="orange">'+ltmp_arr.origin_caption+': '+action.origin+'</p>';
			result+='<p class="blue">'+ltmp_arr.from_caption+': <span class="">'+escape_html(''+action.from)+'</span></p>';
			result+='<p class="blue">'+ltmp_arr.limit_caption+': <span class="">'+escape_html(''+action.limit)+'</span></p>';
			result+='</div>';
		}
		if('passwordless_auth'==action.operation){
			/* Подпись выдаётся «за домен»: показываем и домен, за который просят
			   подпись, и аккаунт, чьим ключом она будет сделана. Для viz://-имени
			   это единственное место, где пользователь его вообще увидит. */
			result+='<p class="caption">'+operation_str+'</p>';
			result+='<p class="orange">'+ltmp_arr.origin_caption+': '+action.origin+'</p>';
			result+='<p class="blue">'+ltmp_arr.auth_domain_caption+': <span class="monospace">'+escape_html(action.domain?action.domain:action.origin)+'</span></p>';
			result+='<p>'+ltmp_arr.auth_account_caption+': <span class="monospace">'+escape_html(action.account?action.account:current_user)+'</span></p>';
			if(action.auth_main_domain){
				/* Поддомен подписывает за главный домен: строка уйдёт НЕ на тот хост,
				   где открыта страница, — пользователь обязан это заметить. */
				result+='<p class="warn">'+ltmp_arr.auth_main_domain_warning+'</p>';
			}
			if(action.authority){
				result+='<p>'+ltmp_arr.authority_caption+': <span class="'+('active'==action.authority?'red':'')+'">'+escape_html(action.authority)+'</span></p>';
			}
			result+='</div>';
		}
		if('sign_data'==action.operation){
			result+='<p class="caption">'+operation_str+'</p>';
			result+='<p class="orange">'+ltmp_arr.origin_caption+': '+action.origin+'</p>';
			if(action.authority){
				result+='<p>'+ltmp_arr.authority_caption+': <span class="'+('active'==action.authority?'red':'')+'">'+escape_html(action.authority)+'</span></p>';
			}
			if(action.data_to_sign){
				/* Данные подписи показываем ЦЕЛИКОМ: обрезка на 200 символах прятала то,
				   что юзер как раз и должен прочесть перед подписью. Блок скроллится по
				   вертикали (.limit-height), длинные строки без пробелов переносятся
				   (.monospace). Совсем гигантский вход всё же режем, но НЕ молча —
				   с явной подписью, сколько символов показано из скольких. */
				let data=String(action.data_to_sign);
				let display_data=data;
				let caption='Data ('+data.length+')';
				if(data.length>SIGN_DATA_VIEW_LIMIT){
					display_data=data.substring(0,SIGN_DATA_VIEW_LIMIT);
					caption='Data ('+SIGN_DATA_VIEW_LIMIT+' / '+data.length+')';
				}
				result+='<p>'+caption+':</p><span class="gray monospace limit-height">'+escape_html(display_data)+'</span>';
			}
			result+='</div>';
		}
		if('encrypt'==action.operation||'decrypt'==action.operation){
			/* memo-key encryption: show what is actually at stake — which key, whose
			   public key on the other side, and how much text goes through. Nothing is
			   broadcast, so there is no amount to highlight. */
			result+='<p class="caption">'+operation_str+'</p>';
			result+='<p class="orange">'+ltmp_arr.origin_caption+': '+action.origin+'</p>';
			result+='<p>'+ltmp_arr.authority_caption+': <span class="monospace">memo</span></p>';
			if('encrypt'==action.operation){
				result+='<p>'+ltmp_arr.memo_recipient_caption+':</p><span class="gray monospace limit-height">'+escape_html(String(action.to))+'</span>';
				let message=String(action.message||'');
				let preview=(message.length>200)?(message.substring(0,200)+'...'):message;
				result+='<p>'+ltmp_arr.memo_caption+' ('+message.length+'):</p><span class="gray monospace limit-height">'+escape_html(preview)+'</span>';
			}
			else{
				let items=action.items||[];
				result+='<p>'+ltmp_arr.memo_letters_caption+': '+items.length+'</p>';
				let senders=[];
				for(let i in items){
					if(senders.length<3&&senders.indexOf(items[i].from)<0){
						senders.push(items[i].from);
					}
				}
				result+='<span class="gray monospace limit-height">'+escape_html(senders.join('\n'))+(items.length>senders.length?'\n…':'')+'</span>';
			}
			result+='</div>';
		}
		if(typeof VIZ_PM_OPS !== 'undefined' && typeof VIZ_PM_OPS.ops[action.operation] !== 'undefined'){
			/* one generic view for every prediction-market operation: the fields are
			   listed from the shared table, so a new operation shows up here without
			   its own branch. Money fields are highlighted — they are what the user
			   actually risks by approving. */
			let pm_spec=VIZ_PM_OPS.ops[action.operation];
			let pm_params=action.pm_params?action.pm_params:{};
			result+='<p class="caption">'+operation_str+'</p>';
			result+='<p class="orange">'+ltmp_arr.origin_caption+': '+action.origin+'</p>';
			result+='<p class="gray">'+ltmp_arr.prediction_market_caption+': <span class="monospace">'+escape_html(action.operation)+'</span></p>';
			result+='<p>'+ltmp_arr.authority_caption+': <span class="'+('active'==pm_spec.authority?'red':'')+'">'+escape_html(pm_spec.authority)+'</span></p>';
			for(let pm_i=0;pm_i<pm_spec.fields.length;pm_i++){
				let pm_name=pm_spec.fields[pm_i][0];
				let pm_type=pm_spec.fields[pm_i][1];
				if(typeof pm_params[pm_name] === 'undefined' || null===pm_params[pm_name]){
					continue;
				}
				let pm_value=pm_params[pm_name];
				if('object'==typeof pm_value){
					pm_value=JSON.stringify(pm_value);
				}
				pm_value=escape_html(''+pm_value);
				if('asset'==pm_type){
					result+='<p class="blue">'+escape_html(pm_name)+': <span class="">'+pm_value.replace('VIZ','Ƶ').replace('SHARES','Ƶ')+'</span></p>';
				}
				else{
					result+='<p class="gray">'+escape_html(pm_name)+': <span class="monospace limit-height">'+pm_value+'</span></p>';
				}
			}
			result+='</div>';
		}

		/* Смену аккаунта не запоминаем: правило сайта не должно позволять ему молча
		   переключать кошелёк на другой аккаунт, поэтому галочку здесь не показываем. */
		if('switch_account'!=action.operation){
			result+='<div class="text-right trust"><label class="unselectable"><input type="checkbox" name="save"> &mdash; '+ltmp_arr.save_rule_caption+'</label></div>';
		}
		result+='<div class="text-right">';
		result+='<a role="button" tabindex="0" class="refuse-action button negative unselectable"><span class="icon"><img src="images/cross.svg" alt=""></span> '+ltmp_arr.refuse_caption+'</a>';
		result+='<a role="button" tabindex="0" class="approve-action button unselectable"><span class="icon"><img src="images/check.svg" alt=""></span> '+ltmp_arr.approve_caption+'</a>';
		$('.action').html(result);
		if('award'==action.operation){
			let selected_energy=false;
			if(typeof action.energy !== 'undefined'){
				if(false!==action.energy){
					selected_energy=true;
				}
			}
			select_energy_view(selected_energy);
		}
		bind_actions();
		bind_amount_input();
		bind_encode_memo_input();
	}
	else{
		$('.action').html(ltmp_arr.operation_error);
	}
}

function main_app(){
	if(settings.dark){
		$('body').addClass('dark');
	}
	else{
		$('body').removeClass('dark');
	}
	if(''==current_user){
		need_configure();
	}
	else{
		assigned_account();
	}
	action_info();
}

//window frame (title bar + borders) is measured, not guessed
function window_frame(){
	let frame={
		width:Math.max(0,window.outerWidth-window.innerWidth),
		height:Math.max(0,window.outerHeight-window.innerHeight),
	};
	if(0==frame.height){//not measurable yet, fall back to the old constant
		frame.height=ext_firefox?40:36;
	}
	return frame;
}

function resize_app(){
	if(!ext_browser||!ext_browser.windows||!ext_browser.windows.update){
		return;
	}
	//content is measured in CSS pixels and windows.update expects the same units,
	//so scaling by devicePixelRatio inflates the window on scaled displays
	let frame=window_frame();
	let content_width=Math.ceil(Math.max(document.body.offsetWidth,document.body.scrollWidth));
	let content_height=Math.ceil(Math.max(document.body.offsetHeight,document.body.scrollHeight));
	ext_browser.windows.update(ext_browser.windows.WINDOW_ID_CURRENT, {
		width: content_width+frame.width,
		height: content_height+frame.height,
	});
}

var turbo_cat=false;
var turbo_cat_images=[
	'upside.png',
	'glasses.png',
	'lets-start.png',
	'victory.png',
	'wink.png',
	'like.png',
];
function easter_egg(){
	let random=Math.random();
	if((random<0.1)||turbo_cat){//10%
		turbo_cat=true;
		let random_image=Math.floor(Math.random() * turbo_cat_images.length);
		$('.logo').addClass('easter-egg');
		$('.logo img').attr('src','/images/turbo-cat/'+turbo_cat_images[random_image]);
	}
}

$(function(){
	easter_egg();
	get_state(function(status){
		console.log('get_state return',status);

		if(settings.dark){
			$('body').addClass('dark');
		}
		else{
			$('body').removeClass('dark');
		}

		if(status){
			main_app();
		}
		else{
			need_encode();
		}
		resize_app();
	});
});