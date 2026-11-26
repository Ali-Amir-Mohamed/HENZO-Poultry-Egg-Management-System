-- =====================================================================
-- HENZO – 0069 : Ressources humaines, étape 3 : contrats, documents,
--               congés et permissions, évaluations
--
-- 1. Contrat sur la fiche de l'employé (Dahirou, Ali) : CDI, CDD, stage,
--    journalier ; début, fin, fin de la période d'essai. Rappel à Ali et
--    Dahirou un mois avant la fin d'un CDD ou d'une période d'essai.
-- 2. Documents de l'employé (contrat signé, pièce d'identité, CV…) :
--    dossier privé « administration/<société>/employes/… », lus et ajoutés
--    seulement par Ali et Dahirou.
-- 3. Congés et permissions : demandés par Kenfack, Dahirou ou Ali ; accordés
--    ou refusés par Ali ou Dahirou. Congé payé : 1,5 jour ouvrable par mois
--    de service (Code du travail), le dimanche ne compte pas. Un congé
--    accordé est noté tout seul dans les présences (« permission »).
-- 4. Évaluations par Kenfack (ou Ali) : ponctualité, travail, comportement
--    de 1 à 5, et un commentaire.
-- Relançable sans erreur.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Contract
-- ---------------------------------------------------------------------
alter table public.employes add column if not exists type_contrat text check (type_contrat in ('cdi', 'cdd', 'stage', 'journalier'));
alter table public.employes add column if not exists date_debut_contrat date;
alter table public.employes add column if not exists date_fin_contrat date;
alter table public.employes add column if not exists fin_periode_essai date;
alter table public.employes add column if not exists rappel_contrat date;
alter table public.employes drop constraint if exists employes_dates_contrat;
alter table public.employes add constraint employes_dates_contrat check (date_fin_contrat is null or date_debut_contrat is null or date_fin_contrat >= date_debut_contrat);

create or replace function public.maj_contrat(p_employe uuid, p_type text, p_debut date, p_fin date, p_fin_essai date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.a_role('directeur', 'finance') then raise exception 'Les contrats sont gérés par la finance (Dahirou) et la direction'; end if;
  if p_type is not null and p_type not in ('cdi', 'cdd', 'stage', 'journalier') then raise exception 'Type de contrat inconnu'; end if;
  if p_type = 'cdd' and p_fin is null then raise exception 'Un CDD a une date de fin'; end if;
  if p_type = 'cdi' and p_fin is not null then raise exception 'Un CDI n''a pas de date de fin'; end if;
  if p_fin is not null and p_debut is not null and p_fin < p_debut then raise exception 'La fin du contrat est avant son début'; end if;
  update public.employes set type_contrat = p_type, date_debut_contrat = p_debut, date_fin_contrat = p_fin, fin_periode_essai = p_fin_essai, rappel_contrat = null
  where id = p_employe and ferme_id = public.ferme_actuelle();
  if not found then raise exception 'Employé introuvable'; end if;
end;
$$;

-- reminders one month before the end of a fixed-term contract or of a trial period (once each)
create or replace function public.rappels_rh()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.employes;
  v_date date;
  v_quoi text;
  n integer := 0;
begin
  if auth.uid() is not null and not public.a_role('directeur', 'finance') then return 0; end if;
  for e in select * from public.employes where actif and (auth.uid() is null or ferme_id = public.ferme_actuelle()) loop
    v_date := null;
    if e.fin_periode_essai is not null and current_date >= e.fin_periode_essai - 30 and current_date <= e.fin_periode_essai + 7 then
      v_date := e.fin_periode_essai; v_quoi := 'la période d''essai';
    elsif e.date_fin_contrat is not null and current_date >= e.date_fin_contrat - 30 then
      v_date := e.date_fin_contrat; v_quoi := 'le contrat';
    end if;
    if v_date is null or e.rappel_contrat = v_date then continue; end if;
    perform public.notifier(e.ferme_id, r, 'contrat_fin',
      format('%s : %s se termine le %s. Renouveler, confirmer ou arrêter ?', e.nom, v_quoi, to_char(v_date, 'DD/MM/YYYY')), '/ferme')
    from unnest(array['directeur', 'finance']::public.role_utilisateur[]) r;
    update public.employes set rappel_contrat = v_date where id = e.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Employee documents (private files, Ali and Dahirou)
-- ---------------------------------------------------------------------
create table if not exists public.documents_employes (
  id          uuid primary key default gen_random_uuid(),
  ferme_id    uuid not null default public.ferme_actuelle() references public.fermes (id),
  employe_id  uuid not null references public.employes (id),
  type_doc    text not null default 'autre' check (type_doc in ('contrat', 'identite', 'cv', 'diplome', 'certificat', 'autre')),
  titre       text not null check (trim(titre) <> ''),
  fichier     text,
  type_fichier text,
  taille      bigint,
  ajoute_par  uuid not null default auth.uid() references public.profiles (id),
  created_at  timestamptz not null default now()
);
alter table public.documents_employes enable row level security;
drop policy if exists documents_employes_select on public.documents_employes;
drop policy if exists documents_employes_insert on public.documents_employes;
drop policy if exists documents_employes_update on public.documents_employes;
drop policy if exists documents_employes_delete on public.documents_employes;
create policy documents_employes_select on public.documents_employes for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance'));
create policy documents_employes_insert on public.documents_employes for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance') and ajoute_par = auth.uid()
              and employe_id in (select id from public.employes where ferme_id = public.ferme_actuelle()));
