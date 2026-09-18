# dicton-du-jour.alertes-meteo.com

Mini-site qui publie automatiquement chaque jour une page « Dictons et proverbes du jour » (saint du jour, dictons, météo géolocalisée, lever/coucher du soleil, éphéméride).

## État du projet (MVP)

Implémenté :
- Pages du jour SSR (`/YYYY/MM/DD/`), redirection `/` → jour courant.
- Calculs déterministes 100% locaux, testés : jour de l'année, semaine ISO, zodiaque, astrologie chinoise (approximation par année civile), calendrier républicain (approximation, voir commentaire dans le code), lever/coucher du soleil (algorithme NOAA).
- Météo géolocalisée via Open-Meteo (gratuit, sans clé), avec repli sur recherche manuelle de commune si la géolocalisation est refusée.
- API interne (`/api/v1/...`) documentée ci-dessous.
- Sitemap (90 derniers jours) + robots.txt (admin exclue).
- Schéma Prisma / MySQL (`prisma/schema.prisma`) + seed des **365 jours de saints** (Nominis) et **365 jours de dictons** (meteoeu.net) — voir section "Sources du contenu éditorial" ci-dessous.
- Plugin WordPress `[temperatures_extremes_france]` (cache, timeout, fallback).
- Interface d'administration sur `/admin-x7f2k9/` (accès libre, non indexée) : tableau de bord (dernières tâches, alertes d'erreur, republication forcée du jour), gestion des saints, gestion des dictons (ajout/désactivation), journal des tâches automatiques. **Renommez ce dossier avant déploiement** (voir section Sécurité ci-dessous).

**Non implémenté / à finaliser avant mise en production** :
- `scripts/cron-extremes-meteo.ts` : branché sur l'API réelle **Météo-France DPObs v1** (`https://public-api.meteofrance.fr/public/DPObs/v1`, gratuite sur inscription à https://portail-api.meteofrance.fr/), endpoints `/liste-stations-synop` + `/station/horaire` confirmés existants. **Deux points restent à vérifier avec un compte réel** (non vérifiables sans authentification) : le flux exact d'échange clé→token (`obtenirToken()`) et le nom/unité exact du champ température dans la réponse `/station/horaire` (`recupererExtremesStation()`) — les deux sont clairement annotés `⚠️` dans le fichier. À tester et ajuster dès qu'un compte API est créé, avant d'activer le cron en production.
- Dictons importés (meteoeu.net) : classés uniformément `dicton_meteo` par défaut (approximation, certains sont plutôt paysans/agricoles — affinable depuis l'admin) ; le 2 août est absent (page source incomplète pour ce jour) ; pas de `proverbe`/`adage` génériques au sens strict dans ce jeu de données (uniquement des dictons datés).
- Saints importés : `verifie: false` sur les 365 (relecture humaine recommandée avant publication, notamment pour les jours à célébrations multiples où un seul saint a été retenu par jour) ; le champ "autres prénoms fêtés" n'a pas pu être rempli depuis ce flux (absent du iCal) — à compléter séparément si souhaité ; le 29 février est absent (calendrier généré sur une année non bissextile) et à ajouter manuellement.

## Stack

Next.js 16 (App Router, TypeScript) + Prisma 5 + MySQL (serveur `bijouxdealertes` existant, nouvelles tables dédiées) + Vitest.

## Installation

```bash
npm install
cp .env.example .env
# éditer .env : DATABASE_URL vers le serveur MySQL bijouxdealertes, ADMIN_SLUG, NEXT_PUBLIC_SITE_URL
npx prisma generate
npx prisma migrate dev --name init
npm run prisma:seed
```

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

## Tâches planifiées (cron serveur, hors app)

```bash
# chaque nuit à 00:05
npm run cron:generation-jour

# toutes les 3h (une fois recupererDonneesStations() implémenté)
npm run cron:extremes-meteo
```

## API interne

| Endpoint | Description |
|---|---|
| `GET /api/v1/jour/:date` | Contenu complet d'un jour (`date` = `YYYY-MM-DD`) |
| `GET /api/v1/meteo?lat=&lon=` | Prévisions météo (proxy Open-Meteo, cache 15 min) |
| `GET /api/v1/soleil?lat=&lon=&date=` | Lever/coucher du soleil calculés |
| `GET /api/v1/extremes/france` | Températures extrêmes du jour (consommé par le plugin WordPress) |
| `GET /api/v1/villes/recherche?q=` | Autocomplete recherche de commune |

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

Chaque saint conserve l'URL Nominis exacte dont il provient (`source`) et démarre avec `verifie: false` : le champ `verifie` est à basculer manuellement (via l'admin) après relecture, comme demandé dans le cahier des charges initial ("ne jamais inventer un saint"). Un seul saint est retenu par jour (le premier du flux) alors que certains jours en comptent plusieurs dans le calendrier catholique complet — les autres restent consultables via l'URL source si besoin d'enrichir plus tard.

