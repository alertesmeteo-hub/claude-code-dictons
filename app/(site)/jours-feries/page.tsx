import { redirect } from 'next/navigation';
import { dateAujourdhuiParis } from '@/lib/calculs/date-paris';

export const dynamic = 'force-dynamic';

export default function JoursFeriesAnneeCourante() {
  redirect(`/jours-feries/${dateAujourdhuiParis().slice(0, 4)}/`);
}
