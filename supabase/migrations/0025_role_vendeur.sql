-- =====================================================================
-- HENZO – Nouveau rôle « vendeur » (boutiques)
-- Seule ligne de ce fichier : Postgres doit enregistrer le nouveau rôle avant
-- qu'il soit utilisé. Lancez ce fichier SEUL, puis 0026.
-- =====================================================================
alter type public.role_utilisateur add value if not exists 'vendeur';
