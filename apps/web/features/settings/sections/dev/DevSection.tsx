'use client';

/**
 * Secao Settings - Dev (F9-S06, ampliada F38-S13). Gestao de API keys + webhooks
 * outbound (F9-S04) e deep-link para o Portal do Desenvolvedor in-product
 * (Leadium API), que renderiza a referencia do OpenAPI live.
 */
import Link from 'next/link';
import { ArrowUpRight, BookText } from 'lucide-react';
import ApiKeysManager from './ApiKeysManager';
import WebhooksManager from './WebhooksManager';

export default function DevSection(): React.JSX.Element {
  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <Link
        href="/help/developers"
        className="group flex items-center gap-4 rounded-lg border border-border bg-surface-2 px-5 py-4 outline-none transition-colors hover:border-border-2 hover:bg-surface-3 focus-visible:shadow-glow-md"
      >
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-md bg-brand/15 text-brand">
          <BookText className="size-5" aria-hidden />
        </span>
        <span className="flex flex-1 flex-col">
          <span className="font-head text-sm font-semibold text-text">Portal do Desenvolvedor</span>
          <span className="font-body text-sm text-text-mid">
            Referencia da Leadium API, autenticacao, webhooks e exemplos copy-paste.
          </span>
        </span>
        <ArrowUpRight
          className="size-5 shrink-0 text-text-low transition-transform group-hover:translate-x-0.5 group-hover:text-text"
          aria-hidden
        />
      </Link>

      <ApiKeysManager />
      <WebhooksManager />
    </div>
  );
}
