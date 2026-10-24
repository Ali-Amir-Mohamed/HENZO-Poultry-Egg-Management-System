-- =====================================================================
-- HENZO – Stock par bande (aliment et médicaments)
--   * Kenfack met des sacs ou des flacons du stock général dans le stock
--     d'une bande : ils lui sont réservés.
--   * Il compte de temps en temps ce qui reste dans le stock de la bande :
--     HENZO en déduit ce qu'elle a consommé depuis le dernier comptage et le
--     répartit sur les jours (l'aliment suit la croissance des poulets et
--     l'effectif vivant ; un médicament est réparti à parts égales).
--   * Ce qui reste à la fin d'une bande passe dans le stock d'une autre bande
--     ou revient au stock général.
--   * La saisie quotidienne (Saisie > Aliment utilisé) reste possible : elle
--     diminue aussi le stock de la bande.
-- À exécuter dans Supabase > SQL Editor, après 0061 (peut être relancée sans erreur).
-- =====================================================================

create table if not exists public.affectations_stock (
  id                uuid primary key default gen_random_uuid(),
  ferme_id          uuid not null default public.ferme_actuelle() references public.fermes (id),
  bande_id          uuid not null references public.bandes (id),
  article_id        uuid not null references public.articles (id),
  quantite          numeric(14, 3) not null check (quantite <> 0),  -- + put in the flock's stock, − taken out of it
  date_affectation  date not null default current_date,
  transfert_id      uuid,                                            -- pairs the two lines of a move between flocks
  saisi_par         uuid not null default auth.uid() references public.profiles (id),
  created_at        timestamptz not null default now()
);
create index if not exists affectations_stock_bande on public.affectations_stock (bande_id, article_id);

create table if not exists public.comptages_stock_bande (
  id             uuid primary key default gen_random_uuid(),
  ferme_id       uuid not null default public.ferme_actuelle() references public.fermes (id),
  bande_id       uuid not null references public.bandes (id),
  article_id     uuid not null references public.articles (id),
  date_comptage  date not null,
  reste          numeric(14, 3) not null check (reste >= 0),
  consomme       numeric(14, 3) not null check (consomme >= 0),
  saisi_par      uuid not null default auth.uid() references public.profiles (id),
  created_at     timestamptz not null default now()
);
create index if not exists comptages_stock_bande_idx on public.comptages_stock_bande (bande_id, article_id, date_comptage);

alter table public.mouvements_stock add column if not exists comptage_id uuid references public.comptages_stock_bande (id);

alter table public.affectations_stock enable row level security;
alter table public.comptages_stock_bande enable row level security;
drop policy if exists affectations_stock_select on public.affectations_stock;
create policy affectations_stock_select on public.affectations_stock for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));
drop policy if exists comptages_stock_bande_select on public.comptages_stock_bande;
create policy comptages_stock_bande_select on public.comptages_stock_bande for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));
-- written only through the functions below
revoke insert, update, delete on public.affectations_stock, public.comptages_stock_bande from anon, authenticated;

drop trigger if exists journal on public.affectations_stock;
create trigger journal after insert or update or delete on public.affectations_stock for each row execute function public.journaliser();
drop trigger if exists journal on public.comptages_stock_bande;
create trigger journal after insert or update or delete on public.comptages_stock_bande for each row execute function public.journaliser();

-- What is left in a flock's stock: put in − taken out − consumed by the flock
create or replace function public.stock_bande(p_bande uuid, p_article uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select sum(quantite) from public.affectations_stock where bande_id = p_bande and article_id = p_article), 0)
       - coalesce((select sum(quantite) from public.mouvements_stock where bande_id = p_bande and article_id = p_article and type_mouvement = 'sortie'), 0)
$$;

