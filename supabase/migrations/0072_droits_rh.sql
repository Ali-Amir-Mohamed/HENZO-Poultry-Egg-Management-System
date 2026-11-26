-- =====================================================================
-- HENZO – 0072 : droits du Responsable RH (rôle « rh », créé par 0071)
--
-- Le jour où un Responsable RH est embauché, Ali lui crée un compte avec ce
-- rôle. Il reprend le travail RH de Dahirou, dans la section Personnel :
--   fiches du personnel, contrats, documents, présences, congés (accorder),
--   préparation de la paie et envoi à Ali, paramètres de paie, rapports.
-- Il ne touche jamais à l'argent : il ne paie ni salaire ni avance (Dahirou),
-- ne valide pas la paie (Ali), ne voit ni caisses, ni ventes, ni dépenses.
-- Dahirou garde ses droits RH (relais pendant les absences).
--
-- Méthode : les fonctions et règles RH qui autorisent la finance
-- (« a_role(…, 'finance') ») autorisent aussi « rh ». Rien d'autre ne
-- change. Relançable sans erreur.
-- =====================================================================

-- 1. HR functions: wherever finance is allowed, the HR manager is too
do $do$
declare
  f record;
  v_def text;
  v_new text;
begin
  for f in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array[
      'controle_employe', 'ajouter_employe', 'modifier_employe', 'ajouter_employe_bureau', 'modifier_employe_bureau',
      'preparer_paie', 'retirer_preparation_paie', 'envoyer_paie_validation', 'resume_presences', 'simuler_paie', 'maj_parametres_paie',
      'maj_contrat', 'rappels_rh', 'solde_conges', 'demander_conge', 'decider_conge', 'noter_presences'])
  loop
    v_def := pg_get_functiondef(f.oid);
    v_new := regexp_replace(v_def, '(a_role\([^)]*''finance'')\)', '\1, ''rh'')', 'g');
    v_new := regexp_replace(v_new, '(a_role\([^)]*''finance'', ''comptable'')\)', '\1, ''rh'')', 'g');
    v_new := replace(v_new, 'array[''directeur'', ''finance'']::public.role_utilisateur[]', 'array[''directeur'', ''finance'', ''rh'']::public.role_utilisateur[]');
    if v_new <> v_def then execute v_new; end if;
  end loop;
end;
$do$;

-- the HR manager is also told when a pay has to be prepared again
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
      perform public.notifier(new.ferme_id, r, 'paie_a_refaire', 'Des heures supplémentaires viennent d''être autorisées : préparez de nouveau ce salaire', '/personnel?tab=paie')
      from unnest(array['finance', 'rh']::public.role_utilisateur[]) r;
    end if;
  end if;
  return null;
end;
$$;

-- 2. Read and write rules of the HR tables: finance allowed → HR manager allowed
do $do$
declare
  p record;
  v_q text;
  v_c text;
  v_sql text;
begin
  for p in
    select tablename, policyname, qual, with_check from pg_policies
    where schemaname = 'public' and tablename = any (array['employes', 'paies', 'avances_salaire', 'bulletins_paie', 'preparations_paie',
      'periodes_paie', 'parametres_paie', 'documents_employes', 'presences', 'heures_sup', 'conges', 'evaluations'])
  loop
    v_q := regexp_replace(coalesce(p.qual, ''), '''finance''::text\]', '''finance''::text, ''rh''::text]', 'g');
    v_q := regexp_replace(v_q, '''finance''::text, ''comptable''::text\]', '''finance''::text, ''comptable''::text, ''rh''::text]', 'g');
    v_c := regexp_replace(coalesce(p.with_check, ''), '''finance''::text\]', '''finance''::text, ''rh''::text]', 'g');
    v_sql := null;
    if v_q <> coalesce(p.qual, '') then v_sql := format('alter policy %I on public.%I using (%s)', p.policyname, p.tablename, v_q); end if;
    if v_c <> coalesce(p.with_check, '') then
      v_sql := coalesce(v_sql, format('alter policy %I on public.%I', p.policyname, p.tablename)) || format(' with check (%s)', v_c);
    end if;
    if v_sql is not null then execute v_sql; end if;
  end loop;
end;
$do$;

-- 3. Employee files in the private folder
do $do$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists rh_fichiers_select on storage.objects;
    drop policy if exists rh_fichiers_insert on storage.objects;
    drop policy if exists rh_fichiers_delete on storage.objects;
    create policy rh_fichiers_select on storage.objects for select to authenticated
      using (bucket_id = 'administration' and (storage.foldername(name))[1] = public.ferme_actuelle()::text
             and (storage.foldername(name))[2] = 'employes' and public.a_role('directeur', 'exploitation', 'finance', 'rh'));
    create policy rh_fichiers_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'administration' and (storage.foldername(name))[1] = public.ferme_actuelle()::text
                  and (storage.foldername(name))[2] = 'employes' and public.a_role('directeur', 'finance', 'rh'));
    create policy rh_fichiers_delete on storage.objects for delete to authenticated
      using (bucket_id = 'administration' and (storage.foldername(name))[1] = public.ferme_actuelle()::text
             and (storage.foldername(name))[2] = 'employes' and public.a_role('directeur', 'finance', 'rh'));
  end if;
end;
$do$;

-- 4. The HR manager sees what was already paid over to the CNPS and the taxes (shown with the pay)
drop policy if exists paiements_impots_select on public.paiements_impots;
create policy paiements_impots_select on public.paiements_impots for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance', 'comptable', 'rh'));
