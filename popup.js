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

var current_total_reward_fund=0;
var current_total_reward_shares=0;

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
				current_custom_sequence=parseInt(localStorage['current_custom_sequence']);
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

function save_state(callback){
	if(typeof callback === 'undefined'){callback=function(){};}

	state.users=users;
	state.current_user=current_user;
	state.settings=settings;
	state.rules=rules;

	console.log('save_state result',state);

	ext_browser.runtime.sendMessage({save_state:true,state:state},function(response){
		console.log('save_state response',response);
		if(null===response){
			return;
		}
		callback();
	});
}

var action_width=330+16;
var action_height=450+36;
var options=function(){
	if(ext_browser.runtime.openOptionsPage){
		ext_browser.runtime.openOptionsPage();
	}
	else{
		window.open(ext_browser.runtime.getURL('options.html'));
	}
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
			});
		});
	}
}

var lock_action=function(){
	ext_browser.runtime.sendMessage({encode_state:true,password:''},function(response){
		console.log('lock_action response',response);
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
				main_app();
			}
			else{
				need_encode();
			}
		});
	});
}

var need_encode=function(){
	clearTimeout(update_account_info_timer);
	if(turbo_cat){
		$('.logo img').attr('src','/images/turbo-cat/password.png');
	}
	$('.header-buttons').remove();
	$('.header-account').remove();
	$('.buttons').html('');
	let result='';
	result+=ltmp(ltmp_arr.unlock_form,{icon:ltmp_icons.icon_unlock});
	$('.info').html(result);
	$('input.decode_password')[0].focus();
	$('.tab').html('');
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
	clearTimeout(update_account_info_timer);
	$('.header-buttons').remove();
	$('.header-account').remove();
	$('.buttons').html('');
	$('.info').html('<a class="options red" href="#">'+ltmp_arr.configure_account+'</a>');
	$('.options').off('click',options);
	$('.options').on('click',options);
}

var close_modal_action=function(){
	$('.modal').remove();
	$('.shadow').removeClass('show');
	$('body').removeClass('expand');
};

var edit_account_action=function(){
	$('.modal .error').html('');
	$('.modal .edit-account-action').attr('disabled','disabled');
	let new_user=$('.modal .login').val();
	new_user=new_user.trim();
	if('@'==new_user.substring(0,1)){
		new_user=new_user.substring(1);
	}
	new_user=new_user.toLowerCase();

	let regular_valid=false;
	let memo_valid=false;
	let active_valid=false;

	let regular_key=$('.modal .regular_key').val();
	regular_key=regular_key.trim();

	let memo_key=$('.modal .memo_key').val();
	memo_key=memo_key.trim();

	let active_key=$('.modal .active_key').val();
	active_key=active_key.trim();


	if(''==regular_key){
		regular_valid=true;
	}
	else{
		regular_valid=viz.auth.isWif(regular_key);
	}
	if(''==memo_key){
		memo_valid=true;
	}
	else{
		memo_valid=viz.auth.isWif(memo_key);
	}
	if(''==active_key){
		active_valid=true;
	}
	else{
		active_valid=viz.auth.isWif(active_key);
	}

	if(regular_valid && memo_valid && active_valid){
		current_user=new_user;
		users[current_user]['regular_key']=regular_key;
		users[current_user]['memo_key']=memo_key;
		users[current_user]['active_key']=active_key;
		account=users[current_user];
		if(''!=account.memo_key){
			account.memo=true;
		}
		if(''!=account.active_key){
			account.active=true;
		}

		save_state(function(){
			ext_browser.runtime.sendMessage({reload_state:true});
			$('.modal .error').html('');
			$('.modal .edit-account-action').removeAttr('disabled');

			close_modal_action();
			main_app();
		});
	}
	else{
		let invalid_keys=[];
		if(!regular_valid){
			invalid_keys.push('regular');
		}
		if(!memo_valid){
			invalid_keys.push('memo');
		}
		if(!active_valid){
			invalid_keys.push('active');
		}
		$('.modal .error').html(ltmp_arr.form_invalid_keys+invalid_keys.join(', '));
		$('.modal .edit-account-action').removeAttr('disabled');
	}
}

var add_account_action=function(){
	$('.modal .error').html('');
	$('.modal .add-account-action').attr('disabled','disabled');
	let new_user=$('.modal .login').val();
	new_user=new_user.trim();
	if('@'==new_user.substring(0,1)){
		new_user=new_user.substring(1);
	}
	new_user=new_user.toLowerCase();

	let regular_valid=false;
	let memo_valid=false;
	let active_valid=false;

	let regular_key=$('.modal .regular_key').val();
	regular_key=regular_key.trim();

	let memo_key=$('.modal .memo_key').val();
	memo_key=memo_key.trim();

	let active_key=$('.modal .active_key').val();
	active_key=active_key.trim();

	regular_valid=viz.auth.isWif(regular_key);
	if(''==memo_key){
		memo_valid=true;
	}
	else{
		memo_valid=viz.auth.isWif(memo_key);
	}
	if(''==active_key){
		active_valid=true;
	}
	else{
		active_valid=viz.auth.isWif(active_key);
	}

	if(regular_valid && memo_valid && active_valid){
		current_user=new_user;
		users[current_user]={'regular_key':regular_key,'memo_key':memo_key,'active_key':active_key};
		account=users[current_user];
		if(''!=account.memo_key){
			account.memo=true;
		}
		if(''!=account.active_key){
			account.active=true;
		}

		save_state(function(){
			ext_browser.runtime.sendMessage({reload_state:true});
			$('.modal .error').html('');
			$('.modal .add-account-action').removeAttr('disabled');

			close_modal_action();
			main_app();
		});
	}
	else{
		let invalid_keys=[];
		if(!regular_valid){
			invalid_keys.push('regular');
		}
		if(!memo_valid){
			invalid_keys.push('memo');
		}
		if(!active_valid){
			invalid_keys.push('active');
		}
		$('.modal .error').html(ltmp_arr.form_invalid_keys+invalid_keys.join(', '));
		$('.modal .add-account-action').removeAttr('disabled');
	}
}

var edit_account_form=function(e){
	let el=$(e.target);
	let account_login=el.parent().attr('rel');

	close_modal_action();
	$('.shadow').addClass('show');
	let modal_icons=`
	<div class="header-buttons left">
		<a href="#" class="header-icon close-modal-action">`+ltmp_icons.icon_back+`</a>
	</div>`;
	let modal_html=`
	<div class="modal">
		${modal_icons}
		<div class="header-line">
			${ltmp_arr.edit_account_title}
		</div>
		<div class="content-wrapper"><div class="content text-center">
		</div></div>
	</div>
	`;
	$('.window-wrapper').append(modal_html);

	let form_html='';
	form_html+='<p><input type="text" autocomplete="off" class="login" value="'+account_login+'" readonly placeholder="'+ltmp_arr.form_login+'">';
	form_html+='<span class="accounts-input-hint"><span class="dotted" title="'+ltmp_arr.form_login_edit_descr+'">?</span></span></p>';
	form_html+='<p><input type="password" autocomplete="off" class="regular_key" placeholder="'+ltmp_arr.form_regular_key_short+'">';
	form_html+='<span class="accounts-input-hint"><span class="dotted" title="'+ltmp_arr.form_regular_key_edit_descr+'">?</span><span class="exist" title="'+ltmp_arr.form_key_exist+'">✔️</span></span></p>';
	form_html+='<p><input type="password" autocomplete="off" class="memo_key" placeholder="'+ltmp_arr.form_memo_key_short+'">';
	form_html+='<span class="accounts-input-hint"><span class="dotted" title="'+ltmp_arr.form_memo_key_descr+'">?</span>'+(account.memo?'<span class="exist" title="'+ltmp_arr.form_key_exist+'">✔️</span>':'')+'</span></p>';
	form_html+='<p><input type="password" autocomplete="off" class="active_key" placeholder="'+ltmp_arr.form_active_key_short+'">';
	form_html+='<span class="accounts-input-hint"><span class="dotted" title="'+ltmp_arr.form_active_key_descr+'">?</span>'+(account.active?'<span class="exist" title="'+ltmp_arr.form_key_exist+'">✔️</span>':'')+'</span></p>';
	form_html+='<div class="error" style="color:red;"></div>';
	form_html+='<div class="button-space"></div>';
	form_html+='<div class="footer-button"><input type="button" class="edit-account-action wide" value="'+ltmp_arr.form_edit_caption+'"></div>';

	$('.modal .content').html(form_html);

	$('.edit-account-action').off('click',edit_account_action);
	$('.edit-account-action').on('click',edit_account_action);

	$('.close-modal-action').off('click',close_modal_action);
	$('.close-modal-action').on('click',close_modal_action);
}
var add_account_form=function(){
	close_modal_action();
	$('.shadow').addClass('show');
	let modal_icons=`
	<div class="header-buttons left">
		<a href="#" class="header-icon close-modal-action">`+ltmp_icons.icon_back+`</a>
	</div>`;
	let modal_html=`
	<div class="modal">
		${modal_icons}
		<div class="header-line">
			${ltmp_arr.add_account_title}
		</div>
		<div class="content-wrapper"><div class="content text-center">
		</div></div>
	</div>
	`;
	$('.window-wrapper').append(modal_html);

	let form_html='';
	form_html+='<p><input type="text" autocomplete="off" class="login" placeholder="'+ltmp_arr.form_login+'">';
	form_html+='<span class="accounts-input-hint"><span class="red">*</span></span></p>';
	form_html+='<p><input type="password" autocomplete="off" class="regular_key" placeholder="'+ltmp_arr.form_regular_key_short+'">';
	form_html+='<span class="accounts-input-hint"><span class="red">*</span></span></p>';
	form_html+='<p><input type="password" autocomplete="off" class="memo_key" placeholder="'+ltmp_arr.form_memo_key_short+'">';
	form_html+='<span class="accounts-input-hint"><span class="dotted" title="'+ltmp_arr.form_memo_key_descr+'">?</span></span></p>';
	form_html+='<p><input type="password" autocomplete="off" class="active_key" placeholder="'+ltmp_arr.form_active_key_short+'">';
	form_html+='<span class="accounts-input-hint"><span class="dotted" title="'+ltmp_arr.form_active_key_descr+'">?</span></span></p>';
	form_html+='<div class="error" style="color:red;"></div>';
	form_html+='<div class="button-space"></div>';
	form_html+='<div class="footer-button"><input type="button" class="add-account-action wide" value="'+ltmp_arr.form_save_caption+'"></div>';

	$('.modal .content').html(form_html);

	$('.add-account-action').off('click',add_account_action);
	$('.add-account-action').on('click',add_account_action);

	$('.close-modal-action').off('click',close_modal_action);
	$('.close-modal-action').on('click',close_modal_action);
};

