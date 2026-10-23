-- =====================================================================
-- HENZO – Mesures de terrain (cuillères, seaux…)
--   * Chaque article peut avoir une mesure de terrain et combien elle en
--     contient : « 1 litre = 200 cuillères à café », « 1 sac = 25 seaux ».
--   * Dans Saisie > Aliment utilisé, l'employé tape le nombre de cuillères
--     ou de seaux : la base convertit elle-même en litres ou en sacs pour le
--     stock et le coût de la bande (au bon taux, même hors ligne).
--   * Les quantités du stock gardent 3 chiffres après la virgule
--     (3 cuillères = 0,015 litre), au lieu de 2.
-- À exécuter dans Supabase > SQL Editor, après 0059 (peut être relancée sans erreur).
-- =====================================================================

alter table public.articles add column if not exists mesure text;
alter table public.articles add column if not exists mesure_par_unite numeric(12, 3);
alter table public.articles drop constraint if exists articles_mesure_check;
alter table public.articles add constraint articles_mesure_check check (
  (mesure is null and mesure_par_unite is null)
  or (mesure in ('cuillere_cafe', 'cuillere_soupe', 'bouchon', 'gobelet', 'seau') and mesure_par_unite is not null and mesure_par_unite > 0)
);

alter table public.mouvements_stock add column if not exists mesure_nombre numeric(10, 2) check (mesure_nombre > 0);
alter table public.mouvements_stock add column if not exists mesure text;

-- 3 decimals for stock quantities. The views built on this column are saved, dropped,
-- then rebuilt exactly as they were (definition, options, rights).
do $do$
declare
  v record;
  g record;
begin
  if (select numeric_scale from information_schema.columns
      where table_schema = 'public' and table_name = 'mouvements_stock' and column_name = 'quantite') = 3 then
    return;
  end if;

  create temp table vues_sauvees on commit drop as
  with recursive d as (
    select distinct c.oid, 1 as niveau
    from pg_depend dp join pg_rewrite r on r.oid = dp.objid join pg_class c on c.oid = r.ev_class
    where dp.refobjid = 'public.mouvements_stock'::regclass and c.oid <> 'public.mouvements_stock'::regclass
    union all
    select c.oid, d.niveau + 1
    from d join pg_depend dp on dp.refobjid = d.oid join pg_rewrite r on r.oid = dp.objid join pg_class c on c.oid = r.ev_class
    where c.oid <> d.oid and d.niveau < 20
  )
  select c.relname as nom, max(d.niveau) as niveau, pg_get_viewdef(c.oid) as def, c.reloptions as options, c.relacl as droits
  from d join pg_class c on c.oid = d.oid
  where c.relkind = 'v'
  group by c.oid, c.relname, c.reloptions, c.relacl;

  for v in select * from vues_sauvees order by niveau desc loop
    execute format('drop view public.%I', v.nom);
  end loop;

  alter table public.mouvements_stock alter column quantite type numeric(14, 3);

  for v in select * from vues_sauvees order by niveau loop
    execute format('create view public.%I%s as %s', v.nom,
      case when v.options is null then '' else ' with (' || array_to_string(v.options, ', ') || ')' end, v.def);
    if v.droits is not null then
      execute format('revoke all on public.%I from public, anon, authenticated', v.nom);
      for g in select a.privilege_type as droit, case when a.grantee = 0 then 'public' else quote_ident(r.rolname) end as qui
               from aclexplode(v.droits) a left join pg_roles r on r.oid = a.grantee loop
        execute format('grant %s on public.%I to %s', g.droit, v.nom, g.qui);
      end loop;
    end if;
  end loop;
end;
$do$;

-- Field measures are turned into the article's unit by the database itself
create or replace function public.conversion_mesure()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  a record;
begin
  if new.mesure_nombre is null then
    new.mesure := null;
    return new;
  end if;
  select mesure, mesure_par_unite, nom into a from public.articles where id = new.article_id;
  if a.mesure is null then
    raise exception 'L''article « % » n''a pas de mesure de terrain : saisissez la quantité dans son unité', a.nom;
  end if;
  new.mesure := a.mesure;
  new.quantite := round(new.mesure_nombre / a.mesure_par_unite, 3);
  if new.quantite <= 0 then raise exception 'Quantité trop petite'; end if;
  return new;
end;
$$;
drop trigger if exists a_conversion_mesure on public.mouvements_stock;
create trigger a_conversion_mesure before insert on public.mouvements_stock
  for each row execute function public.conversion_mesure();
