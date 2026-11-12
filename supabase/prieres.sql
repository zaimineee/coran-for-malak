-- Coran for Malak : notifications aux heures de prière (même app fermée).
-- À exécuter une fois dans l'éditeur SQL de Supabase, après schema.sql et rappels.sql.
--
-- Le téléphone calcule lui-même les heures de prière (sa position ne quitte jamais le téléphone) et envoie
-- seulement les moments des alertes des 30 prochains jours. Chaque minute, une tâche planifiée (pg_cron)
-- appelle la fonction « rappel », qui envoie les notifications dues (Web Push, voir rappels.sql).

-- 1. Les alertes programmées : moment, prière, minutes d'avance. Rien d'autre.
create table if not exists public.prayer_slots (
  user_id uuid not null references auth.users(id) on delete cascade,
  at timestamptz not null,
  prayer text not null check (prayer in ('fajr', 'dhuhr', 'asr', 'maghrib', 'isha')),
  before smallint not null default 0 check (before between 0 and 30),
  sent boolean not null default false,
  primary key (user_id, at, prayer)
);
create index if not exists prayer_slots_due on public.prayer_slots (at) where not sent;
alter table public.prayer_slots enable row level security;
revoke all on public.prayer_slots from anon, authenticated;
grant select, insert, update, delete on public.prayer_slots to service_role;

-- Remplace toutes mes alertes par celles envoyées par le téléphone : [[secondes depuis 1970, prière, minutes d'avance], …]
create or replace function public.set_prayer_slots(s jsonb) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare me uuid := auth.uid(); n integer;
begin
  if me is null then raise exception 'session'; end if;
  if s is null or jsonb_typeof(s) <> 'array' or jsonb_array_length(s) > 200 then raise exception 'alertes invalides'; end if;
  delete from public.prayer_slots where user_id = me;
  insert into public.prayer_slots (user_id, at, prayer, before)
    select me, to_timestamp((e->>0)::bigint), e->>1, (e->>2)::smallint
    from jsonb_array_elements(s) as e
    where jsonb_typeof(e) = 'array' and jsonb_array_length(e) = 3
      and jsonb_typeof(e->0) = 'number' and (e->>0) ~ '^[0-9]{9,11}$'
      and (e->>1) in ('fajr', 'dhuhr', 'asr', 'maghrib', 'isha')
      and jsonb_typeof(e->2) = 'number' and (e->>2) in ('0', '5', '10', '15', '30')
      and to_timestamp((e->>0)::bigint) between now() - interval '1 minute' and now() + interval '40 days'
    on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.set_prayer_slots(jsonb) from public, anon;
grant execute on function public.set_prayer_slots(jsonb) to authenticated;

-- Efface toutes mes alertes (désactivation, déconnexion)
create or replace function public.clear_prayer_slots() returns void
language sql volatile security definer set search_path = '' as $$
  delete from public.prayer_slots where user_id = (select auth.uid());
$$;
revoke all on function public.clear_prayer_slots() from public, anon;
grant execute on function public.clear_prayer_slots() to authenticated;

-- Où en sont mes alertes : nombre à venir et la dernière (l'app affiche « jusqu'au … »)
create or replace function public.my_prayer_slots() returns table (n integer, last_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select count(*)::integer, max(at) from public.prayer_slots where user_id = (select auth.uid()) and not sent and at > now();
$$;
revoke all on function public.my_prayer_slots() from public, anon;
grant execute on function public.my_prayer_slots() to authenticated;

-- Pour la fonction « rappel » seulement : prend les alertes dues (une seule fois chacune) et fait le ménage
create or replace function public.claim_prayer_slots() returns table (user_id uuid, prayer text, before smallint)
language plpgsql volatile security definer set search_path = '' as $$
begin
  delete from public.prayer_slots p where p.at < now() - interval '1 day';
  return query
    update public.prayer_slots p set sent = true
    where not p.sent and p.at <= now() and p.at > now() - interval '20 minutes'
    returning p.user_id, p.prayer, p.before;
end $$;
revoke all on function public.claim_prayer_slots() from public, anon, authenticated;
grant execute on function public.claim_prayer_slots() to service_role;

-- 2. Mot de passe interne entre la tâche planifiée et la fonction (créé ici au hasard, jamais montré)
create table if not exists public.cron_secret (
  id integer primary key default 1 check (id = 1),
  token text not null
);
alter table public.cron_secret enable row level security;
revoke all on public.cron_secret from anon, authenticated;
grant select on public.cron_secret to service_role;
insert into public.cron_secret (id, token)
  values (1, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (id) do nothing;

-- 3. La tâche planifiée : chaque minute, seulement s'il y a une alerte due, appelle la fonction « rappel »
-- (clé publique de l'app comme apikey : la passerelle laisse passer, et la fonction vérifie le mot de passe interne)
do $cron$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron ou pg_net absent : tâche planifiée non créée (normal en dehors de Supabase)';
    return;
  end if;
  create extension if not exists pg_cron;
  create extension if not exists pg_net;
  perform cron.schedule('coran-prieres', '* * * * *', $job$
    select net.http_post(
      url := 'https://jqlhxsngakelcadtqmkd.supabase.co/functions/v1/rappel',
      headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', 'sb_publishable_zzMX4GqErNkrRr1jznCY0Q_hHwAh1GX',
                                    'x-cron', (select token from public.cron_secret where id = 1)),
      body := '{"op":"prayers"}'::jsonb,
      timeout_milliseconds := 20000)
    where exists (select 1 from public.prayer_slots where not sent and at <= now() and at > now() - interval '20 minutes');
  $job$);
end
$cron$;
