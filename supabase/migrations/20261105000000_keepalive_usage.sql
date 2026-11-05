-- Keep-alive and usage overview.
--
-- Free Supabase projects are paused after a week without database activity. An external
-- scheduler (cron-job.org, see README) calls `ping()` once a day through the REST API with
-- the public (publishable) key: it touches one row, so it counts as real database activity
-- and admins can see when it last ran.

create table public.keepalive (
	id integer primary key default 1 check (id = 1),
	pinged_at timestamptz not null default now(),
	pings bigint not null default 0
);
insert into public.keepalive default values;
alter table public.keepalive enable row level security;
-- No policies: only the functions below (security definer) read or write it.

create function public.ping()
returns timestamptz
language sql
volatile
security definer
set search_path = ''
as $$
	update public.keepalive set pinged_at = now(), pings = pings + 1 where id = 1 returning pinged_at;
$$;

revoke execute on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;

-- How much of the free plan the wiki uses (storage 1 GB, database 500 MB). Admins only.
create function public.usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not public.is_admin() then
		raise exception 'Solo per amministratori';
	end if;
	return jsonb_build_object(
		'storage_bytes', (
			select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects where bucket_id = 'wiki'
		),
		'folders', (
			select coalesce(jsonb_agg(f order by f.bytes desc), '[]'::jsonb)
			from (
				select coalesce((storage.foldername(name))[1], '') as folder,
					count(*) as files,
					sum(coalesce((metadata ->> 'size')::bigint, 0)) as bytes
				from storage.objects
				where bucket_id = 'wiki'
				group by 1
			) f
		),
		'database_bytes', pg_database_size(current_database()),
		'pinged_at', (select pinged_at from public.keepalive where id = 1)
	);
end;
$$;

revoke execute on function public.usage() from public, anon;
grant execute on function public.usage() to authenticated;
