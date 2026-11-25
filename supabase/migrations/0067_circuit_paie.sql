-- =====================================================================
-- HENZO – 0067 : Ressources humaines, étape 1 : circuit de paie
--
-- 1. Fiches employés : Dahirou (finance) gère tout (création, nom, poste,
--    départ, salaire, CNPS), Ali (directeur) aussi. Kenfack voit l'équipe
--    (sans salaires) mais ne modifie plus les fiches.
-- 2. Paie en trois temps, chaque mois :
--      Dahirou PRÉPARE (primes, indemnités, retenues ; le bulletin est
--      calculé tout de suite pour vérification)  →  Ali VALIDE  →
--      Dahirou PAIE. Le paiement passe par le même chemin qu'avant :
--      dépense « Salaires », caisse, bulletin, comptabilité. Une
--      préparation n'est jamais comptée en Finance : pas de double compte.
-- 3. Primes et indemnités détaillées : une prime est soumise à la CNPS et
--    à l'impôt ; une indemnité peut ne pas l'être (transport, logement…).
-- 4. Clôture du mois par Ali : après clôture, plus de préparation ni
--    d'annulation pour ce mois ; une erreur se corrige par une
--    « régularisation » sur un prochain salaire (trace complète).
-- 5. L'ancien paiement direct (payer_salaire) est fermé.
-- Relançable sans erreur.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Employee files: finance and director
-- ---------------------------------------------------------------------
drop policy if exists employes_all on public.employes;
drop policy if exists employes_update on public.employes;
create policy employes_update on public.employes for update to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance'));

create or replace function public.controle_employe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then return new; end if;  -- administrateur (SQL Editor)
  if new.categorie is distinct from old.categorie then raise exception 'Un employé ne change pas de liste (ferme / bureau)'; end if;
  if not public.a_role('directeur', 'finance') then
    raise exception 'Les fiches du personnel sont gérées par la finance (Dahirou) et la direction';
  end if;
  return new;
end;
$$;

