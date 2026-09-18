export const dynamic = 'force-dynamic';

import { prisma } from '@/lib/db/prisma';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';

async function republierJour(formData: FormData) {
  'use server';
  const dateStr = String(formData.get('date'));
  const [y, m, d] = dateStr.split('-');
  revalidatePath(`/${y}/${m}/${d}`);
}

export default async function TableauDeBordAdmin() {
  const [derniersLogs, nbSaints, nbDictons, nbTemperatures] = await Promise.all([
    prisma.syncLog.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.saint.count(),
    prisma.dicton.count(),
    prisma.temperatureExtremeJour.count(),
  ]);

  const aujourdHui = new Date();
  const dateAujourdHui = aujourdHui.toISOString().slice(0, 10);
  const [y, m, d] = dateAujourdHui.split('-');

  const dernierEchecMeteo = derniersLogs.find((l) => l.tache === 'meteo_extremes' && l.statut === 'erreur');

  return (
    <main>
      <h1>Administration — Tableau de bord</h1>

      <section>
        <h2>Contenu</h2>
        <ul>
          <li>{nbSaints} saints enregistrés</li>
          <li>{nbDictons} dictons enregistrés</li>
          <li>{nbTemperatures} mesures de températures extrêmes enregistrées</li>
        </ul>
      </section>

      {dernierEchecMeteo && (
        <section className="admin-alerte">
          <h2>⚠️ Erreur récente</h2>
          <p>
            La dernière synchronisation des températures extrêmes a échoué le{' '}
            {dernierEchecMeteo.createdAt.toLocaleString('fr-FR')} : {dernierEchecMeteo.message}
          </p>
          <Link href="/admin-x7f2k9/logs">Voir le journal complet</Link>
        </section>
      )}

      <section>
        <h2>Aperçu / republication</h2>
        <p>
          Page du jour : <Link href={`/${y}/${m}/${d}/`} target="_blank">voir en public</Link>
        </p>
        <form action={republierJour}>
          <input type="hidden" name="date" value={dateAujourdHui} />
          <button type="submit">Forcer la republication du jour</button>
        </form>
      </section>

      <section>
        <h2>Dernières tâches automatiques</h2>
        <table>
          <thead>
            <tr>
              <th>Tâche</th>
              <th>Statut</th>
              <th>Date</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {derniersLogs.map((log) => (
              <tr key={log.id}>
                <td>{log.tache}</td>
                <td>{log.statut}</td>
                <td>{log.createdAt.toLocaleString('fr-FR')}</td>
                <td>{log.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
