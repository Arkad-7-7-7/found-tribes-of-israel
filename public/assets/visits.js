// ══════════════════════════════════════════════════════════════
//  Лічильник відвідувань — статистика «Хто приходить на сайт».
//
//  Записує в базу Supabase (таблиця site_visits, див. supabase/site_visits.sql):
//  яку сторінку відкрито, звідки прийшли (адреса сайту-джерела), мову
//  браузера, часовий пояс, тип пристрою і випадковий анонімний номер
//  браузера (щоб рахувати відвідувачів, а не лише перегляди).
//  IP-адреси, імена, cookies не зберігаються.
//
//  Окремі сторінки статей рахуються самі. Головна сторінка підключає файл
//  з атрибутом data-manual і сама повідомляє про відкриті статті:
//      (window.ftoiVisitQueue = window.ftoiVisitQueue || []).push({});
//  Відвідування автора не рахуються: їх вимикає редактор
//  (admin/editor.html → «Не рахувати мої відвідування з цього пристрою»).
// ══════════════════════════════════════════════════════════════
(function () {
    'use strict';
    var SUPABASE_URL = 'https://jztxnznkjevzngvrlpzh.supabase.co';
    var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6dHhuem5ramV2em5ndnJscHpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwNTQ0NTgsImV4cCI6MjA4NzYzMDQ1OH0.X9gS4qAfLJ8CO2mF0OXaGgierBtxdszUJZn_r7224oE';
    // Рахуємо лише справжній сайт (і його переклад через Google Translate), а не тестові копії
    var OUR_HOST = /(^|\.)foundtribesofisrael\.com$|^foundtribesofisrael-com\.translate\.goog$/i;
    var BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|prerender/i;

    var script = document.currentScript;
    var queue = window.ftoiVisitQueue;
    var ua = navigator.userAgent || '';

    function stored(key, value) {
        try {
            if (value === undefined) return localStorage.getItem(key);
            localStorage.setItem(key, value);
        } catch (_) { /* сховище браузера недоступне (приватний режим тощо) */ }
        return null;
    }

    var off = stored('ftoi-no-stats') === '1' || !OUR_HOST.test(location.hostname) ||
        navigator.webdriver || BOT.test(ua) || typeof fetch !== 'function';

    // Випадковий номер браузера — той самий при наступних відвідуваннях
    var visitor = stored('ftoi-visitor');
    if (!visitor || !/^[A-Za-z0-9_-]{6,40}$/.test(visitor)) {
        visitor = 'v' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        stored('ftoi-visitor', visitor);
    }

    var touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    var device = /iPad|Tablet|PlayBook|Silk/i.test(ua) || touchMac || (/Android/i.test(ua) && !/Mobile/i.test(ua)) ? 'tablet'
        : /Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua) ? 'mobile' : 'desktop';
    var os = /iPhone|iPad|iPod/.test(ua) || touchMac ? 'iOS' : /Android/.test(ua) ? 'Android'
        : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS'
        : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) { tz = ''; }

    function param(name) {
        var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(location.search);
        if (!m) return '';
        try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (_) { return m[1]; }
    }

    // Звідки прийшли: позначка utm_source, сайт-джерело або порожньо (прямий вхід)
    var internal = false;
    function source() {
        var utm = param('utm_source');
        if (utm) return utm.toLowerCase().slice(0, 60);
        var r = document.referrer;
        if (r) {
            try {
                var u = new URL(r);
                if (OUR_HOST.test(u.hostname)) { internal = true; return ''; }
                return (u.hostname || u.protocol.replace(':', '')).toLowerCase().replace(/^(www|m|l|lm|mobile)\./, '');
            } catch (_) { /* незвична адреса — вважаємо прямим входом */ }
        }
        if (param('fbclid')) return 'facebook.com';
        if (param('gclid')) return 'google ads';
        return '';
    }
    var ref = source();
    var first = true;

    function currentPath() {
        var path = location.pathname;
        try { path = decodeURI(path); } catch (_) { /* лишаємо як є */ }
        var article = param('article');
        return path + (article ? '?article=' + article : '');
    }

    function send(options) {
        if (off) return;
        var o = options || {};
        var body = {
            visitor: visitor,
            path: o.path || currentPath(),
            title: String(o.title || document.title || '').slice(0, 300),
            ref: first ? ref : '',
            entry: first && !internal,
            lang: navigator.language || '',
            tz: tz,
            device: device,
            os: os
        };
        first = false;
        var headers = { 'Content-Type': 'application/json', apikey: SUPABASE_KEY };
        if (/^eyJ/.test(SUPABASE_KEY)) headers.Authorization = 'Bearer ' + SUPABASE_KEY;
        try {
            fetch(SUPABASE_URL + '/rest/v1/rpc/track_visit', {
                method: 'POST',
                keepalive: true,
                headers: headers,
                body: JSON.stringify({ v: body })
            }).catch(function () { /* статистика не повинна заважати читанню */ });
        } catch (_) { /* те саме */ }
    }

    // Головна сторінка повідомляє про перегляди сама, інші сторінки рахуються одразу
    window.ftoiVisitQueue = { push: send };
    if (queue && queue.length) for (var i = 0; i < queue.length; i++) send(queue[i]);
    else if (!script || !script.hasAttribute('data-manual')) send();
})();
