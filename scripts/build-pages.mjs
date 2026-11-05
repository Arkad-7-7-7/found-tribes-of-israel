#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════
//  Окремі сторінки статей — для Google, Bing, соцмереж і перекладів.
//
//  Запускається командою «npm run build» щоразу, коли Render (і Netlify)
//  оновлює сайт. Бере статті й готові переклади з бази Supabase і створює
//  в теці public/:
//   • articles/<номер-назва>/   окрема сторінка кожної статті (українською);
//   • <мова>/articles/<…>/      переклади (en, he, ga, …);
//   • articles/, <мова>/        списки статей;
//   • sitemap.xml, robots.txt   карта сайту для пошуковиків;
//   • feed.xml, <мова>/feed.xml RSS-стрічки;
//   • articles-manifest.json    перелік сторінок для головної сторінки.
//  Оригінали статей у базі не змінюються. Якщо база недоступна, сайт
//  оновлюється як звичайно, просто без нових сторінок.
//
//  Перевірка без бази:
//    node scripts/build-pages.mjs --out <тека> --mock <файл.json>
// ══════════════════════════════════════════════════════════════
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../lib/article-render.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argVal = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const OUT = path.resolve(argVal('--out') || path.join(ROOT, 'public'));
const MOCK = argVal('--mock');
const STRICT = args.includes('--strict');
const SITE = R.SITE_URL;
const log = (...a) => console.log('[build-pages]', ...a);

// Підписи англійською — поки Google ще не переклав їх на мову сторінки
const UI_EN = {
    note: 'This is an automatic translation of an article written in Ukrainian.',
    original: 'Original in Ukrainian',
    allArticles: 'All articles',
    otherLangs: 'This article in other languages',
    openOnSite: 'Open on the main page',
    archive: 'Article archive',
    intro: R.UI.intro,   // авторський текст — лише так, як написав автор
    home: 'Home',
    author: 'Author',
    languages: 'Languages',
    discuss: 'Discussion of the research — on Threads'
};

// ── Дані ──────────────────────────────────────────────────────
async function supabaseConfig() {
    const page = await fs.readFile(path.join(ROOT, 'public', 'index.html'), 'utf8');
    const pick = name => (page.match(new RegExp(name + "\\s*=\\s*['\"]([^'\"]+)['\"]")) || [])[1];
    return {
        url: (process.env.SUPABASE_URL || pick('SUPABASE_URL') || '').replace(/\/+$/, ''),
        key: process.env.SUPABASE_ANON_KEY || pick('SUPABASE_KEY') || ''
    };
}
async function rest(cfg, query) {
    const headers = { apikey: cfg.key };
    if (cfg.key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + cfg.key;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
        const res = await fetch(cfg.url + '/rest/v1/' + query, { headers, signal: ctrl.signal });
        const body = await res.text();
        if (!res.ok) {
            const err = new Error('HTTP ' + res.status + ': ' + body.slice(0, 200));
            err.status = res.status;
            throw err;
        }
        return JSON.parse(body);
    } finally {
        clearTimeout(timer);
    }
}
async function restAll(cfg, query) {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
        const page = await rest(cfg, query + '&limit=1000&offset=' + offset);
        if (!Array.isArray(page)) throw new Error('Неочікувана відповідь бази');
        rows.push(...page);
        if (page.length < 1000) return rows;
    }
}
async function loadData() {
    if (MOCK) {
        const data = JSON.parse(await fs.readFile(MOCK, 'utf8'));
        return { articles: data.articles || [], translations: data.translations || [] };
    }
    const cfg = await supabaseConfig();
    if (!cfg.url || !cfg.key) throw new Error('не знайдено адреси бази або ключа');
    const articles = await restAll(cfg, 'articles?select=id,title,content,created_at&order=id.asc');
    let translations = [];
    try {
        translations = await restAll(cfg, 'article_translations?select=article_id,lang,title,content,source_hash,translated_at&order=article_id.asc,lang.asc');
    } catch (e) {
        log(e.status === 404 ? 'Таблиці перекладів ще немає — збираю сторінки лише українською.' : 'Переклади не завантажилися (' + e.message + ') — збираю сторінки лише українською.');
    }
    return { articles, translations };
}

