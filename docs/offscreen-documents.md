# Offscreen Documents — MV3 Migration (v0.70)

## Проблема

Chrome Manifest V3 использует service worker вместо background page.
Service worker не имеет DOM-окружения, поэтому `viz.min.js` (библиотека VIZ blockchain)
падает с ошибкой "r is not a function" — она зависит от DOM API.

## Решение

Для Chrome реализована архитектура **offscreen documents**:

```
Chrome:
  Service Worker (background.js)
    → viz proxy (vizCall)
    → chrome.runtime.sendMessage (viz_call)
    → Offscreen Document (offscreen.html + offscreen.js)
    → viz.min.js (DOM-окружение)

Firefox:
  Background Page → viz.min.js (прямая загрузка, DOM доступен)
```

## Компоненты

### offscreen.html
Минимальная HTML-страница, загружает `viz.min.js` и `offscreen.js`.
Создаётся через `chrome.offscreen.createDocument()`.

### offscreen.js
Обработчик RPC-вызовов из service worker:
- Слушает `chrome.runtime.onMessage` с `type: 'viz_call'`
- Резолвит метод по dotted path (`auth.signature.sign` → `viz.auth.signature.sign`)
- Поддерживает sync-вызовы (с флагом `sync: true`) и callback-based
- Отправляет результат обратно через `sendResponse`
- По готовности шлёт `offscreen_ready` в service worker

### background.js — Viz Proxy
- `use_offscreen` — флаг, true для Chrome (есть `chrome.offscreen`)
- `vizCall(method, args, callback, sync)` — отправка вызова в offscreen
- `viz_call_queue` — буфер вызовов до готовности offscreen
- `setupOffscreen()` — создание offscreen document
- `viz` proxy object — повторяет API `viz.*`, маршрутизирует через `vizCall`
- Firefox wrapper — оборачивает sync-методы в callback-based API

## Конвертированные методы

Все sync `viz.*` вызовы конвертированы в async (callback-based):

| Метод | Тип |
|---|---|
| `viz.auth.isWif(key)` | sync → callback |
| `viz.auth.signature.sign(data, key)` | sync → callback (→ .toHex()) |
| `viz.auth.signature.recover(data, sig)` | sync → callback (→ .toPublicKeyString()) |
| `viz.auth.signTransaction(tx, keys)` | sync → callback |
| `viz.memo.encode(key1, key2, memo)` | sync → callback |
| `viz.memo.decode(key, memo)` | sync → callback |
| `viz.api.*` | уже callback → через vizCall |
| `viz.broadcast.*` | уже callback → через vizCall |

## Firefox совместимость

Firefox использует background page (DOM доступен), поэтому:
- `viz.min.js` загружается через `manifest-firefox.json` → `background.scripts[]`
- Offscreen не нужен
- Добавлены wrappers: sync-методы `viz.*` оборачиваются для поддержки callback-аргумента
- Вызывающий код использует единый callback-based API в обоих браузерах

## Файлы

| Файл | Роль |
|---|---|
| `offscreen.html` | Offscreen document (Chrome) |
| `offscreen.js` | RPC handler в offscreen |
| `background.js` | Viz proxy + offscreen management |
| `manifest.json` | Chrome manifest (MV3, service_worker) |
| `manifest-firefox.json` | Firefox manifest (MV3, background.scripts[]) |

## Сборка

```bash
./bin/build-zip.sh chrome /tmp/vizonator-chrome.zip
./bin/build-zip.sh firefox /tmp/vizonator-firefox.zip
```

## Тестирование

### Chrome
1. Загрузить ZIP как unpacked extension
2. Открыть DevTools service worker (chrome://extensions → Inspect)
3. Проверить логи: "offscreen document created", "offscreen viz ready, flushing queue"
4. Протестировать: award, transfer, history, passwordless_auth

### Firefox
1. Загрузить через about:debugging
2. Проверить консоль background page
3. Протестировать те же операции

## Версия

v0.70 — первая версия с offscreen documents для Chrome MV3.
