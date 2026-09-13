/* Приёмка привязки passwordless_auth к вызывающему сайту + новых запросов
   get_accounts / switch_account.

   Что проверяем (вердикт = код возврата, 0 = PASS):
   - веб-страница вправе назвать доменом подписи СВОЙ хост, а поддомен — ещё и свой
     ГЛАВНЫЙ домен (со 0.77), но тогда окно несёт оранжевое предупреждение и трастлайн
     его не отменяет. Другой домен, главный→поддомен, соседний поддомен, подмена через
     userinfo и shared-суффиксы (evil.github.io → github.io) — отказ domain_mismatch;
   - имя viz:// разрешено, но НИКОГДА не одобряется молча: показываем окно и видим
     в нём домен и аккаунт;
   - старый вызов без domain работает как раньше, включая авто-исполнение по трастлайну;
   - get_accounts отдаёт логины и флаги, но ни одного приватного ключа;
   - switch_account: на текущий аккаунт — ответ без окна, неизвестный — отказ,
     другой — окно подтверждения, и только после одобрения меняется current_user;
   - подпись за аккаунт, который пользователь НЕ видел в окне, не выдаётся (account_changed);
   - accounts_changed — канал, а не операция: окна не открывает, но и данных без
     одобренного правила accounts не отдаёт (no_rule), а смена аккаунта шлёт звонок
     во вкладки (подписчиков держит страница, а не засыпающий service worker).

   Запуск: node tests/auth-domain.mjs
   Честный контроль (код ДО фикса, тест обязан упасть):
     git show HEAD:background.js > /tmp/vzn-old/background.js && cp pm_ops.js /tmp/vzn-old/
     VZN_DIR=/tmp/vzn-old node tests/auth-domain.mjs */
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const DIR = process.env.VZN_DIR || path.resolve(path.dirname(import.meta.dirname), '.');
const src = fs.readFileSync(path.join(DIR, 'background.js'), 'utf8');
const pm_ops_path = path.join(DIR, 'pm_ops.js');
const pm_ops_src = fs.existsSync(pm_ops_path) ? fs.readFileSync(pm_ops_path, 'utf8') : '';

const SIGNATURE = '1f' + '0'.repeat(126);

function make_context(tab_url, rules) {
	const calls = {sent: [], windows: [], viz: []};
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
			sendMessage: (msg, cb) => {
				if (msg && msg.type === 'viz_call') {
					calls.viz.push(msg.method);
					let result = null;
					if (msg.method === 'auth.signature.sign') result = SIGNATURE;
					if (cb) setTimeout(() => cb({error: false, result: result}), 0);
					return;
				}
				if (cb) setTimeout(() => cb({}), 0);
			}
		},
		storage: {local: {get: (k, cb) => cb({}), set: (o, cb) => cb && cb(), remove: (k, cb) => cb && cb()}},
		alarms: {create: () => {}, clear: () => {}, onAlarm: {addListener: () => {}}},
		action: {setBadgeText: () => {}, setBadgeBackgroundColor: () => {}, setIcon: () => {}, setTitle: () => {}},
		tabs: {
			get: (id, cb) => cb({id: id, url: tab_url}),
			sendMessage: (tab_id, payload) => { calls.sent.push(payload); },
			query: (q, cb) => cb([]),
			onActivated: {addListener: () => {}},
			onUpdated: {addListener: () => {}}
		},
		scripting: {executeScript: () => Promise.resolve()},
		offscreen: {createDocument: () => Promise.resolve()},
		windows: {
			create: (opts) => { calls.windows.push(opts); },
			onFocusChanged: {addListener: () => {}}
		},
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
	vm.runInContext(pm_ops_src, ctx, {filename: 'pm_ops.js'});
	vm.runInContext(src, ctx, {filename: 'background.js'});

	/* кошелёк разблокирован, в сессии два аккаунта */
	ctx.bg_initialized = true;
	ctx.offscreen_ready = true;
	ctx.current_user = 'alpha';
	ctx.account = {regular_key: '5Kalpha_regular', memo_key: '5Kalpha_memo', active_key: '5Kalpha_active'};
	ctx.users = {
		alpha: {regular_key: '5Kalpha_regular', memo_key: '5Kalpha_memo', active_key: '5Kalpha_active'},
		beta: {regular_key: '5Kbeta_regular', memo_key: '', active_key: '5Kbeta_active'}
	};
	ctx.state = {users: ctx.users, current_user: 'alpha', settings: {lang: 'en'}, rules: rules || {}, decoded: true, encoded: false};
	ctx.settings = ctx.state.settings;
	ctx.rules = ctx.state.rules;
	ctx.current_balance = '100.000';
	ctx.current_energy = 10000;
	return {ctx, calls};
}

