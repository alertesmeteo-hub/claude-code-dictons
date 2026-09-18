export const dynamic = 'force-dynamic';

import { ovhApi } from '@/lib/db/ovh-api-client';
import { revalidatePath } from 'next/cache';

async function ajouterDicton(formData: FormData) {
  'use server';

  const texte = String(formData.get('texte') ?? '').trim();
  const type = String(formData.get('type') ?? 'dicton');
  const moisRaw = formData.get('mois');
  const jourRaw = formData.get('jour');
  const source = String(formData.get('source') ?? '').trim() || null;

  if (!texte) return;

  await ovhApi.dictonAjouter({
    texte,
    type,
    mois: moisRaw ? Number(moisRaw) : null,
    jour: jourRaw ? Number(jourRaw) : null,
    source,
  });

  revalidatePath('/admin-x7f2k9/dictons');
}

async function basculerActif(formData: FormData) {
  'use server';
  const id = Number(formData.get('id'));
  await ovhApi.dictonBasculerActif(id);
  revalidatePath('/admin-x7f2k9/dictons');
}

export default async function GestionDictons() {
  const dictons = await ovhApi.dictonsListe();

  return (
    <main>
      <h1>Gestion des dictons et proverbes</h1>
      <p>{dictons.length} entrées. Désactivez un dicton plutôt que de le supprimer pour garder une traçabilité.</p>

      <details>
        <summary>Ajouter un dicton</summary>
        <form action={ajouterDicton} className="admin-formulaire">
          <label>Texte <textarea name="texte" required /></label>
          <label>
            Type
            <select name="type">
              <option value="dicton">Dicton</option>
              <option value="proverbe">Proverbe</option>
              <option value="dicton_meteo">Dicton météo</option>
              <option value="dicton_paysan">Dicton paysan</option>
              <option value="adage">Adage</option>
            </select>
          </label>
          <label>Mois (optionnel, laisser vide = valable toute l&apos;année) <input type="number" name="mois" min="1" max="12" /></label>
          <label>Jour (optionnel) <input type="number" name="jour" min="1" max="31" /></label>
          <label>Source <input type="text" name="source" /></label>
          <button type="submit">Ajouter</button>
        </form>
      </details>

      <table>
        <thead>
          <tr>
            <th>Texte</th>
            <th>Type</th>
            <th>Date</th>
            <th>Actif</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {dictons.map((d) => (
            <tr key={d.id} style={{ opacity: d.actif ? 1 : 0.5 }}>
              <td>{d.texte}</td>
              <td>{d.type}</td>
              <td>{d.mois && d.jour ? `${String(d.jour).padStart(2, '0')}/${String(d.mois).padStart(2, '0')}` : "toute l'année"}</td>
              <td>{d.actif ? 'Oui' : 'Non'}</td>
              <td>
                <form action={basculerActif}>
                  <input type="hidden" name="id" value={d.id} />
                  <button type="submit">{d.actif ? 'Désactiver' : 'Réactiver'}</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
