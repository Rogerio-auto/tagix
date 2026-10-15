/**
 * Idioma da interface = o `lang` declarado no <html> (o layout raiz define), nunca um
 * literal no componente (regra de lint F59-S08). `undefined` cai no padrão do runtime
 * (SSR/teste sem DOM). O fuso é o do navegador: é nele que a grade (FullCalendar) e os
 * limites de dia da agenda são calculados, então a hora exibida bate com a posição.
 */
export function uiLocale(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.documentElement.lang || undefined;
}
