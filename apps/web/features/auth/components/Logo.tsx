import { cn } from '@/shared/lib/cn';

/**
 * Logotipo da Leadium (DS 3.0, ADR-002): a marca vive no SVG, não numa família de
 * fonte (a Orbitron saiu). O símbolo é monocromático — bloco em `text`, traço e nó em
 * `bg` — para inverter sozinho nos dois temas e deixar o verde da marca para o único
 * CTA da tela (DESIGN_SYSTEM: `--brand` no máximo 1× por tela).
 *
 * O "L" desenha o caminho de um contato até o negócio; o nó é a conversa que o inicia.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden
      focusable="false"
      className={cn('size-8 shrink-0', className)}
    >
      <rect width="32" height="32" rx="9" className="fill-text" />
      <path
        d="M11.25 8.75v12a3 3 0 0 0 3 3h8.5"
        fill="none"
        strokeWidth="3.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-bg"
      />
      <circle cx="21.75" cy="10.25" r="2.6" className="fill-bg" />
    </svg>
  );
}

/** Símbolo + nome. O nome é texto (lido pelo leitor de tela); o símbolo é decorativo. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="font-head text-xl font-semibold tracking-[-0.035em] text-text">Leadium</span>
    </span>
  );
}
