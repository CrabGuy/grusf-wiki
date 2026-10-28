-- GRUSF wiki - initial schema
--
-- Source of truth for the wiki content is the `wiki` storage bucket, which mirrors a
-- DokuWiki `data/` directory (pages/, attic/, meta/, media/). The tables below are an
-- index of that content (fast reads, listing, full text search, recent changes) and
-- the user profiles. Only the edge functions (service role) write to them.

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
	id uuid primary key references auth.users (id) on delete cascade,
	username text not null unique check (username ~ '^[a-z0-9._-]{2,32}$'),
	display_name text not null default '',
	role text not null default 'user' check (role in ('admin', 'user')),
	created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "members can read profiles"
	on public.profiles for select to authenticated using (true);

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ---------------------------------------------------------------------------
-- Page index
-- ---------------------------------------------------------------------------
create table public.pages (
	id text primary key,              -- DokuWiki page id, e.g. `eventi:checklist`
	title text not null,
	content text not null,
	rev bigint not null,              -- unix timestamp of the current revision
	size integer not null default 0,
	updated_at timestamptz not null default now(),
	updated_by text,
	search tsvector generated always as (
		setweight(to_tsvector('italian', coalesce(title, '')), 'A') ||
		setweight(to_tsvector('simple', replace(replace(id, ':', ' '), '_', ' ')), 'A') ||
		setweight(to_tsvector('italian', coalesce(content, '')), 'B')
	) stored
);

create index pages_search_idx on public.pages using gin (search);
create index pages_updated_idx on public.pages (updated_at desc);

alter table public.pages enable row level security;

create policy "members can read pages"
	on public.pages for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Changelog (mirrors DokuWiki meta/*.changes)
-- ---------------------------------------------------------------------------
create table public.page_changes (
	id bigint generated always as identity primary key,
	page_id text not null,
	rev bigint not null,
	type text not null check (type in ('C', 'E', 'e', 'D', 'R')),
	username text,
	summary text not null default '',
	size_change integer not null default 0,
	unique (page_id, rev)
);

create index page_changes_rev_idx on public.page_changes (rev desc);

alter table public.page_changes enable row level security;

create policy "members can read changes"
	on public.page_changes for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Full text search
-- ---------------------------------------------------------------------------
create function public.search_pages(q text)
returns table (id text, title text, snippet text, rank real)
language sql
stable
set search_path = ''
as $$
	with query as (select websearch_to_tsquery('italian', q) as tsq)
	select
		p.id,
		p.title,
		ts_headline('italian', p.content, query.tsq,
			'StartSel=⟦, StopSel=⟧, MaxWords=24, MinWords=10, MaxFragments=1') as snippet,
		ts_rank(p.search, query.tsq)
			+ case when p.title ilike '%' || q || '%' then 1 else 0 end
			+ case when p.id ilike '%' || q || '%' then 0.5 else 0 end as rank
	from public.pages p, query
	where p.search @@ query.tsq
		or p.title ilike '%' || q || '%'
		or p.id ilike '%' || q || '%'
	order by rank desc, p.updated_at desc
	limit 50;
$$;

-- ---------------------------------------------------------------------------
-- Storage: private bucket that mirrors DokuWiki's data/ directory
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('wiki', 'wiki', false, 52428800)
on conflict (id) do nothing;

-- Every logged in member can read everything in the bucket.
create policy "members read wiki files"
	on storage.objects for select to authenticated
	using (bucket_id = 'wiki');

-- Members upload images/attachments directly; pages/attic/meta are written only by the
-- `wiki` edge function so the history stays consistent.
create policy "members upload media"
	on storage.objects for insert to authenticated
	with check (bucket_id = 'wiki' and (storage.foldername(name))[1] = 'media');
