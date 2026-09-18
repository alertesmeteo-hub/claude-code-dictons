export const dynamic = 'force-dynamic';

import { ovhApi } from '@/lib/db/ovh-api-client';

export default async function JournalTaches() {
  const logs = await ovhApi.syncLogsListe(100);

  return (
    <main>
      <h1>Journal des tâches automatiques</h1>
      <p>100 entrées les plus récentes (génération quotidienne, synchronisation météo).</p>

      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Tâche</th>
            <th>Statut</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className={`log-${log.statut}`}>
              <td>{new Date(log.created_at).toLocaleString('fr-FR')}</td>
              <td>{log.tache}</td>
              <td>{log.statut}</td>
              <td>{log.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
