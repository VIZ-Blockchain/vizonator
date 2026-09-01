/* Regression test for background.js operation handlers (no dependencies).
   Runs background.js inside a stubbed service-worker environment (chrome.* + viz RPC
   are faked) and checks that every money operation reaches viz.broadcast.* and answers
   the caller — both from the popup and from a page (inpage/dApp).

   Motivation: the MV3 offscreen refactor (v0.70) turned sync viz.* calls into callbacks
   and the non-encrypted-memo branch lost its broadcast, so a plain transfer answered
   'default_recipient_error' while api.getAccount had actually succeeded.

   Usage: node tests/background-ops.mjs [path/to/background.js]
   Exit code: 0 = PASS, 1 = FAIL. */

import fs from 'fs';
import path from 'path';
import vm from 'vm';

const target = process.argv[2] || path.join(import.meta.dirname, '..', 'background.js');
const src = fs.readFileSync(target, 'utf8');
const pm_ops_path = path.join(path.dirname(target), 'pm_ops.js');
const pm_ops_src = fs.existsSync(pm_ops_path) ? fs.readFileSync(pm_ops_path, 'utf8') : '';

const viz_calls = [];

/* fake offscreen viz: answers every RPC the handlers can make */
function viz_rpc(msg) {
	if (msg.method === 'api.getAccount') return {error: false, result: {name: 'target', memo_key: 'VIZ7MJmemokey', custom_sequence_block_num: 0}};
	if (msg.method === 'memo.encode') return {error: false, result: '#encoded'};
	if (msg.method.indexOf('broadcast.') === 0) return {error: false, result: {id: 'txid'}};
	return {error: false, result: null};
}

function build_context() {
	const chrome = {
		runtime: {
			id: 'testext',
			lastError: undefined,
			onMessage: {addListener: () => {}},
			onInstalled: {addListener: () => {}},
			onStartup: {addListener: () => {}},
			onSuspend: {addListener: () => {}},
			onConnect: {addListener: () => {}},
			getURL: (p) => 'chrome-extension://testext/' + p,
			getContexts: () => Promise.resolve([{contextType: 'OFFSCREEN_DOCUMENT'}]),
			sendMessage: (msg, cb) => {
				if (msg.type === 'viz_call') {
					viz_calls.push(msg.method);
					const r = viz_rpc(msg);
					if (cb) setTimeout(() => cb(r), 0);
					return;
				}
				if (cb) setTimeout(() => cb({}), 0);
			}
		},
		storage: {local: {get: (k, cb) => cb({}), set: (o, cb) => cb && cb(), remove: (k, cb) => cb && cb()}},
		alarms: {create: () => {}, clear: () => {}, onAlarm: {addListener: () => {}}},
		action: {setBadgeText: () => {}, setBadgeBackgroundColor: () => {}, setIcon: () => {}, setTitle: () => {}},
		tabs: {get: (id, cb) => cb({id: id}), sendMessage: () => {}, query: (q, cb) => cb([]), onActivated: {addListener: () => {}}, onUpdated: {addListener: () => {}}},
		scripting: {executeScript: () => Promise.resolve()},
		offscreen: {createDocument: () => Promise.resolve()},
		windows: {onFocusChanged: {addListener: () => {}}},
		i18n: {getUILanguage: () => 'en'}
	};
	const ctx = {
		chrome: chrome,
		console: {log: () => {}, error: () => {}, warn: () => {}},
		setTimeout: setTimeout, clearTimeout: clearTimeout,
		setInterval: setInterval, clearInterval: clearInterval,
		Date: Date, JSON: JSON, Math: Math, Promise: Promise,
		XMLHttpRequest: function() { this.open = () => {}; this.send = () => {}; this.setRequestHeader = () => {}; },
		fetch: () => Promise.reject(new Error('no network in test'))
	};
	ctx.globalThis = ctx;
	ctx.self = ctx;
	vm.createContext(ctx);
	/* the service worker pulls this in with importScripts(), which the sandbox has no
	   equivalent for — load it by hand so the prediction-market table is present */
	vm.runInContext(pm_ops_src, ctx, {filename: 'pm_ops.js'});
	vm.runInContext(src, ctx, {filename: 'background.js'});

	/* minimal unlocked-wallet state */
	ctx.bg_initialized = true;
	ctx.offscreen_ready = true;
	ctx.current_user = 'me';
	ctx.account = {regular_key: '5Kregular', memo_key: '5Kmemo', active_key: '5Kactive'};
	ctx.users = {me: {regular_key: '5Kregular', memo_key: '5Kmemo', active_key: '5Kactive'}};
	ctx.current_balance = '100.000';
	ctx.current_energy = 10000;
	ctx.current_award_effective_shares = 1000;
	ctx.dgp = {total_reward_fund: '1000.000 VIZ', total_reward_shares: '1000000'};
	return ctx;
}

const ctx = build_context();
const TIMEOUT = 800;

function call_popup(request) {
	return new Promise((resolve) => {
		let answered = false;
		const timer = setTimeout(() => { if (!answered) resolve(false); }, TIMEOUT);
		try {
			ctx.handle_message(request, {id: 'testext'}, (response) => {
				answered = true;
				clearTimeout(timer);
				resolve(response);
			});
		}
		catch (e) {
			answered = true;
			clearTimeout(timer);
			resolve({error: 'THROW: ' + e.message});
		}
	});
}

