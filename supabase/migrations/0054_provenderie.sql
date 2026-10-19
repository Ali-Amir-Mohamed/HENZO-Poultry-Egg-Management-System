-- =====================================================================
-- HENZO AGRO – Provenderie (fabrication d'aliment)
--   * Matières premières (maïs, soja, tourteaux, son, prémix…) et sacs
--     vides : de nouveaux articles du stock, achetés comme les autres.
--   * Formules pour 1 tonne : quantité de chaque matière (kg), le sac
--     vide utilisé, les frais de fabrication par tonne (électricité,
--     carburant, main-d'œuvre). L'aliment produit est un article du stock
--     avec son poids de sac (25 kg, 50 kg…).
--   * Fabrication : on indique combien de kg on fabrique et combien de
--     sacs on a obtenus ; les matières et les sacs vides sortent du stock,
--     les sacs d'aliment y entrent ; le prix de revient de chaque sac est
--     calculé (matières + sac vide + frais).
--   * Les bénéfices comptent les matières et les sacs vides dans le prix
--     d'achat de l'aliment vendu ; l'électricité et la main-d'œuvre
--     réelles sont déjà dans les charges (pas comptées deux fois).
-- À exécuter une fois dans Supabase > SQL Editor, après 0053.
-- =====================================================================

alter table public.articles drop constraint articles_categorie_check;
alter table public.articles add constraint articles_categorie_check
  check (categorie in ('aliment', 'medicament', 'poussins', 'autre', 'matiere_premiere', 'emballage'));

create table public.formules_aliment (
  id               uuid primary key default gen_random_uuid(),
  ferme_id         uuid not null default public.ferme_actuelle() references public.fermes (id),
  nom              text not null check (trim(nom) <> ''),
  article_id       uuid not null references public.articles (id),        -- feed produced (bags)
  article_sac_id   uuid references public.articles (id),                 -- empty bag used, one per bag made
  frais_par_tonne  numeric(14, 0) not null default 0 check (frais_par_tonne >= 0),
  actif            boolean not null default true,
  notes            text,
  saisi_par        uuid not null default auth.uid() references public.profiles (id),
  created_at       timestamptz not null default now()
);
create table public.formules_lignes (
  id           uuid primary key default gen_random_uuid(),
  formule_id   uuid not null references public.formules_aliment (id) on delete cascade,
  ferme_id     uuid not null references public.fermes (id),
  article_id   uuid not null references public.articles (id),            -- raw material (kg)
  quantite_kg  numeric(10, 2) not null check (quantite_kg > 0),           -- for 1 tonne of feed
  unique (formule_id, article_id)
);
create table public.fabrications (
  id                uuid primary key default gen_random_uuid(),
  ferme_id          uuid not null references public.fermes (id),
  formule_id        uuid not null references public.formules_aliment (id),
  date_fabrication  date not null default current_date,
  quantite_kg       numeric(12, 2) not null check (quantite_kg > 0),
  sacs_obtenus      integer not null check (sacs_obtenus > 0),
  cout_matieres     numeric(16, 0) not null,
  cout_sacs         numeric(16, 0) not null,
  cout_frais        numeric(16, 0) not null,
  prix_revient_sac  numeric(14, 0) not null,
  cout_incomplet    boolean not null default false,                       -- a raw material had no purchase price
  annulee           boolean not null default false,
  motif_annulation  text,
  notes             text,
  saisi_par         uuid not null default auth.uid() references public.profiles (id),
  created_at        timestamptz not null default now()
);
create index on public.fabrications (ferme_id, date_fabrication desc);
alter table public.mouvements_stock add column fabrication_id uuid references public.fabrications (id);
create trigger journal after insert or update on public.formules_aliment for each row execute function public.journaliser();
create trigger journal after insert or update on public.fabrications for each row execute function public.journaliser();

-- Stock of an article right now
create function public.stock_article(p_article uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case type_mouvement when 'sortie' then -quantite else quantite end), 0) from public.mouvements_stock where article_id = p_article
$$;

-- ---------------------------------------------------------------------
-- Formules
-- p_lignes : [{ "article_id": "…", "quantite_kg": 600 }, …] pour 1 tonne
-- ---------------------------------------------------------------------
create function public.creer_formule(p_nom text, p_article uuid, p_article_sac uuid, p_frais_par_tonne numeric, p_lignes jsonb, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  l jsonb;
begin
  if not public.a_role('exploitation', 'directeur') then raise exception 'Seuls l''exploitation et le directeur créent les formules'; end if;
  if (select type_activite from public.fermes where id = public.ferme_actuelle()) <> 'negoce' then raise exception 'La provenderie est dans HENZO AGRO'; end if;
  if not exists (select 1 from public.articles where id = p_article and ferme_id = public.ferme_actuelle() and categorie = 'aliment' and unite = 'sac' and coalesce(poids_unitaire_kg, 0) > 0) then
    raise exception 'Choisissez l''aliment produit : un article « aliment » vendu au sac, avec le poids du sac';
  end if;
  if p_article_sac is not null and not exists (select 1 from public.articles where id = p_article_sac and ferme_id = public.ferme_actuelle() and categorie = 'emballage') then
    raise exception 'Le sac vide doit être un article « emballage »';
  end if;
  if jsonb_array_length(coalesce(p_lignes, '[]'::jsonb)) = 0 then raise exception 'Ajoutez les matières premières'; end if;
  insert into public.formules_aliment (ferme_id, nom, article_id, article_sac_id, frais_par_tonne, notes)
  values (public.ferme_actuelle(), trim(p_nom), p_article, p_article_sac, round(coalesce(p_frais_par_tonne, 0)), nullif(trim(coalesce(p_notes, '')), ''))
  returning id into v_id;
  for l in select * from jsonb_array_elements(p_lignes) loop
    if not exists (select 1 from public.articles where id = (l ->> 'article_id')::uuid and ferme_id = public.ferme_actuelle() and categorie = 'matiere_premiere' and unite = 'kg') then
      raise exception 'Chaque ligne doit être une matière première comptée en kg';
    end if;
    if coalesce((l ->> 'quantite_kg')::numeric, 0) <= 0 then raise exception 'Indiquez les kg de chaque matière'; end if;
    insert into public.formules_lignes (formule_id, ferme_id, article_id, quantite_kg)
    values (v_id, public.ferme_actuelle(), (l ->> 'article_id')::uuid, (l ->> 'quantite_kg')::numeric);
  end loop;
  return v_id;
end;
$$;

create function public.desactiver_formule(p_formule uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.a_role('exploitation', 'directeur') then raise exception 'Seuls l''exploitation et le directeur gèrent les formules'; end if;
  update public.formules_aliment set actif = false where id = p_formule and ferme_id = public.ferme_actuelle();
  if not found then raise exception 'Formule introuvable'; end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Fabrication
-- ---------------------------------------------------------------------
create function public.fabriquer(p_formule uuid, p_quantite_kg numeric, p_sacs integer, p_date date default current_date, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.formules_aliment;
  l record;
  v_id uuid := gen_random_uuid();
  v_besoin numeric;
  v_cout_unit numeric;
  v_matieres numeric := 0;
  v_sacs_cout numeric := 0;
  v_frais numeric;
  v_incomplet boolean := false;
  v_nom text;
begin
  if not public.a_role('exploitation', 'employe') then raise exception 'Seuls l''exploitation et les employés enregistrent les fabrications'; end if;
  select * into f from public.formules_aliment where id = p_formule and ferme_id = public.ferme_actuelle() and actif;
  if f.id is null then raise exception 'Formule introuvable'; end if;
  if coalesce(p_quantite_kg, 0) <= 0 then raise exception 'Indiquez combien de kg vous fabriquez'; end if;
  if coalesce(p_sacs, 0) <= 0 then raise exception 'Indiquez le nombre de sacs obtenus'; end if;

  -- enough of every raw material and empty bags
  for l in select fl.article_id, fl.quantite_kg, a.nom from public.formules_lignes fl join public.articles a on a.id = fl.article_id where fl.formule_id = f.id loop
    v_besoin := round(l.quantite_kg * p_quantite_kg / 1000, 2);
    if public.stock_article(l.article_id) < v_besoin then
      raise exception 'Pas assez de % : il faut % kg, il en reste % kg', l.nom, v_besoin, public.stock_article(l.article_id);
    end if;
  end loop;
  if f.article_sac_id is not null and public.stock_article(f.article_sac_id) < p_sacs then
    select nom into v_nom from public.articles where id = f.article_sac_id;
    raise exception 'Pas assez de % : il en faut %, il en reste %', v_nom, p_sacs, public.stock_article(f.article_sac_id);
  end if;

  v_frais := round(f.frais_par_tonne * p_quantite_kg / 1000);
  insert into public.fabrications (id, ferme_id, formule_id, date_fabrication, quantite_kg, sacs_obtenus, cout_matieres, cout_sacs, cout_frais, prix_revient_sac, notes)
  values (v_id, f.ferme_id, f.id, coalesce(p_date, current_date), p_quantite_kg, p_sacs, 0, 0, v_frais, 0, nullif(trim(coalesce(p_notes, '')), ''));

  -- raw materials and empty bags leave the stock, at their average purchase price
  for l in select fl.article_id, fl.quantite_kg from public.formules_lignes fl where fl.formule_id = f.id loop
    v_besoin := round(l.quantite_kg * p_quantite_kg / 1000, 2);
    select cout_unitaire_moyen into v_cout_unit from public.cout_moyen_articles where article_id = l.article_id;
    if v_cout_unit is null then v_incomplet := true; end if;
    v_matieres := v_matieres + v_besoin * coalesce(v_cout_unit, 0);
    insert into public.mouvements_stock (ferme_id, article_id, date_mouvement, type_mouvement, quantite, fabrication_id, notes)
    values (f.ferme_id, l.article_id, coalesce(p_date, current_date), 'sortie', v_besoin, v_id, 'Fabrication ' || f.nom);
  end loop;
  if f.article_sac_id is not null then
    select cout_unitaire_moyen into v_cout_unit from public.cout_moyen_articles where article_id = f.article_sac_id;
    if v_cout_unit is null then v_incomplet := true; end if;
    v_sacs_cout := p_sacs * coalesce(v_cout_unit, 0);
    insert into public.mouvements_stock (ferme_id, article_id, date_mouvement, type_mouvement, quantite, fabrication_id, notes)
    values (f.ferme_id, f.article_sac_id, coalesce(p_date, current_date), 'sortie', p_sacs, v_id, 'Fabrication ' || f.nom);
  end if;

  -- the bags of feed enter the stock; their stock cost = raw materials + empty bags (running costs are already in the charges)
  insert into public.mouvements_stock (ferme_id, article_id, date_mouvement, type_mouvement, quantite, cout_unitaire, fabrication_id, notes)
  values (f.ferme_id, f.article_id, coalesce(p_date, current_date), 'entree', p_sacs, round((v_matieres + v_sacs_cout) / p_sacs, 2), v_id, 'Fabrication ' || f.nom);

  update public.fabrications set cout_matieres = round(v_matieres), cout_sacs = round(v_sacs_cout),
    prix_revient_sac = round((v_matieres + v_sacs_cout + v_frais) / p_sacs), cout_incomplet = v_incomplet
  where id = v_id;
  return v_id;
end;
$$;

-- Cancel a production: the raw materials and empty bags come back, the bags of feed leave (if they are still in stock)
create function public.annuler_fabrication(p_fabrication uuid, p_motif text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  fb public.fabrications;
  f public.formules_aliment;
  m record;
begin
  if not public.a_role('exploitation', 'directeur') then raise exception 'Seuls l''exploitation et le directeur annulent une fabrication'; end if;
  if coalesce(trim(p_motif), '') = '' then raise exception 'Indiquez le motif'; end if;
  select * into fb from public.fabrications where id = p_fabrication and ferme_id = public.ferme_actuelle() for update;
  if fb.id is null or fb.annulee then raise exception 'Fabrication introuvable ou déjà annulée'; end if;
  select * into f from public.formules_aliment where id = fb.formule_id;
  if public.stock_article(f.article_id) < fb.sacs_obtenus then
    raise exception 'Une partie de ces sacs est déjà vendue : impossible d''annuler (il reste % sacs)', public.stock_article(f.article_id);
  end if;
  for m in select * from public.mouvements_stock where fabrication_id = fb.id loop
    insert into public.mouvements_stock (ferme_id, article_id, type_mouvement, quantite, fabrication_id, notes)
    values (m.ferme_id, m.article_id, 'ajustement', case m.type_mouvement when 'sortie' then m.quantite else -m.quantite end, fb.id, 'Annulation fabrication : ' || trim(p_motif));
  end loop;
  update public.fabrications set annulee = true, motif_annulation = trim(p_motif) where id = fb.id;
end;
$$;

-- The cost of the feed made counts only while its production is not cancelled
create or replace view public.cout_moyen_articles as
select m.article_id,
       sum(m.quantite * m.cout_unitaire) / nullif(sum(m.quantite), 0) as cout_unitaire_moyen
from public.mouvements_stock m
left join public.depenses d on d.id = m.depense_id
left join public.fabrications fb on fb.id = m.fabrication_id
where m.type_mouvement = 'entree' and m.cout_unitaire is not null
  and (d.id is null or (not d.annulee and d.statut <> 'rejetee'))
  and (fb.id is null or not fb.annulee)
group by m.article_id;

alter table public.formules_aliment enable row level security;
alter table public.formules_lignes enable row level security;
alter table public.fabrications enable row level security;
create policy formules_select on public.formules_aliment for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance', 'employe', 'comptable'));
create policy formules_lignes_select on public.formules_lignes for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance', 'employe', 'comptable'));
create policy fabrications_select on public.fabrications for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance', 'employe', 'comptable'));

revoke all on public.formules_aliment, public.formules_lignes, public.fabrications from anon;
revoke execute on function public.stock_article(uuid) from public, anon;
grant execute on function public.stock_article(uuid) to authenticated;
revoke execute on function public.creer_formule(text, uuid, uuid, numeric, jsonb, text), public.desactiver_formule(uuid),
                          public.fabriquer(uuid, numeric, integer, date, text), public.annuler_fabrication(uuid, text) from public, anon;
grant execute on function public.creer_formule(text, uuid, uuid, numeric, jsonb, text), public.desactiver_formule(uuid),
                          public.fabriquer(uuid, numeric, integer, date, text), public.annuler_fabrication(uuid, text) to authenticated;
