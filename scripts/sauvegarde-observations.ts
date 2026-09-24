import 'dotenv/config';
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ovhApi } from '../lib/db/ovh-api-client';

/**
 * Copie de sauvegarde de l'archive horaire du VPS (jours/<AAAA-MM-JJ>/<département>.json) dans la base OVH
 * (table obs_horaire_jour : un bloc compressé par jour et par département). Seuls les jours UTC terminés sont copiés ;
 * un fichier marqueur évite de renvoyer ce qui l'est déjà. Écrit via l'API OVH : la base n'est joignable que depuis le réseau OVH.
 */

const ARCHIVE = process.env.OBSERVATIONS_DIR || '/var/www/observations';
const MARQUEUR = path.join(ARCHIVE, '.sauvegarde-ovh.json');
const PAR_ENVOI = 12; // départements par requête (~1 Mo de JSON)

async function main() {
  const fait: Record<string, boolean> = existsSync(MARQUEUR) ? JSON.parse(readFileSync(MARQUEUR, 'utf8')) : {};
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const racine = path.join(ARCHIVE, 'jours');
  const jours = readdirSync(racine).filter((j) => /^\d{4}-\d{2}-\d{2}$/.test(j) && j < aujourdhui && !fait[j]).sort();
  if (!jours.length) { console.log('Sauvegarde OVH : rien de nouveau'); return; }

  for (const jour of jours) {
    const fichiers = readdirSync(path.join(racine, jour)).filter((f) => /^\w{2,3}\.json$/.test(f) && f !== 'quotidien.json');
    const lots = [];
    for (const f of fichiers) {
      const contenu = readFileSync(path.join(racine, jour, f), 'utf8');
      lots.push({ date: jour, departement: f.replace('.json', ''), nb_stations: Object.keys(JSON.parse(contenu)).length, contenu });
    }
    let envoyes = 0;
    for (let i = 0; i < lots.length; i += PAR_ENVOI) {
      const r = await ovhApi.observationsHoraireEnregistrer(lots.slice(i, i + PAR_ENVOI));
      envoyes += r.compte;
    }
    if (envoyes !== lots.length) throw new Error(`${jour} : ${envoyes}/${lots.length} départements enregistrés`);
    fait[jour] = true;
    const tmp = `${MARQUEUR}.tmp`;
    writeFileSync(tmp, JSON.stringify(fait));
    renameSync(tmp, MARQUEUR);
    console.log(`Sauvegarde OVH : ${jour} (${envoyes} départements)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
