import { redirect } from 'next/navigation';

export default function Accueil() {
  const maintenant = new Date();
  const y = maintenant.getFullYear();
  const m = String(maintenant.getMonth() + 1).padStart(2, '0');
  const d = String(maintenant.getDate()).padStart(2, '0');
  redirect(`/${y}/${m}/${d}/`);
}
