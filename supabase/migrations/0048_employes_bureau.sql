-- =====================================================================
-- HENZO – Personnel de la ferme et personnel de bureau
--   * Ferme > Équipe : seulement le personnel de la ferme, géré par
--     Kenfack (Ali et Dahirou le voient sans le modifier).
--   * Argent > Employés : le personnel de bureau (comptable, secrétaire,
--     associé qui a un poste…), ajouté et modifié par Ali et Dahirou.
--     Kenfack ne le voit pas.
--   * Argent > Salaires : tout le monde est payé au mois, au même
--     endroit, en deux groupes (ferme, bureau).
--   * Remplace 0047 (Ali et Dahirou n'ajoutent plus dans l'Équipe de la
--     ferme). Un employé dont le poste contient « comptab » passe au bureau.
-- À exécuter une fois dans Supabase > SQL Editor, après 0047.
-- =====================================================================

alter table public.employes add column categorie text not null default 'ferme' check (categorie in ('ferme', 'bureau'));
update public.employes set categorie = 'bureau' where poste ilike '%comptab%';

-- The farm team: farm staff only
create or replace view public.equipe as
select id, ferme_id, nom, telephone, poste, activite, date_embauche, actif, created_at
from public.employes
where ferme_id = public.ferme_actuelle() and categorie = 'ferme' and public.a_role('directeur', 'exploitation', 'finance');

-- Farm staff: Kenfack again (as before 0047)
create or replace function public.ajouter_employe(p_nom text, p_telephone text default null, p_poste text default null, p_date_embauche date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.a_role('exploitation') then raise exception 'Seule l''exploitation (Kenfack) ajoute le personnel de la ferme ; le personnel de bureau s''ajoute dans Argent > Employés'; end if;
  if coalesce(trim(p_nom), '') = '' then raise exception 'Indiquez le nom de l''employé'; end if;
  insert into public.employes (ferme_id, nom, telephone, poste, date_embauche, salaire_mensuel, categorie)
  values (public.ferme_actuelle(), trim(p_nom), nullif(trim(p_telephone), ''), nullif(trim(p_poste), ''), p_date_embauche, 0, 'ferme')
  returning id into v_id;
  perform public.notifier(public.ferme_actuelle(), 'finance', 'nouvel_employe',
    format('Nouvel employé : %s%s. Fixez son salaire dans Argent > Salaires.', trim(p_nom), coalesce(' (' || nullif(trim(p_poste), '') || ')', '')), '/argent');
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
  if not public.a_role('exploitation') then raise exception 'Seule l''exploitation (Kenfack) modifie le personnel de la ferme'; end if;
  select * into e from public.employes where id = p_id and ferme_id = public.ferme_actuelle() and categorie = 'ferme' for update;
  if e.id is null then raise exception 'Employé introuvable'; end if;
  if coalesce(trim(p_nom), '') = '' then raise exception 'Indiquez le nom de l''employé'; end if;
  update public.employes set nom = trim(p_nom), telephone = nullif(trim(p_telephone), ''), poste = nullif(trim(p_poste), ''), actif = coalesce(p_actif, e.actif)
  where id = e.id;
  if e.actif and not coalesce(p_actif, true) then
    perform public.notifier(e.ferme_id, 'finance', 'depart_employe', format('%s ne travaille plus à la ferme : pensez à son dernier salaire.', e.nom), '/argent');
  elsif e.poste is distinct from nullif(trim(p_poste), '') then
    perform public.notifier(e.ferme_id, 'finance', 'poste_employe', format('%s change de poste : %s. Vérifiez son salaire.', e.nom, coalesce(nullif(trim(p_poste), ''), '—')), '/argent');
  end if;
end;
$$;

-- Office staff: Ali and Dahirou
create function public.ajouter_employe_bureau(p_nom text, p_telephone text default null, p_poste text default null, p_date_embauche date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.a_role('directeur', 'finance') then raise exception 'Seuls Ali et Dahirou ajoutent le personnel de bureau'; end if;
  if coalesce(trim(p_nom), '') = '' then raise exception 'Indiquez le nom de l''employé'; end if;
  insert into public.employes (ferme_id, nom, telephone, poste, date_embauche, salaire_mensuel, categorie)
  values (public.ferme_actuelle(), trim(p_nom), nullif(trim(p_telephone), ''), nullif(trim(p_poste), ''), p_date_embauche, 0, 'bureau')
  returning id into v_id;
  if not public.a_role('finance') then
    perform public.notifier(public.ferme_actuelle(), 'finance', 'nouvel_employe',
      format('Nouvel employé de bureau : %s%s. Fixez son salaire dans Argent > Salaires.', trim(p_nom), coalesce(' (' || nullif(trim(p_poste), '') || ')', '')), '/argent');
  end if;
  return v_id;
end;
$$;

create function public.modifier_employe_bureau(p_id uuid, p_nom text, p_telephone text, p_poste text, p_actif boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.employes;
begin
  if not public.a_role('directeur', 'finance') then raise exception 'Seuls Ali et Dahirou modifient le personnel de bureau'; end if;
  select * into e from public.employes where id = p_id and ferme_id = public.ferme_actuelle() and categorie = 'bureau' for update;
  if e.id is null then raise exception 'Employé introuvable'; end if;
  if coalesce(trim(p_nom), '') = '' then raise exception 'Indiquez le nom de l''employé'; end if;
  update public.employes set nom = trim(p_nom), telephone = nullif(trim(p_telephone), ''), poste = nullif(trim(p_poste), ''), actif = coalesce(p_actif, e.actif)
  where id = e.id;
  if e.actif and not coalesce(p_actif, true) and not public.a_role('finance') then
    perform public.notifier(e.ferme_id, 'finance', 'depart_employe', format('%s ne travaille plus avec nous : pensez à son dernier salaire.', e.nom), '/argent');
  end if;
end;
$$;

-- Dahirou changes only the salary of farm staff; office staff is also his (and Ali's) to name; nobody moves an employee
-- from one list to the other
create or replace function public.controle_employe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r text := public.role_actuel()::text;
  v_fin text[] := array['salaire_mensuel', 'activite', 'notes', 'declare_cnps', 'numero_cnps'];
  v_nom text[] := array['nom', 'telephone', 'poste', 'actif'];
begin
  if auth.uid() is null then return new; end if;  -- administrateur (SQL Editor)
  if new.categorie is distinct from old.categorie then raise exception 'Un employé ne change pas de liste (ferme / bureau)'; end if;
  if r = 'finance' and (to_jsonb(new) - v_fin - case when old.categorie = 'bureau' then v_nom else array[]::text[] end)
                       is distinct from (to_jsonb(old) - v_fin - case when old.categorie = 'bureau' then v_nom else array[]::text[] end) then
    raise exception 'La finance change seulement le salaire, la caisse qui le paie et la déclaration CNPS : le nom, le poste et le départ sont gérés par Kenfack';
  end if;
  if r = 'exploitation' and (new.salaire_mensuel, new.activite, new.declare_cnps, new.numero_cnps)
                          is distinct from (old.salaire_mensuel, old.activite, old.declare_cnps, old.numero_cnps) then
    raise exception 'Le salaire et la déclaration CNPS sont gérés par la finance (Dahirou)';
  end if;
  return new;
end;
$$;

revoke execute on function public.ajouter_employe_bureau(text, text, text, date), public.modifier_employe_bureau(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.ajouter_employe_bureau(text, text, text, date), public.modifier_employe_bureau(uuid, text, text, text, boolean) to authenticated;
