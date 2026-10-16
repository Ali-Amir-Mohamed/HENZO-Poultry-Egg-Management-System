-- =====================================================================
-- HENZO – Rôle « comptable » (après 0042, lancée seule)
--   Pour la personne qui tient les comptes (comptable, CGA) :
--   * voit la comptabilité de toute la société (tous les sites) ou d'un
--     site, les impôts, les factures, et les TOTAUX de la paie (montants à
--     reverser à la CNPS et aux impôts) – jamais le salaire de chacun ;
--   * corrige la fiche société, les taux d'impôts, les paramètres de paie
--     et le plan comptable ;
--   * ne bouge jamais l'argent : ni paiement, ni encaissement, ni
--     validation, ni facture, ni annulation ; ne voit pas la ferme.
-- =====================================================================

-- Journal : lisible par le comptable
create or replace view public.journal_comptable with (security_invoker = true) as
select j.ferme_id, j.date_ecriture, j.journal, j.piece, j.libelle, j.cle,
       coalesce(pc.numero, '0') as compte, coalesce(pc.intitule, j.cle) as intitule,
       j.debit::numeric(16, 0) as debit, j.credit::numeric(16, 0) as credit, j.source, j.source_id
from public.journal_comptable_brut j
left join public.plan_comptable pc on pc.ferme_id = j.ferme_id and pc.cle = j.cle
where (j.debit <> 0 or j.credit <> 0) and public.a_role('directeur', 'finance', 'comptable');

create or replace function public.soldes_comptables(p_debut date, p_fin date, p_toute_societe boolean default false)
returns table (compte text, intitule text, cle text, debit_periode numeric, credit_periode numeric, debit_cumule numeric, credit_cumule numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.a_role('directeur', 'finance', 'comptable') then raise exception 'Réservé à la direction et à la finance'; end if;
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

-- Journal de la société (ou d'un seul site) : par le serveur, pour que le comptable voie toutes les écritures
drop function if exists public.journal_societe(date, date, text, text, integer);
create function public.journal_societe(p_debut date, p_fin date, p_journal text default null, p_compte text default null,
                                       p_limite integer default 3000, p_site uuid default null)
returns table (site text, date_ecriture date, journal text, piece text, libelle text, compte text, intitule text, debit numeric, credit numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.a_role('directeur', 'finance', 'comptable') then raise exception 'Réservé à la direction, à la finance et au comptable'; end if;
  if p_site is not null and p_site not in (select public.sites_de(public.ferme_actuelle())) then raise exception 'Site introuvable'; end if;
  return query
  select f.nom, j.date_ecriture, j.journal, j.piece, j.libelle, j.compte, j.intitule, j.debit::numeric, j.credit::numeric
  from public.journal_comptable j join public.fermes f on f.id = j.ferme_id
  where j.ferme_id in (select public.sites_de(public.ferme_actuelle()))
    and (p_site is null or j.ferme_id = p_site)
    and j.date_ecriture between p_debut and p_fin
    and (p_journal is null or j.journal = p_journal) and (p_compte is null or j.compte = p_compte)
  order by j.date_ecriture, j.piece, j.debit desc
  limit least(coalesce(p_limite, 3000), 10000);
end;
$$;

create or replace function public.situation_fiscale(p_annee integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sites uuid[];
begin
  if not public.a_role('directeur', 'exploitation', 'finance', 'comptable') then raise exception 'Réservé à la direction'; end if;
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

-- Paie : seulement les totaux du mois pour toute la société (à reverser et déjà reversé)
create function public.charges_salaires_societe(p_depuis date)
returns table (mois date, bulletins bigint, masse_brute numeric, a_reverser_cnps numeric, a_reverser_impots numeric,
               charges_patronales numeric, paye_cnps numeric, paye_impots numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.a_role('directeur', 'finance', 'comptable') then raise exception 'Réservé à la direction, à la finance et au comptable'; end if;
  return query
  with sites as (select public.sites_de(public.ferme_actuelle()) as id),
  b as (
    select b.mois, count(*) n, sum(b.brut) brut,
           sum(b.cnps_salarie + b.cnps_vieillesse_pat + b.cnps_allocations + b.cnps_accidents) cnps,
           sum(b.irpp + b.cac + b.cfc_salarie + b.cfc_patronal + b.fne + b.rav + b.tdl) imp, sum(b.total_patronal) pat
    from public.bulletins_paie b join public.paies p on p.id = b.paie_id and not p.annulee
    where b.ferme_id in (select id from sites) and b.mois >= p_depuis
    group by b.mois),
  r as (
    select pi.periode, sum(pi.montant) filter (where pi.type_impot = 'cnps') cnps, sum(pi.montant) filter (where pi.type_impot = 'impots_salaires') imp
    from public.paiements_impots pi join public.depenses d on d.id = pi.depense_id and not d.annulee
    where pi.ferme_id in (select id from sites) and pi.periode >= p_depuis
    group by pi.periode)
  select b.mois, b.n, b.brut, b.cnps, b.imp, b.pat, coalesce(r.cnps, 0), coalesce(r.imp, 0)
  from b left join r on r.periode = b.mois
  order by b.mois desc;
end;
$$;

-- Corrections par le comptable
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
  if not public.a_role('directeur', 'finance', 'comptable') then raise exception 'Seuls la direction, la finance et le comptable modifient la fiche société'; end if;
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
  if not public.a_role('directeur', 'finance', 'comptable') then raise exception 'Seuls la direction, la finance et le comptable modifient les paramètres de paie'; end if;
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
  if not public.a_role('directeur', 'finance', 'comptable') then raise exception 'Seuls la direction, la finance et le comptable modifient le plan comptable'; end if;
  if trim(coalesce(p_numero, '')) !~ '^[1-9][0-9]{1,9}$' then raise exception 'Numéro de compte invalide (chiffres seulement, ex. 6022)'; end if;
  update public.plan_comptable set numero = trim(p_numero), intitule = coalesce(nullif(trim(p_intitule), ''), intitule)
  where ferme_id in (select public.sites_de(public.ferme_actuelle())) and cle = p_cle;
  if not found then raise exception 'Compte inconnu'; end if;
end;
$$;

-- Lecture : factures, impôts payés, paramètres de paie, plan comptable
drop policy if exists factures_select on public.factures;
create policy factures_select on public.factures for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance', 'comptable'));
drop policy if exists facture_lignes_select on public.facture_lignes;
create policy facture_lignes_select on public.facture_lignes for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance', 'comptable'));
drop policy if exists paiements_impots_select on public.paiements_impots;
create policy paiements_impots_select on public.paiements_impots for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance', 'comptable'));
drop policy if exists parametres_paie_select on public.parametres_paie;
create policy parametres_paie_select on public.parametres_paie for select to authenticated
  using (ferme_id = public.societe_de(public.ferme_actuelle()) and public.a_role('directeur', 'finance', 'comptable'));
drop policy if exists plan_comptable_select on public.plan_comptable;
create policy plan_comptable_select on public.plan_comptable for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance', 'comptable'));

revoke execute on function public.journal_societe(date, date, text, text, integer, uuid), public.charges_salaires_societe(date) from public, anon;
grant execute on function public.journal_societe(date, date, text, text, integer, uuid), public.charges_salaires_societe(date) to authenticated;
