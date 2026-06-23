'use client';

import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

interface Props {
  name: string;
  onRename: (name: string) => void;
  saving?: boolean;
  /** Classe do texto/título (default = título do editor). */
  className?: string;
}

/**
 * Nome do flow editável inline: clique (ou foco + Enter) entra em edição; Enter/blur salva,
 * Esc cancela. Renomear é só metadado — PUT /api/flows/:id { name }, sem republicar. Mostra
 * um lápis no hover para sinalizar que é editável (antes não havia como trocar o nome).
 */
export function EditableFlowName({ name, onRename, saving, className }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sincroniza o rascunho quando o nome muda de fora (load/save) e não estamos editando.
  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = (): void => {
    const next = draft.trim();
    setEditing(false);
    if (next.length > 0 && next !== name) onRename(next.slice(0, 160));
    else setDraft(name);
  };

  const cancel = (): void => {
    setDraft(name);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') cancel();
        }}
        onBlur={commit}
        maxLength={160}
        aria-label="Nome do flow"
        className={cn(
          'min-w-0 max-w-[22rem] flex-1 rounded-md border border-accent bg-surface-2 px-2 py-1',
          'font-head text-sm font-semibold text-text focus:shadow-glow-sm focus:outline-none',
          className,
        )}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Clique para renomear"
      className="group flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-surface-3/60"
    >
      <span className={cn('truncate font-head text-sm font-semibold text-text', className)}>
        {name}
      </span>
      {saving ? (
        <span className="shrink-0 text-[11px] text-text-low">salvando…</span>
      ) : (
        <Pencil
          className="size-3.5 shrink-0 text-text-low opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
      )}
    </button>
  );
}
