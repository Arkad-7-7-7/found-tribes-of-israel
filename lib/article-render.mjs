// ══════════════════════════════════════════════════════════════
//  Спільний код для окремих сторінок статей і автоматичного перекладу.
//
//  Його використовують:
//   • scripts/build-pages.mjs — збирає сторінки статей, коли сайт оновлюється;
//   • netlify/functions/translate-articles.mjs — автоматично перекладає статті.
//
//  Розмітка статей (Markdown: ## заголовки, *курсив*, **жирний**, > цитати,
//  списки) — та сама, що у вікні статті на головній сторінці
//  (public/index.html: stripMd, mdInline, mdDir, mdToHtml). Якщо змінюєте
//  розмітку там, змініть її й тут.
// ══════════════════════════════════════════════════════════════
import { createHash } from 'node:crypto';

export const SITE_URL = 'https://foundtribesofisrael.com/';
export const SITE_NAME = 'Found Tribes of Israel';
export const SOURCE_LANG = 'uk';
export const AUTHOR = { uk: 'Аркадій Бойчук', latin: 'Arkadii Boichuk' };
export const PROFILES = {
    academia: 'https://arkadiiboichuk.academia.edu/research',
    threads: 'https://www.threads.com/@arkadiyboichuk',
    telegram: 'https://t.me/Ancient_Hebrew_1n_ukrainian_lang',
    youtube: 'https://youtube.com/@Nes-il4ip'
};

// ── Давньоєврейські літери (як на головній сторінці) ─────────
const HEB = '\\u0591-\\u05F4\\uFB1D-\\uFB4F';
export const HEB_CHAR = new RegExp('[' + HEB + ']');
const HEB_RUN_SRC = '[' + HEB + ']+(?:[ \\u00A0-]+[' + HEB + ']+)*';
const hebRun = () => new RegExp(HEB_RUN_SRC, 'g');

// ── Текст ─────────────────────────────────────────────────────
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ESC[c]);
}
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0', laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…' };
export function decodeEntities(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
        const l = e.toLowerCase();
        if (l[0] === '#') {
            const n = l[1] === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
            try { return String.fromCodePoint(n); } catch (_) { return m; }
        }
        return NAMED[l] !== undefined ? NAMED[l] : m;
    });
}
// Звичайний текст з HTML (для описів, пошуку й назв)
export function htmlToText(html) {
    return decodeEntities(String(html)
        .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
        .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/blockquote)\b[^>]*>/gi, '\n')
        .replace(/<[^>]*>/g, ''));
}
export function plainText(raw) {
    return stripMd(htmlToText(raw)).replace(/\s+/g, ' ').trim();
}
export function excerpt(text, limit = 160) {
    const t = String(text).replace(/\s+/g, ' ').trim();
    if (t.length <= limit) return t;
    const cut = t.slice(0, limit);
    const sp = cut.lastIndexOf(' ');
    return (sp > limit * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:!?—–-]+$/, '') + '…';
}
// Відбиток статті: змінюється, коли змінюється назва або текст
export function hashText(...parts) {
    return createHash('sha256').update(parts.map(p => String(p == null ? '' : p)).join('\n\u0000\n')).digest('hex').slice(0, 16);
}
export function articleHash(a) {
    return hashText(a.title, a.content);
}

