-- =====================================================================
-- HENZO – 0068 : Ressources humaines, étape 2 : présences et heures supplémentaires
--
-- Le salaire reste mensuel. Pour le prix d'une heure, HENZO utilise la
-- durée légale dans l'agriculture : 2 400 h par an, soit 200 h par mois
-- (modifiable dans les paramètres de paie). Une journée = salaire ÷ 26.
--
-- 1. Présences : Kenfack (et la direction, la finance) note chaque jour
--    présent / absent / retard (minutes) / permission. Une absence peut être
--    justifiée. Rien ne change après la clôture de la paie du mois.
-- 2. Heures supplémentaires : Kenfack les déclare ; Ali les autorise ou les
--    refuse (avec motif). Seules les heures autorisées entrent dans la paie,
--    automatiquement, à la préparation : jour ouvrable +20 % les 8 premières
--    heures de la semaine, +30 % les 8 suivantes, +40 % au-delà ; nuit,
--    dimanche ou jour férié +50 % (taux modifiables).
-- 3. À la préparation, HENZO propose une retenue pour les absences non
--    justifiées (une journée chacune) : Dahirou la garde ou l'enlève.
-- Relançable sans erreur.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------
alter table public.parametres_paie add column if not exists heures_mois numeric(6, 2) not null default 200;
alter table public.parametres_paie add column if not exists jours_mois numeric(5, 2) not null default 26;
alter table public.parametres_paie add column if not exists taux_hs_1 numeric(5, 2) not null default 20;
alter table public.parametres_paie add column if not exists taux_hs_2 numeric(5, 2) not null default 30;
alter table public.parametres_paie add column if not exists taux_hs_3 numeric(5, 2) not null default 40;
alter table public.parametres_paie add column if not exists taux_hs_nuit numeric(5, 2) not null default 50;

create or replace function public.maj_parametres_paie(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text;
  nums text[] := array['plafond_cnps', 'taux_cnps_salarie', 'taux_cnps_vieillesse_pat', 'taux_allocations_fam', 'taux_accidents_travail',
                       'taux_cfc_salarie', 'taux_cfc_patronal', 'taux_fne', 'taux_cac', 'abattement_frais', 'abattement_annuel', 'seuil_irpp',
                       'heures_mois', 'jours_mois', 'taux_hs_1', 'taux_hs_2', 'taux_hs_3', 'taux_hs_nuit'];
  barems text[] := array['bareme_irpp', 'bareme_rav', 'bareme_tdl'];
begin
  if not public.a_role('directeur', 'finance', 'comptable') then raise exception 'Seuls la direction, la finance et le comptable modifient les paramètres de paie'; end if;
  insert into public.parametres_paie (ferme_id) values (public.societe_de(public.ferme_actuelle())) on conflict do nothing;
  foreach k in array nums loop
    if p ? k and nullif(p ->> k, '') is not null then
      if (p ->> k)::numeric < 0 then raise exception 'Valeur négative impossible (%)', k; end if;
      if k in ('heures_mois', 'jours_mois') and (p ->> k)::numeric = 0 then raise exception 'Le nombre d''heures et de jours du mois ne peut pas être 0'; end if;
      execute format('update public.parametres_paie set %I = $1 where ferme_id = $2', k) using (p ->> k)::numeric, public.societe_de(public.ferme_actuelle());
    end if;
  end loop;
  foreach k in array barems loop
    if p ? k then
      if jsonb_typeof(p -> k) <> 'array' or jsonb_array_length(p -> k) = 0 then raise exception 'Barème vide ou mal écrit (%)', k; end if;
      execute format('update public.parametres_paie set %I = $1 where ferme_id = $2', k) using p -> k, public.societe_de(public.ferme_actuelle());
    end if;
  end loop;
  update public.parametres_paie set modifie_par = auth.uid(), modifie_le = now() where ferme_id = public.societe_de(public.ferme_actuelle());
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Attendance
-- ---------------------------------------------------------------------
create table if not exists public.presences (
  id             uuid primary key default gen_random_uuid(),
  ferme_id       uuid not null references public.fermes (id),
  employe_id     uuid not null references public.employes (id),
  date_jour      date not null,
  statut         text not null check (statut in ('present', 'absent', 'retard', 'permission')),
  minutes_retard integer not null default 0 check (minutes_retard >= 0 and minutes_retard <= 600),
  justifiee      boolean not null default false,
  note           text,
  saisi_par      uuid not null references public.profiles (id),
  created_at     timestamptz not null default now(),
  unique (employe_id, date_jour)
);
create index if not exists presences_mois on public.presences (ferme_id, date_jour);
alter table public.presences enable row level security;
drop policy if exists presences_select on public.presences;
create policy presences_select on public.presences for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));
drop trigger if exists journal on public.presences;
create trigger journal after insert or update on public.presences for each row execute function public.journaliser();

