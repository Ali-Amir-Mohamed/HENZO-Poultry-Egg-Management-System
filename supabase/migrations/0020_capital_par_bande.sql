-- =====================================================================
-- HENZO – Capital des investisseurs réparti par bande
-- Pour chaque bande de chair, le directeur, la finance ou l'exploitation indique combien
-- du capital de chaque investisseur est placé dedans (100/0, 50/50, …).
--   * à la clôture validée : 10 % (taux de la ferme) du montant placé dans
--     cette bande, fixes, même si la bande perd ;
--   * le capital placé dans aucune bande ne rapporte rien ;
--   * une répartition enregistrée est bloquée : seul le directeur peut
--     l'annuler (avec motif), tant que la bande n'est pas clôturée ;
--   * on ne peut pas placer plus que le capital libre de l'investisseur
--     (capital − ce qui est déjà placé dans les bandes en cours).
-- À exécuter une fois dans Supabase > SQL Editor, après 0019.
-- =====================================================================

create table public.capital_bandes (
  id                uuid primary key default gen_random_uuid(),
  ferme_id          uuid not null default public.ferme_actuelle() references public.fermes (id),
  bande_id          uuid not null references public.bandes (id),
  investisseur_id   uuid not null references public.investisseurs (id),
  montant           numeric(16, 0) not null check (montant > 0),
  annulee           boolean not null default false,
  annulee_par       uuid references public.profiles (id),
  annulee_le        timestamptz,
  motif_annulation  text,
  saisi_par         uuid not null default auth.uid() references public.profiles (id),
  created_at        timestamptz not null default now()
);
create unique index capital_bandes_unique on public.capital_bandes (bande_id, investisseur_id) where not annulee;
create index on public.capital_bandes (investisseur_id);
create trigger journal after insert or update on public.capital_bandes
  for each row execute function public.journaliser();

alter table public.capital_bandes enable row level security;
create policy capital_bandes_select on public.capital_bandes for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance', 'exploitation'));
create policy capital_bandes_insert on public.capital_bandes for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and saisi_par = auth.uid() and public.a_role('directeur', 'finance', 'exploitation'));
create policy capital_bandes_update on public.capital_bandes for update to authenticated   -- annulation (trigger)
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur'));

-- Capital placé dans les bandes en cours (pas encore clôturées)
create function public.capital_place(p_investisseur uuid, p_sauf uuid default null)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(c.montant), 0)
  from public.capital_bandes c join public.bandes b on b.id = c.bande_id
  where c.investisseur_id = p_investisseur and not c.annulee and b.statut <> 'cloturee'
    and (p_sauf is null or c.id <> p_sauf)
$$;

-- Nouvelle répartition : bande de chair en cours, investisseur de la ferme, capital libre suffisant
create function public.controle_capital_bande()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bandes;
  v_libre numeric;
begin
  if tg_op = 'DELETE' then raise exception 'Une répartition ne se supprime pas : le directeur peut l''annuler'; end if;
  select * into b from public.bandes where id = new.bande_id;

  if tg_op = 'INSERT' then
    if b.id is null or b.ferme_id <> new.ferme_id then raise exception 'Bande introuvable'; end if;
    if b.statut = 'cloturee' then raise exception 'La bande % est clôturée : on ne peut plus y placer de capital', b.code; end if;
    if not exists (select 1 from public.investisseurs where id = new.investisseur_id and ferme_id = new.ferme_id) then
      raise exception 'Investisseur introuvable';
    end if;
    v_libre := public.capital_restant(new.investisseur_id) - public.capital_place(new.investisseur_id);
    if new.montant > v_libre then
      raise exception 'Capital libre insuffisant : % FCFA disponibles pour cet investisseur', greatest(v_libre, 0);
    end if;
    new.annulee := false; new.annulee_par := null; new.annulee_le := null; new.motif_annulation := null;
    return new;
  end if;

  -- UPDATE : seulement l'annulation par le directeur, avec motif, bande non clôturée
  if old.annulee or not new.annulee or coalesce(trim(new.motif_annulation), '') = ''
     or (to_jsonb(new) - array['annulee', 'annulee_par', 'annulee_le', 'motif_annulation'])
        is distinct from (to_jsonb(old) - array['annulee', 'annulee_par', 'annulee_le', 'motif_annulation']) then
    raise exception 'Une répartition est bloquée : seul le directeur peut l''annuler, avec un motif';
  end if;
  if auth.uid() is not null and not public.a_role('directeur') then
    raise exception 'Seul le directeur peut annuler une répartition';
  end if;
  if b.statut = 'cloturee' then raise exception 'La bande est clôturée : la répartition ne peut plus être annulée'; end if;
  new.annulee_par := auth.uid();
  new.annulee_le := now();
  return new;