var delete_account_action=function(e){
	let el=$(e.target);
	let account_login=el.parent().attr('rel');

	delete users[account_login];
	if(current_user==account_login){
		account={
			regular_key:'',
			memo_key:'',
			active_key:'',
		};
		let users_list=Object.keys(users);
		if(0<users_list.length){
			current_user=users_list[0];
			account=users[current_user];
			save_state(function(){
				ext_browser.runtime.sendMessage({reload_state:true});

				close_modal_action();
				main_app();
			});
		}
		else{
			current_user='';
			users={};
			delete localStorage['state'];

			state={};
			save_state(function(){
				ext_browser.runtime.sendMessage({reload_state:true});

				close_modal_action();
				main_app();
			});
		}
	}
	else{
		save_state(function(){
			ext_browser.runtime.sendMessage({reload_state:true});

			close_modal_action();
			main_app();
		});
	}
}
var select_account_action=function(e){
	let el=$(e.target);
	let account_login=el.parent().attr('rel');
	current_user=account_login;
	account=users[current_user];

	save_state(function(){
		ext_browser.runtime.sendMessage({reload_state:true});
		$('.modal .error').html('');
		$('.modal .add-account-action').removeAttr('disabled');

		close_modal_action();
		main_app();
	});
};

var accounts_list_action=function(){
	$('.shadow').addClass('show');
	let modal_icons=`
	<div class="header-buttons left">
		<a href="#" class="header-icon close-modal-action">`+ltmp_icons.icon_back+`</a>
	</div>`;
	let modal_html=`
	<div class="modal">
		${modal_icons}
		<div class="header-line">
			${ltmp_arr.select_account_title}
		</div>
		<div class="content-wrapper"><div class="content text-center">
		</div></div>
	</div>
	`;
	$('.window-wrapper').append(modal_html);
	let account_list_html='';
	let users_list=Object.keys(users);
	for(let i in users_list){
		account_list_html+='<div class="account-item" rel="'+users_list[i]+'">';
		if(current_user==users_list[i]){
			account_list_html+='<span class="selected-account-check" title="'+ltmp_arr.current_account_caption+'">✔️</span><a href="#" class="current">';
		}
		else{
			account_list_html+='<a href="#" class="select-account-action">';
		}
		account_list_html+=users_list[i];
		account_list_html+='</a>';
		account_list_html+='<a href="#" class="edit-account-action" title="'+ltmp_arr.edit_account_caption+'">✏️</a>';
		account_list_html+='<a href="#" class="delete-account-action" title="'+ltmp_arr.delete_account_caption+'">❌</a>';
		account_list_html+='</div>';
	}
	account_list_html+='<a class="button add-account-form">'+ltmp_arr.add_account_caption+'</a>';

	$('.modal .content').html(account_list_html);

	$('.edit-account-action').off('click',edit_account_form);
	$('.edit-account-action').on('click',edit_account_form);

	$('.delete-account-action').off('click',delete_account_action);
	$('.delete-account-action').on('click',delete_account_action);

	$('.select-account-action').off('click',select_account_action);
	$('.select-account-action').on('click',select_account_action);

	$('.add-account-form').off('click',add_account_form);
	$('.add-account-form').on('click',add_account_form);

	$('.close-modal-action').off('click',close_modal_action);
	$('.close-modal-action').on('click',close_modal_action);
};

function fast_str_replace(search,replace,str){
	return str.split(search).join(replace);
}

function award_action(){
	let page=$('.modal .content');
	let form_account=page.find('input[name=form-account]').val().toLowerCase().trim();
	let form_energy=page.find('input[name=form-energy]').val().trim();

	let form_memo=page.find('input[name=form-memo]').val().trim();
	let encode=false;
	if(page.find('input[name=encode-memo]').length>0){
		encode=page.find('input[name=encode-memo]').prop('checked');
	}
	let fix_flag=false;
	let form_amount=0;
	let fixed_tokens_amount='';

	page.find('.award-action').attr('disabled','disabled');

	page.find('.error-caption').html('');
	page.find('.success-caption').html('');

	//account=account.replace(/[^a-z0-9\-\.]/g,'');
	page.find('input[name=form-account]').val(form_account);
	page.find('input[name=form-account]').removeClass('red');
	if((''==form_account) || (!(/^([a-z0-9\-\.]*)$/).test(form_account))){
		page.find('input[name=form-account]').addClass('red');
		page.find('input[name=form-account]')[0].focus();
		page.find('.error-caption').html(ltmp_arr.default_recipient_error);

		page.find('.award-action').removeAttr('disabled');
		return;
	}

	form_energy=fast_str_replace(',','.',form_energy);
	form_energy=parseFloat(form_energy).toFixed(2);
	form_energy=Math.floor(form_energy*100);
	page.find('input[name=form-energy]').removeClass('red');
	if(form_energy>current_energy){
		page.find('input[name=form-energy]').addClass('red');
		page.find('input[name=form-energy]')[0].focus();
		page.find('.error-caption').html(ltmp_arr.default_not_enough_energy);

		page.find('.award-action').removeAttr('disabled');
		return;
	}
	if(null===form_energy){
		page.find('.error-caption').html(ltmp_arr.default_enter_energy);

		page.find('.award-action').removeAttr('disabled');
		return;
	}

	if(page.find('input[name=fix-amount]').length>0){
		fix_flag=page.find('input[name=fix-amount]').prop('checked');
		if(fix_flag){
			form_amount=page.find('input[name=form-amount]').val().trim();
			page.find('input[name=form-amount]').removeClass('red');
			form_amount=form_amount.replace(/[^0-9\,\.]/g,'');
			page.find('input[name=form-amount]').val(form_amount);
			form_amount=fast_str_replace(' ','',form_amount);
			if(-1==form_amount.indexOf('.')){
				if(2<form_amount.split(',').length){
					page.find('input[name=form-amount]').addClass('red');
					page.find('input[name=form-amount]').focus();
					page.find('.error-caption').html(ltmp_arr.default_check_amount);

					page.find('.award-action').removeAttr('disabled');
					return;
				}
				form_amount=fast_str_replace(',','.',form_amount);
			}
			if(2<form_amount.split('.').length){
				page.find('input[name=form-amount]').addClass('red');
				page.find('.error-caption').html(ltmp_arr.default_check_amount);

				page.find('.award-action').removeAttr('disabled');
				return;
			}
			form_amount=fast_str_replace(',','',form_amount);
			page.find('input[name=form-amount]').val(form_amount);
			if(parseFloat(form_amount)<=0){
				page.find('input[name=form-amount]').addClass('red');
				page.find('.error-caption').html(ltmp_arr.default_check_amount);

				page.find('.award-action').removeAttr('disabled');
				return;
			}
			let max_amount=parseFloat(page.find('.range-slider-value').text().substr(1));
			if(parseFloat(form_amount)>max_amount){
				page.find('input[name=form-amount]').addClass('red');
				page.find('.error-caption').html(ltmp_arr.default_insufficient_funds);

				page.find('.award-action').removeAttr('disabled');
				return;
			}
			fixed_tokens_amount=''+parseFloat(form_amount).toFixed(3)+' VIZ';
			if(''==form_amount){
				fixed_tokens_amount='0.000 VIZ';
			}
		}
	}

	if(fix_flag){
		ext_browser.runtime.sendMessage({
			popup:true,
			operation:'fixed_award',

			receiver:form_account,
			reward_amount:fixed_tokens_amount,
			max_energy:form_energy,
			custom_sequence:0,
			memo:form_memo,
			beneficiaries:[],

			force_memo_encoding:encode,
		},function(response){
			console.log('popup response',response);
			if(true===response.error){
				page.find('.error-caption').html(ltmp_arr.operation_error);
				page.find('.award-action').removeAttr('disabled');
			}
			else
			if(false!==response.error){
				page.find('.error-caption').html(ltmp_arr[response.error]);
				page.find('.award-action').removeAttr('disabled');
			}
			else{
				page.find('.success-caption').html(ltmp_arr.operation_success);
				update_account_info();
			}
		});
	}
	else{
		ext_browser.runtime.sendMessage({
			popup:true,
			operation:'award',

			receiver:form_account,
			energy:form_energy,
			custom_sequence:0,
			memo:form_memo,
			beneficiaries:[],

			force_memo_encoding:encode,
		},function(response){
			console.log('popup response',response);
			if(true===response.error){
				page.find('.error-caption').html(ltmp_arr.operation_error);
				page.find('.award-action').removeAttr('disabled');
			}
			else
			if(false!==response.error){
				page.find('.error-caption').html(ltmp_arr[response.error]);
				page.find('.award-action').removeAttr('disabled');
			}
			else{
				page.find('.success-caption').html(ltmp_arr.operation_success);
				update_account_info();
			}
		});
	}
}

