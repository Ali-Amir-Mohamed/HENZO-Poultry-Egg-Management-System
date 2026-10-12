-- =====================================================================
-- HENZO – Boutiques : le directeur ne vend pas et ne valide pas
--   * vendre en boutique : le vendeur de la boutique ou l'exploitation (Kenfack) ;
--   * valider un versement de la boutique : uniquement la finance (Dahirou).
-- Le directeur voit tout et reste le seul à annuler une vente.
-- Corrige aussi acces_boutique : pour un compte qui n'est pas vendeur et dont
-- le rôle n'est pas autorisé, la fonction rendait « inconnu » au lieu de « non »,
-- ce qui laissait passer les contrôles (pertes, inventaire, clôture, versement, vente).
-- À exécuter une fois dans Supabase > SQL Editor, après 0028.
-- =====================================================================

create or replace function public.acces_boutique(p_boutique uuid, p_roles text[] default array['directeur', 'exploitation', 'finance'])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_boutique = public.ma_boutique(), false)
      or exists (select 1 from public.boutiques b where b.id = p_boutique and b.ferme_id = public.ferme_actuelle()
                 and public.role_actuel()::text = any (p_roles))
$$;

create or replace function public.avant_vente_boutique()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ferme uuid;
  v_opp integer;
  v_besoin integer;
  v_stock integer;
  v_fixe numeric;
  v_min numeric;
  v_max numeric;
begin
  if not public.acces_boutique(new.boutique_id, array['exploitation']) then
    raise exception 'Vous ne pouvez pas vendre pour cette boutique';
  end if;
  select ferme_id into v_ferme from public.boutiques where id = new.boutique_id and actif;
  if v_ferme is null then raise exception 'Boutique fermée ou introuvable'; end if;
  new.ferme_id := v_ferme;
  new.annulee := false; new.motif_annulation := null; new.annulee_par := null; new.annulee_le := null;
  new.saisi_par := coalesce(auth.uid(), new.saisi_par);

  if new.produit = 'oeufs' then
    new.forme := null;
    if new.unite not in ('piece', 'plateau') then raise exception 'Les œufs se vendent à la pièce ou au plateau'; end if;
    new.nombre_sujets := null;
    select oeufs_par_plateau into v_opp from public.fermes where id = v_ferme;
    v_besoin := ceil(new.quantite * case when new.unite = 'plateau' then v_opp else 1 end);
  else
    if new.forme is null then new.forme := 'vivant'; end if;
    if new.produit = 'poule_reformee' and new.forme <> 'vivant' then new.forme := 'vivant'; end if;
    if new.unite not in ('piece', 'kg') then raise exception 'Les poulets se vendent à la pièce ou au kilo'; end if;
    if new.unite = 'piece' then new.nombre_sujets := coalesce(new.nombre_sujets, new.quantite::integer); new.quantite := new.nombre_sujets; end if;
    if coalesce(new.nombre_sujets, 0) <= 0 then raise exception 'Indiquez le nombre de poulets'; end if;
    v_besoin := new.nombre_sujets;
  end if;

  -- Prix entré par celui qui vend :
  --   au kilo : prix du kilo libre ;
  --   à la pièce / au plateau : dans la plage fixée par la direction.
  if new.unite = 'kg' then
    if coalesce(new.prix_unitaire, 0) <= 0 then raise exception 'Entrez le prix du kilo'; end if;
  else
    select prix, prix_min, prix_max into v_fixe, v_min, v_max from public.prix_boutique_actuels
    where ferme_id = v_ferme and produit = new.produit and forme = coalesce(new.forme, '-') and unite = new.unite;
    if v_min is not null then
      if new.prix_unitaire is null then raise exception 'Entrez le prix (entre % et % FCFA)', v_min, v_max; end if;
      if new.prix_unitaire < v_min or new.prix_unitaire > v_max then
        raise exception 'Prix refusé : il doit être entre % et % FCFA', v_min, v_max;
      end if;
    elsif v_fixe is not null then
      new.prix_unitaire := v_fixe;
    else
      raise exception 'Pas de plage de prix pour ce produit (% %, %) : demandez à la direction', new.produit, coalesce(new.forme, ''), new.unite;
    end if;
  end if;
  new.prix_unitaire := round(new.prix_unitaire);
  new.montant := round(new.quantite * new.prix_unitaire);

  select coalesce(stock, 0) into v_stock from public.stock_boutiques where boutique_id = new.boutique_id and produit = new.produit;
  if v_besoin > coalesce(v_stock, 0) then
    raise exception 'Stock insuffisant en boutique : % disponible(s)', coalesce(v_stock, 0);
  end if;
  return new;
end;
$$;

create or replace function public.valider_versement(p_versement uuid, p_accepter boolean, p_motif text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.versements_boutique;
  v_nom text;
  a record;
begin
  if not public.a_role('finance') then raise exception 'Seule la finance (Dahirou) valide les versements'; end if;
  select * into v from public.versements_boutique where id = p_versement and ferme_id = public.ferme_actuelle() for update;
  if v.id is null or v.statut <> 'en_attente' then raise exception 'Ce versement n''est plus en attente'; end if;
  select nom into v_nom from public.boutiques where id = v.boutique_id;
  if not p_accepter then
    if coalesce(trim(p_motif), '') = '' then raise exception 'Indiquez le motif du refus'; end if;
    update public.versements_boutique set statut = 'refuse', motif_refus = trim(p_motif), valide_par = auth.uid(), valide_le = now() where id = v.id;
    return;
  end if;
  for a in select * from (values ('chair'::public.activite, v.montant_chair), ('pondeuse'::public.activite, v.montant_pondeuse)) x (activite, montant) where x.montant > 0 loop
    insert into public.mouvements_caisse_boutique (ferme_id, boutique_id, sens, montant, mode, activite, nature, versement_id, libelle)
    values (v.ferme_id, v.boutique_id, 'sortie', a.montant, v.mode, a.activite, 'versement', v.id, 'Versement à la ferme');
    perform public.ecrire(v.ferme_id, public.caisse_de(v.ferme_id, a.activite, v.mode::public.mode_paiement), 'entree', a.montant,
                          'versement_boutique', 'Versement boutique ' || v_nom, current_date);
  end loop;
  update public.versements_boutique set statut = 'valide', valide_par = auth.uid(), valide_le = now() where id = v.id;
end;
$$;
