/**
 * Atalhos de troca de empresa (UX §2.10). Globais: `Alt+Shift+1..9` escolhe a
 * N-ésima empresa da lista. Escolhido porque `Alt+N` colide com troca de aba no
 * Firefox/Linux e `Ctrl+Alt` é AltGr em vários teclados. Usa `code` (posição da
 * tecla), não `key`, porque no macOS `Option+dígito` produz outro caractere.
 * Dentro do menu aberto, o dígito sozinho também escolhe (ver `WorkspaceList`).
 */

export interface ShortcutEventLike {
  code: string;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/** Índice (0-based) da empresa pedida por `Alt+Shift+1..9`, ou `null`. */
export function workspaceShortcutIndex(e: ShortcutEventLike): number | null {
  if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return null;
  const match = /^Digit([1-9])$/.exec(e.code);
  const digit = match?.[1];
  return digit === undefined ? null : Number(digit) - 1;
}

/** Rótulo do atalho da N-ésima empresa (índice 0-based); `null` acima de 9. */
export function workspaceShortcutLabel(index: number, isMac: boolean): string | null {
  if (index < 0 || index > 8) return null;
  return isMac ? `⌥⇧${index + 1}` : `Alt+Shift+${index + 1}`;
}

/** `true` se o foco está num campo de digitação (atalho global não deve roubar). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
