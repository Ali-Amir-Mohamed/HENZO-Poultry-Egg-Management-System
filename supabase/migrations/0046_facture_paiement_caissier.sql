-- =====================================================================
-- HENZO – Facture : mode de paiement et caissier
--   * La facture affiche comment le client a payé (espèces, Mobile Money,
--     banque, crédit) et qui l'a établie (le caissier : la personne qui a
--     enregistré la vente).
-- À exécuter une fois dans Supabase > SQL Editor, après 0045.
-- =====================================================================

create or replace function public.facture_complete(p_facture uuid)
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
    -- how the client paid: the modes of the cash taken, plus « credit » when part of it is owed
    'paiement', (select coalesce(jsonb_agg(distinct m), '[]'::jsonb) from (
        select v.mode_paiement::text as m from public.facture_lignes l join public.ventes v on v.id = l.vente_id
        where l.facture_id = fa.id and v.mode_paiement is not null
        union
        select 'credit' from public.facture_lignes l join public.ventes v on v.id = l.vente_id
        where l.facture_id = fa.id and v.a_credit) x),
    -- the cashier: whoever made the invoice (the seller for an automatic one), else whoever typed the first sale
    'caissier', coalesce(
        (select nullif(p.nom_complet, '') from public.profiles p where p.id = fa.creee_par),
        (select nullif(p.nom_complet, '') from public.facture_lignes l join public.ventes v on v.id = l.vente_id join public.profiles p on p.id = v.saisi_par
          where l.facture_id = fa.id order by l.ordre limit 1)),
    'societe', jsonb_build_object('nom', s.nom, 'raison_sociale', s.raison_sociale, 'forme_juridique', s.forme_juridique, 'capital_social', s.capital_social,
      'niu', s.niu, 'rccm', s.rccm, 'adresse_siege', s.adresse_siege, 'telephone_societe', s.telephone_societe, 'email_societe', s.email_societe,
      'banque_paiement', s.banque_paiement, 'mentions_facture', s.mentions_facture));
end;
$$;

revoke execute on function public.facture_complete(uuid) from public, anon;
grant execute on function public.facture_complete(uuid) to authenticated;
