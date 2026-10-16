-- =====================================================================
-- HENZO – Facture faite au moment de la vente
--   * Chaque vente (ferme, boutique, HENZO AGRO) reçoit sa facture
--     numérotée tout de suite – ou dès qu'elle arrive sur le serveur si
--     elle a été saisie hors ligne. Client non enregistré : « Client
--     comptant » (ou le nom tapé en boutique).
--   * Annuler une vente annule sa facture.
--   * La facture d'une vente s'ouvre aussi pour l'employé qui l'a saisie
--     et pour le vendeur de la boutique.
-- À exécuter une fois dans Supabase > SQL Editor, après 0044.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Faire la facture de ventes (sans contrôle de rôle : appelée par les automatismes et par creer_facture)
-- ---------------------------------------------------------------------
create function public.facturer_ventes(p_ventes uuid[], p_date date default current_date, p_client_nom text default null, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
  from public.ventes where id = any (p_ventes) and ferme_id = f.id and not annulee;
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
$$;

-- Le bouton « Facture » existant (regrouper des ventes plus anciennes) garde ses droits
create or replace function public.creer_facture(p_ventes uuid[], p_date date default current_date, p_client_nom text default null, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.a_role('directeur', 'exploitation', 'finance') then raise exception 'Vous ne pouvez pas faire de facture'; end if;
  if exists (select 1 from public.ventes where id = any (p_ventes) and ferme_id is distinct from public.ferme_actuelle()) then
    raise exception 'Vente introuvable ou annulée';
  end if;
  return public.facturer_ventes(p_ventes, p_date, p_client_nom, p_notes);
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Facture automatique à chaque vente
--    (une erreur de facture n'empêche jamais d'enregistrer la vente : la direction est prévenue)
-- ---------------------------------------------------------------------
create function public.facture_auto_vente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.boutique_id is not null or new.annulee then return null; end if;   -- boutique : une facture pour toute la vente, plus bas
  begin
    perform public.facturer_ventes(array[new.id], current_date, case when new.client_id is null then 'Client comptant' end, null);
  exception when others then
    perform public.notifier(new.ferme_id, 'directeur', 'facture_auto', 'Facture non créée pour une vente : ' || sqlerrm, '/argent');
  end;
  return null;
end;
$$;
create trigger z_facture_auto after insert on public.ventes
  for each row execute function public.facture_auto_vente();

create function public.facture_auto_boutique()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  select array_agg(id order by created_at) into v_ids from public.ventes where vente_boutique_id = new.id;
  if v_ids is null then return null; end if;
  begin
    perform public.facturer_ventes(v_ids, current_date, coalesce(nullif(trim(new.client_nom), ''), 'Client comptant'), null);
  exception when others then
    perform public.notifier(new.ferme_id, 'directeur', 'facture_auto', 'Facture non créée pour une vente en boutique : ' || sqlerrm, '/boutique');
  end;
  return null;
end;
$$;
create trigger z_facture_auto after insert on public.ventes_boutique
  for each row execute function public.facture_auto_boutique();

-- Annuler une vente annule sa facture (si la facture ne porte pas d'autres ventes encore valables)
create or replace function public.controle_vente_facturee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fa record;
begin
  if new.annulee and not old.annulee then
    for fa in select distinct x.id, x.numero from public.facture_lignes l join public.factures x on x.id = l.facture_id
              where l.vente_id = new.id and l.active and not x.annulee loop
      if exists (select 1 from public.facture_lignes l2 join public.ventes v2 on v2.id = l2.vente_id
                 where l2.facture_id = fa.id and l2.active and v2.id <> new.id and not v2.annulee
                   and not (new.vente_boutique_id is not null and v2.vente_boutique_id = new.vente_boutique_id)) then
        raise exception 'Cette vente est sur la facture % avec d''autres ventes : annulez d''abord la facture', fa.numero;
      end if;
      update public.factures set annulee = true, motif_annulation = 'Vente annulée : ' || coalesce(new.motif_annulation, ''),
                                 annulee_par = auth.uid(), annulee_le = now()
      where id = fa.id;
      update public.facture_lignes set active = false where facture_id = fa.id;
    end loop;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Voir la facture d'une vente (aussi pour l'employé qui a vendu et le vendeur de la boutique)
-- ---------------------------------------------------------------------
create function public.peut_voir_facture(p_facture uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.facture_lignes l join public.ventes v on v.id = l.vente_id
    where l.facture_id = p_facture
      and ((v.ferme_id in (select public.sites_de(public.ferme_actuelle())) and public.a_role('directeur', 'exploitation', 'finance', 'comptable'))
           or (v.ferme_id = public.ferme_actuelle() and v.saisi_par = auth.uid())
           or (v.boutique_id is not null and v.boutique_id = public.ma_boutique())))
$$;

create function public.facture_pour(p_vente uuid default null, p_vente_boutique uuid default null)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select l.facture_id into v_id
  from public.facture_lignes l join public.ventes v on v.id = l.vente_id
  where l.active and (v.id = p_vente or (p_vente_boutique is not null and v.vente_boutique_id = p_vente_boutique))
  order by l.ordre limit 1;
  if v_id is null or not public.peut_voir_facture(v_id) then return null; end if;
  return v_id;
end;
$$;

create function public.facture_complete(p_facture uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  fa public.factures;
  s public.fermes;
begin
  select * into fa from public.factures where id = p_facture;
  if fa.id is null or not public.peut_voir_facture(fa.id) then raise exception 'Facture introuvable'; end if;
  select * into s from public.fermes where id = public.societe_de(fa.ferme_id);
  return jsonb_build_object(
    'facture', to_jsonb(fa),
    'lignes', (select coalesce(jsonb_agg(to_jsonb(l) order by l.ordre), '[]'::jsonb) from public.facture_lignes l where l.facture_id = fa.id),
    'reste', (select coalesce(sum(public.reste_a_payer_vente(l.vente_id)), 0) from public.facture_lignes l where l.facture_id = fa.id and l.vente_id is not null and not fa.annulee),
    'societe', jsonb_build_object('nom', s.nom, 'raison_sociale', s.raison_sociale, 'forme_juridique', s.forme_juridique, 'capital_social', s.capital_social,
      'niu', s.niu, 'rccm', s.rccm, 'adresse_siege', s.adresse_siege, 'telephone_societe', s.telephone_societe, 'email_societe', s.email_societe,
      'banque_paiement', s.banque_paiement, 'mentions_facture', s.mentions_facture));
end;
$$;

revoke execute on function public.facturer_ventes(uuid[], date, text, text), public.facture_auto_vente(), public.facture_auto_boutique(),
                          public.peut_voir_facture(uuid) from public, anon, authenticated;
revoke execute on function public.facture_pour(uuid, uuid), public.facture_complete(uuid) from public, anon;
grant execute on function public.facture_pour(uuid, uuid), public.facture_complete(uuid) to authenticated;
