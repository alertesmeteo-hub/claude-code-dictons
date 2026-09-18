# dicton-du-jour.alertes-meteo.com

Mini-site qui publie automatiquement chaque jour une page « Dictons et proverbes du jour » (saint du jour, dictons, météo géolocalisée, lever/coucher du soleil, éphéméride).

## Architecture

```
GitHub (code source)
   │  git pull / déploiement
   ▼
Next.js (hébergé où que ce soit : VPS, Vercel, etc. — plus de contrainte réseau)
   │  appels HTTPS (jamais de connexion MySQL directe)
   ▼
ovh-api/ (script PHP déployé sur l'hébergement mutualisé OVH existant)
   │  connexion MySQL locale (comme le fait déjà le plugin WordPress am-dictionnaire-meteo)
   ▼
Base MySQL bijouxdealertes (nouvelles tables dédiées, séparées de dictionnaire_termes)
```

**Pourquoi cet intermédiaire ?** La base `bijouxdealertes` (hébergement mutualisé OVH) n'accepte que les connexions internes au réseau OVH — confirmé en testant une connexion directe depuis GitHub Actions (`Can't reach database server`). Plutôt que d'exiger que tout le site tourne physiquement chez OVH, un petit script PHP déployé sur cet hébergement (accès local, jamais bloqué) sert d'API HTTP : le site Next.js — et les tâches GitHub Actions — l'appellent en HTTPS comme n'importe quel site web, sans restriction réseau.

## État du projet (MVP)

Implémenté :
- Pages du jour SSR (`/YYYY/MM/DD/`), redirection `/` → jour courant.
- Calculs déterministes 100% locaux, testés : jour de l'année, semaine ISO, zodiaque, astrologie chinoise (approximation par année civile), calendrier républicain (approximation, voir commentaire dans le code), lever/coucher du soleil (algorithme NOAA).
- Météo géolocalisée via Open-Meteo (gratuit, sans clé), avec repli sur recherche manuelle de commune si la géolocalisation est refusée.
- API PHP intermédiaire (`ovh-api/`) + client TypeScript (`lib/db/ovh-api-client.ts`) — voir section dédiée.
- API interne du site (`/api/v1/...`) documentée ci-dessous.
- Sitemap (90 derniers jours) + robots.txt (admin exclue).
- Jeu de données **365 jours de saints** (Nominis) et **365 jours de dictons** (meteoeu.net) — voir "Sources du contenu éditorial".
- Plugin WordPress `[temperatures_extremes_france]` (cache, timeout, fallback).
- Interface d'administration sur `/admin-x7f2k9/` (accès libre, non indexée) : tableau de bord, gestion des saints, gestion des dictons, journal des tâches. **Renommez ce dossier avant déploiement** (voir section Sécurité).

**Non implémenté / à finaliser avant mise en production** :
- `scripts/cron-extremes-meteo.ts` : branché sur l'API réelle **Météo-France DPObs v1**, endpoints `/liste-stations-synop` + `/station/horaire` confirmés existants. Deux points restent à vérifier avec un compte réel : le flux exact d'échange clé→token (`obtenirToken()`) et le nom/unité exact du champ température (`recupererExtremesStation()`) — annotés `⚠️` dans le fichier.
- Dictons importés (meteoeu.net) : classés uniformément `dicton_meteo` par défaut (affinable depuis l'admin) ; le 2 août est absent (page source incomplète).
- Saints importés : `verifie: false` sur les 365 (relecture humaine recommandée) ; pas de champ "autres prénoms fêtés" (absent du flux) ; 29 février absent.
- `ovh-api/` n'est pas encore déployé sur l'hébergement OVH (voir procédure ci-dessous).

## Stack

Next.js 16 (App Router, TypeScript) + API PHP intermédiaire (mysqli) + MySQL (serveur `bijouxdealertes` existant, nouvelles tables dédiées) + Vitest.

## Installation (site Next.js)

```bash
npm install
cp .env.example .env
# éditer .env : OVH_API_URL + OVH_API_TOKEN (voir déploiement ovh-api/ ci-dessous), ADMIN_SLUG, NEXT_PUBLIC_SITE_URL
npm run seed   # importe les 365 saints + 365 dictons via l'API OVH (une fois ovh-api/ déployé)
```

## Déploiement de l'API PHP (`ovh-api/`)

À faire une fois, avant toute autre chose :

1. **Créer les tables** : ouvrir phpMyAdmin (Manager OVH → Bases de données → `bijouxdealertes` → "..." → Accéder à phpMyAdmin), onglet SQL, coller le contenu de `ovh-api/schema.sql`, exécuter.
2. **Déposer les fichiers** : envoyer `ovh-api/index.php` sur l'hébergement OVH (par FTP/SSH), par exemple dans un dossier `dicton-api/` à la racine du site.
3. **Configurer les secrets** : copier `ovh-api/config.example.php` en `config.php` **à côté de `index.php` sur le serveur** (jamais commité — `config.php` est dans `.gitignore`), renseigner les identifiants MySQL (déjà connus, mêmes que ceux de `wp-config.php`) et générer un jeton aléatoire long pour `DICTON_API_TOKEN` (ex: `openssl rand -hex 32` dans un terminal).
4. **Tester** :
   ```bash
   curl -H "Authorization: Bearer <ton_token>" "https://alertes-meteo.com/dicton-api/?route=saints"
   ```
   Doit répondre `[]` (liste vide, avant import).
5. Dans `.env` du projet Next.js, renseigner `OVH_API_URL` (l'URL du dossier, sans `index.php` ni slash final) et `OVH_API_TOKEN` (même valeur que `DICTON_API_TOKEN`).

## Développement

```bash
npm run dev
```

## Tests

```bash
npm test
```

## Build production

```bash
npm run build
npm start
```

## Tâches planifiées

Deux options, au choix :
- **GitHub Actions** (`.github/workflows/cron-jobs.yml`) : fonctionne maintenant sans souci réseau, puisque ces tâches n'appellent que l'API PHP en HTTPS.
- **Cron sur un serveur** (VPS ou autre) qui héberge le site : `npm run cron:generation-jour` (00:05) et `npm run cron:extremes-meteo` (toutes les 3h).

## API interne (site Next.js)

| Endpoint | Description |
|---|---|
| `GET /api/v1/jour/:date` | Contenu complet d'un jour (`date` = `YYYY-MM-DD`) |
| `GET /api/v1/meteo?lat=&lon=` | Prévisions météo (proxy Open-Meteo, cache 15 min) |
| `GET /api/v1/soleil?lat=&lon=&date=` | Lever/coucher du soleil calculés |
| `GET /api/v1/extremes/france` | Températures extrêmes du jour (relaie `ovh-api/`, consommé par le plugin WordPress) |
| `GET /api/v1/villes/recherche?q=` | Autocomplete recherche de commune |

## API PHP intermédiaire (`ovh-api/`)

Toutes les routes nécessitent l'en-tête `Authorization: Bearer <DICTON_API_TOKEN>`.

| Route | Méthode | Description |
|---|---|---|
| `?route=jour&date=YYYY-MM-DD` | GET | Saint + dictons du jour |
| `?route=saints` | GET | Liste complète des saints |
| `?route=saints` | POST | Créer/mettre à jour un saint |
| `?route=saints/bulk` | POST | Import en masse (seed initial) |
| `?route=dictons` | GET | Liste complète des dictons |
| `?route=dictons` | POST | Ajouter un dicton |
| `?route=dictons/toggle` | POST | Activer/désactiver un dicton (`{id}`) |
| `?route=dictons/bulk` | POST | Import en masse (seed initial) |
| `?route=villes/recherche&q=` | GET | Recherche de commune |
| `?route=extremes/france` | GET | Températures extrêmes du jour |
| `?route=extremes/france` | POST | Enregistrer des mesures (`{mesures: [...]}`) |
| `?route=sync-logs&limite=` | GET | Derniers logs de tâches |
| `?route=sync-logs` | POST | Ajouter un log |
| `?route=pages-jour` | POST | Traçabilité génération du jour |

## Plugin WordPress

Fichier : `wordpress-plugin/temperatures-extremes-france.php`. À installer sur un autre site WordPress, avec en option dans `wp-config.php` :

```php
define( 'TEF_API_URL', 'https://dicton-du-jour.alertes-meteo.com/api/v1/extremes/france' );
```

Puis utiliser `[temperatures_extremes_france]` dans une page ou un article.

## Sources du contenu éditorial

**Saints** : `prisma/seed-data-saints.json` (365 entrées) généré par `prisma/parser-nominis.mjs` à partir du flux iCal public de Nominis (Conférence des évêques de France) :

```bash
curl -sL "https://nominis.cef.fr/ical/nominis.php" -o prisma/nominis-raw.ics
node prisma/parser-nominis.mjs
```

Chaque saint conserve l'URL Nominis exacte dont il provient (`source`) et démarre avec `verifie: false` : à basculer manuellement (via l'admin) après relecture. Un seul saint est retenu par jour (le premier du flux) alors que certains jours en comptent plusieurs dans le calendrier catholique complet.

**Dictons** : `prisma/seed-data-dictons.json` (1441 entrées sur 365 jours) généré par `prisma/parser-meteoeu.mjs` à partir des 12 pages mensuelles de meteoeu.net (dictons traditionnels d'almanach, domaine public) :

```bash
mkdir -p prisma/meteoeu-raw
for m in janvier fevrier mars avril mai juin juillet aout septembre octobre novembre decembre; do
  curl -s "https://www.meteoeu.net/dictons-$m.htm" -o "prisma/meteoeu-raw/$m.html"
