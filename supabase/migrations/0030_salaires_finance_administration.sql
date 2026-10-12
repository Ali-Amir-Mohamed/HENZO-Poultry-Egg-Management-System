-- =====================================================================
-- HENZO – Salaires payés par la finance seulement + espace Administration
--   1. Avances et paies : uniquement la finance (Dahirou). Le directeur
--      voit les salaires sans payer.
--   2. Administration (directeur seulement) : documents (fichiers rangés
--      dans le stockage Supabase, dossier privé « administration »),
--      échéances (impôts, renouvellements…) avec rappels sur le téléphone,
--      comptes bancaires (jamais de mot de passe ni de code), terrains.
--   Rappels : chaque matin à 7 h (heure du Cameroun) si pg_cron est
--   disponible, et à chaque ouverture de HENZO par le directeur.
-- À exécuter une fois dans Supabase > SQL Editor, après 0029.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Salaires : seule la finance paie
-- ---------------------------------------------------------------------
create or replace function public.verser_avance(p_employe uuid, p_montant numeric, p_mode public.mode_paiement,
                                     p_motif text default null, p_date date default current_date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.employes;
  v_dep uuid;
  v_id uuid;
begin
  if not public.a_role('finance') then raise exception 'Seule la finance (Dahirou) paie les salaires et les avances'; end if;
  select * into e from public.employes where id = p_employe and ferme_id = public.ferme_actuelle();
  if e.id is null then raise exception 'Employé introuvable'; end if;
  if coalesce(p_montant, 0) <= 0 then raise exception 'Indiquez le montant de l''avance'; end if;
  insert into public.depenses (ferme_id, date_depense, portee, activite, categorie, libelle, montant, mode_paiement, notes)
  values (e.ferme_id, coalesce(p_date, current_date), 'generale', e.activite, 'salaires',
          'Avance sur salaire – ' || e.nom, p_montant, p_mode, nullif(trim(coalesce(p_motif, '')), ''))
  returning id into v_dep;
  insert into public.avances_salaire (ferme_id, employe_id, date_avance, montant, motif, depense_id)
  values (e.ferme_id, e.id, coalesce(p_date, current_date), p_montant, nullif(trim(coalesce(p_motif, '')), ''), v_dep)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.payer_salaire(p_employe uuid, p_mois date, p_mode public.mode_paiement,
                                     p_primes numeric default 0, p_retenues numeric default 0, p_motif_retenues text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.employes;
  v_mois date := date_trunc('month', p_mois)::date;
  v_avances numeric;
  v_net numeric;
  v_paie uuid;
  v_dep uuid;
begin
  if not public.a_role('finance') then raise exception 'Seule la finance (Dahirou) paie les salaires et les avances'; end if;
  select * into e from public.employes where id = p_employe and ferme_id = public.ferme_actuelle();
  if e.id is null then raise exception 'Employé introuvable'; end if;
  if exists (select 1 from public.paies where employe_id = e.id and mois = v_mois and not annulee) then
    raise exception 'Le salaire de % pour ce mois est déjà payé', e.nom;
  end if;
  if coalesce(p_retenues, 0) > 0 and coalesce(trim(p_motif_retenues), '') = '' then
    raise exception 'Indiquez le motif de la retenue';
  end if;
  select coalesce(sum(montant), 0) into v_avances from public.avances_salaire
  where employe_id = e.id and not annulee and paie_id is null;
  v_net := e.salaire_mensuel + coalesce(p_primes, 0) - coalesce(p_retenues, 0) - v_avances;
  if v_net < 0 then
    raise exception 'Les avances et retenues (% FCFA) dépassent le salaire du mois', v_avances + coalesce(p_retenues, 0);
  end if;
  insert into public.paies (ferme_id, employe_id, mois, salaire_base, primes, retenues, motif_retenues, avances, mode_paiement)
  values (e.ferme_id, e.id, v_mois, e.salaire_mensuel, coalesce(p_primes, 0), coalesce(p_retenues, 0),
          nullif(trim(coalesce(p_motif_retenues, '')), ''), v_avances, p_mode)
  returning id into v_paie;
  if v_net > 0 then
    insert into public.depenses (ferme_id, date_depense, portee, activite, categorie, libelle, montant, mode_paiement, notes)
    values (e.ferme_id, current_date, 'generale', e.activite, 'salaires',
            format('Salaire %s – %s', to_char(v_mois, 'MM/YYYY'), e.nom), v_net, p_mode,
            case when v_avances > 0 then format('Avances déduites : %s FCFA', v_avances) end)
    returning id into v_dep;
    update public.paies set depense_id = v_dep where id = v_paie;
  end if;
  update public.avances_salaire set paie_id = v_paie where employe_id = e.id and not annulee and paie_id is null;
  return v_paie;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Administration
-- ---------------------------------------------------------------------
create table public.admin_terrains (
  id                uuid primary key default gen_random_uuid(),
  ferme_id          uuid not null default public.ferme_actuelle() references public.fermes (id),
  nom               text not null check (trim(nom) <> ''),
  localisation      text,
  surface_m2        numeric(14, 2) check (surface_m2 > 0),
  prix              numeric(16, 0) check (prix >= 0),
  statut            text not null default 'prospection' check (statut in ('prospection', 'en_cours', 'achete', 'titre')),
  date_acquisition  date,
  vendeur           text,
  notes             text,
  cree_par          uuid default auth.uid() references public.profiles (id),
  created_at        timestamptz not null default now()
);

create table public.admin_comptes_bancaires (
  id          uuid primary key default gen_random_uuid(),
  ferme_id    uuid not null default public.ferme_actuelle() references public.fermes (id),
  banque      text not null check (trim(banque) <> ''),
  intitule    text,
  numero      text,
  agence      text,
  contact     text,
  notes       text,
  actif       boolean not null default true,
  cree_par    uuid default auth.uid() references public.profiles (id),
  created_at  timestamptz not null default now()
);

create table public.admin_documents (
  id               uuid primary key default gen_random_uuid(),
  ferme_id         uuid not null default public.ferme_actuelle() references public.fermes (id),
  titre            text not null check (trim(titre) <> ''),
  categorie        text not null default 'autre' check (categorie in ('entreprise', 'impots', 'banque', 'foncier', 'contrat', 'autre')),
  fichier          text,            -- chemin dans le stockage : <ferme>/<id>/<nom>
  type_fichier     text,
  taille           integer,
  date_document    date,
  date_expiration  date,
  terrain_id       uuid references public.admin_terrains (id) on delete set null,
  compte_id        uuid references public.admin_comptes_bancaires (id) on delete set null,
  notes            text,
  rappel_envoye    date,
  cree_par         uuid default auth.uid() references public.profiles (id),
  created_at       timestamptz not null default now()
);
create index on public.admin_documents (ferme_id, categorie);

create table public.admin_echeances (
  id             uuid primary key default gen_random_uuid(),
  ferme_id       uuid not null default public.ferme_actuelle() references public.fermes (id),
  titre          text not null check (trim(titre) <> ''),
  categorie      text not null default 'impots' check (categorie in ('impots', 'entreprise', 'banque', 'foncier', 'autre')),
  date_echeance  date not null,
  rappel_jours   integer not null default 7 check (rappel_jours between 0 and 90),
  montant        numeric(16, 0) check (montant >= 0),
  recurrence     text not null default 'aucune' check (recurrence in ('aucune', 'mensuelle', 'trimestrielle', 'annuelle')),
  faite          boolean not null default false,
  faite_le       date,
  faite_par      uuid references public.profiles (id),
  notes          text,
  rappel_envoye  date,
  cree_par       uuid default auth.uid() references public.profiles (id),
  created_at     timestamptz not null default now()
);
create index on public.admin_echeances (ferme_id, faite, date_echeance);

create trigger journal after insert or update or delete on public.admin_terrains for each row execute function public.journaliser();
create trigger journal after insert or update or delete on public.admin_comptes_bancaires for each row execute function public.journaliser();
create trigger journal after insert or update or delete on public.admin_documents for each row execute function public.journaliser();
create trigger journal after insert or update or delete on public.admin_echeances for each row execute function public.journaliser();

-- Échéance faite : la suivante est créée toute seule (mensuelle, trimestrielle, annuelle).
-- Date changée : le rappel repartira.
create function public.suivi_echeance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date;
begin
  if new.date_echeance is distinct from old.date_echeance or new.rappel_jours is distinct from old.rappel_jours then
    new.rappel_envoye := null;
  end if;
  if new.faite and not old.faite then
    new.faite_le := coalesce(new.faite_le, current_date);
    new.faite_par := auth.uid();
    if new.recurrence <> 'aucune' then
      v_date := (new.date_echeance + case new.recurrence when 'mensuelle' then interval '1 month'
                                                         when 'trimestrielle' then interval '3 months'
                                                         else interval '1 year' end)::date;
      insert into public.admin_echeances (ferme_id, titre, categorie, date_echeance, rappel_jours, montant, recurrence, notes, cree_par)
      select new.ferme_id, new.titre, new.categorie, v_date, new.rappel_jours, new.montant, new.recurrence, new.notes, coalesce(auth.uid(), new.cree_par)
      where not exists (select 1 from public.admin_echeances x where x.ferme_id = new.ferme_id and x.titre = new.titre and x.date_echeance = v_date);
    end if;
  elsif not new.faite then
    new.faite_le := null;
    new.faite_par := null;
  end if;
  return new;
end;
$$;
create trigger suivi_echeance before update on public.admin_echeances
  for each row execute function public.suivi_echeance();

create function public.suivi_document()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.date_expiration is distinct from old.date_expiration then new.rappel_envoye := null; end if;
  return new;
end;
$$;
create trigger suivi_document before update on public.admin_documents
  for each row execute function public.suivi_document();

-- Rappels au directeur : une fois quand l'échéance approche (rappel_jours avant),
-- une fois le jour même (ou dès qu'elle est passée) ; documents : 30 jours avant l'expiration.
create function public.rappels_administration()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.admin_echeances;
  d public.admin_documents;
  n integer := 0;
begin
  if auth.uid() is not null and not public.a_role('directeur') then return 0; end if;
  for e in select * from public.admin_echeances
           where not faite and current_date >= date_echeance - rappel_jours
             and (rappel_envoye is null or (rappel_envoye < date_echeance and current_date >= date_echeance))
  loop
    perform public.notifier(e.ferme_id, 'directeur', 'echeance_admin',
      case when current_date > e.date_echeance then format('En retard : %s (prévu le %s)', e.titre, to_char(e.date_echeance, 'DD/MM/YYYY'))
           when current_date = e.date_echeance then format('C''est aujourd''hui : %s', e.titre)
           else format('%s : à faire avant le %s', e.titre, to_char(e.date_echeance, 'DD/MM/YYYY')) end,
      '/administration');
    update public.admin_echeances set rappel_envoye = current_date where id = e.id;
    n := n + 1;
  end loop;
  for d in select * from public.admin_documents
           where date_expiration is not null and rappel_envoye is null and current_date >= date_expiration - 30
  loop
    perform public.notifier(d.ferme_id, 'directeur', 'document_expire',
      case when current_date > d.date_expiration then format('Document expiré : %s (le %s)', d.titre, to_char(d.date_expiration, 'DD/MM/YYYY'))
           else format('Le document « %s » expire le %s', d.titre, to_char(d.date_expiration, 'DD/MM/YYYY')) end,
      '/administration');
    update public.admin_documents set rappel_envoye = current_date where id = d.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Droits : le directeur seulement
alter table public.admin_terrains enable row level security;
alter table public.admin_comptes_bancaires enable row level security;
alter table public.admin_documents enable row level security;
alter table public.admin_echeances enable row level security;
create policy admin_terrains_all on public.admin_terrains for all to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur'));
create policy admin_comptes_all on public.admin_comptes_bancaires for all to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur'));
create policy admin_documents_all on public.admin_documents for all to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur'));
create policy admin_echeances_all on public.admin_echeances for all to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur'));

revoke all on public.admin_terrains, public.admin_comptes_bancaires, public.admin_documents, public.admin_echeances from anon;
revoke execute on function public.suivi_echeance(), public.suivi_document() from public, anon, authenticated;
revoke execute on function public.rappels_administration() from public, anon;
grant execute on function public.rappels_administration() to authenticated;

-- Fichiers : dossier privé « administration » (20 Mo par fichier), rangé par ferme
do $do$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('administration', 'administration', false, 20971520)
    on conflict (id) do nothing;
    drop policy if exists admin_fichiers_select on storage.objects;
    drop policy if exists admin_fichiers_insert on storage.objects;
    drop policy if exists admin_fichiers_delete on storage.objects;
    create policy admin_fichiers_select on storage.objects for select to authenticated
      using (bucket_id = 'administration' and (storage.foldername(name))[1] = public.ferme_actuelle()::text and public.a_role('directeur'));
    create policy admin_fichiers_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'administration' and (storage.foldername(name))[1] = public.ferme_actuelle()::text and public.a_role('directeur'));
    create policy admin_fichiers_delete on storage.objects for delete to authenticated
      using (bucket_id = 'administration' and (storage.foldername(name))[1] = public.ferme_actuelle()::text and public.a_role('directeur'));
  end if;
end;
$do$;

-- Rappels automatiques chaque matin (6 h UTC = 7 h au Cameroun), si pg_cron existe
do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('henzo-rappels-administration', '0 6 * * *', 'select public.rappels_administration()');
  end if;
exception when others then
  raise notice 'Rappels automatiques non programmés (%). Ils partiront à l''ouverture de HENZO par le directeur.', sqlerrm;
end;
$do$;
