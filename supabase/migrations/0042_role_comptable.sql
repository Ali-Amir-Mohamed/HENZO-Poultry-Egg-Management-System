-- =====================================================================
-- HENZO – Nouveau rôle « comptable » (à lancer SEUL, avant 0043)
-- Un nouveau rôle doit être enregistré dans sa propre exécution avant
-- d'être utilisé.
-- =====================================================================
alter type public.role_utilisateur add value if not exists 'comptable';
