-- Статистика відвідувань сайту: хто приходить, звідки, що читає,
-- і лічильник прочитань кожної статті («👁 Прочитали 128 разів»).
-- Сторінки сайту записують відвідування через функцію track_visit (див. public/assets/visits.js),
-- а автор бачить зведення в редакторі (public/admin/editor.html → «Хто приходить на сайт»).
-- Що зберігається: сторінка, сайт-джерело, мова браузера, часовий пояс, країна, тип пристрою
-- і випадковий анонімний номер браузера. IP-адреси й особисті дані не зберігаються.
-- Як запустити (один раз): Supabase → SQL Editor → New query → вставити все → Run.
-- Повторний запуск безпечний: дані не губляться, лічильники перераховуються.
-- Статті (таблиця articles) не змінюються.

create table if not exists public.site_visits (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  visitor text not null,                 -- випадковий номер браузера (без особистих даних)
  path text not null default '/',        -- сторінка, наприклад /?article=назва або /en/articles/…
  title text not null default '',        -- заголовок сторінки
  ref text,                              -- звідки прийшли: t.me, google.com, threads.net…
  entry boolean not null default true,   -- true — вхід на сайт ззовні, false — перехід усередині сайту
  lang text,                             -- мова браузера (uk-UA, en-US…)
  tz text,                               -- часовий пояс браузера (Europe/Kyiv…)
  country text,                          -- код країни, якщо його повідомив сервер бази
  device text,                           -- mobile / tablet / desktop
  os text                                -- Android / iOS / Windows / macOS / Linux…
);
create index if not exists site_visits_created_idx on public.site_visits (created_at desc);
create index if not exists site_visits_visitor_idx on public.site_visits (visitor, created_at);

-- Читати записи може лише автор сайту; додавати — лише через track_visit
alter table public.site_visits enable row level security;
drop policy if exists visits_author on public.site_visits;
create policy visits_author on public.site_visits for select to authenticated using (public.is_site_author());

-- Лічильник прочитань статей. Його бачать усі відвідувачі сайту — лише числа, без жодних даних про людей.
-- Ключ: 's:<назва-статті>' — стаття на головній сторінці (?article=…),
--       'i:<номер статті>' — окрема сторінка статті або її переклад (/articles/12-…/, /en/articles/12-…/)
create table if not exists public.article_view_counts (
  k text primary key,
  n bigint not null default 0
);
alter table public.article_view_counts enable row level security;
drop policy if exists views_read on public.article_view_counts;
create policy views_read on public.article_view_counts for select using (true);

create or replace function public.visit_article_key(p text)
returns text
language sql
immutable
as $$
  select case
    when p like '/?article=%' then 's:' || lower(substr(p, 11))
    when p ~ '^/([A-Za-z-]+/)?articles/[0-9]+-' then 'i:' || substring(p from '/articles/([0-9]+)-')
  end
$$;

