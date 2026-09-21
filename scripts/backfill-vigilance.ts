import 'dotenv/config';
import { ovhApi } from '../lib/db/ovh-api-client';
import { parseCarteVigilance, parsePhenomenesCarte } from '../lib/meteo/vigilance';

/**
 * Import ponctuel (à lancer manuellement, pas planifié) de l'historique des bulletins de vigilance
 * Météo-France archivés sur data.gouv.fr, en complément de l'archivage temps réel (cron-vigilance-meteo.ts).
 *
 * Source : https://files.data.gouv.fr/meteofrance/data/vigilance/metropole/AAAA/MM/JJ/HHMMSS/
 * Un dossier par bulletin publié (plusieurs par jour : ~6h, 16h, réévaluations en cours d'événement),
 * contenant CDP_CARTE_EXTERNE.json — même format que l'API temps réel (DPVigilance /cartevigilance/encours).
 * Pas de texte de synthèse dans cette archive (seulement un PDF de carte, non exploité ici).
 *
 * Usage :
 *   npm run backfill:vigilance -- --depuis=2022-01-01 --jusqu-a=2022-12-31
 * Par défaut : depuis=2022-01-01 (première année disponible sur l'archive), jusqu'à=aujourd'hui (Paris).
 * Rejouable sans risque (écritures idempotentes, ON DUPLICATE KEY UPDATE côté ovh-api/).
 */

const BASE = 'https://files.data.gouv.fr/meteofrance/data/vigilance/metropole';
const PAUSE_ENTRE_APPELS_MS = 300;
const PAUSE_ENTRE_JOURS_MS = 500;

