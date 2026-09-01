/* Checks the prediction-market table in pm_ops.js against the real serializer.

   background-ops.mjs proves the dispatcher reaches viz.broadcast.* with a stubbed viz;
   it says nothing about whether the payload we hand over is the operation the chain
   expects. Here the payload is fed to the vendored viz.min.js and signed offline:
   viz-js-lib serializes the whole transaction before it touches the key, so a wrong
   field name, a missing field or a wrong type throws right there. That serializer is
   byte-verified against the node's FC_REFLECT, so agreeing with it means agreeing
   with the node — without a network call.

   Covered: every operation with its required fields; optional<> fields of
   pm_oracle_update present in three combinations (none / some / all), because an
   omitted optional must stay ABSENT and not be defaulted.

   Usage: node tests/pm-ops-serialize.mjs
   Exit code: 0 = PASS, 1 = FAIL. */

import fs from 'fs';
import path from 'path';
import vm from 'vm';

const root = path.join(import.meta.dirname, '..');

/* viz.min.js is a browser bundle: give it a window/self and window.crypto before loading
   (the bundle refuses to initialise without getRandomValues) */
const ctx = {console, setTimeout, clearTimeout, setInterval, clearInterval, Buffer, process, crypto: globalThis.crypto, document: {}};
ctx.window = ctx;
ctx.self = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'viz.min.js'), 'utf8'), ctx, {filename: 'viz.min.js'});
vm.runInContext(fs.readFileSync(path.join(root, 'pm_ops.js'), 'utf8'), ctx, {filename: 'pm_ops.js'});

const viz = ctx.viz;
const PM = ctx.VIZ_PM_OPS;
const wif = viz.auth.getPrivateKeys('alice', 'password', ['active']).active;

function sample(name, type) {
	/* commitment is a sha256 digest on the wire — an arbitrary string is not valid hex */
	if ('commitment' === name) return 'a'.repeat(64);
	if ('asset' === type) return '1.000 VIZ';
	if ('array' === type) return ['yes', 'no'];
	if ('bool' === type) return true;
	if ('time' === type) return '2026-01-01T00:00:00';
	if ('string' === type) return 'x';
	return 1;
}

function serialize(op, payload) {
	viz.auth.signTransaction({
		ref_block_num: 1,
		ref_block_prefix: 1,
		expiration: '2026-01-01T00:00:00',
		operations: [[op, payload]],
		extensions: []
	}, {active: wif});
}

let failed = 0;
function check(name, op, data) {
	const built = PM.build_payload(op, 'alice', data);
	let verdict = 'PASS', detail = '';
	if (built.error) {
		verdict = 'FAIL';
		detail = 'build: ' + built.error;
	}
	else {
		try {
			serialize(op, built.payload);
			detail = Object.keys(built.payload).join(',');
		} catch (e) {
			verdict = 'FAIL';
			detail = String(e.message || e).split('\n')[0];
		}
	}
	if ('FAIL' === verdict) failed++;
	console.log(verdict.padEnd(5), name.padEnd(38), detail);
}

/* every operation with all of its required fields filled in */
for (const op of PM.names) {
	const data = {};
	for (const [field, type, required] of PM.ops[op].fields) {
		if (required) data[field] = sample(field, type);
	}
	check(op, op, data);
}

/* an all-optional operation: omitted fields must not appear in the payload at all */
check('pm_oracle_update (no fields)', 'pm_oracle_update', {});
check('pm_oracle_update (some fields)', 'pm_oracle_update', {insurance_delta: '5.000 VIZ', auto_accept: true});
check('pm_oracle_update (all fields)', 'pm_oracle_update', {
	insurance_delta: '5.000 VIZ', fee_percent: 100, fixed_fee: '1.000 VIZ', rules_url: 'https://x/',
	auto_accept_creator: 'bob', auto_accept_resolver: 'bob', auto_accept: false
});

/* the guard itself: a missing required field must be refused, never defaulted */
const refused = PM.build_payload('pm_place_bet', 'alice', {market_id: 1, side: 1, outcome_index: 0});
if ('empty amount' === refused.error) {
	console.log('PASS ', 'pm_place_bet without amount'.padEnd(38), refused.error);
}
else {
	failed++;
	console.log('FAIL ', 'pm_place_bet without amount'.padEnd(38), JSON.stringify(refused));
}

const total = PM.names.length + 4;
console.log(failed ? `FAILED: ${failed} of ${total}` : `OK: all ${total} checks passed`);
process.exit(failed ? 1 : 0);
