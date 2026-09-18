import { describe, it, expect } from 'vitest';
import { calculerInfosJourAnnee } from '@/lib/calculs/jour-annee';

describe('calculerInfosJourAnnee', () => {
  it('calcule le 1er janvier comme jour 1', () => {
    const infos = calculerInfosJourAnnee(new Date(2026, 0, 1));
    expect(infos.numeroJourAnnee).toBe(1);
    expect(infos.joursRestants).toBe(364);
  });

  it('détecte correctement une année bissextile', () => {
    expect(calculerInfosJourAnnee(new Date(2024, 0, 1)).bissextile).toBe(true);
    expect(calculerInfosJourAnnee(new Date(2026, 0, 1)).bissextile).toBe(false);
  });

  it('calcule le dernier jour de l\'année', () => {
    const infos = calculerInfosJourAnnee(new Date(2026, 11, 31));
    expect(infos.numeroJourAnnee).toBe(365);
    expect(infos.joursRestants).toBe(0);
  });

  it('calcule un numéro de semaine ISO cohérent', () => {
    // Le 1er janvier 2026 est un jeudi → semaine ISO 1
    const infos = calculerInfosJourAnnee(new Date(2026, 0, 1));
    expect(infos.semaineISO).toBe(1);
  });
});
