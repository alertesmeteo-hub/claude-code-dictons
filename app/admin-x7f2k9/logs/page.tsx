export const dynamic = 'force-dynamic';

import { prisma } from '@/lib/db/prisma';

export default async function JournalTaches() {
  const logs = await prisma.syncLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });

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
              <td>{log.createdAt.toLocaleString('fr-FR')}</td>
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
