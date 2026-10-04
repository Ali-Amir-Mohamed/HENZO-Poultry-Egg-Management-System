-- =====================================================================
-- HENZO – Demandes de correction et détection des doublons
-- À exécuter une fois dans Supabase > SQL Editor, après 0014.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Demandes de correction
--    La finance et l'exploitation ne corrigent pas les opérations d'argent :
--    elles DEMANDENT. Le directeur accepte (la correction est alors faite
--    automatiquement, avec le motif) ou refuse. Tout reste dans le journal.
-- ---------------------------------------------------------------------
create table public.demandes_correction (
  id              uuid primary key default gen_random_uuid(),
  ferme_id        uuid not null default public.ferme_actuelle() references public.fermes (id),
  cible_table     text not null check (cible_table in ('ventes', 'depenses', 'ecritures')),
  cible_id        uuid not null,
  action          text not null check (action in ('annuler', 'corriger')),
  sens            text check (sens in ('entree', 'sortie')),          -- correction d'écriture
  montant         numeric(16, 0) check (montant > 0),                  -- correction d'écriture
  resume          text not null,                                       -- ce que la personne a vu (libellé, montant)
  motif           text not null check (trim(motif) <> ''),
  statut          text not null default 'en_attente' check (statut in ('en_attente', 'acceptee', 'refusee')),
  demande_par     uuid not null default auth.uid() references public.profiles (id),
  role_demandeur  public.role_utilisateur,
  decide_par      uuid references public.profiles (id),
  decide_le       timestamptz,
  motif_refus     text,
  created_at      timestamptz not null default now(),
  check ((cible_table = 'ecritures') = (action = 'corriger')),
  check (action <> 'corriger' or (sens is not null and montant is not null))
);
create index on public.demandes_correction (ferme_id, statut);
create trigger journal after insert or update on public.demandes_correction
  for each row execute function public.journaliser();

alter table public.demandes_correction enable row level security;
create policy demandes_select on public.demandes_correction for select to authenticated
  using (ferme_id = public.ferme_actuelle() and (public.a_role('directeur') or demande_par = auth.uid()));
create policy demandes_insert on public.demandes_correction for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and demande_par = auth.uid() and statut = 'en_attente'
              and public.a_role('finance', 'exploitation'));
-- Pas de modification directe : la décision passe par decider_demande()

-- À la création : vérifier la cible, garder le rôle du demandeur, prévenir le directeur
create function public.avant_demande()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  new.role_demandeur := public.role_actuel();
  new.statut := 'en_attente';
  new.decide_par := null; new.decide_le := null; new.motif_refus := null;
  execute format('select exists (select 1 from public.%I where id = $1 and ferme_id = $2)', new.cible_table)
    into v_ok using new.cible_id, new.ferme_id;
  if not v_ok then raise exception 'Opération introuvable'; end if;
  if exists (select 1 from public.demandes_correction where cible_id = new.cible_id and statut = 'en_attente') then
    raise exception 'Une demande est déjà en attente pour cette opération';
  end if;
  return new;
end;
$$;
create trigger avant_demande before insert on public.demandes_correction
  for each row execute function public.avant_demande();

create function public.apres_demande()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notifier(new.ferme_id, 'directeur', 'demande_correction',
    format('Demande de correction (%s) : %s – %s', (select coalesce(nom_complet, identifiant) from public.profiles where id = new.demande_par),
           new.resume, new.motif), '/argent');
  return null;
end;
$$;
create trigger apres_demande after insert on public.demandes_correction
  for each row execute function public.apres_demande();

