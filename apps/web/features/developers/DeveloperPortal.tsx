'use client';

/**
 * Portal do Desenvolvedor in-product (F38-S13; DS 3.0 na F72-S07) — documentação (não Swagger
 * cru) da Leadium API. Seções: Primeiros passos, Autenticação, Referência (do
 * OpenAPI live), Webhooks e Exemplos. Nav lateral por âncoras (ids ASCII) (scroll), colapsa
 * no mobile. Responsivo, ARIA.
 */
import { ArrowLeft, BookText } from 'lucide-react';
import Link from 'next/link';
import {
  Authentication,
  Examples,
  GettingStarted,
  ReferenceSection,
  Webhooks,
} from './sections';

const SECTIONS = [
  { id: 'inicio', label: 'Primeiros passos', Component: GettingStarted },
  { id: 'auth', label: 'Autenticação', Component: Authentication },
  { id: 'referencia', label: 'Referência', Component: ReferenceSection },
  { id: 'webhooks', label: 'Webhooks', Component: Webhooks },
  { id: 'exemplos', label: 'Exemplos', Component: Examples },
] as const;

export function DeveloperPortal() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <Link
        href="/help"
        className="inline-flex w-fit items-center gap-1.5 rounded-xs font-body text-sm font-bold text-text-mid outline-none transition-colors duration-(--dur-fast) ease-ds hover:text-text focus-visible:focus-ring"
      >
        <ArrowLeft className="size-4" aria-hidden /> Voltar à Central de Ajuda
      </Link>

      <header className="flex items-start gap-4">
        <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-md border border-border-brand bg-brand-text/10 text-brand-text">
          <BookText className="size-6" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="font-mono text-xs font-medium uppercase tracking-widest text-text-low">
            Desenvolvedores · v1
          </p>
          <h1 className="font-head text-h3 text-text md:text-h2">Leadium API</h1>
          <p className="max-w-2xl font-body text-body text-text-mid">
            Integre seu produto à Leadium pela API pública v1 e por webhooks.
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-8 lg:flex-row">
        <nav
          aria-label="Seções da documentação"
          className="flex gap-1 overflow-x-auto border-b border-border pb-2 lg:sticky lg:top-6 lg:h-fit lg:w-48 lg:shrink-0 lg:flex-col lg:border-l lg:border-b-0 lg:pb-0 lg:pl-2"
        >
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="shrink-0 rounded-sm px-3 py-2 font-body text-sm font-bold text-text-mid outline-none transition-colors duration-(--dur-fast) ease-ds hover:bg-surface-2 hover:text-text focus-visible:focus-ring"
            >
              {s.label}
            </a>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col gap-16">
          {SECTIONS.map(({ id, Component }) => (
            <section key={id} id={id} className="scroll-mt-6">
              <Component />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