-- General stock = everything on the farm − what sits in the flocks' stocks
create or replace function public.stock_general(p_article uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select public.stock_article(p_article)
       - coalesce((select sum(greatest(public.stock_bande(x.bande_id, p_article), 0))
                   from (select distinct bande_id from public.affectations_stock where article_id = p_article) x), 0)
$$;

create or replace view public.stock_bandes with (security_invoker = true) as
select af.bande_id, b.code, b.statut, af.article_id, a.nom, a.categorie, a.unite, a.mesure, a.mesure_par_unite,
       af.recu, coalesce(s.consomme, 0) as consomme, af.recu - coalesce(s.consomme, 0) as reste,
       (select max(c.date_comptage) from public.comptages_stock_bande c where c.bande_id = af.bande_id and c.article_id = af.article_id) as dernier_comptage
from (select bande_id, article_id, sum(quantite) as recu from public.affectations_stock group by bande_id, article_id) af
join public.bandes b on b.id = af.bande_id
join public.articles a on a.id = af.article_id
left join (select bande_id, article_id, sum(quantite) as consomme from public.mouvements_stock
           where type_mouvement = 'sortie' and bande_id is not null group by bande_id, article_id) s
  on s.bande_id = af.bande_id and s.article_id = af.article_id;
grant select on public.stock_bandes to authenticated;

create or replace function public.controle_bande_stock(p_bande uuid)
returns public.bandes
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.bandes;
begin
  if not public.a_role('directeur', 'exploitation') then
    raise exception 'Réservé à l''exploitation et au directeur';
  end if;
  select * into b from public.bandes where id = p_bande and ferme_id = public.ferme_actuelle();
  if b.id is null then raise exception 'Bande introuvable'; end if;
  return b;
end;
$$;

-- Put goods from the general stock into a flock's stock. p_lignes: [{ "article_id": "…", "quantite": 20 }, …]
create or replace function public.mettre_en_stock_bande(p_bande uuid, p_lignes jsonb, p_date date default current_date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bandes := public.controle_bande_stock(p_bande);
  l record;
  a record;
begin
  if b.statut = 'cloturee' then raise exception 'La bande % est clôturée', b.code; end if;
  for l in select (x->>'article_id')::uuid as article_id, (x->>'quantite')::numeric as quantite from jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb)) x loop
    if coalesce(l.quantite, 0) <= 0 then continue; end if;
    select nom, unite into a from public.articles where id = l.article_id and ferme_id = b.ferme_id;
    if a.nom is null then raise exception 'Article introuvable'; end if;
    if l.quantite > public.stock_general(l.article_id) then
      raise exception 'Stock général insuffisant : il reste % % de %', trim_scale(public.stock_general(l.article_id)), a.unite, a.nom;
    end if;
    insert into public.affectations_stock (ferme_id, bande_id, article_id, quantite, date_affectation)
    values (b.ferme_id, b.id, l.article_id, round(l.quantite, 3), coalesce(p_date, current_date));
  end loop;
end;
$$;

