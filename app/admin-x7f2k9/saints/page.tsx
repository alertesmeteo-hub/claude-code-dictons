export const dynamic = 'force-dynamic';

import { ovhApi } from '@/lib/db/ovh-api-client';
import { revalidatePath } from 'next/cache';

async function enregistrerSaint(formData: FormData) {
  'use server';

  const mois = Number(formData.get('mois'));
  const jour = Number(formData.get('jour'));
  const nomPrincipal = String(formData.get('nomPrincipal') ?? '').trim();
  const presentationHistorique = String(formData.get('presentationHistorique') ?? '').trim() || null;
  const autresPrenoms = String(formData.get('autresPrenoms') ?? '').trim() || null;
  const patronage = String(formData.get('patronage') ?? '').trim() || null;
  const traditions = String(formData.get('traditions') ?? '').trim() || null;
  const source = String(formData.get('source') ?? '').trim();
  const verifie = formData.get('verifie') === 'on';

  if (!nomPrincipal || !source || !mois || !jour) return;

  await ovhApi.saintEnregistrer({
    mois, jour, nomPrincipal, presentationHistorique, autresPrenoms, patronage, traditions, source, verifie,
  });

  const m = String(mois).padStart(2, '0');
  const d = String(jour).padStart(2, '0');
  const anneeEnCours = new Date().getFullYear();
  revalidatePath(`/${anneeEnCours}/${m}/${d}`);
  revalidatePath('/admin-x7f2k9/saints');
}

export default async function GestionSaints() {
  const saints = await ovhApi.saintsListe();
  const saintsTries = [...saints].sort((a, b) => a.mois - b.mois || a.jour - b.jour);

  return (
    <main>
      <h1>Gestion des saints</h1>
      <p>{saints.length} saints enregistrés. Les saints non vérifiés sont marqués ⚠️.</p>

      <details>
        <summary>Ajouter / corriger un saint</summary>
        <form action={enregistrerSaint} className="admin-formulaire">
          <label>Mois <input type="number" name="mois" min="1" max="12" required /></label>
          <label>Jour <input type="number" name="jour" min="1" max="31" required /></label>
          <label>Nom principal <input type="text" name="nomPrincipal" required /></label>
          <label>Présentation historique <textarea name="presentationHistorique" /></label>
          <label>Autres prénoms <input type="text" name="autresPrenoms" /></label>
          <label>Patronage <textarea name="patronage" /></label>
          <label>Traditions <textarea name="traditions" /></label>
          <label>Source (obligatoire) <input type="text" name="source" required /></label>
          <label><input type="checkbox" name="verifie" /> Information vérifiée</label>
          <button type="submit">Enregistrer</button>
        </form>
      </details>

      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Nom</th>
            <th>Source</th>
            <th>Vérifié</th>
          </tr>
        </thead>
        <tbody>
          {saintsTries.map((s) => (
            <tr key={s.id}>
              <td>{String(s.jour).padStart(2, '0')}/{String(s.mois).padStart(2, '0')}</td>
              <td>{s.nom_principal}</td>
              <td>{s.source}</td>
              <td>{s.verifie ? '✅' : '⚠️'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