function call_inpage(request) {
	return new Promise((resolve) => {
		let answered = false;
		const timer = setTimeout(() => { if (!answered) resolve(false); }, TIMEOUT);
		ctx.chrome.tabs.sendMessage = (tab_id, payload) => {
			if (answered) return;
			answered = true;
			clearTimeout(timer);
			resolve(payload ? payload.data : false);
		};
		try {
			ctx.inpage_action(request);
		}
		catch (e) {
			answered = true;
			clearTimeout(timer);
			resolve({error: 'THROW: ' + e.message});
		}
	});
}

const cases = [
	['popup transfer, plain memo', 'popup', {popup: true, operation: 'transfer', to: 'target', amount: '1.000 VIZ', memo: '', force_memo_encoding: false}, 'broadcast.transfer'],
	['popup transfer, encrypted memo', 'popup', {popup: true, operation: 'transfer', to: 'target', amount: '1.000 VIZ', memo: 'hi', force_memo_encoding: true}, 'broadcast.transfer'],
	['popup award, plain memo', 'popup', {popup: true, operation: 'award', receiver: 'target', energy: 100, custom_sequence: 0, memo: '', force_memo_encoding: false, beneficiaries: []}, 'broadcast.award'],
	['popup fixed_award, plain memo', 'popup', {popup: true, operation: 'fixed_award', receiver: 'target', reward_amount: '1.000 VIZ', max_energy: 100, custom_sequence: 0, memo: '', force_memo_encoding: false, beneficiaries: []}, 'broadcast.fixedAward'],
	['popup transfer_to_vesting', 'popup', {popup: true, operation: 'transfer_to_vesting', to: 'target', amount: '1.000 VIZ'}, 'broadcast.transferToVesting'],
	['inpage award, plain memo', 'inpage', {operation: 'award', receiver: 'target', energy: 100, custom_sequence: 0, memo: '', force_memo_encoding: false, beneficiaries: [], tab_id: 1, event: 1}, 'broadcast.award'],
	['inpage award, encrypted memo', 'inpage', {operation: 'award', receiver: 'target', energy: 100, custom_sequence: 0, memo: 'hi', force_memo_encoding: true, beneficiaries: [], tab_id: 1, event: 2}, 'broadcast.award'],
	['inpage transfer, plain memo', 'inpage', {operation: 'transfer', to: 'target', amount: '1.000 VIZ', memo: '', force_memo_encoding: false, tab_id: 1, event: 3}, 'broadcast.transfer'],
	['inpage fixed_award, plain memo', 'inpage', {operation: 'fixed_award', receiver: 'target', reward_amount: '1.000 VIZ', max_energy: 100, custom_sequence: 0, memo: '', force_memo_encoding: false, beneficiaries: [], tab_id: 1, event: 4}, 'broadcast.fixedAward']
];

/* every prediction-market operation must reach viz.broadcast — the whole point of the
   generic dispatcher is that adding an entry to pm_ops.js is enough, so the test walks
   the table itself instead of pinning a hand-written list that can drift from it */
function sample_value(type) {
	if ('asset' === type) return '1.000 VIZ';
	if ('array' === type) return ['yes', 'no'];
	if ('bool' === type) return true;
	if ('time' === type) return '2026-01-01T00:00:00';
	if ('string' === type) return 'x';
	return 1;
}
let pm_event = 100;
for (const op of ctx.VIZ_PM_OPS.names) {
	const spec = ctx.VIZ_PM_OPS.ops[op];
	const params = {};
	for (const [name, type, required] of spec.fields) {
		if (required) params[name] = sample_value(type);
	}
	cases.push([
		'inpage ' + op, 'inpage',
		{operation: op, pm_params: params, tab_id: 1, event: ++pm_event},
		'broadcast.' + ctx.VIZ_PM_OPS.method_name(op) + 'With'
	]);
}
/* a missing required field must be refused before signing, not defaulted to zero */
cases.push([
	'inpage pm_place_bet without amount', 'inpage',
	{operation: 'pm_place_bet', pm_params: {market_id: 1, side: 1, outcome_index: 0}, tab_id: 1, event: ++pm_event},
	false, 'empty amount'
]);
/* a regular-authority operation must not be signed when only the active key is present */
cases.push([
	'inpage pm_dispute_vote without regular key', 'inpage',
	{operation: 'pm_dispute_vote', pm_params: {market_id: 1, vote_outcome: 0, vote_percent: 10000}, tab_id: 1, event: ++pm_event},
	false, 'empty_regular_key', {regular_key: '', memo_key: '5Kmemo', active_key: '5Kactive'}
]);

let failed = 0;
for (const [name, kind, request, expected_broadcast, expected_error, account_override] of cases) {
	viz_calls.length = 0;
	const saved_account = ctx.account;
	if (account_override) ctx.account = account_override;
	const response = (kind === 'popup') ? await call_popup(request) : await call_inpage(request);
	ctx.account = saved_account;
	const broadcasted = expected_broadcast ? (viz_calls.indexOf(expected_broadcast) !== -1) : (viz_calls.length === 0);
	const ok = broadcasted && response && (expected_error ? expected_error === response.error : false === response.error);
	if (!ok) failed++;
	const verdict = ok ? 'PASS' : 'FAIL';
	const detail = (false === response) ? 'no response (hang)' : JSON.stringify(response);
	console.log(verdict + ' ' + name.padEnd(34) + ' ' + detail + ' | viz: ' + viz_calls.join(','));
}

console.log((failed ? 'FAILED: ' + failed + ' of ' + cases.length : 'OK: all ' + cases.length + ' cases passed'));
process.exit(failed ? 1 : 0);
