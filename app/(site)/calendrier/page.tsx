import { redirect } from 'next/navigation';
import { dateAujourdhuiParis } from '@/lib/calculs/date-paris';

export const dynamic = 'force-dynamic';

export default function CalendrierMoisCourant() {
  const [annee, mois] = dateAujourdhuiParis().split('-');
  redirect(`/calendrier/${annee}/${mois}/`);
}
