-- =====================================================================
--  Mundwerk – Datenbank-Schema für Supabase
--  Einmal komplett im Supabase SQL-Editor ausführen (Projekt → SQL Editor
--  → New query → einfügen → Run). Das Skript kann gefahrlos erneut
--  ausgeführt werden; bestehende Daten bleiben erhalten.
-- =====================================================================

-- ---------- Einstellungen ------------------------------------------------
-- Stimmen, ab denen ein Vorschlag automatisch aufgenommen wird.
create or replace function public.mw_schwelle() returns int
language sql immutable as $$ select 20 $$;

-- Meldungen, ab denen ein offener Vorschlag zur Prüfung ausgeblendet wird.
create or replace function public.mw_meldeschwelle() returns int
language sql immutable as $$ select 3 $$;

-- ---------- Admins -------------------------------------------------------
create table if not exists public.admins (
  user_id uuid primary key references auth.users on delete cascade
);
alter table public.admins enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

drop policy if exists "admins lesen" on public.admins;
create policy "admins lesen" on public.admins for select to authenticated
  using (user_id = auth.uid());

-- ---------- Profile (Anzeigename) ---------------------------------------
create table if not exists public.profile (
  user_id    uuid primary key default auth.uid() references auth.users on delete cascade,
  name       text not null check (char_length(btrim(name)) between 2 and 30),
  created_at timestamptz not null default now()
);
create unique index if not exists profile_name_eindeutig on public.profile (lower(btrim(name)));
alter table public.profile enable row level security;

drop policy if exists "profile lesen" on public.profile;
create policy "profile lesen" on public.profile for select to anon, authenticated using (true);
drop policy if exists "profil anlegen" on public.profile;
create policy "profil anlegen" on public.profile for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "profil ändern" on public.profile;
create policy "profil ändern" on public.profile for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Vorschläge ---------------------------------------------------
create table if not exists public.vorschlaege (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  dialekt        text not null default 'tirol' check (dialekt ~ '^[a-z]{2,20}$'),
  t              text not null check (char_length(btrim(t)) between 1 and 120),
  d              text not null check (char_length(btrim(d)) between 1 and 160),
  n              text not null default '' check (char_length(n) <= 160),
  sit            text not null check (sit ~ '^[a-z]{2,20}$'),
  status         text not null default 'offen'
                 check (status in ('offen', 'aufgenommen', 'pruefen', 'entfernt')),
  stimmen        int  not null default 0,
  meldungen      int  not null default 0,
  created_at     timestamptz not null default now(),
  aufgenommen_at timestamptz,
  t_norm         text generated always as
                 (lower(regexp_replace(translate(t, 'åÅ', 'aa'), '[^[:alnum:]]+', '', 'g'))) stored
);
create unique index if not exists vorschlaege_keine_dubletten
  on public.vorschlaege (dialekt, t_norm) where status <> 'entfernt';
create index if not exists vorschlaege_status on public.vorschlaege (dialekt, status);
alter table public.vorschlaege enable row level security;

-- Beim Einreichen: Felder festlegen, die niemand selbst setzen darf, und Limits prüfen.
create or replace function public.vorschlag_vor_einfuegen() returns trigger
language plpgsql security definer set search_path = public as $$
declare offen int; heute int;
begin
  if auth.uid() is null then raise exception 'Bitte anmelden.'; end if;
  new.user_id := auth.uid();
  new.status := 'offen'; new.stimmen := 0; new.meldungen := 0;
  new.created_at := now(); new.aufgenommen_at := null;
  new.t := btrim(new.t); new.d := btrim(new.d); new.n := btrim(coalesce(new.n, ''));
  select count(*) into offen from vorschlaege where user_id = new.user_id and status in ('offen', 'pruefen');
  if offen >= 50 then raise exception 'Du hast schon 50 offene Vorschläge.' using errcode = 'P0001'; end if;
  select count(*) into heute from vorschlaege where user_id = new.user_id and created_at > now() - interval '1 day';
  if heute >= 15 then raise exception 'Heute sind keine weiteren Vorschläge möglich.' using errcode = 'P0001'; end if;
  return new;