// ── Markdown (копія з public/index.html) ──────────────────────
export function stripMd(s) {
    return String(s)
        .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
        .replace(/^[ \t]{0,3}([-*_])([ \t]*\1){2,}[ \t]*$/gm, '')
        .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
        .replace(/^[ \t]{0,3}[-*+•][ \t]+/gm, '')
        .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1')
        .replace(/`([^`\n]+)`/g, '$1')
        .replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '$1')
        .replace(/__(?=\S)([^_\n]*?\S)__/g, '$1')
        .replace(/(^|[^\p{L}\p{N}*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\p{L}\p{N}*])/gmu, '$1$2')
        .replace(/(^|[^\p{L}\p{N}_])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\p{L}\p{N}_])/gmu, '$1$2');
}
function mdInline(s) {
    return s
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
        .replace(/(^|[\s(«])(https?:\/\/[^\s<>"«»]*[^\s<>"«».,;:!?)])/g, '$1<a href="$2">$2</a>')
        .replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '<strong>$1</strong>')
        .replace(/__(?=\S)([^_\n]*?\S)__/g, '<strong>$1</strong>')
        .replace(/(^|[^\p{L}\p{N}*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\p{L}\p{N}*])/gu, '$1<em>$2</em>')
        .replace(/(^|[^\p{L}\p{N}_])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\p{L}\p{N}_])/gu, '$1<em>$2</em>');
}
// Блок, написаний переважно давньоєврейською (наприклад, цитата з Тори), читається справа наліво
function mdDir(text) {
    const plain = stripMd(text);
    const heb = (plain.match(/[\u05D0-\u05EA\uFB1D-\uFB4F]/g) || []).length;
    const other = (plain.match(/[A-Za-z\u0400-\u04FF]/g) || []).length;
    return heb >= 3 && heb >= other * 2 ? ' dir="rtl"' : '';
}
export function mdToHtml(src) {
    const out = [];
    let para = [], quote = [], list = null;
    const flushPara = () => {
        if (para.length) out.push('<p' + mdDir(para.join(' ')) + '>' + para.map(mdInline).join('<br>') + '</p>');
        para = [];
    };
    const flushQuote = () => {
        if (quote.length) out.push('<blockquote' + mdDir(quote.join(' ')) + '>' + quote.map(mdInline).join('<br>') + '</blockquote>');
        quote = [];
    };
    const flushList = () => {
        if (!list) return;
        out.push('<' + list.tag + mdDir(list.items.map(it => it.text).join(' ')) + '>' +
            list.items.map(it => '<li' + (it.n != null ? ' value="' + it.n + '"' : '') + '>' + mdInline(it.text) + '</li>').join('') +
            '</' + list.tag + '>');
        list = null;
    };
    const flushAll = () => { flushPara(); flushQuote(); flushList(); };
    String(src).split('\n').forEach(raw => {
        const line = raw.replace(/\s+$/, '');
        let m;
        if (!line.trim()) { flushAll(); return; }
        if ((m = line.match(/^[ \t]{0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?$/))) {
            flushAll();
            const level = Math.min(5, Math.max(3, m[1].length + 1));
            out.push('<h' + level + mdDir(m[2]) + '>' + mdInline(m[2]) + '</h' + level + '>');
            return;
        }
        if (/^[ \t]{0,3}([-*_])([ \t]*\1){2,}[ \t]*$/.test(line)) { flushAll(); out.push('<hr>'); return; }
        if ((m = line.match(/^[ \t]{0,3}>[ \t]?(.*)$/))) { flushPara(); flushList(); quote.push(m[1]); return; }
        if ((m = line.match(/^[ \t]{0,3}[-*+•][ \t]+(.+)$/))) {
            flushPara(); flushQuote();
            if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
            list.items.push({ text: m[1] });
            return;
        }
        if ((m = line.match(/^[ \t]{0,3}(\d{1,3})[.)][ \t]+(.+)$/))) {
            flushPara(); flushQuote();
            if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; }
            list.items.push({ n: Number(m[1]), text: m[2] });
            return;
        }
        flushQuote(); flushList();
        para.push(line.trim());
    });
    flushAll();
    return out.join('');
}

// ── Безпечний HTML (ті самі правила, що й на головній сторінці) ──
const KEEP_TAGS = new Set('p br b strong i em u s del ins sub sup small mark span div blockquote ul ol li h1 h2 h3 h4 h5 h6 hr a img table thead tbody tfoot tr th td caption code pre figure figcaption q cite abbr dl dt dd ruby rt rp bdi bdo iframe audio video source center font'.split(' '));
const DROP_BLOCK = /<(script|style|template|noscript|svg|math|object|applet|form|textarea|select|title|head|frameset|canvas|dialog)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const VOID = new Set(['br', 'hr', 'img', 'source', 'wbr', 'input', 'meta', 'link', 'area', 'col', 'embed', 'param', 'track', 'base']);
const TAG_ATTRS = { a: ['href'], img: ['src', 'alt', 'width', 'height'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan', 'scope'], ol: ['start', 'type', 'reversed'], li: ['value'], iframe: ['src'], audio: ['src'], video: ['src', 'poster'], source: ['src', 'type'] };
const URL_ATTRS = new Set(['href', 'src', 'poster']);
const STYLE_PROPS = new Set(['color', 'background-color', 'font-weight', 'font-style', 'text-decoration', 'text-align', 'font-size', 'direction']);
const CLASS_OK = new Set(['heb', 'ex', 'notranslate']);
const BLOCK_HTML = /<(p|div|ul|ol|li|h[1-6]|table|blockquote|pre|figure)\b/i;
const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*)\s*(\/?)>/g;

function parseAttrs(s) {
    const out = [];
    const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+)))?/g;
    let m;
    while ((m = re.exec(s || ''))) out.push([m[1].toLowerCase(), decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')]);
    return out;
}
function cleanStyle(css) {
    const out = [];
    String(css).split(';').forEach(decl => {
        const i = decl.indexOf(':');
        if (i < 0) return;
        const prop = decl.slice(0, i).trim().toLowerCase();
        const val = decl.slice(i + 1).trim();
        if (STYLE_PROPS.has(prop) && val && !/url\s*\(|expression|javascript|[\\<>{}"]|\/\*/i.test(val)) out.push(prop + ':' + val);
    });
    return out.join(';');
}
export function isInternal(href) {
    try { return new URL(href, SITE_URL).host === new URL(SITE_URL).host; } catch (_) { return false; }
}
function safeUrl(value, media) {
    const raw = String(value).trim();
    try {
        const u = new URL(raw, SITE_URL);
        if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
        if (!media && (u.protocol === 'mailto:' || u.protocol === 'tel:')) return u.href;
        if (media && /^data:image\/(png|jpe?g|gif|webp);/i.test(raw)) return raw;
    } catch (_) { /* недійсна адреса */ }
    return null;
}
function cleanTag(closing, rawName, rawAttrs) {
    const name = rawName.toLowerCase();
    if (!KEEP_TAGS.has(name)) return '';
    const tag = name === 'h1' ? 'h2' : name === 'font' ? 'span' : name === 'center' ? 'div' : name;
    if (closing) return VOID.has(tag) ? '' : '</' + tag + '>';
    const attrs = [];
    let style = '';
    const allowed = TAG_ATTRS[name] || [];
    for (const [k, v] of parseAttrs(rawAttrs)) {
        if (k === 'style') { style = cleanStyle(v); continue; }
        if (k === 'lang') { if (/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(v)) attrs.push(['lang', v]); continue; }
        if (k === 'title') { attrs.push(['title', v]); continue; }
        if (k === 'dir') { if (/^(ltr|rtl|auto)$/i.test(v)) attrs.push(['dir', v.toLowerCase()]); continue; }
        if (k === 'translate') { if (v.toLowerCase() === 'no') attrs.push(['translate', 'no']); continue; }
        if (k === 'class') { const cls = v.split(/\s+/).filter(c => CLASS_OK.has(c)); if (cls.length) attrs.push(['class', cls.join(' ')]); continue; }
        if (name === 'font' && k === 'color') { if (/^#?[a-z0-9]+$/i.test(v)) style = (style ? style + ';' : '') + 'color:' + v; continue; }
        if (allowed.indexOf(k) < 0) continue;
        if (URL_ATTRS.has(k)) { const u = safeUrl(v, name !== 'a'); if (u) attrs.push([k, u]); continue; }
        attrs.push([k, v]);
    }
    if (name === 'center') style = (style ? style + ';' : '') + 'text-align:center';
    if (style) attrs.push(['style', style]);
    const get = k => (attrs.find(p => p[0] === k) || [])[1];
    if (tag === 'a') {
        const href = get('href');
        if (href && !isInternal(href)) attrs.push(['target', '_blank'], ['rel', 'noopener noreferrer']);
    }
    if (tag === 'img') {
        if (!get('src')) return '';
        attrs.push(['loading', 'lazy'], ['decoding', 'async']);
    }
    if (tag === 'iframe') {
        if (!/^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com)\/embed\//.test(get('src') || '')) return '';
        attrs.push(['allow', 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'], ['allowfullscreen', ''], ['loading', 'lazy'], ['referrerpolicy', 'strict-origin-when-cross-origin']);
        if (!get('title')) attrs.push(['title', 'Video']);
    }
    if (tag === 'audio' || tag === 'video') attrs.push(['controls', ''], ['preload', 'none']);
    return '<' + tag + attrs.map(([k, v]) => ' ' + k + (v === '' && (k === 'allowfullscreen' || k === 'controls' || k === 'reversed') ? '' : '="' + esc(v) + '"')).join('') + '>';
}
function escText(t) {
    return t.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function sanitizeHtml(html) {
    const s = String(html || '').replace(DROP_BLOCK, '');
    let out = '', last = 0;
    for (const m of s.matchAll(TAG)) {
        out += escText(s.slice(last, m.index));
        if (m[2]) out += cleanTag(m[1] === '/', m[2], m[3]);
        last = m.index + m[0].length;
    }
    return out + escText(s.slice(last));
}

// Обходить HTML і змінює лише текст (не теги); знає, чи текст усередині code/pre,
// давньоєврейського слова чи ділянки «не перекладати»
function mapText(html, fn) {
    const stack = [];
    let out = '', last = 0;
    const ctx = () => ({ skip: stack.some(e => e.skip), protect: stack.some(e => e.protect) });
    for (const m of html.matchAll(TAG)) {
        if (m.index > last) out += fn(html.slice(last, m.index), ctx());
        out += m[0];
        last = m.index + m[0].length;
        if (!m[2]) continue;
        const name = m[2].toLowerCase();
        if (VOID.has(name) || m[4] === '/') continue;
        if (m[1] === '/') {
            const i = stack.map(e => e.name).lastIndexOf(name);
            if (i >= 0) stack.length = i;
        } else {
            const attrs = m[3] || '';
            stack.push({
                name,
                skip: name === 'code' || name === 'pre' || /class\s*=\s*["'][^"']*\bheb\b/i.test(attrs),
                protect: /translate\s*=\s*["']?no\b/i.test(attrs)
            });
        }
    }
    if (last < html.length) out += fn(html.slice(last), ctx());
    return out;
}
const HEB_SPAN = t => '<span class="heb notranslate" lang="he" dir="rtl" translate="no">' + t + '</span>';
function wrapHebrewText(text) {
    return text.replace(hebRun(), m => HEB_SPAN(m));
}
// Давньоєврейські слова — власним шрифтом, справа наліво і без автоперекладу
export function wrapHebrewHtml(html) {
    return mapText(html, (text, c) => (c.skip ? text : wrapHebrewText(text)));
}

// Текст статті з бази → безпечний HTML (Markdown або HTML, як на головній сторінці)
export function contentToHtml(raw) {
    let html = String(raw || '').replace(/\r\n?/g, '\n').trim();
    if (!BLOCK_HTML.test(html)) html = mdToHtml(html);
    return sanitizeHtml(html);
}

// ── Що Google не перекладає ───────────────────────────────────
// Технічні правила, нічого не додають до тексту статей. Частини тексту,
// позначені translate="no", Google лишає точно такими, як написав автор:
//  • давньоєврейські літери;
//  • слова латинкою;
//  • записи зі стрілками й косою рискою;
//  • частини слів через дефіс;
//  • короткі слова великими літерами та окремі літери;
//  • короткі слова в лапках і коротке виділення жирним чи курсивом.
const LAT = '\\p{Script=Latin}';
const PROTECT_PATTERNS = [
    new RegExp(LAT + '[' + LAT + '\\p{M}\'’ʼ\\-]*(?:[ \\u00A0]+' + LAT + '[' + LAT + '\\p{M}\'’ʼ\\-]*)*', 'gu'),
    /[^\s]*[→↔←⟶⟷⇄⇆⇒⇔⟵][^\s]*/gu,
    /(?<![\p{L}\p{M}\p{N}])[\p{L}\p{M}]{1,3}\/[\p{L}\p{M}]{1,3}(?![\p{L}\p{M}\p{N}])/gu,
    /(?<![\p{L}\p{M}\p{N}-])-[\p{L}\p{M}]{1,10}(?![\p{L}\p{M}-])/gu,
    /(?<![\p{L}\p{M}-])[\p{L}\p{M}]{1,10}-(?![\p{L}\p{M}\p{N}-])/gu,
    /(?<![\p{L}\p{M}])[А-ЯЁЄІЇҐЫЭЪ][А-ЯЁЄІЇҐЫЭЪ'’ʼ]{1,3}(?![\p{L}\p{M}])/gu,
    /(?<=(?:звук|літер|букв|фонем|приголосн|голосн)\p{L}*[ \u00A0]+)[\p{L}](?![\p{L}\p{M}])/giu,
    // окрема літера, яка не є окремим українським словом
    /(?<![\p{L}\p{M}'’ʼ])[ГҐДЕЄИЇКЛМНПРСТФХЦЧШЩЬЮгґдеєиїклмнпрстфхцчшщью](?![\p{L}\p{M}'’ʼ])/gu,
    // велика окрема літера всередині речення
    /(?<=[\p{Ll}\p{N},;:)\]»”’][ \u00A0]+)[А-ЯЁЄІЇҐ](?![\p{L}\p{M}'’ʼ])/gu
];
const QUOTES = [/«([^«»\n]{1,40})»/g, /„([^„“”\n]{1,40})[“”]/g, /"([^"\n]{1,40})"/g, /“([^“”\n]{1,40})”/g];

function protectText(rawText) {
    const text = decodeEntities(rawText);
    const ranges = [];
    for (const m of text.matchAll(hebRun())) ranges.push([m.index, m.index + m[0].length]);
    for (const re of PROTECT_PATTERNS) {
        re.lastIndex = 0;
        for (const m of text.matchAll(re)) if (m[0].trim()) ranges.push([m.index, m.index + m[0].length]);
    }
    for (const re of QUOTES) {
        re.lastIndex = 0;
        for (const m of text.matchAll(re)) {
            const inner = m[1].trim();
            if (inner && inner.split(/\s+/).length <= 3) {
                const start = m.index + m[0].indexOf(m[1]);
                ranges.push([start, start + m[1].length]);
            }
        }
    }
    if (!ranges.length) return esc(text);
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged = [];
    for (const r of ranges) {
        const lastR = merged[merged.length - 1];
        if (lastR && r[0] <= lastR[1]) lastR[1] = Math.max(lastR[1], r[1]);
        else merged.push(r.slice());
    }
    // Коротка позначка: Google не перекладає текст у <span translate="no"> (і рахує менше символів)
    let out = '', pos = 0;
    for (const [a, b] of merged) {
        out += esc(text.slice(pos, a)) + '<span translate="no">' + esc(text.slice(a, b)) + '</span>';
        pos = b;
    }
    return out + esc(text.slice(pos));
}
export function protectForTranslation(html) {
    const marked = String(html).replace(/<(strong|b|em|i|u|mark|code)>([^<]{1,40})<\/\1>/g, (all, tag, inner) => {
        const t = decodeEntities(inner).trim();
        if (!t || /[:：]$/.test(t) || /^\d+[.)]?$/.test(t) || t.split(/\s+/).length > 2) return all;
        return '<' + tag + ' translate="no">' + inner + '</' + tag + '>';
    });
    return mapText(marked, (text, c) => (c.skip || c.protect ? text : protectText(text)));
}
export function protectTitle(title) {
    return protectText(esc(title));
}
// Перекладений HTML → для показу: позначені приклади не «перескакують» у тексті справа наліво
export function markExamples(html) {
    return String(html).replace(/<span translate="no">/g, '<span class="ex" translate="no" dir="auto">');
}
// Розбиває HTML статті на частини між абзацами — Google приймає обмежений обсяг за раз
export function splitHtml(html, max = 4500) {
    const blocks = String(html).split(/(?<=<\/(?:p|blockquote|ul|ol|h[2-6]|table|pre|figure|div)>|<hr>)/i);
    const parts = [];
    let cur = '';
    const push = piece => {
        if (cur && cur.length + piece.length > max) { parts.push(cur); cur = ''; }
        cur += piece;
    };
    for (const block of blocks) {
        if (block.length <= max) { push(block); continue; }
        for (const piece of block.split(/(?<=<br>)/i)) push(piece);
    }
    if (cur) parts.push(cur);
    return parts;
}

// ── Адреси сторінок ───────────────────────────────────────────
const UA = { а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'iu', я: 'ia', ъ: '', ы: 'y', э: 'e', ё: 'io' };
const UA_START = { є: 'ye', ї: 'yi', й: 'y', ю: 'yu', я: 'ya' };
// Українська латинкою (офіційна транслітерація, спрощено) — для адрес сторінок
export function translit(s) {
    const t = String(s).toLowerCase().replace(/зг/g, 'zgh');
    let out = '';
    for (let i = 0; i < t.length; i++) {
        const ch = t[i];
        if (UA[ch] === undefined) { out += ch; continue; }
        const prev = t[i - 1];
        const atStart = !prev || !/[\u0400-\u04FF'’ʼ]/.test(prev);
        out += (atStart && UA_START[ch]) || UA[ch];
    }
    return out;
}
export function slugify(s, max = 70) {
    let t = translit(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .replace(/['’ʼ`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (t.length > max) {
        t = t.slice(0, max);
        const i = t.lastIndexOf('-');
        if (i > max * 0.6) t = t.slice(0, i);
    }
    return t;
}
export function articleBase(a) {
    return a.id + '-' + (slugify(a.title) || 'article');
}
export function ukPath(a) {
    return 'articles/' + articleBase(a) + '/';
}
export function langDir(code) {
    return String(code).toLowerCase();
}
export function trPath(code, a, trTitle) {
    // Власна адреса — лише коли назву записано латинкою чи кирилицею; інакше — як в оригіналу
    const letters = (String(trTitle || '').match(/\p{L}/gu) || []).length;
    const readable = (String(trTitle || '').match(/[A-Za-z\u00C0-\u024F\u0400-\u04FF]/g) || []).length;
    const own = letters && readable / letters >= 0.6 ? slugify(trTitle) : '';
    return langDir(code) + '/articles/' + a.id + '-' + (own.length >= 3 ? own : (slugify(a.title) || 'article')) + '/';
}