-- one day for several employees at once: [{employe_id, statut, minutes_retard, justifiee, note}]
create or replace function public.noter_presences(p_date date, p_lignes jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  l jsonb;
  e public.employes;
  v_statut text;
  n integer := 0;
begin
  if not public.a_role('directeur', 'exploitation', 'finance') then raise exception 'Les présences sont notées par l''exploitation (Kenfack)'; end if;
  if p_date is null or p_date > current_date then raise exception 'Date de présence impossible'; end if;
  if public.mois_paie_cloture(public.ferme_actuelle(), p_date) then raise exception 'La paie de ce mois est clôturée : les présences ne se changent plus'; end if;
  for l in select * from jsonb_array_elements(coalesce(p_lignes, '[]')) loop
    select * into e from public.employes where id = (l ->> 'employe_id')::uuid and ferme_id = public.ferme_actuelle();
    if e.id is null then raise exception 'Employé introuvable'; end if;
    v_statut := l ->> 'statut';
    if v_statut is null or v_statut = '' then
      delete from public.presences where employe_id = e.id and date_jour = p_date;
      continue;
    end if;
    if v_statut not in ('present', 'absent', 'retard', 'permission') then raise exception 'Présence inconnue : %', v_statut; end if;
    insert into public.presences (ferme_id, employe_id, date_jour, statut, minutes_retard, justifiee, note, saisi_par)
    values (e.ferme_id, e.id, p_date, v_statut, case when v_statut = 'retard' then greatest(coalesce((l ->> 'minutes_retard')::integer, 0), 0) else 0 end,
            v_statut = 'permission' or coalesce((l ->> 'justifiee')::boolean, false), nullif(trim(coalesce(l ->> 'note', '')), ''), auth.uid())
    on conflict (employe_id, date_jour) do update set statut = excluded.statut, minutes_retard = excluded.minutes_retard,
      justifiee = excluded.justifiee, note = excluded.note, saisi_par = excluded.saisi_par;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Overtime: declared by Kenfack, authorised by Ali
-- ---------------------------------------------------------------------
create table if not exists public.heures_sup (
  id           uuid primary key default gen_random_uuid(),
  ferme_id     uuid not null references public.fermes (id),
  employe_id   uuid not null references public.employes (id),
  date_jour    date not null,
  heures       numeric(5, 2) not null check (heures > 0 and heures <= 16),
  nature       text not null default 'jour' check (nature in ('jour', 'nuit_dimanche_ferie')),
  motif        text not null check (trim(motif) <> ''),
  statut       text not null default 'demandee' check (statut in ('demandee', 'autorisee', 'refusee')),
  declare_par  uuid not null references public.profiles (id),
  decide_par   uuid references public.profiles (id),
  decide_le    timestamptz,
  motif_refus  text,
  created_at   timestamptz not null default now()
);
create index if not exists heures_sup_mois on public.heures_sup (ferme_id, date_jour);
alter table public.heures_sup enable row level security;
drop policy if exists heures_sup_select on public.heures_sup;
create policy heures_sup_select on public.heures_sup for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));
drop trigger if exists journal on public.heures_sup;
create trigger journal after insert or update on public.heures_sup for each row execute function public.journaliser();