function argument(nom: string, defaut: string): string {
  const prefixe = `--${nom}=`;
  const trouve = process.argv.find((a) => a.startsWith(prefixe));
  return trouve ? trouve.slice(prefixe.length) : defaut;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET texte brut ; renvoie null sur 404 (dossier/fichier absent, cas normal pour un jour sans archive). */
async function get(url: string): Promise<string | null> {
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`);
  return r.text();
}

/**
 * Extrait les sous-entrées purement numériques d'une page d'index (répertoire) : fonctionne aussi bien
 * pour lister les dossiers AAAA/MM/JJ que les bulletins HHMMSS d'une journée, le format exact de la page
 * (listing Apache/nginx classique ou JSON) n'étant pas garanti.
 */
function sousDossiers(page: string): string[] {
  const essaiJson = essayerJson(page);
  if (essaiJson) return essaiJson;

  const trouves = new Set<string>();
  for (const m of page.matchAll(/href="([^"?#]+)"/g)) {
    // Les liens sont des chemins absolus se terminant par « / » (ex: .../2022/11/28/050019/) :
    // retirer le slash final avant d'extraire le dernier segment, sinon il ne reste rien.
    const nom = m[1].replace(/\/$/, '').replace(/^.*\//, '');
    if (/^\d{2,6}$/.test(nom)) trouves.add(nom);
  }
  return [...trouves].sort();
}

function essayerJson(page: string): string[] | null {
  try {
    const donnees = JSON.parse(page);
    const liste = Array.isArray(donnees) ? donnees : (donnees.files ?? donnees.entries ?? null);
    if (!Array.isArray(liste)) return null;
    return liste
      .map((e) => (typeof e === 'string' ? e : (e.name ?? e.filename ?? '')))
      .map((n) => String(n).replace(/\/$/, ''))
      .filter((n) => /^\d{2,6}$/.test(n))
      .sort();
  } catch {
    return null;
  }
}

function* joursEntre(depuis: string, jusquA: string): Generator<string> {
  const d = new Date(`${depuis}T00:00:00Z`);
  const fin = new Date(`${jusquA}T00:00:00Z`);
  for (; d <= fin; d.setUTCDate(d.getUTCDate() + 1)) {
    yield d.toISOString().slice(0, 10);
  }
}

/** Couleur maximale du jour (échéance J) par département, cumulée sur les bulletins de la journée. */
type MaxJour = Map<string, number>;
/** Couleur maximale du jour (échéance J) par « département|phénomène ». */
type MaxPhenomenes = Map<string, number>;

async function traiterBulletin(date: string, hhmmss: string, maxJour: MaxJour, maxPhen: MaxPhenomenes): Promise<'ok' | 'ignore'> {
  const url = `${BASE}/${date.replace(/-/g, '/')}/${hhmmss}/CDP_CARTE_EXTERNE.json`;
  const brut = await get(url);
  if (!brut) return 'ignore';

  const carte = parseCarteVigilance(brut);
  const heure = `${hhmmss.slice(0, 2)}:${hhmmss.slice(2, 4)}:${hhmmss.slice(4, 6)}`;
  await ovhApi.vigilanceEnregistrer(date, heure, carte, null);
  for (const p of parsePhenomenesCarte(brut)) {
    if (p.echeance !== 'J') continue;
    const cle = `${p.departement}|${p.phenomene}`;
    maxPhen.set(cle, Math.max(maxPhen.get(cle) ?? 0, p.couleur));
  }
  for (const c of carte) if (c.echeance === 'J') maxJour.set(c.departement, Math.max(maxJour.get(c.departement) ?? 0, c.couleur));
  return 'ok';
}

async function main() {
  const aujourdhui = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const depuis = argument('depuis', '2022-01-01');
  const jusquA = argument('jusqu-a', aujourdhui);

  console.log(`Backfill vigilance du ${depuis} au ${jusquA}…`);
  let joursTraites = 0;
  let bulletinsImportes = 0;
  let joursIgnores = 0;
  let echecs = 0;

  for (const date of joursEntre(depuis, jusquA)) {
    const [annee, mois, jour] = date.split('-');
    try {
      const pageJour = await get(`${BASE}/${annee}/${mois}/${jour}/`);
      if (!pageJour) {
        joursIgnores++;
        continue;
      }
      const bulletins = sousDossiers(pageJour);
      if (bulletins.length === 0) {
        console.warn(`${date} : page trouvée mais aucun bulletin détecté (format de listing inattendu ?)`);
      }
      const maxJour: MaxJour = new Map();
      const maxPhen: MaxPhenomenes = new Map();
      for (const hhmmss of bulletins) {
        try {
          const resultat = await traiterBulletin(date, hhmmss, maxJour, maxPhen);
          if (resultat === 'ok') bulletinsImportes++;
        } catch (e) {
          echecs++;
          console.error(`${date} ${hhmmss} en échec :`, e instanceof Error ? e.message : e);
        }
        await pause(PAUSE_ENTRE_APPELS_MS);
      }
      if (maxJour.size > 0) {
        // Alimente les calendriers du site (national et par département) : couleur max du jour.
        const national = Math.max(...maxJour.values());
        await ovhApi.vigilanceNationalEnregistrer([{ date, couleur: national as 1 | 2 | 3 | 4, commentaire: null }]);
        await ovhApi.vigilanceDepartementHistoriqueEnregistrer(
          [...maxJour].map(([departement, couleur]) => ({ date, departement, couleur: couleur as 1 | 2 | 3 | 4 })),
        );
      }
      // Phénomènes en jaune ou plus (le vert n'est pas stocké) : alimente le filtre « phénomène » de la recherche.
      const phenomenes = [...maxPhen]
        .filter(([, couleur]) => couleur >= 2)
        .map(([cle, couleur]) => {
          const [departement, phenomene] = cle.split('|');
          return { date, departement, phenomene: Number(phenomene), couleur: couleur as 2 | 3 | 4 };
        });
      if (phenomenes.length > 0) await ovhApi.vigilancePhenomenesJourEnregistrer(phenomenes);
      joursTraites++;
      if (joursTraites % 30 === 0) console.log(`… ${date} (${joursTraites} jours traités, ${bulletinsImportes} bulletins importés)`);
    } catch (e) {
      echecs++;
      console.error(`${date} en échec :`, e instanceof Error ? e.message : e);
    }
    await pause(PAUSE_ENTRE_JOURS_MS);
  }

  const resume = `${joursTraites} jours traités, ${bulletinsImportes} bulletins importés, ${joursIgnores} jours sans archive, ${echecs} échecs`;
  console.log(`Terminé — ${resume}`);
  await ovhApi.syncLogEnregistrer('meteo_vigilance_backfill', echecs > 0 ? 'partiel' : 'ok', resume).catch(() => {});
}

main();
