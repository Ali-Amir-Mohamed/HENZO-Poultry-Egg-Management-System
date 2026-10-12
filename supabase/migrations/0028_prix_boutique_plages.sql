-- =====================================================================
-- HENZO – Boutiques : prix entré par celui qui vend (Kenfack ou le vendeur)
--   * à la pièce (poulet, poule réformée) et pour les œufs : prix libre
--     mais obligatoirement dans une plage (minimum – maximum) fixée par
--     la direction, l'exploitation ou les finances ;
--   * au kilo : celui qui vend tape le prix du kilo sur place.
--   * plage de départ : poulet entier (vivant, abattu, découpé) 3 500 – 5 000 F.
-- À exécuter une fois dans Supabase > SQL Editor, après 0027.
-- =====================================================================

alter table public.prix_boutique alter column prix drop not null;
alter table public.prix_boutique add column prix_min numeric(14, 0) check (prix_min > 0);
alter table public.prix_boutique add column prix_max numeric(14, 0);
alter table public.prix_boutique add constraint prix_boutique_plage check (
  (prix_min is null and prix_max is null and prix is not null)
  or (prix_min is not null and prix_max is not null and prix_min <= prix_max and unite <> 'kg'));

create or replace view public.prix_boutique_actuels with (security_invoker = true) as
select distinct on (ferme_id, produit, forme, unite) ferme_id, produit, forme, unite, prix, date_debut, prix_min, prix_max
from public.prix_boutique
where date_debut <= current_date
order by ferme_id, produit, forme, unite, date_debut desc, created_at desc;

-- Plage de départ du poulet entier : 3 500 – 5 000 F (vivant, abattu, découpé)
insert into public.prix_boutique (ferme_id, produit, forme, unite, prix_min, prix_max, saisi_par)
select f.id, 'poulet', fo, 'piece', 3500, 5000, d.id
from public.fermes f
cross join unnest(array['vivant', 'abattu', 'decoupe']) fo
join lateral (select p.id from public.profiles p where p.ferme_id = f.id and p.role = 'directeur' order by p.created_at limit 1) d on true;

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
  if not public.acces_boutique(new.boutique_id, array['directeur', 'exploitation']) then
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
