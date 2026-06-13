import Link from 'next/link';
import { Boxes, KeyRound, ShieldCheck, SlidersHorizontal } from 'lucide-react';

/**
 * Home do painel de super-admin (F25-S06). Hub das 4 áreas; o conteúdo de cada uma
 * é entregue por S07 (Modelos/Políticas) e S08 (Secrets/Uso).
 */
export const metadata = { title: 'Plataforma — Super-admin' };

const CARDS = [
  {
    href: '/platform/models',
    label: 'Modelos',
    desc: 'Catálogo global de LLMs e sync OpenRouter.',
    Icon: Boxes,
  },
  {
    href: '/platform/policies',
    label: 'Políticas',
    desc: 'Modelos, features e caps por workspace.',
    Icon: SlidersHorizontal,
  },
  {
    href: '/platform/secrets',
    label: 'Secrets',
    desc: 'Rotação de chaves de plataforma (auditada).',
    Icon: KeyRound,
  },
  {
    href: '/platform/usage',
    label: 'Uso',
    desc: 'Gasto de LLM, top spenders e alertas de cap.',
    Icon: ShieldCheck,
  },
] as const;

export default function PlatformHome() {
  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-8">
        <h1 className="font-head text-2xl font-semibold text-text">Super-admin de plataforma</h1>
        <p className="mt-1 text-sm text-text-mid">
          Camada acima dos workspaces: catálogo de modelos, políticas de agentes, secrets e custo de
          LLM. Toda ação sensível é auditada.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map(({ href, label, desc, Icon }) => (
          <Link
            key={href}
            href={href}
            className="group flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 outline-none transition-colors hover:border-border-2 hover:bg-surface-2 focus-visible:shadow-glow-md"
          >
            <Icon className="size-6 text-warn" aria-hidden />
            <div>
              <h2 className="font-head text-base font-semibold text-text">{label}</h2>
              <p className="mt-1 text-sm text-text-mid">{desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