-- the pay of that month must still be open (not prepared as paid, not closed)
create or replace function public.mois_paie_ouvert(p_employe uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not public.mois_paie_cloture(e.ferme_id, p_date)
     and not exists (select 1 from public.paies p where p.employe_id = e.id and p.mois = date_trunc('month', p_date)::date and not p.annulee)
  from public.employes e where e.id = p_employe
$$;

create or replace function public.declarer_heures_sup(p_employe uuid, p_date date, p_heures numeric, p_nature text, p_motif text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.employes;
  v_id uuid;
begin
  if not public.a_role('directeur', 'exploitation') then raise exception 'Les heures supplémentaires sont déclarées par l''exploitation (Kenfack)'; end if;
  select * into e from public.employes where id = p_employe and ferme_id = public.ferme_actuelle();
  if e.id is null then raise exception 'Employé introuvable'; end if;
  if p_date is null or p_date > current_date then raise exception 'Date impossible'; end if;
  if coalesce(trim(p_motif), '') = '' then raise exception 'Indiquez pourquoi ces heures ont été faites'; end if;
  if not public.mois_paie_ouvert(e.id, p_date) then raise exception 'Le salaire de ce mois est déjà payé ou clôturé : ces heures se paient en régularisation'; end if;
  insert into public.heures_sup (ferme_id, employe_id, date_jour, heures, nature, motif, declare_par)
  values (e.ferme_id, e.id, p_date, p_heures, coalesce(nullif(p_nature, ''), 'jour'), trim(p_motif), auth.uid())
  returning id into v_id;
  perform public.prevenir_directeur(e.ferme_id, 'heures_sup',
    format('%s déclare %s h supplémentaires pour %s (%s) : à autoriser', public.nom_acteur(), trim_scale(p_heures), e.nom, to_char(p_date, 'DD/MM')), '/ferme');
  return v_id;
end;
$$;

create or replace function public.decider_heures_sup(p_ids uuid[], p_autoriser boolean, p_motif text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  h record;
  n integer := 0;
begin
  if not public.a_role('directeur') then raise exception 'Seul le directeur (Ali) autorise les heures supplémentaires'; end if;
  if not p_autoriser and coalesce(trim(p_motif), '') = '' then raise exception 'Indiquez le motif du refus'; end if;
  for h in select * from public.heures_sup where id = any (p_ids) and ferme_id = public.ferme_actuelle() and statut = 'demandee' for update loop
    if p_autoriser and not public.mois_paie_ouvert(h.employe_id, h.date_jour) then
      raise exception 'Le salaire de ce mois est déjà payé ou clôturé : ces heures se paient en régularisation';
    end if;
    update public.heures_sup set statut = case when p_autoriser then 'autorisee' else 'refusee' end, decide_par = auth.uid(), decide_le = now(),
      motif_refus = case when p_autoriser then null else trim(p_motif) end
    where id = h.id;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Aucune heure supplémentaire en attente'; end if;
  perform public.notifier(public.ferme_actuelle(), 'exploitation', 'heures_sup',
    format('Ali a %s %s déclaration(s) d''heures supplémentaires%s', case when p_autoriser then 'autorisé' else 'refusé' end, n,
           case when p_autoriser then '' else ' : ' || trim(p_motif) end), '/ferme');
  return n;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. What the month's attendance means for the pay
-- ---------------------------------------------------------------------
-- authorised overtime of the month, priced: weekday hours in tiers per week (8 h / 8 h / more), nights, Sundays and holidays apart
create or replace function public.calcul_heures_sup(p_employe uuid, p_mois date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.employes;
  pp public.parametres_paie;
  v_mois date := date_trunc('month', p_mois)::date;
  v_horaire numeric;
  h record;
  v_semaine date;
  v_cumul numeric := 0;
  v_reste numeric;
  v_part numeric;
  v_montant numeric := 0;
  v_heures numeric := 0;
  v_attente numeric;
begin
  select * into e from public.employes where id = p_employe;
  select * into pp from public.parametres_paie where ferme_id = public.societe_de(e.ferme_id);
  v_horaire := e.salaire_mensuel / nullif(coalesce(pp.heures_mois, 200), 0);
  for h in select * from public.heures_sup where employe_id = e.id and statut = 'autorisee'
             and date_jour >= v_mois and date_jour < v_mois + interval '1 month' order by date_jour, created_at loop
    v_heures := v_heures + h.heures;
    if h.nature = 'nuit_dimanche_ferie' then
      v_montant := v_montant + h.heures * v_horaire * (1 + coalesce(pp.taux_hs_nuit, 50) / 100);
      continue;
    end if;
    if v_semaine is distinct from date_trunc('week', h.date_jour)::date then v_semaine := date_trunc('week', h.date_jour)::date; v_cumul := 0; end if;
    v_reste := h.heures;
    -- tier 1: up to 8 h in the week
    v_part := least(v_reste, greatest(8 - v_cumul, 0));
    v_montant := v_montant + v_part * v_horaire * (1 + coalesce(pp.taux_hs_1, 20) / 100); v_cumul := v_cumul + v_part; v_reste := v_reste - v_part;
    -- tier 2: from 8 to 16 h
    v_part := least(v_reste, greatest(16 - v_cumul, 0));
    v_montant := v_montant + v_part * v_horaire * (1 + coalesce(pp.taux_hs_2, 30) / 100); v_cumul := v_cumul + v_part; v_reste := v_reste - v_part;
    -- tier 3: beyond
    v_montant := v_montant + v_reste * v_horaire * (1 + coalesce(pp.taux_hs_3, 40) / 100); v_cumul := v_cumul + v_reste;
  end loop;
  select coalesce(sum(heures), 0) into v_attente from public.heures_sup
  where employe_id = e.id and statut = 'demandee' and date_jour >= v_mois and date_jour < v_mois + interval '1 month';
  return jsonb_build_object('heures', v_heures, 'montant', round(coalesce(v_montant, 0)), 'taux_horaire', round(coalesce(v_horaire, 0)), 'en_attente', v_attente);
end;
$$;

-- summary shown to Dahirou when he prepares the pay
create or replace function public.resume_presences(p_employe uuid, p_mois date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.employes;
  pp public.parametres_paie;
  v_mois date := date_trunc('month', p_mois)::date;
  r record;
begin
  if not public.a_role('directeur', 'finance') then raise exception 'Réservé à la direction et à la finance'; end if;
  select * into e from public.employes where id = p_employe and ferme_id = public.ferme_actuelle();
  if e.id is null then raise exception 'Employé introuvable'; end if;
  select * into pp from public.parametres_paie where ferme_id = public.societe_de(e.ferme_id);
  select count(*) filter (where statut = 'present') presents,
         count(*) filter (where statut = 'absent') absences,
         count(*) filter (where statut = 'absent' and not justifiee) absences_non_justifiees,
         count(*) filter (where statut = 'permission') permissions,
         count(*) filter (where statut = 'retard') retards,
         coalesce(sum(minutes_retard), 0) minutes_retard
    into r from public.presences where employe_id = e.id and date_jour >= v_mois and date_jour < v_mois + interval '1 month';
  return jsonb_build_object('presents', r.presents, 'absences', r.absences, 'absences_non_justifiees', r.absences_non_justifiees,
    'permissions', r.permissions, 'retards', r.retards, 'minutes_retard', r.minutes_retard,
    'retenue_proposee', round(r.absences_non_justifiees * e.salaire_mensuel / nullif(coalesce(pp.jours_mois, 26), 0)),
    'heures_sup', public.calcul_heures_sup(e.id, v_mois));
end;
$$;

-- ---------------------------------------------------------------------
-- 5. The preparation adds the authorised overtime by itself (never typed by hand)
-- ---------------------------------------------------------------------
create or replace function public.preparer_paie(p_employe uuid, p_mois date, p_elements jsonb default '[]',
                                                p_retenues numeric default 0, p_motif_retenues text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.employes;
  v_mois date := date_trunc('month', p_mois)::date;
  el jsonb;
  v_elements jsonb := '[]';
  v_type text;
  v_montant numeric;
  v_soumis boolean;
  v_primes numeric := 0;
  v_indem numeric := 0;
  v_avances numeric;
  v_b jsonb;
  v_hs jsonb;
  v_legales numeric := 0;
  v_net numeric;
  v_id uuid;
begin
  if not public.a_role('directeur', 'finance') then raise exception 'La paie est préparée par la finance (Dahirou)'; end if;
  select * into e from public.employes where id = p_employe and ferme_id = public.ferme_actuelle();
  if e.id is null then raise exception 'Employé introuvable'; end if;
  if public.mois_paie_cloture(e.ferme_id, v_mois) then raise exception 'La paie de % est clôturée : faites une régularisation sur un prochain mois', to_char(v_mois, 'MM/YYYY'); end if;
  if exists (select 1 from public.paies where employe_id = e.id and mois = v_mois and not annulee) then
    raise exception 'Le salaire de % pour ce mois est déjà payé', e.nom;
  end if;
  if coalesce(p_retenues, 0) < 0 then raise exception 'Retenue négative impossible'; end if;
  if coalesce(p_retenues, 0) > 0 and coalesce(trim(p_motif_retenues), '') = '' then raise exception 'Indiquez le motif de la retenue'; end if;

  for el in select * from jsonb_array_elements(coalesce(p_elements, '[]')) loop
    v_type := coalesce(el ->> 'type', 'prime');
    if v_type = 'heures_sup' then continue; end if;   -- computed below from the authorised hours only
    if v_type not in ('prime', 'indemnite', 'regularisation') then raise exception 'Élément de paie inconnu : %', v_type; end if;
    v_montant := round(coalesce((el ->> 'montant')::numeric, 0));
    if v_montant <= 0 then continue; end if;
    if coalesce(trim(el ->> 'libelle'), '') = '' then raise exception 'Donnez un nom à chaque prime ou indemnité'; end if;
    v_soumis := case when v_type = 'indemnite' then coalesce((el ->> 'soumis')::boolean, false) else true end;
    if v_soumis then v_primes := v_primes + v_montant; else v_indem := v_indem + v_montant; end if;
    v_elements := v_elements || jsonb_build_object('type', v_type, 'libelle', trim(el ->> 'libelle'), 'montant', v_montant, 'soumis', v_soumis);
  end loop;

  v_hs := public.calcul_heures_sup(e.id, v_mois);
  if (v_hs ->> 'montant')::numeric > 0 then
    v_primes := v_primes + (v_hs ->> 'montant')::numeric;
    v_elements := v_elements || jsonb_build_object('type', 'heures_sup', 'libelle', format('Heures supplémentaires (%s h)', trim_scale((v_hs ->> 'heures')::numeric)),
                                                   'montant', (v_hs ->> 'montant')::numeric, 'soumis', true);
  end if;

  select coalesce(sum(montant), 0) into v_avances from public.avances_salaire where employe_id = e.id and not annulee and paie_id is null;
  if e.declare_cnps then
    v_b := public.calculer_paie(e.ferme_id, e.salaire_mensuel, v_primes);
    v_legales := (v_b ->> 'total_retenues')::numeric;
  end if;
  v_net := e.salaire_mensuel + v_primes + v_indem - coalesce(p_retenues, 0) - v_avances - v_legales;
  if v_net < 0 then raise exception 'Les retenues et avances (% FCFA) dépassent le salaire du mois', v_avances + coalesce(p_retenues, 0) + v_legales; end if;

  delete from public.preparations_paie where employe_id = e.id and mois = v_mois and statut <> 'payee';
  insert into public.preparations_paie (ferme_id, employe_id, mois, salaire_base, elements, primes, indemnites, retenues, motif_retenues,
                                        avances, retenues_legales, net, calcul, prepare_par)
  values (e.ferme_id, e.id, v_mois, e.salaire_mensuel, v_elements, v_primes, v_indem, coalesce(p_retenues, 0),
          nullif(trim(coalesce(p_motif_retenues, '')), ''), v_avances, v_legales, v_net, v_b, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- overtime authorised after the preparation: the preparation must be done again (the amount changed)
create or replace function public.heures_sup_apres_preparation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.statut = 'autorisee' and old.statut is distinct from 'autorisee' then
    delete from public.preparations_paie where employe_id = new.employe_id and mois = date_trunc('month', new.date_jour)::date and statut <> 'payee';
    if found then
      perform public.notifier(new.ferme_id, 'finance', 'paie_a_refaire', 'Des heures supplémentaires viennent d''être autorisées : préparez de nouveau ce salaire', '/argent?tab=salaires');
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists heures_sup_apres_preparation on public.heures_sup;
create trigger heures_sup_apres_preparation after update of statut on public.heures_sup
  for each row execute function public.heures_sup_apres_preparation();

revoke all on public.presences, public.heures_sup from anon;
grant select on public.presences, public.heures_sup to authenticated;
revoke execute on function public.noter_presences(date, jsonb), public.declarer_heures_sup(uuid, date, numeric, text, text),
  public.decider_heures_sup(uuid[], boolean, text), public.calcul_heures_sup(uuid, date), public.resume_presences(uuid, date),
  public.mois_paie_ouvert(uuid, date), public.preparer_paie(uuid, date, jsonb, numeric, text) from public, anon;
grant execute on function public.noter_presences(date, jsonb), public.declarer_heures_sup(uuid, date, numeric, text, text),
  public.decider_heures_sup(uuid[], boolean, text), public.resume_presences(uuid, date), public.preparer_paie(uuid, date, jsonb, numeric, text) to authenticated;
revoke execute on function public.heures_sup_apres_preparation() from public, anon, authenticated;