// ── Мови ──────────────────────────────────────────────────────
// Порядок, у якому з'являються переклади (далі — решта мов, які вміє Google)
export const LANG_PRIORITY = ['en', 'he', 'ga', 'de', 'pl', 'fr', 'es', 'nl', 'it', 'pt', 'yi', 'cs', 'sk', 'ro', 'hu', 'bg', 'be', 'ka', 'el', 'tr', 'ar', 'zh-CN', 'ja', 'ko', 'hi', 'id', 'sv', 'no', 'da', 'fi', 'lt', 'lv', 'et', 'sr', 'hr', 'sl', 'mk', 'sq', 'hy', 'az', 'kk', 'uz', 'fa', 'ur', 'bn', 'vi', 'th', 'ms', 'sw', 'af', 'is', 'mt', 'cy', 'gd', 'eu', 'ca', 'gl', 'eo', 'la', 'lb', 'fy', 'zh-TW'];
const RTL = new Set(['he', 'ar', 'fa', 'ur', 'yi', 'ps', 'sd', 'ug', 'ckb', 'dv']);
export function isRtl(code) {
    return RTL.has(String(code).split('-')[0].toLowerCase());
}
// Google досі називає іврит «iw», а яванську «jw»
export function normLang(code) {
    const c = String(code);
    return c === 'iw' ? 'he' : c === 'jw' ? 'jv' : c;
}
const LANG_NAMES = { 'zh-CN': '简体中文', 'zh-TW': '繁體中文' };
export function langName(code) {
    if (LANG_NAMES[code]) return LANG_NAMES[code];
    try {
        const n = new Intl.DisplayNames([code], { type: 'language' }).of(code);
        if (n && n !== code) return n.charAt(0).toLocaleUpperCase(code) + n.slice(1);
    } catch (_) { /* невідома мова */ }
    return code;
}
export function ogLocale(code) {
    const map = { uk: 'uk_UA', en: 'en_US', he: 'he_IL', ga: 'ga_IE', de: 'de_DE', pl: 'pl_PL', fr: 'fr_FR', es: 'es_ES', nl: 'nl_NL', it: 'it_IT', pt: 'pt_PT', 'zh-CN': 'zh_CN', 'zh-TW': 'zh_TW', ja: 'ja_JP', ar: 'ar_AR' };
    return map[code] || String(code).replace('-', '_');
}

// ── Підписи на сторінках (перекладаються разом зі статтями) ───
export const UI = {
    note: 'Це автоматичний переклад статті з української мови.',
    original: 'Оригінал українською',
    allArticles: 'Усі статті',
    otherLangs: 'Ця стаття іншими мовами',
    openOnSite: 'Відкрити на головній сторінці',
    archive: 'Архів статей',
    intro: 'Авторський реєстр мовних відповідностей між давньоєврейською, українською та ірландською мовами.',
    home: 'Головна',
    author: 'Автор',
    languages: 'Мови',
    discuss: 'Обговорення дослідження — у Threads'
};
export const UI_ROW_ID = 0;     // службовий рядок у таблиці перекладів, де зберігаються підписи