function show_award_form(){
	$('body').addClass('expand');
	$('.shadow').addClass('show');
	let modal_icons=`
	<div class="header-buttons left">
		<a href="#" class="header-icon close-modal-action">`+ltmp_icons.icon_back+`</a>
	</div>`;
	let modal_html=`
	<div class="modal award-form">
		${modal_icons}
		<div class="header-line">
			${ltmp_arr.award_form_title}
		</div>
		<div class="content-wrapper"><div class="content">
		</div></div>
	</div>
	`;
	$('.window-wrapper').append(modal_html);
	let form_html=`
	<div class="info-bar capital-caption"><!--${ltmp_arr.capital_caption}: --><span class="amount">`+(current_effective_shares)+`</span> Ƶ <a class="unselectable swap-effective-capital-icon active" title="${ltmp_arr.show_effective_capital}">${ltmp_icons.icon_swap}</a></div>
	<div class="info-bar energy-caption green last"><!--${ltmp_arr.energy_caption}: --><span>`+(current_energy/100)+`</span>%</div>

	<div class="form-input-wrapper">
		<div>
		<input type="text" autocomplete="off" name="form-account" class="half " placeholder="${ltmp_arr.award_form_account}">
		<input type="text" autocomplete="off" name="form-energy" class="half last" placeholder="0.00%">
		</div>
	<span class="range-slider">
	<input class="range-slider-input" data-result-element="input[name=form-energy]" type="range" value="0" min="0" max="`+(current_energy)+`" step="1">
	<span class="range-slider-value" rel="amount">~0.00 viz</span>
	</span>
	</div>

	<div class="form-input-wrapper"><input type="text" autocomplete="off" name="form-memo" class="wide" placeholder="${ltmp_arr.award_form_memo}">`;
	if(true===account.memo){
		//form_html+=`<label><input type="checkbox" name="encode-memo"> &mdash; ${ltmp_arr.award_form_encode_memo}</label>`;
		form_html+=`
		<div class="switch-wrapper">
			<label class="switch" for="checkbox">
			<input type="checkbox" id="checkbox" name="encode-memo" />
			<div class="slider round"></div>
			</label>
			<label class="switch-caption" for="checkbox">${ltmp_arr.award_form_encode_memo}</label>
		</div>`;
	}
	form_html+='</div>';

	form_html+=`
	<div class="switch-wrapper">
		<label class="switch" for="fix-checkbox">
		<input type="checkbox" id="fix-checkbox" name="fix-amount" />
		<div class="slider round"></div>
		</label>
		<label class="switch-caption" for="fix-checkbox">${ltmp_arr.award_form_fixed_flag}</label>
	</div>
	<div class="form-input-wrapper fixed-amount-wrapper">
		<input type="text" autocomplete="off" name="form-amount" class="wide" placeholder="0.000 VIZ">
	</div>`;

	form_html+='<div class="error-caption red"></div>';
	form_html+='<div class="success-caption green"></div>';
	form_html+='<div class="button-space"></div>';
	form_html+='<div class="footer-button"><input type="button" class="award-action wide" value="'+ltmp_arr.award_action+'"></div>';

	$('.modal .content').html(form_html);

	$('.swap-effective-capital-action').off('click',swap_effective_capital);
	$('.swap-effective-capital-action').on('click',swap_effective_capital);

	$('.modal .content input[name=fix-amount]').on('change',function(){
		if($('.modal .content .fixed-amount-wrapper').hasClass('show')){
			$('.modal .content .fixed-amount-wrapper').removeClass('show');
		}
		else{
			$('.modal .content .fixed-amount-wrapper').addClass('show');
		}
	});
	$('.modal .content input[name=form-energy]').on('keyup',function(){
		let value=parseFloat($(this).val());
		if(isNaN(value)){
			value=0;
		}
		if(value<0){
			value=0;
		}
		if(value>100){
			value=100;
		}
		let range_slider=$(this).parent().parent().find('.range-slider-input');
		range_slider.val(parseInt(value*100));
		let event=document.createEvent('HTMLEvents');
		event.initEvent('change',false,true);
		range_slider[0].dispatchEvent(event);
	});
	$('.modal .content .range-slider').each(function(i,el){
		$(el).find('.range-slider-value').each(function(){
			var value=$(this).prev().attr('value');
			$(this).html('~'+parseFloat(value).toFixed(3)+' Ƶ');
		});
		$(el).find('.range-slider-input').on('input',function(){
			$($(this).attr('data-result-element')).val(parseFloat(this.value/100).toFixed(2)+'%');
			let event=document.createEvent('HTMLEvents');
			event.initEvent('change',false,true);
			$(this)[0].dispatchEvent(event);
		});
		$(el).find('.range-slider-input').on('change',function(){
			let value_el=$(this).next('.range-slider-value');
			let data_raw=current_effective_shares;
			if(typeof data_raw != 'undefined'){
				data_raw=parseFloat(data_raw);
				data_raw=parseInt(data_raw*1000000);//to int shares
				let current_rshares=parseInt(data_raw*parseInt(parseInt(this.value))/10000);

				if(typeof localStorage['current_total_reward_fund'] !== 'undefined'){
					current_total_reward_fund=localStorage['current_total_reward_fund'];
				}
				if(typeof localStorage['current_total_reward_shares'] !== 'undefined'){
					current_total_reward_shares=localStorage['current_total_reward_shares'];
				}

				let total_reward_shares=parseInt(current_total_reward_shares);
				total_reward_shares+=current_rshares;
				let total_reward_fund=parseInt(parseFloat(current_total_reward_fund)*1000);//to int tokens
				let reward=(total_reward_fund*current_rshares)/total_reward_shares;
				reward=reward*0.9995;//decrease expectations 0.005%
				reward=Math.ceil(reward)/1000;//to float tokens
				if(isNaN(reward)){
					reward=0;
				}
				$(this).next().html('~'+parseFloat(reward).toFixed(3)+' Ƶ');
			}
		});
	});

	$('.modal .content input[name=form-energy]').val(account.energy_step);
	$('.modal .content input[name=form-account]')[0].focus();

	$('.award-action').off('click',award_action);
	$('.award-action').on('click',award_action);

	$('.close-modal-action').off('click',close_modal_action);
	$('.close-modal-action').on('click',close_modal_action);
}