const settle = () => new Promise(r => setTimeout(r, 15));

/* запрос со страницы: ответ приходит через tabs.sendMessage, окна — через windows.create */
async function inpage(env, request) {
	env.calls.sent.length = 0;
	env.calls.windows.length = 0;
	env.ctx.handle_message(Object.assign({inpage: true, event: 7, tab_id: 1}, request), {tab: {id: 1}}, () => {});
	await settle();
	return {
		response: env.calls.sent.length ? env.calls.sent[env.calls.sent.length - 1].data : false,
		action: env.calls.windows.length ? JSON.parse(env.calls.windows[0].url.split('#')[1]) : false
	};
}

/* одобрение окна: operation.js возвращает action c inpage_action/approve */
async function approve(env, action, patch) {
	env.calls.sent.length = 0;
	env.ctx.inpage_action(Object.assign({}, action, {inpage_action: true, approve: true, refuse: false}, patch || {}));
	await settle();
	return env.calls.sent.length ? env.calls.sent[env.calls.sent.length - 1].data : false;
}

const fails = [];
const check = (name, ok, extra = '') => {
	console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`);
	if (!ok) fails.push(name);
};

const auth_request = (domain) => ({
	operation: 'passwordless_auth',
	operation_type: ['auth', 'account', 'regular'],
	authority: 'regular',
	domain: domain
});

/* --- веб-домен: только свой хост ------------------------------------------------ */
{
	const env = make_context('https://hub.viz.world/app/inbox');
	const r = await inpage(env, auth_request('hub.viz.world'));
	check('свой домен: окно подтверждения открыто', !!r.action && r.action.domain === 'hub.viz.world', JSON.stringify(r.action && r.action.domain));
	const signed = await approve(env, r.action);
	const data = signed && signed.result ? signed.result.data : '';
	check('свой домен: подписана строка за этот домен', 'hub.viz.world:auth:alpha:regular:' === data.substring(0, 'hub.viz.world:auth:alpha:regular:'.length), data);
	check('get_accounts не участвует: подпись отдана без ключей', !!(signed && signed.result && signed.result.signature));
}
{
	/* поддомен и чужой домен — отказ, окна быть не должно */
	for (const [label, origin, requested, expected] of [
		['чужой домен', 'https://hub.viz.world/app', 'evil.com', ['domain_mismatch']],
		['главный домен не подписывает за поддомен', 'https://example.com/', 'app.example.com', ['domain_mismatch']],
		['поддомен не подписывает за соседний поддомен', 'https://a.example.com/', 'b.example.com', ['domain_mismatch']],
		['подмена через userinfo', 'https://hub.viz.world/', 'https://hub.viz.world@evil.com', ['domain_mismatch']],
		['чужая схема', 'https://hub.viz.world/', 'ftp://hub.viz.world', ['bad_domain']],
		['пустое имя схемы', 'https://hub.viz.world/', 'viz://', ['bad_domain']]
	]) {
		const env = make_context(origin);
		const r = await inpage(env, auth_request(requested));
		check('отказ: ' + label, r.response && expected.indexOf(r.response.error) !== -1 && false === r.action, JSON.stringify(r.response));
	}
}
{
	/* полный URL своего хоста — это тот же хост */
	const env = make_context('https://hub.viz.world/app');
	const r = await inpage(env, auth_request('https://hub.viz.world/inbox?x=1'));
	check('свой хост в виде URL принят', !!r.action && 'hub.viz.world' === r.action.domain, JSON.stringify(r.action && r.action.domain));
}
{
	/* порт — часть origin: 8443 это НЕ тот же сайт, что 443 */
	const env = make_context('https://hub.viz.world:8443/app');
	const ok = await inpage(env, auth_request('hub.viz.world:8443'));
	check('свой хост с портом принят', !!ok.action && 'hub.viz.world:8443' === ok.action.domain, JSON.stringify(ok.action && ok.action.domain));
	const signed = await approve(env, ok.action);
	check('свой хост с портом подписан как origin', !!(signed && signed.result && 0 === signed.result.data.indexOf('hub.viz.world:8443:auth:alpha:regular:')), JSON.stringify(signed && signed.result && signed.result.data));
	const no_port = await inpage(env, auth_request('hub.viz.world'));
	check('отказ: порт выброшен из своего же хоста', 'domain_mismatch' === no_port.response.error && false === no_port.action, JSON.stringify(no_port.response));
	const env2 = make_context('https://hub.viz.world/app');
	const foreign_port = await inpage(env2, auth_request('hub.viz.world:8443'));
	check('отказ: чужой порт', 'domain_mismatch' === foreign_port.response.error && false === foreign_port.action, JSON.stringify(foreign_port.response));
}
/* --- поддомен вправе подписать за свой ГЛАВНЫЙ домен (со 0.77) ------------------- */
{
	const env = make_context('https://hub.viz.world/app/inbox');
	const r = await inpage(env, auth_request('viz.world'));
	check('поддомен → главный домен: окно открыто', !!r.action && 'viz.world' === r.action.domain, JSON.stringify(r.action && r.action.domain));
	check('поддомен → главный домен: в окне оранжевое предупреждение', !!r.action && true === r.action.auth_main_domain, JSON.stringify(r.action && r.action.auth_main_domain));
	const signed = await approve(env, r.action);
	const data = signed && signed.result ? signed.result.data : '';
	check('поддомен → главный домен: подписана строка за ГЛАВНЫЙ домен',
		'viz.world:auth:alpha:regular:' === data.substring(0, 'viz.world:auth:alpha:regular:'.length), data);
}
{
	/* предупреждение — не косметика: подпись за свой хост его НЕ несёт */
	const env = make_context('https://hub.viz.world/app');
	const r = await inpage(env, auth_request('hub.viz.world'));
	check('свой хост: предупреждения о главном домене нет', !!r.action && false === r.action.auth_main_domain, JSON.stringify(r.action && r.action.auth_main_domain));
}
{
	/* deep-поддомен: главным доменом остаётся registrable, а не «на метку выше» */
	const env = make_context('https://a.b.example.com/');
	const r = await inpage(env, auth_request('example.com'));
	check('глубокий поддомен → главный домен принят', !!r.action && 'example.com' === r.action.domain, JSON.stringify(r.action && r.action.domain));
	const wrong = await inpage(env, auth_request('b.example.com'));
	check('отказ: соседний уровень поддомена', 'domain_mismatch' === wrong.response.error && false === wrong.action, JSON.stringify(wrong.response));
}
{
	/* shared-суффиксы: на github.io поддомен раздают кому угодно, «владелец» там не один */
	const env = make_context('https://evil.github.io/');
	const r = await inpage(env, auth_request('github.io'));
	check('отказ: shared-суффикс github.io', 'domain_mismatch' === r.response.error && false === r.action, JSON.stringify(r.response));
	const own = await inpage(env, auth_request('evil.github.io'));
	check('свой поддомен на shared-суффиксе принят', !!own.action && 'evil.github.io' === own.action.domain, JSON.stringify(own.action && own.action.domain));
	const env2 = make_context('https://shop.example.co.uk/');
	const r2 = await inpage(env2, auth_request('example.co.uk'));
	check('составной ccTLD: example.co.uk — главный домен', !!r2.action && 'example.co.uk' === r2.action.domain, JSON.stringify(r2.action && r2.action.domain));
	const r3 = await inpage(env2, auth_request('co.uk'));
	check('отказ: ccTLD целиком главным доменом не считается', 'domain_mismatch' === r3.response.error && false === r3.action, JSON.stringify(r3.response));
}
{
	/* подпись за главный домен не одобряется молча, даже когда сайт в трастлайне */
	const rules = {'hub.viz.world': {auth: true, account: true, regular: true}};
	const env = make_context('https://hub.viz.world/app', rules);
	const r = await inpage(env, auth_request('viz.world'));
	check('поддомен → главный домен: трастлайн не отменяет окно', !!r.action && 'viz.world' === r.action.domain, JSON.stringify(r.action && r.action.domain));
	const signed = await approve(env, r.action);
	const data = signed && signed.result ? signed.result.data : '';
	check('поддомен → главный домен: после одобрения подпись выдана', 0 === data.indexOf('viz.world:auth:alpha:regular:'), data);
}

{
	/* трастлайн одобрен — старое поведение: молча, без окна */
	const rules = {'hub.viz.world': {auth: true, account: true, regular: true}};
	const env = make_context('https://hub.viz.world/app', rules);
	const r = await inpage(env, auth_request(false));
	check('старый вызов без domain: авто-исполнение по трастлайну (без окна)', false === r.action, JSON.stringify(r.action));
	check('старый вызов без domain: подпись за свой origin', !!(r.response && r.response.result && 0 === r.response.result.data.indexOf('hub.viz.world:auth:alpha:regular:')), JSON.stringify(r.response && r.response.result && r.response.result.data));
}
{
	/* viz:// — можно, но только через окно, даже когда сайт в трастлайне */
	const rules = {'hub.viz.world': {auth: true, account: true, regular: true}};
	const env = make_context('https://hub.viz.world/app', rules);
	const r = await inpage(env, auth_request('viz://on1x'));
	check('viz://: окно показано несмотря на трастлайн', !!r.action && 'viz://on1x' === r.action.domain, JSON.stringify(r.action && r.action.domain));
	check('viz://: в окне виден аккаунт подписи', !!r.action && 'alpha' === r.action.account, JSON.stringify(r.action && r.action.account));
	const signed = await approve(env, r.action);
	check('viz://: подписана строка за viz-имя', !!(signed && signed.result && 0 === signed.result.data.indexOf('viz://on1x:auth:alpha:regular:')), JSON.stringify(signed && signed.result && signed.result.data));
}
{
	/* отказ сайта (правило false) уважаем и для viz:// */
	const rules = {'hub.viz.world': {auth: false, account: false, regular: false}};
	const env = make_context('https://hub.viz.world/app', rules);
	const r = await inpage(env, auth_request('viz://on1x'));
	check('viz://: сохранённый отказ сайта не перебиваем', 'refuse' === r.response.error && false === r.action, JSON.stringify(r.response));
}

/* --- get_accounts --------------------------------------------------------------- */
{
	const env = make_context('https://hub.viz.world/app');
	const r = await inpage(env, {operation: 'get_accounts', operation_type: ['accounts']});
	check('get_accounts: окно подтверждения открыто', !!r.action, JSON.stringify(r.action && r.action.operation));
	const list = await approve(env, r.action);
	const result = list && list.result ? list.result : false;
	check('get_accounts: текущий аккаунт назван', !!result && 'alpha' === result.current, JSON.stringify(result && result.current));
	check('get_accounts: список из двух логинов', !!result && 2 === result.accounts.length, JSON.stringify(result && result.accounts.map(a => a.login)));
	check('get_accounts: флаг current у одного', !!result && 1 === result.accounts.filter(a => a.current).length);
	check('get_accounts: флаги ключей без самих ключей', !!result && 'function' !== typeof result.accounts[0].regular
		&& false === /5K/.test(JSON.stringify(result)), JSON.stringify(result));
}
{
	/* правило accounts отдельное: доверие к account список не открывает */
	const rules = {'hub.viz.world': {account: true}};
	const env = make_context('https://hub.viz.world/app', rules);
	const r = await inpage(env, {operation: 'get_accounts', operation_type: ['accounts']});
	check('get_accounts: правило account не даёт список молча', !!r.action, JSON.stringify(r.response));
}

/* --- switch_account ------------------------------------------------------------- */
{
	const env = make_context('https://hub.viz.world/app');
	const r = await inpage(env, {operation: 'switch_account', operation_type: ['account_switch'], account: 'alpha'});
	check('switch_account на текущий: без окна и без ошибки', false === r.action && r.response && false === r.response.error, JSON.stringify(r.response));
	check('switch_account на текущий: аккаунт не менялся', 'alpha' === env.ctx.current_user);
}
{
	const env = make_context('https://hub.viz.world/app');
	const r = await inpage(env, {operation: 'switch_account', operation_type: ['account_switch'], account: '@Unknown'});
	check('switch_account: неизвестный аккаунт — отказ', 'unknown_account' === r.response.error && false === r.action, JSON.stringify(r.response));
}
{
	/* даже с полным доверием сайта смена аккаунта требует окна */
	const rules = {'hub.viz.world': {account: true, accounts: true, account_switch: true, auth: true, regular: true}};
	const env = make_context('https://hub.viz.world/app', rules);
	const r = await inpage(env, {operation: 'switch_account', operation_type: ['account_switch'], account: 'beta'});
	check('switch_account: трастлайн не переключает молча', !!r.action && 'beta' === r.action.account, JSON.stringify(r.action && r.action.account));
	const switched = await approve(env, r.action);
	check('switch_account: после одобрения аккаунт сменён', 'beta' === env.ctx.current_user && '5Kbeta_regular' === env.ctx.account.regular_key, env.ctx.current_user + '/' + env.ctx.account.regular_key);
	check('switch_account: странице ответили логином', !!(switched && switched.result && 'beta' === switched.result.login), JSON.stringify(switched && switched.result));
}
/* --- accountsChanged: событие смены аккаунта ------------------------------------ */
{
	/* без правила accounts данные не уходят, но окна тоже нет: это канал, не операция */
	const env = make_context('https://hub.viz.world/app');
	const r = await inpage(env, {operation: 'accounts_changed', operation_type: ['accounts'], event: 'accountsChanged'});
	check('accounts_changed: без правила — тихий отказ no_rule', !!r.response && 'no_rule' === r.response.error && false === r.action && false === r.response.result, JSON.stringify(r.response));
}
{
	/* правило accounts одобрено — отдаём снимок молча */
	const rules = {'hub.viz.world': {accounts: true}};
	const env = make_context('https://hub.viz.world/app', rules);
	const r = await inpage(env, {operation: 'accounts_changed', operation_type: ['accounts'], event: 'accountsChanged'});
	check('accounts_changed: с правилом — без окна', false === r.action, JSON.stringify(r.action));
	check('accounts_changed: отдан текущий аккаунт', !!(r.response && r.response.result && 'alpha' === r.response.result.current), JSON.stringify(r.response && r.response.result && r.response.result.current));
	check('accounts_changed: приватные ключи не уходят', !!(r.response && r.response.result && false === /5K/.test(JSON.stringify(r.response.result))));
}
{
	/* сохранённый отказ сайту уважаем */
	const rules = {'hub.viz.world': {accounts: false}};
	const env = make_context('https://hub.viz.world/app', rules);
	const r = await inpage(env, {operation: 'accounts_changed', operation_type: ['accounts'], event: 'accountsChanged'});
	check('accounts_changed: отказ сайта уважаем', !!r.response && 'refuse' === r.response.error && false === r.action, JSON.stringify(r.response));
}
{
	/* звонок уходит во все вкладки: список подписчиков живёт на странице, не в SW */
	const env = make_context('https://hub.viz.world/app');
	const pinged = [];
	env.ctx.chrome.tabs.query = (q, cb) => cb([{id: 1}, {id: 2}, {}]);
	env.ctx.chrome.tabs.sendMessage = (tab_id, payload) => { pinged.push(tab_id + ':' + payload.event); };
	env.ctx.notify_accounts_changed();
	await settle();
	check('notify_accounts_changed: звонок во все вкладки с id',
		2 === pinged.length && '1:vizonator_accounts_ping' === pinged[0] && '2:vizonator_accounts_ping' === pinged[1], JSON.stringify(pinged));
}
{
	/* смена аккаунта через окно обязана позвать notify (иначе событие не придёт) */
	const env = make_context('https://hub.viz.world/app');
	const pinged = [];
	env.ctx.chrome.tabs.query = (q, cb) => cb([{id: 1}]);
	env.ctx.chrome.tabs.sendMessage = (tab_id, payload) => { pinged.push(payload.event); };
	const r = await inpage(env, {operation: 'switch_account', operation_type: ['account_switch'], account: 'beta'});
	await approve(env, r.action);
	check('switch_account: смена аккаунта шлёт событие', -1 !== pinged.indexOf('vizonator_accounts_ping'), JSON.stringify(pinged));
}

{
	/* окно auth открыто за alpha, аккаунт успели сменить — подпись за beta не выдаём */
	const env = make_context('https://hub.viz.world/app');
	const r = await inpage(env, auth_request('hub.viz.world'));
	env.ctx.current_user = 'beta';
	env.ctx.account = env.ctx.users.beta;
	const signed = await approve(env, r.action);
	check('подпись за невиданный аккаунт не выдаётся', 'account_changed' === signed.error, JSON.stringify(signed));
}

console.log(fails.length ? `FAILED: ${fails.length} (${fails.join('; ')})` : 'OK: all checks passed');
process.exit(fails.length ? 1 : 0);
