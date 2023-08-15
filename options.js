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

var remove_account=function(){
	delete users[current_user];
	account={
		regular_key:'',
		memo_key:'',
		active_key:'',
	};
	current_user='';
	let users_list=Object.keys(users);
	if(0<users_list.length){
		current_user=users_list[0];
		account=users[current_user];
		save_state(function(){
			ext_browser.runtime.sendMessage({reload_state:true});
			main_app();
		});
	}
	else{
		delete localStorage['state'];

		state={};
		ext_browser.runtime.sendMessage({reload_state:true});
		$('.info').html('');
		$('.control').html('<p>'+ltmp_arr.removed_data+'</p>');
		$('.control .refresh-page').on('click',function(){
			window.location=window.location;
		});
	}
}

function rules_list(){
	let result='';
	result+='<hr><h2>'+ltmp_arr.rules_caption+'</h2>';
	for(let origin in rules){
		let rules_view='';
		rules_view+='<div class="rules closed" data-origin="'+origin+'">';
		rules_view+='<div class="origin-name">';
		rules_view+='<span>'+origin+'</span>';
		rules_view+='</div>';
		rules_view+='<div class="operations">';
		let operation_count=0;
		for(let operation in rules[origin]){
			operation_count++;
			rules_view+='<div class="operation" data-name="'+operation+'">'+(rules[origin][operation]?'<span title="approved">✔️</span>':'<span title="refused">❌</span>')+' — <span class="operation-name">'+operation+'</span> <a class="delete-rule">'+ltmp_arr.delete_rule+'</a></div>';
		}
		rules_view+='</div>';
		rules_view+='</div>';

		if(0==operation_count){
			delete rules[origin];
			save_state(function(){
				ext_browser.runtime.sendMessage({reload_state:true});
			});
		}
		else{
			result+=rules_view;
		}
	}

	$('.rules-list').html(result);
	if(0==Object.keys(rules).length){
		$('.rules-list').html('<hr><h2>'+ltmp_arr.rules_caption+'</h2><p>'+ltmp_arr.empty_rules+'</p>');
	}

	$('.origin-name').off('click');
	$('.origin-name').on('click',function(){
		if($(this).parent().hasClass('closed')){
			$(this).parent().removeClass('closed');
		}
		else{
			$(this).parent().addClass('closed');
		}
	});

	$('.delete-rule').off('click');
	$('.delete-rule').on('click',function(){
		let origin_el=$(this).closest('.rules');
		let operation_el=$(this).closest('.operation');
		delete rules[origin_el.data('origin')][operation_el.data('name')];
		operation_el.remove();
		if(0==origin_el.find('.operation').length){
			delete rules[origin_el.data('origin')];
			origin_el.remove();
		}
		save_state(function(){
			ext_browser.runtime.sendMessage({reload_state:true});
			if(0==Object.keys(rules).length){
				$('.rules-list').html('<hr><h2>'+ltmp_arr.rules_caption+'</h2><p>'+ltmp_arr.empty_rules+'</p>');
			}
		});
	});
}