function transfer_action(){
	let page=$('.modal .content');

	page.find('.error-caption').html('');
	page.find('.success-caption').html('');

	let form_account=page.find('input[name=form-account]').val().toLowerCase().trim();
	let form_amount=page.find('input[name=form-amount]').val().trim();
	let form_memo=page.find('input[name=form-memo]').val().trim();
	let encode=false;
	if(page.find('input[name=encode-memo]').length>0){
		encode=page.find('input[name=encode-memo]').prop('checked');
	}
	page.find('.transfer-action').attr('disabled','disabled');

	page.find('input[name=form-amount]').removeClass('red');
	form_amount=form_amount.replace(/[^0-9\,\.]/g,'');
	page.find('input[name=form-amount]').val(form_amount);
	form_amount=fast_str_replace(' ','',form_amount);
	if(-1==form_amount.indexOf('.')){
		if(2<form_amount.split(',').length){
			page.find('input[name=form-amount]').addClass('red');
			page.find('input[name=form-amount]').focus();
			page.find('.error-caption').html(ltmp_arr.default_check_amount);

			page.find('.transfer-action').removeAttr('disabled');
			return;
		}
		form_amount=fast_str_replace(',','.',form_amount);
	}
	if(2<form_amount.split('.').length){
		page.find('input[name=form-amount]').addClass('red');
		page.find('.error-caption').html(ltmp_arr.default_check_amount);

		page.find('.transfer-action').removeAttr('disabled');
		return;
	}
	form_amount=fast_str_replace(',','',form_amount);
	page.find('input[name=form-amount]').val(form_amount);
	if(parseFloat(form_amount)<=0){
		page.find('input[name=form-amount]').addClass('red');
		page.find('.error-caption').html(ltmp_arr.default_check_amount);

		page.find('.transfer-action').removeAttr('disabled');
		return;
	}
	if(parseFloat(form_amount)>parseFloat(current_balance)){
		page.find('input[name=form-amount]').addClass('red');
		page.find('.error-caption').html(ltmp_arr.default_insufficient_funds);

		page.find('.transfer-action').removeAttr('disabled');
		return;
	}
	let fixed_tokens_amount=''+parseFloat(form_amount).toFixed(3)+' VIZ';
	if(''==form_amount){
		fixed_tokens_amount='0.000 VIZ';
	}

	//account=account.replace(/[^a-z0-9\-\.]/g,'');
	page.find('input[name=form-account]').val(form_account);
	page.find('input[name=form-account]').removeClass('red');
	if((''==form_account) || (!(/^([a-z0-9\-\.]*)$/).test(form_account))){
		page.find('input[name=form-account]').addClass('red');
		page.find('input[name=form-account]')[0].focus();
		page.find('.error-caption').html(ltmp_arr.default_recipient_error);

		page.find('.transfer-action').removeAttr('disabled');
		return;
	}


	ext_browser.runtime.sendMessage({
		popup:true,
		operation:'transfer',

		to:form_account,
		amount:fixed_tokens_amount,
		memo:form_memo,

		force_memo_encoding:encode,
	},function(response){
		console.log('popup response',response);
		if(true===response.error){
			page.find('.error-caption').html(ltmp_arr.operation_error);
			page.find('.transfer-action').removeAttr('disabled');
		}
		else
		if(false!==response.error){
			page.find('.error-caption').html(ltmp_arr[response.error]);
			page.find('.transfer-action').removeAttr('disabled');
		}
		else{
			page.find('.success-caption').html(ltmp_arr.operation_success);
			update_account_info();
		}
	});
}
function show_wallet_form(){
	$('.shadow').addClass('show');
	let modal_icons=`
	<div class="header-buttons left">
		<a href="#" class="header-icon close-modal-action">`+ltmp_icons.icon_back+`</a>
	</div>`;
	let modal_html=`
	<div class="modal transfer-form">
		${modal_icons}
		<div class="header-line">
			${ltmp_arr.wallet_form_title}
		</div>
		<div class="content-wrapper"><div class="content">
		</div></div>
	</div>
	`;
	$('.window-wrapper').append(modal_html);
	let form_html=`
	<div class="info-bar balance-caption last"><!--${ltmp_arr.balance_caption}: --><span>`+current_balance+`</span> Ƶ</div>

	<div class="form-input-wrapper">
		<input type="text" autocomplete="off" name="form-account" class="wide" placeholder="${ltmp_arr.transfer_form_account}">
	</div>
	<div class="form-input-wrapper">
		<input type="text" autocomplete="off" name="form-amount" class="wide" placeholder="0.000 VIZ">
	</div>

	<div class="form-input-wrapper"><input type="text" autocomplete="off" name="form-memo" class="wide" placeholder="${ltmp_arr.award_form_memo}">`;
	if(true===account.memo){
		//form_html+=`<label><input type="checkbox" name="encode-memo"> &mdash; ${ltmp_arr.award_form_encode_memo}</label>`;
		form_html+=`
		<div class="switch-wrapper">
			<label class="switch" for="checkbox">
			<input type="checkbox" id="checkbox" name="encode-memo" />
			<div class="slider round"></div>
			</label>
			<label class="switch-caption" for="checkbox">${ltmp_arr.transfer_form_encode_memo}</label>
		</div>`;
	}
	form_html+='</div>';
	form_html+='<div class="error-caption red"></div>';
	form_html+='<div class="success-caption green"></div>';
	form_html+='<div class="button-space"></div>';
	form_html+='<div class="footer-button"><input type="button" class="transfer-action wide" value="'+ltmp_arr.transfer_action+'"></div>';

	$('.modal .content').html(form_html);

	$('.modal .content input[name=form-account]')[0].focus();

	$('.transfer-action').off('click',transfer_action);
	$('.transfer-action').on('click',transfer_action);

	$('.close-modal-action').off('click',close_modal_action);
	$('.close-modal-action').on('click',close_modal_action);
}
function stake_action(){
	let page=$('.modal .content');

	page.find('.error-caption').html('');
	page.find('.success-caption').html('');
	page.find('.stake-action').attr('disabled','disabled');

	let form_amount=page.find('input[name=form-amount]').val().trim();

	page.find('input[name=form-amount]').removeClass('red');
	form_amount=form_amount.replace(/[^0-9\,\.]/g,'');
	page.find('input[name=form-amount]').val(form_amount);
	form_amount=fast_str_replace(' ','',form_amount);
	if(-1==form_amount.indexOf('.')){
		if(2<form_amount.split(',').length){
			page.find('input[name=form-amount]').addClass('red');
			page.find('input[name=form-amount]').focus();
			page.find('.error-caption').html(ltmp_arr.default_check_amount);

			page.find('.stake-action').removeAttr('disabled');
			return;
		}
		form_amount=fast_str_replace(',','.',form_amount);
	}
	if(2<form_amount.split('.').length){
		page.find('input[name=form-amount]').addClass('red');
		page.find('.error-caption').html(ltmp_arr.default_check_amount);

		page.find('.stake-action').removeAttr('disabled');
		return;
	}
	form_amount=fast_str_replace(',','',form_amount);
	page.find('input[name=form-amount]').val(form_amount);
	if(parseFloat(form_amount)<=0){
		page.find('input[name=form-amount]').addClass('red');
		page.find('.error-caption').html(ltmp_arr.default_check_amount);

		page.find('.stake-action').removeAttr('disabled');
		return;
	}
	if(parseFloat(form_amount)>parseFloat(current_balance)){
		page.find('input[name=form-amount]').addClass('red');
		page.find('.error-caption').html(ltmp_arr.default_insufficient_funds);

		page.find('.stake-action').removeAttr('disabled');
		return;
	}
	let fixed_tokens_amount=''+parseFloat(form_amount).toFixed(3)+' VIZ';
	if(''==form_amount){
		fixed_tokens_amount='0.000 VIZ';
	}

	ext_browser.runtime.sendMessage({
		popup:true,
		operation:'transfer_to_vesting',

		to:current_user,
		amount:fixed_tokens_amount,
	},function(response){
		console.log('popup response',response);
		if(true===response.error){
			page.find('.error-caption').html(ltmp_arr.operation_error);
			page.find('.stake-action').removeAttr('disabled');
		}
		else
		if(false!==response.error){
			page.find('.error-caption').html(ltmp_arr[response.error]);
			page.find('.stake-action').removeAttr('disabled');
		}
		else{
			page.find('.success-caption').html(ltmp_arr.operation_success);
			page.find('.stake-action').removeAttr('disabled');
			update_account_info();
		}
	});
}
function show_stake_form(){
	$('.shadow').addClass('show');
	let modal_icons=`
	<div class="header-buttons left">
		<a href="#" class="header-icon close-modal-action">`+ltmp_icons.icon_back+`</a>
	</div>`;
	let modal_html=`
	<div class="modal stake-form">
		${modal_icons}
		<div class="header-line">
			${ltmp_arr.stake_form_title}
		</div>
		<div class="content-wrapper"><div class="content">
		</div></div>
	</div>
	`;
	$('.window-wrapper').append(modal_html);
	let form_html=`
	<div class="info-bar capital-caption"><!--${ltmp_arr.capital_caption}: --><span class="amount">`+(current_shares)+`</span> Ƶ <a class="unselectable swap-effective-capital-icon" title="${ltmp_arr.show_effective_capital}">${ltmp_icons.icon_swap}</a></div>
	<div class="info-bar balance-caption last"><!--${ltmp_arr.balance_caption}: --><span>`+current_balance+`</span> Ƶ</div>

	<div class="form-input-wrapper">
		<input type="text" autocomplete="off" name="form-amount" class="wide" placeholder="0.000 VIZ">
	</div>

	`;
	form_html+='<div class="error-caption red"></div>';
	form_html+='<div class="success-caption green"></div>';
	form_html+='<div class="button-space"></div>';
	form_html+='<div class="footer-button"><input type="button" class="stake-action wide" value="'+ltmp_arr.stake_action+'"></div>';

	$('.modal .content').html(form_html);

	$('.modal .content input[name=form-amount]')[0].focus();

	$('.stake-action').off('click',stake_action);
	$('.stake-action').on('click',stake_action);

	$('.close-modal-action').off('click',close_modal_action);
	$('.close-modal-action').on('click',close_modal_action);
}
function stop_unstake_action(){
	let page=$('.modal .content');

	page.find('.error-caption').html('');
	page.find('.success-caption').html('');
	page.find('.stop-unstake-action').attr('disabled','disabled');

	let fixed_tokens_amount='0.000000 SHARES';

	ext_browser.runtime.sendMessage({
		popup:true,
		operation:'withdraw_vesting',

		amount:fixed_tokens_amount,
	},function(response){
		console.log('popup response',response);
		if(true===response.error){
			page.find('.error-caption').html(ltmp_arr.operation_error);
			page.find('.stop-unstake-action').removeAttr('disabled');
		}
		else
		if(false!==response.error){
			page.find('.error-caption').html(ltmp_arr[response.error]);
			page.find('.stop-unstake-action').removeAttr('disabled');
		}
		else{
			page.find('.success-caption').html(ltmp_arr.operation_success);
			clearTimeout(update_account_info_timer);
			update_account_info_timer=setTimeout(update_account_info,1500);
			setTimeout(function(){
				clearTimeout(update_account_info_timer);
				update_account_info();
				close_modal_action();
				show_unstake_form();
			},3000);
		}
	});
}
function unstake_action(){
	let page=$('.modal .content');

	page.find('.error-caption').html('');
	page.find('.success-caption').html('');
	page.find('.unstake-action').attr('disabled','disabled');

	let form_amount=page.find('input[name=form-amount]').val().trim();

	page.find('input[name=form-amount]').removeClass('red');
	form_amount=form_amount.replace(/[^0-9\,\.]/g,'');
	page.find('input[name=form-amount]').val(form_amount);
	form_amount=fast_str_replace(' ','',form_amount);
	if(-1==form_amount.indexOf('.')){
		if(2<form_amount.split(',').length){
			page.find('input[name=form-amount]').addClass('red');
			page.find('input[name=form-amount]').focus();
			page.find('.error-caption').html(ltmp_arr.default_check_amount);

			page.find('.unstake-action').removeAttr('disabled');
			return;
		}
		form_amount=fast_str_replace(',','.',form_amount);
	}
	if(2<form_amount.split('.').length){
		page.find('input[name=form-amount]').addClass('red');
		page.find('.error-caption').html(ltmp_arr.default_check_amount);

		page.find('.unstake-action').removeAttr('disabled');
		return;
	}
	form_amount=fast_str_replace(',','',form_amount);
	page.find('input[name=form-amount]').val(form_amount);
	if(parseFloat(form_amount)<=0){
		page.find('input[name=form-amount]').addClass('red');
		page.find('.error-caption').html(ltmp_arr.default_check_amount);

		page.find('.unstake-action').removeAttr('disabled');
		return;
	}
	if(parseFloat(form_amount)>(parseFloat(current_shares)-parseFloat(current_outcome_shares))){
		page.find('input[name=form-amount]').addClass('red');
		page.find('.error-caption').html(ltmp_arr.default_insufficient_funds);

		page.find('.unstake-action').removeAttr('disabled');
		return;
	}
	let fixed_tokens_amount=''+parseFloat(form_amount).toFixed(6)+' SHARES';
	if(''==form_amount){
		fixed_tokens_amount='0.000000 SHARES';
	}

	ext_browser.runtime.sendMessage({
		popup:true,
		operation:'withdraw_vesting',

		amount:fixed_tokens_amount,
	},function(response){
		console.log('popup response',response);
		if(true===response.error){
			page.find('.error-caption').html(ltmp_arr.operation_error);
			page.find('.unstake-action').removeAttr('disabled');
		}
		else
		if(false!==response.error){
			page.find('.error-caption').html(ltmp_arr[response.error]);
			page.find('.unstake-action').removeAttr('disabled');
		}
		else{
			page.find('.success-caption').html(ltmp_arr.operation_success);
			clearTimeout(update_account_info_timer);
			update_account_info_timer=setTimeout(update_account_info,1500);
			setTimeout(function(){
				clearTimeout(update_account_info_timer);
				update_account_info();
				close_modal_action();
				show_unstake_form();
			},3000);
		}
	});
}
function show_unstake_form(){
	$('.shadow').addClass('show');
	let modal_icons=`
	<div class="header-buttons left">
		<a href="#" class="header-icon close-modal-action">`+ltmp_icons.icon_back+`</a>
	</div>`;
	let modal_html=`
	<div class="modal unstake-form">
		${modal_icons}
		<div class="header-line">
			${ltmp_arr.unstake_form_title}
		</div>
		<div class="content-wrapper"><div class="content">
		</div></div>
	</div>
	`;
	$('.window-wrapper').append(modal_html);
	let form_html=`
	<div class="info-bar capital-caption last"><!--${ltmp_arr.capital_caption}: --><span class="amount">`+(current_shares)+`</span> Ƶ <a class="unselectable swap-effective-capital-icon" title="${ltmp_arr.show_effective_capital}">${ltmp_icons.icon_swap}</a></div>
	`;
	if(current_next_vesting_withdrawal>0){
		form_html+='<p>'+ltmp_arr.unstake_withdraw_rate_caption+': '+parseFloat(parseInt(Math.min(current_withdraw_rate,current_withdraw-current_withdrawn))/1000000).toFixed(3)+' Ƶ</p>';
		form_html+='<p>'+ltmp_arr.unstake_next_withdraw_caption+': ≈'+parseFloat(parseInt(current_next_vesting_withdrawal)/60/60).toFixed(1)+' '+ltmp_arr.default_hours+'</p>';
		form_html+='<p>'+ltmp_arr.unstake_awaiting_withdraw_caption+': '+parseFloat(parseInt(current_withdraw-current_withdrawn)/1000000).toFixed(3)+' Ƶ</p>';
		form_html+='<div class="footer-button"><input type="button" class="stop-unstake-action wide" value="'+ltmp_arr.stop_unstake_action+'"></div>';
	}
	else{
		form_html+=`
		<div class="form-input-wrapper">
			<input type="text" autocomplete="off" name="form-amount" class="wide" placeholder="0.000 VIZ">
		</div>
		<p>${ltmp_arr.unstake_duration_caption}: <span class="unstake-duration-days">0</span> ${ltmp_arr.default_days}</p>
		`;
		form_html+='<div class="footer-button"><input type="button" class="unstake-action wide" value="'+ltmp_arr.unstake_action+'"></div>';
	}
	form_html+='<div class="error-caption red"></div>';
	form_html+='<div class="success-caption green"></div>';
	form_html+='<div class="button-space"></div>';

	$('.modal .content').html(form_html);

	if(current_next_vesting_withdrawal<=0){
		$('.modal .content input[name=form-amount]')[0].focus();
		var calc_unstake_days=function(){
			setTimeout(function(){
				let unstake_amount=parseFloat($('.modal .content input[name=form-amount]').val());
				let unstake_rate=parseFloat(current_shares)/28;
				let unstake_days=Math.ceil(unstake_amount/unstake_rate);
				unstake_days=Math.min(unstake_days,28);
				unstake_days=Math.max(unstake_days,1);
				if(isNaN(unstake_amount)){
					unstake_days=0;
				}
				$('.modal span.unstake-duration-days').html(unstake_days);
			},100);
		}
		$('.modal .content input[name=form-amount]').off('keyup',calc_unstake_days);
		$('.modal .content input[name=form-amount]').on('keyup',calc_unstake_days);
	}

	$('.stop-unstake-action').off('click',stop_unstake_action);
	$('.stop-unstake-action').on('click',stop_unstake_action);
	$('.unstake-action').off('click',unstake_action);
	$('.unstake-action').on('click',unstake_action);

	$('.close-modal-action').off('click',close_modal_action);
	$('.close-modal-action').on('click',close_modal_action);
}
function delegate_action(){
	let page=$('.modal .content');

	page.find('.error-caption').html('');
	page.find('.success-caption').html('');

	let form_account=page.find('input[name=form-account]').val().toLowerCase().trim();
	let form_amount=page.find('input[name=form-amount]').val().trim();
	page.find('.delegate-action').attr('disabled','disabled');

	page.find('input[name=form-amount]').removeClass('red');
	form_amount=form_amount.replace(/[^0-9\,\.]/g,'');
	page.find('input[name=form-amount]').val(form_amount);
	form_amount=fast_str_replace(' ','',form_amount);
	if(-1==form_amount.indexOf('.')){
		if(2<form_amount.split(',').length){
			page.find('input[name=form-amount]').addClass('red');
			page.find('input[name=form-amount]').focus();
			page.find('.error-caption').html(ltmp_arr.default_check_amount);

			page.find('.delegate-action').removeAttr('disabled');
			return;
		}
		form_amount=fast_str_replace(',','.',form_amount);
	}
	if(2<form_amount.split('.').length){
		page.find('input[name=form-amount]').addClass('red');
		page.find('.error-caption').html(ltmp_arr.default_check_amount);

		page.find('.delegate-action').removeAttr('disabled');
		return;
	}
	form_amount=fast_str_replace(',','',form_amount);
	page.find('input[name=form-amount]').val(form_amount);
	if(parseFloat(form_amount)<=0){
		page.find('input[name=form-amount]').addClass('red');
		page.find('.error-caption').html(ltmp_arr.default_check_amount);

		page.find('.delegate-action').removeAttr('disabled');
		return;
	}
	if(parseFloat(form_amount)>parseFloat(current_balance)){
		page.find('input[name=form-amount]').addClass('red');
		page.find('.error-caption').html(ltmp_arr.default_insufficient_funds);

		page.find('.delegate-action').removeAttr('disabled');
		return;
	}
	let fixed_tokens_amount=''+parseFloat(form_amount).toFixed(6)+' SHARES';
	if(''==form_amount){
		fixed_tokens_amount='0.000000 SHARES';
	}

	//account=account.replace(/[^a-z0-9\-\.]/g,'');
	page.find('input[name=form-account]').val(form_account);
	page.find('input[name=form-account]').removeClass('red');
	if((''==form_account) || (!(/^([a-z0-9\-\.]*)$/).test(form_account))){
		page.find('input[name=form-account]').addClass('red');
		page.find('input[name=form-account]')[0].focus();
		page.find('.error-caption').html(ltmp_arr.default_recipient_error);

		page.find('.delegate-action').removeAttr('disabled');
		return;
	}

	ext_browser.runtime.sendMessage({
		popup:true,
		operation:'delegate_vesting_shares',

		delegatee:form_account,
		vesting_shares:fixed_tokens_amount,
	},function(response){
		console.log('popup response',response);
		if(true===response.error){
			page.find('.error-caption').html(ltmp_arr.operation_error);
			page.find('.delegate-action').removeAttr('disabled');
		}
		else
		if(false!==response.error){
			page.find('.error-caption').html(ltmp_arr[response.error]);
			page.find('.delegate-action').removeAttr('disabled');
		}
		else{
			page.find('.success-caption').html(ltmp_arr.operation_success);
			clearTimeout(update_account_info_timer);
			setTimeout(update_account_info,1500);
			setTimeout(update_account_info,3000);
		}
	});
}
function show_delegate_form(){
	$('.shadow').addClass('show');
	let modal_icons=`
	<div class="header-buttons left">
		<a href="#" class="header-icon close-modal-action">`+ltmp_icons.icon_back+`</a>
	</div>`;
	let modal_html=`
	<div class="modal delegate-form">
		${modal_icons}
		<div class="header-line">
			${ltmp_arr.delegate_form_title}
		</div>
		<div class="content-wrapper"><div class="content">
		</div></div>
	</div>
	`;
	$('.window-wrapper').append(modal_html);
	let form_html=`
	<div class="info-bar income-capital-caption green"><!--${ltmp_arr.capital_caption}: -->&plus;<span class="amount">`+(current_income_shares)+`</span> Ƶ</div>
	<div class="info-bar capital-caption"><!--${ltmp_arr.capital_caption}: --><span class="amount">`+(current_shares)+`</span> Ƶ</div>
	<div class="info-bar outcome-capital-caption red last"><!--${ltmp_arr.capital_caption}: -->&minus;<span class="amount">`+(current_outcome_shares)+`</span> Ƶ</div>

	<div class="form-input-wrapper">
		<input type="text" autocomplete="off" name="form-account" class="wide" placeholder="${ltmp_arr.delegate_form_account}">
	</div>
	<div class="form-input-wrapper">
		<input type="text" autocomplete="off" name="form-amount" class="wide" placeholder="0.000 VIZ (max `+(parseFloat(current_shares)-parseFloat(current_outcome_shares))+`)">
	</div>
	<p>${ltmp_arr.delegate_hint}</p>`;
	form_html+='<div class="error-caption red"></div>';
	form_html+='<div class="success-caption green"></div>';
	form_html+='<div class="button-space"></div>';
	form_html+='<div class="footer-button"><input type="button" class="delegate-action wide" value="'+ltmp_arr.delegate_action+'"></div>';

	$('.modal .content').html(form_html);

	$('.modal .content input[name=form-account]')[0].focus();

	$('.delegate-action').off('click',delegate_action);
	$('.delegate-action').on('click',delegate_action);

	$('.close-modal-action').off('click',close_modal_action);
	$('.close-modal-action').on('click',close_modal_action);
}

