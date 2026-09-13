/* Приёмка доставки события accountsChanged на СТРАНИЦУ: мост page ↔ content script.

   Остальные тесты проверяют background (кому и что он отдаёт), но сама доставка
   живёт между page и content script, и порваться она может молча: страница
   подписывается, а событие не приходит — и никакой background-тест этого не увидит.

   Что проверяем (вердикт = код возврата, 0 = PASS):
   - vizonator.on('accountsChanged', cb) регистрирует подписку на стороне страницы;
   - «звонок» background'а без подписки страницы НЕ превращается в запрос данных;
   - с подпиской звонок превращается в accounts_changed, а ответ уходит в callback;
   - vizonator.off() снимает подписку: событие больше не приходит;
   - падение одного обработчика не мешает остальным.

   Запуск: node tests/accounts-event-page.mjs
   Честный контроль (код ДО фикса, тест обязан упасть):
     rm -rf /tmp/vzn-old && mkdir -p /tmp/vzn-old && git archive HEAD | tar -x -C /tmp/vzn-old
     VZN_DIR=/tmp/vzn-old node tests/accounts-event-page.mjs */
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const DIR = process.env.VZN_DIR || path.resolve(path.dirname(import.meta.dirname), '.');

const fails = [];
const check = (name, ok, extra = '') => {
	console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`);
	if (!ok) fails.push(name);
};

/* Мини-DOM: обе стороны моста общаются через CustomEvent на document, поэтому
   шины событий достаточно — настоящий браузер здесь не нужен. */
function make_page() {
	const listeners = {};
	const sent = [];
	let cs_message_listener = false;
	const document = {
		addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
		dispatchEvent: (evt) => {
			for (const fn of (listeners[evt.type] || []).slice()) fn(evt);
			return true;
		}
	};
	const chrome = {
		runtime: {
			id: 'testext',
			lastError: undefined,
			onMessage: {addListener: (fn) => { cs_message_listener = fn; }},
			sendMessage: (msg) => { sent.push(msg); }
		}
	};
	const ctx = {
		chrome,
		document,
		console: {log: () => {}, error: () => {}, warn: () => {}},
		setTimeout: setTimeout, clearTimeout: clearTimeout,
		Date, JSON, Math, Promise, Array, Object, String,
		screenY: 0, screenX: 0, outerHeight: 800, outerWidth: 1200,
		CustomEvent: class CustomEvent {
			constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; }
		}
	};
	ctx.window = ctx;
	ctx.globalThis = ctx;
	ctx.self = ctx;
	vm.createContext(ctx);
	/* content script первым: его слушатель должен стоять до того, как страница
	   подпишется (иначе подписка уйдёт в пустоту) */
	vm.runInContext(fs.readFileSync(path.join(DIR, 'contentscript.js'), 'utf8'), ctx, {filename: 'contentscript.js'});
	vm.runInContext(fs.readFileSync(path.join(DIR, 'inpage.js'), 'utf8'), ctx, {filename: 'inpage.js'});
	return {
		ctx, sent,
		/* сообщение «из расширения» в content script */
		from_extension: (payload) => {
			if (!cs_message_listener) throw new Error('content script не подписан на runtime.onMessage');
			cs_message_listener(payload, {id: 'testext'}, () => {});
		},
		has_listener: () => !!cs_message_listener
	};
}

/* На коде ДО фикса API событий ещё нет: говорим это одной строкой, а не стектрейсом —
   контроль обязан быть читаемым. */
{
	const probe = make_page();
	if (!probe.ctx.vizonator || 'function' !== typeof probe.ctx.vizonator.on || 'function' !== typeof probe.ctx.vizonator.off) {
		check('страница получила vizonator.on/off', false, 'API событий отсутствует — это код до фикса');
		console.log('FAILED: 1 (vizonator.on/off отсутствует)');
		process.exit(1);
	}
	check('страница получила vizonator.on/off', true);
}

const PING = {event: 'vizonator_accounts_ping', data: true};
const FEED = (current) => ({event: 'accountsChanged', data: {error: false, result: {current: current, accounts: [{login: current, current: true}]}}});

/* --- подписка страницы включает канал -------------------------------------------- */
{
	const page = make_page();
	check('мост поднят: content script слушает расширение', page.has_listener());

	/* без подписки звонок не должен порождать запрос данных */
	page.from_extension(PING);
	check('без подписки звонок не превращается в запрос', 0 === page.sent.length, JSON.stringify(page.sent));

	let got = null;
	const subscribed = page.ctx.vizonator.on('accountsChanged', (error, result) => { got = {error, result}; });
	check('on(): подписка принята', true === subscribed);
	page.sent.length = 0;

	/* звонок при подписке — это запрос данных, и не более */
	page.from_extension(PING);
	check('со подпиской звонок спрашивает данные', 1 === page.sent.length && 'accounts_changed' === page.sent[0].operation, JSON.stringify(page.sent));
	check('запрос идёт с правилом accounts', 'accounts' === (page.sent[0].operation_type || [])[0], JSON.stringify(page.sent[0].operation_type));
	check('обработчик ещё не вызван (данных не было)', null === got);

	/* ответ background'а доезжает до callback'а страницы */
	page.from_extension(FEED('beta'));
	check('ответ доехал в callback страницы', !!got && false === got.error && 'beta' === (got.result || {}).current, JSON.stringify(got));
}

/* --- отписка закрывает канал ------------------------------------------------------ */
{
	const page = make_page();
	let calls = 0, others = 0;
	const handler = () => { calls++; };
	const other_handler = () => { others++; };
	page.ctx.vizonator.on('accountsChanged', handler);
	page.ctx.vizonator.on('accountsChanged', other_handler);
	page.from_extension(FEED('alpha'));
	check('до отписки событие приходит обоим', 1 === calls && 1 === others, 'calls: ' + calls + '/' + others);

	/* сняли ОДИН обработчик: его не зовут, второго — по-прежнему зовут, канал жив */
	check('off(): отписка принята', true === page.ctx.vizonator.off('accountsChanged', handler));
	page.from_extension(FEED('beta'));
	check('после отписки одного события нет только у него', 1 === calls && 2 === others, 'calls: ' + calls + '/' + others);
	page.sent.length = 0;
	page.from_extension(PING);
	check('канал ещё жив, пока подписан кто-то ещё', 1 === page.sent.length, JSON.stringify(page.sent.length));

	/* а вот последний обработчик закрывает канал: незачем дёргать background зря */
	page.ctx.vizonator.off('accountsChanged');
	page.sent.length = 0;
	page.from_extension(PING);
	check('отписка последнего обработчика закрывает канал', 0 === page.sent.length, JSON.stringify(page.sent.length));

	/* повторная подписка ОБЯЗАНА открыть канал заново: массив слушателей к этому
	   моменту уже существует, поэтому одной лишь первой регистрации мало */
	let again = 0;
	page.ctx.vizonator.on('accountsChanged', () => { again++; });
	page.sent.length = 0;
	page.from_extension(PING);
	check('повторная подписка открывает канал заново', 1 === page.sent.length, JSON.stringify(page.sent.length));
	page.from_extension(FEED('beta'));
	check('повторная подписка снова получает событие', 1 === again, 'again: ' + again);
}

/* --- падение одного обработчика не ломает остальные ------------------------------- */
{
	const page = make_page();
	let second = 0;
	page.ctx.vizonator.on('accountsChanged', () => { throw new Error('страница сломалась'); });
	page.ctx.vizonator.on('accountsChanged', () => { second++; });
	page.from_extension(FEED('alpha'));
	check('падение обработчика не мешает следующему', 1 === second, 'second: ' + second);
}

console.log(fails.length ? `FAILED: ${fails.length} (${fails.join('; ')})` : 'OK: all checks passed');
process.exit(fails.length ? 1 : 0);