var lock_view=function(){
	let result='';
	result+='<hr><h2>'+ltmp_arr.lock_caption+'</h2>';
	if(state.encoded){
		result+='<p>'+ltmp_arr.locked_descr+'<p>';
		result+='<p><input type="text" autocomplete="off" class="encode_password" value=""> &mdash; '+ltmp_arr.lock_password+'</p>';
		result+='<p><input type="button" class="update-encode" value="'+ltmp_arr.lock_update_button+'"></p>';
		result+='<p><input type="button" class="remove-encode" value="'+ltmp_arr.lock_remove_button+'"></p>';
	}
	else{
		result+='<p>'+ltmp_arr.lock_descr+'<p>';
		result+='<p><input type="text" autocomplete="off" class="encode_password" value=""> &mdash; '+ltmp_arr.lock_password+'</p>';
		result+='<p><input type="button" class="update-encode" value="'+ltmp_arr.lock_button+'"></p>';
	}
	$('.lock').html(result);
	$('.update-encode').off('click');
	$('.update-encode').on('click',function(){
		$('.update-encode').attr('disabled','disabled');
		let password=$('.encode_password').val();
		if(''!=password){
			state.encoded=true;
			state.password=password;
			save_state(function(){
				ext_browser.runtime.sendMessage({reload_state:true},function(response){
					console.log('.update-encode response',response);
					if(null===response){
						return;
					}
					lock_view();
				});
			});
		}
	});
	$('.remove-encode').off('click');
	$('.remove-encode').on('click',function(){
		$('.remove-encode').attr('disabled','disabled');
		state.encoded=false;
		state.decoded=false;
		state.password='';
		save_state(function(){
			ext_browser.runtime.sendMessage({reload_state:true},function(response){
				console.log('.remove-encode response',response);
				if(null===response){
					return;
				}
				lock_view();
			});
		});
	});
}
var need_encode=function(){
	let result='';
	//result+='<hr>';
	result+='<p class="red">'+ltmp_arr.need_encode_state+'<p>';
	$('.info').html(result);
	$('.control').html('');
	$('.settings').html('');
	$('.lock').html('');
	$('.rules-list').html('');
}

