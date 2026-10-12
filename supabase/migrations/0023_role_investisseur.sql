-- =====================================================================
-- HENZO – Nouveau rôle « investisseur » (accès en lecture seule à son compte)
-- Seule ligne de ce fichier : Postgres doit enregistrer le nouveau rôle avant
-- qu'il soit utilisé. Lancez ce fichier SEUL, puis 0024.
-- =====================================================================
alter type public.role_utilisateur add value if not exists 'investisseur';
