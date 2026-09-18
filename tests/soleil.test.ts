import { describe, it, expect } from 'vitest';
import { calculerLeverCoucher } from '@/lib/soleil/calcul';

describe('calculerLeverCoucher', () => {
  it('calcule un lever/coucher plausible pour Paris en septembre', () => {
    const resultat = calculerLeverCoucher(new Date(2026, 8, 18, 12, 0, 0), 48.8566, 2.3522);
    expect(resultat.casPolaire).toBe(false);
    expect(resultat.leverUTC).not.toBeNull();
    expect(resultat.coucherUTC).not.toBeNull();
    // Lever attendu ~05h-06h UTC, coucher ~17h-19h UTC en septembre à Paris
    expect(resultat.leverUTC!.getUTCHours()).toBeGreaterThanOrEqual(4);
    expect(resultat.leverUTC!.getUTCHours()).toBeLessThanOrEqual(7);
    expect(resultat.dureeJourMinutes).toBeGreaterThan(600);
    expect(resultat.dureeJourMinutes).toBeLessThan(800);
  });

  it('détecte un cas polaire (nuit polaire) au pôle en hiver', () => {
    const resultat = calculerLeverCoucher(new Date(2026, 11, 21, 12, 0, 0), 89, 0);
    expect(resultat.casPolaire).toBe(true);
  });
});