function main_app(){
	$('.caption').html('<img src="images/icon32.png" alt="logo"> '+ltmp_arr.settings_caption);
	let result='';
	result+='<p><select class="selected-lang">';
	for(let i in available_langs){
		result+='<option value="'+i+'"'+(i==settings['lang']?' selected':'')+'>'+available_langs[i]+'</option>';
	}
	result+='</select> — '+ltmp_arr.language+'</p>';
	result+='<p><input type="text" autocomplete="off" class="energy_step" value="'+(parseInt(settings['energy_step'])/100)+'"> &mdash; '+ltmp_arr.energy_step+'</p>';
	result+='<p><input type="text" autocomplete="off" class="award_energy" value="'+(parseInt(settings['award_energy'])/100)+'"> &mdash; '+ltmp_arr.award_energy+'</p>';
	result+='<p><label><input type="checkbox" class="dark-mode"'+(settings['dark']?' checked':'')+'> — '+ltmp_arr.dark_mode+'<label></p>';

	result+='<p><input type="button" class="save-settings" value="'+ltmp_arr.save_settings_caption+'"></p>';
	result+='<div class="settings_status"></div>';
	$('.settings').html(result);

	$('.save-settings').off('click');
	$('.save-settings').on('click',function(){
		$('.save-settings').attr('disabled','disabled');
		$('.settings_status').html('');
		let energy_step=parseInt(parseFloat($('.energy_step').val())*100);
		if(energy_step<=0){
			energy_step=10;
		}
		if(energy_step>100){
			energy_step=100;
		}

		let award_energy=parseInt(parseFloat($('.award_energy').val())*100);
		if(award_energy>10000){
			award_energy=10000;
		}
		award_energy=parseInt(award_energy/energy_step)*energy_step;
		if(award_energy<energy_step){
			award_energy=energy_step;
		}
		if(award_energy<=0){
			award_energy=energy_step;
		}

		let dark_mode=$('.dark-mode').prop('checked');
		let selected_lang=$('.selected-lang').val();

		$('.energy_step').val(energy_step/100);
		$('.award_energy').val(award_energy/100);
		settings={
			'energy_step':energy_step,
			'award_energy':award_energy,
			'dark':dark_mode,
			'lang':selected_lang,
		};
		localStorage['dark']=dark_mode;
		localStorage['lang']=selected_lang;
		save_state(function(){
			ext_browser.runtime.sendMessage({reload_state:true});
			$('.settings_status').html('<p>✔️ '+ltmp_arr.saved+' '+new Date()+'</p>');
			$('.save-settings').removeAttr('disabled');
			setTimeout(function(){
				get_state(function(status){

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
			},1000);
		});
	});

	if(''!=current_user){
		$('.info').html('<p>'+ltmp_arr.current_status+': <span class="status">&mdash;</span></p>');
		$('.info .status').html('<span class="green">'+ltmp(ltmp_arr.status_used_account,{account:current_user})+'</span>');
		$('.info .status').html($('.info .status').html()
			+(!account['memo']?' <span class="red dotted" title="'+ltmp_arr.empty_memo_title+'">&minus;memo</span>':' <span class="dashed" title="'+ltmp_arr.memo_title+'">+memo</span>')
			+(!account['active']?' <span class="red dotted" title="'+ltmp_arr.empty_active_title+'">&minus;active</span>':' <span class="dashed" title="'+ltmp_arr.active_title+'">+active</span>')
		);
		let result='';
		let users_count=Object.keys(users).length;
		result+='<p><input type="button" class="remove-account" value="'+(1!=users_count?ltmp_arr.remove_account_caption:ltmp_arr.remove_last_account_caption)+'"></p>';
		$('.control').html(result);
		$('.remove-account').on('click',remove_account);

		lock_view();
		rules_list();
	}
	else{
		$('.lock').html('');
		$('.rules-list').html('');
		$('.info').html('<p>'+ltmp_arr.current_status+': <span class="status">&mdash;</span></p>');
		$('.info .status').html('<span style="color:red;font-weight:bold;">'+ltmp_arr.empty_account+'</span>');
		let result='';
		result+='<p>'+ltmp_arr.connect_account+':</p>';
		result+='<p><input type="text" autocomplete="off" class="login"> &mdash; '+ltmp_arr.form_login+' <span class="red">*</span></p>';
		result+='<p><input type="password" autocomplete="off" class="regular_key"> &mdash; '+ltmp_arr.form_regular_key+' <span class="red">*</span></p>';
		result+='<p><input type="password" autocomplete="off" class="memo_key"> &mdash; '+ltmp_arr.form_memo_key+' (<span class="dotted" title="'+ltmp_arr.form_memo_key_descr+'">'+ltmp_arr.form_optional+'</span>)</p>';
		result+='<p><input type="password" autocomplete="off" class="active_key"> &mdash; '+ltmp_arr.form_active_key+' (<span class="dotted" title="'+ltmp_arr.form_active_key_descr+'">'+ltmp_arr.form_optional+'</span>)</p>';
		result+='<div class="error" style="color:red;"></div>';
		result+='<p><input type="button" class="save-account" value="'+ltmp_arr.form_save_caption+'"></p>';
		$('.control').html(result);
		$('.save-account').on('click',function(){
			$('.error').html('');
			$('.save-account').attr('disabled','disabled');
			let new_user=$('.login').val();
			new_user=new_user.trim();
			if('@'==new_user.substring(0,1)){
				new_user=new_user.substring(1);
			}
			new_user=new_user.toLowerCase();

			let regular_valid=false;
			let memo_valid=false;
			let active_valid=false;

			let regular_key=$('.regular_key').val();
			regular_key=regular_key.trim();

			let memo_key=$('.memo_key').val();
			memo_key=memo_key.trim();

			let active_key=$('.active_key').val();
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

				save_state(function(){
					ext_browser.runtime.sendMessage({reload_state:true});
					$('.error').html('');
					$('.save-account').removeAttr('disabled');
					$('.info .status').html('<span class="green">'+ltmp(ltmp_arr.status_used_account,{account:current_user})+'</span>');
					$('.info .status').html($('.info .status').html()
						+(''==account['memo_key']?' <span class="red dotted" title="'+ltmp_arr.empty_memo_title+'">&minus;memo</span>':' <span class="dashed" title="'+ltmp_arr.memo_title+'">+memo</span>')
						+(''==account['active_key']?' <span class="red dotted" title="'+ltmp_arr.empty_active_title+'">&minus;active</span>':' <span class="dashed" title="'+ltmp_arr.active_title+'">+active</span>')
					);
					let result='';
					result+='<p><input type="button" class="remove-account" value="'+ltmp_arr.remove_account_caption+'"></p>';
					$('.control').html(result);
					$('.remove-account').on('click',remove_account);

					lock_view();
					rules_list();
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
				$('.error').html(ltmp_arr.form_invalid_keys+invalid_keys.join(', '));
				$('.save-account').removeAttr('disabled');
			}
		});
	}
}

$(function(){
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