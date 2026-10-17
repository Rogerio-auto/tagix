/**
 * Título da sessão do Copiloto a partir da 1ª pergunta (F73-S10). Sem LLM: determinístico,
 * grátis e instantâneo. As primeiras 60 letras, sem cortar palavra quando dá para evitar.
 */

/** Letras (code points) do título antes da reticência. */
export const COPILOT_SESSION_TITLE_LETTERS = 60;
/** Se o último espaço estiver antes disto, corta seco (palavra enorme ou texto sem espaço). */
const WORD_BREAK_MIN = 40;

/** Pergunta → título. Espaços normalizados, controles removidos, ≤ 61 code points. */
export function sessionTitleFrom(question: string): string {
  const normalized = question
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const letters = Array.from(normalized);
  if (letters.length <= COPILOT_SESSION_TITLE_LETTERS) return normalized;
  const head = letters.slice(0, COPILOT_SESSION_TITLE_LETTERS).join('');
  const lastSpace = head.lastIndexOf(' ');
  const cut = lastSpace >= WORD_BREAK_MIN ? head.slice(0, lastSpace) : head;
  return `${cut.replace(/[\s.,;:!?-]+$/u, '')}…`;
}
