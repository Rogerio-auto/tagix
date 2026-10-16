import { ShieldHalf } from 'lucide-react';

/**
 * Selo do painel de plataforma: o bloco monocromático da marca com o escudo do modo
 * super-admin. Nada de verde: a marca cheia fica para o CTA da tela (DS 3.0).
 */
export function PlatformMark() {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-sm bg-text text-bg"
      >
        <ShieldHalf className="size-4.5" strokeWidth={2.25} />
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate font-head text-[0.9375rem] font-semibold tracking-[-0.02em] text-text">
          Plataforma
        </span>
        <span className="font-mono text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-warn">
          Super-admin
        </span>
      </span>
    </span>
  );
}
