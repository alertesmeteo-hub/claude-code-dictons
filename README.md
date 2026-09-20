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

Implémenté (site en production sur un VPS OVH, voir « Déploiement ») :
- **Page du jour** `/YYYY/MM/DD/` (SSR) : en-tête « Nous sommes le … » (toujours la date du jour à Paris) avec navigation veille/lendemain, saint du jour, **fête du jour** (prénoms fêtés + autres fêtes, Nominis, et **fêtes populaires** : Saint-Valentin, Fête des Mères…), dictons (entre « »), météo locale et lever/coucher du soleil, **saisons météo et calendrier**, **cycle lunaire** (phase avec icône, apogée/périgée), **événements historiques** (Wikipédia), informations complémentaires (zodiaque, calendrier républicain, prochain jour férié), partage sur les réseaux.
- **Menu du haut** (`components/MenuSite.tsx`) : ancres vers les blocs de la page du jour, plus **Calendrier**, **Vacances scolaires** et **Jours fériés**.
- **Calendrier mensuel imprimable** `/calendrier/YYYY/MM/` : grille avec semaines ISO, saints, jours fériés, phases de la Lune, fêtes ; infobulle par jour ; texte de présentation du mois ; aide à l'impression (A4 paysage).
- **Vacances scolaires** `/vacances-scolaires` : zones A, B, C, données officielles (data.education.gouv.fr).
- **Jours fériés** `/jours-feries` et `/jours-feries/YYYY`.
- **Températures extrêmes** : script `cron-extremes-meteo.ts` (Météo-France) + route publique + plugin WordPress `[temperatures_extremes_france]`.
- **Archives de vigilance** : script `cron-vigilance-meteo.ts` (Météo-France) — carte des couleurs par département (échéances J et J+1) et texte de synthèse national, archivés quotidiennement en base.
- Calculs déterministes 100 % locaux, testés (Vitest) : jour de l'année, semaine ISO, zodiaque, astrologie chinoise, calendrier républicain, Pâques et jours fériés, lever/coucher du soleil (NOAA), phases de la Lune et distance Terre-Lune (Meeus ch. 47 et 49), équinoxes et solstices (Meeus ch. 27), fêtes populaires (dates calculées).
- Météo géolocalisée via Open-Meteo (gratuit, sans clé), avec repli sur recherche manuelle de commune.
- API PHP intermédiaire (`ovh-api/`) + client TypeScript (`lib/db/ovh-api-client.ts`).
- Sitemap (90 derniers jours) + robots.txt (admin exclue). Pied de page avec version du module (`package.json`) et date du build.
- Jeu de données **365 saints** (Nominis), **366 jours de fêtes** (Nominis) et **1 400+ dictons** (meteoeu.net) — voir « Sources du contenu éditorial ».
- Interface d'administration sur `/admin-x7f2k9/` (accès libre, non indexée). **Renommez ce dossier avant la mise en public** (voir « Sécurité »).

