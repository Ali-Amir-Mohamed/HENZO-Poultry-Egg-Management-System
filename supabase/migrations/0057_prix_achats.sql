-- =====================================================================
-- HENZO – Suivi des prix d'achat
--   * Chaque achat qui entre en stock (maïs, soja, aliment, poussins,
--     médicaments, sacs…) garde son prix unitaire et son fournisseur :
--     l'historique des prix, le dernier prix, le moins cher.
--   * Alerte quand un prix monte : un achat plus cher de 10 % ou plus que
--     la moyenne des 3 derniers achats du même article prévient Ali,
--     Kenfack et Dahirou.
-- À exécuter dans Supabase > SQL Editor, après 0056 (peut être relancée sans erreur).
-- =====================================================================

create or replace view public.prix_achats with (security_invoker = true) as
select d.id as depense_id, d.ferme_id, d.article_id, a.nom as article, a.categorie, a.unite, d.date_depense,
       d.fournisseur_id, t.nom as fournisseur, d.quantite, d.montant, round(d.montant / d.quantite, 2) as prix_unitaire
from public.depenses d
join public.articles a on a.id = d.article_id
left join public.tiers t on t.id = d.fournisseur_id
where d.article_id is not null and d.quantite > 0 and not d.annulee and d.statut <> 'rejetee';

create or replace function public.alerte_hausse_prix()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prix numeric;
  v_moyenne numeric;
  v_nom text;
  v_unite text;
  v_four text;
  v_hausse integer;
begin
  if new.article_id is null or coalesce(new.quantite, 0) <= 0 then return null; end if;
  v_prix := new.montant / new.quantite;
  select avg(p) into v_moyenne from (
    select d.montant / d.quantite as p from public.depenses d
    where d.ferme_id = new.ferme_id and d.article_id = new.article_id and d.id <> new.id and d.quantite > 0
      and not d.annulee and d.statut <> 'rejetee'
    order by d.date_depense desc, d.created_at desc limit 3) x;
  if v_moyenne is null or v_moyenne <= 0 or v_prix < v_moyenne * 1.10 then return null; end if;
  v_hausse := round((v_prix / v_moyenne - 1) * 100);
  select nom, unite into v_nom, v_unite from public.articles where id = new.article_id;
  select nom into v_four from public.tiers where id = new.fournisseur_id;
  perform public.notifier(new.ferme_id, r, 'hausse_prix',
    format('Hausse du prix de %s : %s FCFA / %s%s (+%s %% par rapport aux derniers achats, %s FCFA)',
           v_nom, round(v_prix), v_unite, coalesce(' chez ' || v_four, ''), v_hausse, round(v_moyenne)), '/stock')
  from unnest(array['directeur', 'exploitation', 'finance']::public.role_utilisateur[]) r;
  return null;
end;
$$;
drop trigger if exists alerte_hausse_prix on public.depenses;
create trigger alerte_hausse_prix after insert on public.depenses
  for each row execute function public.alerte_hausse_prix();

revoke all on public.prix_achats from anon;
revoke execute on function public.alerte_hausse_prix() from public, anon, authenticated;
