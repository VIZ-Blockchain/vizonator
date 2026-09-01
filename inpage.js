if(typeof window.vizonator == 'undefined'){
	function bind_event_callback(event_action,event_num,event_action_data,callback){
		if(window.vizonator.debug)
			console.log('Vizonator inpage: bind action '+event_action+' event_callback #'+event_num);
		document.addEventListener('vizonator_'+event_num,function(event){
			let data=event.detail;
			let data_obj=JSON.parse(data);
			//if(window.vizonator.debug)
				console.log('Vizonator inpage: get action '+event_action+' event_callback #'+event_num,data_obj);
			callback(data_obj.error,data_obj.result);
		});
		document.dispatchEvent(new CustomEvent('vizonator',{detail:JSON.stringify({'event':event_num,'action':event_action,'data':event_action_data})}));
	}
	window.vizonator={
		'activated':true,
		'debug':false,
		'loaded_time':new Date().getTime / 1000 | 0,
		'event_numerator':0,
		'get_account':function(callback){
			let event_num=this.event_numerator;
			this.event_numerator++;
			bind_event_callback('get_account',event_num,false,callback);
		},
		'get_settings':function(callback){
			let event_num=this.event_numerator;
			this.event_numerator++;
			bind_event_callback('get_settings',event_num,false,callback);
		},
		'import_account':function(account,regular_key,active_key,memo_key,callback){
			let event_num=this.event_numerator;
			this.event_numerator++;
			bind_event_callback('import_account',event_num,{account,regular_key,active_key,memo_key},callback);
		},
		'award':function(data,callback){
			let event_num=this.event_numerator;
			this.event_numerator++;
			bind_event_callback('award',event_num,data,callback);
		},
		'fixed_award':function(data,callback){
			let event_num=this.event_numerator;
			this.event_numerator++;
			bind_event_callback('fixed_award',event_num,data,callback);
		},
		'transfer':function(data,callback){
			let event_num=this.event_numerator;
			this.event_numerator++;
			bind_event_callback('transfer',event_num,data,callback);
		},
		'transfer_to_vesting':function(data,callback){
			let event_num=this.event_numerator;
			this.event_numerator++;
			bind_event_callback('transfer_to_vesting',event_num,data,callback);
		},
		'withdraw_vesting':function(data,callback){
			let event_num=this.event_numerator;
			this.event_numerator++;
			bind_event_callback('withdraw_vesting',event_num,data,callback);
		},
		'delegate_vesting_shares':function(data,callback){
			let event_num=this.event_numerator;
			this.event_numerator++;
			bind_event_callback('delegate_vesting_shares',event_num,data,callback);
		},
		'committee_vote_request':function(data,callback){
			let event_num=this.event_numerator;
			this.event_numerator++;
			bind_event_callback('committee_vote_request',event_num,data,callback);
		},
		'custom':function(data,callback){
			let event_num=this.event_numerator;
			this.event_numerator++;
			bind_event_callback('custom',event_num,data,callback);
		},
		'get_custom_account':function(account,protocol_id,callback){
			let event_num=this.event_numerator;
			this.event_numerator++;
			bind_event_callback('get_custom_account',event_num,{account,protocol_id},callback);
		},
		'get_account_history':function(account,from,limit,callback){
			let event_num=this.event_numerator;
			this.event_numerator++;
			bind_event_callback('get_account_history',event_num,{account,from,limit},callback);
		},
		'get_accounts_on_sale':function(from,limit,callback){
			let event_num=this.event_numerator;
			this.event_numerator++;
			bind_event_callback('get_accounts_on_sale',event_num,{from,limit},callback);
		},
		'get_subaccounts_on_sale':function(from,limit,callback){
			let event_num=this.event_numerator;
			this.event_numerator++;
			bind_event_callback('get_subaccounts_on_sale',event_num,{from,limit},callback);
		},
		'account_metadata':function(data,callback){
			let event_num=this.event_numerator;
			this.event_numerator++;
			bind_event_callback('account_metadata',event_num,data,callback);
		},
		'passwordless_auth':function(data,callback){
			let event_num=this.event_numerator;
			this.event_numerator++;
			bind_event_callback('passwordless_auth',event_num,data,callback);
		},
		'sign_data':function(data,callback){
			let event_num=this.event_numerator;
			this.event_numerator++;
			bind_event_callback('sign_data',event_num,data,callback);
		},
	};
	/* prediction-market operations: one forwarder per operation, generated from the
	   shared table (pm_ops.js is injected into the page right before this file) */
	if(typeof window.VIZ_PM_OPS !== 'undefined'){
		window.VIZ_PM_OPS.names.forEach(function(pm_operation){
			window.vizonator[pm_operation]=function(data,callback){
				let event_num=window.vizonator.event_numerator;
				window.vizonator.event_numerator++;
				bind_event_callback(pm_operation,event_num,data,callback);
			};
		});
		/* the table is only needed while building the methods above — do not leave it
		   lying around in the page global scope */
		try{delete window.VIZ_PM_OPS;}catch(e){window.VIZ_PM_OPS=undefined;}
	}
	if(typeof window.vizonator_on_load == 'function'){
		window.vizonator_on_load();
	}
}
