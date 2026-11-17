-- Coran for Malak 1.20 : rappel quotidien de lecture par notification de l'app (même chemin que les alertes de prière).
-- À exécuter une fois dans l'éditeur SQL de Supabase, après prieres.sql. Sans danger si on le relance.
--
-- Le téléphone envoie, avec ses alertes de prière, un rappel par jour à l'heure choisie : [secondes, 'lecture', 0, AAAAMMJJ].
-- AAAAMMJJ est la date du téléphone ce jour-là : si la lecture de ce jour est déjà faite (public.stats, publiée par l'app),
-- le rappel n'est pas envoyé. Rien d'autre ne part du téléphone (ni position, ni heure de prière en clair).

-- 1. Un 6e type d'alerte, « lecture », et sa date
alter table public.prayer_slots drop constraint if exists prayer_slots_prayer_check;
alter table public.prayer_slots add constraint prayer_slots_prayer_check check (prayer in ('fajr', 'dhuhr', 'asr', 'maghrib', 'isha', 'lecture'));
alter table public.prayer_slots add column if not exists day integer;
alter table public.prayer_slots drop constraint if exists prayer_slots_day_check;
alter table public.prayer_slots add constraint prayer_slots_day_check check (day is null or (prayer = 'lecture' and day between 20240101 and 21001231));

-- 2. Remplace toutes mes alertes : [[secondes, prière, minutes d'avance], …] et [[secondes, 'lecture', 0, AAAAMMJJ], …]
create or replace function public.set_prayer_slots(s jsonb) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare me uuid := auth.uid(); n integer;
begin
  if me is null then raise exception 'session'; end if;
  if s is null or jsonb_typeof(s) <> 'array' or jsonb_array_length(s) > 200 then raise exception 'alertes invalides'; end if;
  delete from public.prayer_slots where user_id = me;
  insert into public.prayer_slots (user_id, at, prayer, before, day)
    select me, to_timestamp((e->>0)::bigint), e->>1, (e->>2)::smallint, case when e->>1 = 'lecture' then (e->>3)::integer end
    from jsonb_array_elements(s) as e
    where jsonb_typeof(e) = 'array'
      and jsonb_typeof(e->0) = 'number' and (e->>0) ~ '^[0-9]{9,11}$'
      and jsonb_typeof(e->2) = 'number'
      and ((jsonb_array_length(e) = 3 and (e->>1) in ('fajr', 'dhuhr', 'asr', 'maghrib', 'isha') and (e->>2) in ('0', '5', '10', '15', '30'))
        or (jsonb_array_length(e) = 4 and (e->>1) = 'lecture' and (e->>2) = '0' and jsonb_typeof(e->3) = 'number' and (e->>3) ~ '^20[2-9][0-9][01][0-9][0-3][0-9]$'))
      and to_timestamp((e->>0)::bigint) between now() - interval '1 minute' and now() + interval '40 days'
    on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.set_prayer_slots(jsonb) from public, anon;
grant execute on function public.set_prayer_slots(jsonb) to authenticated;

-- 3. Pour la fonction « rappel » : les alertes dues (une seule fois chacune) ; un rappel de lecture déjà fait est seulement marqué envoyé
create or replace function public.claim_prayer_slots() returns table (user_id uuid, prayer text, before smallint)
language plpgsql volatile security definer set search_path = '' as $$
begin
  delete from public.prayer_slots p where p.at < now() - interval '1 day';
  return query
    with d as (
      update public.prayer_slots p set sent = true
      where not p.sent and p.at <= now() and p.at > now() - interval '20 minutes'
      returning p.user_id as uid, p.prayer as pr, p.before as bf, p.day as dy
    )
    select d.uid, d.pr, d.bf from d
    where d.pr <> 'lecture' or not exists (select 1 from public.stats st where st.id = d.uid and st.last_day = d.dy and st.today_ayat > 0);
end $$;
revoke all on function public.claim_prayer_slots() from public, anon, authenticated;
grant execute on function public.claim_prayer_slots() to service_role;
