# Migrations Supabase

| Fichier | Contenu |
|---|---|
| `0001_schema_etape1.sql` | Rôles, profils, fonction `role_actuel()` (les tables provisoires sont remplacées par 0002) |
| `0002_refonte_phase_a.sql` | Base conforme au cahier des charges : fermes, bandes de chair et lots de pondeuses, saisies de terrain, clients/fournisseurs, prix, stock, caisses, registre d'écritures non modifiable, ventes, dépenses, validations, notifications, journal, sécurité par rôle |

## Installation

1. Supabase > **SQL Editor** > coller le fichier > **Run** (dans l'ordre : 0001 puis 0002).
2. **Authentication > Users > Add user** : `<nom>@henzo.local` + mot de passe, « Auto Confirm User » coché.
3. Attribuer le rôle (chaque nouveau compte est « employe ») :
   `update public.profiles p set role = 'exploitation', nom_complet = '…' from auth.users u where u.id = p.id and u.email = '…@henzo.local';`

## Tester avant d'appliquer

`npm run test:db` exécute les migrations dans une base PostgreSQL locale (PGlite) et vérifie
les droits de chaque rôle et les règles de gestion (94 vérifications).

## Règles pour les prochaines tables

- clé primaire `id uuid default gen_random_uuid()` : l'appli génère l'`id` hors connexion ;
- `ferme_id uuid not null default public.ferme_actuelle()` et `saisi_par uuid default auth.uid()` ;
- RLS activée ; utiliser `public.a_role('directeur', …)` dans les règles ;
- opération financière : pas de modification ni suppression, annulation par le directeur uniquement.
