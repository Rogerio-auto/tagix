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
    <div className="flex flex-col gap-6">
      <Link
        href="/help/developers"
        className="group flex items-center gap-4 rounded-lg border border-border bg-surface px-5 py-4 outline-none transition-[border-color,transform,box-shadow] duration-(--dur-slow) ease-ds-spring hover:border-border-brand hover:shadow-ds-2 focus-visible:focus-ring motion-safe:hover:-translate-y-0.5"
      >
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-brand-text/25 bg-brand-text/10 text-brand-text">
          <BookText className="size-5" aria-hidden />
        </span>
        <span className="flex flex-1 flex-col">
          <span className="font-head text-base font-semibold text-text">Portal do Desenvolvedor</span>
          <span className="font-body text-sm text-text-mid">
            Referência da Leadium API, autenticação, webhooks e exemplos prontos para copiar.
          </span>
        </span>
        <ArrowUpRight
          className="size-5 shrink-0 text-text-low transition-[transform,color] duration-(--dur-base) group-hover:text-text motion-safe:group-hover:-translate-y-0.5 motion-safe:group-hover:translate-x-0.5"
          aria-hidden
        />
      </Link>

      <ApiKeysManager />
      <WebhooksManager />
    </div>
  );
}
