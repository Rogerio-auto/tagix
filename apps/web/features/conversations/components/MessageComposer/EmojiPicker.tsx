'use client';

/**
 * Emoji picker do composer (F45-S03). Popover ancorado (NÃO modal full-screen —
 * UX §3) com busca por palavra-chave. Ao escolher, dispara `onSelect(emoji)`; a
 * inserção na posição do cursor é responsabilidade do `MessageComposer` (que é
 * dono do `textarea`/seleção). O popover permanece aberto para inserção múltipla
 * (estilo WhatsApp); fecha com `Esc`, clique-fora ou toggle do trigger, devolvendo
 * o foco ao composer via `onClosed`.
 *
 * Sem dependência externa: lista curada + busca por substring (pt-BR), suficiente
 * para o caso de uso e tree-shake-friendly por padrão.
 *
 * DS v2: zero hex, só tokens; foco `focus-visible:shadow-glow-md`; alvo ≥44px no trigger.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, Smile } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { ComposerActionButton } from './ComposerActionBar';

interface EmojiEntry {
  /** Caractere(s) do emoji. */
  readonly char: string;
  /** Palavras-chave de busca (minúsculas, sem acento), separadas por espaço. */
  readonly keywords: string;
}

interface EmojiGroup {
  readonly label: string;
  readonly emojis: readonly EmojiEntry[];
}

// Lista curada cobrindo os usos mais comuns em atendimento/vendas. Keywords em
// pt-BR sem acento (a busca normaliza o termo digitado para casar).
const EMOJI_GROUPS: readonly EmojiGroup[] = [
  {
    label: 'Frequentes',
    emojis: [
      { char: '👍', keywords: 'joia positivo curtir like ok legal' },
      { char: '🙏', keywords: 'obrigado por favor reza agradecido' },
      { char: '🎉', keywords: 'festa comemoracao parabens confete' },
      { char: '✅', keywords: 'ok certo confirmado feito check' },
      { char: '🔥', keywords: 'fogo top incrivel demais' },
      { char: '❤️', keywords: 'coracao amor vermelho' },
      { char: '😂', keywords: 'rindo risada chorando rir' },
      { char: '😊', keywords: 'feliz sorriso simpatico' },
    ],
  },
  {
    label: 'Rostos',
    emojis: [
      { char: '😀', keywords: 'feliz sorriso alegre' },
      { char: '😃', keywords: 'feliz sorriso alegre boca aberta' },
      { char: '😄', keywords: 'feliz rindo alegre' },
      { char: '😁', keywords: 'feliz sorriso dentes' },
      { char: '🙂', keywords: 'sorriso leve ok' },
      { char: '😉', keywords: 'piscada flerte' },
      { char: '😍', keywords: 'apaixonado amor coracao olhos' },
      { char: '😘', keywords: 'beijo amor carinho' },
      { char: '🤗', keywords: 'abraco carinho acolher' },
      { char: '🤔', keywords: 'pensando duvida hmmm' },
      { char: '😅', keywords: 'aliviado suor nervoso rindo' },
      { char: '😎', keywords: 'oculos legal estiloso' },
      { char: '🙃', keywords: 'invertido ironia' },
      { char: '😴', keywords: 'dormindo sono cansado' },
      { char: '😢', keywords: 'triste choro lagrima' },
      { char: '😡', keywords: 'bravo raiva irritado' },
      { char: '😱', keywords: 'susto medo choque' },
      { char: '🤩', keywords: 'estrela animado uau incrivel' },
      { char: '😇', keywords: 'anjo inocente santo' },
      { char: '🥳', keywords: 'festa comemorar aniversario' },
    ],
  },
  {
    label: 'Gestos',
    emojis: [
      { char: '👏', keywords: 'palmas aplauso parabens' },
      { char: '🙌', keywords: 'maos levantadas comemorar uhuu' },
      { char: '👌', keywords: 'ok perfeito certo' },
      { char: '🤝', keywords: 'aperto de mao acordo negocio parceria' },
      { char: '👋', keywords: 'tchau ola aceno' },
      { char: '✌️', keywords: 'paz vitoria dois' },
      { char: '💪', keywords: 'forca musculo poder' },
      { char: '👇', keywords: 'aponta baixo abaixo' },
      { char: '👉', keywords: 'aponta direita' },
      { char: '🤞', keywords: 'dedos cruzados sorte torcendo' },
    ],
  },
  {
    label: 'Objetos & vendas',
    emojis: [
      { char: '💰', keywords: 'dinheiro grana saco pagamento' },
      { char: '💸', keywords: 'dinheiro voando gasto preco' },
      { char: '💳', keywords: 'cartao credito pagamento' },
      { char: '🛒', keywords: 'carrinho compra pedido' },
      { char: '🎁', keywords: 'presente brinde bonus' },
      { char: '📦', keywords: 'caixa pacote entrega envio' },
      { char: '🚀', keywords: 'foguete rapido lancamento crescer' },
      { char: '⭐', keywords: 'estrela favorito avaliacao' },
      { char: '📅', keywords: 'calendario agenda data' },
      { char: '⏰', keywords: 'relogio alarme horario prazo' },
      { char: '📍', keywords: 'local localizacao endereco pin' },
      { char: '📞', keywords: 'telefone ligacao contato' },
      { char: '💬', keywords: 'balao mensagem conversa chat' },
      { char: '📈', keywords: 'grafico resultado crescimento alta' },
      { char: '💡', keywords: 'ideia luz lampada dica' },
      { char: '✨', keywords: 'brilho magia novidade' },
    ],
  },
];

