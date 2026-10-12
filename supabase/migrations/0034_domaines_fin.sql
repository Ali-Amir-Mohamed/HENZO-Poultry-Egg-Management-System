-- =====================================================================
-- HENZO – Derniers réglages des domaines
--   1. Boutiques : seul le vendeur clôture la journée et déclare un
--      versement ; Dahirou valide (Ali et Dahirou voient la caisse).
--   2. Employés : seul Kenfack ajoute un employé et change son poste
--      (Ferme > Équipe) ; Dahirou fixe et change seulement le salaire
--      et la caisse qui le paie ; Ali voit.
--   3. Prix de vente de la ferme : Kenfack seul (les plages de prix des
--      boutiques ne changent pas).
-- À exécuter une fois dans Supabase > SQL Editor, après 0033.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Clôture et versement : le vendeur seul
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cloturer_journee(p_boutique uuid, p_especes_comptees numeric, p_notes text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  b public.boutiques;
  v_attendu numeric;
  v_ecart numeric;
begin
  if p_boutique is distinct from public.ma_boutique() then raise exception 'Seul le vendeur de la boutique clôture la journée'; end if;
  select * into b from public.boutiques where id = p_boutique;
  select coalesce(sum(solde), 0) into v_attendu from public.soldes_boutiques where boutique_id = p_boutique and mode = 'especes';
  insert into public.clotures_boutique (ferme_id, boutique_id, especes_attendues, especes_comptees, notes)
  values (b.ferme_id, b.id, v_attendu, p_especes_comptees, nullif(trim(coalesce(p_notes, '')), ''));
  v_ecart := p_especes_comptees - v_attendu;
  if v_ecart <> 0 then
    perform public.notifier(b.ferme_id, r, 'ecart_caisse_boutique',
      format('Boutique %s : écart de caisse de %s FCFA à la clôture (compté %s, attendu %s)', b.nom, v_ecart, p_especes_comptees, v_attendu), '/boutique')
    from unnest(array['directeur', 'finance']::public.role_utilisateur[]) r;
  end if;
  return v_ecart;
end;
$function$;

CREATE OR REPLACE FUNCTION public.demander_versement(p_boutique uuid, p_mode text, p_chair numeric, p_pondeuse numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  b public.boutiques;
  v_id uuid;
begin
  if p_boutique is distinct from public.ma_boutique() then raise exception 'Seul le vendeur de la boutique déclare un versement'; end if;
  select * into b from public.boutiques where id = p_boutique;
  if coalesce(p_chair, 0) < 0 or coalesce(p_pondeuse, 0) < 0 or coalesce(p_chair, 0) + coalesce(p_pondeuse, 0) <= 0 then
    raise exception 'Indiquez le montant versé';
  end if;
  if coalesce(p_chair, 0) > public.disponible_versement(p_boutique, p_mode, 'chair')
     or coalesce(p_pondeuse, 0) > public.disponible_versement(p_boutique, p_mode, 'pondeuse') then
    raise exception 'Montant supérieur à l''argent de la boutique (chair : % FCFA, pondeuses : % FCFA disponibles)',
      public.disponible_versement(p_boutique, p_mode, 'chair'), public.disponible_versement(p_boutique, p_mode, 'pondeuse');
  end if;
  insert into public.versements_boutique (ferme_id, boutique_id, mode, montant_chair, montant_pondeuse)
  values (b.ferme_id, b.id, p_mode, coalesce(p_chair, 0), coalesce(p_pondeuse, 0)) returning id into v_id;
  perform public.notifier(b.ferme_id, r, 'versement_boutique',
    format('Boutique %s : versement de %s FCFA (%s) à valider', b.nom, coalesce(p_chair, 0) + coalesce(p_pondeuse, 0), p_mode), '/boutique')
  from unnest(array['directeur', 'finance']::public.role_utilisateur[]) r;
  return v_id;
end;
$function$;

-- ---------------------------------------------------------------------
-- 2. Employés
-- ---------------------------------------------------------------------
drop policy if exists employes_all on public.employes;
create policy employes_select on public.employes for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance'));
create policy employes_update on public.employes for update to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('finance'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('finance'));
-- (ajout : uniquement par public.ajouter_employe, réservé à l'exploitation)

create function public.controle_employe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r text := public.role_actuel()::text;
begin
  if auth.uid() is null then return new; end if;  -- administrateur (SQL Editor)
  if r = 'finance' and (to_jsonb(new) - array['salaire_mensuel', 'activite', 'notes'])
                       is distinct from (to_jsonb(old) - array['salaire_mensuel', 'activite', 'notes']) then
    raise exception 'La finance change seulement le salaire et la caisse qui le paie : le nom, le poste et le départ sont gérés par Kenfack';
  end if;
  if r = 'exploitation' and (new.salaire_mensuel, new.activite) is distinct from (old.salaire_mensuel, old.activite) then
    raise exception 'Le salaire est géré par la finance (Dahirou)';
  end if;
  return new;
end;
$$;
create trigger controle_employe before update on public.employes
  for each row execute function public.controle_employe();
revoke execute on function public.controle_employe() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Prix de vente de la ferme : Kenfack seul
-- ---------------------------------------------------------------------
drop policy if exists prix_insert on public.prix_vente;
create policy prix_insert on public.prix_vente for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and public.a_role('exploitation'));
