-- =====================================================================
-- HENZO – 0065 : Kenfack (exploitation) et Dahirou (finance) corrigent eux-mêmes
--
-- Sans attendre l'accord du directeur, avec un motif obligatoire :
--   - annuler une vente ou une dépense ;
--   - corriger une écriture de caisse (écriture de correction, l'originale reste) ;
--   - annuler une facture.
-- Ali (directeur) reçoit une notification à chaque fois, avec le nom de la
-- personne et le motif. Rien n'est effacé : tout reste visible dans le journal.
-- Le retrait d'un associé reste confirmé et annulé par le directeur seul.
-- Les demandes de correction déjà envoyées restent à décider par le directeur.
-- Relançable sans erreur.
-- =====================================================================

-- Name of the connected person, for the messages
create or replace function public.nom_acteur()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select coalesce(nom_complet, identifiant) from public.profiles where id = auth.uid()), 'HENZO')
$$;
revoke execute on function public.nom_acteur() from public, anon;

-- 175000 -> '175 000'
create or replace function public.en_fcfa(p numeric)
returns text
language sql
immutable
set search_path = ''
as $$ select regexp_replace(round(p)::bigint::text, '(\d)(?=(\d{3})+$)', '\1 ', 'g') $$;

-- Notify the director, unless the director did it himself
create or replace function public.prevenir_directeur(p_ferme uuid, p_type text, p_message text, p_lien text default '/argent')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and public.a_role('directeur') then return; end if;
  perform public.notifier(p_ferme, 'directeur', p_type, p_message, p_lien);
end;
$$;
revoke execute on function public.prevenir_directeur(uuid, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Sales
-- ---------------------------------------------------------------------
drop policy if exists ventes_update on public.ventes;
create policy ventes_update on public.ventes for update to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));

create or replace function public.controle_maj_vente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'Une vente ne se supprime pas : elle s''annule avec un motif'; end if;
  if auth.uid() is not null and not public.a_role('directeur', 'exploitation', 'finance') then
    raise exception 'Seuls le directeur, l''exploitation et la finance peuvent annuler une vente';
  end if;
  -- (« montant » est une colonne calculée, pas encore remplie dans NEW à ce stade)
  if old.annulee or not new.annulee or coalesce(trim(new.motif_annulation), '') = ''
     or (to_jsonb(new) - array['annulee', 'motif_annulation', 'annulee_par', 'annulee_le', 'montant'])
        is distinct from (to_jsonb(old) - array['annulee', 'motif_annulation', 'annulee_par', 'annulee_le', 'montant']) then
    raise exception 'Une vente ne se modifie pas : seule une annulation avec motif est possible';
  end if;
  new.annulee_par := auth.uid();
  new.annulee_le := now();
  return new;
end;
$$;

create or replace function public.apres_annulation_vente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.contre_passer(new.id, null, 'Annulation vente : ' || new.motif_annulation);
  perform public.prevenir_directeur(new.ferme_id, 'annulation',
    format('%s a annulé une vente de %s FCFA (%s) : %s', public.nom_acteur(),
           public.en_fcfa(new.quantite * new.prix_unitaire), to_char(new.date_vente, 'DD/MM/YYYY'), new.motif_annulation));
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Expenses
-- ---------------------------------------------------------------------
drop policy if exists depenses_update on public.depenses;
create policy depenses_update on public.depenses for update to authenticated   -- validation / annulation (trigger)
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));

create or replace function public.controle_maj_depense()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  champs_libres text[] := array['statut', 'valide_par', 'valide_le', 'motif_rejet',
                                'annulee', 'motif_annulation', 'annulee_par', 'annulee_le'];
