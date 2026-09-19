import { describe, it, expect } from 'vitest';
import { joursFeriesAnnee, prochainJourFerie } from '@/lib/calculs/jours-feries';

function jf(annee: number, nom: string): string {
  const d = joursFeriesAnnee(annee).find((j) => j.nom === nom)!.date;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

describe('jours fériés', () => {
  it('calcule les fêtes mobiles 2026 (Pâques le 5 avril)', () => {
    expect(jf(2026, 'Lundi de Pâques')).toBe('4/6');
    expect(jf(2026, 'Ascension')).toBe('5/14');
    expect(jf(2026, 'Lundi de Pentecôte')).toBe('5/25');
  });

  it('calcule les fêtes mobiles 2025 (Pâques le 20 avril)', () => {
    expect(jf(2025, 'Lundi de Pâques')).toBe('4/21');
    expect(jf(2025, 'Ascension')).toBe('5/29');
  });

  it('trouve la Toussaint depuis le 19 septembre 2026, dans 43 jours', () => {
    expect(prochainJourFerie(new Date(2026, 8, 19))).toEqual({ nom: 'Toussaint', date: '2026-11-01', joursRestants: 43 });
  });

  it('renvoie 0 jour un jour férié', () => {
    expect(prochainJourFerie(new Date(2026, 6, 14)).joursRestants).toBe(0);
  });

  it('passe à l’année suivante après Noël', () => {
    expect(prochainJourFerie(new Date(2026, 11, 26))).toMatchObject({ nom: "Jour de l'an", date: '2027-01-01' });
  });
});
