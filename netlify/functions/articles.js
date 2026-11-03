// «Будильник» бази статей (Supabase).
//
// Адреса: https://foundtribesofisrael.com/.netlify/functions/articles
// UptimeRobot відкриває її кожні 5 хвилин. Кожне відкриття — запит до бази,
// тому безкоштовний проєкт Supabase не «засинає» (він засинає після тижня
// без запитів). Якщо база недоступна, відповідь — 503, і UptimeRobot
// надсилає лист.
//
// Адреса бази й ключ — ті самі, що в коді сторінки сайту (public/index.html).
// Ключ «anon» публічний. За потреби їх можна задати змінними середовища
// SUPABASE_URL і SUPABASE_KEY у налаштуваннях Netlify.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jztxnznkjevzngvrlpzh.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6dHhuem5ramV2em5ndnJscHpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwNTQ0NTgsImV4cCI6MjA4NzYzMDQ1OH0.X9gS4qAfLJ8CO2mF0OXaGgierBtxdszUJZn_r7224oE';

exports.handler = async () => {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  };
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const auth = { apikey: SUPABASE_KEY };
    if (SUPABASE_KEY.startsWith('eyJ')) auth.Authorization = 'Bearer ' + SUPABASE_KEY;
    const res = await fetch(SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/articles?select=id&limit=1', {
      headers: { ...auth, Prefer: 'count=exact' },
      signal: ctrl.signal
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error('Supabase HTTP ' + res.status + (text ? ': ' + text.slice(0, 200) : ''));
    }
    // Загальна кількість статей приходить у заголовку Content-Range, наприклад «0-0/34»
    const total = Number((res.headers.get('content-range') || '').split('/')[1]);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, articles: Number.isFinite(total) ? total : null, ms: Date.now() - started })
    };
  } catch (e) {
    const reason = e && e.name === 'AbortError' ? 'База не відповіла за 8 секунд' : String((e && e.message) || e);
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ ok: false, error: reason })
    };
  } finally {
    clearTimeout(timer);
  }
};
