'use strict';

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
	if (msg.type !== 'viz_call') return;

	var method = msg.method;
	var args = msg.args || [];
	var sync = msg.sync;

	console.log('offscreen: received viz_call', method, args);

	var parts = method.split('.');
	var parent = null;
	var obj = viz;
	for (var i = 0; i < parts.length; i++) {
		if (obj == null) break;
		parent = obj;
		obj = obj[parts[i]];
	}

	if (typeof obj !== 'function') {
		console.error('offscreen: unknown method', method);
		sendResponse({error: 'Unknown method: ' + method});
		return true;
	}

	var ctx = parent || viz;

	if (sync) {
		try {
			var result;
			if (method === 'auth.signature.sign') {
				result = obj.apply(ctx, args).toHex();
			} else if (method === 'auth.signature.recover') {
				result = obj.apply(ctx, args).toPublicKeyString();
			} else {
				result = obj.apply(ctx, args);
			}
			console.log('offscreen: sync result', method, result);
			sendResponse({result: result});
		} catch(e) {
			console.error('offscreen: sync error', method, e);
			sendResponse({error: e.message || String(e)});
		}
	} else if (method === 'broadcast._prepareTransaction') {
		try {
			obj.apply(ctx, args).then(function(r) {
				console.log('offscreen: _prepareTransaction result', r);
				sendResponse({result: r});
			}, function(e) {
				console.error('offscreen: _prepareTransaction error', e);
				sendResponse({error: e.message || String(e)});
			});
		} catch(e) {
			console.error('offscreen: _prepareTransaction exception', e);
			sendResponse({error: e.message || String(e)});
		}
	} else {
		args.push(function(err, result) {
			console.log('offscreen: async callback', method, 'err:', err, 'result:', result);
			sendResponse({error: err || false, result: result});
		});
		try {
			obj.apply(ctx, args);
		} catch(e) {
			console.error('offscreen: async exception', method, e);
			sendResponse({error: e.message || String(e)});
		}
	}

	return true;
});

chrome.runtime.sendMessage({type: 'offscreen_ready'});
console.log('offscreen.js: viz RPC handler registered');