create or replace function public.ajouter_employe(p_nom text, p_telephone text default null, p_poste text default null, p_date_embauche date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.a_role('directeur', 'finance') then raise exception 'Les fiches du personnel sont gérées par la finance (Dahirou) et la direction'; end if;
  if coalesce(trim(p_nom), '') = '' then raise exception 'Indiquez le nom de l''employé'; end if;
  insert into public.employes (ferme_id, nom, telephone, poste, date_embauche, salaire_mensuel, categorie)
  values (public.ferme_actuelle(), trim(p_nom), nullif(trim(p_telephone), ''), nullif(trim(p_poste), ''), p_date_embauche, 0, 'ferme')
  returning id into v_id;
  perform public.notifier(public.ferme_actuelle(), 'exploitation', 'nouvel_employe',
    format('Nouvel employé à la ferme : %s%s', trim(p_nom), coalesce(' (' || nullif(trim(p_poste), '') || ')', '')), '/ferme');
  return v_id;
end;
$$;

create or replace function public.modifier_employe(p_id uuid, p_nom text, p_telephone text, p_poste text, p_actif boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.employes;
begin
  if not public.a_role('directeur', 'finance') then raise exception 'Les fiches du personnel sont gérées par la finance (Dahirou) et la direction'; end if;
  select * into e from public.employes where id = p_id and ferme_id = public.ferme_actuelle() for update;
  if e.id is null then raise exception 'Employé introuvable'; end if;
  if coalesce(trim(p_nom), '') = '' then raise exception 'Indiquez le nom de l''employé'; end if;
  update public.employes set nom = trim(p_nom), telephone = nullif(trim(p_telephone), ''), poste = nullif(trim(p_poste), ''), actif = coalesce(p_actif, e.actif)
  where id = e.id;
  if e.categorie = 'ferme' and e.actif and not coalesce(p_actif, true) then
    perform public.notifier(e.ferme_id, 'exploitation', 'depart_employe', format('%s ne travaille plus à la ferme.', e.nom), '/ferme');
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Pay months (closing) and prepared pays
-- ---------------------------------------------------------------------
create table if not exists public.periodes_paie (
  ferme_id     uuid not null references public.fermes (id),
  mois         date not null check (extract(day from mois) = 1),
  cloturee     boolean not null default false,
  cloturee_par uuid references public.profiles (id),
  cloturee_le  timestamptz,
  primary key (ferme_id, mois)
);
alter table public.periodes_paie enable row level security;
drop policy if exists periodes_paie_select on public.periodes_paie;
create policy periodes_paie_select on public.periodes_paie for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance', 'comptable'));

create table if not exists public.preparations_paie (
  id              uuid primary key default gen_random_uuid(),
  ferme_id        uuid not null references public.fermes (id),
  employe_id      uuid not null references public.employes (id),
  mois            date not null check (extract(day from mois) = 1),
  statut          text not null default 'preparee' check (statut in ('preparee', 'validee', 'payee')),
  salaire_base    numeric(14, 0) not null check (salaire_base >= 0),
  elements        jsonb not null default '[]',      -- [{type, libelle, montant, soumis}]
  primes          numeric(14, 0) not null default 0, -- soumis à la CNPS et à l'impôt
  indemnites      numeric(14, 0) not null default 0, -- non soumises
  retenues        numeric(14, 0) not null default 0,
  motif_retenues  text,
  avances         numeric(14, 0) not null default 0,
  retenues_legales numeric(14, 0) not null default 0,
  net             numeric(14, 0) not null check (net >= 0),
  calcul          jsonb,                             -- bulletin calculé (employé déclaré à la CNPS)
  prepare_par     uuid not null references public.profiles (id),
  prepare_le      timestamptz not null default now(),
  valide_par      uuid references public.profiles (id),
  valide_le       timestamptz,
  paie_id         uuid references public.paies (id),
  paye_par        uuid references public.profiles (id),
  paye_le         timestamptz
);
create unique index if not exists preparations_paie_unique on public.preparations_paie (employe_id, mois);
alter table public.preparations_paie enable row level security;
drop policy if exists preparations_paie_select on public.preparations_paie;
create policy preparations_paie_select on public.preparations_paie for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance'));
drop trigger if exists journal on public.preparations_paie;
create trigger journal after insert or update on public.preparations_paie for each row execute function public.journaliser();
drop trigger if exists journal on public.periodes_paie;
revoke all on public.preparations_paie, public.periodes_paie from anon;
grant select on public.preparations_paie, public.periodes_paie to authenticated;

-- the detail of primes and indemnities is printed on the payslip
alter table public.bulletins_paie add column if not exists indemnites numeric(14, 0) not null default 0;
alter table public.bulletins_paie add column if not exists elements jsonb not null default '[]';

create or replace function public.mois_paie_cloture(p_ferme uuid, p_mois date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select coalesce((select cloturee from public.periodes_paie where ferme_id = p_ferme and mois = date_trunc('month', p_mois)::date), false) $$;

-- ---------------------------------------------------------------------
-- 3. Dahirou prepares (or prepares again, as long as it is not paid)
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
    if v_type not in ('prime', 'indemnite', 'heures_sup', 'regularisation') then raise exception 'Élément de paie inconnu : %', v_type; end if;
    v_montant := round(coalesce((el ->> 'montant')::numeric, 0));
    if v_montant <= 0 then continue; end if;
    if coalesce(trim(el ->> 'libelle'), '') = '' then raise exception 'Donnez un nom à chaque prime ou indemnité'; end if;
    -- a bonus, overtime or a correction is subject to CNPS and tax; an allowance only if said so
    v_soumis := case when v_type = 'indemnite' then coalesce((el ->> 'soumis')::boolean, false) else true end;
    if v_soumis then v_primes := v_primes + v_montant; else v_indem := v_indem + v_montant; end if;
    v_elements := v_elements || jsonb_build_object('type', v_type, 'libelle', trim(el ->> 'libelle'), 'montant', v_montant, 'soumis', v_soumis);
  end loop;

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

-- Dahirou removes a preparation that is not paid (Ali must then validate again)
create or replace function public.retirer_preparation_paie(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.a_role('directeur', 'finance') then raise exception 'La paie est préparée par la finance (Dahirou)'; end if;
  delete from public.preparations_paie where id = p_id and ferme_id = public.ferme_actuelle() and statut <> 'payee';
  if not found then raise exception 'Préparation introuvable ou déjà payée'; end if;
end;
$$;

-- Dahirou sends the month to Ali
create or replace function public.envoyer_paie_validation(p_mois date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
  v_total numeric;
begin
  if not public.a_role('finance') then raise exception 'C''est la finance (Dahirou) qui envoie la paie à valider'; end if;
  select count(*), coalesce(sum(net), 0) into n, v_total from public.preparations_paie
  where ferme_id = public.ferme_actuelle() and mois = date_trunc('month', p_mois)::date and statut = 'preparee';
  if n = 0 then raise exception 'Aucune paie préparée à envoyer pour ce mois'; end if;
  perform public.notifier(public.ferme_actuelle(), 'directeur', 'paie_a_valider',
    format('Paie de %s à valider : %s salaire(s), %s FCFA nets', to_char(date_trunc('month', p_mois), 'MM/YYYY'), n, public.en_fcfa(v_total)), '/argent?tab=salaires');
  return n;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Ali validates, Dahirou pays
-- ---------------------------------------------------------------------
create or replace function public.valider_paie(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if not public.a_role('directeur') then raise exception 'Seul le directeur (Ali) valide la paie'; end if;
  update public.preparations_paie set statut = 'validee', valide_par = auth.uid(), valide_le = now()
  where id = any (p_ids) and ferme_id = public.ferme_actuelle() and statut = 'preparee';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Aucune paie préparée à valider'; end if;
  perform public.notifier(public.ferme_actuelle(), 'finance', 'paie_validee', format('Ali a validé %s salaire(s) : vous pouvez payer', n), '/argent?tab=salaires');
  return n;
end;
$$;

create or replace function public.payer_paie(p_id uuid, p_mode public.mode_paiement, p_date date default current_date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr public.preparations_paie;
  e public.employes;
  v_avances numeric;
  v_paie uuid;
  v_dep uuid;
  v_b jsonb;
begin
  if not public.a_role('finance') then raise exception 'Seule la finance (Dahirou) paie les salaires'; end if;
  select * into pr from public.preparations_paie where id = p_id and ferme_id = public.ferme_actuelle() for update;
  if pr.id is null then raise exception 'Paie introuvable'; end if;
  if pr.statut = 'payee' then raise exception 'Ce salaire est déjà payé'; end if;
  if pr.statut <> 'validee' then raise exception 'Ce salaire doit d''abord être validé par Ali'; end if;
  if public.mois_paie_cloture(pr.ferme_id, pr.mois) then raise exception 'La paie de ce mois est clôturée'; end if;
  if exists (select 1 from public.paies where employe_id = pr.employe_id and mois = pr.mois and not annulee) then
    raise exception 'Le salaire de ce mois est déjà payé';
  end if;
  select * into e from public.employes where id = pr.employe_id;
  -- the advances must be the ones Ali saw
  select coalesce(sum(montant), 0) into v_avances from public.avances_salaire
  where employe_id = e.id and not annulee and paie_id is null and created_at <= pr.prepare_le;
  if v_avances <> pr.avances then raise exception 'Les avances de % ont changé depuis la préparation : préparez de nouveau', e.nom; end if;

  insert into public.paies (ferme_id, employe_id, mois, salaire_base, primes, retenues, motif_retenues, avances, retenues_legales, mode_paiement)
  values (pr.ferme_id, e.id, pr.mois, pr.salaire_base, pr.primes + pr.indemnites, pr.retenues, pr.motif_retenues, pr.avances, pr.retenues_legales, p_mode)
  returning id into v_paie;

  v_b := pr.calcul;
  if v_b is not null then
    insert into public.bulletins_paie (ferme_id, paie_id, employe_id, mois, salaire_base, primes, brut, base_cnps, cnps_salarie,
      revenu_imposable_annuel, irpp, cac, cfc_salarie, rav, tdl, total_retenues, retenues_diverses, avances, net_a_payer,
      cnps_vieillesse_pat, cnps_allocations, cnps_accidents, cfc_patronal, fne, total_patronal, parametres, indemnites, elements)
    select pr.ferme_id, v_paie, e.id, pr.mois, (v_b ->> 'salaire_base')::numeric, (v_b ->> 'primes')::numeric, (v_b ->> 'brut')::numeric,
      (v_b ->> 'base_cnps')::numeric, (v_b ->> 'cnps_salarie')::numeric, (v_b ->> 'revenu_imposable_annuel')::numeric,
      (v_b ->> 'irpp')::numeric, (v_b ->> 'cac')::numeric, (v_b ->> 'cfc_salarie')::numeric, (v_b ->> 'rav')::numeric,
      (v_b ->> 'tdl')::numeric, pr.retenues_legales, pr.retenues, pr.avances, pr.net,
      (v_b ->> 'cnps_vieillesse_pat')::numeric, (v_b ->> 'cnps_allocations')::numeric, (v_b ->> 'cnps_accidents')::numeric,
      (v_b ->> 'cfc_patronal')::numeric, (v_b ->> 'fne')::numeric, (v_b ->> 'total_patronal')::numeric,
      to_jsonb(pp) - 'ferme_id' - 'modifie_par' - 'modifie_le', pr.indemnites, pr.elements
    from public.parametres_paie pp where pp.ferme_id = public.societe_de(pr.ferme_id);
  end if;

  if pr.net > 0 then
    insert into public.depenses (ferme_id, date_depense, portee, activite, categorie, libelle, montant, mode_paiement, notes)
    values (pr.ferme_id, coalesce(p_date, current_date), 'generale', e.activite, 'salaires',
            format('Salaire %s – %s', to_char(pr.mois, 'MM/YYYY'), e.nom), pr.net, p_mode,
            nullif(concat_ws(' · ', case when pr.avances > 0 then format('Avances déduites : %s FCFA', pr.avances) end,
                                    case when pr.retenues_legales > 0 then format('Retenues CNPS et impôts : %s FCFA (à reverser)', pr.retenues_legales) end), ''))
    returning id into v_dep;
    update public.paies set depense_id = v_dep where id = v_paie;
  end if;
  update public.avances_salaire set paie_id = v_paie
  where employe_id = e.id and not annulee and paie_id is null and created_at <= pr.prepare_le;
  update public.preparations_paie set statut = 'payee', paie_id = v_paie, paye_par = auth.uid(), paye_le = now() where id = pr.id;
  return v_paie;
end;
$$;

-- the direct payment of the past is closed: everything goes through prepare → validate → pay
create or replace function public.payer_salaire(p_employe uuid, p_mois date, p_mode public.mode_paiement,
                                     p_primes numeric default 0, p_retenues numeric default 0, p_motif_retenues text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Le salaire passe maintenant par trois étapes : Dahirou prépare, Ali valide, Dahirou paie';
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Ali closes the month; a closed month cannot be cancelled any more
-- ---------------------------------------------------------------------
create or replace function public.cloturer_mois_paie(p_mois date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mois date := date_trunc('month', p_mois)::date;
  n integer;
begin
  if not public.a_role('directeur') then raise exception 'Seul le directeur (Ali) clôture la paie du mois'; end if;
  select count(*) into n from public.preparations_paie where ferme_id = public.ferme_actuelle() and mois = v_mois and statut <> 'payee';
  if n > 0 then raise exception 'Il reste % salaire(s) préparé(s) ou validé(s) mais pas payé(s) pour ce mois', n; end if;
  insert into public.periodes_paie (ferme_id, mois, cloturee, cloturee_par, cloturee_le)
  values (public.ferme_actuelle(), v_mois, true, auth.uid(), now())
  on conflict (ferme_id, mois) do update set cloturee = true, cloturee_par = auth.uid(), cloturee_le = now();
  perform public.notifier(public.ferme_actuelle(), 'finance', 'paie_cloturee', format('La paie de %s est clôturée', to_char(v_mois, 'MM/YYYY')), '/argent?tab=salaires');
end;
$$;

create or replace function public.controle_annulation_salaire_cloture()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mois date;
begin
  if new.annulee and not old.annulee and old.categorie = 'salaires' then
    select mois into v_mois from public.paies where depense_id = old.id;
    if v_mois is not null and public.mois_paie_cloture(old.ferme_id, v_mois) then
      raise exception 'La paie de % est clôturée : corrigez par une régularisation sur un prochain salaire', to_char(v_mois, 'MM/YYYY');
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists controle_salaire_cloture on public.depenses;
create trigger controle_salaire_cloture before update of annulee on public.depenses
  for each row execute function public.controle_annulation_salaire_cloture();

-- a cancelled salary can be prepared again
create or replace function public.preparation_apres_annulation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.annulee and not old.annulee then
    delete from public.preparations_paie where paie_id = new.id;
  end if;
  return null;
end;
$$;
drop trigger if exists preparation_apres_annulation on public.paies;
create trigger preparation_apres_annulation after update of annulee on public.paies
  for each row execute function public.preparation_apres_annulation();

revoke execute on function public.preparer_paie(uuid, date, jsonb, numeric, text), public.retirer_preparation_paie(uuid),
  public.envoyer_paie_validation(date), public.valider_paie(uuid[]), public.payer_paie(uuid, public.mode_paiement, date),
  public.cloturer_mois_paie(date), public.mois_paie_cloture(uuid, date) from public, anon;
grant execute on function public.preparer_paie(uuid, date, jsonb, numeric, text), public.retirer_preparation_paie(uuid),
  public.envoyer_paie_validation(date), public.valider_paie(uuid[]), public.payer_paie(uuid, public.mode_paiement, date),
  public.cloturer_mois_paie(date), public.mois_paie_cloture(uuid, date) to authenticated;
revoke execute on function public.controle_annulation_salaire_cloture(), public.preparation_apres_annulation() from public, anon, authenticated;
