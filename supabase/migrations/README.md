# Migrations Supabase

| Fichier | Contenu |
|---|---|
| `0001_schema_etape1.sql` | RÃ´les, profils, fonction `role_actuel()` (les tables provisoires sont remplacÃ©es par 0002) |
| `0002_refonte_phase_a.sql` | Base conforme au cahier des charges : fermes, bandes de chair et lots de pondeuses, saisies de terrain, clients/fournisseurs, prix, stock, caisses, registre d'Ã©critures non modifiable, ventes, dÃ©penses, validations, notifications, journal, sÃ©curitÃ© par rÃ´le |
| `0003_phase_b_bandes.sql` | Indicateurs des bandes et des lots, bilan figÃ© Ã  la clÃ´ture, rÃ©sultat par activitÃ© |
| `0004_phase_c_argent.sql` | Investisseurs (capital, 10 % Ã  chaque fin de bande de chair), prÃªts, vÃ©rification de caisse |
| `0005_phase_d_organisation.sql` | TÃ¢ches, programmes, rÃ©alisations hors ligne, alerte de mortalitÃ©, vue des alertes |
| `0006_phase_e_analyses.sql` | Capital initial et prÃªts existants (sans mouvement de caisse), fonction `rapport_mensuel` |

## Installation

1. Supabase > **SQL Editor** > coller le fichier > **Run** (dans l'ordre : 0001 puis 0002).
2. **Authentication > Users > Add user** : `<nom>@henzo.local` + mot de passe, Â« Auto Confirm User Â» cochÃ©.
3. Attribuer le rÃ´le (chaque nouveau compte est Â« employe Â») :
   `update public.profiles p set role = 'exploitation', nom_complet = 'â€¦' from auth.users u where u.id = p.id and u.email = 'â€¦@henzo.local';`

## Tester avant d'appliquer

`npm run test:db` exÃ©cute les migrations dans une base PostgreSQL locale (PGlite) et vÃ©rifie
les droits de chaque rÃ´le et les rÃ¨gles de gestion (94 vÃ©rifications).

## RÃ¨gles pour les prochaines tables

- clÃ© primaire `id uuid default gen_random_uuid()` : l'appli gÃ©nÃ¨re l'`id` hors connexion ;
- `ferme_id uuid not null default public.ferme_actuelle()` et `saisi_par uuid default auth.uid()` ;
- RLS activÃ©e ; utiliser `public.a_role('directeur', â€¦)` dans les rÃ¨gles ;
- opÃ©ration financiÃ¨re : pas de modification ni suppression, annulation par le directeur uniquement.
