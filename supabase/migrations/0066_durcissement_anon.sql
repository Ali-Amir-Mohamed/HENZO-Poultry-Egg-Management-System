-- =====================================================================
-- HENZO – 0066 : un visiteur non connecté n'a plus accès à rien
--
-- Audit de sécurité (2026-11-25) : des fonctions et tables ajoutées après
-- 0008 restaient appelables avec la clé publique sans être connecté. Elles
-- refusaient déjà l'action (contrôle du rôle à l'intérieur), mais on ferme
-- la porte : seuls les comptes connectés gardent ces droits, comme avant.
-- Les objets créés plus tard ne seront plus ouverts aux visiteurs par défaut.
-- TRUNCATE / TRIGGER / REFERENCES ne servent jamais à l'appli : retirés.
-- Relançable sans erreur.
-- =====================================================================

do $$
declare
  f record;
begin
  -- functions: what a visitor could call is kept for signed-in accounts only
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('grant execute on function %s to authenticated', f.signature);
    execute format('revoke execute on function %s from public, anon', f.signature);
  end loop;
end;
$$;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke truncate, trigger, references on all tables in schema public from authenticated;

-- objects created from now on
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema public revoke truncate, trigger, references on tables from authenticated;

-- Contrôle : tout doit être à 0
select 'fonctions ouvertes aux visiteurs' as controle,
       count(*) filter (where has_function_privilege('anon', p.oid, 'execute')) as nombre
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
union all
select 'tables ou vues lisibles par les visiteurs',
       count(*) filter (where has_table_privilege('anon', c.oid, 'select'))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'v', 'm');
