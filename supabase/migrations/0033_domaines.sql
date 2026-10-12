-- =====================================================================
-- HENZO – Chacun dans son domaine
--   1. Le travail quotidien de la ferme est à l'exploitation (Kenfack) :
--      saisies, bandes (création, demande de clôture), lots, bâtiments,
--      poussins, stock et achats d'aliment / médicaments, planning,
--      crédit aux clients, ventes en boutique. Le directeur (Ali) voit
--      tout mais n'y agit plus ; il garde la finance (comme Dahirou),
--      l'annulation, les corrections, les comptes et l'Administration.
--   2. La direction ne coche plus que les tâches qui lui sont assignées.
--   3. Équipe : Kenfack ajoute un employé et change son poste sans voir
--      les salaires ; Dahirou est prévenu pour fixer le salaire.
-- À exécuter une fois dans Supabase > SQL Editor, après 0032.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Droits dans la base
-- ---------------------------------------------------------------------
-- Saisies de terrain : l'exploitation et les employés (correction / suppression : l'exploitation)

drop policy if exists mortalites_insert on public.mortalites;
create policy mortalites_insert on public.mortalites for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and saisi_par = auth.uid() and public.a_role('exploitation', 'employe'));

drop policy if exists mortalites_update on public.mortalites;
create policy mortalites_update on public.mortalites for update to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'));

drop policy if exists mortalites_delete on public.mortalites;
create policy mortalites_delete on public.mortalites for delete to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'));

drop policy if exists pontes_insert on public.pontes;
create policy pontes_insert on public.pontes for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and saisi_par = auth.uid() and public.a_role('exploitation', 'employe'));

drop policy if exists pontes_update on public.pontes;
create policy pontes_update on public.pontes for update to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'));

drop policy if exists pontes_delete on public.pontes;
create policy pontes_delete on public.pontes for delete to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'));

drop policy if exists pesees_insert on public.pesees;
create policy pesees_insert on public.pesees for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and saisi_par = auth.uid() and public.a_role('exploitation', 'employe'));

drop policy if exists pesees_update on public.pesees;
create policy pesees_update on public.pesees for update to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'));

drop policy if exists pesees_delete on public.pesees;
create policy pesees_delete on public.pesees for delete to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'));

drop policy if exists observations_insert on public.observations;
create policy observations_insert on public.observations for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and saisi_par = auth.uid() and public.a_role('exploitation', 'employe'));

drop policy if exists observations_update on public.observations;
create policy observations_update on public.observations for update to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'));

drop policy if exists observations_delete on public.observations;
create policy observations_delete on public.observations for delete to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'));

drop policy if exists ventes_insert on public.ventes;
create policy ventes_insert on public.ventes for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and saisi_par = auth.uid() and public.a_role('exploitation', 'employe'));

drop policy if exists ajustements_oeufs_insert on public.ajustements_oeufs;
create policy ajustements_oeufs_insert on public.ajustements_oeufs for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'));

drop policy if exists ajustements_oeufs_delete on public.ajustements_oeufs;
create policy ajustements_oeufs_delete on public.ajustements_oeufs for delete to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'));

-- Bandes, lots, bâtiments, poussins

drop policy if exists bandes_insert on public.bandes;
create policy bandes_insert on public.bandes for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'));

drop policy if exists lots_write on public.lots_pondeuses;
create policy lots_write on public.lots_pondeuses for all to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'));

drop policy if exists batiments_write on public.batiments;
create policy batiments_write on public.batiments for all to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'));

drop policy if exists commandes_insert on public.commandes_poussins;
create policy commandes_insert on public.commandes_poussins for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'));

drop policy if exists commandes_update on public.commandes_poussins;
create policy commandes_update on public.commandes_poussins for update to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'));

drop policy if exists livraisons_insert on public.livraisons_poussins;
create policy livraisons_insert on public.livraisons_poussins for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and statut = 'livree' and public.a_role('exploitation'));

drop policy if exists livraisons_delete on public.livraisons_poussins;
create policy livraisons_delete on public.livraisons_poussins for delete to authenticated
  using (ferme_id = public.ferme_actuelle() and statut = 'livree' and commande_id is null and public.a_role('exploitation'));

-- Stock

