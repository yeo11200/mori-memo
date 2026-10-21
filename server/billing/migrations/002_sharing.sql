create table public.mori_shares (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null check (source_key ~ '^[a-f0-9]{64}$'),
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{43}$'),
  title text not null check (char_length(title) between 1 and 200),
  body text not null check (char_length(body) <= 100000),
  digest text not null,
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  revoked boolean not null default false,
  unique(user_id, source_key)
);
alter table public.mori_shares enable row level security;
revoke all on public.mori_shares from public, anon, authenticated;
grant all on public.mori_shares to service_role;
create function public.mori_share_mutate(p_user uuid,p_source text,p_operation text,p_revision integer,p_id uuid,p_token text,p_title text,p_body text,p_digest text)
returns setof public.mori_shares language plpgsql security invoker set search_path=public as $$
declare existing mori_shares;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  select * into existing from mori_shares where user_id=p_user and source_key=p_source;
  if p_operation='create' and existing.id is not null and not existing.revoked then return next existing; return; end if;
  if p_revision <> coalesce(existing.revision,0) then raise exception 'share_conflict'; end if;
  if p_operation='revoke' then
    if existing.id is null then raise exception 'share_missing'; end if;
    update mori_shares set revoked=true, body='', revision=revision+1, updated_at=now() where id=existing.id returning * into existing;
  elsif p_operation in ('create','update') then
    if p_operation='update' and (existing.id is null or existing.revoked) then raise exception 'share_missing'; end if;
    if p_operation='create' and (select count(*) from mori_shares where user_id=p_user and not revoked)>=20 then raise exception 'share_limit'; end if;
    insert into mori_shares(id,user_id,source_key,token,title,body,digest)
      values(p_id,p_user,p_source,p_token,p_title,p_body,p_digest)
      on conflict(user_id,source_key) do update set token=case when mori_shares.revoked then excluded.token else mori_shares.token end,
        title=excluded.title,body=excluded.body,digest=excluded.digest,revoked=false,revision=mori_shares.revision+1,updated_at=now()
      returning * into existing;
  else raise exception 'share_operation'; end if;
  return next existing;
end;
$$;
revoke all on function public.mori_share_mutate(uuid,text,text,integer,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.mori_share_mutate(uuid,text,text,integer,uuid,text,text,text,text) to service_role;
