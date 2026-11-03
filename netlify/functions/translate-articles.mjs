// ══════════════════════════════════════════════════════════════
//  Автоматичний переклад статей (Google Translate) і оновлення сайту.
//
//  Netlify запускає цю функцію щогодини. Вона:
//   1) знаходить статті без перекладу або змінені після перекладу;
//   2) перекладає їх через Google Cloud Translation у межах місячного ліміту
//      (типово 450 000 символів — це в межах безкоштовних 500 000 від Google),
//      мова за мовою: спершу англійська, іврит, ірландська, далі решта;
//   3) зберігає переклади в службовій таблиці article_translations (Supabase);
//   4) якщо на сайті щось застаріло (нова стаття, зміна чи новий переклад),
//      просить Render оновити сайт — і окремі сторінки збираються заново.
//  Частини тексту з позначкою translate="no" Google лишає без змін —
//  див. protectForTranslation у lib/article-render.mjs.
//
//  Налаштування: Netlify → Site configuration → Environment variables
//   GOOGLE_TRANSLATE_API_KEY   ключ Google Cloud Translation API
//   SUPABASE_SERVICE_ROLE_KEY  секретний ключ Supabase (service_role або secret) — лише тут
//   RENDER_DEPLOY_HOOK         адреса Deploy Hook із Render
//  Необов'язково:
//   TRANSLATE_MONTHLY_CHARS    ліміт символів на місяць (типово 450000)
//   TRANSLATE_LANGS            лише ці мови через кому, напр. «en,he,ga»
//   TRANSLATE_EXCLUDE          мови, які не перекладати, через кому
//  Без ключів функція нічого не перекладає, лише стежить, щоб нові статті
//  отримували окремі сторінки (якщо задано RENDER_DEPLOY_HOOK).
// ══════════════════════════════════════════════════════════════
import * as R from '../../lib/article-render.mjs';

