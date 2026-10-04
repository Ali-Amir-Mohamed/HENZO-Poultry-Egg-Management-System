# Sauvegardes et restauration de HENZO

## Ce qui est sauvegardé

Chaque dimanche (et à la demande), GitHub Actions exécute `.github/workflows/sauvegarde.yml` :

- `henzo-public.dump` : toute la structure et toutes les données de l'application (schéma `public`) ;
- `comptes.csv` : les comptes de connexion (identifiants et mots de passe **chiffrés**).

Le tout est compressé puis **chiffré (AES-256)** avec le mot de passe `BACKUP_PASSPHRASE`.
Sans ce mot de passe, le fichier est illisible : conservez-le en lieu sûr (et pas seulement dans GitHub).

Les sauvegardes restent 90 jours dans GitHub > **Actions** > *Sauvegarde hebdomadaire* > une exécution > **Artifacts**.

> GitHub met en pause les tâches planifiées d'un dépôt sans aucune activité depuis 60 jours :
> vérifiez de temps en temps dans l'onglet **Actions** que les sauvegardes continuent.

En plus, le directeur peut télécharger à tout moment une copie lisible des données depuis
HENZO : **Réglages > Sauvegarde > Exporter toutes les données**.

## Restaurer

Il faut le client PostgreSQL 17 (`psql`, `pg_restore`) et GnuPG (`gpg`).

1. Télécharger l'artefact depuis GitHub et le décompresser (fichier `henzo-AAAA-MM-JJ.tar.gz.gpg`).
2. Déchiffrer :
   ```bash
   gpg --decrypt henzo-AAAA-MM-JJ.tar.gz.gpg > henzo.tar.gz
   tar xzf henzo.tar.gz
   ```
3. **Base vide** (nouveau projet Supabase) — recréer les comptes **avant** les données
   (les profils pointent vers les comptes) :
   ```bash
   psql "$NOUVELLE_URL" -c "\copy auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at) from 'sauvegarde/comptes.csv' csv header"
   ```
   Puis compléter les champs obligatoires des comptes recréés :
   ```sql
   update auth.users set instance_id = '00000000-0000-0000-0000-000000000000', aud = 'authenticated',
     role = 'authenticated', updated_at = now(), raw_app_meta_data = '{"provider":"email","providers":["email"]}'
   where aud is null;
   insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
   select gen_random_uuid(), id, id::text, 'email', jsonb_build_object('sub', id::text, 'email', email), now(), now()
   from auth.users u where not exists (select 1 from auth.identities i where i.user_id = u.id);
   ```
4. Restaurer les données :
   ```bash
   pg_restore --no-owner --no-privileges --clean --if-exists -d "$NOUVELLE_URL" sauvegarde/henzo-public.dump
   ```
5. Dans HENZO (`.env.local` et Cloudflare Pages), remplacer l'URL et la clé du projet Supabase si elles ont changé.

**Base existante abîmée** (même projet) : l'étape 4 seule suffit ; `--clean` remplace le contenu du schéma `public`.

Faites un essai de restauration sur un projet Supabase de test au moins une fois, pour être sûr que la procédure marche.
