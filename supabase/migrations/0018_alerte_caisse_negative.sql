-- =====================================================================
-- HENZO – Alerte quand une caisse passe en négatif
-- Une dépense n'est jamais bloquée faute d'argent en caisse (ex. avance
-- personnelle), mais la finance et le directeur sont prévenus dès qu'une
-- sortie fait passer une caisse sous zéro.
-- À exécuter une fois dans Supabase > SQL Editor, après 0017.
-- =====================================================================

create function public.alerte_caisse_negative()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_solde numeric;
  v_nom text;
begin
  if new.sens <> 'sortie' then return null; end if;
  select coalesce(sum(case when sens = 'entree' then montant else -montant end), 0) into v_solde
  from public.ecritures where caisse_id = new.caisse_id;
  -- Seulement au moment où la caisse passe sous zéro (pas à chaque sortie suivante)
  if v_solde < 0 and v_solde + new.montant >= 0 then
    select (case c.activite when 'chair' then 'Chair' else 'Pondeuses' end) || ' · '
           || (case c.mode when 'especes' then 'Espèces' when 'mobile_money' then 'Mobile Money' else 'Banque' end)
      into v_nom from public.caisses c where c.id = new.caisse_id;
    perform public.notifier(new.ferme_id, r, 'caisse_negative',
      format('Caisse %s en négatif : %s FCFA (après « %s »)', v_nom, to_char(v_solde, 'FM999G999G999G990'), coalesce(new.libelle, new.nature)),
      '/argent')
    from unnest(array['finance', 'directeur']::public.role_utilisateur[]) r;
  end if;
  return null;
end;
$$;
create trigger alerte_caisse_negative after insert on public.ecritures
  for each row execute function public.alerte_caisse_negative();
revoke execute on function public.alerte_caisse_negative() from public, anon, authenticated;
