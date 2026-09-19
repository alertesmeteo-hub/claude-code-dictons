/** Date du jour au format YYYY-MM-DD à Paris, quel que soit le fuseau du serveur (le VPS est en UTC). */
export function dateAujourdhuiParis(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
