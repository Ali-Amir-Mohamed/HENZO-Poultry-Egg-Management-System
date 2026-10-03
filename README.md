# HENZO – Gestion de ferme avicole et production d'œufs

PWA React + Vite, bilingue français/anglais, connectée à Supabase, avec saisie hors connexion.

## Démarrage local

```bash
npm install
cp .env.example .env.local   # puis renseigner l'URL et la clé anon Supabase
npm run dev
```

## Structure

| Chemin | Rôle |
|---|---|
| `src/config.js` | Noms des tables, rôles, droits d'accès par section |
| `src/lib/supabase.js` | Client Supabase |
| `src/lib/offlineQueue.js` | File d'attente IndexedDB (Dexie) + synchronisation automatique |
| `src/lib/referenceData.js` | Listes de référence (bandes actives) mises en cache pour le hors-ligne |
| `src/auth/AuthProvider.jsx` | Session et profil (rôle), profil mis en cache pour l'usage hors ligne |
| `src/locales/{fr,en}.json` | Traductions |
| `supabase/migrations/` | Schéma SQL |

## Rôles

| Rôle | Titulaire | Accès |
|---|---|---|
| `directeur` | — | tout |
| `exploitation` | Kenfack Dirand | saisie, production |
| `finance` | Dahirou Bachar | saisie, finance |
| `employe` | — | saisie |

## Hors connexion

- L'application (HTML/JS/CSS) est mise en cache par le service worker et s'ouvre sans réseau.
- La **première connexion** doit se faire avec internet ; la session reste ensuite valable hors ligne.
- Chaque saisie est d'abord écrite dans IndexedDB, puis envoyée à Supabase au retour du réseau
  (événement `online` + toutes les 60 s). L'`id` UUID est généré sur l'appareil, l'envoi est donc idempotent.

## Déploiement Cloudflare Pages

- Framework preset : **Vite** — Build command : `npm run build` — Output : `dist`
- Variables d'environnement : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (et `NODE_VERSION=20`)
- `public/_redirects` gère le routage SPA.
- Dans Supabase > Authentication > URL Configuration, ajouter l'URL `*.pages.dev`.
