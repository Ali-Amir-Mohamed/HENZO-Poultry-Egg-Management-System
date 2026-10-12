-- =====================================================================
-- HENZO – Boutiques : qui envoie, qui confirme
--   * envoyer la marchandise en boutique : l'exploitation (Kenfack) ou un employé ;
--   * confirmer une réception : uniquement le vendeur de la boutique.
-- Le directeur ne fait ni l'un ni l'autre (il voit tout, comme avant).
-- À exécuter une fois dans Supabase > SQL Editor, après 0026.
-- =====================================================================

create or replace function public.creer_envoi(p_boutique uuid, p_lignes jsonb, p_date date default current_date, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.boutiques;
  v_envoi uuid;
  l jsonb;
  v_q integer;
  v_dispo integer;
begin
  if not public.a_role('exploitation', 'employe') then raise exception 'Seuls l''exploitation et les employés envoient la marchandise en boutique'; end if;
  select * into b from public.boutiques where id = p_boutique and ferme_id = public.ferme_actuelle() and actif;
  if b.id is null then raise exception 'Boutique introuvable'; end if;
  if jsonb_array_length(coalesce(p_lignes, '[]'::jsonb)) = 0 then raise exception 'Rien à envoyer'; end if;
  insert into public.envois_boutique (ferme_id, boutique_id, date_envoi, notes) values (b.ferme_id, b.id, coalesce(p_date, current_date), p_notes)
  returning id into v_envoi;
  for l in select * from jsonb_array_elements(p_lignes) loop
    v_q := (l ->> 'quantite')::integer;
    if coalesce(v_q, 0) <= 0 then continue; end if;
    if l ->> 'produit' = 'poulet' then
      v_dispo := public.oiseaux_restants((l ->> 'bande_id')::uuid, null) - public.en_boutique((l ->> 'bande_id')::uuid);
      if v_q > v_dispo then raise exception 'Il ne reste que % poulets disponibles à la ferme dans cette bande', greatest(v_dispo, 0); end if;
      insert into public.envois_lignes (envoi_id, ferme_id, boutique_id, produit, bande_id, quantite_envoyee)
      values (v_envoi, b.ferme_id, b.id, 'poulet', (l ->> 'bande_id')::uuid, v_q);
    elsif l ->> 'produit' = 'poule_reformee' then
      v_dispo := public.oiseaux_restants(null, (l ->> 'lot_id')::uuid) - public.en_boutique(null, (l ->> 'lot_id')::uuid);
      if v_q > v_dispo then raise exception 'Il ne reste que % poules disponibles dans ce lot', greatest(v_dispo, 0); end if;
      insert into public.envois_lignes (envoi_id, ferme_id, boutique_id, produit, lot_id, quantite_envoyee)
      values (v_envoi, b.ferme_id, b.id, 'poule_reformee', (l ->> 'lot_id')::uuid, v_q);
    elsif l ->> 'produit' = 'oeufs' then
      select stock_oeufs into v_dispo from public.stock_oeufs;
      if v_q > coalesce(v_dispo, 0) then raise exception 'Stock d''œufs insuffisant à la ferme (% œufs)', greatest(coalesce(v_dispo, 0), 0); end if;
      insert into public.envois_lignes (envoi_id, ferme_id, boutique_id, produit, lot_id, quantite_envoyee)
      values (v_envoi, b.ferme_id, b.id, 'oeufs', (l ->> 'lot_id')::uuid, v_q);
    else
      raise exception 'Produit inconnu';
    end if;
  end loop;
  return v_envoi;
end;
$$;

-- Réception : uniquement le vendeur de cette boutique
create or replace function public.recevoir_envoi(p_envoi uuid, p_recus jsonb default '[]'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.envois_boutique;
  l public.envois_lignes;
  v_recu integer;
  v_manque integer := 0;
  v_nom text;
begin
  select * into e from public.envois_boutique where id = p_envoi for update;
  if e.id is null or e.boutique_id is distinct from public.ma_boutique() then
    raise exception 'Seul le vendeur de la boutique confirme la réception';
  end if;
  if e.statut <> 'en_route' then raise exception 'Cet envoi est déjà réceptionné'; end if;
  select nom into v_nom from public.boutiques where id = e.boutique_id;
  for l in select * from public.envois_lignes where envoi_id = e.id loop
    select (x ->> 'recu')::integer into v_recu from jsonb_array_elements(coalesce(p_recus, '[]'::jsonb)) x where (x ->> 'ligne_id')::uuid = l.id;
    v_recu := coalesce(v_recu, l.quantite_envoyee);
    if v_recu < 0 or v_recu > l.quantite_envoyee then raise exception 'Quantité reçue impossible (0 à %)', l.quantite_envoyee; end if;
    update public.envois_lignes set quantite_recue = v_recu, restant = v_recu where id = l.id;
    insert into public.mouvements_stock_boutique (ferme_id, boutique_id, ligne_id, produit, type_mouvement, quantite)
    values (e.ferme_id, e.boutique_id, l.id, l.produit, 'reception', v_recu);
    if v_recu < l.quantite_envoyee then
      v_manque := v_manque + (l.quantite_envoyee - v_recu);
      if l.produit in ('poulet', 'poule_reformee') then
        insert into public.mortalites (ferme_id, bande_id, lot_id, nombre, cause, saisi_par)
        values (e.ferme_id, l.bande_id, case when l.produit = 'poule_reformee' then l.lot_id end, l.quantite_envoyee - v_recu,
                'Manquant à la réception (boutique ' || v_nom || ')', auth.uid());
      end if;
    end if;
  end loop;
  update public.envois_boutique set statut = 'recu', recu_par = auth.uid(), recu_le = now() where id = e.id;
  if v_manque > 0 then
    perform public.notifier(e.ferme_id, r, 'ecart_envoi', format('Boutique %s : envoi reçu avec %s manquant(s)', v_nom, v_manque), '/boutique')
    from unnest(array['directeur', 'exploitation']::public.role_utilisateur[]) r;
  end if;
end;
$$;
