-- =====================================================================
-- HENZO – Renommer une ferme ou une société
--   * Réglages > Sociétés > « Renommer » : le directeur de la ferme
--     (Ali) change son nom (ex. « Ferme HENZO » → « Ferme Site-Obala »).
--   * Le nom de l'entreprise sur les factures reste la raison sociale de
--     la fiche société (Compta > Société).
-- À exécuter une fois dans Supabase > SQL Editor, après 0048.
-- =====================================================================

create or replace function public.renommer_ferme(p_ferme uuid, p_nom text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nom text := regexp_replace(trim(coalesce(p_nom, '')), '\s+', ' ', 'g');
begin
  if not exists (select 1 from public.membres_fermes where user_id = auth.uid() and ferme_id = p_ferme and role = 'directeur') then
    raise exception 'Seul le directeur de cette ferme la renomme';
  end if;
  if v_nom = '' then raise exception 'Indiquez le nouveau nom'; end if;
  if length(v_nom) > 80 then raise exception 'Nom trop long (80 caractères au plus)'; end if;
  if exists (select 1 from public.fermes where id <> p_ferme and upper(nom) = upper(v_nom)) then
    raise exception 'Une autre ferme porte déjà ce nom';
  end if;
  update public.fermes set nom = v_nom where id = p_ferme;
end;
$$;

revoke execute on function public.renommer_ferme(uuid, text) from public, anon;
grant execute on function public.renommer_ferme(uuid, text) to authenticated;
