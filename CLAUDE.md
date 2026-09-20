@AGENTS.md

## Nouvelles tables MySQL (`ovh-api/`)

Toujours créer les tables automatiquement au premier appel API (fonction `assurerTable...($db)` appelée en tête des routes concernées dans `ovh-api/index.php`, sur le modèle de `assurerTableFetes`/`assurerTablesVigilance`), plutôt que de demander à l'utilisateur de coller du SQL dans phpMyAdmin. L'utilisateur n'a pas d'accès direct à la base autrement que via cette API, et l'exécution manuelle de SQL est source d'erreurs. Ajouter quand même la définition dans `ovh-api/schema.sql` pour la doc/référence, mais ne jamais en faire une étape obligatoire du déploiement.
