-- =====================================================================
-- HENZO – Plusieurs sites pour une même société (ex. HENZO SARL :
-- Yaoundé et Garoua)
--   * Un site = une ferme rattachée à la société (fermes.societe_id).
--     Chaque site garde ses bandes, son stock, ses caisses, ses employés.
--   * Partagés par tous les sites de la société : la fiche société (NIU,
--     RCCM, régime, taux), la numérotation des factures, les paramètres de
--     paie, le plan comptable.
--   * Vue « toute la société » : impôts (chiffre d'affaires, acomptes,
--     estimation) et comptabilité (journal, balance, résultat, bilan) de
--     tous les sites ensemble.
-- À exécuter une fois dans Supabase > SQL Editor, après 0038.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Sites
-- ---------------------------------------------------------------------
alter table public.fermes add column societe_id uuid references public.fermes (id);
alter table public.fermes add constraint fermes_site_check check (societe_id is null or societe_id <> id);

-- La société d'une ferme (elle-même si ce n'est pas un site)
create function public.societe_de(p_ferme uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$ select coalesce(societe_id, id) from public.fermes where id = p_ferme $$;

-- Tous les sites d'une société (y compris le site principal)
create function public.sites_de(p_ferme uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$ select id from public.fermes where coalesce(societe_id, id) = public.societe_de(p_ferme) $$;

drop function if exists public.creer_ferme(text, text);
create function public.creer_ferme(p_nom text, p_type text default 'elevage', p_site_de uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old uuid := public.ferme_actuelle();
  v_new uuid;
  v_soc uuid;
begin
  if not public.a_role('directeur') then raise exception 'Seul le directeur crée une société ou un site'; end if;
  if coalesce(trim(p_nom), '') = '' then raise exception 'Indiquez le nom'; end if;
  if coalesce(p_type, 'elevage') not in ('elevage', 'negoce') then raise exception 'Type inconnu'; end if;
  if p_site_de is not null then
    if not exists (select 1 from public.membres_fermes where user_id = auth.uid() and ferme_id = p_site_de and role = 'directeur') then
      raise exception 'Vous devez être directeur de la société pour lui ajouter un site';
    end if;
    if (select type_activite from public.fermes where id = p_site_de) <> 'elevage' then raise exception 'Un site s''ajoute à une société d''élevage'; end if;
    v_soc := public.societe_de(p_site_de);
  end if;
  insert into public.fermes (nom, type_activite, societe_id, seuil_validation_depense, taux_investisseurs, seuil_mortalite_pct, alerte_autonomie_jours,
                             seuil_tiers_obligatoire, session_minutes, oeufs_par_plateau)
  select trim(p_nom), case when v_soc is not null then 'elevage' else coalesce(p_type, 'elevage') end, v_soc,
         seuil_validation_depense, taux_investisseurs, seuil_mortalite_pct, alerte_autonomie_jours,
         seuil_tiers_obligatoire, session_minutes, oeufs_par_plateau
  from public.fermes where id = coalesce(v_soc, v_old)
  returning id into v_new;
  insert into public.caisses (ferme_id, activite, mode)
  select v_new, a, m from unnest(enum_range(null::public.activite)) a, unnest(enum_range(null::public.mode_paiement)) m;
  if v_soc is not null or coalesce(p_type, 'elevage') = 'elevage' then
    insert into public.modeles_taches (ferme_id, type_production, jour, type_tache, titre, produit, assigne_role, repeter_jours, actif)
    select v_new, type_production, jour, type_tache, titre, produit, assigne_role, repeter_jours, actif
    from public.modeles_taches where ferme_id = coalesce(v_soc, v_old);
  end if;
  -- un site reprend le plan comptable de sa société
  if v_soc is not null then
    update public.plan_comptable n set numero = s.numero, intitule = s.intitule
    from public.plan_comptable s where s.ferme_id = v_soc and s.cle = n.cle and n.ferme_id = v_new;
  end if;
  insert into public.membres_fermes (user_id, ferme_id, role) values (auth.uid(), v_new, 'directeur');
  return v_new;
end;
$$;
revoke execute on function public.creer_ferme(text, text, uuid) from public, anon;
grant execute on function public.creer_ferme(text, text, uuid) to authenticated;

create or replace function public.mes_societes()
returns table (ferme_id uuid, nom text, type_activite text, role public.role_utilisateur, active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.nom, f.type_activite, m.role, f.id = p.ferme_id
  from public.membres_fermes m
  join public.fermes f on f.id = m.ferme_id
  join public.profiles p on p.id = m.user_id
  where m.user_id = auth.uid() and p.actif
  order by f.created_at
$$;

-- Fiche de la société (pour un site : celle de sa société)
create function public.fiche_societe(p_ferme uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cible uuid := coalesce(p_ferme, public.ferme_actuelle());
  f public.fermes;
begin
  if public.ferme_actuelle() is null or public.societe_de(v_cible) is distinct from public.societe_de(public.ferme_actuelle()) then
    raise exception 'Société introuvable';
  end if;
  select * into f from public.fermes where id = public.societe_de(v_cible);
  return jsonb_build_object(
    'id', f.id, 'nom', f.nom, 'raison_sociale', f.raison_sociale, 'forme_juridique', f.forme_juridique, 'capital_social', f.capital_social,
    'niu', f.niu, 'rccm', f.rccm, 'adresse_siege', f.adresse_siege, 'telephone_societe', f.telephone_societe, 'email_societe', f.email_societe,
    'banque_paiement', f.banque_paiement, 'mentions_facture', f.mentions_facture, 'numero_cnps_employeur', f.numero_cnps_employeur,
    'prefixe_facture', f.prefixe_facture, 'regime_fiscal', f.regime_fiscal, 'adherent_cga', f.adherent_cga, 'assujetti_tva', f.assujetti_tva,
    'taux_tva', f.taux_tva, 'taux_acompte', f.taux_acompte, 'taux_is', f.taux_is,
    'site', (select nom from public.fermes where id = v_cible), 'nombre_sites', (select count(*) from public.sites_de(v_cible)));
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Factures : une seule numérotation et une seule identité pour la société
-- ---------------------------------------------------------------------
create or replace function public.creer_facture(p_ventes uuid[], p_date date default current_date, p_client_nom text default null, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.fermes;
  s public.fermes;
  v public.ventes;
  c public.tiers;
  v_client uuid;
  v_n integer;
  v_annee integer := extract(year from coalesce(p_date, current_date))::integer;
  v_seq integer;
  v_ttc numeric := 0;
  v_ht numeric;
  v_id uuid;
  v_ordre integer := 0;
  v_derniere date;
begin
  if not public.a_role('directeur', 'exploitation', 'finance') then raise exception 'Vous ne pouvez pas faire de facture'; end if;
  if coalesce(array_length(p_ventes, 1), 0) = 0 then raise exception 'Choisissez au moins une vente à facturer'; end if;
  select * into f from public.fermes where id = public.ferme_actuelle();
  select * into s from public.fermes where id = public.societe_de(f.id) for update;   -- un seul numéro à la fois, pour toute la société
  select count(*), count(distinct coalesce(client_id::text, '-')), max(client_id::text)::uuid into v_n, v_seq, v_client
  from public.ventes where id = any (p_ventes) and ferme_id = f.id and not annulee;
  if v_n <> array_length(p_ventes, 1) then raise exception 'Vente introuvable ou annulée'; end if;
  if v_seq > 1 then raise exception 'Une facture ne regroupe que les ventes d''un même client'; end if;
  if exists (select 1 from public.facture_lignes where vente_id = any (p_ventes) and active) then
    raise exception 'Une de ces ventes est déjà facturée';
  end if;
  if v_client is null and coalesce(trim(p_client_nom), '') = '' then raise exception 'Indiquez le nom du client'; end if;
  select max(date_facture) into v_derniere from public.factures where ferme_id in (select public.sites_de(f.id)) and annee = v_annee;
  if v_derniere is not null and coalesce(p_date, current_date) < v_derniere then
    raise exception 'La date ne peut pas être avant la dernière facture (%)', to_char(v_derniere, 'DD/MM/YYYY');
  end if;
  select * into c from public.tiers where id = v_client;
  select coalesce(sum(montant), 0) into v_ttc from public.ventes where id = any (p_ventes);
  if s.assujetti_tva then v_ht := round(v_ttc / (1 + s.taux_tva / 100)); else v_ht := v_ttc; end if;
  select coalesce(max(sequence), 0) + 1 into v_seq from public.factures where ferme_id in (select public.sites_de(f.id)) and annee = v_annee;
  insert into public.factures (ferme_id, numero, annee, sequence, date_facture, client_id, client_nom, client_niu, client_rccm,
                               client_adresse, client_telephone, tva_applicable, taux_tva, total_ht, total_tva, total_ttc, notes)
  values (f.id, s.prefixe_facture || '-' || v_annee || '-' || lpad(v_seq::text, 4, '0'), v_annee, v_seq, coalesce(p_date, current_date),
          v_client, coalesce(c.nom, trim(p_client_nom)), c.niu, c.rccm, c.adresse, c.telephone,
          s.assujetti_tva, case when s.assujetti_tva then s.taux_tva else 0 end, v_ht, v_ttc - v_ht, v_ttc, nullif(trim(coalesce(p_notes, '')), ''))
  returning id into v_id;
  for v in select * from public.ventes where id = any (p_ventes) order by date_vente, created_at loop
    v_ordre := v_ordre + 1;
    insert into public.facture_lignes (facture_id, ferme_id, ordre, designation, quantite, unite, prix_unitaire, montant, vente_id)
    values (v_id, f.id, v_ordre, public.designation_vente(v), v.quantite, v.unite, v.prix_unitaire, v.montant, v.id);
  end loop;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Fiche société, paramètres de paie et plan comptable partagés
-- ---------------------------------------------------------------------
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
  select * into f from public.fermes where id = public.societe_de(public.ferme_actuelle()) for update;
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

create or replace function public.calculer_paie(p_ferme uuid, p_salaire_base numeric, p_primes numeric default 0)
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
  select * into pp from public.parametres_paie where ferme_id = public.societe_de(p_ferme);
  if pp.ferme_id is null then insert into public.parametres_paie (ferme_id) values (public.societe_de(p_ferme)) returning * into pp; end if;
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
    from public.parametres_paie pp where pp.ferme_id = public.societe_de(e.ferme_id);
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

create or replace function public.maj_parametres_paie(p jsonb)
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
  insert into public.parametres_paie (ferme_id) values (public.societe_de(public.ferme_actuelle())) on conflict do nothing;
  foreach k in array nums loop
    if p ? k and nullif(p ->> k, '') is not null then
      if (p ->> k)::numeric < 0 then raise exception 'Valeur négative impossible (%)', k; end if;
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

create or replace function public.maj_compte(p_cle text, p_numero text, p_intitule text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.a_role('directeur', 'finance') then raise exception 'Seuls la direction et la finance modifient le plan comptable'; end if;
  if trim(coalesce(p_numero, '')) !~ '^[1-9][0-9]{1,9}$' then raise exception 'Numéro de compte invalide (chiffres seulement, ex. 6022)'; end if;
  update public.plan_comptable set numero = trim(p_numero), intitule = coalesce(nullif(trim(p_intitule), ''), intitule)
  where ferme_id in (select public.sites_de(public.ferme_actuelle())) and cle = p_cle;
  if not found then raise exception 'Compte inconnu'; end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Vue « toute la société » : impôts et comptabilité de tous les sites
-- ---------------------------------------------------------------------
create function public.situation_fiscale(p_annee integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sites uuid[];
begin
  if not public.a_role('directeur', 'exploitation', 'finance') then raise exception 'Réservé à la direction'; end if;
  select array_agg(x) into v_sites from public.sites_de(public.ferme_actuelle()) x;
  return jsonb_build_object(
    'ca', (select coalesce(jsonb_object_agg(to_char(m, 'YYYY-MM'), s), '{}'::jsonb) from (
             select date_trunc('month', date_vente) m, sum(montant) s from public.ventes
             where ferme_id = any (v_sites) and not annulee and date_vente >= make_date(p_annee - 1, 1, 1) and date_vente < make_date(p_annee + 1, 1, 1)
             group by 1) x),
    'paiements', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'type_impot', p.type_impot, 'periode', p.periode, 'montant', p.montant,
                    'date_paiement', p.date_paiement, 'reference', p.reference, 'site', f.nom) order by p.date_paiement desc), '[]'::jsonb)
                  from public.paiements_impots p join public.depenses d on d.id = p.depense_id join public.fermes f on f.id = p.ferme_id
                  where p.ferme_id = any (v_sites) and not d.annulee and p.periode >= make_date(p_annee, 1, 1) and p.periode < make_date(p_annee + 1, 1, 1)),
    'charges', (select coalesce(sum(montant), 0) from public.depenses
                where ferme_id = any (v_sites) and statut = 'validee' and not annulee and categorie not in ('retrait_associe', 'impots_taxes')
                  and date_depense >= make_date(p_annee, 1, 1) and date_depense < make_date(p_annee + 1, 1, 1)),
    'sites', (select count(*) from unnest(v_sites)));
end;
$$;

drop function if exists public.soldes_comptables(date, date);
create function public.soldes_comptables(p_debut date, p_fin date, p_toute_societe boolean default false)
returns table (compte text, intitule text, cle text, debit_periode numeric, credit_periode numeric, debit_cumule numeric, credit_cumule numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.a_role('directeur', 'finance') then raise exception 'Réservé à la direction et à la finance'; end if;
  return query
  select j.compte, min(j.intitule), min(j.cle),
         coalesce(sum(j.debit) filter (where j.date_ecriture >= p_debut), 0)::numeric,
         coalesce(sum(j.credit) filter (where j.date_ecriture >= p_debut), 0)::numeric,
         coalesce(sum(j.debit), 0)::numeric, coalesce(sum(j.credit), 0)::numeric
  from public.journal_comptable j
  where j.date_ecriture <= p_fin
    and (case when p_toute_societe then j.ferme_id in (select public.sites_de(public.ferme_actuelle())) else j.ferme_id = public.ferme_actuelle() end)
  group by j.compte
  order by j.compte;
end;
$$;

create function public.journal_societe(p_debut date, p_fin date, p_journal text default null, p_compte text default null, p_limite integer default 3000)
returns table (site text, date_ecriture date, journal text, piece text, libelle text, compte text, intitule text, debit numeric, credit numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.a_role('directeur', 'finance') then raise exception 'Réservé à la direction et à la finance'; end if;
  return query
  select f.nom, j.date_ecriture, j.journal, j.piece, j.libelle, j.compte, j.intitule, j.debit::numeric, j.credit::numeric
  from public.journal_comptable j join public.fermes f on f.id = j.ferme_id
  where j.ferme_id in (select public.sites_de(public.ferme_actuelle()))
    and j.date_ecriture between p_debut and p_fin
    and (p_journal is null or j.journal = p_journal) and (p_compte is null or j.compte = p_compte)
  order by j.date_ecriture, j.piece, j.debit desc
  limit least(coalesce(p_limite, 3000), 10000);
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Droits
-- ---------------------------------------------------------------------
drop policy if exists parametres_paie_select on public.parametres_paie;
create policy parametres_paie_select on public.parametres_paie for select to authenticated
  using (ferme_id = public.societe_de(public.ferme_actuelle()) and public.a_role('directeur', 'finance'));

revoke execute on function public.societe_de(uuid), public.sites_de(uuid) from public, anon;
grant execute on function public.societe_de(uuid), public.sites_de(uuid) to authenticated;
revoke execute on function public.fiche_societe(uuid), public.situation_fiscale(integer), public.soldes_comptables(date, date, boolean),
                          public.journal_societe(date, date, text, text, integer) from public, anon;
grant execute on function public.fiche_societe(uuid), public.situation_fiscale(integer), public.soldes_comptables(date, date, boolean),
                          public.journal_societe(date, date, text, text, integer) to authenticated;
