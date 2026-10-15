-- =====================================================================
-- HENZO – Fiches de paie (bulletins)
--   * Chaque salaire payé d'un employé déclaré à la CNPS donne un bulletin :
--     brut, CNPS salarié, IRPP + CAC, crédit foncier, redevance
--     audiovisuelle (RAV), taxe de développement local (TDL), retenues,
--     avances, net à payer ; et les charges de l'employeur (CNPS, crédit
--     foncier, FNE).
--   * La caisse ne paie que le NET. Les retenues et les charges sont « à
--     reverser » chaque mois : à la CNPS (cotisations) et aux impôts.
--   * Tous les taux et barèmes sont dans les paramètres de paie, modifiables
--     par la direction et la finance : valeurs courantes par défaut, À FAIRE
--     CONFIRMER par le comptable ou le CGA.
-- À exécuter une fois dans Supabase > SQL Editor, après 0035.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Employés et société
-- ---------------------------------------------------------------------
alter table public.employes add column declare_cnps boolean not null default true, add column numero_cnps text;
alter table public.fermes add column numero_cnps_employeur text;

-- La finance change le salaire, la caisse, la déclaration CNPS ; l'exploitation le reste (sans le salaire)
create or replace function public.controle_employe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r text := public.role_actuel()::text;
  v_fin text[] := array['salaire_mensuel', 'activite', 'notes', 'declare_cnps', 'numero_cnps'];
begin
  if auth.uid() is null then return new; end if;  -- administrateur (SQL Editor)
  if r = 'finance' and (to_jsonb(new) - v_fin) is distinct from (to_jsonb(old) - v_fin) then
    raise exception 'La finance change seulement le salaire, la caisse qui le paie et la déclaration CNPS : le nom, le poste et le départ sont gérés par Kenfack';
  end if;
  if r = 'exploitation' and (new.salaire_mensuel, new.activite, new.declare_cnps, new.numero_cnps)
                          is distinct from (old.salaire_mensuel, old.activite, old.declare_cnps, old.numero_cnps) then
    raise exception 'Le salaire et la déclaration CNPS sont gérés par la finance (Dahirou)';
  end if;
  return new;
end;
$$;

