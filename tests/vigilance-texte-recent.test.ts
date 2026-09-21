import { describe, expect, it } from 'vitest';
import { texteDepuisCdpTextes } from '@/lib/meteo/vigilance-texte-recent';

const item = (type_name: string, hazard_name: string, textes: string[], risk_name = '') => ({
  type_name,
  text_items: [{ hazard_name, term_items: [{ risk_name, subdivision_text: [{ bold_text: '', underline_text: '', text: textes }] }] }],
});

const JSON_BRUT = JSON.stringify({
  product: {
    text_bloc_items: [
      { domain_id: 'FRA', bloc_id: 'BULLETIN_NATIONAL', bloc_title: 'Bulletin de suivi national de la Vigilance', bloc_items: [
        item('Situation météorologique', 'tous aléas', ['Prévisions confirmées.']),
        item('Suivi par phénomène', 'Canicule', ['Épisode de très fortes chaleurs.'], 'Orange'),
      ] },
      { domain_id: '07', bloc_id: 'BULLETIN_DEPARTEMENTAL', bloc_title: 'Bulletin de suivi départemental de la Vigilance : Ardèche (07)', bloc_items: [item('Situation', 'tous aléas', ['Pyrénées-Orientales en jaune.'])] },
      { domain_id: '26', bloc_id: 'BULLETIN_DEPARTEMENTAL', bloc_title: 'Bulletin de suivi départemental de la Vigilance : Drôme (26)', bloc_items: [item('Situation', 'tous aléas', ['Pyrénées-Orientales en jaune.'])] },
      { domain_id: '01', bloc_id: 'BULLETIN_DEPARTEMENTAL', bloc_title: 'Bulletin de suivi départemental de la Vigilance : Ain (01)', bloc_items: [item('Situation', 'tous aléas', ['Néant'])] },
    ],
  },
});

describe('texteDepuisCdpTextes', () => {
  const t = texteDepuisCdpTextes(JSON_BRUT);

  it('garde le bulletin national avec le phénomène et son niveau', () => {
    expect(t).toContain('BULLETIN DE SUIVI NATIONAL DE LA VIGILANCE');
    expect(t).toContain('Canicule — Orange : Épisode de très fortes chaleurs.');
  });

  it('regroupe les départements qui ont le même texte et ignore « Néant »', () => {
    expect(t).toContain('Situation — Ardèche (07), Drôme (26) :');
    expect(t.match(/Pyrénées-Orientales en jaune/g)).toHaveLength(1);
    expect(t).not.toContain('Ain (01)');
    expect(t).not.toContain('Néant');
  });
});
