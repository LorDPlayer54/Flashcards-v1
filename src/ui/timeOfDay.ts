// Refonte UX/UI : salutation et décor de l'Accueil selon l'HEURE LOCALE uniquement (Accueil V5 figé :
// 06:00 inclus → 18:00 exclu = jour). Totalement indépendant du thème clair/sombre (réglage d'affichage).
export type TimeOfDay = 'day' | 'evening';

export function timeOfDay(d: Date): TimeOfDay {
  const h = d.getHours();
  return h >= 6 && h < 18 ? 'day' : 'evening';
}

export function greeting(t: TimeOfDay): string {
  return t === 'day' ? 'Bonjour.' : 'Bonsoir.';
}
