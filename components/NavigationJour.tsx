import Link from 'next/link';

const MOIS_LONGS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

function chemin(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `/${y}/${m}/${d}/`;
}

function libelleJourMois(date: Date): string {
  return `${date.getDate()} ${MOIS_LONGS[date.getMonth()]}`;
}

function ordinal(n: number): string {
  return n === 1 ? '1er' : `${n}ème`;
}

export default function NavigationJour({
  date,
  dateVeille,
  dateLendemain,
  numeroJourAnnee,
}: {
  date: Date;
  dateVeille: Date;
  dateLendemain: Date;
  numeroJourAnnee: number;
}) {
  return (
    <nav className="navigation-jour" aria-label="Navigation entre les jours">
      <p className="navigation-jour-date">
        Nous sommes le {date.getDate()} {MOIS_LONGS[date.getMonth()]} {date.getFullYear()}
      </p>
      <p className="navigation-jour-fil">
        «{' '}
        <Link href={chemin(dateVeille)}>{libelleJourMois(dateVeille)}</Link>
        {' | '}
        C&apos;est le {ordinal(numeroJourAnnee)} jour de l&apos;année
        {' | '}
        <Link href={chemin(dateLendemain)}>{libelleJourMois(dateLendemain)}</Link> »
      </p>
    </nav>
  );
}