export interface EmojiPickerProps {
  /** Recebe o emoji escolhido. O composer insere na posição do cursor. */
  readonly onSelect: (emoji: string) => void;
  readonly disabled?: boolean;
  /** Chamado ao fechar (Esc/clique-fora/toggle) p/ devolver o foco ao composer. */
  readonly onClosed?: () => void;
}

/** Normaliza para busca: minúsculas e sem acentos. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function EmojiPicker({ onSelect, disabled = false, onClosed }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const popoverId = useId();

  const close = (returnFocus: boolean) => {
    setOpen(false);
    setQuery('');
    if (returnFocus) onClosed?.();
  };

  // Click-fora fecha e devolve o foco ao composer.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) close(true);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Foca a busca ao abrir (foco gerenciado no popover).
  useEffect(() => {
    if (open) requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  const results = useMemo(() => {
    const term = normalize(query.trim());
    if (!term) return EMOJI_GROUPS;
    return EMOJI_GROUPS.map((group) => ({
      label: group.label,
      emojis: group.emojis.filter((e) => normalize(e.keywords).includes(term)),
    })).filter((group) => group.emojis.length > 0);
  }, [query]);

  const hasResults = results.some((g) => g.emojis.length > 0);

  return (
    <div ref={containerRef} className="relative">
      <ComposerActionButton
        ref={triggerRef}
        icon={<Smile className="size-5" aria-hidden />}
        label="Inserir emoji"
        active={open}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => (open ? close(true) : setOpen(true))}
      />

      {open && (
        <div
          id={popoverId}
          role="dialog"
          aria-label="Selecionar emoji"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              close(true);
            }
          }}
          className={cn(
            'absolute bottom-full left-0 z-30 mb-2 w-72 rounded-lg border border-border',
            'bg-surface-2 p-2 shadow-glow-md',
          )}
        >
          <div className="relative mb-2">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-low"
              aria-hidden
            />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar emoji…"
              aria-label="Buscar emoji"
              className={cn(
                'w-full rounded-md border border-border-2 bg-surface-inset py-1.5 pl-8 pr-2',
                'font-body text-sm text-text outline-none placeholder:text-text-low',
                'focus-visible:border-border focus-visible:shadow-glow-md',
              )}
            />
          </div>

          <div className="max-h-56 overflow-y-auto pr-0.5">
            {hasResults ? (
              results.map((group) => (
                <section key={group.label} className="mb-2 last:mb-0">
                  <h3 className="mb-1 px-1 font-body text-xs font-medium uppercase tracking-wide text-text-low">
                    {group.label}
                  </h3>
                  <div className="grid grid-cols-7 gap-0.5">
                    {group.emojis.map((emoji) => (
                      <button
                        key={`${group.label}-${emoji.char}`}
                        type="button"
                        aria-label={`Inserir ${emoji.char}`}
                        title={emoji.keywords.split(' ')[0]}
                        onClick={() => onSelect(emoji.char)}
                        className={cn(
                          'flex aspect-square items-center justify-center rounded-md text-xl leading-none outline-none',
                          'transition-colors hover:bg-surface-3 focus-visible:shadow-glow-md',
                        )}
                      >
                        <span aria-hidden>{emoji.char}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ))
            ) : (
              <p className="px-1 py-6 text-center font-body text-sm text-text-low">
                Nenhum emoji encontrado.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