create policy documents_employes_update on public.documents_employes for update to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance'));
create policy documents_employes_delete on public.documents_employes for delete to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance'));
drop trigger if exists journal on public.documents_employes;
create trigger journal after insert or update on public.documents_employes for each row execute function public.journaliser();
revoke all on public.documents_employes from anon;
grant select, insert, update, delete on public.documents_employes to authenticated;

do $do$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists rh_fichiers_select on storage.objects;
    drop policy if exists rh_fichiers_insert on storage.objects;
    drop policy if exists rh_fichiers_delete on storage.objects;
    create policy rh_fichiers_select on storage.objects for select to authenticated
      using (bucket_id = 'administration' and (storage.foldername(name))[1] = public.ferme_actuelle()::text
             and (storage.foldername(name))[2] = 'employes' and public.a_role('directeur', 'finance'));
    create policy rh_fichiers_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'administration' and (storage.foldername(name))[1] = public.ferme_actuelle()::text
                  and (storage.foldername(name))[2] = 'employes' and public.a_role('directeur', 'finance'));
    create policy rh_fichiers_delete on storage.objects for delete to authenticated
      using (bucket_id = 'administration' and (storage.foldername(name))[1] = public.ferme_actuelle()::text
             and (storage.foldername(name))[2] = 'employes' and public.a_role('directeur', 'finance'));
  end if;
end;
$do$;

-- ---------------------------------------------------------------------
-- 3. Leave and permissions
-- ---------------------------------------------------------------------
create table if not exists public.conges (
  id           uuid primary key default gen_random_uuid(),
  ferme_id     uuid not null references public.fermes (id),
  employe_id   uuid not null references public.employes (id),
  type_conge   text not null check (type_conge in ('conge', 'permission', 'maladie')),
  date_debut   date not null,
  date_fin     date not null,
  jours        numeric(5, 1) not null check (jours > 0),
  motif        text,
  statut       text not null default 'demandee' check (statut in ('demandee', 'accordee', 'refusee')),
  demande_par  uuid not null references public.profiles (id),
  decide_par   uuid references public.profiles (id),
  decide_le    timestamptz,
  motif_refus  text,
  created_at   timestamptz not null default now(),
  check (date_fin >= date_debut)
);
alter table public.conges enable row level security;
drop policy if exists conges_select on public.conges;
create policy conges_select on public.conges for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));
drop trigger if exists journal on public.conges;
create trigger journal after insert or update on public.conges for each row execute function public.journaliser();
revoke all on public.conges from anon;
grant select on public.conges to authenticated;