// ── Допоміжне ─────────────────────────────────────────────────
const abs = p => SITE + p;
// Картинка-прев'ю для соцмереж (public/assets/og-image.jpg)
const OG_IMAGE = abs('assets/og-image.jpg');
const OG_IMAGE_TAGS = '<meta property="og:image" content="' + OG_IMAGE + '">\n<meta property="og:image:width" content="1200">\n' +
    '<meta property="og:image:height" content="630">\n<meta property="og:image:alt" content="' + R.SITE_NAME + '">\n' +
    '<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:image" content="' + OG_IMAGE + '">\n';
const xmlEsc = s => R.esc(s).replace(/&#39;/g, '&apos;');
const jsonLd = obj => '<script type="application/ld+json">' + JSON.stringify(obj).replace(/</g, '\\u003c') + '</script>';
function fmtDate(date, lang) {
    if (!date) return '';
    try { return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(date); }
    catch (_) { return date.toISOString().slice(0, 10); }
}
function legacySlug(rawTitle, title) {
    const t = String(rawTitle || '').trim() ? String(rawTitle) : title;
    return t.toLowerCase().replace(/\s+/g, '-');
}
function langOrder(codes) {
    const pri = new Map(R.LANG_PRIORITY.map((c, i) => [c, i]));
    return [...codes].sort((a, b) => (pri.has(a) ? pri.get(a) : 999) - (pri.has(b) ? pri.get(b) : 999) || a.localeCompare(b));
}
async function write(rel, content) {
    const file = path.join(OUT, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
}

const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    '<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Noto+Sans+Hebrew:wght@400;500&display=swap" rel="stylesheet">';
const ICON = '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 64 64%27%3E%3Crect width=%2764%27 height=%2764%27 rx=%2714%27 fill=%27%2307051c%27/%3E%3Ctext x=%2732%27 y=%2744%27 font-size=%2734%27 text-anchor=%27middle%27 fill=%27%23e8c97a%27%3E%E2%9C%BF%3C/text%3E%3C/svg%3E">';

function shell({ lang, title, desc, canonical, alternates, head = '', ui, body, feed }) {
    const rtl = R.isRtl(lang);
    const alt = (alternates || []).map(x => '<link rel="alternate" hreflang="' + R.esc(x.lang) + '" href="' + R.esc(abs(x.path)) + '">').join('');
    const xDefault = (alternates || []).find(x => x.lang === R.SOURCE_LANG);
    return '<!DOCTYPE html>\n<html lang="' + R.esc(lang) + '" dir="' + (rtl ? 'rtl' : 'ltr') + '">\n<head>\n' +
        '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
        '<title>' + R.esc(title) + '</title>\n' +
        '<meta name="description" content="' + R.esc(desc) + '">\n' +
        '<link rel="canonical" href="' + R.esc(canonical) + '">\n' +
        alt + (xDefault ? '<link rel="alternate" hreflang="x-default" href="' + R.esc(abs(xDefault.path)) + '">' : '') + '\n' +
        (feed ? '<link rel="alternate" type="application/rss+xml" title="' + R.esc(R.SITE_NAME) + '" href="' + R.esc(abs(feed)) + '">\n' : '') +
        head + ICON + '\n' + FONTS + '\n<link rel="stylesheet" href="/assets/article.css">\n</head>\n<body>\n' +
        '<header class="top"><a class="brand notranslate" translate="no" href="/"><span class="he" lang="he">שְׁבָטִים</span>' + R.esc(R.SITE_NAME) + '</a>' +
        '<nav><a href="/">' + R.esc(ui.home) + '</a><a href="/' + (lang === R.SOURCE_LANG ? 'articles/' : R.langDir(lang) + '/') + '">' + R.esc(ui.allArticles) + '</a></nav></header>\n' +
        body + '\n' +
        '<footer class="foot"><div class="he notranslate" lang="he" translate="no">מָצָאנוּ אֶת־הַשְּׁבָטִים</div>' +
        '<p><a href="' + R.PROFILES.threads + '" rel="me noopener" target="_blank">Threads</a><a href="' + R.PROFILES.academia + '" rel="me noopener" target="_blank">Academia</a>' +
        '<a href="' + R.PROFILES.telegram + '" rel="noopener" target="_blank">Telegram</a><a href="' + R.PROFILES.youtube + '" rel="noopener" target="_blank">YouTube</a></p>' +
        '<p>© ' + new Date().getFullYear() + ' foundtribesofisrael.com · ' + R.esc(lang === R.SOURCE_LANG ? R.AUTHOR.uk : R.AUTHOR.latin) + '</p></footer>\n' +
        '</body>\n</html>\n';
}

function langsBlock(ui, current, versions) {
    if (versions.length < 2) return '';
    return '<nav class="langs" aria-label="' + R.esc(ui.languages) + '"><h2>' + R.esc(ui.otherLangs) + '</h2><ul>' +
        versions.map(v => v.lang === current
            ? '<li aria-current="true"><span lang="' + R.esc(v.lang) + '">' + R.esc(R.langName(v.lang)) + '</span></li>'
            : '<li><a href="/' + R.esc(v.path) + '" hreflang="' + R.esc(v.lang) + '" lang="' + R.esc(v.lang) + '">' + R.esc(R.langName(v.lang)) + '</a></li>').join('') +
        '</ul></nav>';
}

function articleJsonLd({ lang, a, title, desc, url, versions, isTranslation }) {
    const author = {
        '@type': 'Person', name: lang === R.SOURCE_LANG ? R.AUTHOR.uk : R.AUTHOR.latin,
        alternateName: lang === R.SOURCE_LANG ? R.AUTHOR.latin : R.AUTHOR.uk,
        url: SITE, sameAs: Object.values(R.PROFILES)
    };
    const data = {
        '@context': 'https://schema.org', '@type': 'ScholarlyArticle',
        headline: title.slice(0, 110), name: title, description: desc, inLanguage: lang,
        url, mainEntityOfPage: url, author, image: OG_IMAGE,
        publisher: { '@type': 'Organization', name: R.SITE_NAME, url: SITE },
        isPartOf: { '@type': 'WebSite', name: R.SITE_NAME, url: SITE }
    };
    if (a.date) data.datePublished = a.date.toISOString();
    if (isTranslation) {
        data.translationOfWork = { '@type': 'ScholarlyArticle', url: abs(a.path), inLanguage: R.SOURCE_LANG, name: a.title };
        data.translator = { '@type': 'Organization', name: 'Google Translate' };
    } else {
        const tr = versions.filter(v => v.lang !== R.SOURCE_LANG);
        if (tr.length) data.workTranslation = tr.map(v => ({ '@type': 'ScholarlyArticle', url: abs(v.path), inLanguage: v.lang }));
    }
    return jsonLd(data);
}

function articlePage({ lang, a, title, html, text, pagePath, versions, ui, isTranslation }) {
    const url = abs(pagePath);
    const desc = R.excerpt(text, 160) || title;
    const authorName = lang === R.SOURCE_LANG ? R.AUTHOR.uk : R.AUTHOR.latin;
    const pubDate = a.date ? a.date.toISOString() : '';
    const head =
        '<meta property="og:type" content="article">\n<meta property="og:site_name" content="' + R.esc(R.SITE_NAME) + '">\n' +
        '<meta property="og:title" content="' + R.esc(title) + '">\n<meta property="og:description" content="' + R.esc(desc) + '">\n' +
        '<meta property="og:url" content="' + R.esc(url) + '">\n<meta property="og:locale" content="' + R.esc(R.ogLocale(lang)) + '">\n' +
        (pubDate ? '<meta property="article:published_time" content="' + pubDate + '">\n' : '') +
        '<meta property="article:author" content="' + R.esc(authorName) + '">\n' + OG_IMAGE_TAGS +
        '<meta name="author" content="' + R.esc(authorName) + '">\n' +
        '<meta name="citation_title" content="' + R.esc(title) + '">\n<meta name="citation_author" content="Boichuk, Arkadii">\n' +
        (a.date ? '<meta name="citation_publication_date" content="' + a.date.toISOString().slice(0, 10).replace(/-/g, '/') + '">\n' : '') +
        '<meta name="citation_language" content="' + R.esc(lang) + '">\n<meta name="citation_fulltext_html_url" content="' + R.esc(url) + '">\n' +
        articleJsonLd({ lang, a, title, desc, url, versions, isTranslation }) + '\n';
    const note = isTranslation
        ? '<p class="mt-note">' + R.esc(ui.note) + ' <a href="/' + R.esc(a.path) + '" hreflang="uk">' + R.esc(ui.original) + (R.isRtl(lang) ? ' ←' : ' →') + '</a>' +
          '<span class="by notranslate" translate="no" lang="en" dir="ltr">Translated by Google</span></p>'
        : '';
    const body =
        '<main class="sheet">' + note +
        '<div class="eyebrow">📚 ' + R.esc(isTranslation ? ui.archive : 'Авторський реєстр') + '</div>' +
        '<h1>' + R.wrapHebrewHtml(R.esc(title)) + '</h1>' +
        '<p class="meta">' + (a.date ? '<time datetime="' + pubDate + '">' + R.esc(fmtDate(a.date, lang)) + '</time> · ' : '') +
        '<span class="notranslate" translate="no">' + R.esc(authorName) + '</span></p>' +
        '<div class="rule" aria-hidden="true"><span></span><i></i><span></span></div>' +
        '<article class="content">' + (html || '') + '</article>' +
        '<p class="discuss">' + R.esc(ui.discuss) + ': <a href="' + R.PROFILES.threads + '" target="_blank" rel="noopener">@arkadiyboichuk</a> · ' +
        '<a href="' + R.esc(SITE + '?article=' + encodeURIComponent(a.slug)) + '" hreflang="uk">' + R.esc(ui.openOnSite) + '</a></p>' +
        langsBlock(ui, lang, versions) +
        '</main>';
    return shell({
        lang, title: title + ' — ' + R.SITE_NAME, desc, canonical: url,
        alternates: versions.map(v => ({ lang: v.lang, path: v.path })), head, ui, body,
        feed: lang === R.SOURCE_LANG ? 'feed.xml' : R.langDir(lang) + '/feed.xml'
    });
}

function listPage({ lang, items, ui, listPath, listVersions, total }) {
    const title = ui.archive + ' — ' + R.SITE_NAME;
    const lis = items.map(it =>
        '<li><a href="/' + R.esc(it.path) + '">' + R.wrapHebrewHtml(R.esc(it.title)) + '</a>' +
        (it.text ? '<p>' + R.wrapHebrewHtml(R.esc(R.excerpt(it.text, 220))) + '</p>' : '') +
        (it.date ? '<time datetime="' + it.date.toISOString() + '">' + R.esc(fmtDate(it.date, lang)) + '</time>' : '') + '</li>').join('');
    const more = lang !== R.SOURCE_LANG && items.length < total
        ? '<p class="mt-note">' + items.length + ' / ' + total + ' · <a href="/articles/" hreflang="uk">' + R.esc(ui.original) + (R.isRtl(lang) ? ' ←' : ' →') + '</a></p>'
        : '';
    const body = '<main class="sheet"><div class="eyebrow">📚 ' + R.esc(R.SITE_NAME) + '</div><h1>' + R.esc(ui.archive) + '</h1>' +
        '<p class="intro">' + R.esc(ui.intro) + '</p>' + more +
        '<ul class="list">' + lis + '</ul>' + langsBlock(ui, lang, listVersions) + '</main>';
    const head = '<meta property="og:type" content="website">\n<meta property="og:title" content="' + R.esc(title) + '">\n' +
        '<meta property="og:description" content="' + R.esc(ui.intro) + '">\n<meta property="og:url" content="' + R.esc(abs(listPath)) + '">\n' +
        '<meta property="og:locale" content="' + R.esc(R.ogLocale(lang)) + '">\n' + OG_IMAGE_TAGS;
    return shell({
        lang, title, desc: ui.intro, canonical: abs(listPath), alternates: listVersions, head, ui, body,
        feed: lang === R.SOURCE_LANG ? 'feed.xml' : R.langDir(lang) + '/feed.xml'
    });
}

function rssDate(d) {
    return (d || new Date()).toUTCString();
}
function feedXml({ lang, ui, items, feedPath, listPath }) {
    const entries = items.slice(0, 50).map(it =>
        '<item><title>' + xmlEsc(it.title) + '</title><link>' + xmlEsc(abs(it.path)) + '</link>' +
        '<guid isPermaLink="true">' + xmlEsc(abs(it.path)) + '</guid>' +
        (it.date ? '<pubDate>' + rssDate(it.date) + '</pubDate>' : '') +
        '<dc:creator>' + xmlEsc(lang === R.SOURCE_LANG ? R.AUTHOR.uk : R.AUTHOR.latin) + '</dc:creator>' +
        '<description>' + xmlEsc(R.excerpt(it.text || '', 300)) + '</description>' +
        '<content:encoded><![CDATA[' + String(it.html || '').replace(/]]>/g, ']]]]><![CDATA[>') + ']]></content:encoded></item>').join('\n');
    return '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n' +
        '<title>' + xmlEsc(R.SITE_NAME + (lang === R.SOURCE_LANG ? '' : ' — ' + R.langName(lang))) + '</title>\n' +
        '<link>' + xmlEsc(abs(listPath)) + '</link>\n<description>' + xmlEsc(ui.intro) + '</description>\n<language>' + xmlEsc(lang) + '</language>\n' +
        '<atom:link href="' + xmlEsc(abs(feedPath)) + '" rel="self" type="application/rss+xml"/>\n' +
        entries + '\n</channel>\n</rss>\n';
}

