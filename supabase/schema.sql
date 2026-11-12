-- Coran for Malak : comptes en ligne (identifiant + mot de passe), sauvegarde de la progression, amis.
-- À exécuter une fois dans l'éditeur SQL de Supabase. Chaque table est protégée par des règles d'accès (RLS).

-- 1. Progression complète : visible et modifiable seulement par son propriétaire
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_.]{3,20}$'),
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) < 2000000),
  updated_at timestamptz not null default now()
);

-- 2. Petites stats partagées avec les amis (rien d'autre n'est partagé)
create table if not exists public.stats (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  name text not null default '' check (char_length(name) <= 30),
  mascot text not null default '' check (char_length(mascot) <= 12),
  streak int not null default 0 check (streak between 0 and 100000),
  last_day int not null default 0 check (last_day between 0 and 99991231),
  today_ayat int not null default 0 check (today_ayat between 0 and 100000),
  today_hasanat int not null default 0 check (today_hasanat between 0 and 100000000),
  week_hasanat int not null default 0 check (week_hasanat between 0 and 1000000000),
  total_ayat int not null default 0 check (total_ayat between 0 and 100000000),
  updated_at timestamptz not null default now()
);

-- 3. Amis : une ligne = « owner a ajouté friend ». Les stats de A ne sont visibles par B que si A a ajouté B.
create table if not exists public.friends (
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  friend uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner, friend),
  check (owner <> friend)
);
create index if not exists friends_friend_idx on public.friends(friend);

alter table public.profiles enable row level security;
alter table public.stats enable row level security;
alter table public.friends enable row level security;

drop policy if exists "profil : lire le sien" on public.profiles;
drop policy if exists "profil : modifier le sien" on public.profiles;
create policy "profil : lire le sien" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "profil : modifier le sien" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "stats : lire les siennes et celles des amis qui m'ont ajouté" on public.stats;
drop policy if exists "stats : modifier les siennes" on public.stats;
create policy "stats : lire les siennes et celles des amis qui m'ont ajouté" on public.stats for select to authenticated
  using (id = (select auth.uid()) or exists (select 1 from public.friends f where f.owner = stats.id and f.friend = (select auth.uid())));
create policy "stats : modifier les siennes" on public.stats for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "amis : voir mes liens" on public.friends;
drop policy if exists "amis : ajouter" on public.friends;
drop policy if exists "amis : retirer" on public.friends;
create policy "amis : voir mes liens" on public.friends for select to authenticated using (owner = (select auth.uid()) or friend = (select auth.uid()));
create policy "amis : ajouter" on public.friends for insert to authenticated with check (owner = (select auth.uid()));
create policy "amis : retirer" on public.friends for delete to authenticated using (owner = (select auth.uid()));

-- Droits : rien pour les visiteurs anonymes ; le strict nécessaire pour les comptes connectés
revoke all on public.profiles, public.stats, public.friends from anon, authenticated;
grant select, update (data, updated_at) on public.profiles to authenticated;
grant select, update (name, mascot, streak, last_day, today_ayat, today_hasanat, week_hasanat, total_ayat, updated_at) on public.stats to authenticated;
grant select, insert (friend), delete on public.friends to authenticated;

-- À l'inscription : le profil et les stats sont créés avec l'identifiant choisi
create or replace function public.on_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare u text := lower(coalesce(new.raw_user_meta_data->>'username', ''));
begin
  if u !~ '^[a-z0-9_.]{3,20}$' then raise exception 'identifiant invalide'; end if;
  insert into public.profiles (id, username) values (new.id, u);
  insert into public.stats (id, username) values (new.id, u);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.on_new_user();

-- Trouver un compte par son identifiant (pour ajouter un ami) : renvoie seulement son numéro interne
create or replace function public.find_user(uname text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.profiles where username = lower(uname) limit 1;
$$;
revoke all on function public.find_user(text) from public, anon;
grant execute on function public.find_user(text) to authenticated;

-- Les personnes qui m'ont ajouté (pour « Ajouter aussi ») : identifiant et prénom seulement
create or replace function public.who_added_me() returns table (id uuid, username text, name text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.username, s.name from public.friends f join public.stats s on s.id = f.owner where f.friend = (select auth.uid());
$$;
revoke all on function public.who_added_me() from public, anon;
grant execute on function public.who_added_me() to authenticated;

-- Les amis que j'ai ajoutés (identifiant seulement), pour afficher ceux qui ne m'ont pas encore ajouté·e
create or replace function public.my_friends() returns table (id uuid, username text)
language sql stable security definer set search_path = '' as $$
  select f.friend, p.username from public.friends f join public.profiles p on p.id = f.friend where f.owner = (select auth.uid());
$$;
revoke all on function public.my_friends() from public, anon;
grant execute on function public.my_friends() to authenticated;

-- Supprimer mon compte en ligne (et tout ce qui va avec)
create or replace function public.delete_me() returns void
language sql security definer set search_path = '' as $$
  delete from auth.users where id = (select auth.uid());
$$;
revoke all on function public.delete_me() from public, anon;
grant execute on function public.delete_me() to authenticated;

-- Petit « bonjour » quotidien pour que le projet gratuit ne se mette pas en pause
create or replace function public.ping() returns int language sql stable as $$ select 1 $$;
grant execute on function public.ping() to anon, authenticated;