end $$;
drop trigger if exists vorschlag_vor_einfuegen on public.vorschlaege;
create trigger vorschlag_vor_einfuegen before insert on public.vorschlaege
  for each row execute function public.vorschlag_vor_einfuegen();

-- Admins dürfen nur den Status ändern (und Tippfehler in Text/Übersetzung korrigieren).
create or replace function public.vorschlag_vor_aendern() returns trigger
language plpgsql as $$
begin
  new.id := old.id; new.user_id := old.user_id; new.created_at := old.created_at;
  new.dialekt := old.dialekt;
  if new.status = 'aufgenommen' and old.status <> 'aufgenommen' then new.aufgenommen_at := now(); end if;
  return new;
end $$;
drop trigger if exists vorschlag_vor_aendern on public.vorschlaege;
create trigger vorschlag_vor_aendern before update on public.vorschlaege
  for each row execute function public.vorschlag_vor_aendern();

drop policy if exists "vorschläge lesen" on public.vorschlaege;
create policy "vorschläge lesen" on public.vorschlaege for select to anon, authenticated
  using (status in ('offen', 'aufgenommen') or user_id = auth.uid() or public.is_admin());
drop policy if exists "vorschlag einreichen" on public.vorschlaege;
create policy "vorschlag einreichen" on public.vorschlaege for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "vorschlag zurückziehen" on public.vorschlaege;
create policy "vorschlag zurückziehen" on public.vorschlaege for delete to authenticated
  using ((user_id = auth.uid() and status in ('offen', 'pruefen')) or public.is_admin());
drop policy if exists "vorschlag moderieren" on public.vorschlaege;
create policy "vorschlag moderieren" on public.vorschlaege for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- Stimmen ------------------------------------------------------
create table if not exists public.stimmen (
  vorschlag_id uuid not null references public.vorschlaege on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (vorschlag_id, user_id)
);
alter table public.stimmen enable row level security;

drop policy if exists "eigene stimmen lesen" on public.stimmen;
create policy "eigene stimmen lesen" on public.stimmen for select to authenticated
  using (user_id = auth.uid());
-- Abstimmen nur für offene Vorschläge anderer Personen.
drop policy if exists "abstimmen" on public.stimmen;
create policy "abstimmen" on public.stimmen for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.vorschlaege v
                where v.id = vorschlag_id and v.status = 'offen' and v.user_id <> auth.uid())
  );
-- Zurückziehen nur, solange der Vorschlag offen ist: eine Aufnahme bleibt bestehen.
drop policy if exists "stimme zurückziehen" on public.stimmen;
create policy "stimme zurückziehen" on public.stimmen for delete to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from public.vorschlaege v where v.id = vorschlag_id and v.status = 'offen')
  );

-- Zählt die Stimmen neu und nimmt den Vorschlag ab der Schwelle automatisch auf.
create or replace function public.stimmen_zaehlen() returns trigger
language plpgsql security definer set search_path = public as $$
declare vid uuid := coalesce(new.vorschlag_id, old.vorschlag_id); anzahl int;
begin
  select count(*) into anzahl from stimmen where vorschlag_id = vid;
  update vorschlaege
     set stimmen = anzahl,
         status = case when status = 'offen' and anzahl >= mw_schwelle() then 'aufgenommen' else status end
   where id = vid;
  return null;
end $$;
drop trigger if exists stimmen_zaehlen on public.stimmen;
create trigger stimmen_zaehlen after insert or delete on public.stimmen
  for each row execute function public.stimmen_zaehlen();

-- ---------- Meldungen ----------------------------------------------------
create table if not exists public.meldungen (
  vorschlag_id uuid not null references public.vorschlaege on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  grund        text not null default '' check (char_length(grund) <= 200),
  created_at   timestamptz not null default now(),
  primary key (vorschlag_id, user_id)
);
alter table public.meldungen enable row level security;

