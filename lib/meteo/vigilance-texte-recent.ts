/**
 * Texte lisible d'un bulletin de vigilance récent (data.gouv.fr, fichier CDP_TEXTES_VIGILANCE.json, 2022+).
 * Le fichier brut fait ~70 Ko (un bloc par département) : on n'en garde que le texte utile — bulletin national,
 * bulletins zonaux, puis les départements ayant un texte propre, regroupés quand plusieurs partagent le même texte.
 */

interface SousTexte {
  bold_text?: string;
  underline_text?: string;
  text?: string[];
}
interface Terme {
  term_names?: string;
  risk_name?: string;
  risk_color?: string;
  subdivision_text?: SousTexte[];
}
interface ItemTexte {
  hazard_name?: string;
  term_items?: Terme[];
}
interface ItemBloc {
  id?: string;
  type_name?: string;
  text_items?: ItemTexte[];
}
interface Bloc {
  domain_id?: string;
  domain_name?: string;
  bloc_id?: string;
  bloc_title?: string;
  bloc_items?: ItemBloc[];
}

const propre = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Paragraphes d'un terme : « Faits nouveaux : Prévisions confirmées. », etc. Vide si le terme n'a aucun texte. */
function paragraphes(t: Terme): string[] {
  const out: string[] = [];
  for (const s of t.subdivision_text ?? []) {
    const corps = (s.text ?? []).map(propre).filter(Boolean).join(' ');
    if (!corps) continue;
    const titre = propre([s.underline_text, s.bold_text].filter(Boolean).join(' '));
    out.push(titre ? `${titre} ${corps}` : corps);
  }
  return out;
}

/** Lignes d'un item : « Phénomène — niveau : texte ». Ignore les textes vides et « Néant ». */
function lignesItem(item: ItemBloc): string[] {
  const lignes: string[] = [];
  for (const ti of item.text_items ?? []) {
    for (const t of ti.term_items ?? []) {
      const p = paragraphes(t).filter((x) => x.toLowerCase() !== 'néant');
      if (p.length === 0) continue;
      const alea = ti.hazard_name && ti.hazard_name !== 'tous aléas' ? ti.hazard_name : '';
      const niveau = t.risk_name ? ` — ${t.risk_name}` : '';
      const entete = alea ? `${alea}${niveau} : ` : '';
      lignes.push(`${entete}${p.join(' ')}`);
    }
  }
  return lignes;
}

export function texteDepuisCdpTextes(brut: string): string {
  const json = JSON.parse(brut) as { product?: { text_bloc_items?: Bloc[] } };
  const blocs = json.product?.text_bloc_items ?? [];
  const sortie: string[] = [];

  const rubrique = (titre: string, lignes: string[]) => {
    if (lignes.length === 0) return;
    sortie.push(titre, ...lignes.map((l) => `  ${l}`), '');
  };

  for (const b of blocs.filter((x) => x.bloc_id === 'BULLETIN_NATIONAL')) {
    sortie.push((b.bloc_title ?? 'Bulletin national').toUpperCase(), '');
    for (const it of b.bloc_items ?? []) rubrique(`${it.type_name ?? ''} :`, lignesItem(it));
  }

  for (const b of blocs.filter((x) => x.bloc_id === 'BULLETIN_ZONAL')) {
    for (const it of b.bloc_items ?? []) rubrique(`Zone ${b.domain_name ?? b.domain_id} — ${it.type_name ?? ''} :`, lignesItem(it));
  }

  // Départements : même texte pour plusieurs départements → une seule fois, avec la liste des départements.
  const groupes = new Map<string, { titre: string; deps: string[]; ligne: string }>();
  for (const b of blocs.filter((x) => x.bloc_id === 'BULLETIN_DEPARTEMENTAL')) {
    const nom = propre((b.bloc_title ?? '').split(':').slice(1).join(':')) || String(b.domain_id);
    for (const it of b.bloc_items ?? []) {
      for (const ligne of lignesItem(it)) {
        const cle = `${it.type_name}|${ligne}`;
        const g = groupes.get(cle) ?? { titre: it.type_name ?? '', deps: [], ligne };
        g.deps.push(nom);
        groupes.set(cle, g);
      }
    }
  }
  for (const g of groupes.values()) rubrique(`${g.titre} — ${g.deps.join(', ')} :`, [g.ligne]);

  return sortie.join('\n').trim();
}
