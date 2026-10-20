-- Run on Supabase PostgreSQL as an administrator. No client-facing policies.
create table public.mori_billing_accounts (
  user_id uuid primary key references auth.users(id),
  revision bigint not null default 0,
  state jsonb not null,
  next_work_at timestamptz,
  updated_at timestamptz not null default now(),
  check (state->>'id' = user_id::text)
);
create table public.mori_billing_orders (
  order_id text primary key,
  user_id uuid not null references public.mori_billing_accounts(user_id),
  payment_key text unique
);
create table public.mori_billing_rate_limits (
  bucket text primary key,
  count integer not null,
  expires_at timestamptz not null
);
create table public.mori_billing_audit (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  revision bigint not null,
  at timestamptz not null default now(),
  summary jsonb not null
);
alter table public.mori_billing_accounts enable row level security;
alter table public.mori_billing_orders enable row level security;
alter table public.mori_billing_rate_limits enable row level security;
alter table public.mori_billing_audit enable row level security;
revoke all on public.mori_billing_accounts, public.mori_billing_orders, public.mori_billing_rate_limits from public, anon, authenticated;
grant all on public.mori_billing_accounts, public.mori_billing_orders, public.mori_billing_rate_limits to service_role;
revoke all on public.mori_billing_audit from public, anon, authenticated;
grant all on public.mori_billing_audit to service_role;
grant usage, select on sequence public.mori_billing_audit_id_seq to service_role;
create index mori_billing_due on public.mori_billing_accounts(next_work_at);

create function public.mori_billing_ensure(p_id uuid, p_state jsonb) returns void
language sql security invoker set search_path = public as $$
  insert into mori_billing_accounts(user_id, state) values (p_id, p_state) on conflict do nothing;
$$;
create function public.mori_billing_cas(p_id uuid, p_revision bigint, p_state jsonb, p_next timestamptz) returns boolean
language plpgsql security invoker set search_path = public as $$
declare item jsonb; existing uuid;
begin
  if p_state->>'id' <> p_id::text or (p_state->>'revision')::bigint <> p_revision + 1 then raise exception 'invalid state'; end if;
  update mori_billing_accounts set state=p_state, revision=p_revision+1, next_work_at=p_next, updated_at=now()
    where user_id=p_id and revision=p_revision;
  if not found then return false; end if;
  insert into mori_billing_audit(user_id,revision,summary) values(p_id,p_revision+1,jsonb_build_object(
    'trialEnd',p_state->'trialEnd','paidUntil',p_state->'paidUntil','cancelAtEnd',p_state->'cancelAtEnd',
    'blocked',p_state->'blocked','devices',jsonb_array_length(p_state->'devices'),
    'attemptState',p_state->'attempts'->-1->'state'));
  for item in select * from jsonb_array_elements(p_state->'attempts') loop
    select user_id into existing from mori_billing_orders where order_id=item->>'order';
    if existing is not null and existing <> p_id then raise exception 'order ownership mismatch'; end if;
    insert into mori_billing_orders(order_id,user_id,payment_key) values(item->>'order',p_id,item->>'paymentKey')
      on conflict(order_id) do update set payment_key=excluded.payment_key;
  end loop;
  return true;
end;
$$;
create function public.mori_billing_rate(p_bucket text, p_max integer, p_seconds integer) returns boolean
language plpgsql security invoker set search_path = public as $$
declare result integer;
begin
  if p_max < 1 or p_seconds < 1 or p_seconds > 86400 then raise exception 'invalid limit'; end if;
  insert into mori_billing_rate_limits as r(bucket,count,expires_at) values(p_bucket,1,now()+make_interval(secs=>p_seconds))
    on conflict(bucket) do update set count=case when r.expires_at <= now() then 1 else r.count+1 end,
      expires_at=case when r.expires_at <= now() then now()+make_interval(secs=>p_seconds) else r.expires_at end
    returning count into result;
  delete from mori_billing_rate_limits where expires_at < now()-interval '1 day';
  return result <= p_max;
end;
$$;
revoke all on function public.mori_billing_ensure(uuid,jsonb), public.mori_billing_cas(uuid,bigint,jsonb,timestamptz), public.mori_billing_rate(text,integer,integer) from public, anon, authenticated;
grant execute on function public.mori_billing_ensure(uuid,jsonb), public.mori_billing_cas(uuid,bigint,jsonb,timestamptz), public.mori_billing_rate(text,integer,integer) to service_role;
