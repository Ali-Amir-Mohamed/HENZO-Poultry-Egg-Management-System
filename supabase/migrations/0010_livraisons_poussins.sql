-- =====================================================================
-- HENZO – Livraisons de poussins en plusieurs fois
-- À exécuter une fois dans Supabase > SQL Editor, après 0009.
--
-- Une bande peut recevoir ses poussins en plusieurs livraisons : le nombre
-- initial de la bande = somme des livraisons. La première livraison est
-- créée automatiquement avec la bande ; l'âge de la bande compte depuis
-- sa date d'arrivée (première livraison).
-- =====================================================================

create table public.livraisons_poussins (
  id              uuid primary key default gen_random_uuid(),
  ferme_id        uuid not null default public.ferme_actuelle() references public.fermes (id),
  bande_id        uuid not null references public.bandes (id),
  date_livraison  date not null default current_date,
  nombre          integer not null check (nombre > 0),
  notes           text,
  saisi_par       uuid default auth.uid() references public.profiles (id),
  created_at      timestamptz not null default now()
);
create index on public.livraisons_poussins (bande_id);

-- Bandes déjà créées : leur arrivée devient leur première livraison
insert into public.livraisons_poussins (ferme_id, bande_id, date_livraison, nombre, notes, saisi_par)
select ferme_id, id, date_arrivee, nombre_initial, 'Première livraison', cloture_demandee_par
from public.bandes;

-- Nouvelle bande : première livraison automatique
create function public.premiere_livraison()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.livraisons_poussins (ferme_id, bande_id, date_livraison, nombre, notes, saisi_par)
  values (new.ferme_id, new.id, new.date_arrivee, new.nombre_initial, 'Première livraison', auth.uid());
  return null;
end;
$$;
create trigger premiere_livraison after insert on public.bandes
  for each row execute function public.premiere_livraison();

-- Contrôles : bande non clôturée, livraison pas avant l'arrivée de la bande
create function public.avant_livraison()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bandes;
begin
  select * into b from public.bandes where id = coalesce(new.bande_id, old.bande_id);
  if b.statut <> 'en_cours' then
    raise exception 'La bande % n''est plus en cours', b.code;
  end if;
  if tg_op = 'INSERT' then
    if new.date_livraison < b.date_arrivee then
      raise exception 'Une livraison ne peut pas précéder l''arrivée de la bande (%)', b.date_arrivee;
    end if;
    new.ferme_id := b.ferme_id;
    return new;
  end if;
  -- suppression : il doit rester au moins une livraison
  if (select count(*) from public.livraisons_poussins where bande_id = old.bande_id) <= 1 then
    raise exception 'La bande doit garder au moins une livraison';
  end if;
  return old;
end;
$$;
create trigger avant_livraison before insert or delete on public.livraisons_poussins
  for each row execute function public.avant_livraison();

-- Le nombre initial de la bande suit la somme des livraisons
create function public.recalculer_nombre_initial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bande uuid := coalesce(new.bande_id, old.bande_id);
  v_total integer := (select sum(nombre) from public.livraisons_poussins where bande_id = v_bande);
begin
  update public.bandes set nombre_initial = v_total where id = v_bande and nombre_initial <> v_total;
  return null;
end;
$$;
create trigger recalculer_nombre_initial after insert or delete on public.livraisons_poussins
  for each row execute function public.recalculer_nombre_initial();
create trigger journal after insert or delete on public.livraisons_poussins
  for each row execute function public.journaliser();

alter table public.livraisons_poussins enable row level security;
create policy livraisons_select on public.livraisons_poussins for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));
create policy livraisons_insert on public.livraisons_poussins for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation'));
create policy livraisons_delete on public.livraisons_poussins for delete to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation'));

revoke all on public.livraisons_poussins from anon;
