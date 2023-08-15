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
			ltmp_arr=window['ltmp_'+settings.lang+'_arr'];

			if(typeof localStorage['current_energy'] !== 'undefined'){
				current_energy=localStorage['current_energy'];
			}
			callback(true);
		}
		else{
			if(typeof localStorage['lang'] !== 'undefined'){
				settings.lang=localStorage['lang'];
			}
			ltmp_arr=window['ltmp_'+settings.lang+'_arr'];
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
		if('passwordless_auth'==action.operation){
			operation_str=ltmp_arr.operations_caption.passwordless_auth;
		}

		let result='';
		if('award'==action.operation){
			result+='<p class="caption">'+operation_str+' '+escape_html(action.receiver)+'</p>';
			if(''!=action.memo){
				result+='<p>'+ltmp_arr.memo_caption+':</p><span class="gray monospace limit-height">'+escape_html(action.memo)+'</span>';
				if(action.force_memo_encoding){
					if(account.memo){
						result+='<p>'+ltmp_arr.encode_memo_caption+': ✔️</p>';
					}
				}
			}
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
			if(''!=action.memo){
				result+='<p>'+ltmp_arr.memo_caption+':</p><span class="gray monospace limit-height">'+escape_html(action.memo)+'</span>';
				if(action.force_memo_encoding){
					if(account.memo){
						result+='<p>'+ltmp_arr.encode_memo_caption+': ✔️</p>';
					}
				}
			}
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
			if(''!=action.memo){
				result+='<p>'+ltmp_arr.memo_caption+': '+escape_html(action.memo)+'</p>';
				if(action.force_memo_encoding){
					if(account.memo){
						result+='<p>'+ltmp_arr.encode_memo_caption+': ✔️</p>';
					}
				}
			}
			result+='<p class="orange">'+ltmp_arr.origin_caption+': '+action.origin+'</p>';
			result+='<p class="blue">'+ltmp_arr.amount_caption+': <span class="">'+escape_html(action.amount.replace('VIZ','Ƶ'))+'</span></p>';
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
		if('get_account_history'==action.operation){
			result+='<p class="caption">'+operation_str+' '+escape_html(action.account?action.account:'')+'</p>';
			result+='<p class="orange">'+ltmp_arr.origin_caption+': '+action.origin+'</p>';
			result+='</div>';
		}
		if('passwordless_auth'==action.operation){
			result+='<p class="caption">'+operation_str+'</p>';
			result+='<p class="orange">'+ltmp_arr.origin_caption+': '+action.origin+'</p>';
			if(action.authority){
				result+='<p>'+ltmp_arr.authority_caption+': <span class="'+('active'==action.authority?'red':'')+'">'+escape_html(action.authority)+'</span></p>';
			}
			result+='</div>';
		}

		result+='<div class="text-right trust"><label class="unselectable"><input type="checkbox" name="save"> &mdash; '+ltmp_arr.save_rule_caption+'</label></div>';
		result+='<div class="text-right">';
		result+='<a class="refuse-action button negative unselectable"><span class="icon"><img src="images/cross.svg"></span> '+ltmp_arr.refuse_caption+'</a>';
		result+='<a class="approve-action button unselectable"><span class="icon"><img src="images/check.svg"></span> '+ltmp_arr.approve_caption+'</a>';
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

function is_retina(){
	return ((window.matchMedia && (window.matchMedia('only screen and (min-resolution: 192dpi), only screen and (min-resolution: 2dppx), only screen and (min-resolution: 75.6dpcm)').matches || window.matchMedia('only screen and (-webkit-min-device-pixel-ratio: 2), only screen and (-o-min-device-pixel-ratio: 2/1), only screen and (min--moz-device-pixel-ratio: 2), only screen and (min-device-pixel-ratio: 2)').matches)) || (window.devicePixelRatio && window.devicePixelRatio >= 2)) && /(Mac OS|iPad|iPhone|iPod)/g.test(navigator.userAgent);
}

function resize_app(){
	let fix=1;
	let fix_retina_width=0;
	let fix_retina_height=0;
	if(is_retina()){
		fix=0.5;
		fix_retina_width=-14;
		fix_retina_height=-10;
	}
	let height_addon=36;
	if(ext_firefox){
		height_addon=40;
	}
	ext_browser.windows.update(ext_browser.windows.WINDOW_ID_CURRENT, {
		width: parseInt(fix*window.devicePixelRatio*(document.body.clientWidth+16+fix_retina_width)),
		height: parseInt(fix*window.devicePixelRatio*(document.body.clientHeight+height_addon+fix_retina_height)),
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