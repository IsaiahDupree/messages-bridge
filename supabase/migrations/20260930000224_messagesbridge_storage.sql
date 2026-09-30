-- MessagesBridge isolated storage. Service role only; no public execution.
create table if not exists actp_messagesbridge_kv (
  k text primary key,
  v text not null,
  expires_at timestamptz
);

create table if not exists actp_messagesbridge_list (
  id bigserial primary key,
  k text not null,
  v text not null,
  expires_at timestamptz
);

create index if not exists actp_messagesbridge_list_k_id on actp_messagesbridge_list (k, id);
create index if not exists actp_messagesbridge_kv_expires on actp_messagesbridge_kv (expires_at) where expires_at is not null;

alter table actp_messagesbridge_kv enable row level security;
alter table actp_messagesbridge_list enable row level security;

create or replace function mb_get(p_k text) returns text
language sql security invoker set search_path = public as $$
  select v from actp_messagesbridge_kv where k = p_k and (expires_at is null or expires_at > now());
$$;

create or replace function mb_set(p_k text, p_v text, p_ttl_sec int default null) returns void
language plpgsql security invoker set search_path = public as $$
begin
  delete from actp_messagesbridge_kv where expires_at is not null and expires_at <= now();
  insert into actp_messagesbridge_kv (k, v, expires_at)
  values (p_k, p_v, case when p_ttl_sec is null then null else now() + make_interval(secs => p_ttl_sec) end)
  on conflict (k) do update set v = excluded.v, expires_at = excluded.expires_at;
end $$;

create or replace function mb_del(p_k text) returns void
language plpgsql security invoker set search_path = public as $$
begin
  delete from actp_messagesbridge_kv where k = p_k;
  delete from actp_messagesbridge_list where k = p_k;
end $$;

create or replace function mb_lpush(p_k text, p_v text) returns int
language plpgsql security invoker set search_path = public as $$
declare cnt int;
begin
  delete from actp_messagesbridge_list where expires_at is not null and expires_at <= now();
  insert into actp_messagesbridge_list (k, v) values (p_k, p_v);
  select count(*) into cnt from actp_messagesbridge_list where k = p_k;
  return cnt;
end $$;

-- lpush + rpop = FIFO: rpop returns the earliest-pushed surviving item.
create or replace function mb_rpop(p_k text) returns text
language plpgsql security invoker set search_path = public as $$
declare out_v text;
begin
  delete from actp_messagesbridge_list
  where id = (
    select id from actp_messagesbridge_list
    where k = p_k and (expires_at is null or expires_at > now())
    order by id asc
    limit 1
    for update skip locked
  )
  returning v into out_v;
  return out_v;
end $$;

-- Atomic fixed-window counter for rate limiting (Redis INCR semantics), which
-- also sets the TTL when the key is created or a stale window is reset — so a
-- bucket can never persist without an expiry. Single upsert = atomic under
-- concurrency; increments within a window keep the original expiry.
create or replace function mb_incr(p_k text, p_ttl_sec int default null) returns int
language plpgsql security invoker set search_path = public as $$
declare out_v int;
begin
  insert into actp_messagesbridge_kv (k, v, expires_at)
  values (p_k, '1', case when p_ttl_sec is null then null else now() + make_interval(secs => p_ttl_sec) end)
  on conflict (k) do update set
    v = case when actp_messagesbridge_kv.expires_at is not null and actp_messagesbridge_kv.expires_at <= now()
             then '1' else ((actp_messagesbridge_kv.v)::int + 1)::text end,
    expires_at = case when actp_messagesbridge_kv.expires_at is not null and actp_messagesbridge_kv.expires_at <= now()
                      then (case when p_ttl_sec is null then null else now() + make_interval(secs => p_ttl_sec) end)
                      else actp_messagesbridge_kv.expires_at end
  returning (v)::int into out_v;
  return out_v;
end $$;

create or replace function mb_expire(p_k text, p_ttl_sec int) returns int
language plpgsql security invoker set search_path = public as $$
declare n1 int := 0; n2 int := 0;
begin
  update actp_messagesbridge_kv set expires_at = now() + make_interval(secs => p_ttl_sec) where k = p_k;
  get diagnostics n1 = row_count;
  update actp_messagesbridge_list set expires_at = now() + make_interval(secs => p_ttl_sec) where k = p_k;
  get diagnostics n2 = row_count;
  return case when n1 + n2 > 0 then 1 else 0 end;
end $$;

revoke all on public.actp_messagesbridge_kv, public.actp_messagesbridge_list from public, anon, authenticated;
grant all on public.actp_messagesbridge_kv, public.actp_messagesbridge_list to service_role;
grant usage, select on sequence public.actp_messagesbridge_list_id_seq to service_role;
revoke all on function public.mb_get(text) from public, anon, authenticated;
grant execute on function public.mb_get(text) to service_role;
revoke all on function public.mb_set(text,text,int) from public, anon, authenticated;
grant execute on function public.mb_set(text,text,int) to service_role;
revoke all on function public.mb_del(text) from public, anon, authenticated;
grant execute on function public.mb_del(text) to service_role;
revoke all on function public.mb_lpush(text,text) from public, anon, authenticated;
grant execute on function public.mb_lpush(text,text) to service_role;
revoke all on function public.mb_rpop(text) from public, anon, authenticated;
grant execute on function public.mb_rpop(text) to service_role;
revoke all on function public.mb_incr(text,int) from public, anon, authenticated;
grant execute on function public.mb_incr(text,int) to service_role;
revoke all on function public.mb_expire(text,int) from public, anon, authenticated;
grant execute on function public.mb_expire(text,int) to service_role;
