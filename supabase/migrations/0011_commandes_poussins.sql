-- =====================================================================
-- HENZO – Commandes de poussins et livraisons prévues (travail de l'exploitation)
-- À exécuter une fois dans Supabase > SQL Editor, après 0010.
--
--   1. L'exploitation commande (ex. 1 000 poussins) avec une date de livraison
--      annoncée : une livraison « prévue » et une tâche dans le Planning sont créées.
--   2. Le jour venu, elle coche « Livré » avec le nombre réellement reçu.
--      La première réception crée la bande ; les suivantes s'y ajoutent.
--   3. S'il manque des poussins, on indique la nouvelle date annoncée pour le reste
--      (nouvelle livraison prévue + tâche) — ou on annule le reste.
--   La commande passe d'elle-même à « en attente », « partielle », « livrée ».
-- =====================================================================

create table public.commandes_poussins (
  id                     uuid primary key default gen_random_uuid(),
  ferme_id               uuid not null default public.ferme_actuelle() references public.fermes (id),
  fournisseur_id         uuid references public.tiers (id),
  code_bande             text not null,
  souche                 text,
  nombre_commande        integer not null check (nombre_commande > 0),
  date_commande          date not null default current_date,
  date_livraison_prevue  date not null,
  prix_unitaire          numeric(14, 0) check (prix_unitaire >= 0),
  bande_id               uuid references public.bandes (id),
  statut                 text not null default 'en_attente' check (statut in ('en_attente', 'partielle', 'livree', 'annulee')),
  notes                  text,
  cree_par               uuid default auth.uid() references public.profiles (id),
  created_at             timestamptz not null default now()
);

-- Les livraisons peuvent être prévues (pas encore reçues) ou annulées
alter table public.livraisons_poussins
  add column commande_id uuid references public.commandes_poussins (id),
  add column statut text not null default 'livree' check (statut in ('prevue', 'livree', 'annulee')),
  add column date_prevue date,
  add column tache_id uuid references public.taches (id),
  alter column bande_id drop not null,
  alter column date_livraison drop not null,
  add constraint livraisons_reception_check check (statut <> 'livree' or (bande_id is not null and date_livraison is not null)),
  add constraint livraisons_prevision_check check (statut <> 'prevue' or (commande_id is not null and date_prevue is not null));
create index on public.livraisons_poussins (commande_id);

-- Contrôles adaptés aux livraisons prévues
create or replace function public.avant_livraison()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bandes;
  r public.livraisons_poussins;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  if r.statut <> 'livree' then             -- prévue / annulée : pas de bande à contrôler
    if tg_op = 'INSERT' then
      new.ferme_id := coalesce((select ferme_id from public.commandes_poussins where id = new.commande_id), new.ferme_id);
      return new;
    end if;
    return old;
  end if;
  select * into b from public.bandes where id = r.bande_id;
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
  if (select count(*) from public.livraisons_poussins where bande_id = old.bande_id and statut = 'livree') <= 1 then
    raise exception 'La bande doit garder au moins une livraison';
  end if;
  return old;
end;
$$;

-- Seules les livraisons reçues comptent dans le nombre initial de la bande
create or replace function public.recalculer_nombre_initial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bande uuid := coalesce(new.bande_id, old.bande_id);
  v_total integer;
begin
  if v_bande is null then return null; end if;
  v_total := (select sum(nombre) from public.livraisons_poussins where bande_id = v_bande and statut = 'livree');
  if v_total > 0 then
    update public.bandes set nombre_initial = v_total where id = v_bande and nombre_initial <> v_total;
  end if;
  return null;
end;
$$;
drop trigger recalculer_nombre_initial on public.livraisons_poussins;
create trigger recalculer_nombre_initial after insert or update or delete on public.livraisons_poussins
  for each row execute function public.recalculer_nombre_initial();

-- Une bande créée par une réception de commande n'a pas besoin de « première livraison » automatique
create or replace function public.premiere_livraison()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('henzo.reception_commande', true) = 'on' then
    return null;
  end if;
  insert into public.livraisons_poussins (ferme_id, bande_id, date_livraison, nombre, notes, saisi_par)
  values (new.ferme_id, new.id, new.date_arrivee, new.nombre_initial, 'Première livraison', auth.uid());
  return null;
end;
$$;

-- Livraison prévue : avec sa tâche dans le Planning de l'exploitation
create function public.prevoir_livraison(p_commande uuid, p_nombre integer, p_date date, p_bande uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.commandes_poussins;
  v_tache uuid;
begin
  select * into c from public.commandes_poussins where id = p_commande;
  insert into public.taches (ferme_id, titre, type_tache, date_prevue, bande_id, assigne_role, description, cree_par)
  values (c.ferme_id, format('Livraison de %s poussins (%s)', p_nombre, c.code_bande), 'arrivee_poussins', p_date, p_bande,
          'exploitation', 'À cocher « Livré » dans Ferme > Commandes de poussins', auth.uid())
  returning id into v_tache;
  insert into public.livraisons_poussins (ferme_id, commande_id, bande_id, statut, nombre, date_prevue, tache_id, saisi_par, notes)
  values (c.ferme_id, c.id, p_bande, 'prevue', p_nombre, p_date, v_tache, auth.uid(), 'Livraison prévue');
end;
$$;

create function public.maj_statut_commande(p_commande uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.commandes_poussins c
  set statut = case
      when s.prevues > 0 and s.recus > 0 then 'partielle'
      when s.prevues > 0 then 'en_attente'
      when s.recus > 0 then 'livree'
      else 'annulee' end
  from (select count(*) filter (where statut = 'prevue') as prevues,
               coalesce(sum(nombre) filter (where statut = 'livree'), 0) as recus
        from public.livraisons_poussins where commande_id = p_commande) s
  where c.id = p_commande
$$;

-- Nouvelle commande : première livraison prévue à la date annoncée
create function public.apres_commande()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.prevoir_livraison(new.id, new.nombre_commande, new.date_livraison_prevue, null);
  return null;
end;
$$;
create trigger apres_commande after insert on public.commandes_poussins
  for each row execute function public.apres_commande();
create trigger journal after insert or update on public.commandes_poussins
  for each row execute function public.journaliser();

-- « Livré » : réception d'une livraison prévue (appelée depuis l'appli)
--   p_nombre      : poussins réellement reçus
--   p_date        : date de réception
--   p_date_reste  : nouvelle date annoncée pour le reste (sinon le reste est annulé)
create function public.receptionner_livraison(p_livraison uuid, p_nombre integer, p_date date, p_date_reste date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.livraisons_poussins;
  c public.commandes_poussins;
  v_bande uuid;
  v_reste integer;
begin
  if not public.a_role('directeur', 'exploitation') then
    raise exception 'Seuls l''exploitation et le directeur réceptionnent les poussins';
  end if;
  select * into l from public.livraisons_poussins where id = p_livraison and ferme_id = public.ferme_actuelle() for update;
  if l.id is null or l.statut <> 'prevue' then
    raise exception 'Cette livraison n''est plus en attente';
  end if;
  if p_nombre is null or p_nombre <= 0 then raise exception 'Indiquez le nombre de poussins reçus'; end if;
  select * into c from public.commandes_poussins where id = l.commande_id for update;
  v_reste := greatest(l.nombre - p_nombre, 0);

  -- première réception : la bande naît ce jour-là
  if c.bande_id is null then
    perform set_config('henzo.reception_commande', 'on', true);
    insert into public.bandes (ferme_id, code, fournisseur_id, souche, date_arrivee, nombre_initial)
    values (c.ferme_id, c.code_bande, c.fournisseur_id, c.souche, p_date, p_nombre)
    returning id into v_bande;
    perform set_config('henzo.reception_commande', 'off', true);
    update public.commandes_poussins set bande_id = v_bande where id = c.id;
  else
    v_bande := c.bande_id;
  end if;

  update public.livraisons_poussins
  set statut = 'livree', nombre = p_nombre, date_livraison = p_date, bande_id = v_bande,
      notes = format('Livrée (%s prévus le %s)', l.nombre, to_char(l.date_prevue, 'DD/MM/YYYY'))
  where id = l.id;
  update public.taches set statut = 'fait' where id = l.tache_id and statut = 'a_faire';

  if v_reste > 0 and p_date_reste is not null then
    perform public.prevoir_livraison(c.id, v_reste, p_date_reste, v_bande);
  end if;
  perform public.maj_statut_commande(c.id);
  return v_bande;
end;
$$;

-- Annuler une livraison prévue (le couvoir ne livrera pas le reste)
create function public.annuler_livraison_prevue(p_livraison uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.livraisons_poussins;
begin
  if not public.a_role('directeur', 'exploitation') then
    raise exception 'Seuls l''exploitation et le directeur gèrent les commandes';
  end if;
  select * into l from public.livraisons_poussins where id = p_livraison and ferme_id = public.ferme_actuelle() for update;
  if l.id is null or l.statut <> 'prevue' then
    raise exception 'Cette livraison n''est plus en attente';
  end if;
  update public.livraisons_poussins set statut = 'annulee', notes = 'Livraison annulée' where id = l.id;
  update public.taches set statut = 'annule' where id = l.tache_id and statut = 'a_faire';
  perform public.maj_statut_commande(l.commande_id);
end;
$$;

-- Report d'une livraison prévue (nouvelle date annoncée par le couvoir)
create function public.reporter_livraison(p_livraison uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.livraisons_poussins;
begin
  if not public.a_role('directeur', 'exploitation') then
    raise exception 'Seuls l''exploitation et le directeur gèrent les commandes';
  end if;
  select * into l from public.livraisons_poussins where id = p_livraison and ferme_id = public.ferme_actuelle() for update;
  if l.id is null or l.statut <> 'prevue' then
    raise exception 'Cette livraison n''est plus en attente';
  end if;
  update public.livraisons_poussins set date_prevue = p_date where id = l.id;
  update public.taches set date_prevue = p_date where id = l.tache_id and statut = 'a_faire';
end;
$$;

-- ---------------------------------------------------------------------
-- Sécurité
-- ---------------------------------------------------------------------
alter table public.commandes_poussins enable row level security;
create policy commandes_select on public.commandes_poussins for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));
create policy commandes_insert on public.commandes_poussins for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation'));
create policy commandes_update on public.commandes_poussins for update to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation'));

-- Les livraisons prévues ne se créent / modifient que par les fonctions ci-dessus
drop policy livraisons_insert on public.livraisons_poussins;
create policy livraisons_insert on public.livraisons_poussins for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and statut = 'livree' and public.a_role('directeur', 'exploitation'));
drop policy livraisons_delete on public.livraisons_poussins;
create policy livraisons_delete on public.livraisons_poussins for delete to authenticated
  using (ferme_id = public.ferme_actuelle() and statut = 'livree' and commande_id is null and public.a_role('directeur', 'exploitation'));

-- Depuis 0008, les fonctions sont fermées par défaut : on ouvre seulement celles appelées par l'appli
revoke execute on function public.prevoir_livraison(uuid, integer, date, uuid), public.maj_statut_commande(uuid)
  from public, anon, authenticated;
grant execute on function public.receptionner_livraison(uuid, integer, date, date),
                          public.annuler_livraison_prevue(uuid),
                          public.reporter_livraison(uuid, date)
  to authenticated;
revoke all on public.commandes_poussins from anon;