-- working days between two dates (Sunday does not count)
create or replace function public.jours_ouvrables(p_debut date, p_fin date)
returns integer
language sql
immutable
set search_path = ''
as $$ select count(*)::integer from generate_series(p_debut, p_fin, interval '1 day') d where extract(isodow from d) <> 7 $$;

-- paid leave earned (1.5 working days per month of service) minus leave already granted
create or replace function public.solde_conges(p_employe uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.employes;
  v_debut date;
  v_mois integer;
  v_pris numeric;
begin
  select * into e from public.employes where id = p_employe and ferme_id = public.ferme_actuelle();
  if e.id is null or not public.a_role('directeur', 'exploitation', 'finance') then return null; end if;
  v_debut := coalesce(e.date_debut_contrat, e.date_embauche, e.created_at::date);
  v_mois := greatest(0, (extract(year from age(current_date, v_debut)) * 12 + extract(month from age(current_date, v_debut)))::integer);
  select coalesce(sum(jours), 0) into v_pris from public.conges where employe_id = e.id and type_conge = 'conge' and statut = 'accordee';
  return jsonb_build_object('mois_service', v_mois, 'acquis', v_mois * 1.5, 'pris', v_pris, 'reste', v_mois * 1.5 - v_pris);
end;
$$;

create or replace function public.demander_conge(p_employe uuid, p_type text, p_debut date, p_fin date, p_motif text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.employes;
  v_jours integer;
  v_id uuid;
begin
  if not public.a_role('directeur', 'exploitation', 'finance') then raise exception 'Réservé à la direction, l''exploitation et la finance'; end if;
  select * into e from public.employes where id = p_employe and ferme_id = public.ferme_actuelle() and actif;
  if e.id is null then raise exception 'Employé introuvable'; end if;
  if p_type not in ('conge', 'permission', 'maladie') then raise exception 'Type d''absence inconnu'; end if;
  if p_debut is null or p_fin is null or p_fin < p_debut then raise exception 'Dates impossibles'; end if;
  if p_type <> 'conge' and coalesce(trim(p_motif), '') = '' then raise exception 'Indiquez le motif de la permission'; end if;
  if exists (select 1 from public.conges where employe_id = e.id and statut <> 'refusee' and daterange(date_debut, date_fin, '[]') && daterange(p_debut, p_fin, '[]')) then
    raise exception 'Une demande existe déjà pour ces dates';
  end if;
  v_jours := public.jours_ouvrables(p_debut, p_fin);
  if v_jours = 0 then raise exception 'Aucun jour ouvrable dans ces dates'; end if;
  insert into public.conges (ferme_id, employe_id, type_conge, date_debut, date_fin, jours, motif, demande_par)
  values (e.ferme_id, e.id, p_type, p_debut, p_fin, v_jours, nullif(trim(coalesce(p_motif, '')), ''), auth.uid())
  returning id into v_id;
  perform public.notifier(e.ferme_id, r, 'conge',
    format('%s demande %s jour(s) de %s pour %s, du %s au %s', public.nom_acteur(), v_jours,
           case p_type when 'conge' then 'congé' when 'maladie' then 'maladie' else 'permission' end, e.nom, to_char(p_debut, 'DD/MM'), to_char(p_fin, 'DD/MM')), '/ferme')
  from unnest(array['directeur', 'finance']::public.role_utilisateur[]) r;
  return v_id;
end;
$$;

create or replace function public.decider_conge(p_id uuid, p_accorder boolean, p_motif text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.conges;
  v_solde jsonb;
  d date;
begin
  if not public.a_role('directeur', 'finance') then raise exception 'Les congés sont accordés par la direction ou la finance'; end if;
  select * into c from public.conges where id = p_id and ferme_id = public.ferme_actuelle() for update;
  if c.id is null or c.statut <> 'demandee' then raise exception 'Cette demande n''est plus en attente'; end if;
  if not p_accorder then
    if coalesce(trim(p_motif), '') = '' then raise exception 'Indiquez le motif du refus'; end if;
    update public.conges set statut = 'refusee', decide_par = auth.uid(), decide_le = now(), motif_refus = trim(p_motif) where id = c.id;
  else
    if c.type_conge = 'conge' then
      v_solde := public.solde_conges(c.employe_id);
      if (v_solde ->> 'reste')::numeric < c.jours then
        raise exception 'Solde de congé insuffisant : il reste % jour(s), la demande en compte %', trim_scale((v_solde ->> 'reste')::numeric), trim_scale(c.jours);
      end if;
    end if;
    update public.conges set statut = 'accordee', decide_par = auth.uid(), decide_le = now() where id = c.id;
    -- the days appear in the attendance (open pay months only)
    for d in select g::date from generate_series(c.date_debut, c.date_fin, interval '1 day') g where extract(isodow from g) <> 7 loop
      if public.mois_paie_ouvert(c.employe_id, d) then
        insert into public.presences (ferme_id, employe_id, date_jour, statut, justifiee, note, saisi_par)
        values (c.ferme_id, c.employe_id, d, 'permission', true,
                case c.type_conge when 'conge' then 'Congé' when 'maladie' then 'Maladie' else 'Permission' end, auth.uid())
        on conflict (employe_id, date_jour) do update set statut = 'permission', justifiee = true, note = excluded.note, saisi_par = excluded.saisi_par;
      end if;
    end loop;
  end if;
  perform public.notifier(c.ferme_id, 'exploitation', 'conge',
    format('%s : %s du %s au %s %s', (select nom from public.employes where id = c.employe_id),
           case c.type_conge when 'conge' then 'congé' when 'maladie' then 'maladie' else 'permission' end,
           to_char(c.date_debut, 'DD/MM'), to_char(c.date_fin, 'DD/MM'), case when p_accorder then 'accordé(e)' else 'refusé(e) : ' || trim(p_motif) end), '/ferme');
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Evaluations
-- ---------------------------------------------------------------------
create table if not exists public.evaluations (
  id            uuid primary key default gen_random_uuid(),
  ferme_id      uuid not null references public.fermes (id),
  employe_id    uuid not null references public.employes (id),
  date_eval     date not null default current_date,
  ponctualite   smallint not null check (ponctualite between 1 and 5),
  travail       smallint not null check (travail between 1 and 5),
  comportement  smallint not null check (comportement between 1 and 5),
  commentaire   text,
  evalue_par    uuid not null references public.profiles (id),
  created_at    timestamptz not null default now()
);
alter table public.evaluations enable row level security;
drop policy if exists evaluations_select on public.evaluations;
create policy evaluations_select on public.evaluations for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));
drop trigger if exists journal on public.evaluations;
create trigger journal after insert or update on public.evaluations for each row execute function public.journaliser();
revoke all on public.evaluations from anon;
grant select on public.evaluations to authenticated;

create or replace function public.evaluer_employe(p_employe uuid, p_ponctualite integer, p_travail integer, p_comportement integer, p_commentaire text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.employes;
  v_id uuid;
begin
  if not public.a_role('directeur', 'exploitation') then raise exception 'Les évaluations sont faites par l''exploitation (Kenfack)'; end if;
  select * into e from public.employes where id = p_employe and ferme_id = public.ferme_actuelle();
  if e.id is null then raise exception 'Employé introuvable'; end if;
  insert into public.evaluations (ferme_id, employe_id, ponctualite, travail, comportement, commentaire, evalue_par)
  values (e.ferme_id, e.id, p_ponctualite, p_travail, p_comportement, nullif(trim(coalesce(p_commentaire, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.maj_contrat(uuid, text, date, date, date), public.rappels_rh(), public.solde_conges(uuid),
  public.demander_conge(uuid, text, date, date, text), public.decider_conge(uuid, boolean, text), public.evaluer_employe(uuid, integer, integer, integer, text),
  public.jours_ouvrables(date, date) from public, anon;
grant execute on function public.maj_contrat(uuid, text, date, date, date), public.rappels_rh(), public.solde_conges(uuid),
  public.demander_conge(uuid, text, date, date, text), public.decider_conge(uuid, boolean, text), public.evaluer_employe(uuid, integer, integer, integer, text),
  public.jours_ouvrables(date, date) to authenticated;
