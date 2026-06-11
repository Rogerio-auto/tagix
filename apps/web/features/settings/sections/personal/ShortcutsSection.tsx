'use client';

const SHORTCUTS: readonly { keys: string; action: string }[] = [
  { keys: 'Ctrl/Cmd + K', action: 'Busca global de configurações' },
  { keys: 'G depois D', action: 'Ir para o Dashboard' },
  { keys: 'G depois C', action: 'Ir para Conversas' },
  { keys: 'G depois P', action: 'Ir para o Pipeline' },
  { keys: 'Esc', action: 'Fechar painel/drawer aberto' },
];

/** Atalhos: referência de teclado (read-only). */
export default function ShortcutsSection(): React.JSX.Element {
  return (
    <div className="max-w-md">
      <dl className="flex flex-col">
        {SHORTCUTS.map((s) => (
          <div
            key={s.keys}
            className="flex items-center justify-between gap-4 border-b border-border/40 py-2"
          >
            <dt className="text-sm text-text-mid">{s.action}</dt>
            <dd>
              <kbd className="rounded border border-border bg-surface-2 px-2 py-0.5 text-xs text-text">
                {s.keys}
              </kbd>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