begin
  if tg_op = 'DELETE' then raise exception 'Une dépense ne se supprime pas : elle s''annule avec un motif'; end if;
  if old.annulee then raise exception 'Cette dépense est annulée'; end if;
  if (to_jsonb(new) - champs_libres) is distinct from (to_jsonb(old) - champs_libres) then
    raise exception 'Une dépense ne se modifie pas : elle se valide, se rejette ou s''annule';
  end if;

  if new.statut is distinct from old.statut then
    if old.statut <> 'a_valider' or new.statut not in ('validee', 'rejetee') then
      raise exception 'Changement de statut non autorisé';
    end if;
    if auth.uid() is not null then
      if old.categorie = 'retrait_associe' and not public.a_role('directeur') then
        raise exception 'Seul le directeur confirme un retrait d''associé';
      end if;
      if not public.a_role('directeur', 'finance') then
        raise exception 'Seuls le directeur et la finance valident une dépense';
      end if;
    end if;
    if new.statut = 'rejetee' and coalesce(trim(new.motif_rejet), '') = '' then
      raise exception 'Indiquez le motif du rejet';
    end if;
    new.valide_par := auth.uid();
    new.valide_le := now();
  end if;

  if new.annulee is distinct from old.annulee then
    if auth.uid() is not null then
      if old.categorie = 'retrait_associe' and not public.a_role('directeur') then
        raise exception 'Seul le directeur annule un retrait d''associé';
      end if;
      if not public.a_role('directeur', 'exploitation', 'finance') then
        raise exception 'Seuls le directeur, l''exploitation et la finance peuvent annuler une dépense';
      end if;
    end if;
    if coalesce(trim(new.motif_annulation), '') = '' then raise exception 'Indiquez le motif de l''annulation'; end if;
    new.annulee_par := auth.uid();
    new.annulee_le := now();
  end if;
  return new;
end;
$$;

create or replace function public.apres_maj_depense()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.statut = 'validee' and old.statut = 'a_valider' and not new.annulee then
    perform public.payer_depense(new);
  end if;

  if (new.statut = 'rejetee' and old.statut <> 'rejetee') or (new.annulee and not old.annulee) then
    perform public.contre_passer(null, new.id, coalesce('Annulation dépense : ' || new.motif_annulation, 'Dépense rejetée'));
    if new.article_id is not null then   -- on retire du stock ce que l'achat avait ajouté
      insert into public.mouvements_stock (ferme_id, article_id, type_mouvement, quantite, notes, saisi_par)
      values (new.ferme_id, new.article_id, 'ajustement', -new.quantite,
              'Annulation achat : ' || new.libelle, coalesce(auth.uid(), new.saisi_par));
    end if;
  end if;

  if new.annulee and not old.annulee then
    perform public.prevenir_directeur(new.ferme_id, 'annulation',
      format('%s a annulé la dépense « %s » de %s FCFA : %s', public.nom_acteur(), new.libelle,
             public.en_fcfa(new.montant), new.motif_annulation));
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Cash corrections (a correction entry; the original entry stays)
-- ---------------------------------------------------------------------
drop policy if exists ecritures_insert on public.ecritures;
create policy ecritures_insert on public.ecritures for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and saisi_par = auth.uid()
              and caisse_id in (select id from public.caisses where ferme_id = public.ferme_actuelle())
              and ((nature = 'solde_initial' and public.a_role('directeur', 'finance'))
                   or (nature = 'correction' and public.a_role('directeur', 'exploitation', 'finance'))));

create or replace function public.controle_ecriture_manuelle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.nature = 'correction' then
    perform public.prevenir_directeur(new.ferme_id, 'correction',
      format('%s a corrigé une caisse : %s%s FCFA – %s', public.nom_acteur(), case new.sens when 'entree' then '+' else '−' end,
             public.en_fcfa(new.montant), new.libelle));
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Invoices
-- ---------------------------------------------------------------------
create or replace function public.annuler_facture(p_facture uuid, p_motif text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.factures;
begin
  if not public.a_role('directeur', 'exploitation', 'finance') then
    raise exception 'Seuls le directeur, l''exploitation et la finance annulent une facture';
  end if;
  if coalesce(trim(p_motif), '') = '' then raise exception 'Indiquez le motif de l''annulation'; end if;
  update public.factures set annulee = true, motif_annulation = trim(p_motif), annulee_par = auth.uid(), annulee_le = now()
  where id = p_facture and ferme_id = public.ferme_actuelle() and not annulee
  returning * into f;
  if f.id is null then raise exception 'Facture introuvable ou déjà annulée'; end if;
  update public.facture_lignes set active = false where facture_id = p_facture;
  perform public.prevenir_directeur(f.ferme_id, 'annulation',
    format('%s a annulé la facture n° %s (%s, %s FCFA) : %s', public.nom_acteur(), f.numero, f.client_nom,
           public.en_fcfa(f.total_ttc), trim(p_motif)), '/facture/' || f.id);
end;
$$;
