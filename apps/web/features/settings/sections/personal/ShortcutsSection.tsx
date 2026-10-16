'use client';

import { Panel } from './components';

/** `combo`: teclas juntas (+) · `sequence`: uma depois da outra. */
type Joiner = 'combo' | 'sequence';

const SHORTCUTS: readonly { keys: readonly string[]; joiner: Joiner; action: string }[] = [
  { keys: ['Ctrl/⌘', 'K'], joiner: 'combo', action: 'Busca global de configurações' },
  { keys: ['G', 'D'], joiner: 'sequence', action: 'Ir para o Dashboard' },
  { keys: ['G', 'C'], joiner: 'sequence', action: 'Ir para Conversas' },
  { keys: ['G', 'P'], joiner: 'sequence', action: 'Ir para o Pipeline' },
  { keys: ['Esc'], joiner: 'combo', action: 'Fechar painel/drawer aberto' },
];

/** Atalhos: referência de teclado (read-only). Teclas em mono, como no teclado. */
export default function ShortcutsSection(): React.JSX.Element {
  return (
    <Panel title="Teclado" description="Sequências como G depois D: aperte uma tecla e depois a outra." body="flush">
      <dl className="divide-y divide-border px-5">
        {SHORTCUTS.map((s) => (
          <div key={s.action} className="flex items-center justify-between gap-4 py-3">
            <dt className="font-body text-sm text-text-mid">{s.action}</dt>
            <dd className="flex shrink-0 items-center gap-1.5">
              {s.keys.map((k, i) => (
                <span key={k} className="flex items-center gap-1.5">
                  {i > 0 && (
                    <span className="font-body text-xs text-text-low">{s.joiner === 'sequence' ? 'depois' : '+'}</span>
                  )}
                  <kbd className="min-w-7 rounded-xs border border-border-2 bg-surface-2 px-2 py-0.5 text-center font-mono text-xs text-text shadow-[inset_0_-1px_0_var(--border-2)]">
                    {k}
                  </kbd>
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