-- maj_societe connaît aussi le numéro d'employeur CNPS
create or replace function public.maj_societe(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.fermes;
  txt text[] := array['raison_sociale', 'niu', 'rccm', 'adresse_siege', 'telephone_societe', 'email_societe',
                      'banque_paiement', 'mentions_facture', 'numero_cnps_employeur'];
  k text;
begin
  if not public.a_role('directeur', 'finance') then raise exception 'Seuls la direction et la finance modifient la fiche société'; end if;
  select * into f from public.fermes where id = public.ferme_actuelle() for update;
  if f.id is null then raise exception 'Ferme introuvable'; end if;
  foreach k in array txt loop
    if p ? k then
      execute format('update public.fermes set %I = $1 where id = $2', k) using nullif(trim(p ->> k), ''), f.id;
    end if;
  end loop;
  update public.fermes set
    forme_juridique = coalesce(nullif(trim(p ->> 'forme_juridique'), ''), forme_juridique),
    capital_social  = case when p ? 'capital_social' then nullif(p ->> 'capital_social', '')::numeric else capital_social end,
    regime_fiscal   = coalesce(nullif(p ->> 'regime_fiscal', ''), regime_fiscal),
    adherent_cga    = coalesce((p ->> 'adherent_cga')::boolean, adherent_cga),
    assujetti_tva   = coalesce((p ->> 'assujetti_tva')::boolean, assujetti_tva),
    taux_tva        = coalesce(nullif(p ->> 'taux_tva', '')::numeric, taux_tva),
    taux_acompte    = coalesce(nullif(p ->> 'taux_acompte', '')::numeric, taux_acompte),
    taux_is         = coalesce(nullif(p ->> 'taux_is', '')::numeric, taux_is),
    prefixe_facture = coalesce(upper(nullif(trim(p ->> 'prefixe_facture'), '')), prefixe_facture)
  where id = f.id;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Paramètres de paie (une ligne par ferme)
--    Barèmes : liste de tranches {"jusqu_a": borne incluse ou null, "taux" | "montant"}
-- ---------------------------------------------------------------------
create table public.parametres_paie (
  ferme_id                  uuid primary key references public.fermes (id),
  plafond_cnps              numeric(14, 0) not null default 750000,
  taux_cnps_salarie         numeric(5, 2) not null default 4.2,     -- pension vieillesse, invalidité, décès
  taux_cnps_vieillesse_pat  numeric(5, 2) not null default 4.2,
  taux_allocations_fam      numeric(5, 2) not null default 7,       -- régime général (secteur agricole : à vérifier)
  taux_accidents_travail    numeric(5, 2) not null default 1.75,    -- selon le groupe de risque (1,75 / 2,5 / 5)
  taux_cfc_salarie          numeric(5, 2) not null default 1,
  taux_cfc_patronal         numeric(5, 2) not null default 1.5,
  taux_fne                  numeric(5, 2) not null default 1,
  taux_cac                  numeric(5, 2) not null default 10,      -- centimes additionnels sur l'IRPP
  abattement_frais          numeric(5, 2) not null default 30,      -- frais professionnels, % du brut
  abattement_annuel         numeric(14, 0) not null default 500000,
  seuil_irpp                numeric(14, 0) not null default 62000,  -- brut mensuel en dessous duquel pas d'IRPP
  bareme_irpp               jsonb not null default '[{"jusqu_a":2000000,"taux":10},{"jusqu_a":3000000,"taux":15},{"jusqu_a":5000000,"taux":25},{"jusqu_a":null,"taux":35}]',
  bareme_rav                jsonb not null default '[{"jusqu_a":50000,"montant":0},{"jusqu_a":100000,"montant":750},{"jusqu_a":200000,"montant":1950},{"jusqu_a":300000,"montant":3250},{"jusqu_a":400000,"montant":4550},{"jusqu_a":500000,"montant":5850},{"jusqu_a":600000,"montant":7150},{"jusqu_a":700000,"montant":8450},{"jusqu_a":800000,"montant":9750},{"jusqu_a":900000,"montant":11050},{"jusqu_a":1000000,"montant":12350},{"jusqu_a":null,"montant":13000}]',
  bareme_tdl                jsonb not null default '[{"jusqu_a":62000,"montant":0},{"jusqu_a":75000,"montant":250},{"jusqu_a":100000,"montant":500},{"jusqu_a":125000,"montant":750},{"jusqu_a":150000,"montant":1000},{"jusqu_a":200000,"montant":1250},{"jusqu_a":250000,"montant":1500},{"jusqu_a":300000,"montant":2000},{"jusqu_a":500000,"montant":2250},{"jusqu_a":null,"montant":2500}]',
  modifie_par               uuid references public.profiles (id),
  modifie_le                timestamptz
);
insert into public.parametres_paie (ferme_id) select id from public.fermes on conflict do nothing;

create function public.parametres_paie_nouvelle_ferme()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.parametres_paie (ferme_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
create trigger parametres_paie_nouvelle_ferme after insert on public.fermes
  for each row execute function public.parametres_paie_nouvelle_ferme();

create function public.maj_parametres_paie(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text;
  nums text[] := array['plafond_cnps', 'taux_cnps_salarie', 'taux_cnps_vieillesse_pat', 'taux_allocations_fam', 'taux_accidents_travail',
                       'taux_cfc_salarie', 'taux_cfc_patronal', 'taux_fne', 'taux_cac', 'abattement_frais', 'abattement_annuel', 'seuil_irpp'];
  barems text[] := array['bareme_irpp', 'bareme_rav', 'bareme_tdl'];
begin
  if not public.a_role('directeur', 'finance') then raise exception 'Seuls la direction et la finance modifient les paramètres de paie'; end if;
  insert into public.parametres_paie (ferme_id) values (public.ferme_actuelle()) on conflict do nothing;
  foreach k in array nums loop
    if p ? k and nullif(p ->> k, '') is not null then
      if (p ->> k)::numeric < 0 then raise exception 'Valeur négative impossible (%)', k; end if;
      execute format('update public.parametres_paie set %I = $1 where ferme_id = $2', k) using (p ->> k)::numeric, public.ferme_actuelle();
    end if;
  end loop;
  foreach k in array barems loop
    if p ? k then
      if jsonb_typeof(p -> k) <> 'array' or jsonb_array_length(p -> k) = 0 then raise exception 'Barème vide ou mal écrit (%)', k; end if;
      execute format('update public.parametres_paie set %I = $1 where ferme_id = $2', k) using p -> k, public.ferme_actuelle();
    end if;
  end loop;
  update public.parametres_paie set modifie_par = auth.uid(), modifie_le = now() where ferme_id = public.ferme_actuelle();
end;
$$;

-- Montant fixe d'un barème à tranches (première tranche dont la borne couvre la valeur)
create function public.bareme_montant(p_bareme jsonb, p_valeur numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce((
    select (t ->> 'montant')::numeric
    from jsonb_array_elements(p_bareme) with ordinality as x (t, i)
    where t ->> 'jusqu_a' is null or p_valeur <= (t ->> 'jusqu_a')::numeric
    order by i limit 1), 0)
$$;

-- Impôt progressif d'un barème à taux (tranches successives)
create function public.bareme_progressif(p_bareme jsonb, p_valeur numeric)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  t jsonb;
  v_bas numeric := 0;
  v_haut numeric;
  v_impot numeric := 0;
begin
  if p_valeur <= 0 then return 0; end if;
  for t in select x from jsonb_array_elements(p_bareme) x loop
    v_haut := (t ->> 'jusqu_a')::numeric;
    if v_haut is null or p_valeur <= v_haut then
      return v_impot + (p_valeur - v_bas) * (t ->> 'taux')::numeric / 100;
    end if;
    v_impot := v_impot + (v_haut - v_bas) * (t ->> 'taux')::numeric / 100;
    v_bas := v_haut;
  end loop;
  return v_impot;
end;
$$;

-- Calcul d'un bulletin (mois)
create function public.calculer_paie(p_ferme uuid, p_salaire_base numeric, p_primes numeric default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pp public.parametres_paie;
  v_brut numeric := coalesce(p_salaire_base, 0) + coalesce(p_primes, 0);
  v_base_cnps numeric;
  v_cnps numeric;
  v_imposable numeric;
  v_irpp numeric := 0;
  v_cac numeric;
  v_cfc numeric;
  v_rav numeric;
  v_tdl numeric;
  v_ret numeric;
  v_pat jsonb;
begin
  select * into pp from public.parametres_paie where ferme_id = p_ferme;
  if pp.ferme_id is null then insert into public.parametres_paie (ferme_id) values (p_ferme) returning * into pp; end if;
  v_base_cnps := least(v_brut, pp.plafond_cnps);
  v_cnps := round(v_base_cnps * pp.taux_cnps_salarie / 100);
  v_imposable := greatest(0, v_brut * 12 * (1 - pp.abattement_frais / 100) - v_cnps * 12 - pp.abattement_annuel);
  if v_brut >= pp.seuil_irpp then v_irpp := round(public.bareme_progressif(pp.bareme_irpp, v_imposable) / 12); end if;
  v_cac := round(v_irpp * pp.taux_cac / 100);
  v_cfc := round(v_brut * pp.taux_cfc_salarie / 100);
  v_rav := public.bareme_montant(pp.bareme_rav, v_brut);
  v_tdl := public.bareme_montant(pp.bareme_tdl, coalesce(p_salaire_base, 0));
  v_ret := v_cnps + v_irpp + v_cac + v_cfc + v_rav + v_tdl;
  v_pat := jsonb_build_object(
    'cnps_vieillesse_pat', round(v_base_cnps * pp.taux_cnps_vieillesse_pat / 100),
    'cnps_allocations', round(v_base_cnps * pp.taux_allocations_fam / 100),
    'cnps_accidents', round(v_base_cnps * pp.taux_accidents_travail / 100),
    'cfc_patronal', round(v_brut * pp.taux_cfc_patronal / 100),
    'fne', round(v_brut * pp.taux_fne / 100));
  return jsonb_build_object(
    'salaire_base', coalesce(p_salaire_base, 0), 'primes', coalesce(p_primes, 0), 'brut', v_brut, 'base_cnps', v_base_cnps,
    'cnps_salarie', v_cnps, 'revenu_imposable_annuel', round(v_imposable), 'irpp', v_irpp, 'cac', v_cac, 'cfc_salarie', v_cfc,
    'rav', v_rav, 'tdl', v_tdl, 'total_retenues', v_ret, 'net_avant_retenues', v_brut - v_ret)
    || v_pat
    || jsonb_build_object('total_patronal', (select sum(value::numeric) from jsonb_each_text(v_pat)));
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Bulletins
-- ---------------------------------------------------------------------
alter table public.paies drop column net;
alter table public.paies add column retenues_legales numeric(14, 0) not null default 0 check (retenues_legales >= 0);
alter table public.paies add column net numeric(14, 0) generated always as (salaire_base + primes - retenues - avances - retenues_legales) stored;
alter table public.paies add constraint paies_net_positif check (salaire_base + primes - retenues - avances - retenues_legales >= 0);

create table public.bulletins_paie (
  id                       uuid primary key default gen_random_uuid(),
  ferme_id                 uuid not null references public.fermes (id),
  paie_id                  uuid not null unique references public.paies (id),
  employe_id               uuid not null references public.employes (id),
  mois                     date not null,
  salaire_base             numeric(14, 0) not null,
  primes                   numeric(14, 0) not null,
  brut                     numeric(14, 0) not null,
  base_cnps                numeric(14, 0) not null,
  cnps_salarie             numeric(14, 0) not null,
  revenu_imposable_annuel  numeric(16, 0) not null,
  irpp                     numeric(14, 0) not null,
  cac                      numeric(14, 0) not null,
  cfc_salarie              numeric(14, 0) not null,
  rav                      numeric(14, 0) not null,
  tdl                      numeric(14, 0) not null,
  total_retenues           numeric(14, 0) not null,
  retenues_diverses        numeric(14, 0) not null,
  avances                  numeric(14, 0) not null,
  net_a_payer              numeric(14, 0) not null,
  cnps_vieillesse_pat      numeric(14, 0) not null,
  cnps_allocations         numeric(14, 0) not null,
  cnps_accidents           numeric(14, 0) not null,
  cfc_patronal             numeric(14, 0) not null,
  fne                      numeric(14, 0) not null,
  total_patronal           numeric(14, 0) not null,
  parametres               jsonb not null,           -- taux utilisés (trace)
  created_at               timestamptz not null default now()
);
create index on public.bulletins_paie (ferme_id, mois);

-- Aperçu avant de payer
create function public.simuler_paie(p_employe uuid, p_primes numeric default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.employes;
  v_avances numeric;
begin
  if not public.a_role('directeur', 'finance') then raise exception 'Réservé à la direction et à la finance'; end if;
  select * into e from public.employes where id = p_employe and ferme_id = public.ferme_actuelle();
  if e.id is null then raise exception 'Employé introuvable'; end if;
  select coalesce(sum(montant), 0) into v_avances from public.avances_salaire where employe_id = e.id and not annulee and paie_id is null;
  if not e.declare_cnps then
    return jsonb_build_object('declare_cnps', false, 'brut', e.salaire_mensuel + coalesce(p_primes, 0), 'total_retenues', 0, 'avances', v_avances);
  end if;
  return public.calculer_paie(e.ferme_id, e.salaire_mensuel, p_primes) || jsonb_build_object('declare_cnps', true, 'avances', v_avances);
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
  v_b jsonb;
  v_legales numeric := 0;
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
  if e.declare_cnps then
    v_b := public.calculer_paie(e.ferme_id, e.salaire_mensuel, coalesce(p_primes, 0));
    v_legales := (v_b ->> 'total_retenues')::numeric;
  end if;
  v_net := e.salaire_mensuel + coalesce(p_primes, 0) - coalesce(p_retenues, 0) - v_avances - v_legales;
  if v_net < 0 then
    raise exception 'Les retenues et avances (% FCFA) dépassent le salaire du mois', v_avances + coalesce(p_retenues, 0) + v_legales;
  end if;
  insert into public.paies (ferme_id, employe_id, mois, salaire_base, primes, retenues, motif_retenues, avances, retenues_legales, mode_paiement)
  values (e.ferme_id, e.id, v_mois, e.salaire_mensuel, coalesce(p_primes, 0), coalesce(p_retenues, 0),
          nullif(trim(coalesce(p_motif_retenues, '')), ''), v_avances, v_legales, p_mode)
  returning id into v_paie;
  if e.declare_cnps then
    insert into public.bulletins_paie (ferme_id, paie_id, employe_id, mois, salaire_base, primes, brut, base_cnps, cnps_salarie,
      revenu_imposable_annuel, irpp, cac, cfc_salarie, rav, tdl, total_retenues, retenues_diverses, avances, net_a_payer,
      cnps_vieillesse_pat, cnps_allocations, cnps_accidents, cfc_patronal, fne, total_patronal, parametres)
    select e.ferme_id, v_paie, e.id, v_mois, (v_b ->> 'salaire_base')::numeric, (v_b ->> 'primes')::numeric, (v_b ->> 'brut')::numeric,
      (v_b ->> 'base_cnps')::numeric, (v_b ->> 'cnps_salarie')::numeric, (v_b ->> 'revenu_imposable_annuel')::numeric,
      (v_b ->> 'irpp')::numeric, (v_b ->> 'cac')::numeric, (v_b ->> 'cfc_salarie')::numeric, (v_b ->> 'rav')::numeric,
      (v_b ->> 'tdl')::numeric, v_legales, coalesce(p_retenues, 0), v_avances, v_net,
      (v_b ->> 'cnps_vieillesse_pat')::numeric, (v_b ->> 'cnps_allocations')::numeric, (v_b ->> 'cnps_accidents')::numeric,
      (v_b ->> 'cfc_patronal')::numeric, (v_b ->> 'fne')::numeric, (v_b ->> 'total_patronal')::numeric,
      to_jsonb(pp) - 'ferme_id' - 'modifie_par' - 'modifie_le'
    from public.parametres_paie pp where pp.ferme_id = e.ferme_id;
  end if;
  if v_net > 0 then
    insert into public.depenses (ferme_id, date_depense, portee, activite, categorie, libelle, montant, mode_paiement, notes)
    values (e.ferme_id, current_date, 'generale', e.activite, 'salaires',
            format('Salaire %s – %s', to_char(v_mois, 'MM/YYYY'), e.nom), v_net, p_mode,
            nullif(concat_ws(' · ', case when v_avances > 0 then format('Avances déduites : %s FCFA', v_avances) end,
                                    case when v_legales > 0 then format('Retenues CNPS et impôts : %s FCFA (à reverser)', v_legales) end), ''))
    returning id into v_dep;
    update public.paies set depense_id = v_dep where id = v_paie;
  end if;
  update public.avances_salaire set paie_id = v_paie where employe_id = e.id and not annulee and paie_id is null;
  return v_paie;
end;
$$;

-- À reverser chaque mois : à la CNPS (cotisations salarié + employeur) et aux impôts (IRPP, CAC, CFC, FNE, RAV, TDL)
create view public.charges_salaires_mensuelles with (security_invoker = true) as
select b.ferme_id, b.mois,
       count(*) as bulletins,
       sum(b.brut) as masse_brute,
       sum(b.cnps_salarie + b.cnps_vieillesse_pat + b.cnps_allocations + b.cnps_accidents) as a_reverser_cnps,
       sum(b.irpp + b.cac + b.cfc_salarie + b.cfc_patronal + b.fne + b.rav + b.tdl) as a_reverser_impots,
       sum(b.total_patronal) as charges_patronales
from public.bulletins_paie b
join public.paies p on p.id = b.paie_id and not p.annulee
group by b.ferme_id, b.mois;

-- ---------------------------------------------------------------------
-- 4. Reverser à la CNPS et aux impôts (paiements_impots)
-- ---------------------------------------------------------------------
alter table public.paiements_impots drop constraint paiements_impots_type_impot_check;
alter table public.paiements_impots add constraint paiements_impots_type_impot_check
  check (type_impot in ('acompte_is', 'solde_is', 'igs', 'tva', 'patente', 'cnps', 'impots_salaires', 'autre'));

create or replace function public.payer_impot(p_type text, p_periode date, p_montant numeric, p_mode public.mode_paiement,
                                   p_activite public.activite default 'chair', p_date date default current_date, p_reference text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dep uuid;
  v_id uuid;
  v_lib text;
begin
  if not public.a_role('directeur', 'finance') then raise exception 'Seuls la direction et la finance paient les impôts'; end if;
  if coalesce(p_montant, 0) <= 0 then raise exception 'Indiquez le montant payé'; end if;
  v_lib := case p_type when 'acompte_is' then 'Acompte d''impôt' when 'solde_is' then 'Solde de l''impôt sur les sociétés'
                       when 'igs' then 'Impôt général synthétique' when 'tva' then 'TVA' when 'patente' then 'Patente'
                       when 'cnps' then 'Cotisations CNPS' when 'impots_salaires' then 'Impôts sur salaires (IRPP, CAC, CFC, FNE, RAV, TDL)'
                       else 'Impôt' end
           || ' – ' || to_char(p_periode, 'MM/YYYY') || coalesce(' (quittance ' || nullif(trim(p_reference), '') || ')', '');
  insert into public.depenses (ferme_id, date_depense, portee, activite, categorie, libelle, montant, mode_paiement, montant_paye, saisi_par)
  values (public.ferme_actuelle(), coalesce(p_date, current_date), 'generale', p_activite,
          case when p_type = 'cnps' then 'cotisations_sociales' else 'impots_taxes' end, v_lib, p_montant, p_mode, p_montant, auth.uid())
  returning id into v_dep;
  insert into public.paiements_impots (ferme_id, type_impot, periode, montant, date_paiement, reference, depense_id)
  values (public.ferme_actuelle(), p_type, date_trunc('month', p_periode)::date, p_montant, coalesce(p_date, current_date),
          nullif(trim(coalesce(p_reference, '')), ''), v_dep)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Droits
-- ---------------------------------------------------------------------
alter table public.parametres_paie enable row level security;
alter table public.bulletins_paie enable row level security;
create policy parametres_paie_select on public.parametres_paie for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance'));
create policy bulletins_select on public.bulletins_paie for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance'));

revoke all on public.parametres_paie, public.bulletins_paie, public.charges_salaires_mensuelles from anon;
revoke insert, update, delete on public.parametres_paie, public.bulletins_paie from authenticated;
revoke execute on function public.parametres_paie_nouvelle_ferme(), public.calculer_paie(uuid, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.maj_parametres_paie(jsonb), public.simuler_paie(uuid, numeric) from public, anon;
grant execute on function public.maj_parametres_paie(jsonb), public.simuler_paie(uuid, numeric) to authenticated;
