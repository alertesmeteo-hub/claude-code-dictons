import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { joursFeriesAnnee } from '@/lib/calculs/jours-feries';

interface Params {
  year: string;
}

function anneeValide(year: string): number | null {
  if (!/^\d{4}$/.test(year)) return null;
  const n = Number(year);
  return n >= 2000 && n <= 2100 ? n : null;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const annee = anneeValide((await params).year);
  if (!annee) return {};
  return {
    title: `Jours fériés ${annee} en France — dates et calendrier`,
    description: `Tous les jours fériés ${annee} en France métropolitaine : dates, jours de la semaine et fêtes mobiles (Pâques, Ascension, Pentecôte).`,
    alternates: { canonical: `${process.env.NEXT_PUBLIC_SITE_URL}/jours-feries/${annee}/` },
  };
}

export default async function JoursFeries({ params }: { params: Promise<Params> }) {
  const annee = anneeValide((await params).year);
  if (!annee) notFound();

  const jours = joursFeriesAnnee(annee).sort((a, b) => a.date.getTime() - b.date.getTime());

  return (
    <main className="page-jour">
      <h1>Jours fériés {annee} en France</h1>
      <section aria-labelledby="liste-feries">
        <h2 id="liste-feries">Les {jours.length} jours fériés de {annee}</h2>
        <ul>
          {jours.map((j) => (
            <li key={j.nom}>
              <strong>
                {j.date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
              </strong>{' '}
              — {j.nom}
            </li>
          ))}
        </ul>
        <p className="meta-jour">
          France métropolitaine, hors jours spécifiques à l&apos;Alsace-Moselle (Vendredi saint, 26 décembre). Dates
          de Pâques, Ascension et Pentecôte calculées.
        </p>
      </section>
      <nav className="navigation-jour" aria-label="Changer d'année">
        <p className="navigation-jour-fil">
          « <Link href={`/jours-feries/${annee - 1}/`}>{annee - 1}</Link> | {annee} |{' '}
          <Link href={`/jours-feries/${annee + 1}/`}>{annee + 1}</Link> »
        </p>
      </nav>
    </main>
  );
}