drop policy if exists articles_write on public.articles;
create policy articles_write on public.articles for all to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'));

drop policy if exists stock_insert on public.mouvements_stock;
create policy stock_insert on public.mouvements_stock for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and saisi_par = auth.uid() and depense_id is null and (public.a_role('exploitation') or (public.a_role('employe') and type_mouvement = 'sortie')));

drop policy if exists stock_update on public.mouvements_stock;
create policy stock_update on public.mouvements_stock for update to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'));

drop policy if exists stock_delete on public.mouvements_stock;
create policy stock_delete on public.mouvements_stock for delete to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'));

-- Planning : l'exploitation programme ; chacun coche les tâches de son rôle (exploitation et employés : toutes)

drop policy if exists taches_insert on public.taches;
create policy taches_insert on public.taches for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'));

drop policy if exists taches_update on public.taches;
create policy taches_update on public.taches for update to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'));

drop policy if exists modeles_write on public.modeles_taches;
create policy modeles_write on public.modeles_taches for all to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'));

drop policy if exists realisations_insert on public.taches_realisations;
create policy realisations_insert on public.taches_realisations for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and saisi_par = auth.uid() and (public.a_role('exploitation', 'employe')
              or exists (select 1 from public.taches t where t.id = tache_id and t.assigne_role = public.role_actuel())));

