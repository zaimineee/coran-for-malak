-- Coran for Malak : rappels entre amis (« Pense à lire le Coran aujourd'hui ») et notifications quand l'app est fermée.
-- À exécuter une fois dans l'éditeur SQL de Supabase, après schema.sql.

-- 1. Les rappels : seulement entre amis qui se sont ajoutés tous les deux, au plus un toutes les 6 heures
create table if not exists public.nudges (
  id bigint generated always as identity primary key,
  sender uuid not null references auth.users(id) on delete cascade,
  receiver uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  seen boolean not null default false,
  pushed boolean not null default false,
  check (sender <> receiver)
);
create index if not exists nudges_receiver on public.nudges (receiver, created_at desc);
create index if not exists nudges_sender on public.nudges (sender, receiver, created_at desc);
alter table public.nudges enable row level security;
revoke all on public.nudges from anon, authenticated;
grant select, update (seen) on public.nudges to authenticated;
drop policy if exists "rappels : les miens" on public.nudges;
create policy "rappels : les miens" on public.nudges for select to authenticated
  using (receiver = (select auth.uid()) or sender = (select auth.uid()));
drop policy if exists "rappels : marquer lus" on public.nudges;
create policy "rappels : marquer lus" on public.nudges for update to authenticated
  using (receiver = (select auth.uid())) with check (receiver = (select auth.uid()));

create or replace function public.send_nudge(target uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then return 'session'; end if;
  if target is null or target = me then return 'soi'; end if;
  if not exists (select 1 from public.friends f where f.owner = me and f.friend = target)
     or not exists (select 1 from public.friends f where f.owner = target and f.friend = me) then return 'pas_ami'; end if;
  if exists (select 1 from public.nudges n where n.sender = me and n.receiver = target and n.created_at > now() - interval '6 hours') then return 'deja'; end if;
  if (select count(*) from public.nudges n where n.sender = me and n.created_at > now() - interval '1 day') >= 30 then return 'trop'; end if;
  insert into public.nudges (sender, receiver) values (me, target);
  delete from public.nudges n where n.created_at < now() - interval '30 days';
  return 'ok';
end $$;
revoke all on function public.send_nudge(uuid) from public, anon;
grant execute on function public.send_nudge(uuid) to authenticated;

-- Mes rappels reçus et pas encore vus (2 derniers jours), avec le prénom de l'ami
create or replace function public.my_nudges() returns table (id bigint, sender uuid, username text, name text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select n.id, n.sender, p.username, coalesce(s.name, ''), n.created_at
  from public.nudges n join public.profiles p on p.id = n.sender left join public.stats s on s.id = n.sender
  where n.receiver = (select auth.uid()) and not n.seen and n.created_at > now() - interval '2 days'
  order by n.created_at desc limit 20;
$$;
revoke all on function public.my_nudges() from public, anon;
grant execute on function public.my_nudges() to authenticated;

-- 2. Les abonnements aux notifications (un par téléphone ; l'adresse vient d'Apple ou de Google)
create table if not exists public.push_subs (
  endpoint text primary key check (length(endpoint) < 1000 and endpoint like 'https://%'),
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null check (length(p256dh) between 80 and 120),
  auth text not null check (length(auth) between 16 and 40),
  created_at timestamptz not null default now()
);
create index if not exists push_subs_user on public.push_subs (user_id);
alter table public.push_subs enable row level security;
revoke all on public.push_subs from anon, authenticated;
grant select on public.push_subs to authenticated;
drop policy if exists "notifications : les miennes" on public.push_subs;
create policy "notifications : les miennes" on public.push_subs for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.save_push(e text, k text, a text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'non connecté'; end if;
  delete from public.push_subs where endpoint = e; -- ce téléphone passe à ce compte
  insert into public.push_subs (endpoint, user_id, p256dh, auth) values (e, me, k, a);
  delete from public.push_subs where user_id = me and endpoint in
    (select endpoint from public.push_subs where user_id = me order by created_at desc offset 10); -- 10 téléphones au plus
end $$;
revoke all on function public.save_push(text, text, text) from public, anon;
grant execute on function public.save_push(text, text, text) to authenticated;

create or replace function public.drop_push(e text) returns void
language sql volatile security definer set search_path = '' as $$
  delete from public.push_subs where endpoint = e and user_id = (select auth.uid());
$$;
revoke all on function public.drop_push(text) from public, anon;
grant execute on function public.drop_push(text) to authenticated;

-- 3. Les clés VAPID du serveur de notifications : créées par la fonction « rappel » elle-même au premier appel,
-- lisibles seulement par elle (aucun accès pour l'app ni pour les visiteurs).
create table if not exists public.vapid_keys (
  id int primary key default 1 check (id = 1),
  public_key text not null,
  private_jwk jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.vapid_keys enable row level security;
revoke all on public.vapid_keys from anon, authenticated;

-- 4. Accès de la fonction « rappel » (clé secrète = rôle service_role) : seulement ce dont elle a besoin.
-- (Les nouveaux projets Supabase ne donnent plus ces droits automatiquement.)
grant select, insert on public.vapid_keys to service_role;
grant select, update (pushed) on public.nudges to service_role;
grant select, delete on public.push_subs to service_role;
grant select on public.stats to service_role;
