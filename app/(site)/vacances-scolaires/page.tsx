import type { Metadata } from 'next';
import { chargerVacances, type Vacances, type Zone } from '@/lib/vacances/education';
import { dateAujourdhuiParis } from '@/lib/calculs/date-paris';
import Partage from '@/components/Partage';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Vacances scolaires — dates officielles zones A, B et C',
  description: "Dates des vacances scolaires en France (zones A, B et C) : prochaines vacances, jours restants, calendrier de l'année scolaire.",
};

const ZONES: Zone[] = ['Zone A', 'Zone B', 'Zone C'];

const ACADEMIES: Record<Zone, string> = {
  'Zone A': 'Besançon, Bordeaux, Clermont-Ferrand, Dijon, Grenoble, Limoges, Lyon, Poitiers',
  'Zone B': 'Aix-Marseille, Amiens, Lille, Nancy-Metz, Nantes, Nice, Normandie, Orléans-Tours, Reims, Rennes, Strasbourg',
  'Zone C': 'Créteil, Montpellier, Paris, Toulouse, Versailles',
};

const date = (iso: string, long = true) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', {
    weekday: long ? 'long' : undefined,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

const jours = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86400000);

export default async function PageVacances() {
  const aujourdhui = dateAujourdhuiParis();
  let vacances: Vacances[] = [];
  let erreur = false;
  try {
    vacances = await chargerVacances(aujourdhui);
  } catch {
    erreur = true;
  }

  // Groupe : une ligne par vacances (nom + année de début), avec une colonne par zone.
  const groupes = new Map<string, { nom: string; par: Partial<Record<Zone, Vacances>>; tri: string }>();
  for (const v of vacances) {
    if (v.reprise < aujourdhui) continue;
    const cle = `${v.nom}|${v.debut.slice(0, 4)}`;
    const g = groupes.get(cle) ?? { nom: v.nom, par: {}, tri: v.debut };
    g.par[v.zone] = v;
    if (v.debut < g.tri) g.tri = v.debut;
    groupes.set(cle, g);
  }
  const lignes = [...groupes.values()].sort((a, b) => a.tri.localeCompare(b.tri));

  return (
    <main className="page-jour calendrier">
      <h1>Vacances scolaires</h1>
      <p className="meta-jour">Calendrier officiel du ministère de l&apos;Éducation nationale, mis à jour chaque jour.</p>

      {erreur ? (
        <section>
          <p>Les dates des vacances sont momentanément indisponibles. Réessayez plus tard.</p>
        </section>
      ) : (
        <>
          <section aria-labelledby="prochaines">
            <h2 id="prochaines">Prochaines vacances par zone</h2>
            <ul>
              {ZONES.map((z) => {
                const v = vacances.find((x) => x.zone === z && x.reprise > aujourdhui);
                if (!v) return <li key={z}><strong>{z}</strong> : dates non publiées.</li>;
                const enCours = v.debut <= aujourdhui;
                return (
                  <li key={z}>
                    <strong>{z}</strong> — {v.nom}{' '}
                    {enCours
                      ? `en cours, reprise des cours le ${date(v.reprise)} (dans ${jours(aujourdhui, v.reprise)} jours)`
                      : `dans ${jours(aujourdhui, v.debut)} jours, à partir du ${date(v.debut)}`}
                    .
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="calendrier-scolaire">
            <h2 id="calendrier-scolaire">Dates des vacances à venir</h2>
            <table>
              <thead>
                <tr>
                  <th>Vacances</th>
                  {ZONES.map((z) => (
                    <th key={z}>{z}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => (
                  <tr key={l.nom + l.tri}>
                    <th scope="row">{l.nom}</th>
                    {ZONES.map((z) => {
                      const v = l.par[z];
                      return (
                        <td key={z}>
                          {v ? (
                            <>
                              Du {date(v.debut, false)}
                              <br />
                              au {date(v.reprise, false)} <span className="meta-jour">(reprise)</span>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="meta-jour">
              « Du » indique le premier jour sans cours (le samedi) ; « reprise » indique le jour de retour en classe.
            </p>
          </section>

          <section aria-labelledby="zones-academies">
            <h2 id="zones-academies">Quelle est ma zone ?</h2>
            <ul>
              {ZONES.map((z) => (
                <li key={z}>
                  <strong>{z}</strong> : académies de {ACADEMIES[z]}.
                </li>
              ))}
            </ul>
            <p className="meta-jour">Corse et outre-mer ont leur propre calendrier, non détaillé ici.</p>
          </section>

          <section>
            <p className="meta-jour">
              Source :{' '}
              <a href="https://data.education.gouv.fr/explore/dataset/fr-en-calendrier-scolaire/" rel="noopener">
                data.education.gouv.fr
              </a>
              , Licence Ouverte. Les ponts (par exemple celui de l&apos;Ascension) ne sont pas listés.
            </p>
          </section>
        </>
      )}

      <Partage titre="Vacances scolaires — zones A, B et C" />
    </main>
  );
}
