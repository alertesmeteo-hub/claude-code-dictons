<?php
// Copie ce fichier en "config.php" sur l'hébergement OVH (JAMAIS commité sur GitHub — config.php est dans .gitignore).
// Ce fichier contient des secrets, il doit rester uniquement sur le serveur OVH.

// Mêmes constantes que celles déjà utilisées par le plugin WordPress am-dictionnaire-meteo,
// définies normalement dans wp-config.php — ici on les redéfinit pour que cette API
// fonctionne indépendamment de WordPress (fichier séparé, même base).
define('DICTMETEO_DB_HOST', 'bijouxdealertes.mysql.db');
define('DICTMETEO_DB_NAME', 'bijouxdealertes');
define('DICTMETEO_DB_USER', 'bijouxdealertes');
define('DICTMETEO_DB_PASSWORD', 'À_REMPLACER');

// Jeton secret que le site Next.js doit fournir dans l'en-tête Authorization: Bearer <jeton>
// Génère une longue chaîne aléatoire (ex: openssl rand -hex 32) — jamais la même que le mot de passe DB.
define('DICTON_API_TOKEN', 'À_REMPLACER_PAR_UN_JETON_ALEATOIRE_LONG');