done
node prisma/parser-meteoeu.mjs
```

Chaque dicton conserve l'URL de la page mensuelle source.

## Sécurité de l'admin

Pas d'authentification (choix assumé pour ce mini-site) : la protection repose uniquement sur l'obscurité de l'URL. Avant déploiement :

1. Renommez le dossier `app/admin-x7f2k9/` en un slug aléatoire propre à vous.
2. Mettez à jour tous les `href="/admin-x7f2k9/..."` dans `app/admin-x7f2k9/layout.tsx` et `app/admin-x7f2k9/page.tsx` avec le nouveau slug.
3. Renseignez la même valeur dans `ADMIN_SLUG` (`.env`) pour que `app/robots.ts` l'exclue de l'indexation.

De même côté `ovh-api/` : place idéalement `index.php` dans un dossier au nom non devinable (pas littéralement `dicton-api/`), et garde `DICTON_API_TOKEN` long et aléatoire — c'est la seule protection de cette API.

## Secrets et CI/CD

Deux workflows GitHub Actions :
- `.github/workflows/ci.yml` : build + tests à chaque push/PR sur `main`.
- `.github/workflows/cron-jobs.yml` : exécute les tâches planifiées directement depuis GitHub Actions (plus de blocage réseau, puisque tout passe par l'API PHP en HTTPS).

**Secrets attendus** (Settings → Secrets and variables → Actions du dépôt) : `OVH_API_URL`, `OVH_API_TOKEN`, `METEOFRANCE_API_KEY`. `alertesmeteo-hub` étant un compte personnel GitHub (pas une organisation), ces secrets sont définis **par dépôt** — pas de partage automatique entre projets ; à redéfinir dans chaque dépôt qui en a besoin lors d'une rotation.

## Déploiement du site Next.js (proposition)

Puisque la base n'impose plus d'être physiquement chez OVH (grâce à `ovh-api/`), le site peut être hébergé n'importe où : VPS (OVH ou ailleurs), ou une plateforme gratuite compatible Next.js. Prévoir un process manager (ex: PM2) derrière un reverse-proxy (nginx) avec TLS si VPS ; déploiement automatisé via GitHub Actions à ajouter dans une prochaine passe.