drop policy if exists "meldung lesen" on public.meldungen;
create policy "meldung lesen" on public.meldungen for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists "melden" on public.meldungen;
create policy "melden" on public.meldungen for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.vorschlaege v where v.id = vorschlag_id and v.user_id <> auth.uid()));
drop policy if exists "meldungen erledigen" on public.meldungen;
create policy "meldungen erledigen" on public.meldungen for delete to authenticated
  using (public.is_admin());

-- Offene Vorschläge mit mehreren Meldungen werden bis zur Prüfung ausgeblendet.
create or replace function public.meldungen_zaehlen() returns trigger
language plpgsql security definer set search_path = public as $$
declare vid uuid := coalesce(new.vorschlag_id, old.vorschlag_id); anzahl int;
begin
  select count(*) into anzahl from meldungen where vorschlag_id = vid;
  update vorschlaege
     set meldungen = anzahl,
         status = case when tg_op = 'INSERT' and status = 'offen' and anzahl >= mw_meldeschwelle() then 'pruefen' else status end
   where id = vid;
  return null;
end $$;
drop trigger if exists meldungen_zaehlen on public.meldungen;
create trigger meldungen_zaehlen after insert or delete on public.meldungen
  for each row execute function public.meldungen_zaehlen();

-- ---------- Liste mit Anzeigenamen ---------------------------------------
create or replace view public.vorschlaege_liste with (security_invoker = true) as
  select v.id, v.user_id, v.dialekt, v.t, v.d, v.n, v.sit, v.status, v.stimmen, v.meldungen,
         v.created_at, v.aufgenommen_at, p.name as autor
    from public.vorschlaege v
    left join public.profile p on p.user_id = v.user_id;

-- ---------- Lernstand (Listen und Fortschritt je Person) ------------------
create table if not exists public.lernstand (
  user_id    uuid primary key default auth.uid() references auth.users on delete cascade,
  state      jsonb not null,
  updated_at timestamptz not null default now(),
  check (pg_column_size(state) < 500000)
);
alter table public.lernstand enable row level security;
drop policy if exists "eigener lernstand" on public.lernstand;
create policy "eigener lernstand" on public.lernstand for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- KI-Kontingent -------------------------------------------------
create table if not exists public.ki_nutzung (
  user_id uuid not null references auth.users on delete cascade,
  tag     date not null default current_date,
  anzahl  int  not null default 0,
  primary key (user_id, tag)
);
alter table public.ki_nutzung enable row level security;
drop policy if exists "eigene ki-nutzung lesen" on public.ki_nutzung;
create policy "eigene ki-nutzung lesen" on public.ki_nutzung for select to authenticated
  using (user_id = auth.uid());

-- Zählt eine KI-Anfrage und sagt, ob sie heute noch erlaubt ist. Nur für die Server-Funktion.
create or replace function public.ki_verbrauchen(p_user uuid, p_limit int) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into ki_nutzung (user_id, tag, anzahl) values (p_user, current_date, 1)
  on conflict (user_id, tag) do update set anzahl = ki_nutzung.anzahl + 1
  returning anzahl into n;
  return n <= p_limit;
end $$;

-- ---------- Rechte -------------------------------------------------------
revoke all on function public.ki_verbrauchen(uuid, int) from public, anon, authenticated;
grant execute on function public.ki_verbrauchen(uuid, int) to service_role;
grant select on public.vorschlaege, public.vorschlaege_liste, public.profile to anon, authenticated;
grant insert, delete, update on public.vorschlaege to authenticated;
grant select, insert, delete on public.stimmen, public.meldungen to authenticated;
grant insert, update on public.profile to authenticated;
grant select, insert, update, delete on public.lernstand to authenticated;
grant select on public.ki_nutzung, public.admins to authenticated;
