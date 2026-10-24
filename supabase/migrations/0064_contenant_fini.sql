-- =====================================================================
-- HENZO – « Fini » : un sac, un bidon ou un flacon vide, en un clic
--   * Chaque produit retient la taille de son contenant (1 sac, 5 litres
--     pour un bidon, 1 litre pour un flacon…), dans son unité.
--   * Quand un contenant est vide, Kenfack appuie sur « Fini » : HENZO
--     retire ce contenant du stock de la bande et le répartit sur les jours
--     depuis le dernier contenant fini (même calcul que le comptage).
--   * La première fois, il indique ce que contenait le contenant : HENZO
--     s'en souvient pour les fois suivantes.
-- À exécuter dans Supabase > SQL Editor, après 0063 (peut être relancée sans erreur).
-- =====================================================================

alter table public.articles add column if not exists contenance numeric(12, 3);
alter table public.articles drop constraint if exists articles_contenance_check;
alter table public.articles add constraint articles_contenance_check check (contenance is null or contenance > 0);

create or replace view public.stock_bandes with (security_invoker = true) as
select af.bande_id, b.code, b.statut, af.article_id, a.nom, a.categorie, a.unite, a.mesure, a.mesure_par_unite,
       af.recu, coalesce(s.consomme, 0) as consomme, af.recu - coalesce(s.consomme, 0) as reste,
       (select max(c.date_comptage) from public.comptages_stock_bande c where c.bande_id = af.bande_id and c.article_id = af.article_id) as dernier_comptage,
       a.contenance
from (select bande_id, article_id, sum(quantite) as recu from public.affectations_stock group by bande_id, article_id) af
join public.bandes b on b.id = af.bande_id
join public.articles a on a.id = af.article_id
left join (select bande_id, article_id, sum(quantite) as consomme from public.mouvements_stock
           where type_mouvement = 'sortie' and bande_id is not null group by bande_id, article_id) s
  on s.bande_id = af.bande_id and s.article_id = af.article_id;
grant select on public.stock_bandes to authenticated;

-- A container is empty. p_quantite: what it held (only needed the first time, then remembered)
create or replace function public.finir_contenant(p_bande uuid, p_article uuid, p_quantite numeric default null, p_nombre integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bandes := public.controle_bande_stock(p_bande);
  a record;
  v_q numeric;
  v_stock numeric;
begin
  select nom, unite, contenance into a from public.articles where id = p_article and ferme_id = b.ferme_id;
  if a.nom is null then raise exception 'Article introuvable'; end if;
  if p_quantite is not null then
    if p_quantite <= 0 then raise exception 'Indiquez ce que contenait le sac ou le bidon'; end if;
    update public.articles set contenance = round(p_quantite, 3) where id = p_article;
    a.contenance := round(p_quantite, 3);
  end if;
  if a.contenance is null then raise exception 'Indiquez une première fois ce que contient un contenant de %', a.nom; end if;
  v_q := a.contenance * greatest(coalesce(p_nombre, 1), 1);
  v_stock := public.stock_bande(b.id, p_article);
  if v_q > v_stock then
    raise exception 'Il ne reste que % % de % dans le stock de % : mettez d''abord le nouvel achat dans le stock de la bande',
      trim_scale(v_stock), a.unite, a.nom, b.code;
  end if;
  return public.compter_stock_bande(b.id, jsonb_build_array(jsonb_build_object('article_id', p_article, 'reste', v_stock - v_q)), current_date);
end;
$$;

revoke execute on function public.finir_contenant(uuid, uuid, numeric, integer) from public, anon;
grant execute on function public.finir_contenant(uuid, uuid, numeric, integer) to authenticated;
