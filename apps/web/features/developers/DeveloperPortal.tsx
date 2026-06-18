'use client';

/**
 * Portal do Desenvolvedor in-product (F38-S13) — documentacao DS v2 (nao Swagger
 * cru) da Leadium API. Secoes: Primeiros passos, Autenticacao, Referencia (do
 * OpenAPI live), Webhooks e Exemplos. Nav lateral por ancoras (scroll), colapsa
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
  { id: 'auth', label: 'Autenticacao', Component: Authentication },
  { id: 'referencia', label: 'Referencia', Component: ReferenceSection },
  { id: 'webhooks', label: 'Webhooks', Component: Webhooks },
  { id: 'exemplos', label: 'Exemplos', Component: Examples },
] as const;

export function DeveloperPortal() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <Link
        href="/help"
        className="inline-flex w-fit items-center gap-1.5 font-head text-sm text-text-mid outline-none transition-colors hover:text-text focus-visible:shadow-glow-md"
      >
        <ArrowLeft className="size-4" aria-hidden /> Voltar a Central de Ajuda
      </Link>

      <header className="flex items-center gap-3">
        <span className="inline-flex size-12 items-center justify-center rounded-xl bg-surface-2 text-brand">
          <BookText className="size-6" aria-hidden />
        </span>
        <div>
          <h1 className="font-head text-3xl font-semibold text-text">Leadium API</h1>
          <p className="font-body text-text-mid">
            Integre seu produto a Leadium via a API publica v1 e webhooks.
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-8 lg:flex-row">
        <nav
          aria-label="Secoes da documentacao"
          className="flex gap-2 overflow-x-auto border-b border-border-2 pb-2 lg:sticky lg:top-6 lg:h-fit lg:w-48 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-none lg:pb-0"
        >
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="shrink-0 rounded-md px-3 py-2 font-head text-sm font-medium text-text-mid outline-none transition-colors hover:bg-surface-2 hover:text-text focus-visible:shadow-glow-md"
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
