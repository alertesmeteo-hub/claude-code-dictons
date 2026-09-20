# Deploiement OVH (mutualise) - api.alertes-meteo.com

## 1. Prerequis a verifier dans le manager OVH
- PHP >= 8.1 avec `pdo_mysql`, `curl`, `mbstring` (choisir la version dans Hebergement > Configuration).
- Base MariaDB/MySQL creee (nom, utilisateur, mot de passe).
- Taches CRON autorisees et duree maximale d'un script (le collecteur d'extremes dure ~3 min).

## 2. DNS et HTTPS
1. Zone DNS d'`alertes-meteo.com` : ajouter `api` (A/AAAA vers l'hebergement, ou CNAME vers le cluster indique par OVH).
2. Hebergement > Multisite > ajouter le domaine `api.alertes-meteo.com`, dossier racine `api`, activer SSL (Let's Encrypt), activer le CDN uniquement si besoin.
3. Verifier : `curl -I http://api.alertes-meteo.com` redirige en 301 vers HTTPS.

## 3. Fichiers
Deposer le contenu du dossier `api/` dans le dossier racine `api` de l'hebergement (SFTP, ou Git sur l'hebergement).
Le `.htaccess` bloque `src/`, `tests/`, `schema.sql`, `.env*`. Meilleure option : placer `.env` **au-dessus** de la racine web si le multisite le permet, sinon garder le `.env` a la racine (bloque par `.htaccess`).

## 4. Configuration
Copier `.env.example` en `.env` et renseigner : `DB_DSN`, `DB_USER`, `DB_PASS`, `IP_SALT` (chaine aleatoire longue), `METEOFRANCE_API_KEY`, `VIGILANCE_SOURCE_URL`. Permissions : `chmod 600 .env`. Ne jamais versionner `.env`.

## 5. Base de donnees
Aucun SQL a coller : les tables sont creees automatiquement au premier appel (API ou cron) a partir de `schema.sql`, qui est idempotent (`CREATE TABLE IF NOT EXISTS`) et rejoue quand il change. L'utilisateur MariaDB doit avoir le droit `CREATE`. Limite : les `ALTER` sur des tables existantes ne sont pas automatiques ; les documenter avant tout changement de colonne.

## 6. Crons (Hebergement > Taches CRON)
| Frequence | Commande |
|---|---|
| `*/15 * * * *` | `php ~/api/cron/collect_vigilance.php` |
| `5 * * * *` | `php ~/api/cron/collect_extremes.php` |
| `*/30 * * * *` | `php ~/api/cron/collect_records.php` |
| `*/20 * * * *` | `php ~/api/cron/collect_rain.php` |
Adapter le chemin selon le dossier reel. Le premier passage manuel : lancer les deux commandes en SSH, puis verifier `SELECT * FROM collector_runs ORDER BY id DESC LIMIT 5;`.

## 7. Premiere cle
1. `curl -X POST https://api.alertes-meteo.com/v1/keys/requests -H "Content-Type: application/json" -d '{"name":"Test","email":"vous@exemple.fr","usage":"Test interne de l API avant ouverture.","consent":true}'`
2. En SSH : `php cron/admin.php list` puis `php cron/admin.php approve <id>` (la cle est envoyee par email ; verifier que `mail()` fonctionne, sinon elle s'affiche dans le terminal).

## 8. Tests de recette
```
curl https://api.alertes-meteo.com/v1/health
curl https://api.alertes-meteo.com/v1/status
curl -H "X-API-Key: <cle>" "https://api.alertes-meteo.com/v1/sun?lat=48.8566&lon=2.3522"
curl -H "X-API-Key: <cle>" "https://api.alertes-meteo.com/v1/vigilance?min_level=1&domain=30"
curl -H "X-API-Key: <cle>" "https://api.alertes-meteo.com/v1/extremes/france?altitude_max=500"
php -d zend.assertions=1 tests/sun_test.php
```
`/v1/status` doit repondre `ok` ; `degraded` signifie qu'une source est en retard.

## 9. Sauvegardes et supervision
- Activer les sauvegardes automatiques de la base dans le manager OVH, et exporter un dump manuel avant toute modification de schema.
- Surveiller `/v1/status` depuis un moniteur externe (UptimeRobot ou equivalent) avec alerte email.

## 10. Migration vers un VPS sans changer les URLs
1. Installer le meme code sur le VPS (nginx + PHP-FPM + MariaDB), importer un dump.
2. Tester via un sous-domaine temporaire.
3. Baisser le TTL DNS de `api` a 300 s, 24 h avant.
4. Basculer l'enregistrement A vers le VPS, reactiver les crons sur le VPS et les couper sur OVH.
5. Les URLs `/v1/...` restent identiques : rien a changer pour les utilisateurs.
