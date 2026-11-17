-- Coran for Malak 1.23 : on peut encourager le même ami une fois par heure (avant : toutes les 6 heures), 100 encouragements par jour en tout (avant : 30).
-- À exécuter une fois dans l'éditeur SQL de Supabase. Sans danger si on le relance (remplace seulement la fonction send_nudge).
create or replace function public.send_nudge(target uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then return 'session'; end if;
  if target is null or target = me then return 'soi'; end if;
  if not exists (select 1 from public.friends f where f.owner = me and f.friend = target)
     or not exists (select 1 from public.friends f where f.owner = target and f.friend = me) then return 'pas_ami'; end if;
  if exists (select 1 from public.nudges n where n.sender = me and n.receiver = target and n.created_at > now() - interval '1 hour') then return 'deja'; end if;
  if (select count(*) from public.nudges n where n.sender = me and n.created_at > now() - interval '1 day') >= 100 then return 'trop'; end if;
  insert into public.nudges (sender, receiver) values (me, target);
  delete from public.nudges n where n.created_at < now() - interval '30 days';
  return 'ok';
end $$;
revoke all on function public.send_nudge(uuid) from public, anon;
grant execute on function public.send_nudge(uuid) to authenticated;