end;
$$;
create trigger controle_capital_bande before insert or update or delete on public.capital_bandes
  for each row execute function public.controle_capital_bande();

-- Un retrait de capital ne peut pas toucher le capital placé dans les bandes en cours
create function public.controle_retrait_capital()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_libre numeric;
begin
  if new.type_operation = 'retrait_capital' then
    v_libre := public.capital_restant(new.investisseur_id) - public.capital_place(new.investisseur_id);
    if new.montant > v_libre then
      raise exception 'Retrait impossible : % FCFA sont libres (le reste est placé dans des bandes en cours)', greatest(v_libre, 0);
    end if;
  end if;
  return new;
end;
$$;
create trigger controle_retrait_capital before insert on public.operations_investisseurs
  for each row execute function public.controle_retrait_capital();

-- Clôture validée : 10 % du capital placé dans CETTE bande, pour chaque investisseur
create or replace function public.creer_distributions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_taux numeric := (select taux_investisseurs from public.fermes where id = new.ferme_id);
  v_total numeric;
begin
  insert into public.distributions_investisseurs (ferme_id, investisseur_id, bande_id, capital_base, taux, montant)
  select new.ferme_id, c.investisseur_id, new.id, c.montant, v_taux, round(c.montant * v_taux / 100)
  from public.capital_bandes c
  where c.bande_id = new.id and not c.annulee;

  select sum(montant) into v_total from public.distributions_investisseurs where bande_id = new.id;
  if v_total > 0 then
    perform public.notifier(new.ferme_id, r, 'distribution',
      format('Clôture de %s : %s FCFA à verser ou réinvestir pour les investisseurs', new.code, v_total), '/argent')
    from unnest(array['finance', 'directeur']::public.role_utilisateur[]) r;
  end if;
  return null;
end;
$$;

-- Nouvelle bande de chair : rappeler de répartir le capital s'il y a du capital libre
create function public.rappel_capital_bande()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_libre numeric;
begin
  select coalesce(sum(greatest(public.capital_restant(i.id) - public.capital_place(i.id), 0)), 0) into v_libre
  from public.investisseurs i where i.ferme_id = new.ferme_id and i.actif;
  if v_libre > 0 then
    perform public.notifier(new.ferme_id, r, 'capital_bande',
      format('Nouvelle bande %s : indiquez le capital des investisseurs placé dedans (%s FCFA libres)', new.code, v_libre),
      '/ferme/bande/' || new.id)
    from unnest(array['finance', 'directeur', 'exploitation']::public.role_utilisateur[]) r;
  end if;
  return null;
end;
$$;
create trigger rappel_capital_bande after insert on public.bandes
  for each row execute function public.rappel_capital_bande();

-- Situation : capital, placé dans les bandes en cours, libre
create view public.capital_libre_investisseurs with (security_invoker = true) as
select s.investisseur_id, s.nom, s.capital_restant as capital,
       coalesce((select sum(c.montant) from public.capital_bandes c join public.bandes b on b.id = c.bande_id
                 where c.investisseur_id = s.investisseur_id and not c.annulee and b.statut <> 'cloturee'), 0) as place,
       s.capital_restant - coalesce((select sum(c.montant) from public.capital_bandes c join public.bandes b on b.id = c.bande_id
                 where c.investisseur_id = s.investisseur_id and not c.annulee and b.statut <> 'cloturee'), 0) as libre
from public.situation_investisseurs s
where s.actif;

revoke execute on function public.capital_place(uuid, uuid), public.controle_capital_bande(), public.controle_retrait_capital(),
                          public.rappel_capital_bande() from public, anon, authenticated;
revoke all on public.capital_bandes, public.capital_libre_investisseurs from anon;
