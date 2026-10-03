# Migrations Supabase

Placer ici le schéma de l'étape 1 : `0001_schema_etape1.sql`.

Exigences de l'application (voir `src/config.js`) :
- table `profiles` : `id uuid` (= `auth.users.id`), `full_name text`, `role` parmi
  `directeur`, `exploitation`, `finance`, `employe` ;
- toute table saisie hors connexion doit avoir une clé primaire `id uuid`
  (l'identifiant est généré sur le téléphone, ce qui évite les doublons à la resynchronisation) ;
- RLS : autoriser `insert` aux rôles concernés et `select` sur leur propre `profiles`.
