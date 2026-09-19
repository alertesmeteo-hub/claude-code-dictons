/** Événement Plausible (sans cookie). Sans effet si le script n'est pas chargé (bloqueur, dev, admin). */
export function suivre(nom: string, props?: Record<string, string>) {
  try {
    const w = window as unknown as { plausible?: (n: string, o?: { props: Record<string, string> }) => void };
    w.plausible?.(nom, props ? { props } : undefined);
  } catch {
    // le suivi ne doit jamais casser la page
  }
}
