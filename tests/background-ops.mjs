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

let failed = 0;
for (const [name, kind, request, expected_broadcast] of cases) {
	viz_calls.length = 0;
	const response = (kind === 'popup') ? await call_popup(request) : await call_inpage(request);
	const broadcasted = viz_calls.indexOf(expected_broadcast) !== -1;
	const ok = broadcasted && response && false === response.error;
	if (!ok) failed++;
	const verdict = ok ? 'PASS' : 'FAIL';
	const detail = (false === response) ? 'no response (hang)' : JSON.stringify(response);
	console.log(verdict + ' ' + name.padEnd(34) + ' ' + detail + ' | viz: ' + viz_calls.join(','));
}

console.log((failed ? 'FAILED: ' + failed + ' of ' + cases.length : 'OK: all ' + cases.length + ' cases passed'));
process.exit(failed ? 1 : 0);
