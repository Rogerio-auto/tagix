'use client';

/**
 * Bloco de codigo copy-paste (F38-S13). Copia para a area de transferencia com
 * feedback visual. Sem syntax highlight pesado (DS v2, leve); fonte monospace.
 */
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard pode falhar em contexto inseguro; silencioso.
    }
  }

  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-surface-inset">
      {label && (
        <div className="border-b border-border px-4 py-2 font-mono text-xs font-medium uppercase tracking-wider text-text-low">
          {label}
        </div>
      )}
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copiar codigo"
        className="absolute right-2 top-1.5 inline-flex items-center gap-1 rounded-xs border border-border bg-surface px-2 py-1 font-body text-xs font-bold text-text-mid outline-none transition-colors duration-(--dur-fast) ease-ds hover:border-border-2 hover:text-text focus-visible:focus-ring"
      >
        {copied ? <Check className="size-3.5 text-success" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        {copied ? 'Copiado' : 'Copiar'}
      </button>
      {/* Rolagem horizontal focável por teclado (WCAG 2.1.1 / axe scrollable-region-focusable). */}
      <pre
        tabIndex={0}
        className="overflow-x-auto px-4 py-3 font-mono text-sm leading-relaxed text-text outline-none focus-visible:focus-ring"
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}