**À finaliser / connu** :
- Saints : `verifie: false` sur les 365 (relecture humaine recommandée) ; le 29 février est absent ; 7 fêtes religieuses sans présentation.
- Dictons : classés `dicton_meteo` par défaut (affinable dans l'admin) ; le 2 août est absent.
- Extrêmes météo : la Corse (2A/2B) dépend d'un code de département non documenté par l'API (le script en essaie plusieurs et l'écrit dans le journal) ; l'outre-mer n'est pas couvert.
- Vacances scolaires : zones A/B/C uniquement (ni Corse ni outre-mer) ; les ponts ne sont pas listés.
- Traduction anglaise : non faite.

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

- `npm run cron:generation-jour` : trace la génération du jour (00:05).
- `npm run cron:extremes-meteo` : températures extrêmes du jour. Sur le VPS, une ligne cron toutes les heures (minute 20) avec un verrou pour éviter les chevauchements :

```
20 * * * * cd /home/ubuntu/claude-code-dictons && flock -n /tmp/extremes.lock /usr/bin/npm run cron:extremes-meteo >> /home/ubuntu/cron-extremes.log 2>&1
```

Le script lit `METEOFRANCE_API_KEY` dans `.env` : clé de type **API Key** (le jeton OAuth2 expire en 1 h), envoyée dans l'en-tête `apikey`. Attention : une clé fait ~4 800 caractères, plus que la limite d'une ligne collée dans un terminal (4 095) : l'enregistrer dans `.env` avec un éditeur (nano), pas avec `read` ou `echo`.

Sources utilisées (API Météo-France, portail https://portail-api.meteofrance.fr) :
- **DPObs v1** `/liste-stations` (CSV : identifiant, nom, altitude…) ;
- **DPPaquetObs v1** `/paquet/horaire?id-departement=XX&format=json` (observations horaires des 24 dernières heures de toutes les stations du département ; `t`, `tx`, `tn` en kelvins).

Un passage = ~95 appels espacés de 1,5 s (2-3 minutes). Le script garde les 15 stations les plus chaudes (maxima) et les 15 les plus froides (minima) sous 500 m d'altitude, et échoue s'il y a plus de 20 % de départements en erreur.

`npm run cron:vigilance-meteo` : archive le bulletin de vigilance courant (toutes les heures via GitHub Actions). Source (API Météo-France, même clé `METEOFRANCE_API_KEY`, souscription « DonneesPubliquesVigilance ») :
- **DPVigilance v1** `/cartevigilance/encours` : couleur maximale par département (1 vert → 4 rouge), échéances J et J+1 ;
- **DPVigilance v1** `/textesvigilance/encours` (sans paramètre `domain`, sinon 404) : bulletin de synthèse national en JSON, archivé tel quel sans être interprété.

Une entrée par (date, heure de bulletin, échéance, département) est conservée : un même jour peut compter plusieurs bulletins (~6h, 16h, réévaluations en cours d'événement), chacun archivé séparément. Les tables `vigilance_carte` et `vigilance_textes` se créent automatiquement au premier appel (comme `fetes_jour`) — pas besoin de passer par phpMyAdmin pour celles-ci.

**Historique détail département (fin 2022 → aujourd'hui)** : `npm run backfill:vigilance -- --depuis=2022-11-28` importe, une fois, l'archive publique [« Vigilance météorologique archivée »](https://www.data.gouv.fr/datasets/vigilance-meteorologique-archivee) (`files.data.gouv.fr/meteofrance/data/vigilance/metropole/AAAA/MM/JJ/HHMMSS/CDP_CARTE_EXTERNE.json`, même format que l'API temps réel — couleur par département, pas de texte de synthèse). Table `vigilance_carte`.

**Historique national (octobre 2001 → aujourd'hui)** : `npm run backfill:vigilance-national -- --depuis=2001-10` importe, une fois, l'archive officielle [vigilance-public.meteo.fr](http://vigilance-public.meteo.fr/) (`tableaux_mensuels.php?start_date=AAAA-MM`, un appel par mois). Cette archive remonte à la création du dispositif (2001), mais ne donne que la **couleur maximale nationale** par jour (pas de détail département — celui-ci n'existe pour cette période que sous forme de cartes GIF, non exploitées ici). Table `vigilance_national_jour`.

**Historique par département (octobre 2001 → aujourd'hui)** : `npm run backfill:vigilance-departement -- --depuis=2001-10` importe, une fois, le détail par département depuis le site tiers [vigiscript.fr](https://www.vigiscript.fr/Ancien_bulletin/) (`affichage_calendrier.php?department=XX&year=AAAA&month=MM&ajax=month-colors`, JSON). **Ce n'est pas une source officielle Météo-France** — c'est une reconstitution tierce, la meilleure approximation disponible pour cette période (l'officiel n'existe qu'en images GIF avant fin 2022). Environ 95 départements × 300 mois = ~28 500 appels, prévoir plusieurs heures. Table `vigilance_departement_jour`.

Les deux scripts sont à lancer manuellement (pas planifiés), idempotents, avec pause entre les appels — peuvent prendre plusieurs heures pour un backfill complet.

GitHub Actions (`.github/workflows/cron-jobs.yml`) reste disponible ; secrets nécessaires : `OVH_API_URL`, `OVH_API_TOKEN`, `METEOFRANCE_API_KEY`.

## Routes du site

| Route | Contenu |
|---|---|
| `/` | Redirige vers le jour courant (heure de Paris) |
| `/YYYY/MM/DD/` | Page du jour |
| `/calendrier` , `/calendrier/YYYY/MM/` | Calendrier mensuel imprimable |
| `/vacances-scolaires` | Vacances scolaires zones A/B/C (cache 24 h) |
| `/jours-feries` , `/jours-feries/YYYY/` | Jours fériés |

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
| `?route=jour&date=YYYY-MM-DD` | GET | Saint + dictons + fête du jour |
| `?route=saints` | GET | Liste complète des saints |
| `?route=saints` | POST | Créer/mettre à jour un saint |
| `?route=saints/bulk` | POST | Import en masse (seed initial) |
| `?route=dictons` | GET | Liste complète des dictons |
| `?route=dictons` | POST | Ajouter un dicton |
| `?route=dictons/toggle` | POST | Activer/désactiver un dicton (`{id}`) |
| `?route=dictons/bulk` | POST | Import en masse, idempotent (seed) |
| `?route=dictons/dedupe` | POST | Supprime les doublons de dictons |
| `?route=fetes/bulk` | POST | Import des fêtes du jour (table `fetes_jour`, créée automatiquement) |
| `?route=villes/recherche&q=` | GET | Recherche de commune |
| `?route=extremes/france` | GET | Températures extrêmes du jour |
| `?route=extremes/france` | POST | Enregistrer des mesures (`{mesures: [...]}`) |
| `?route=vigilance/france` | GET | Bulletin de vigilance archivé du jour (carte + texte) |
| `?route=vigilance/france` | POST | Enregistrer un bulletin (`{carte: [...], texte}`) |
| `?route=vigilance/national` | POST | Enregistrer l'historique national (`{jours: [...]}`, backfill 2001+) |
| `?route=vigilance/departement-historique` | POST | Enregistrer l'historique par département (`{jours: [...]}`, backfill 2001+, source vigiscript.fr) |
| `?route=sync-logs&limite=` | GET | Derniers logs de tâches |
| `?route=sync-logs` | POST | Ajouter un log |
| `?route=pages-jour` | POST | Traçabilité génération du jour |

## Plugin WordPress

Fichier : `wordpress-plugin/temperatures-extremes-france.php`. À installer sur un autre site WordPress, avec en option dans `wp-config.php` :

```php
define( 'TEF_API_URL', 'https://dicton-du-jour.alertes-meteo.com/api/v1/extremes/france' );
```

Puis utiliser `[temperatures_extremes_france limite="3"]` dans une page ou un article (`limite` = nombre de stations affichées pour les maxima **et** pour les minima, 3 par défaut). Installation : compresser le fichier `.php` en `.zip` puis Extensions → Ajouter → Téléverser. Les données sont mises en cache 15 minutes par le plugin.

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

**Fêtes du jour** : `prisma/seed-data-fetes.json` (366 jours) généré depuis les pages jour de Nominis, importé par `npm run seed:fetes`.

**Autres sources** : événements historiques — Wikipédia (CC BY-SA 4.0) ; vacances scolaires — data.education.gouv.fr (Licence Ouverte) ; astronomie et fêtes populaires — calculs internes (Meeus), aucune donnée externe.

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

## Déploiement (VPS Ubuntu)

Le site tourne sur un VPS OVH : Node.js + **PM2** (processus `dicton-du-jour`, port 3000) derrière **nginx** avec TLS (certbot / Let's Encrypt) sur `dicton-du-jour.alertes-meteo.com`. Le fuseau du VPS est UTC : toutes les dates affichées utilisent explicitement `Europe/Paris`.

Mise à jour après un `git push` (dans le dossier du projet sur le VPS) :

```bash
git pull
npm run build
pm2 restart dicton-du-jour
```

Le fichier `.env` n'est pas dans Git et doit exister sur le VPS : `OVH_API_URL`, `OVH_API_TOKEN`, `ADMIN_SLUG`, `NEXT_PUBLIC_SITE_URL`, `METEOFRANCE_API_KEY`. Si `ovh-api/index.php` change, le renvoyer aussi sur l'hébergement OVH (FTP).

La version affichée dans le pied de page vient de `package.json` (`version`) ; la date est celle du dernier `npm run build`.
