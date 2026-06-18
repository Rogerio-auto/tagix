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
    <div className="relative overflow-hidden rounded-md border border-border-2 bg-surface-2">
      {label && (
        <div className="border-b border-border-2 px-4 py-1.5 font-head text-[11px] font-semibold uppercase tracking-wide text-text-low">
          {label}
        </div>
      )}
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copiar codigo"
        className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-sm border border-border bg-surface px-2 py-1 font-head text-xs text-text-mid outline-none transition-colors hover:text-text focus-visible:shadow-glow-md"
      >
        {copied ? <Check className="size-3.5 text-brand" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        {copied ? 'Copiado' : 'Copiar'}
      </button>
      <pre className="overflow-x-auto px-4 py-3 font-price text-[13px] leading-relaxed text-text-mid">
        <code>{code}</code>
      </pre>
    </div>
  );
}
