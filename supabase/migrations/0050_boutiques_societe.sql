-- =====================================================================
-- HENZO – Boutiques de la société, livrées par tous les sites
--   * Une boutique appartient à la société (AGRO VISION PARTNERS SARL),
--     pas à un site : elle est créée une seule fois et chaque site peut
--     lui envoyer poulets, œufs et poules de réforme.
--   * La boutique garde un seul stock, une seule caisse, une seule clôture.
--   * Chaque vente en boutique compte dans le site et la bande d'où
--     viennent les poulets (les plus anciens partent d'abord).
--   * Les prix boutique sont ceux de la société.
--   * Un versement de la boutique entre dans les caisses du site où
--     Dahirou le valide.
--   * Une facture peut regrouper des poulets de plusieurs sites (même
--     société, même numérotation).
-- À exécuter une fois dans Supabase > SQL Editor, après 0049.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Boutiques et prix rangés sous la société
-- ---------------------------------------------------------------------
create function public.boutique_de_la_societe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.ferme_id := public.societe_de(coalesce(new.ferme_id, public.ferme_actuelle()));
  return new;
end;
$$;
create trigger a_boutique_societe before insert or update of ferme_id on public.boutiques
  for each row execute function public.boutique_de_la_societe();
create trigger a_prix_societe before insert on public.prix_boutique
  for each row execute function public.boutique_de_la_societe();
revoke execute on function public.boutique_de_la_societe() from public, anon, authenticated;

update public.boutiques set ferme_id = public.societe_de(ferme_id) where ferme_id <> public.societe_de(ferme_id);
update public.prix_boutique set ferme_id = public.societe_de(ferme_id) where ferme_id <> public.societe_de(ferme_id);

-- ---------------------------------------------------------------------
-- 2. Droits : tous les sites de la société voient ses boutiques
-- ---------------------------------------------------------------------
drop policy boutiques_select on public.boutiques;
create policy boutiques_select on public.boutiques for select to authenticated
  using ((ferme_id = public.societe_de(public.ferme_actuelle()) and public.a_role('directeur', 'exploitation', 'finance', 'employe')) or id = public.ma_boutique());
drop policy boutiques_write on public.boutiques;
create policy boutiques_write on public.boutiques for all to authenticated
  using (ferme_id = public.societe_de(public.ferme_actuelle()) and public.a_role('directeur'))
  with check (ferme_id = public.societe_de(public.ferme_actuelle()) and public.a_role('directeur'));

drop policy prix_boutique_select on public.prix_boutique;
create policy prix_boutique_select on public.prix_boutique for select to authenticated
  using (ferme_id = public.societe_de(public.ferme_actuelle()) or ferme_id = (select ferme_id from public.boutiques where id = public.ma_boutique()));
drop policy prix_boutique_insert on public.prix_boutique;
create policy prix_boutique_insert on public.prix_boutique for insert to authenticated
  with check (ferme_id = public.societe_de(public.ferme_actuelle()) and saisi_par = auth.uid() and public.a_role('directeur', 'exploitation', 'finance'));

-- shipments: the sending site sees its own; the company's management sees everything sent to its shops
drop policy envois_select on public.envois_boutique;
create policy envois_select on public.envois_boutique for select to authenticated
  using ((ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance', 'employe'))
         or public.acces_boutique(boutique_id) or boutique_id = public.ma_boutique());
drop policy envois_lignes_select on public.envois_lignes;
create policy envois_lignes_select on public.envois_lignes for select to authenticated
  using ((ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance', 'employe'))
         or public.acces_boutique(boutique_id) or boutique_id = public.ma_boutique());
drop policy stock_boutique_select on public.mouvements_stock_boutique;
create policy stock_boutique_select on public.mouvements_stock_boutique for select to authenticated
  using (public.acces_boutique(boutique_id) or boutique_id = public.ma_boutique());

drop policy caisse_boutique_select on public.mouvements_caisse_boutique;
create policy caisse_boutique_select on public.mouvements_caisse_boutique for select to authenticated
  using ((ferme_id = public.societe_de(public.ferme_actuelle()) and public.a_role('directeur', 'finance', 'exploitation')) or boutique_id = public.ma_boutique());
drop policy clotures_select on public.clotures_boutique;
create policy clotures_select on public.clotures_boutique for select to authenticated
  using ((ferme_id = public.societe_de(public.ferme_actuelle()) and public.a_role('directeur', 'finance')) or boutique_id = public.ma_boutique());
drop policy versements_select on public.versements_boutique;
create policy versements_select on public.versements_boutique for select to authenticated
  using ((ferme_id = public.societe_de(public.ferme_actuelle()) and public.a_role('directeur', 'finance')) or boutique_id = public.ma_boutique());
drop policy ventes_boutique_select on public.ventes_boutique;
create policy ventes_boutique_select on public.ventes_boutique for select to authenticated
  using ((ferme_id = public.societe_de(public.ferme_actuelle()) and public.a_role('directeur', 'exploitation', 'finance')) or boutique_id = public.ma_boutique());
drop policy ventes_boutique_update on public.ventes_boutique;
create policy ventes_boutique_update on public.ventes_boutique for update to authenticated
  using (ferme_id = public.societe_de(public.ferme_actuelle()) and public.a_role('directeur'))
  with check (ferme_id = public.societe_de(public.ferme_actuelle()) and public.a_role('directeur'));
drop policy ventes_boutique_insert on public.ventes_boutique;
create policy ventes_boutique_insert on public.ventes_boutique for insert to authenticated
  with check (saisi_par = auth.uid() and (boutique_id = public.ma_boutique()
              or (public.a_role('exploitation') and exists (select 1 from public.boutiques b where b.id = boutique_id and b.ferme_id = public.societe_de(public.ferme_actuelle())))));

-- a site reads the name of its company (shop pages show it)
create policy fermes_societe on public.fermes for select to authenticated
  using (id = public.societe_de(public.ferme_actuelle()));

-- ---------------------------------------------------------------------
-- 3. Fonctions
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acces_boutique(p_boutique uuid, p_roles text[] DEFAULT ARRAY['directeur'::text, 'exploitation'::text, 'finance'::text])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(p_boutique = public.ma_boutique(), false)
      or exists (select 1 from public.boutiques b where b.id = p_boutique and b.ferme_id = public.societe_de(public.ferme_actuelle())
                 and public.role_actuel()::text = any (p_roles))
$function$;

CREATE OR REPLACE FUNCTION public.affecter_boutique(p_identifiant text, p_boutique uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid;
begin
  if not public.a_role('directeur') then raise exception 'Seul le directeur affecte les vendeurs'; end if;
  if not exists (select 1 from public.boutiques where id = p_boutique and ferme_id = public.societe_de(public.ferme_actuelle())) then
    raise exception 'Boutique introuvable';
  end if;
  select id into v_user from public.profiles where lower(identifiant) = lower(trim(p_identifiant)) and role::text = 'vendeur';
  if v_user is null then raise exception 'Aucun compte vendeur avec l''identifiant %', p_identifiant; end if;
  update public.profiles set boutique_id = p_boutique where id = v_user;
end;
$function$;

-- A site sends from its own flocks and egg stock to a shop of its company
CREATE OR REPLACE FUNCTION public.creer_envoi(p_boutique uuid, p_lignes jsonb, p_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  b public.boutiques;
  v_envoi uuid;
  l jsonb;
  v_q integer;
  v_dispo integer;
begin
  if not public.a_role('exploitation', 'employe') then raise exception 'Seuls l''exploitation et les employés envoient la marchandise en boutique'; end if;
  select * into b from public.boutiques where id = p_boutique and ferme_id = public.societe_de(public.ferme_actuelle()) and actif;
  if b.id is null then raise exception 'Boutique introuvable'; end if;
  if jsonb_array_length(coalesce(p_lignes, '[]'::jsonb)) = 0 then raise exception 'Rien à envoyer'; end if;
  insert into public.envois_boutique (ferme_id, boutique_id, date_envoi, notes) values (public.ferme_actuelle(), b.id, coalesce(p_date, current_date), p_notes)
  returning id into v_envoi;
  for l in select * from jsonb_array_elements(p_lignes) loop
    v_q := (l ->> 'quantite')::integer;
    if coalesce(v_q, 0) <= 0 then continue; end if;
    if l ->> 'produit' = 'poulet' then
      v_dispo := public.oiseaux_restants((l ->> 'bande_id')::uuid, null) - public.en_boutique((l ->> 'bande_id')::uuid);
      if v_q > v_dispo then raise exception 'Il ne reste que % poulets disponibles à la ferme dans cette bande', greatest(v_dispo, 0); end if;
      insert into public.envois_lignes (envoi_id, ferme_id, boutique_id, produit, bande_id, quantite_envoyee)
      values (v_envoi, public.ferme_actuelle(), b.id, 'poulet', (l ->> 'bande_id')::uuid, v_q);
    elsif l ->> 'produit' = 'poule_reformee' then
      v_dispo := public.oiseaux_restants(null, (l ->> 'lot_id')::uuid) - public.en_boutique(null, (l ->> 'lot_id')::uuid);
      if v_q > v_dispo then raise exception 'Il ne reste que % poules disponibles dans ce lot', greatest(v_dispo, 0); end if;
      insert into public.envois_lignes (envoi_id, ferme_id, boutique_id, produit, lot_id, quantite_envoyee)
      values (v_envoi, public.ferme_actuelle(), b.id, 'poule_reformee', (l ->> 'lot_id')::uuid, v_q);
    elsif l ->> 'produit' = 'oeufs' then
      select stock_oeufs into v_dispo from public.stock_oeufs;
      if v_q > coalesce(v_dispo, 0) then raise exception 'Stock d''œufs insuffisant à la ferme (% œufs)', greatest(coalesce(v_dispo, 0), 0); end if;
      insert into public.envois_lignes (envoi_id, ferme_id, boutique_id, produit, lot_id, quantite_envoyee)
      values (v_envoi, public.ferme_actuelle(), b.id, 'oeufs', (l ->> 'lot_id')::uuid, v_q);
    else
      raise exception 'Produit inconnu';
    end if;
  end loop;
  return v_envoi;
end;
$function$;

-- Each portion taken from the shop stock says which site it comes from
CREATE OR REPLACE FUNCTION public.ecouler_stock_boutique(p_boutique uuid, p_produit text, p_quantite integer, p_type text, p_motif text DEFAULT NULL::text, p_vente uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  l record;
  v_reste integer := p_quantite;
  v_pris integer;
  v_out jsonb := '[]'::jsonb;
begin
  for l in select li.* from public.envois_lignes li join public.envois_boutique e on e.id = li.envoi_id
           where li.boutique_id = p_boutique and li.produit = p_produit and e.statut = 'recu' and li.restant > 0
           order by e.recu_le, li.created_at for update of li loop
    exit when v_reste = 0;
    v_pris := least(l.restant, v_reste);
    update public.envois_lignes set restant = restant - v_pris where id = l.id;
    insert into public.mouvements_stock_boutique (ferme_id, boutique_id, ligne_id, produit, type_mouvement, quantite, motif, vente_boutique_id)
    values (l.ferme_id, p_boutique, l.id, p_produit, p_type, -v_pris, p_motif, p_vente);
    v_out := v_out || jsonb_build_object('ligne_id', l.id, 'quantite', v_pris, 'bande_id', l.bande_id, 'lot_id', l.lot_id, 'ferme_id', l.ferme_id);
    v_reste := v_reste - v_pris;
  end loop;
  if v_reste > 0 then raise exception 'Stock insuffisant en boutique (il manque %)', v_reste; end if;
  return v_out;
end;
$function$;

-- A shop sale counts in the site and flock the birds come from
CREATE OR REPLACE FUNCTION public.apres_vente_boutique()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_opp integer;
  v_besoin integer;
  v_portions jsonb;
  p jsonb;
  v_q integer;
  v_qte numeric;
begin
  select oeufs_par_plateau into v_opp from public.fermes where id = new.ferme_id;
  v_besoin := case when new.produit = 'oeufs' then ceil(new.quantite * case when new.unite = 'plateau' then v_opp else 1 end) else new.nombre_sujets end;
  v_portions := public.ecouler_stock_boutique(new.boutique_id, new.produit, v_besoin, 'vente', null, new.id);

  for p in select * from jsonb_array_elements(v_portions) loop
    v_q := (p ->> 'quantite')::integer;
    -- part de la quantité vendue (kg, plateaux) correspondant à cette portion
    v_qte := case when new.produit = 'oeufs' and new.unite = 'plateau' then round(v_q::numeric / v_opp, 2)
                  when new.produit = 'oeufs' then v_q
                  when new.unite = 'kg' then round(new.quantite * v_q / new.nombre_sujets, 2)
                  else v_q end;
    if v_qte <= 0 then v_qte := 0.01; end if;
    insert into public.ventes (ferme_id, date_vente, bande_id, lot_id, produit, unite, quantite, prix_unitaire, nombre_sujets,
                               a_credit, mode_paiement, boutique_id, forme, notes, saisi_par, vente_boutique_id)
    values ((p ->> 'ferme_id')::uuid, new.date_vente,   -- the site the birds come from
            case when new.produit = 'poulet' then (p ->> 'bande_id')::uuid end,
            case when new.produit <> 'poulet' then (p ->> 'lot_id')::uuid end,
            case new.produit when 'poulet' then 'poulets' when 'poule_reformee' then 'poules_reformees'
                             else case when new.unite = 'plateau' then 'plateaux' else 'oeufs' end end,
            new.unite, v_qte, new.prix_unitaire,
            case when new.produit <> 'oeufs' then v_q end,
            false, new.mode_paiement::public.mode_paiement, new.boutique_id, new.forme,
            'Vente boutique', new.saisi_par, new.id);
  end loop;

  insert into public.mouvements_caisse_boutique (ferme_id, boutique_id, date_mouvement, sens, montant, mode, activite, nature, vente_boutique_id, libelle, saisi_par)
  values (new.ferme_id, new.boutique_id, new.date_vente, 'entree', new.montant, new.mode_paiement,
          case when new.produit = 'poulet' then 'chair'::public.activite else 'pondeuse'::public.activite end,
          'vente', new.id, 'Vente ' || new.produit, new.saisi_par);
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.declarer_perte_boutique(p_boutique uuid, p_produit text, p_quantite integer, p_motif text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  p jsonb;
  v_nom text;
begin
  if not public.acces_boutique(p_boutique, array['directeur', 'exploitation']) then raise exception 'Boutique introuvable'; end if;
  if coalesce(p_quantite, 0) <= 0 then raise exception 'Indiquez la quantité perdue'; end if;
  if coalesce(trim(p_motif), '') = '' then raise exception 'Indiquez le motif de la perte'; end if;
  select nom into v_nom from public.boutiques where id = p_boutique;
  for p in select * from jsonb_array_elements(public.ecouler_stock_boutique(p_boutique, p_produit, p_quantite, 'perte', trim(p_motif))) loop
    if p_produit in ('poulet', 'poule_reformee') then
      insert into public.mortalites (ferme_id, bande_id, lot_id, nombre, cause, saisi_par)
      select (p ->> 'ferme_id')::uuid, (p ->> 'bande_id')::uuid, case when p_produit = 'poule_reformee' then (p ->> 'lot_id')::uuid end,
             (p ->> 'quantite')::integer, 'Perte en boutique (' || v_nom || ') : ' || trim(p_motif), auth.uid()
      from public.boutiques b where b.id = p_boutique;
    end if;
  end loop;
  perform public.notifier(b.ferme_id, r, 'perte_boutique', format('Boutique %s : perte de %s %s (%s)', v_nom, p_quantite, p_produit, trim(p_motif)), '/boutique')
  from public.boutiques b, unnest(array['directeur', 'exploitation']::public.role_utilisateur[]) r where b.id = p_boutique;
end;
$function$;

CREATE OR REPLACE FUNCTION public.inventaire_boutique(p_boutique uuid, p_produit text, p_compte integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_stock integer;
  v_ecart integer;
  v_ligne uuid;
begin
  if not public.acces_boutique(p_boutique, array['directeur', 'exploitation']) then raise exception 'Boutique introuvable'; end if;
  if p_compte is null or p_compte < 0 then raise exception 'Indiquez la quantité comptée'; end if;
  select coalesce(stock, 0) into v_stock from public.stock_boutiques where boutique_id = p_boutique and produit = p_produit;
  v_ecart := p_compte - coalesce(v_stock, 0);
  if v_ecart < 0 then
    perform public.declarer_perte_boutique(p_boutique, p_produit, -v_ecart, 'Écart d''inventaire');
  elsif v_ecart > 0 then
    select li.id into v_ligne from public.envois_lignes li join public.envois_boutique e on e.id = li.envoi_id
    where li.boutique_id = p_boutique and li.produit = p_produit and e.statut = 'recu' order by e.recu_le desc, li.created_at desc limit 1;
    if v_ligne is null then raise exception 'Aucun envoi reçu pour ce produit : impossible d''ajouter du stock'; end if;
    update public.envois_lignes set restant = restant + v_ecart where id = v_ligne;
    insert into public.mouvements_stock_boutique (ferme_id, boutique_id, ligne_id, produit, type_mouvement, quantite, motif)
    select ferme_id, p_boutique, v_ligne, p_produit, 'inventaire', v_ecart, 'Surplus à l''inventaire' from public.envois_lignes where id = v_ligne;
  end if;
  return v_ecart;
end;
$function$;

CREATE OR REPLACE FUNCTION public.valider_versement(p_versement uuid, p_accepter boolean, p_motif text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.versements_boutique;
  v_nom text;
  a record;
begin
  if not public.a_role('finance') then raise exception 'Seule la finance (Dahirou) valide les versements'; end if;
  select * into v from public.versements_boutique where id = p_versement and ferme_id = public.societe_de(public.ferme_actuelle()) for update;
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
    -- the money goes into the cash boxes of the site where it is received (where Dahirou validates)
    perform public.ecrire(public.ferme_actuelle(), public.caisse_de(public.ferme_actuelle(), a.activite, v.mode::public.mode_paiement), 'entree', a.montant,
                          'versement_boutique', 'Versement boutique ' || v_nom, current_date);
  end loop;
  update public.versements_boutique set statut = 'valide', valide_par = auth.uid(), valide_le = now() where id = v.id;
end;
$function$;

-- One invoice may group birds from several sites of the same company
CREATE OR REPLACE FUNCTION public.facturer_ventes(p_ventes uuid[], p_date date DEFAULT CURRENT_DATE, p_client_nom text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f public.fermes;
  s public.fermes;
  v public.ventes;
  c public.tiers;
  v_client uuid;
  v_n integer;
  v_annee integer := extract(year from coalesce(p_date, current_date))::integer;
  v_seq integer;
  v_ttc numeric := 0;
  v_ht numeric;
  v_id uuid;
  v_ordre integer := 0;
  v_derniere date;
begin
  if coalesce(array_length(p_ventes, 1), 0) = 0 then raise exception 'Choisissez au moins une vente à facturer'; end if;
  select * into f from public.fermes where id = (select ferme_id from public.ventes where id = p_ventes[1]);
  select * into s from public.fermes where id = public.societe_de(f.id) for update;   -- un seul numéro à la fois, pour toute la société
  select count(*), count(distinct coalesce(client_id::text, '-')), max(client_id::text)::uuid into v_n, v_seq, v_client
  from public.ventes where id = any (p_ventes) and ferme_id in (select public.sites_de(f.id)) and not annulee;
  if v_n <> array_length(p_ventes, 1) then raise exception 'Vente introuvable ou annulée'; end if;
  if v_seq > 1 then raise exception 'Une facture ne regroupe que les ventes d''un même client'; end if;
  if exists (select 1 from public.facture_lignes where vente_id = any (p_ventes) and active) then
    raise exception 'Une de ces ventes est déjà facturée';
  end if;
  if v_client is null and coalesce(trim(p_client_nom), '') = '' then raise exception 'Indiquez le nom du client'; end if;
  select max(date_facture) into v_derniere from public.factures where ferme_id in (select public.sites_de(f.id)) and annee = v_annee;
  if v_derniere is not null and coalesce(p_date, current_date) < v_derniere then
    raise exception 'La date ne peut pas être avant la dernière facture (%)', to_char(v_derniere, 'DD/MM/YYYY');
  end if;
  select * into c from public.tiers where id = v_client;
  select coalesce(sum(montant), 0) into v_ttc from public.ventes where id = any (p_ventes);
  if s.assujetti_tva then v_ht := round(v_ttc / (1 + s.taux_tva / 100)); else v_ht := v_ttc; end if;
  select coalesce(max(sequence), 0) + 1 into v_seq from public.factures where ferme_id in (select public.sites_de(f.id)) and annee = v_annee;
  insert into public.factures (ferme_id, numero, annee, sequence, date_facture, client_id, client_nom, client_niu, client_rccm,
                               client_adresse, client_telephone, tva_applicable, taux_tva, total_ht, total_tva, total_ttc, notes)
  values (f.id, s.prefixe_facture || '-' || v_annee || '-' || lpad(v_seq::text, 4, '0'), v_annee, v_seq, coalesce(p_date, current_date),
          v_client, coalesce(c.nom, trim(p_client_nom)), c.niu, c.rccm, c.adresse, c.telephone,
          s.assujetti_tva, case when s.assujetti_tva then s.taux_tva else 0 end, v_ht, v_ttc - v_ht, v_ttc, nullif(trim(coalesce(p_notes, '')), ''))
  returning id into v_id;
  for v in select * from public.ventes where id = any (p_ventes) order by date_vente, created_at loop
    v_ordre := v_ordre + 1;
    insert into public.facture_lignes (facture_id, ferme_id, ordre, designation, quantite, unite, prix_unitaire, montant, vente_id)
    values (v_id, f.id, v_ordre, public.designation_vente(v), v.quantite, v.unite, v.prix_unitaire, v.montant, v.id);
  end loop;
  return v_id;
end;
$function$;
