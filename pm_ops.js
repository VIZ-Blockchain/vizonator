/* Shared table of broadcastable prediction-market operations (VIZ HF14 / Onix).

   Sources of truth:
     - field names and types: viz-js-lib src/auth/serializer/src/operations.js
       (that serializer is byte-verified against the node's FC_REFLECT);
     - required authority: get_required_{active,regular}_authorities in the node's
       libraries/protocol/include/graphene/protocol/pm_operations.hpp.

   `actor` is the account field the operation is signed for. The extension ALWAYS
   fills it with the current user and never takes it from the page: a dApp must not
   be able to ask for an operation on behalf of somebody else.

   Field entry: [name, type, required]. Types drive the default for an omitted
   optional field (string -> '', bool -> false, int/uint -> 0) and the rendering of
   the confirmation window. `asset` and every identifier are required — an id has no
   safe default (market 0 is a real market), and money is never guessed.

   Loaded by: background.js (importScripts), operation.html, inpage.js (MAIN world).
   Virtual operations are intentionally absent: they are never broadcast by a client. */
(function(root){
	var ops={
		pm_oracle_register:{authority:'active',actor:'owner',fields:[
			['insurance','asset',true],
			['fee_percent','uint',false],
			['fixed_fee','asset',true],
			['rules_url','string',false],
			['auto_accept_creator','string',false],
			['auto_accept_resolver','string',false],
			['auto_accept','bool',false]
		]},
		/* every change field is optional<> on the wire: an omitted field means
		   "leave as is", so it must stay absent instead of being defaulted */
		pm_oracle_update:{authority:'active',actor:'owner',fields:[
			['insurance_delta','optional',false],
			['fee_percent','optional',false],
			['fixed_fee','optional',false],
			['rules_url','optional',false],
			['auto_accept_creator','optional',false],
			['auto_accept_resolver','optional',false],
			['auto_accept','optional',false]
		]},
		pm_create_market:{authority:'active',actor:'creator',fields:[
			['oracle','string',true],
			['market_type','uint',false],
			['outcomes','array',true],
			['url','string',false],
			['oracle_fee_percent','uint',false],
			['oracle_fixed_fee','asset',true],
			['creator_fee_percent','uint',false],
			['liquidity_fee_percent','uint',false],
			['liquidity','asset',true],
			['lmsr_b','int',false],
			['betting_expiration','time',true],
			['result_expiration','time',true],
			['time_penalty_type','uint',false],
			['time_penalty_value','uint',false],
			['penalty_curve_type','uint',false],
			['allow_early_resolution','bool',false],
			['allow_cancellation','bool',false],
			['allow_batch','bool',false],
			['allow_instant_bet','bool',false],
			['endogeneity_tier','uint',false],
			['dispute_mode','uint',false],
			['dispute_resolver','string',false],
			['dispute_penalty_percent','int',false],
			['metadata','string',false]
		]},
		pm_oracle_accept_market:{authority:'active',actor:'oracle',fields:[
			['market_id','int',true],
			['accept','bool',false],
			['oracle_fee_percent','uint',false],
			['oracle_fixed_fee','asset',true]
		]},
		pm_place_bet:{authority:'active',actor:'account',fields:[
			['market_id','int',true],
			['side','int',true],
			['outcome_index','int',true],
			['amount','asset',true],
			['min_tokens','int',false],
			['mode','uint',false]
		]},
		pm_commit_bet:{authority:'active',actor:'account',fields:[
			['market_id','int',true],
			['commitment','string',true],
			['escrow_amount','asset',true],
			['no_reveal_fee_percent','uint',true]
		]},
		pm_reveal_bet:{authority:'active',actor:'account',fields:[
			['commit_id','int',true],
			['side','int',true],
			['outcome_index','int',true],
			['amount','asset',true],
			['salt','string',true],
			['min_tokens','int',false]
		]},
		pm_cancel_bet:{authority:'active',actor:'account',fields:[
			['bet_id','int',true],
			['min_return','int',false]
		]},
		pm_add_liquidity:{authority:'active',actor:'provider',fields:[
			['market_id','int',true],
			['amount','asset',true]
		]},
		pm_withdraw_liquidity:{authority:'active',actor:'provider',fields:[
			['liquidity_id','int',true],
			['amount','asset',true]
		]},
		pm_resolve_market:{authority:'active',actor:'oracle',fields:[
			['market_id','int',true],
			['winning_outcome','int',true],
			['decision_url','string',false],
			['decision_reason','string',false]
		]},
		pm_no_contest:{authority:'active',actor:'oracle',fields:[
			['market_id','int',true],
			['reason','string',false]
		]},
		pm_dispute_create:{authority:'active',actor:'disputer',fields:[
			['market_id','int',true],
			['proposed_outcome','int',true],
			['reason','string',false]
		]},
		pm_dispute_vote:{authority:'regular',actor:'voter',fields:[
			['market_id','int',true],
			['vote_outcome','int',true],
			['vote_percent','int',true]
		]},
		pm_dispute_resolve:{authority:'active',actor:'resolver',fields:[
			['market_id','int',true],
			['correct_outcome','int',true],
			['penalty_amount','asset',true],
			['ban_oracle','bool',false],
			['ban_oracle_until','time',true],
			['ban_creator','bool',false],
			['ban_creator_until','time',true]
		]},
		pm_dispute_oracle_respond:{authority:'active',actor:'oracle',fields:[
			['market_id','int',true],
			['response','string',true]
		]},
		pm_unban:{authority:'active',actor:'resolver',fields:[
			['target','string',true],
			['unban_oracle','bool',false],
			['unban_creator','bool',false]
		]},
		pm_transfer_position:{authority:'active',actor:'from',fields:[
			['bet_id','int',true],
			['to','string',true],
			['amount','int',true],
			['memo','string',false]
		]},
		pm_lazy_deposit:{authority:'active',actor:'account',fields:[
			['amount','asset',true]
		]},
		pm_lazy_withdraw:{authority:'active',actor:'account',fields:[
			['shares','int',true],
			['emergency','bool',false]
		]},
		pm_leverage_open:{authority:'active',actor:'account',fields:[
			['market_id','int',true],
			['outcome_index','int',true],
			['collateral','asset',true],
			['loan','asset',true],
			['min_tokens','int',false],
			['max_slippage_percent','uint',false]
		]},
		pm_leverage_close:{authority:'active',actor:'account',fields:[
			['position_id','int',true],
			['min_return','int',false]
		]},
		pm_leverage_convert:{authority:'active',actor:'account',fields:[
			['position_id','int',true],
			['conversion_profit_cost','uint',false]
		]}
	};

	var names=[];
	for(var op in ops){names.push(op);}

	/* pm_place_bet -> pmPlaceBet (same rule viz-js-lib uses to name broadcast methods) */
	function method_name(op){
		return op.replace(/_([a-z0-9])/g,function(m,c){return c.toUpperCase();});
	}

	function default_value(type){
		if('string'==type){return '';}
		if('bool'==type){return false;}
		if('array'==type){return [];}
		if('int'==type||'uint'==type||'time'==type){return 0;}
		return '';
	}

	/* Builds the operation payload for viz.broadcast.<op>With().
	   Returns {error:'...'} when a required field is missing — the caller must not
	   broadcast a half-filled money operation. */
	function build_payload(op,actor,data){
		var spec=ops[op];
		if(!spec){return {error:'unknown_operation'};}
		if(!actor){return {error:'empty_account'};}
		var payload={};
		payload[spec.actor]=actor;
		for(var i=0;i<spec.fields.length;i++){
			var name=spec.fields[i][0];
			var type=spec.fields[i][1];
			var required=spec.fields[i][2];
			var value=(data && typeof data[name] !== 'undefined')?data[name]:undefined;
			if(typeof value === 'undefined' || null===value){
				if(required){return {error:'empty '+name};}
				if('optional'==type){continue;}
				value=default_value(type);
			}
			payload[name]=value;
		}
		payload.extensions=[];
		return {payload:payload};
	}

	root.VIZ_PM_OPS={
		ops:ops,
		names:names,
		method_name:method_name,
		build_payload:build_payload
	};
})(typeof self !== 'undefined'?self:this);
