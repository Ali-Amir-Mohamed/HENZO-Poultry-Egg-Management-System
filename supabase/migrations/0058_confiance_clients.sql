-- =====================================================================
-- HENZO – Note de confiance des clients
--   * Pour chaque client, d'après ses ventes à crédit : en combien de
--     jours il paie en moyenne, combien il doit, depuis combien de temps
--     sa plus vieille dette traîne.
--   * Une note : A très bon payeur (paie en 15 jours ou moins), B bon
--     payeur (30 jours), C à surveiller (plus de 30 jours, ou une dette de
--     plus de 30 jours), D risqué (plus de 60 jours) ; « nouveau » sans
--     historique de crédit.
--   * Un plafond de crédit conseillé, d'après ce qu'il achète par mois
--     (3 derniers mois) : A = 2 mois d'achats, B = 1 mois, C = un demi-
--     mois, D = pas de crédit. Kenfack décide de l'appliquer.
--   * Les sociétés du groupe ne sont pas notées.
-- À exécuter dans Supabase > SQL Editor, après 0057 (peut être relancée sans erreur).
-- =====================================================================

create or replace view public.confiance_clients with (security_invoker = true) as
with vc as (
  select v.client_id, v.date_vente, public.reste_a_payer_vente(v.id) as reste,
         (select max(p.date_paiement) from public.paiements_clients p where p.vente_id = v.id) as dernier_paiement
  from public.ventes v join public.tiers t on t.id = v.client_id
  where v.a_credit and not v.annulee and t.ferme_liee_id is null
),
stats as (
  select client_id, count(*) as ventes_credit,
         round(avg(case when reste <= 0 then coalesce(dernier_paiement, date_vente) - date_vente end)) as delai_moyen,
         count(*) filter (where reste <= 0) as payees,
         count(*) filter (where reste <= 0 and coalesce(dernier_paiement, date_vente) - date_vente <= 30) as payees_30j,
         coalesce(sum(reste) filter (where reste > 0), 0) as encours,
         max(current_date - date_vente) filter (where reste > 0) as plus_vieille_dette
  from vc group by client_id
),
achats as (
  select client_id, sum(montant) / 3.0 as achat_mensuel
  from public.ventes where not annulee and client_id is not null and date_vente >= current_date - 90
  group by client_id
),
notes as (
  select t.id as client_id, t.ferme_id, t.nom, t.credit_autorise, t.plafond_credit,
         coalesce(s.ventes_credit, 0) as ventes_credit, s.delai_moyen, coalesce(s.payees, 0) as payees, coalesce(s.payees_30j, 0) as payees_30j,
         coalesce(s.encours, 0) as encours, s.plus_vieille_dette, round(coalesce(a.achat_mensuel, 0)) as achat_mensuel,
         case when s.client_id is null then 'nouveau'
              when coalesce(s.plus_vieille_dette, 0) > 60 or coalesce(s.delai_moyen, 0) > 60 then 'D'
              when coalesce(s.plus_vieille_dette, 0) > 30 or coalesce(s.delai_moyen, 0) > 30 then 'C'
              when coalesce(s.delai_moyen, 0) > 15 then 'B'
              else 'A' end as note
  from public.tiers t
  left join stats s on s.client_id = t.id
  left join achats a on a.client_id = t.id
  where t.type_tiers <> 'fournisseur' and t.ferme_liee_id is null
)
select n.*,
       case n.note when 'A' then round(2 * n.achat_mensuel / 5000) * 5000
                   when 'B' then round(n.achat_mensuel / 5000) * 5000
                   when 'C' then round(0.5 * n.achat_mensuel / 5000) * 5000
                   when 'D' then 0 end as plafond_conseille
from notes n;

revoke all on public.confiance_clients from anon;