var update_publish_link=function(check_custom_sequence){
	if(typeof localStorage['current_custom_sequence'] !== 'undefined'){
		current_custom_sequence=parseInt(localStorage['current_custom_sequence']);
	}
	console.log('!update_publish_link',check_custom_sequence,current_custom_sequence);
	if(check_custom_sequence<current_custom_sequence){
		$('.modal.publish-form .success-caption').html(ltmp(ltmp_arr.publish_success_link,{link:'https://readdle.me/#viz://@'+current_user+'/'+current_custom_sequence+'/'}));
	}
	else{
		setTimeout(function(){
			update_publish_link(check_custom_sequence);
		},500);
	}
};

function publish_action(){
	let page=$('.modal .content');

	page.find('.error-caption').html('');
	page.find('.success-caption').html('');

	let form_text=page.find('textarea[name="form-text"]').val().trim();
	let form_share=false;
	if(page.find('input[name=share]').length>0){
		form_share=page.find('input[name=share]').prop('checked');
	}
	current_tab_link(function(share_link){
		page.find('.publish-action').attr('disabled','disabled');
		//let check_custom_sequence=current_custom_sequence;//old publish link sequencer method
		ext_browser.runtime.sendMessage({
			popup:true,
			operation:'publish_voice',

			text:form_text,
			share:(form_share?share_link:false),
		},function(response){
			console.log('popup response',response);
			if(true===response.error){
				page.find('.error-caption').html(ltmp_arr.operation_error);
				page.find('.delegate-action').removeAttr('disabled');
			}
			else
			if(false!==response.error){
				page.find('.error-caption').html(ltmp_arr[response.error]);
				page.find('.delegate-action').removeAttr('disabled');
			}
			else{
				page.find('.success-caption').html(ltmp_arr.operation_success);
				if(typeof response.result !== 'undefined'){
					if(typeof response.result.block_num !== 'undefined'){
						if(response.result.expired){
							page.find('.success-caption').html('');
							page.find('.error-caption').html(ltmp_arr.operation_error);
						}
						else{
							page.find('.success-caption').html(ltmp(ltmp_arr.publish_success_link,{link:'https://readdle.me/#viz://@'+current_user+'/'+response.result.block_num+'/'}));
						}
					}
				}
				/*
				//old publish link update method
				setTimeout(function(){
					console.log('запускаем update_publish_link(check_custom_sequence);',check_custom_sequence);
					update_publish_link(check_custom_sequence);
				},500);
				*/
			}
		});
	});
}
function show_publish_form(){
	current_tab_link(function(share_link){
		$('.shadow').addClass('show');
		let modal_icons=`
		<div class="header-buttons left">
			<a href="#" class="header-icon close-modal-action">`+ltmp_icons.icon_back+`</a>
		</div>`;
		let modal_html=`
		<div class="modal publish-form">
			${modal_icons}
			<div class="header-line">
				${ltmp_arr.publish_form_title}
			</div>
			<div class="content-wrapper"><div class="content">
			</div></div>
		</div>
		`;
		$('.window-wrapper').append(modal_html);
		let form_html=`
		<div class="form-input-wrapper">
			<textarea name="form-text" class="wide" placeholder="${ltmp_arr.publish_form_text}"></textarea>
		</div>`;
		if(false!==share_link){
			form_html+=`
			<div class="switch-wrapper">
			<label class="switch" for="checkbox">
			<input type="checkbox" id="checkbox" name="share" />
			<div class="slider round"></div>
			</label>
			<label class="switch-caption" for="checkbox">${ltmp_arr.publish_form_share}</label>
			</div>`;
		}
		form_html+=`<p><hr>${ltmp_arr.publish_hint}</p>`;
		form_html+='<div class="error-caption red"></div>';
		form_html+='<div class="success-caption green"></div>';
		//form_html+='<div class="button-space"></div>';
		form_html+='<div class="footer-button"><input type="button" class="publish-action wide" value="'+ltmp_arr.publish_action+'"></div>';

		$('.modal .content').html(form_html);

		$('.modal .content textarea[name=form-text]')[0].focus();

		$('.publish-action').off('click',publish_action);
		$('.publish-action').on('click',publish_action);

		$('.close-modal-action').off('click',close_modal_action);
		$('.close-modal-action').on('click',close_modal_action);
	});
}

