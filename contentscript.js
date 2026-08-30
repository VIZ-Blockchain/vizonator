if(typeof window.vizonator_contentscript === 'undefined'){
window.vizonator_contentscript=true;
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
let width_addon=16;
let height_addon=36;
if(ext_firefox){
	height_addon=46;
}
var action_width=330+width_addon;
var action_height=450+height_addon;
var action_top = Math.round(window.screenY + (window.outerHeight / 2) - (action_height / 2))
var action_left = Math.round(window.screenX + (window.outerWidth / 2) - (action_width / 2))

//bind to receiver inpage operations from extension background proccess
ext_browser.runtime.onMessage.addListener(function(request,sender,sendResponse){
	//console.log('Vizonator message from',sender);
	if(!sender.tab){//from extension?
		if(extension_id==sender.id){//from extension!
			console.log('Vizonator extension response',request);
			document.dispatchEvent(new CustomEvent('vizonator_'+request.event,{detail:JSON.stringify(request.data)}));
		}
	}
});

//bind to receive inpage events
document.addEventListener('vizonator',function(event){
	let event_data=event.detail;
	let data_obj=JSON.parse(event_data);//event,action,data
	let data={}
	if(typeof data_obj.data !== 'undefined'){
		data=data_obj.data;
	}
	console.log('Vizonator: listener received',data_obj);

	let error=true;
	let result=false;

	if('get_account'==data_obj.action){
		ext_browser.runtime.sendMessage({
			inpage:true,
			operation:'get_account',
			operation_type:['account'],
			event:data_obj.event,

			action_top,action_left,action_width,action_height
		});
		/*
		ext_browser.runtime.sendMessage({vizonator_account:true},function(response){
			if(''==response.account.login){
				error=false;
			}
			else{
				error=false;
				result=response.account;
			}
			document.dispatchEvent(new CustomEvent('vizonator_'+data_obj.event,{detail:JSON.stringify({'error':error,'result':result})}));
		});
		*/
	}
	else
	if('get_settings'==data_obj.action){
		ext_browser.runtime.sendMessage({
			inpage:true,
			operation:'get_settings',
			operation_type:['settings'],
			event:data_obj.event,

			action_top,action_left,action_width,action_height
		});
	}
	else
	if('award'==data_obj.action){
		if(typeof data.receiver == 'undefined'){
			error='empty receiver';
			document.dispatchEvent(new CustomEvent('vizonator_'+data_obj.event,{detail:JSON.stringify({'error':error,'result':result})}));
		}
		else{
			let beneficiaries=decodeURIComponent('[]');
			if(typeof data.beneficiaries != 'undefined'){
				beneficiaries=data.beneficiaries;
			}
			ext_browser.runtime.sendMessage({
				inpage:true,
				operation:'award',
				operation_type:['award','regular'],
				event:data_obj.event,

				receiver:data.receiver,
				energy:('undefined' == typeof data.energy?false:data.energy),
				custom_sequence:('undefined' == typeof data.custom_sequence?0:data.custom_sequence),
				memo:('undefined' == typeof data.memo?'':data.memo),
				beneficiaries,

				force_memo_encoding:('undefined' == typeof data.force_memo_encoding?false:data.force_memo_encoding),

				action_top,action_left,action_width,action_height
			});
		}
	}
	else
	if('fixed_award'==data_obj.action){
		if(typeof data.receiver == 'undefined'){
			error='empty receiver';
			document.dispatchEvent(new CustomEvent('vizonator_'+data_obj.event,{detail:JSON.stringify({'error':error,'result':result})}));
		}
		else{
			let beneficiaries=decodeURIComponent('[]');
			if(typeof data.beneficiaries != 'undefined'){
				beneficiaries=data.beneficiaries;
			}
			ext_browser.runtime.sendMessage({
				inpage:true,
				operation:'fixed_award',
				operation_type:['award','regular'],
				event:data_obj.event,

				receiver:data.receiver,
				reward_amount:data.reward_amount,
				max_energy:('undefined' == typeof data.max_energy?false:data.max_energy),
				custom_sequence:('undefined' == typeof data.custom_sequence?0:data.custom_sequence),
				memo:('undefined' == typeof data.memo?'':data.memo),
				beneficiaries,

				force_memo_encoding:('undefined' == typeof data.force_memo_encoding?false:data.force_memo_encoding),

				action_top,action_left,action_width,action_height
			});
		}
	}
	else
	if('import_account'==data_obj.action){
		if(typeof data.account == 'undefined'){
			error='empty account';
			document.dispatchEvent(new CustomEvent('vizonator_'+data_obj.event,{detail:JSON.stringify({'error':error,'result':result})}));
		}
		else{
			let need_key=false;
			if(typeof data.regular_key == 'undefined'){
				data.regular_key=false;
			}
			if(typeof data.active_key == 'undefined'){
				data.active_key=false;
			}
			if(typeof data.memo_key == 'undefined'){
				data.memo_key=false;
			}
			if(false==data.regular_key && false==data.active_key){
				need_key=true;
			}

			if(need_key){
				error='need key';
				document.dispatchEvent(new CustomEvent('vizonator_'+data_obj.event,{detail:JSON.stringify({'error':error,'result':result})}));
			}
			else{
				ext_browser.runtime.sendMessage({
					inpage:true,
					operation:'import_account',
					operation_type:['account'],
					event:data_obj.event,

					account:data.account,
					regular_key:data.regular_key,
					active_key:data.active_key,
					memo_key:data.memo_key,

					action_top,action_left,action_width,action_height
				});
			}
		}
	}
	else
	if('transfer'==data_obj.action){
		if(typeof data.to == 'undefined'){
			error='empty to';
			document.dispatchEvent(new CustomEvent('vizonator_'+data_obj.event,{detail:JSON.stringify({'error':error,'result':result})}));
		}
		else
		if(typeof data.amount == 'undefined'){
			error='empty amount';
			document.dispatchEvent(new CustomEvent('vizonator_'+data_obj.event,{detail:JSON.stringify({'error':error,'result':result})}));
		}
		else{
			ext_browser.runtime.sendMessage({
				inpage:true,
				operation:'transfer',
				operation_type:['transfer','active'],
				event:data_obj.event,

				to:data.to,
				amount:data.amount,
				memo:('undefined' == typeof data.memo?'':data.memo),

				force_memo_encoding:('undefined' == typeof data.force_memo_encoding?false:data.force_memo_encoding),

				action_top,action_left,action_width,action_height
			});
		}
	}
	else
	if('transfer_to_vesting'==data_obj.action){
		if(typeof data.to == 'undefined'){
			error='empty to';
			document.dispatchEvent(new CustomEvent('vizonator_'+data_obj.event,{detail:JSON.stringify({'error':error,'result':result})}));
		}
		else
		if(typeof data.amount == 'undefined'){
			error='empty amount';
			document.dispatchEvent(new CustomEvent('vizonator_'+data_obj.event,{detail:JSON.stringify({'error':error,'result':result})}));
		}
		else{
			ext_browser.runtime.sendMessage({
				inpage:true,
				operation:'transfer_to_vesting',
				operation_type:['vesting','active'],
				event:data_obj.event,

				to:data.to,
				amount:data.amount,

				action_top,action_left,action_width,action_height
			});
		}
	}
	else
	if('withdraw_vesting'==data_obj.action){
		if(typeof data.vesting_shares == 'undefined'){
			error='empty vesting shares';
			document.dispatchEvent(new CustomEvent('vizonator_'+data_obj.event,{detail:JSON.stringify({'error':error,'result':result})}));
		}
		else{
			ext_browser.runtime.sendMessage({
				inpage:true,
				operation:'withdraw_vesting',
				operation_type:['vesting','active'],
				event:data_obj.event,

				vesting_shares:data.vesting_shares,

				action_top,action_left,action_width,action_height
			});
		}
	}
	else
	if('delegate_vesting_shares'==data_obj.action){
		if(typeof data.delegatee == 'undefined'){
			error='empty delegatee';
			document.dispatchEvent(new CustomEvent('vizonator_'+data_obj.event,{detail:JSON.stringify({'error':error,'result':result})}));
		}
		else
		if(typeof data.vesting_shares == 'undefined'){
			error='empty vesting shares';
			document.dispatchEvent(new CustomEvent('vizonator_'+data_obj.event,{detail:JSON.stringify({'error':error,'result':result})}));
		}
		else{
			ext_browser.runtime.sendMessage({
				inpage:true,
				operation:'delegate_vesting_shares',
				operation_type:['delegate','active'],
				event:data_obj.event,

				delegatee:data.delegatee,
				vesting_shares:data.vesting_shares,

				action_top,action_left,action_width,action_height
			});
		}
	}
	else
	if('committee_vote_request'==data_obj.action){
		if(typeof data.request_id == 'undefined'){
			error='empty request id';
			document.dispatchEvent(new CustomEvent('vizonator_'+data_obj.event,{detail:JSON.stringify({'error':error,'result':result})}));
		}
		else
		if(typeof data.vote_percent == 'undefined'){
			error='empty vote percent';
			document.dispatchEvent(new CustomEvent('vizonator_'+data_obj.event,{detail:JSON.stringify({'error':error,'result':result})}));
		}
		else{
			ext_browser.runtime.sendMessage({
				inpage:true,
				operation:'committee_vote_request',
				operation_type:['committee','regular'],
				event:data_obj.event,

				request_id:data.request_id,
				vote_percent:data.vote_percent,

				action_top,action_left,action_width,action_height
			});
		}
	}
	else
	if('custom'==data_obj.action){
		if(typeof data.authority == 'undefined'){
			data.authority='regular';
		}
		if(data.authority!='active'){
			data.authority='regular';
		}
		if(typeof data.id == 'undefined'){
			error='empty custom id';
			document.dispatchEvent(new CustomEvent('vizonator_'+data_obj.event,{detail:JSON.stringify({'error':error,'result':result})}));
		}
		else
		if(typeof data.json == 'undefined'){
			error='empty custom json';
			document.dispatchEvent(new CustomEvent('vizonator_'+data_obj.event,{detail:JSON.stringify({'error':error,'result':result})}));
		}
		else{
			ext_browser.runtime.sendMessage({
				inpage:true,
				operation:'custom',
				operation_type:['custom','protocol_'+data.id,data.authority],
				event:data_obj.event,

				authority:data.authority,//regular or active
				protocol_id:data.id,
				json:data.json,

				action_top,action_left,action_width,action_height
			});
		}
	}
	else
	if('get_custom_account'==data_obj.action){
		if(typeof data.account == 'undefined'){
			data.account=false;
		}
		else{
			if(''==data.account){
				data.account=false;
			}
		}
		if(typeof data.protocol_id == 'undefined'){
			data.protocol_id=false;
		}
		ext_browser.runtime.sendMessage({
			inpage:true,
			operation:'get_custom_account',
			operation_type:['account','api'],
			event:data_obj.event,

			account:data.account,
			protocol_id:data.protocol_id,

			action_top,action_left,action_width,action_height
		});
	}
	else
	if('get_account_history'==data_obj.action){
		if(typeof data.account == 'undefined'){
			data.account=false;
		}
		else{
			if(''==data.account){
				data.account=false;
			}
		}
		if(typeof data.from == 'undefined'){
			data.from=-1;
		}
		if(false===data.from){
			data.from=-1;
		}
		if(typeof data.limit == 'undefined'){
			data.limit=50;
		}
		if(false===data.limit){
			data.limit=50;
		}
		ext_browser.runtime.sendMessage({
			inpage:true,
			operation:'get_account_history',
			operation_type:['account','api'],
			event:data_obj.event,

			account:data.account,
			from:data.from,
			limit:data.limit,

			action_top,action_left,action_width,action_height
		});
	}
	else
	if('get_accounts_on_sale'==data_obj.action){
		if(typeof data.from == 'undefined'){
			data.from=0;
		}
		if(false===data.from){
			data.from=0;
		}
		if(typeof data.limit == 'undefined'){
			data.limit=100;
		}
		if(false===data.limit){
			data.limit=100;
		}
		ext_browser.runtime.sendMessage({
			inpage:true,
			operation:'get_accounts_on_sale',
			operation_type:['account','api'],
			event:data_obj.event,

			from:data.from,
			limit:data.limit,

			action_top,action_left,action_width,action_height
		});
	}
	else
	if('get_subaccounts_on_sale'==data_obj.action){
		if(typeof data.from == 'undefined'){
			data.from=0;
		}
		if(false===data.from){
			data.from=0;
		}
		if(typeof data.limit == 'undefined'){
			data.limit=100;
		}
		if(false===data.limit){
			data.limit=100;
		}
		ext_browser.runtime.sendMessage({
			inpage:true,
			operation:'get_subaccounts_on_sale',
			operation_type:['account','api'],
			event:data_obj.event,

			from:data.from,
			limit:data.limit,

			action_top,action_left,action_width,action_height
		});
	}
	else
	if('account_metadata'==data_obj.action){
		if(typeof data.json == 'undefined'){
			error='empty json';
			document.dispatchEvent(new CustomEvent('vizonator_'+data_obj.event,{detail:JSON.stringify({'error':error,'result':result})}));
		}
		else{
			ext_browser.runtime.sendMessage({
				inpage:true,
				operation:'account_metadata',
				operation_type:['meta','regular','account'],
				event:data_obj.event,

				json:data.json,

				action_top,action_left,action_width,action_height
			});
		}
	}
	else
	if('passwordless_auth'==data_obj.action){
		if(typeof data.authority == 'undefined'){
			data.authority='regular';
		}
		else{
			if('active'!=data.authority){
				data.authority='regular';
			}
		}
		ext_browser.runtime.sendMessage({
			inpage:true,
			operation:'passwordless_auth',
			operation_type:['auth','account',data.authority],
			event:data_obj.event,

			authority:data.authority,

			action_top,action_left,action_width,action_height
		});
	}
	else
	if('sign_data'==data_obj.action){
		if(typeof data.data == 'undefined'){
			error='empty data';
			document.dispatchEvent(new CustomEvent('vizonator_'+data_obj.event,{detail:JSON.stringify({'error':error,'result':result})}));
		}
		else{
			if(typeof data.authority == 'undefined'){
				data.authority='regular';
			}
			else{
				if('active'!=data.authority){
					data.authority='regular';
				}
			}
			ext_browser.runtime.sendMessage({
				inpage:true,
				operation:'sign_data',
				operation_type:['sign','account',data.authority],
				event:data_obj.event,

				authority:data.authority,
				data_to_sign:data.data,

				action_top,action_left,action_width,action_height
			});
		}
	}
});

}