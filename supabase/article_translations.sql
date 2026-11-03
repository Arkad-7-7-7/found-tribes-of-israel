-- Службова таблиця для автоматичних перекладів статей
-- (її заповнює netlify/functions/translate-articles.mjs, а читає scripts/build-pages.mjs).
-- Як запустити: Supabase → SQL Editor → New query → вставити все → Run.
-- Оригінали статей (таблиця articles) не змінюються.
create table if not exists public.article_translations (article_id bigint not null, lang text not null, title text not null default '', content text not null default '', source_hash text not null default '', chars integer not null default 0, engine text not null default 'google', translated_at timestamptz not null default now(), primary key (article_id, lang));
alter table public.article_translations enable row level security;
drop policy if exists tr_read on public.article_translations;
create policy tr_read on public.article_translations for select using (true);
drop policy if exists tr_author on public.article_translations;
create policy tr_author on public.article_translations for all to authenticated using (public.is_site_author()) with check (public.is_site_author());