const env = name => (process.env[name] || '').trim();
const SUPABASE_URL = (env('SUPABASE_URL') || 'https://jztxnznkjevzngvrlpzh.supabase.co').replace(/\/+$/, '');
// Публічний ключ «anon» — той самий, що на сторінках сайту (лише читання)
const ANON_KEY = env('SUPABASE_ANON_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6dHhuem5ramV2em5ndnJscHpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwNTQ0NTgsImV4cCI6MjA4NzYzMDQ1OH0.X9gS4qAfLJ8CO2mF0OXaGgierBtxdszUJZn_r7224oE';
const GOOGLE = env('GOOGLE_TRANSLATE_URL') || 'https://translation.googleapis.com/language/translate/v2';
const SITE = env('SITE_URL') || R.SITE_URL;
const TIME_BUDGET_MS = 20000;          // Netlify дає функції за розкладом до 30 секунд
const REQUEST_MAX_CHARS = 25000;       // обсяг одного запиту до Google

function sbHeaders(key, extra) {
    const h = Object.assign({ apikey: key }, extra || {});
    if (key.startsWith('eyJ')) h.Authorization = 'Bearer ' + key;
    return h;
}
async function fetchText(url, opts, timeoutMs = 15000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
        return { res, text: await res.text() };
    } finally {
        clearTimeout(timer);
    }
}
async function sbGet(query, key = ANON_KEY) {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
        const { res, text } = await fetchText(SUPABASE_URL + '/rest/v1/' + query + '&limit=1000&offset=' + offset, { headers: sbHeaders(key) });
        if (!res.ok) {
            const err = new Error('Supabase HTTP ' + res.status + ': ' + text.slice(0, 200));
            err.status = res.status;
            throw err;
        }
        const page = JSON.parse(text);
        rows.push(...page);
        if (page.length < 1000) return rows;
    }
}
async function sbUpsert(row, key) {
    const { res, text } = await fetchText(SUPABASE_URL + '/rest/v1/article_translations?on_conflict=article_id,lang', {
        method: 'POST',
        headers: sbHeaders(key, { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify([row])
    });
    if (!res.ok) throw new Error('Supabase HTTP ' + res.status + ': ' + text.slice(0, 200));
}
async function google(path, body, key) {
    const { res, text } = await fetchText(GOOGLE + path + (path.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key), body
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : {}, 25000);
    let data = {};
    try { data = JSON.parse(text); } catch (_) { /* не JSON */ }
    if (!res.ok) throw new Error('Google: ' + ((data.error && data.error.message) || 'HTTP ' + res.status));
    return data.data;
}
// Перекладає кілька шматків HTML за найменшу кількість запитів
async function translateParts(parts, target, key) {
    const out = [];
    let batch = [], size = 0;
    const flush = async () => {
        if (!batch.length) return;
        const data = await google('', { q: batch, source: R.SOURCE_LANG, target, format: 'html' }, key);
        out.push(...data.translations.map(t => t.translatedText));
        batch = []; size = 0;
    };
    for (const p of parts) {
        if (batch.length && (size + p.length > REQUEST_MAX_CHARS || batch.length >= 100)) await flush();
        batch.push(p); size += p.length;
    }
    await flush();
    return out;
}
const plain = html => R.htmlToText(html).replace(/\s+/g, ' ').trim();

function listEnv(name) {
    return env(name).split(/[\s,;]+/).map(s => R.normLang(s.trim())).filter(Boolean);
}
function targetLanguages(googleCodes) {
    const api = new Map();
    for (const c of googleCodes) api.set(R.normLang(c), c);
    api.delete(R.SOURCE_LANG);
    const only = listEnv('TRANSLATE_LANGS');
    const skip = new Set(listEnv('TRANSLATE_EXCLUDE'));
    let codes = only.length ? only.filter(c => api.has(c)) : [...api.keys()];
    if (!only.length) {
        const pri = new Map(R.LANG_PRIORITY.map((c, i) => [c, i]));
        codes.sort((a, b) => (pri.has(a) ? pri.get(a) : 999) - (pri.has(b) ? pri.get(b) : 999) || a.localeCompare(b));
    }
    codes = codes.filter(c => !skip.has(c));
    return codes.map(c => ({ code: c, api: api.get(c) }));
}

async function translateMissing(articles, meta, report, keys) {
    const t0 = Date.now();
    const limit = Number(env('TRANSLATE_MONTHLY_CHARS')) || 450000;
    const now = new Date();
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    let used = meta.filter(m => Date.parse(m.translated_at) >= monthStart).reduce((s, m) => s + (Number(m.chars) || 0), 0);
    const have = new Map(meta.map(m => [m.article_id + '|' + R.normLang(m.lang), m]));
    const uiHash = R.hashText(JSON.stringify(R.UI));
    const langs = targetLanguages((await google('/languages', null, keys.google)).languages.map(l => l.language));
    report.languages = langs.length;

    for (const lang of langs) {
        const tasks = [];
        const uiRow = have.get(R.UI_ROW_ID + '|' + lang.code);
        if (!uiRow || uiRow.source_hash !== uiHash) tasks.push(null);
        for (const a of articles) {
            const row = have.get(a.id + '|' + lang.code);
            if (!row || row.source_hash !== R.articleHash(a)) tasks.push(a);
        }
        if (!tasks.some(Boolean)) continue;   // усі статті цією мовою вже перекладено
        const uiKeys = Object.keys(R.UI);
        const partsOf = a => (a === null
            ? uiKeys.map(k => R.protectTitle(R.UI[k]))
            : [R.protectTitle(R.plainText(a.title || '') || 'Без назви'), ...R.splitHtml(R.protectForTranslation(R.contentToHtml(a.content)))]);
        const size = parts => parts.reduce((s, p) => s + p.length, 0);
        for (const a of tasks) {
            if (Date.now() - t0 > TIME_BUDGET_MS) { report.stopped = 'час вичерпано — продовжу наступного запуску'; return; }
            const parts = partsOf(a);
            const chars = size(parts);
            // Підписи нової мови перекладаємо, лише якщо одразу вистачає ліміту й на першу статтю
            const need = a === null ? chars + size(partsOf(tasks.find(Boolean))) : chars;
            if (used + need > limit) {
                report.stopped = 'місячний ліміт ' + limit + ' символів (використано ' + used + ') — продовжу наступного місяця';
                return;
            }
            const out = await translateParts(parts, lang.api, keys.google);
            used += chars;
            const row = a === null
                ? { article_id: R.UI_ROW_ID, lang: lang.code, title: '__ui__', content: JSON.stringify(Object.fromEntries(uiKeys.map((k, i) => [k, plain(out[i])]))), source_hash: uiHash }
                : { article_id: a.id, lang: lang.code, title: plain(out[0]), content: out.slice(1).join(''), source_hash: R.articleHash(a) };
            row.chars = chars;
            row.engine = 'google';
            row.translated_at = new Date().toISOString();
            await sbUpsert(row, keys.supabase);
            have.set(row.article_id + '|' + lang.code, row);
            const i = meta.findIndex(m => m.article_id === row.article_id && R.normLang(m.lang) === lang.code);
            if (i >= 0) meta[i] = row; else meta.push(row);
            report.translated.push(lang.code + (a === null ? ' (підписи)' : ' #' + a.id));
        }
    }
    report.used = used;
}

// Чи відрізняється вміст бази від того, що зараз зібрано на сайті
function staleReasons(articles, meta, live) {
    const reasons = [];
    const la = (live && live.articles) || {};
    const ids = new Set(articles.map(a => String(a.id)));
    for (const a of articles) {
        const e = la[a.id];
        if (!e) reasons.push('нова стаття #' + a.id);
        else if (e.h !== R.articleHash(a)) reasons.push('змінено статтю #' + a.id);
    }
    for (const id of Object.keys(la)) if (!ids.has(id)) reasons.push('видалено статтю #' + id);
    for (const m of meta || []) {
        if (Number(m.article_id) === R.UI_ROW_ID || !ids.has(String(m.article_id)) || !la[m.article_id]) continue;
        const t = la[m.article_id].t && la[m.article_id].t[R.normLang(m.lang)];
        if (!t || t.h !== m.source_hash) reasons.push('переклад ' + R.normLang(m.lang) + ' #' + m.article_id);
    }
    return reasons;
}
async function rebuildIfStale(articles, meta, report) {
    const hook = env('RENDER_DEPLOY_HOOK');
    if (!hook) { report.notes.push('немає RENDER_DEPLOY_HOOK — сайт не оновлюється автоматично'); return; }
    const { res, text } = await fetchText(SITE + 'articles-manifest.json?t=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } });
    if (res.status === 404) { report.notes.push('на сайті ще немає articles-manifest.json — перевірте команду збирання в Render («npm run build»)'); return; }
    if (!res.ok) { report.notes.push('articles-manifest.json: HTTP ' + res.status); return; }
    const reasons = staleReasons(articles, meta, JSON.parse(text));
    if (!reasons.length) return;
    const r = await fetchText(hook, { method: 'POST' });
    report.rebuild = r.res.ok;
    report.notes.push('оновлення сайту (' + reasons.slice(0, 6).join(', ') + (reasons.length > 6 ? ', …' : '') + '): Render HTTP ' + r.res.status);
}

export async function run() {
    const report = { started: new Date().toISOString(), translated: [], notes: [] };
    const keys = { google: env('GOOGLE_TRANSLATE_API_KEY'), supabase: env('SUPABASE_SERVICE_ROLE_KEY') };
    const articles = (await sbGet('articles?select=id,title,content,created_at&order=id.asc'))
        .filter(a => a && a.id != null && Number(a.id) !== R.UI_ROW_ID);
    let meta = null;
    try {
        meta = await sbGet('article_translations?select=article_id,lang,source_hash,chars,translated_at&order=article_id.asc');
    } catch (e) {
        report.notes.push('таблиця перекладів недоступна (' + (e.status === 404 ? 'її ще не створено' : e.message) + ')');
    }
    if (keys.google && keys.supabase && meta) {
        try {
            await translateMissing(articles, meta, report, keys);
        } catch (e) {
            report.notes.push('переклад зупинено: ' + e.message);
        }
    } else {
        report.notes.push('переклад вимкнено: ' + [!keys.google && 'немає GOOGLE_TRANSLATE_API_KEY', !keys.supabase && 'немає SUPABASE_SERVICE_ROLE_KEY', !meta && 'немає таблиці article_translations'].filter(Boolean).join(', '));
    }
    try {
        await rebuildIfStale(articles, meta, report);
    } catch (e) {
        report.notes.push('перевірка сайту не вдалася: ' + e.message);
    }
    return report;
}

export default async () => {
    let report;
    try {
        report = await run();
    } catch (e) {
        report = { error: String((e && e.message) || e) };
    }
    console.log('[translate-articles]', JSON.stringify(report));
    return new Response(JSON.stringify(report), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};

export const config = { schedule: '@hourly' };
