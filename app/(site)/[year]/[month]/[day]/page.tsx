import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { construireContenuJour } from '@/lib/calculs/page-jour';
import { evenementsHistoriques } from '@/lib/evenements/wikipedia';
import MeteoSoleil from '@/components/MeteoSoleil';
import NavigationJour from '@/components/NavigationJour';

interface Params {
  year: string;
  month: string;
  day: string;
}

function parserDate({ year, month, day }: Params): Date | null {
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) return null;
  const date = new Date(`${year}-${month}-${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  // Rejette les dates "normalisées" par le constructeur (ex: 2026-02-30 → 2026-03-02)
  if (date.getFullYear() !== Number(year) || date.getMonth() + 1 !== Number(month) || date.getDate() !== Number(day)) {
    return null;
  }
  return date;
}

const MOIS_LONGS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

function formaterInstantParis(iso: string): string {
  const d = new Date(iso);
  const jour = d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const heure = d.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
  return `${jour} à ${heure}`;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const p = await params;
  const date = parserDate(p);
  if (!date) return {};

  const titre = `Dictons et proverbes du jour — ${date.getDate()} ${MOIS_LONGS[date.getMonth()]} ${date.getFullYear()}`;
  const url = `${process.env.NEXT_PUBLIC_SITE_URL}/${p.year}/${p.month}/${p.day}/`;

  return {
    title: titre,
    description: `Dictons, proverbes, saint du jour, météo et éphéméride pour le ${date.getDate()} ${MOIS_LONGS[date.getMonth()]} ${date.getFullYear()}.`,
    alternates: { canonical: url },
    openGraph: { title: titre, url, type: 'article' },
  };
}

export default async function PageJour({ params }: { params: Promise<Params> }) {
  const p = await params;
  const date = parserDate(p);
  if (!date) notFound();

  const [contenu, evenements] = await Promise.all([
    construireContenuJour(date),
    evenementsHistoriques(date.getMonth() + 1, date.getDate()),
  ]);

  const dateVeille = new Date(date);
  dateVeille.setDate(dateVeille.getDate() - 1);
  const dateLendemain = new Date(date);
  dateLendemain.setDate(dateLendemain.getDate() + 1);

  return (
    <main className="page-jour">
      <NavigationJour
        date={date}
        dateVeille={dateVeille}
        dateLendemain={dateLendemain}
        numeroJourAnnee={contenu.infosJourAnnee.numeroJourAnnee}
      />

      <header id="date-du-jour">
        <h1>
          Dictons et proverbes du jour — {date.getDate()} {MOIS_LONGS[date.getMonth()]} {date.getFullYear()}
        </h1>
        <p className="meta-jour">
          Jour {contenu.infosJourAnnee.numeroJourAnnee}/{contenu.infosJourAnnee.bissextile ? 366 : 365} ·{' '}
          {contenu.infosJourAnnee.joursRestants} jours restants · Semaine {contenu.infosJourAnnee.semaineISO}
        </p>
      </header>

      {contenu.saint && (
        <section aria-labelledby="saint-du-jour">
          <h2 id="saint-du-jour">Saint du jour : {contenu.saint.nomPrincipal}</h2>
          {contenu.saint.presentationHistorique && <p>{contenu.saint.presentationHistorique}</p>}
          {contenu.saint.traditions && <p>{contenu.saint.traditions}</p>}
        </section>
      )}

      {(contenu.fete || contenu.saint?.autresPrenoms) && (
        <section aria-labelledby="fete-du-jour" id="fete-du-jour">
          <h2 id="titre-fete-du-jour">
            Fête du jour : {date.getDate()} {MOIS_LONGS[date.getMonth()]}
          </h2>
          {contenu.fete && contenu.fete.prenoms.length > 0 ? (
            <p>
              <strong>Également en fête le {date.getDate()} {MOIS_LONGS[date.getMonth()]} :</strong>{' '}
              {contenu.fete.prenoms.join(', ')}.
            </p>
          ) : (
            contenu.saint?.autresPrenoms && (
              <p>
                <strong>Également en fête :</strong> {contenu.saint.autresPrenoms}
              </p>
            )
          )}
          {contenu.fete && contenu.fete.autresFetes.length > 0 && (
            <>
              <h3>Autres fêtes du jour</h3>
              <ul>
                {contenu.fete.autresFetes.slice(0, 8).map((f) => (
                  <li key={f.url}>
                    <a href={f.url} rel="noopener">{f.nom}</a>
                    {f.description ? ` — ${f.description}` : ''}
                  </li>
                ))}
              </ul>
              {contenu.fete.autresFetes.length > 8 && (
                <p className="meta-jour">et {contenu.fete.autresFetes.length - 8} autres saints ou bienheureux du jour.</p>
              )}
            </>
          )}
          {contenu.fete && (
            <p className="meta-jour">
              Source : <a href="https://nominis.cef.fr" rel="noopener">Nominis</a>, Conférence des évêques de France.
            </p>
          )}
        </section>
      )}

      <section aria-labelledby="dictons">
        <h2 id="dictons">Dictons, proverbes et adages du jour</h2>
        <ul>
          {contenu.dictons.map((d, i) => (
            <li key={i}>
              {d.texte} <span className="type-dicton">({d.type.replace('_', ' ')})</span>
            </li>
          ))}
        </ul>
      </section>

      <MeteoSoleil date={contenu.date} />

      <section aria-labelledby="cycle-lunaire">
        <h2 id="cycle-lunaire">Cycle lunaire du jour</h2>
        <p>
          En ce {date.getDate()} {MOIS_LONGS[date.getMonth()]}, la Lune est en phase : <strong>{contenu.cycleLunaire.phase}</strong>.
        </p>
        <p>
          Prochaine phase lunaire : {contenu.cycleLunaire.prochaine.libelle}, prévue le{' '}
          {formaterInstantParis(contenu.cycleLunaire.prochaine.instant)}.
        </p>
        <ul>
          <li>Prochaine pleine lune : {formaterInstantParis(contenu.cycleLunaire.prochainePleineLune)}</li>
          <li>Prochaine nouvelle lune : {formaterInstantParis(contenu.cycleLunaire.prochaineNouvelleLune)}</li>
        </ul>
      </section>

      {evenements.length > 0 && (
        <section aria-labelledby="evenements-historiques">
          <h2 id="evenements-historiques">Événements historiques du jour</h2>
          <p>
            Que s&apos;est-il passé un {date.getDate()} {MOIS_LONGS[date.getMonth()]} ?
          </p>
          <ul>
            {evenements.map((e, i) => (
              <li key={i}>
                <strong>{e.annee}</strong> — {e.url ? <a href={e.url} rel="noopener">{e.texte}</a> : e.texte}
              </li>
            ))}
          </ul>
          <p className="meta-jour">
            Source :{' '}
            <a href="https://fr.wikipedia.org/wiki/Wikip%C3%A9dia:Accueil_principal" rel="noopener">Wikipédia</a>, texte sous
            licence{' '}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.fr" rel="noopener">CC BY-SA 4.0</a>.
          </p>
        </section>
      )}

      <section aria-labelledby="infos-complementaires">
        <h2 id="infos-complementaires">Informations complémentaires</h2>
        <p>
          Signe du zodiaque : {contenu.zodiaque.symbole} {contenu.zodiaque.nom} · Astrologie chinoise :{' '}
          {contenu.astrologieChinoise}
        </p>
        <p>Calendrier républicain : {contenu.calendrierRepublicain.libelle}</p>
        <p>
          Prochain jour férié en France : <strong>{contenu.prochainJourFerie.nom}</strong> le{' '}
          {new Date(`${contenu.prochainJourFerie.date}T12:00:00`).toLocaleDateString('fr-FR', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}{' '}
          {contenu.prochainJourFerie.joursRestants === 0
            ? "(aujourd'hui)"
            : `(dans ${contenu.prochainJourFerie.joursRestants} jour${contenu.prochainJourFerie.joursRestants > 1 ? 's' : ''})`}
        </p>
      </section>
    </main>
  );
}
