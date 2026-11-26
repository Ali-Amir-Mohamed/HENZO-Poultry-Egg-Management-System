-- =====================================================================
-- HENZO – 0070 : Ressources humaines, étape 4 : section « Personnel »
--
-- Kenfack (exploitation) est associé : il VOIT tout le personnel, y compris
-- les salaires, la paie, les bulletins, les avances et les documents, mais
-- ne fait rien dessus (toutes les actions restent dans les fonctions
-- réservées à Dahirou et Ali, qui refusent les autres rôles).
-- Les employés, vendeurs et le comptable ne voient toujours rien.
-- Relançable sans erreur.
-- =====================================================================

drop policy if exists employes_select on public.employes;
create policy employes_select on public.employes for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));

drop policy if exists paies_select on public.paies;
create policy paies_select on public.paies for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));

drop policy if exists avances_select on public.avances_salaire;
create policy avances_select on public.avances_salaire for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));

drop policy if exists bulletins_select on public.bulletins_paie;
create policy bulletins_select on public.bulletins_paie for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));

drop policy if exists preparations_paie_select on public.preparations_paie;
create policy preparations_paie_select on public.preparations_paie for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));

drop policy if exists periodes_paie_select on public.periodes_paie;
create policy periodes_paie_select on public.periodes_paie for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance', 'comptable'));

drop policy if exists parametres_paie_select on public.parametres_paie;
create policy parametres_paie_select on public.parametres_paie for select to authenticated
  using (ferme_id = public.societe_de(public.ferme_actuelle()) and public.a_role('directeur', 'exploitation', 'finance', 'comptable'));

drop policy if exists documents_employes_select on public.documents_employes;
create policy documents_employes_select on public.documents_employes for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));

do $do$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists rh_fichiers_select on storage.objects;
    create policy rh_fichiers_select on storage.objects for select to authenticated
      using (bucket_id = 'administration' and (storage.foldername(name))[1] = public.ferme_actuelle()::text
             and (storage.foldername(name))[2] = 'employes' and public.a_role('directeur', 'exploitation', 'finance'));
  end if;
end;
$do$;

-- the summary of the month (attendance, overtime) is readable by Kenfack too
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
  if not public.a_role('directeur', 'exploitation', 'finance') then raise exception 'Réservé à la direction, l''exploitation et la finance'; end if;
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
