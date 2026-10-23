-- =====================================================================
-- HENZO – Mesure « seringue »
--   * Nouvelle mesure de terrain pour les médicaments donnés à la seringue :
--     « 1 litre = 100 seringues » pour une seringue de 10 ml.
-- À exécuter dans Supabase > SQL Editor, après 0060 (peut être relancée sans erreur).
-- =====================================================================

alter table public.articles drop constraint if exists articles_mesure_check;
alter table public.articles add constraint articles_mesure_check check (
  (mesure is null and mesure_par_unite is null)
  or (mesure in ('cuillere_cafe', 'cuillere_soupe', 'seringue', 'bouchon', 'gobelet', 'seau') and mesure_par_unite is not null and mesure_par_unite > 0)
);
