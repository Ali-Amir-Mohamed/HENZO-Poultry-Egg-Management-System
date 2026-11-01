-- =====================================================================
-- HENZO – Remise à zéro de HENZO AGRO seulement (la ferme n'est pas touchée)
-- ⚠️ IRRÉVERSIBLE : efface toutes les données de HENZO AGRO.
-- À lancer seulement après accord du directeur, dans Supabase > SQL Editor.
--
-- Conserve : HENZO AGRO elle-même, les comptes et leurs accès, les caisses
--            (qui repartent à 0), le plan comptable, les paramètres de paie,
--            les boutiques, les papiers de l'administration.
-- Efface   : ventes, achats, factures, commandes des éleveurs, avances,
--            commissions, stock et produits, prix, clients / fournisseurs,
--            formules et fabrications de la provenderie, écritures,
--            paiements, transferts, vérifications, impôts, paies,
--            notifications et journal de HENZO AGRO ;
--            les livraisons de HENZO AGRO à la ferme (les achats déjà
--            enregistrés par la ferme restent chez la ferme).
-- Les protections du registre (lignes non modifiables) sont coupées le temps
-- du nettoyage, puis remises. Si une seule ligne bloque, rien n'est effacé.
-- =====================================================================

do $$
declare
  v_agro uuid;
  v_garder text[] := array['fermes', 'profiles', 'membres_fermes', 'caisses', 'plan_comptable', 'parametres_paie',
                           'modeles_taches', 'boutiques', 'admin_comptes_bancaires', 'admin_documents', 'admin_echeances',
                           'admin_terrains', 'abonnements_push', 'bareme_igs'];
  v_toutes text[];
  v_a_faire text[];
  v_bloquees text[];
  t text;
  v_passe int := 0;
begin
  if (select count(*) from public.fermes where type_activite = 'negoce') <> 1 then
    raise exception 'HENZO AGRO introuvable (il faut exactement une société de négoce)';
  end if;
  select id into v_agro from public.fermes where type_activite = 'negoce';

  -- every table holding HENZO AGRO data, except what is kept
  select array_agg(c.relname::text order by c.relname) into v_toutes
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname <> all (v_garder)
     and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'ferme_id' and not a.attisdropped);

  foreach t in array v_toutes loop execute format('alter table public.%I disable trigger user', t); end loop;

  -- HENZO AGRO's deliveries to the farm (there ferme_id is the farm, the buyer)
  delete from public.achats_intersocietes where ferme_vendeuse_id = v_agro;

  -- tables are emptied in passes: one still referenced by another waits for the next pass
  v_a_faire := v_toutes;
  while cardinality(v_a_faire) > 0 loop
    v_passe := v_passe + 1;
    if v_passe > 40 then raise exception 'Effacement bloqué sur : %', array_to_string(v_a_faire, ', '); end if;
    v_bloquees := '{}';
    foreach t in array v_a_faire loop
      begin
        execute format('delete from public.%I where ferme_id = $1', t) using v_agro;
      exception when foreign_key_violation then
        v_bloquees := v_bloquees || t;
      end;
    end loop;
    v_a_faire := v_bloquees;
  end loop;

  foreach t in array v_toutes loop execute format('alter table public.%I enable trigger user', t); end loop;
end $$;

-- Vérification : HENZO AGRO à 0, la ferme garde tout
select f.nom as societe,
       (select count(*) from public.ventes v where v.ferme_id = f.id) as ventes,
       (select count(*) from public.depenses d where d.ferme_id = f.id) as achats,
       (select count(*) from public.factures x where x.ferme_id = f.id) as factures,
       (select count(*) from public.articles a where a.ferme_id = f.id) as produits,
       (select count(*) from public.ecritures e where e.ferme_id = f.id) as ecritures,
       (select count(*) from public.caisses c where c.ferme_id = f.id) as caisses
  from public.fermes f order by f.type_activite desc, f.nom;
