-- =====================================================================
-- HENZO – Équipe : Ali et Dahirou ajoutent aussi des employés
--   * Un employé de bureau (le comptable, par exemple) n'est pas du
--     domaine de Kenfack : Ali (directeur) et Dahirou (finance) peuvent
--     maintenant ajouter un employé et le modifier (poste, départ), comme
--     Kenfack. Les salaires restent fixés par Dahirou.
--   * Celui qui n'a pas fait le changement est prévenu : Dahirou pour le
--     salaire, Kenfack pour son équipe.
-- À exécuter une fois dans Supabase > SQL Editor, après 0046.
-- =====================================================================

create or replace function public.ajouter_employe(p_nom text, p_telephone text default null, p_poste text default null, p_date_embauche date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_msg text;
begin
  if not public.a_role('exploitation', 'directeur', 'finance') then raise exception 'Vous ne pouvez pas ajouter un employé'; end if;
  if coalesce(trim(p_nom), '') = '' then raise exception 'Indiquez le nom de l''employé'; end if;
  insert into public.employes (ferme_id, nom, telephone, poste, date_embauche, salaire_mensuel)
  values (public.ferme_actuelle(), trim(p_nom), nullif(trim(p_telephone), ''), nullif(trim(p_poste), ''), p_date_embauche, 0)
  returning id into v_id;
  v_msg := format('Nouvel employé : %s%s.', trim(p_nom), coalesce(' (' || nullif(trim(p_poste), '') || ')', ''));
  if not public.a_role('finance') then
    perform public.notifier(public.ferme_actuelle(), 'finance', 'nouvel_employe', v_msg || ' Fixez son salaire dans Argent > Salaires.', '/argent');
  end if;
  if not public.a_role('exploitation') then
    perform public.notifier(public.ferme_actuelle(), 'exploitation', 'nouvel_employe', v_msg, '/ferme');
  end if;
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
  if not public.a_role('exploitation', 'directeur', 'finance') then raise exception 'Vous ne pouvez pas modifier un employé'; end if;
  select * into e from public.employes where id = p_id and ferme_id = public.ferme_actuelle() for update;
  if e.id is null then raise exception 'Employé introuvable'; end if;
  if coalesce(trim(p_nom), '') = '' then raise exception 'Indiquez le nom de l''employé'; end if;
  update public.employes set nom = trim(p_nom), telephone = nullif(trim(p_telephone), ''), poste = nullif(trim(p_poste), ''), actif = coalesce(p_actif, e.actif)
  where id = e.id;
  if e.actif and not coalesce(p_actif, true) then
    if not public.a_role('finance') then
      perform public.notifier(e.ferme_id, 'finance', 'depart_employe', format('%s ne travaille plus à la ferme : pensez à son dernier salaire.', e.nom), '/argent');
    end if;
    if not public.a_role('exploitation') then
      perform public.notifier(e.ferme_id, 'exploitation', 'depart_employe', format('%s ne fait plus partie de l''équipe.', e.nom), '/ferme');
    end if;
  elsif e.poste is distinct from nullif(trim(p_poste), '') and not public.a_role('finance') then
    perform public.notifier(e.ferme_id, 'finance', 'poste_employe', format('%s change de poste : %s. Vérifiez son salaire.', e.nom, coalesce(nullif(trim(p_poste), ''), '—')), '/argent');
  end if;
end;
$$;

revoke execute on function public.ajouter_employe(text, text, text, date), public.modifier_employe(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.ajouter_employe(text, text, text, date), public.modifier_employe(uuid, text, text, text, boolean) to authenticated;
