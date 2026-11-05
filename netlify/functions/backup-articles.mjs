// ══════════════════════════════════════════════════════════════
//  Автоматична резервна копія статей — щонеділі.
//
//  Netlify запускає цю функцію раз на тиждень. Вона бере всі статті з бази
//  (лише читання, публічним ключем) і зберігає точну копію у сховищі Netlify
//  (Netlify Blobs, сховище «article-backups») файлом articles-РРРР-ММ-ДД.json —
//  у тому самому форматі, що й кнопка «⬇ Резервна копія (.json)» у редакторі.
//  Зберігаються останні 52 копії (рік). Завантажити їх можна в редакторі,
//  розділ «Автоматичні копії» (див. netlify/functions/backups.mjs).
//  Налаштовувати нічого не потрібно.
// ══════════════════════════════════════════════════════════════
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://jztxnznkjevzngvrlpzh.supabase.co').replace(/\/+$/, '');
// Публічний ключ «anon» — той самий, що на сторінках сайту (лише читання)
const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6dHhuem5ramV2em5ndnJscHpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwNTQ0NTgsImV4cCI6MjA4NzYzMDQ1OH0.X9gS4qAfLJ8CO2mF0OXaGgierBtxdszUJZn_r7224oE';
export const STORE = 'article-backups';
export const KEEP = 52;
export const FILE_RE = /^articles-\d{4}-\d{2}-\d{2}\.json$/;

export async function makeBackup({ store, fetchImpl = fetch, now = new Date() }) {
    const headers = { apikey: ANON_KEY };
    if (ANON_KEY.startsWith('eyJ')) headers.Authorization = 'Bearer ' + ANON_KEY;
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
        const res = await fetchImpl(SUPABASE_URL + '/rest/v1/articles?select=id,title,content,created_at&order=id.asc&limit=1000&offset=' + offset, { headers });
        const text = await res.text();
        if (!res.ok) throw new Error('Supabase HTTP ' + res.status + ': ' + text.slice(0, 200));
        const page = JSON.parse(text);
        rows.push(...page);
        if (page.length < 1000) break;
    }
    // Порожня відповідь — радше збій, ніж правда: таку копію не зберігаємо
    if (!rows.length) throw new Error('база повернула 0 статей — копію не збережено');
    const key = 'articles-' + now.toISOString().slice(0, 10) + '.json';
    await store.set(key, JSON.stringify({ site: 'https://foundtribesofisrael.com/', exportedAt: now.toISOString(), count: rows.length, articles: rows }, null, 2));
    // Найстаріші копії понад 52 прибираємо
    const { blobs } = await store.list({ prefix: 'articles-' });
    const keys = blobs.map(b => b.key).filter(k => FILE_RE.test(k)).sort();
    const old = keys.slice(0, Math.max(0, keys.length - KEEP));
    for (const k of old) await store.delete(k);
    return { saved: key, articles: rows.length, kept: keys.length - old.length, removed: old.length };
}

export default async () => {
    let report;
    try {
        const { getStore } = await import('@netlify/blobs');
        report = await makeBackup({ store: getStore(STORE) });
    } catch (e) {
        report = { error: String((e && e.message) || e) };
    }
    console.log('[backup-articles]', JSON.stringify(report));
    return new Response(JSON.stringify(report), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};

export const config = { schedule: '@weekly' };