function swap_effective_capital(){
	show_effective_shares=!show_effective_shares;
	localStorage['show_effective_shares']=show_effective_shares;
	clearTimeout(update_account_info_timer);
	update_account_info();
}

var show_effective_shares=false;
var update_account_info_timer=0;
var update_account_info_timeout=5000;
var update_account_info=function(){
	clearTimeout(update_account_info_timer);

	if(typeof localStorage['show_effective_shares'] !== 'undefined'){
		show_effective_shares=('true'==localStorage['show_effective_shares']);
	}

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
		current_custom_sequence=parseInt(localStorage['current_custom_sequence']);
	}

	if(typeof localStorage['current_withdraw'] !== 'undefined'){
		current_withdraw=parseInt(localStorage['current_withdraw']);
	}
	if(typeof localStorage['current_withdrawn'] !== 'undefined'){
		current_withdrawn=parseInt(localStorage['current_withdrawn']);
	}
	if(typeof localStorage['current_withdraw_rate'] !== 'undefined'){
		current_withdraw_rate=parseInt(localStorage['current_withdraw_rate']);
	}
	if(typeof localStorage['current_next_vesting_withdrawal'] !== 'undefined'){
		current_next_vesting_withdrawal=parseInt(localStorage['current_next_vesting_withdrawal']);
	}

	let info_html='';
	info_html+=`<div class="info-bar capital-caption">${ltmp_arr.capital_caption}: <span>`+(show_effective_shares?current_effective_shares:current_shares)+`</span> Ƶ <a class="unselectable swap-effective-capital-icon swap-effective-capital-action`+(show_effective_shares?' active':'')+`" title="${ltmp_arr.show_effective_capital}">${ltmp_icons.icon_swap}</a></div>`;
	info_html+=`<div class="info-bar balance-caption">${ltmp_arr.balance_caption}: <span>`+current_balance+`</span> Ƶ</div>`;
	info_html+=`<div class="info-bar energy-caption green">${ltmp_arr.energy_caption}: <span>`+(current_energy/100)+`</span>%</div>`;
	$('.info').html(info_html);

	$('.modal .info-bar.capital-caption span').html(current_shares);
	$('.modal.award-form .info-bar.capital-caption span').html(current_effective_shares);
	$('.modal .info-bar.balance-caption span').html(current_balance);
	$('.modal .info-bar.energy-caption span').html(current_energy/100);
	$('.modal .info-bar.income-capital-caption span').html(current_income_shares);
	$('.modal .info-bar.outcome-capital-caption span').html(current_outcome_shares);

	let buttons_html='';
	buttons_html+=`<div class="unselectable footer-buttons">`;
	if(true===users[current_user].active){
		buttons_html+=`<a class="show-stake-form" title="${ltmp_arr.stake_form_title}">${ltmp_icons.icon_stake}</a>`;
		buttons_html+=`<a class="show-unstake-form`+(current_next_vesting_withdrawal>0?' red':'')+`" title="${ltmp_arr.unstake_form_title}">${ltmp_icons.icon_unstake}</a>`;
		buttons_html+=`<a class="show-delegate-form" title="${ltmp_arr.delegate_form_title}">${ltmp_icons.icon_delegate}</a>`;
		buttons_html+=`<a class="show-wallet-form" title="${ltmp_arr.wallet_form_title}">${ltmp_icons.icon_wallet}</a>`;
	}
	buttons_html+=`<a class="show-award-form" title="${ltmp_arr.award_form_title}">${ltmp_icons.icon_gem}</a>`;
	buttons_html+=`<a class="show-publish-form" title="${ltmp_arr.publish_form_title}">${ltmp_icons.icon_publish}</a>`;


	buttons_html+=`</div>`;
	$('.buttons').html(buttons_html);

	$('.show-stake-form').off('click',show_stake_form);
	$('.show-stake-form').on('click',show_stake_form);
	$('.show-unstake-form').off('click',show_unstake_form);
	$('.show-unstake-form').on('click',show_unstake_form);
	$('.show-delegate-form').off('click',show_delegate_form);
	$('.show-delegate-form').on('click',show_delegate_form);

	$('.show-wallet-form').off('click',show_wallet_form);
	$('.show-wallet-form').on('click',show_wallet_form);
	$('.show-award-form').off('click',show_award_form);
	$('.show-award-form').on('click',show_award_form);

	$('.show-publish-form').off('click',show_publish_form);
	$('.show-publish-form').on('click',show_publish_form);

	$('.swap-effective-capital-action').off('click',swap_effective_capital);
	$('.swap-effective-capital-action').on('click',swap_effective_capital);

	update_account_info_timer=setTimeout(update_account_info,update_account_info_timeout);
}

