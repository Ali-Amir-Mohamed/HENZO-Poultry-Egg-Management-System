-- =====================================================================
-- HENZO – Démarrage par origine de l'argent
-- On dit d'où vient l'argent présent au démarrage (associés, investisseurs,
-- prêts) ; HENZO met en caisse ce qui y est encore, crée le capital des
-- investisseurs et les prêts à rembourser — tout en une seule fois
-- (soit tout est enregistré, soit rien).
-- Les droits restent ceux de l'utilisateur (directeur, finance).
-- À exécuter une fois dans Supabase > SQL Editor, après 0018.
-- =====================================================================

create function public.enregistrer_demarrage(p jsonb)
returns numeric
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_date date := coalesce((p ->> 'date')::date, current_date);
  v_total numeric := 0;
  l jsonb;
  v_caisse uuid;
  v_inv uuid;
  v_montant numeric;
  v_dispo numeric;
begin
  if not public.a_role('directeur', 'finance') then
    raise exception 'Seuls le directeur et la finance enregistrent le démarrage';
  end if;

  -- 1. Argent des associés : entre en caisse
  for l in select * from jsonb_array_elements(coalesce(p -> 'associes', '[]'::jsonb)) loop
    v_montant := (l ->> 'montant')::numeric;
    if coalesce(v_montant, 0) <= 0 then continue; end if;
    select id into v_caisse from public.caisses
    where ferme_id = public.ferme_actuelle() and activite = (l ->> 'activite')::public.activite and mode = (l ->> 'mode')::public.mode_paiement;
    if v_caisse is null then raise exception 'Caisse introuvable'; end if;
    insert into public.ecritures (caisse_id, sens, montant, nature, libelle, date_operation)
    values (v_caisse, 'entree', v_montant, 'solde_initial', 'Démarrage : argent des associés', v_date);
    v_total := v_total + v_montant;
  end loop;

  -- 2. Investisseurs : capital (pour les 10 %) + ce qui est encore en caisse
  for l in select * from jsonb_array_elements(coalesce(p -> 'investisseurs', '[]'::jsonb)) loop
    v_montant := (l ->> 'montant')::numeric;
    if coalesce(v_montant, 0) <= 0 then continue; end if;
    v_dispo := coalesce((l ->> 'disponible')::numeric, v_montant);
    if v_dispo < 0 or v_dispo > v_montant then raise exception 'Investisseur : « encore en caisse » doit être entre 0 et le montant investi'; end if;
    v_inv := nullif(l ->> 'investisseur_id', '')::uuid;
    if v_inv is null then
      if coalesce(trim(l ->> 'nom'), '') = '' then raise exception 'Indiquez le nom de l''investisseur'; end if;
      insert into public.investisseurs (nom) values (trim(l ->> 'nom')) returning id into v_inv;
    end if;
    insert into public.operations_investisseurs (investisseur_id, type_operation, montant, date_operation, notes)
    values (v_inv, 'capital_initial', v_montant, v_date, 'Démarrage : capital investi avant HENZO');
    if v_dispo > 0 then
      select id into v_caisse from public.caisses
      where ferme_id = public.ferme_actuelle() and activite = (l ->> 'activite')::public.activite and mode = (l ->> 'mode')::public.mode_paiement;
      if v_caisse is null then raise exception 'Caisse introuvable'; end if;
      insert into public.ecritures (caisse_id, sens, montant, nature, libelle, date_operation)
      values (v_caisse, 'entree', v_dispo, 'solde_initial', 'Démarrage : investissement de ' || coalesce(nullif(trim(l ->> 'nom'), ''), (select nom from public.investisseurs where id = v_inv)), v_date);
      v_total := v_total + v_dispo;
    end if;
  end loop;

  -- 3. Prêts : dette à rembourser + ce qui est encore en caisse
  for l in select * from jsonb_array_elements(coalesce(p -> 'prets', '[]'::jsonb)) loop
    v_montant := (l ->> 'montant')::numeric;
    if coalesce(v_montant, 0) <= 0 then continue; end if;
    v_dispo := coalesce((l ->> 'disponible')::numeric, v_montant);
    if v_dispo < 0 or v_dispo > v_montant then raise exception 'Prêt : « encore en caisse » doit être entre 0 et le montant prêté'; end if;
    if coalesce(trim(l ->> 'preteur'), '') = '' then raise exception 'Indiquez le prêteur'; end if;
    insert into public.prets (type_preteur, preteur, montant_initial, interets, deja_rembourse, activite, mode_paiement, date_pret, existant, notes)
    values (coalesce(l ->> 'type_preteur', 'banque'), trim(l ->> 'preteur'), v_montant, coalesce((l ->> 'interets')::numeric, 0),
            coalesce((l ->> 'deja_rembourse')::numeric, 0), (l ->> 'activite')::public.activite, (l ->> 'mode')::public.mode_paiement,
            coalesce((l ->> 'date_pret')::date, v_date), true, 'Démarrage : prêt en cours avant HENZO');
    if v_dispo > 0 then
      select id into v_caisse from public.caisses
      where ferme_id = public.ferme_actuelle() and activite = (l ->> 'activite')::public.activite and mode = (l ->> 'mode')::public.mode_paiement;
      if v_caisse is null then raise exception 'Caisse introuvable'; end if;
      insert into public.ecritures (caisse_id, sens, montant, nature, libelle, date_operation)
      values (v_caisse, 'entree', v_dispo, 'solde_initial', 'Démarrage : prêt de ' || trim(l ->> 'preteur'), v_date);
      v_total := v_total + v_dispo;
    end if;
  end loop;

  if v_total = 0 and jsonb_array_length(coalesce(p -> 'investisseurs', '[]'::jsonb)) = 0
     and jsonb_array_length(coalesce(p -> 'prets', '[]'::jsonb)) = 0 then
    raise exception 'Rien à enregistrer';
  end if;
  return v_total;
end;
$$;
grant execute on function public.enregistrer_demarrage(jsonb) to authenticated;
revoke execute on function public.enregistrer_demarrage(jsonb) from anon;