-- Запис одного відвідування (викликають сторінки сайту з публічним ключем)
create or replace function public.track_visit(v jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  vid text := coalesce(v->>'visitor', '');
  p text := left(coalesce(nullif(v->>'path', ''), '/'), 300);
  akey text;
  headers json;
  cc text;
begin
  if vid !~ '^[A-Za-z0-9_-]{6,40}$' then return; end if;
  -- Захист від засмічення: не більше 60 записів від одного браузера за 10 хвилин
  if (select count(*) from public.site_visits
      where visitor = vid and created_at > now() - interval '10 minutes') >= 60 then
    return;
  end if;
  begin
    headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    headers := null;
  end;
  cc := upper(coalesce(headers->>'cf-ipcountry', ''));
  if cc !~ '^[A-Z]{2}$' or cc in ('XX', 'T1') then cc := null; end if;
  insert into public.site_visits (visitor, path, title, ref, entry, lang, tz, country, device, os)
  values (
    vid,
    p,
    left(coalesce(v->>'title', ''), 300),
    nullif(left(lower(coalesce(v->>'ref', '')), 120), ''),
    coalesce(v->>'entry', 'true') = 'true',
    nullif(left(coalesce(v->>'lang', ''), 20), ''),
    nullif(left(coalesce(v->>'tz', ''), 60), ''),
    cc,
    nullif(left(coalesce(v->>'device', ''), 10), ''),
    nullif(left(coalesce(v->>'os', ''), 20), '')
  );
  akey := public.visit_article_key(p);
  if akey is not null then
    insert into public.article_view_counts as c (k, n) values (akey, 1)
    on conflict on constraint article_view_counts_pkey do update set n = c.n + 1;
  end if;
end;
$$;
revoke all on function public.track_visit(jsonb) from public;
grant execute on function public.track_visit(jsonb) to anon, authenticated;

-- Перерахунок лічильників прочитань з усіх записаних відвідувань
insert into public.article_view_counts (k, n)
select public.visit_article_key(path), count(*)
from public.site_visits
where public.visit_article_key(path) is not null
group by 1
on conflict (k) do update set n = excluded.n;

-- Зведення для автора за останні days днів (час київський)
create or replace function public.visit_stats(days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  kyiv constant text := 'Europe/Kyiv';
  d integer := greatest(1, least(coalesce(days, 30), 3700));
  unit text := case when d = 1 then 'hour' when d <= 92 then 'day' else 'month' end;
  local_now timestamp := now() at time zone kyiv;
  since timestamptz := (date_trunc('day', local_now) - (d - 1) * interval '1 day') at time zone kyiv;
  result jsonb;
begin
  if not coalesce(public.is_site_author(), false) then
    raise exception 'Статистику бачить лише автор сайту' using errcode = '42501';
  end if;

  with v as (
    select * from public.site_visits where created_at >= since
  )
  select jsonb_build_object(
    'since', since,
    'unit', unit,
    'views', (select count(*) from v),
    'visitors', (select count(distinct visitor) from v),
    'new_visitors', (select count(*) from (
        select 1 from public.site_visits group by visitor having min(created_at) >= since) n),
    'online', (select count(distinct visitor) from public.site_visits
               where created_at > now() - interval '5 minutes'),
    'series', (
      select coalesce(jsonb_agg(jsonb_build_object(
               't', to_char(g, 'YYYY-MM-DD"T"HH24:MI'),
               'views', coalesce(s.views, 0),
               'visitors', coalesce(s.visitors, 0)) order by g), '[]'::jsonb)
      from generate_series(date_trunc(unit, since at time zone kyiv), date_trunc(unit, local_now), ('1 ' || unit)::interval) g
      left join (
        select date_trunc(unit, created_at at time zone kyiv) as b, count(*) as views, count(distinct visitor) as visitors
        from v group by 1
      ) s on s.b = g
    ),
    'pages', (
      select coalesce(jsonb_agg(p order by p.visitors desc, p.views desc), '[]'::jsonb) from (
        select path, (array_agg(title order by created_at desc) filter (where title <> ''))[1] as title,
               count(*) as views, count(distinct visitor) as visitors
        from v group by path order by visitors desc, views desc limit 25
      ) p
    ),
    'places', (
      select coalesce(jsonb_agg(c order by c.visitors desc), '[]'::jsonb) from (
        select country, tz, count(distinct visitor) as visitors, count(*) as views
        from v group by country, tz order by visitors desc limit 400
      ) c
    ),
    'sources', (
      select coalesce(jsonb_agg(s order by s.entries desc), '[]'::jsonb) from (
        select coalesce(ref, '') as ref, count(*) as entries, count(distinct visitor) as visitors
        from v where entry group by 1 order by entries desc limit 100
      ) s
    ),
    'langs', (
      select coalesce(jsonb_agg(l order by l.visitors desc), '[]'::jsonb) from (
        select lower(split_part(coalesce(lang, ''), '-', 1)) as lang, count(distinct visitor) as visitors
        from v group by 1 order by visitors desc limit 40
      ) l
    ),
    'devices', (
      select coalesce(jsonb_agg(x order by x.visitors desc), '[]'::jsonb) from (
        select coalesce(device, '') as device, count(distinct visitor) as visitors from v group by 1
      ) x
    ),
    'systems', (
      select coalesce(jsonb_agg(x order by x.visitors desc), '[]'::jsonb) from (
        select coalesce(os, '') as os, count(distinct visitor) as visitors from v group by 1
      ) x
    ),
    'recent', (
      select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb) from (
        select created_at, visitor, path, title, ref, entry, country, tz, device, os, lang
        from public.site_visits order by created_at desc limit 60
      ) r
    )
  ) into result;
  return result;
end;
$$;
revoke all on function public.visit_stats(integer) from public, anon;
grant execute on function public.visit_stats(integer) to authenticated;

notify pgrst, 'reload schema';