var assigned_account=function(){
	$('.header-account').remove();
	let header=`
	<div class="header-account unselectable">
		${ltmp_icons.icon_users}
		<a class="accounts-list-action">
			${current_user}
		</a>
	</div>`;
	$('.window-wrapper').append(header);
	$('.info').html('&hellip;');
	clearTimeout(update_account_info_timer);
	setTimeout(update_account_info,250);
	setTimeout(update_account_info,1500);
	clearTimeout(update_account_info_timer);
	update_account_info_timer=setTimeout(update_account_info,3000);
	$('.accounts-list-action').off('click',accounts_list_action);
	$('.accounts-list-action').on('click',accounts_list_action);
}

function promote_page_click(e){
	e.preventDefault();
	e.stopPropagation();
	let login='social';
	let sequence='0';
	let memo=decodeURIComponent($(this).attr('data-url'));
	let id=$(this).attr('data-id');
	let beneficiaries='[]';
	let action_top = Math.round(window.screenY + (window.outerHeight / 2) - (action_height / 2))
	let action_left = Math.round(window.screenX + (window.outerWidth / 2) - (action_width / 2))
	ext_browser.runtime.sendMessage({vizonator:true,id,login,sequence,memo,beneficiaries,action_top,action_left,action_width,action_height});
	window.close();
}

function current_tab_link(callback){
	ext_browser.tabs.query({active:true},function(tabs){
		let result=false;
		if(typeof tabs[0] !== 'undefined'){
			let url=tabs[0].url;
			if(-1!=url.indexOf('#')){
				url=url.substr(0,url.indexOf('#'));
			}
			let protocol=url;
			protocol=protocol.substr(0,protocol.indexOf('://'));
			result=url;
			if('moz-extension'==protocol){
				result=false;
			}
			if('chrome'==protocol){
				result=false;
			}
			if('chrome-extension'==protocol){
				result=false;
			}
		}
		callback(result);
	});
}
function tab_info(){
	/*
	if(''==current_user){
		$('.tab').html('');
	}
	else{
		ext_browser.tabs.getSelected(null,function(tab){
			let result='';
			let url=tab.url;
			if(-1!=url.indexOf('#')){
				url=url.substr(0,url.indexOf('#'));
			}
			let protocol=url;
			protocol=protocol.substr(0,protocol.indexOf('://'));
			if('chrome'==protocol){
				$('.tab').html('');
				return false;
			}
			if('chrome-extension'==protocol){
				$('.tab').html('');
				return false;
			}
			result+='<a class="button promote-page-action" data-url="'+encodeURIComponent(url)+'" data-id="0">'+ltmp_arr.advertise_page+'</a>';
			$('.tab').html(result);
			$('.promote-page-action').off('click',promote_page_click);
			$('.promote-page-action').on('click',promote_page_click);
		});
	}
	*/
}

