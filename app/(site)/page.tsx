import { redirect } from 'next/navigation';
import { dateAujourdhuiParis } from '@/lib/calculs/date-paris';

// Doit être évalué à chaque requête (sinon la redirection reste figée sur le jour du build).
export const dynamic = 'force-dynamic';

export default function Accueil() {
  const [y, m, d] = dateAujourdhuiParis().split('-');
  redirect(`/${y}/${m}/${d}/`);
}
