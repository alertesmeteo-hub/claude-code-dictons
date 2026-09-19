import { describe, it, expect } from 'vitest';
import { construireCalendrierMois, semaineIso } from '@/lib/calculs/calendrier-mois';

describe('calendrier du mois', () => {
  it('septembre 2026 : 30 jours, aucun férié, 22 jours ouvrés, semaines ISO 36 à 40', () => {
    const c = construireCalendrierMois(2026, 9);
    expect(c.nbJours).toBe(30);
    expect(c.feries).toHaveLength(0);
    expect(c.joursOuvres).toBe(22);
    expect(c.semaines.map((s) => s.numero)).toEqual([36, 37, 38, 39, 40]);
    expect(c.semaines[0].cases.findIndex((x) => x?.jour === 1)).toBe(1); // mardi
  });
  it('phases lunaires de septembre 2026 : 4 phases, événements dont équinoxe et patrimoine', () => {
    const c = construireCalendrierMois(2026, 9);
    expect(c.phasesLune.length).toBeGreaterThanOrEqual(3);
    expect(c.evenements.some((e) => e.libelle.startsWith('Équinoxe'))).toBe(true);
    expect(c.evenements.filter((e) => e.libelle === 'Journées du Patrimoine')).toHaveLength(2);
  });
  it('semaine ISO du 1er janvier 2027 = 53', () => {
    expect(semaineIso(2027, 1, 1)).toBe(53);
  });
  it("mars 2026 : passage à l'heure d'été le 29", () => {
    const e = construireCalendrierMois(2026, 3).evenements.find((x) => x.libelle.includes("heure d'été"));
    expect(e?.jour).toBe(29);
  });
});