function show_date(str,add_time,add_seconds,remove_today){
	str=typeof str==='undefined'?false:str;
	add_time=typeof add_time==='undefined'?false:add_time;
	add_seconds=typeof add_seconds==='undefined'?false:add_seconds;
	remove_today=typeof remove_today==='undefined'?false:remove_today;
	var str_date;
	if(!str){
		str_date=new Date();
	}
	else{
		let str_time=0;
		if(str==parseInt(str)){
			str_time=str;
		}
		else{
			str_time=Date.parse(str);
		}
		str_date=new Date(str_time);
	}
	//let str_time=parseInt(str_date/1000);
	//let time_offset=parseInt((new Date().getTime() - str_date+(new Date().getTimezoneOffset()*60000))/1000);
	var day=str_date.getDate();
	if(day<10){
		day='0'+day;
	}
	var month=str_date.getMonth()+1;
	if(month<10){
		month='0'+month;
	}
	var minutes=str_date.getMinutes();
	if(minutes<10){
		minutes='0'+minutes;
	}
	var hours=str_date.getHours();
	if(hours<10){
		hours='0'+hours;
	}
	var seconds=str_date.getSeconds();
	if(seconds<10){
		seconds='0'+seconds;
	}
	var datetime_str=day+'.'+month+'.'+str_date.getFullYear();
	if(add_time){
		datetime_str=datetime_str+' '+hours+':'+minutes;
		if(add_seconds){
			datetime_str=datetime_str+':'+seconds;
		}
	}
	if(remove_today){
		datetime_str=fast_str_replace(show_date()+' ','',datetime_str);
	}
	return datetime_str;
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

function decode_memo_action(e){
	console.log(e);
	let target=$(e.target);
	let memo_str=$(target).data('text');
	let error=false;
	ext_browser.runtime.sendMessage({
		popup:true,
		operation:'decode_memo',
		memo:memo_str,
	},function(response){
		console.log('decode_memo_action response',response);
		if(false!==response.error){
			$(target).addClass('red');
		}
		else{
			$(target).off('click');
			$(target).html(response.result);
			$(target).removeAttr('data-text');
			$(target).removeClass('decode-memo-action');
		}
	});
}

function load_history_action(){
	let page=$('.modal .content');
	let last_id=parseInt($('.history-form').data('id'));
	let history_html='';
	history_html+='<div>'+last_id+'</div>';
	page.find('.load-history-action').attr('disabled','disabled');
	let operations_arr=['award','fixed_award','receive_award','transfer','transfer_to_vesting','withdraw_vesting','fill_vesting_withdraw','delegate_vesting_shares'];
	ext_browser.runtime.sendMessage({
		popup:true,
		operation:'load_history',

		last_id,
	},function(response){
		console.log('load_history_action response',response);
		if(true===response.error){
			page.find('.error-caption').html(ltmp_arr.operation_error);
			page.find('.award-action').removeAttr('disabled');
		}
		else
		if(false!==response.error){
			page.find('.error-caption').html(ltmp_arr[response.error]);
			page.find('.award-action').removeAttr('disabled');
		}
		else{
			let last_history_id=last_id;
			let history_arr=response.result;
			history_arr.reverse();
			for(let i in history_arr){
				let history_id=history_arr[i][0]
				if(0==page.find('div[data-id="'+history_id+'"]').length){
					let op_name=history_arr[i][1].op[0];
					if(-1!=operations_arr.indexOf(op_name)){
						let op_date=history_arr[i][1].timestamp;
						let op_date_str=show_date(op_date,true)+ltmp_arr.default_date_utc;
						let op=history_arr[i][1].op[1];
						let op_icon=ltmp_icons.icon_history;
						let data='';
						if('award'==op_name){
							op_icon=ltmp_icons.icon_gem;
							let decode_memo=false;
							if(0==op.memo.indexOf('#')){
								decode_memo=true;
							}
							data=ltmp(ltmp_arr.history_award,{receiver:op.receiver,energy:op.energy/100});
							if(''!=op.memo){
								let memo=escape_html(op.memo);
								if(memo.length<=50){
									data+=ltmp_arr.history_award_memo+'<span class="view-memo'+(decode_memo?' decode-memo-action':'')+'">'+memo+'</span>';
								}
								else{
									data+=ltmp_arr.history_award_memo+'<span class="view-memo'+(decode_memo?' decode-memo-action':'')+'" data-text="'+memo+'">'+memo.substr(0,50)+'&hellip;</span>';
								}
							}
						}
						if('fixed_award'==op_name){
							op_icon=ltmp_icons.icon_gem;
							let decode_memo=false;
							if(0==op.memo.indexOf('#')){
								decode_memo=true;
							}
							data=ltmp(ltmp_arr.history_fixed_award,{receiver:op.receiver,reward_amount:op.reward_amount});
							if(''!=op.memo){
								let memo=escape_html(op.memo);
								if(memo.length<=50){
									data+=ltmp_arr.history_award_memo+'<span class="view-memo'+(decode_memo?' decode-memo-action':'')+'">'+memo+'</span>';
								}
								else{
									data+=ltmp_arr.history_award_memo+'<span class="view-memo'+(decode_memo?' decode-memo-action':'')+'" data-text="'+memo+'">'+memo.substr(0,50)+'&hellip;</span>';
								}
							}
						}
						if('receive_award'==op_name){
							let decode_memo=false;
							if(0==op.memo.indexOf('#')){
								decode_memo=true;
							}
							data=ltmp(ltmp_arr.history_receive_award,{shares:parseFloat(op.shares).toFixed(3),initiator:op.initiator});
							if(''!=op.memo){
								let memo=escape_html(op.memo);
								if(memo.length<=50){
									data+=ltmp_arr.history_award_memo+'<span class="view-memo'+(decode_memo?' decode-memo-action':'')+'">'+memo+'</span>';
								}
								else{
									data+=ltmp_arr.history_award_memo+'<span class="view-memo'+(decode_memo?' decode-memo-action':'')+'" data-text="'+memo+'">'+memo.substr(0,50)+'&hellip;</span>';
								}
							}
						}
						if('delegate_vesting_shares'==op_name){
							op_icon=ltmp_icons.icon_delegate;
							if(current_user==op.delegator){
								if('0.000000 SHARES'==op.vesting_shares){
									data=ltmp(ltmp_arr.history_revoke_delegate_vesting_shares,{delegatee:op.delegatee});
								}
								else{
									data=ltmp(ltmp_arr.history_delegate_vesting_shares,{shares:parseFloat(op.vesting_shares).toFixed(3),delegatee:op.delegatee});
								}
							}
							else{
								if('0.000000 SHARES'==op.vesting_shares){
									data=ltmp(ltmp_arr.history_income_revoke_delegate_vesting_shares,{delegator:op.delegator});
								}
								else{
									data=ltmp(ltmp_arr.history_income_delegate_vesting_shares,{shares:parseFloat(op.vesting_shares).toFixed(3),delegator:op.delegator});
								}
							}
						}
						/*
						if('create_invite'==op_name){
							data=ltmp(ltmp_arr.history_create_invite,{tokens:parseFloat(op.balance).toFixed(3),key:op.invite_key});
						}
						if('claim_invite_balance'==op_name){
							if(current_user==op.receiver){
								data=ltmp(ltmp_arr.history_claim_invite_balance,{key:op.invite_secret});
							}
						}
						if('use_invite_balance'==op_name){
							if(current_user==op.receiver){
								data=ltmp(ltmp_arr.history_use_invite_balance,{key:op.invite_secret});
							}
						}
						*/
						if('transfer'==op_name){
							op_icon=ltmp_icons.icon_wallet;
							let decode_memo=false;
							if(0==op.memo.indexOf('#')){
								decode_memo=true;
							}
							if(current_user==op.from){
								data=ltmp(ltmp_arr.history_transfer_from,{tokens:parseFloat(op.amount).toFixed(3),to:op.to});
								if(''!=op.memo){
									let memo=escape_html(op.memo);
									if(memo.length<=50){
										data+=ltmp_arr.history_transfer_memo+'<span class="view-memo'+(decode_memo?' decode-memo-action':'')+'">'+memo+'</span>';
									}
									else{
										data+=ltmp_arr.history_transfer_memo+'<span class="view-memo'+(decode_memo?' decode-memo-action':'')+'" data-text="'+memo+'">'+memo.substr(0,50)+'&hellip;</span>';
									}
								}
							}
							else{
								data=ltmp(ltmp_arr.history_transfer_to,{tokens:parseFloat(op.amount).toFixed(3),from:op.from});
								if(''!=op.memo){
									let memo=escape_html(op.memo);
									if(memo.length<=50){
										data+=ltmp_arr.history_transfer_memo+'<span class="view-memo'+(decode_memo?' decode-memo-action':'')+'">'+memo+'</span>';
									}
									else{
										data+=ltmp_arr.history_transfer_memo+'<span class="view-memo'+(decode_memo?' decode-memo-action':'')+'" data-text="'+memo+'">'+memo.substr(0,50)+'&hellip;</span>';
									}
								}
							}
						}
						if('transfer_to_vesting'==op_name){
							op_icon=ltmp_icons.icon_stake;
							if(current_user==op.from){
								data=ltmp(ltmp_arr.history_transfer_to_vesting_from,{tokens:parseFloat(op.amount).toFixed(3),to:op.to});
							}
							else{
								data=ltmp(ltmp_arr.history_transfer_to_vesting_to,{tokens:parseFloat(op.amount).toFixed(3),from:op.from});
							}
						}
						if('withdraw_vesting'==op_name){
							op_icon=ltmp_icons.icon_unstake;
							if('0.000000 SHARES'==op.vesting_shares){
								data=ltmp_arr.history_withdraw_vesting_stop;
							}
							else{
								data=ltmp(ltmp_arr.history_withdraw_vesting,{shares:parseFloat(op.vesting_shares).toFixed(3)});
							}
						}
						if('fill_vesting_withdraw'==op_name){
							if(op.from_account==op.to_account){
								data=ltmp(ltmp_arr.history_fill_vesting_withdraw,{tokens:parseFloat(op.deposited).toFixed(3)});
							}
							else{
								if(current_user==op.from_account){
									data=ltmp(ltmp_arr.history_fill_vesting_withdraw_from,{to:op.to_account,tokens:parseFloat(op.deposited).toFixed(3)});
								}
								else{
									data=ltmp(ltmp_arr.history_fill_vesting_withdraw_to,{from:op.from_account,tokens:parseFloat(op.deposited).toFixed(3)});
								}
							}
						}

						page.find('.error-caption').before('<div class="history-item" data-id="'+history_id+'" data-operation="'+op_name+'"><div class="history-icon" title="'+op_date_str+'">'+op_icon+'</div><div class="history-data">'+data+'</div></div>');
						$('.history-item[data-id="'+history_id+'"] .decode-memo-action').off('click');
						$('.history-item[data-id="'+history_id+'"] .decode-memo-action').on('click',decode_memo_action);
					}
				}
				last_history_id=history_id;
			}
			$('.history-form').data('id',last_history_id);
			if(0==page.find('div.history-item').length){
				el.prepend('<div class="history-item no-results">'+ltmp_arr.default_no_items+'</div>');
			}
			else
			if(0==last_history_id){
				page.find('.success-caption').html(ltmp_arr.history_fully_load);
			}
			else{
				$('.modal .load-history-action').removeAttr('disabled');
			}
		}
	});

}
function show_history_form(){
	$('.shadow').addClass('show');
	let modal_icons=`
	<div class="header-buttons left">
		<a href="#" class="header-icon close-modal-action">`+ltmp_icons.icon_back+`</a>
	</div>`;
	let modal_html=`
	<div class="modal history-form" data-id="-1">
		${modal_icons}
		<div class="header-line">
			${ltmp_arr.history_form_title}
		</div>
		<div class="content-wrapper"><div class="content">
		</div></div>
	</div>
	`;
	$('.window-wrapper').append(modal_html);
	let form_html='';
	form_html+='<div class="error-caption red"></div>';
	form_html+='<div class="success-caption green"></div>';
	form_html+='<div class="button-space"></div>';
	form_html+='<div class="footer-button"><input type="button" class="load-history-action wide" value="'+ltmp_arr.load_history_action+'"></div>';

	$('.modal .content').html(form_html);
	load_history_action();
	$('.load-history-action').off('click',load_history_action);
	$('.load-history-action').on('click',load_history_action);

	$('.close-modal-action').off('click',close_modal_action);
	$('.close-modal-action').on('click',close_modal_action);
}

function main_app(){
	if(''==current_user){
		need_configure();
	}
	else{
		assigned_account();
	}
	tab_info();
	$('.header-buttons').remove();
	let icons=`<div class="header-buttons">
		<a href="#" class="header-icon toggle_dark_theme">`+(settings.dark?ltmp_icons.icon_theme_moon:ltmp_icons.icon_theme_sun)+`</a>`;
	if(''!=current_user)
	icons+=`<a href="#" class="header-icon show-history-form" title="${ltmp_arr.history_form_title}">${ltmp_icons.icon_history}</a>`;
	icons+=`<a href="#" class="header-icon open_settings">`+ltmp_icons.icon_settings+`</a>`;
	if(state.encoded){
		icons+=`<a href="#" class="header-icon lock-action">`+ltmp_icons.icon_lock+`</a>`
	}
	icons+=`</div>`;
	$('.window-wrapper').append(icons);
	$('.show-history-form').off('click',show_history_form);
	$('.show-history-form').on('click',show_history_form);
	$('.open_settings').off('click',options);
	$('.open_settings').on('click',options);
	$('.toggle_dark_theme').off('click',toggle_dark);
	$('.toggle_dark_theme').on('click',toggle_dark);
	$('.lock-action').off('click',lock_action);
	$('.lock-action').on('click',lock_action);
}

function toggle_dark(){
	settings.dark=!settings.dark;
	localStorage['dark']=settings.dark;
	save_state(function(){
		ext_browser.runtime.sendMessage({reload_state:true});
		if(settings.dark){
			$('body').addClass('dark');
		}
		else{
			$('body').removeClass('dark');
		}
		$('.toggle_dark_theme').html((settings.dark?ltmp_icons.icon_theme_moon:ltmp_icons.icon_theme_sun));
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
if(11==new Date().getMonth()){//december
	turbo_cat_images.push('present.png');
}
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
	});
});