**Dictons** : `prisma/seed-data-dictons.json` (1441 entrées sur 365 jours) généré par `prisma/parser-meteoeu.mjs` à partir des 12 pages mensuelles de meteoeu.net (dictons traditionnels d'almanach, domaine public) :

```bash
mkdir -p prisma/meteoeu-raw
for m in janvier fevrier mars avril mai juin juillet aout septembre octobre novembre decembre; do
  curl -s "https://www.meteoeu.net/dictons-$m.htm" -o "prisma/meteoeu-raw/$m.html"
done
node prisma/parser-meteoeu.mjs
```

Chaque dicton conserve l'URL de la page mensuelle source. Classement par `type` approximatif (voir ci-dessus) : à affiner depuis l'admin si besoin d'une catégorisation plus fine dicton météo / dicton paysan / proverbe / adage.

## Sécurité de l'admin

Pas d'authentification (choix assumé pour ce mini-site) : la protection repose uniquement sur l'obscurité de l'URL. Avant déploiement :

1. Renommez le dossier `app/admin-x7f2k9/` en un slug aléatoire propre à vous (ex: `app/gestion-<chaîne-aléatoire>/`).
2. Mettez à jour tous les `href="/admin-x7f2k9/..."` dans `app/admin-x7f2k9/layout.tsx` et `app/admin-x7f2k9/page.tsx` avec le nouveau slug.
3. Renseignez la même valeur dans `ADMIN_SLUG` (`.env`) pour que `app/robots.ts` l'exclue de l'indexation.

## Secrets et CI/CD

Deux workflows GitHub Actions sont fournis :
- `.github/workflows/ci.yml` : build + tests à chaque push/PR sur `main`.
- `.github/workflows/cron-jobs.yml` : exécute `cron:generation-jour` (00:05 UTC) et `cron:extremes-meteo` (toutes les 3h) directement depuis GitHub Actions — alternative à un cron sur VPS, pas besoin de serveur dédié pour ces tâches.

**Secrets attendus** : `DATABASE_URL`, `METEOFRANCE_API_KEY`. Aucun secret n'est stocké en local (pas de `.env` avec de vraies valeurs commité) : à définir dans GitHub, idéalement au **niveau de l'organisation** `alertesmeteo-hub` (`https://github.com/organizations/alertesmeteo-hub/settings/secrets/actions`) plutôt que par dépôt — un secret d'organisation est partagé par tous les repos autorisés (ex: `harmonie-knmi` et ce projet), donc une rotation de clé annuelle se fait **une seule fois**, pas repo par repo.

## Déploiement (proposition)

VPS avec Node.js 20+, process manager (ex: PM2) devant un reverse-proxy (nginx) avec TLS, connecté au serveur MySQL `bijouxdealertes` existant. Déploiement via GitHub Actions (build + `pm2 reload` sur push vers `main`) — pipeline CI/CD à ajouter dans une prochaine passe.