-- Décision du directeur : accepter (la correction est faite) ou refuser (avec motif)
create function public.decider_demande(p_demande uuid, p_accepter boolean, p_motif_refus text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.demandes_correction;
  v_motif text;
  v_caisse uuid;
begin
  if not public.a_role('directeur') then raise exception 'Seul le directeur décide des corrections'; end if;
  select * into d from public.demandes_correction where id = p_demande and ferme_id = public.ferme_actuelle() for update;
  if d.id is null or d.statut <> 'en_attente' then raise exception 'Cette demande n''est plus en attente'; end if;

  if not p_accepter then
    if coalesce(trim(p_motif_refus), '') = '' then raise exception 'Indiquez le motif du refus'; end if;
    update public.demandes_correction set statut = 'refusee', decide_par = auth.uid(), decide_le = now(), motif_refus = trim(p_motif_refus)
    where id = d.id;
    perform public.notifier(d.ferme_id, d.role_demandeur, 'demande_correction',
      format('Correction refusée : %s – %s', d.resume, trim(p_motif_refus)), '/argent');
    return;
  end if;

  v_motif := format('%s (demandé par %s)', d.motif, (select coalesce(nom_complet, identifiant) from public.profiles where id = d.demande_par));
  if d.cible_table = 'ventes' then
    update public.ventes set annulee = true, motif_annulation = v_motif where id = d.cible_id and not annulee;
    if not found then raise exception 'Cette vente est déjà annulée'; end if;
  elsif d.cible_table = 'depenses' then
    update public.depenses set annulee = true, motif_annulation = v_motif where id = d.cible_id and not annulee;
    if not found then raise exception 'Cette dépense est déjà annulée'; end if;
  else
    select caisse_id into v_caisse from public.ecritures where id = d.cible_id;
    insert into public.ecritures (ferme_id, caisse_id, sens, montant, nature, libelle, ecriture_corrigee_id, saisi_par)
    values (d.ferme_id, v_caisse, d.sens, d.montant, 'correction', v_motif, d.cible_id, auth.uid());
  end if;

  update public.demandes_correction set statut = 'acceptee', decide_par = auth.uid(), decide_le = now() where id = d.id;
  perform public.notifier(d.ferme_id, d.role_demandeur, 'demande_correction', format('Correction faite : %s', d.resume), '/argent');
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Doublons probables
--    Une saisie hors ligne n'est jamais envoyée deux fois (identifiant unique
--    créé sur le téléphone). Mais deux personnes peuvent saisir la même chose :
--    on prévient alors le responsable, sans rien bloquer.
-- ---------------------------------------------------------------------
create function public.signaler_doublon()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_double boolean;
  v_code text;
  v_msg text;
  v_lien text := '/ferme';
begin
  if tg_table_name = 'pontes' then
    v_code := (select code from public.lots_pondeuses where id = new.lot_id);
    select exists (select 1 from public.pontes p where p.id <> new.id and p.lot_id = new.lot_id and p.date_ponte = new.date_ponte
      and p.oeufs_collectes = new.oeufs_collectes) into v_double;
    v_msg := format('Ponte peut-être saisie deux fois : %s œufs, lot %s, le %s', new.oeufs_collectes, v_code, to_char(new.date_ponte, 'DD/MM/YYYY'));
    v_lien := '/ferme/lot/' || new.lot_id;
  else
    v_code := coalesce((select code from public.bandes where id = new.bande_id), (select code from public.lots_pondeuses where id = new.lot_id), '');
    v_lien := case when new.bande_id is not null then '/ferme/bande/' || new.bande_id else '/ferme/lot/' || new.lot_id end;
    if tg_table_name = 'ventes' then
      select exists (select 1 from public.ventes v where v.ferme_id = new.ferme_id and v.id <> new.id and not v.annulee
        and v.date_vente = new.date_vente and v.produit = new.produit and v.unite = new.unite and v.quantite = new.quantite
        and v.prix_unitaire = new.prix_unitaire and v.bande_id is not distinct from new.bande_id and v.lot_id is not distinct from new.lot_id
        and v.client_id is not distinct from new.client_id) into v_double;
      v_msg := format('Vente peut-être saisie deux fois : %s %s, %s, le %s', new.quantite, new.produit, v_code, to_char(new.date_vente, 'DD/MM/YYYY'));
    else
      select exists (select 1 from public.mortalites m where m.id <> new.id and m.date_constat = new.date_constat and m.nombre = new.nombre
        and m.bande_id is not distinct from new.bande_id and m.lot_id is not distinct from new.lot_id) into v_double;
      v_msg := format('Mortalité peut-être saisie deux fois : %s morts, %s, le %s', new.nombre, v_code, to_char(new.date_constat, 'DD/MM/YYYY'));
    end if;
  end if;
  if v_double then
    perform public.notifier(new.ferme_id, 'exploitation', 'doublon', v_msg, v_lien);
    perform public.notifier(new.ferme_id, 'directeur', 'doublon', v_msg, v_lien);
  end if;
  return null;
end;
$$;
create trigger signaler_doublon after insert on public.ventes for each row execute function public.signaler_doublon();
create trigger signaler_doublon after insert on public.pontes for each row execute function public.signaler_doublon();
create trigger signaler_doublon after insert on public.mortalites for each row execute function public.signaler_doublon();

-- ---------------------------------------------------------------------
-- 3. Droits
-- ---------------------------------------------------------------------
revoke execute on function public.avant_demande(), public.apres_demande(), public.signaler_doublon() from public, anon, authenticated;
grant execute on function public.decider_demande(uuid, boolean, text) to authenticated;
revoke all on public.demandes_correction from anon;
