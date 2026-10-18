-- =====================================================================
-- HENZO – Le client s'enregistre tout seul au moment de la vente
--   * On tape le nom du client : s'il existe déjà (même nom, sans tenir
--     compte des majuscules, des accents ni des espaces), il est repris ;
--     sinon il est créé comme client (avec son téléphone s'il est donné).
--   * Un client créé ainsi n'a pas de crédit : Kenfack l'autorise ensuite
--     s'il le faut (Réglages > Clients).
-- À exécuter une fois dans Supabase > SQL Editor, après 0051.
-- =====================================================================

create function public.nom_compare(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(lower(regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g')),
                   'àáâäãåçèéêëìíîïñòóôöõùúûüýÿœ', 'aaaaaaceeeeiiiinooooouuuuyyo')
$$;

create function public.client_par_nom(p_nom text, p_telephone text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nom text := regexp_replace(trim(coalesce(p_nom, '')), '\s+', ' ', 'g');
  v_id uuid;
begin
  if not public.a_role('directeur', 'exploitation', 'finance', 'employe') then raise exception 'Vous ne pouvez pas enregistrer de client'; end if;
  if public.ferme_actuelle() is null then raise exception 'Aucune société ouverte'; end if;
  if v_nom = '' then raise exception 'Indiquez le nom du client'; end if;
  if length(v_nom) > 120 then raise exception 'Nom trop long'; end if;
  select id into v_id from public.tiers
  where ferme_id = public.ferme_actuelle() and type_tiers <> 'fournisseur' and public.nom_compare(nom) = public.nom_compare(v_nom)
  order by created_at limit 1;
  if v_id is not null then
    -- a phone typed now completes a client who had none
    update public.tiers set telephone = nullif(trim(p_telephone), '') where id = v_id and telephone is null and nullif(trim(p_telephone), '') is not null;
    return v_id;
  end if;
  insert into public.tiers (ferme_id, type_tiers, nom, telephone)
  values (public.ferme_actuelle(), 'client', v_nom, nullif(trim(coalesce(p_telephone, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.client_par_nom(text, text) from public, anon;
grant execute on function public.client_par_nom(text, text) to authenticated;
grant execute on function public.nom_compare(text) to authenticated;