-- Ventes en boutique (le vendeur ou l'exploitation)

drop policy if exists ventes_boutique_insert on public.ventes_boutique;
create policy ventes_boutique_insert on public.ventes_boutique for insert to authenticated
  with check (saisi_par = auth.uid() and (boutique_id = public.ma_boutique()
              or (public.a_role('exploitation') and exists (select 1 from public.boutiques b where b.id = boutique_id and b.ferme_id = public.ferme_actuelle()))));

-- ---------------------------------------------------------------------
-- 2. Contrôles (crédit client, clôture de bande, achats de stock, poussins)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.controle_credit_tiers()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or public.a_role('exploitation') then
    return new;
  end if;
  if (tg_op = 'INSERT' and (new.credit_autorise or new.plafond_credit > 0))
     or (tg_op = 'UPDATE' and (new.credit_autorise, new.plafond_credit) is distinct from (old.credit_autorise, old.plafond_credit)) then
    raise exception 'Seule l''exploitation (Kenfack) autorise un crédit client';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.controle_bande()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r text := public.role_actuel()::text;
begin
  if auth.uid() is null then return new; end if;  -- administrateur (SQL Editor)

  if r in ('finance', 'directeur') and (to_jsonb(new) - array['statut', 'cloture_validee_par', 'cloture_demandee_par', 'date_cloture'])
                       is distinct from (to_jsonb(old) - array['statut', 'cloture_validee_par', 'cloture_demandee_par', 'date_cloture']) then
    raise exception 'La direction et la finance peuvent seulement valider ou refuser une clôture : le reste est géré par l''exploitation';
  end if;

  if new.statut is distinct from old.statut then
    if old.statut = 'en_cours' and new.statut = 'cloture_demandee' and r = 'exploitation' then
      new.cloture_demandee_par := auth.uid();
      new.date_cloture := coalesce(new.date_cloture, current_date);
      perform public.notifier(new.ferme_id, 'finance', 'cloture_bande', 'Clôture demandée pour la bande ' || new.code, '/bandes/' || new.id);
      perform public.notifier(new.ferme_id, 'directeur', 'cloture_bande', 'Clôture demandée pour la bande ' || new.code, '/bandes/' || new.id);
    elsif old.statut = 'cloture_demandee' and new.statut = 'cloturee' and r in ('directeur', 'finance') then
      new.cloture_validee_par := auth.uid();
      perform public.notifier(new.ferme_id, 'directeur', 'cloture_bande', 'Bande ' || new.code || ' clôturée', '/bandes/' || new.id);
    elsif old.statut = 'cloture_demandee' and new.statut = 'en_cours' and r in ('directeur', 'finance') then
      new.cloture_demandee_par := null;
      new.date_cloture := null;
    else
      raise exception 'Changement de statut non autorisé (% -> %)', old.statut, new.statut;
    end if;
  elsif old.statut = 'cloturee' and r <> 'directeur' then
    raise exception 'Une bande clôturée ne peut plus être modifiée';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.annuler_livraison_prevue(p_livraison uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  l public.livraisons_poussins;
begin
  if not public.a_role('exploitation') then
    raise exception 'Seule l''exploitation (Kenfack) gère les commandes de poussins';
  end if;
  select * into l from public.livraisons_poussins where id = p_livraison and ferme_id = public.ferme_actuelle() for update;
  if l.id is null or l.statut <> 'prevue' then
    raise exception 'Cette livraison n''est plus en attente';
  end if;
  update public.livraisons_poussins set statut = 'annulee', notes = 'Livraison annulée' where id = l.id;
  update public.taches set statut = 'annule' where id = l.tache_id and statut = 'a_faire';
  perform public.maj_statut_commande(l.commande_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.reporter_livraison(p_livraison uuid, p_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  l public.livraisons_poussins;
begin
  if not public.a_role('exploitation') then
    raise exception 'Seule l''exploitation (Kenfack) gère les commandes de poussins';
  end if;
  select * into l from public.livraisons_poussins where id = p_livraison and ferme_id = public.ferme_actuelle() for update;
  if l.id is null or l.statut <> 'prevue' then
    raise exception 'Cette livraison n''est plus en attente';
  end if;
  update public.livraisons_poussins set date_prevue = p_date where id = l.id;
  update public.taches set date_prevue = p_date where id = l.tache_id and statut = 'a_faire';
end;
$function$;

CREATE OR REPLACE FUNCTION public.controle_achat_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is not null and (new.categorie in ('aliment', 'medicament') or new.article_id is not null)
     and not public.a_role('exploitation') then
    raise exception 'Les achats qui entrent en stock (aliment, médicaments) sont saisis par l''exploitation (Kenfack)';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.receptionner_livraison(p_livraison uuid, p_nombre integer, p_date date, p_date_reste date DEFAULT NULL::date, p_paiement text DEFAULT 'credit'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  l public.livraisons_poussins;
  c public.commandes_poussins;
  v_bande uuid;
  v_reste integer;
  v_montant numeric;
  v_depense uuid;
  v_seuil numeric;
begin
  if not public.a_role('exploitation') then
    raise exception 'Seule l''exploitation (Kenfack) réceptionne les poussins';
  end if;
  if coalesce(p_paiement, 'credit') not in ('especes', 'mobile_money', 'banque', 'credit') then
    raise exception 'Mode de paiement inconnu';
  end if;
  select * into l from public.livraisons_poussins where id = p_livraison and ferme_id = public.ferme_actuelle() for update;
  if l.id is null or l.statut <> 'prevue' then
    raise exception 'Cette livraison n''est plus en attente';
  end if;
  if p_nombre is null or p_nombre <= 0 then raise exception 'Indiquez le nombre de poussins reçus'; end if;
  select * into c from public.commandes_poussins where id = l.commande_id for update;
  v_reste := greatest(l.nombre - p_nombre, 0);

  if c.bande_id is null then
    perform set_config('henzo.reception_commande', 'on', true);
    insert into public.bandes (ferme_id, code, fournisseur_id, souche, date_arrivee, nombre_initial, batiment_id)
    values (c.ferme_id, c.code_bande, c.fournisseur_id, c.souche, p_date, p_nombre, c.batiment_id)
    returning id into v_bande;
    perform set_config('henzo.reception_commande', 'off', true);
    update public.commandes_poussins set bande_id = v_bande where id = c.id;
  else
    v_bande := c.bande_id;
  end if;

  -- Dépense des poussins reçus
  v_montant := round(p_nombre * coalesce(c.prix_unitaire, 0));
  select seuil_tiers_obligatoire into v_seuil from public.fermes where id = c.ferme_id;
  if v_montant > 0 and (c.fournisseur_id is not null or v_montant <= v_seuil) then
    insert into public.depenses (ferme_id, date_depense, portee, activite, bande_id, categorie, libelle, montant,
                                 fournisseur_id, a_credit, mode_paiement, notes)
    values (c.ferme_id, p_date, 'ferme', 'chair', v_bande, 'poussins',
            format('Poussins %s : %s × %s FCFA', c.code_bande, p_nombre, c.prix_unitaire), v_montant,
            c.fournisseur_id, coalesce(p_paiement, 'credit') = 'credit',
            case when coalesce(p_paiement, 'credit') = 'credit' then null else p_paiement::public.mode_paiement end,
            'Créée automatiquement à la réception (commande ' || c.reference || ')')
    returning id into v_depense;
  else
    perform public.notifier(c.ferme_id, r, 'depense_poussins',
      format('Poussins reçus pour %s (%s) : dépense à saisir (%s)', c.code_bande, p_nombre,
             case when v_montant = 0 then 'pas de prix dans la commande' else 'fournisseur manquant' end), '/argent')
    from unnest(array['finance', 'directeur']::public.role_utilisateur[]) r;
  end if;

  update public.livraisons_poussins
  set statut = 'livree', nombre = p_nombre, date_livraison = p_date, bande_id = v_bande, depense_id = v_depense,
      notes = format('Livrée (%s prévus le %s)', l.nombre, to_char(l.date_prevue, 'DD/MM/YYYY'))
  where id = l.id;
  update public.taches set statut = 'fait' where id = l.tache_id and statut = 'a_faire';

  if v_reste > 0 and p_date_reste is not null then
    perform public.prevoir_livraison(c.id, v_reste, p_date_reste, v_bande);
  end if;
  perform public.maj_statut_commande(c.id);
  return v_bande;
end;
$function$;

-- ---------------------------------------------------------------------
-- 3. Équipe : Kenfack ajoute un employé et change son poste, sans voir les salaires
--    (salaires, avances et paies : Dahirou ; Ali voit)
-- ---------------------------------------------------------------------
create view public.equipe as
select id, ferme_id, nom, telephone, poste, activite, date_embauche, actif, created_at
from public.employes
where ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance');
revoke all on public.equipe from anon;
grant select on public.equipe to authenticated;

create function public.ajouter_employe(p_nom text, p_telephone text default null, p_poste text default null, p_date_embauche date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.a_role('exploitation') then raise exception 'Seule l''exploitation (Kenfack) ajoute un employé ici'; end if;
  if coalesce(trim(p_nom), '') = '' then raise exception 'Indiquez le nom de l''employé'; end if;
  insert into public.employes (ferme_id, nom, telephone, poste, date_embauche, salaire_mensuel)
  values (public.ferme_actuelle(), trim(p_nom), nullif(trim(p_telephone), ''), nullif(trim(p_poste), ''), p_date_embauche, 0)
  returning id into v_id;
  perform public.notifier(public.ferme_actuelle(), 'finance', 'nouvel_employe',
    format('Nouvel employé : %s%s. Fixez son salaire dans Argent > Salaires.', trim(p_nom), coalesce(' (' || nullif(trim(p_poste), '') || ')', '')), '/argent');
  return v_id;
end;
$$;

create function public.modifier_employe(p_id uuid, p_nom text, p_telephone text, p_poste text, p_actif boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.employes;
begin
  if not public.a_role('exploitation') then raise exception 'Seule l''exploitation (Kenfack) modifie un employé ici'; end if;
  select * into e from public.employes where id = p_id and ferme_id = public.ferme_actuelle() for update;
  if e.id is null then raise exception 'Employé introuvable'; end if;
  if coalesce(trim(p_nom), '') = '' then raise exception 'Indiquez le nom de l''employé'; end if;
  update public.employes set nom = trim(p_nom), telephone = nullif(trim(p_telephone), ''), poste = nullif(trim(p_poste), ''), actif = coalesce(p_actif, e.actif)
  where id = e.id;
  if e.actif and not coalesce(p_actif, true) then
    perform public.notifier(e.ferme_id, 'finance', 'depart_employe', format('%s ne travaille plus à la ferme : pensez à son dernier salaire.', e.nom), '/argent');
  elsif e.poste is distinct from nullif(trim(p_poste), '') then
    perform public.notifier(e.ferme_id, 'finance', 'poste_employe', format('%s change de poste : %s. Vérifiez son salaire.', e.nom, coalesce(nullif(trim(p_poste), ''), '—')), '/argent');
  end if;
end;
$$;
revoke execute on function public.ajouter_employe(text, text, text, date), public.modifier_employe(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.ajouter_employe(text, text, text, date), public.modifier_employe(uuid, text, text, text, boolean) to authenticated;
