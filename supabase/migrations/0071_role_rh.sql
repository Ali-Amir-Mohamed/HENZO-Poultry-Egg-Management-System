-- =====================================================================
-- HENZO – Nouveau rôle « rh » (Responsable RH) – à lancer SEUL, avant 0072
-- Un nouveau rôle doit être enregistré dans sa propre exécution avant
-- d'être utilisé.
-- =====================================================================
alter type public.role_utilisateur add value if not exists 'rh';