-- Move what is left in a flock's stock to another flock, or back to the general stock (p_vers null)
create or replace function public.deplacer_stock_bande(p_de uuid, p_vers uuid, p_article uuid, p_quantite numeric, p_date date default current_date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bandes := public.controle_bande_stock(p_de);
  v public.bandes;
  t uuid := gen_random_uuid();
begin
  if coalesce(p_quantite, 0) <= 0 then raise exception 'Quantité à déplacer manquante'; end if;
  if p_quantite > public.stock_bande(p_de, p_article) then
    raise exception 'Il ne reste que % dans le stock de %', trim_scale(public.stock_bande(p_de, p_article)), b.code;
  end if;
  if p_vers is not null then
    v := public.controle_bande_stock(p_vers);
    if v.statut = 'cloturee' then raise exception 'La bande % est clôturée', v.code; end if;
    if v.id = b.id then raise exception 'Choisissez une autre bande'; end if;
  end if;
  insert into public.affectations_stock (ferme_id, bande_id, article_id, quantite, date_affectation, transfert_id)
  values (b.ferme_id, b.id, p_article, -round(p_quantite, 3), coalesce(p_date, current_date), t);
  if p_vers is not null then
    insert into public.affectations_stock (ferme_id, bande_id, article_id, quantite, date_affectation, transfert_id)
    values (v.ferme_id, v.id, p_article, round(p_quantite, 3), coalesce(p_date, current_date), t);
  end if;
end;
$$;

-- Count what is left in a flock's stock. What disappeared since the last count was eaten (or given) by the
-- flock: it is spread over the days, following the birds' growth and the live count for feed, in equal
-- parts for anything else. p_lignes: [{ "article_id": "…", "reste": 4 }, …]
create or replace function public.compter_stock_bande(p_bande uuid, p_lignes jsonb, p_date date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bandes := public.controle_bande_stock(p_bande);
  v_date date := coalesce(p_date, current_date);
  l record;
  a record;
  v_stock numeric; v_conso numeric; v_debut date; v_jours int;
  v_comptage uuid;
  v_total_poids numeric; v_reparti numeric; v_q numeric;
  d record;
  v_out jsonb := '[]'::jsonb;
begin
  if b.statut = 'cloturee' then raise exception 'La bande % est clôturée', b.code; end if;
  if v_date > current_date then raise exception 'La date du comptage ne peut pas être dans le futur'; end if;
  for l in select (x->>'article_id')::uuid as article_id, (x->>'reste')::numeric as reste from jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb)) x loop
    if l.reste is null then continue; end if;
    if l.reste < 0 then raise exception 'Le reste ne peut pas être négatif'; end if;
    select nom, unite, categorie into a from public.articles where id = l.article_id and ferme_id = b.ferme_id;
    if a.nom is null then raise exception 'Article introuvable'; end if;
    v_stock := public.stock_bande(b.id, l.article_id);
    if round(l.reste, 3) > v_stock then
      raise exception 'Il reste % % de % dans le stock de % d''après HENZO : mettez d''abord le complément dans le stock de la bande',
        trim_scale(v_stock), a.unite, a.nom, b.code;
    end if;
    -- the period: the day after the last count (or the first day goods were put in the flock's stock) up to the count
    select max(date_comptage) + 1 into v_debut from public.comptages_stock_bande where bande_id = b.id and article_id = l.article_id;
    if v_debut is not null and v_debut > v_date + 1 then raise exception 'Un comptage plus récent existe déjà pour %', a.nom; end if;
    if v_debut is null then
      select min(date_affectation) into v_debut from public.affectations_stock where bande_id = b.id and article_id = l.article_id;
    end if;
    v_debut := least(greatest(coalesce(v_debut, b.date_arrivee), b.date_arrivee), v_date);
    v_conso := v_stock - round(l.reste, 3);

    insert into public.comptages_stock_bande (ferme_id, bande_id, article_id, date_comptage, reste, consomme)
    values (b.ferme_id, b.id, l.article_id, v_date, round(l.reste, 3), v_conso) returning id into v_comptage;

    if v_conso > 0 then
      v_jours := v_date - v_debut + 1;
      -- weight of each day: feed follows growth (about 4.3 g more per bird each day) × birds alive; the rest is even
      create temp table if not exists jours_conso (jour date, poids numeric) on commit drop;
      truncate jours_conso;
      insert into jours_conso
      select g::date,
             case when a.categorie = 'aliment' then
               (4.3 * greatest((g::date - b.date_arrivee), 0) + 10)
               * greatest(b.nombre_initial - coalesce((select sum(m.nombre) from public.mortalites m where m.bande_id = b.id and m.date_constat <= g::date), 0), 1)
             else 1 end
      from generate_series(v_debut, v_date, interval '1 day') g;
      select sum(poids) into v_total_poids from jours_conso;
      -- too small to spread (under 0.001 per day): everything on the day of the count
      if v_conso < 0.001 * v_jours then
        update jours_conso set poids = case when jour = v_date then 1 else 0 end;
        v_total_poids := 1;
      end if;
      v_reparti := 0;
      for d in select jour, poids from jours_conso where poids > 0 order by jour loop
        v_q := case when d.jour = v_date then v_conso - v_reparti else round(v_conso * d.poids / v_total_poids, 3) end;
        if v_q > 0 then
          insert into public.mouvements_stock (ferme_id, article_id, date_mouvement, type_mouvement, quantite, bande_id, comptage_id, notes, saisi_par)
          values (b.ferme_id, l.article_id, d.jour, 'sortie', v_q, b.id, v_comptage, 'Comptage du stock de la bande', auth.uid());
          v_reparti := v_reparti + v_q;
        end if;
      end loop;
    end if;
    v_out := v_out || jsonb_build_object('article_id', l.article_id, 'nom', a.nom, 'unite', a.unite, 'consomme', v_conso,
                                         'du', v_debut, 'au', v_date, 'par_jour', round(v_conso / (v_date - v_debut + 1), 3));
  end loop;
  return v_out;
end;
$$;

revoke execute on function public.stock_bande(uuid, uuid), public.stock_general(uuid), public.controle_bande_stock(uuid),
  public.mettre_en_stock_bande(uuid, jsonb, date), public.deplacer_stock_bande(uuid, uuid, uuid, numeric, date),
  public.compter_stock_bande(uuid, jsonb, date) from public, anon;
grant execute on function public.stock_bande(uuid, uuid), public.stock_general(uuid),
  public.mettre_en_stock_bande(uuid, jsonb, date), public.deplacer_stock_bande(uuid, uuid, uuid, numeric, date),
  public.compter_stock_bande(uuid, jsonb, date) to authenticated;
