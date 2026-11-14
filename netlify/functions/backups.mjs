// ══════════════════════════════════════════════════════════════
//  Автоматичні резервні копії статей — список і завантаження (для редактора).
//
//  /.netlify/functions/backups                         → перелік копій
//  /.netlify/functions/backups?file=articles-….json    → завантажити копію
//  Копії робить netlify/functions/backup-articles.mjs щонеділі. Статті на
//  сайті й так публічні, тому копії віддаються без входу.
// ══════════════════════════════════════════════════════════════
const STORE = 'article-backups';
const FILE_RE = /^articles-\d{4}-\d{2}-\d{2}\.json$/;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };

export async function handle(req, store) {
    const file = new URL(req.url).searchParams.get('file');
    if (file) {
        if (!FILE_RE.test(file)) return new Response('Bad file name', { status: 400, headers: CORS });
        const text = await store.get(file);
        if (text == null) return new Response('Not found', { status: 404, headers: CORS });
        return new Response(text, {
            headers: Object.assign({}, CORS, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Disposition': 'attachment; filename="found-tribes-backup-' + file.slice('articles-'.length) + '"'
            })
        });
    }
    const { blobs } = await store.list({ prefix: 'articles-' });
    const files = blobs.map(b => b.key).filter(k => FILE_RE.test(k)).sort().reverse();
    return new Response(JSON.stringify({ files }), { headers: Object.assign({}, CORS, { 'Content-Type': 'application/json; charset=utf-8' }) });
}

export default async (req) => {
    try {
        const { getStore } = await import('@netlify/blobs');
        return await handle(req, getStore(STORE));
    } catch (e) {
        return new Response(JSON.stringify({ error: String((e && e.message) || e) }), { status: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json; charset=utf-8' }) });
    }
};
