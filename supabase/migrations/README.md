# Migrations Supabase

| Fichier | Contenu |
|---|---|
| `0001_schema_etape1.sql` | Rôles, profils, bâtiments, bandes, ramassages d'œufs, mortalités, aliment, ventes, dépenses, vues et règles RLS |

## Installation

1. Supabase > **SQL Editor** > coller le contenu de `0001_schema_etape1.sql` > **Run**.
2. **Authentication > Users > Add user** : créer les comptes (directeur, Kenfack Dirand, Dahirou Bachar, employés).
3. Attribuer les rôles avec les requêtes `update` indiquées en fin de fichier
   (chaque nouveau compte est « employe » par défaut).

## Règles à respecter pour les prochaines tables

- clé primaire `id uuid default gen_random_uuid()` : l'appli génère l'`id` hors connexion ;
- colonne `saisi_par uuid default auth.uid()` pour les saisies ;
- RLS activée, avec au minimum une règle `insert` pour les rôles qui saisissent.
