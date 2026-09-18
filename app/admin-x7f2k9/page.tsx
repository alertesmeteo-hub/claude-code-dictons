export const dynamic = 'force-dynamic';

import { ovhApi } from '@/lib/db/ovh-api-client';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';

async function republierJour(formData: FormData) {
  'use server';
  const dateStr = String(formData.get('date'));
  const [y, m, d] = dateStr.split('-');
  revalidatePath(`/${y}/${m}/${d}`);
}

export default async function TableauDeBordAdmin() {
  const [derniersLogs, saints, dictons, extremes] = await Promise.all([
    ovhApi.syncLogsListe(5),
    ovhApi.saintsListe(),
    ovhApi.dictonsListe(),
    ovhApi.extremesFrance().catch(() => ({ date: '', donnees: [] })),
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
          <li>{saints.length} saints enregistrés</li>
          <li>{dictons.length} dictons enregistrés</li>
          <li>{extremes.donnees.length} mesures de températures extrêmes aujourd&apos;hui</li>
        </ul>
      </section>

      {dernierEchecMeteo && (
        <section className="admin-alerte">
          <h2>⚠️ Erreur récente</h2>
          <p>
            La dernière synchronisation des températures extrêmes a échoué le{' '}
            {new Date(dernierEchecMeteo.created_at).toLocaleString('fr-FR')} : {dernierEchecMeteo.message}
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
                <td>{new Date(log.created_at).toLocaleString('fr-FR')}</td>
                <td>{log.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