// ── Головна сторінка: посилання на архів і переклади ──────────
async function injectIntoMainPage(langs) {
    const file = path.join(OUT, 'index.html');
    let page;
    try { page = await fs.readFile(file, 'utf8'); } catch (_) { return; }
    const langLinks = langs.slice(0, 12).map(c => '<a href="/' + R.langDir(c) + '/" hreflang="' + R.esc(c) + '" lang="' + R.esc(c) + '">' + R.esc(R.langName(c)) + '</a>').join(' · ');
    const more = langs.length > 12 ? ' · <a href="/articles/">+' + (langs.length - 12) + '</a>' : '';
    const block = '<p class="archive-links"><a href="/articles/">📚 Архів: кожна стаття на окремій сторінці</a>' +
        (langs.length ? '<br><span class="archive-langs">🌐 ' + langLinks + more + '</span>' : '') + '</p>';
    page = page.replace('<!--BUILD:ARCHIVE-->', block)
        .replace('<!--BUILD:HEAD-->', '<link rel="alternate" type="application/rss+xml" title="' + R.esc(R.SITE_NAME) + '" href="' + abs('feed.xml') + '">');
    await fs.writeFile(file, page);
}

// ── Збирання ──────────────────────────────────────────────────
async function main() {
    const started = Date.now();
    if (OUT !== path.join(ROOT, 'public')) {
        await fs.rm(OUT, { recursive: true, force: true });
        await fs.cp(path.join(ROOT, 'public'), OUT, { recursive: true });
    }
    const { articles: rows, translations } = await loadData();
    const articles = rows.filter(r => r && r.id != null && Number(r.id) !== R.UI_ROW_ID).map(r => {
        const title = R.plainText(r.title || '') || 'Без назви';
        const time = r.created_at ? Date.parse(r.created_at) : NaN;
        return {
            id: r.id, title, slug: legacySlug(r.title, title), hash: R.articleHash(r),
            date: isNaN(time) ? null : new Date(time),
            html: R.wrapHebrewHtml(R.contentToHtml(r.content)),
            text: R.plainText(r.content || ''),
            path: R.ukPath({ id: r.id, title })
        };
    });
    const byId = new Map(articles.map(a => [String(a.id), a]));
    const newestFirst = list => list.slice().sort((x, y) => ((y.date ? y.date.getTime() : 0) - (x.date ? x.date.getTime() : 0)) || (Number(y.id) - Number(x.id)));

    // Переклади: стаття → мова → сторінка
    const uiByLang = {};
    const tr = new Map();
    for (const t of translations) {
        const lang = R.normLang(t.lang);
        if (!lang || lang === R.SOURCE_LANG) continue;
        if (Number(t.article_id) === R.UI_ROW_ID) {
            try { uiByLang[lang] = JSON.parse(t.content); } catch (_) { /* пошкоджений рядок */ }
            continue;
        }
        const a = byId.get(String(t.article_id));
        if (!a) continue;
        const title = R.plainText(t.title || '') || a.title;
        const html = R.wrapHebrewHtml(R.markExamples(R.sanitizeHtml(t.content || '')));
        if (!tr.has(a.id)) tr.set(a.id, new Map());
        tr.get(a.id).set(lang, {
            lang, title, html, text: R.plainText(html), date: a.date,
            path: R.trPath(lang, a, title), sourceHash: t.source_hash || ''
        });
    }
    const langs = langOrder(new Set([...tr.values()].flatMap(m => [...m.keys()])));
    const uiFor = lang => Object.assign({}, UI_EN, lang === R.SOURCE_LANG ? R.UI : (uiByLang[lang] || {}));

    // Сторінки статей
    let pages = 0;
    const sitemap = [{ loc: SITE, lastmod: null }];
    const manifest = { v: 1, built: new Date().toISOString(), langs: langs.map(c => ({ code: c, name: R.langName(c), path: R.langDir(c) + '/', rtl: R.isRtl(c) })), articles: {} };
    for (const a of articles) {
        const tmap = tr.get(a.id) || new Map();
        const versions = [{ lang: R.SOURCE_LANG, path: a.path }, ...langOrder(tmap.keys()).map(c => ({ lang: c, path: tmap.get(c).path }))];
        await write(a.path + 'index.html', articlePage({ lang: R.SOURCE_LANG, a, title: a.title, html: a.html, text: a.text, pagePath: a.path, versions, ui: uiFor(R.SOURCE_LANG), isTranslation: false }));
        pages++;
        sitemap.push({ loc: abs(a.path), lastmod: a.date });
        const entry = { p: a.path, h: a.hash, t: {} };
        for (const c of langOrder(tmap.keys())) {
            const t = tmap.get(c);
            await write(t.path + 'index.html', articlePage({ lang: c, a, title: t.title, html: t.html, text: t.text, pagePath: t.path, versions, ui: uiFor(c), isTranslation: true }));
            pages++;
            sitemap.push({ loc: abs(t.path), lastmod: a.date });
            entry.t[c] = { p: t.path, h: t.sourceHash };
        }
        manifest.articles[a.id] = entry;
    }

    // Списки статей і RSS
    const listVersions = [{ lang: R.SOURCE_LANG, path: 'articles/' }, ...langs.map(c => ({ lang: c, path: R.langDir(c) + '/' }))];
    const ukItems = newestFirst(articles);
    await write('articles/index.html', listPage({ lang: R.SOURCE_LANG, items: ukItems, ui: uiFor(R.SOURCE_LANG), listPath: 'articles/', listVersions, total: articles.length }));
    await write('feed.xml', feedXml({ lang: R.SOURCE_LANG, ui: uiFor(R.SOURCE_LANG), items: ukItems, feedPath: 'feed.xml', listPath: 'articles/' }));
    sitemap.push({ loc: abs('articles/'), lastmod: ukItems[0] && ukItems[0].date });
    for (const c of langs) {
        const items = newestFirst(articles.filter(a => tr.get(a.id) && tr.get(a.id).has(c)).map(a => tr.get(a.id).get(c)));
        const dir = R.langDir(c) + '/';
        await write(dir + 'index.html', listPage({ lang: c, items, ui: uiFor(c), listPath: dir, listVersions, total: articles.length }));
        await write(dir + 'feed.xml', feedXml({ lang: c, ui: uiFor(c), items, feedPath: dir + 'feed.xml', listPath: dir }));
        sitemap.push({ loc: abs(dir), lastmod: items[0] && items[0].date });
    }

    // Карта сайту, robots.txt, перелік для головної сторінки
    const day = d => (d ? d.toISOString().slice(0, 10) : '');
    await write('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        sitemap.map(u => '  <url><loc>' + xmlEsc(u.loc) + '</loc>' + (u.lastmod ? '<lastmod>' + day(u.lastmod) + '</lastmod>' : '') + '</url>').join('\n') +
        '\n</urlset>\n');
    await write('robots.txt', 'User-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: ' + abs('sitemap.xml') + '\n');
    await write('articles-manifest.json', JSON.stringify(manifest));
    await injectIntoMainPage(langs);

    log('Готово за ' + ((Date.now() - started) / 1000).toFixed(1) + ' с: статей ' + articles.length + ', мов перекладу ' + langs.length + ', сторінок ' + pages + '.');
}

main().catch(err => {
    console.warn('[build-pages] Сторінки статей не зібрано: ' + (err && err.message ? err.message : err));
    console.warn('[build-pages] Сайт оновиться як звичайно, без окремих сторінок статей.');
    process.exit(STRICT ? 1 : 0);
});
