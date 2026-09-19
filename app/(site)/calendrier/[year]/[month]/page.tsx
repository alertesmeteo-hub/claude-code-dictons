import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ovhApi, type SaintApi } from '@/lib/db/ovh-api-client';
import {
  construireCalendrierMois,
  type JourCalendrier,
  JOURS_SEMAINE,
  MOIS,
  PHASES,
} from '@/lib/calculs/calendrier-mois';
import BoutonImprimer from '@/components/BoutonImprimer';
import Partage from '@/components/Partage';

export const dynamic = 'force-dynamic';

interface Params {
  year: string;
  month: string;
}

function parser({ year, month }: Params): { annee: number; mois: number } | null {
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month)) return null;
  const annee = Number(year);
  const mois = Number(month);
  if (mois < 1 || mois > 12 || annee < 1900 || annee > 2200) return null;
  return { annee, mois };
}

const chemin = (annee: number, mois: number) => {
  const d = new Date(Date.UTC(annee, mois - 1, 1));
  return `/calendrier/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/`;
};

const libelleMois = (annee: number, mois: number) => {
  const d = new Date(Date.UTC(annee, mois - 1, 1));
  return `${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const p = parser(await params);
  if (!p) return {};
  const titre = `Calendrier ${libelleMois(p.annee, p.mois)} — fêtes, saints, phases de la lune`;
  return {
    title: titre,
    description: `Calendrier de ${libelleMois(p.annee, p.mois)} à imprimer : jours fériés, saints du jour, fêtes populaires, phases de la Lune et numéros de semaine.`,
  };
}

const infobulle = (c: JourCalendrier, saint: SaintApi | undefined) =>
  [
    `${c.jour} ${MOIS[Number(c.cle.slice(5, 7)) - 1]}`,
    saint ? `Saint du jour : ${saint.nom_principal}` : null,
    c.ferie ? `Jour férié : ${c.ferie}` : null,
    ...c.populaires.map((f) => `${f.emoji} ${f.nom}`),
    ...c.phases.map((ph) => `${PHASES[ph.type].emoji} ${PHASES[ph.type].libelle} à ${ph.heure}`),
  ]
    .filter(Boolean)
    .join(' — ');

const nomCourt = (s: SaintApi | undefined) => (s ? s.nom_principal.replace(/^(saint|sainte|saints|bienheureux|bienheureuse)\s+/i, '') : '');

export default async function PageCalendrier({ params }: { params: Promise<Params> }) {
  const p = parser(await params);
  if (!p) notFound();

  const cal = construireCalendrierMois(p.annee, p.mois);
  const titreMois = libelleMois(p.annee, p.mois);

  let saints: SaintApi[] = [];
  try {
    saints = (await ovhApi.saintsListe()).filter((s) => Number(s.mois) === p.mois);
  } catch {
    // le calendrier reste affiché sans les prénoms si l'API est indisponible
  }
  const saintDuJour = (j: number) => saints.find((s) => Number(s.jour) === j);

  return (
    <main className="page-jour calendrier">
      <nav className="navigation-jour" aria-label="Navigation entre les mois">
        <h1 className="navigation-jour-date">Calendrier {titreMois}</h1>
        <p className="navigation-jour-fil">
          «{' '}
          <Link href={chemin(p.annee, p.mois - 1)}>{libelleMois(p.annee, p.mois - 1)}</Link>
          {' | '}
          <span className="navigation-jour-courant">{titreMois}</span>
          {' | '}
          <Link href={chemin(p.annee, p.mois + 1)}>{libelleMois(p.annee, p.mois + 1)}</Link> »
        </p>
      </nav>

      <section aria-labelledby="grille-calendrier" className="section-calendrier">
        <h2 id="grille-calendrier" className="sr-only">Calendrier du mois de {titreMois}</h2>
        <table className="grille-calendrier">
          <thead>
            <tr>
              <th scope="col">Sem.</th>
              {JOURS_SEMAINE.map((j) => (
                <th scope="col" key={j}>{j}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cal.semaines.map((s) => (
              <tr key={s.numero + '-' + s.cases.findIndex((c) => c)}>
                <th scope="row" className="numero-semaine">{s.numero}</th>
                {s.cases.map((c, i) =>
                  c ? (
                    <td key={c.cle} className={`${i >= 5 ? 'weekend' : ''} ${c.ferie ? 'ferie' : ''}`.trim()}>
                      <Link href={`/${c.cle.replaceAll('-', '/')}/`} className="case-jour" title={infobulle(c, saintDuJour(c.jour))}>
                        <span className="numero-jour">
                          {c.jour}
                          <span aria-hidden="true" className="icones-jour">
                            {c.phases.map((ph) => PHASES[ph.type].emoji).join('')}
                            {c.populaires.map((f) => f.emoji).join('')}
                          </span>
                        </span>
                        <span className="saint-jour">{nomCourt(saintDuJour(c.jour))}</span>
                        {c.ferie && <span className="ferie-jour">{c.ferie}</span>}
                      </Link>
                    </td>
                  ) : (
                    <td key={`vide-${i}`} className="vide" />
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="actions-calendrier">
          <BoutonImprimer />
        </div>
      </section>

      <section aria-labelledby="fetes-mois">
        <h2 id="fetes-mois">Fêtes et événements en {titreMois}</h2>
        {cal.evenements.length === 0 ? (
          <p>Aucun événement particulier ce mois-ci.</p>
        ) : (
          <ul>
            {cal.evenements.map((e, i) => (
              <li key={i}>
                <span aria-hidden="true">{e.emoji}</span> <strong>{e.jour} {MOIS[p.mois - 1]}</strong> — {e.libelle}
                {e.detail ? ` (${e.detail})` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="lune-mois">
        <h2 id="lune-mois">Phases de la lune en {titreMois}</h2>
        <ul>
          {cal.phasesLune.map((ph, i) => (
            <li key={i}>
              <span aria-hidden="true">{PHASES[ph.type].emoji}</span> <strong>{ph.jour} {MOIS[p.mois - 1]}</strong> — {PHASES[ph.type].libelle} à {ph.heure}
            </li>
          ))}
        </ul>
        <p className="meta-jour">Heures de Paris, calcul astronomique (Meeus), précision de quelques minutes.</p>
      </section>

      <section aria-labelledby="presentation-mois">
        <h2 id="presentation-mois">Le mois de {titreMois}</h2>
        <p>{cal.presentation}</p>
        <p>
          Le mois de {titreMois} compte {cal.nbJours} jours et{' '}
          {cal.feries.length === 0
            ? 'aucun jour férié'
            : `${cal.feries.length} jour${cal.feries.length > 1 ? 's' : ''} férié${cal.feries.length > 1 ? 's' : ''} (${cal.feries.map((f) => `${f.nom}, le ${f.jour}`).join(' ; ')})`}
          . On y dénombre {cal.joursOuvres} jours ouvrés du lundi au vendredi, jours fériés exclus. Les numéros de semaine affichés
          suivent la norme ISO 8601.
        </p>
        <p>
          Les saints du mois de {MOIS[p.mois - 1]} sont issus du calendrier catholique romain. Chaque jour est associé à un ou
          plusieurs prénoms, utilisés traditionnellement pour les fêtes de prénom en France. Cliquez sur un jour du calendrier
          pour consulter le saint du jour, ses dictons et la météo.
        </p>
      </section>

      <section aria-labelledby="imprimer" id="imprimer">
        <h2 id="imprimer-titre">Comment imprimer ce calendrier ?</h2>
        <ol>
          <li>Cliquez sur le bouton « Imprimer ce calendrier » (ou utilisez Ctrl+P, ou Cmd+P sur Mac).</li>
          <li>Choisissez l&apos;orientation « Paysage » pour une grille plus lisible.</li>
          <li>Réglez l&apos;échelle sur « Ajuster à la page » et activez « Graphiques d&apos;arrière-plan » pour conserver les couleurs.</li>
          <li>Lancez l&apos;impression, ou choisissez « Enregistrer au format PDF » pour obtenir un fichier.</li>
        </ol>
        <p className="meta-jour">Seul le calendrier est imprimé : le menu et les boutons de partage sont masqués.</p>
      </section>

      <Partage titre={`Calendrier ${titreMois}`} />
    </main>
  );
}
