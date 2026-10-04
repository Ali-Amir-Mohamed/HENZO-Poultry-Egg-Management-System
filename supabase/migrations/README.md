# Migrations Supabase

| Fichier | Contenu |
|---|---|
| `0001_schema_etape1.sql` | Rôles, profils, fonction `role_actuel()` (les tables provisoires sont remplacées par 0002) |
| `0002_refonte_phase_a.sql` | Base conforme au cahier des charges : fermes, bandes de chair et lots de pondeuses, saisies de terrain, clients/fournisseurs, prix, stock, caisses, registre d'écritures non modifiable, ventes, dépenses, validations, notifications, journal, sécurité par rôle |
| `0003_phase_b_bandes.sql` | Indicateurs des bandes et des lots, bilan figé à la clôture, résultat par activité |
| `0004_phase_c_argent.sql` | Investisseurs (capital, 10 % à chaque fin de bande de chair), prêts, vérification de caisse |
| `0005_phase_d_organisation.sql` | Tâches, programmes, réalisations hors ligne, alerte de mortalité, vue des alertes |
| `0006_phase_e_analyses.sql` | Capital initial et prêts existants (sans mouvement de caisse), fonction `rapport_mensuel` |
| `0007_complements.sql` | Client / fournisseur obligatoire au-delà d'un seuil, bénéfice net et disponible par bande, transferts entre caisses, identifiants des comptes, durée de session |
| `0008_securite_fonctions.sql` | Fonctions internes non exécutables par les utilisateurs (Security Advisor) |
| `0009_alerte_stock.sql` | Alerte « stock bas » seulement si un seuil est fixé |
| `0010_livraisons_poussins.sql` | Livraisons de poussins en plusieurs fois (nombre initial = somme des livraisons) |
| `0011_commandes_poussins.sql` | Commandes de poussins, livraisons prévues, réception « Livré », report et annulation |
| `0012_commandes_multi_bandes.sql` | Une commande pour plusieurs bandes (référence commune), code de bande unique |

Le Security Advisor signale encore « Security Definer View » sur les vues de calcul (effectifs,
indicateurs, résultats, alertes) : c'est voulu, chacune filtre elle-même la ferme et les rôles.

## Installation

1. Supabase > **SQL Editor** > coller chaque fichier > **Run**, dans l'ordre (0001, 0002, … 0006).
2. **Authentication > Users > Add user** : `<nom>@henzo.local` + mot de passe, « Auto Confirm User » coché.
3. Attribuer le rôle (chaque nouveau compte est « employe ») :
   `update public.profiles p set role = 'exploitation', nom_complet = '…' from auth.users u where u.id = p.id and u.email = '…@henzo.local';`

## Tester avant d'appliquer

`npm run test:db` exécute les migrations dans une base PostgreSQL locale (PGlite) et vérifie
les droits de chaque rôle et les règles de gestion (200 vérifications).

## Règles pour les prochaines tables

- clé primaire `id uuid default gen_random_uuid()` : l'appli génère l'`id` hors connexion ;
- `ferme_id uuid not null default public.ferme_actuelle()` et `saisi_par uuid default auth.uid()` ;
- RLS activée ; utiliser `public.a_role('directeur', …)` dans les règles ;
- opération financière : pas de modification ni suppression, annulation par le directeur uniquement ;
- une fonction appelée par une vue s'exécute avec les droits de l'utilisateur : elle doit lui être accessible ;
- depuis 0008, une nouvelle fonction n'est exécutable par personne : accordez explicitement
  `grant execute … to authenticated` seulement si une règle RLS, une vue ou l'appli l'appelle.
