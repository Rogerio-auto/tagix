import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/features/auth/components/Logo';
import { AuthCompanionRoot, CompanionInlineSlot, CompanionPerch } from '@/features/auth/companion';

/**
 * Casca das telas de acesso (login, cadastro, verificação, senha, convite). DS 3.0.
 *
 * Mobile (< lg): uma coluna — logotipo, formulário e rodapé legal. O formulário fica no
 * topo (não no centro geométrico) para sobrar espaço quando o teclado virtual abre, e a
 * lateral é o MAIOR entre o respiro de 20px e a safe-area (`pl-safe` sozinho zerava o
 * respiro fora de notch e colava o campo na borda a 375px).
 *
 * lg+: duas colunas. À esquerda o formulário, centrado na altura; à direita um painel
 * editorial que diz o que o produto faz, em texto. Nenhum dado inventado, nenhuma
 * imagem genérica: tipografia, hairlines e um grid que some para baixo.
 *
 * Companheiro (ADR-006 §9): `AuthCompanionRoot` envolve a raiz e desenha o palco por cima
 * (absoluto, sem tocar o fluxo). Os três postos são só âncoras sem peso no layout: o
 * `perch` dentro do painel (lg+), o `inline` (caixa 40x40 reservada) na linha do logotipo
 * (< lg) e o `heading`, ligado por ref no `AuthHeading`.
 */
/**
 * `no-referrer` em todo o grupo: verificação e redefinição de senha carregam `?token=` na
 * URL, e o web não define `Referrer-Policy` global. Sem isto, qualquer navegação ou
 * subrecurso a partir destas telas levaria o token no `Referer`. As páginas definem o
 * próprio título; o `referrer` herdado daqui não é sobrescrito por nenhuma delas.
 */
export const metadata: Metadata = {
  referrer: 'no-referrer',
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <AuthCompanionRoot>
      <div className="relative flex min-h-dvh w-full bg-bg">
        <div
          className={[
            'flex min-h-dvh w-full min-w-0 flex-col',
            'pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))]',
            'md:px-10 lg:w-[min(50%,44rem)] lg:shrink-0 xl:px-16',
          ].join(' ')}
        >
          <div className="flex items-center pt-safe-4 md:pt-8">
            <Logo />
            <div className="ml-auto lg:hidden">
              <CompanionInlineSlot />
            </div>
          </div>

          <main className="flex flex-1 flex-col justify-start py-10 md:justify-center md:py-16">
            <div className="mx-auto w-full max-w-[25rem] motion-safe:animate-[hm-rise_var(--dur-slow)_var(--ease)_both]">
              {children}
            </div>
          </main>

          <footer className="flex flex-wrap items-center gap-x-1 gap-y-2 pb-safe-4 md:pb-8">
            <nav aria-label="Documentos legais" className="flex items-center gap-1">
              <Link href="/termos" prefetch={false} className={footerLinkClass}>
                Termos
              </Link>
              <span aria-hidden className="text-text-low">
                ·
              </span>
              <Link href="/privacidade" prefetch={false} className={footerLinkClass}>
                Privacidade
              </Link>
            </nav>
          </footer>
        </div>

        <BrandPanel />
      </div>
    </AuthCompanionRoot>
  );
}

const footerLinkClass =
  'touch-target inline-flex items-center rounded-xs px-1.5 font-mono text-xs font-medium uppercase tracking-[0.12em] text-text-low outline-none transition-colors duration-(--dur-fast) ease-ds hover:text-text focus-visible:focus-ring';

const PILLARS = [
  { n: '01', text: 'WhatsApp e Instagram numa só caixa de entrada, com a equipe toda.' },
  { n: '02', text: 'Agentes de IA respondem, qualificam e passam a vez na hora certa.' },
  { n: '03', text: 'Cada contato avança no funil até virar venda, com o motivo registrado.' },
] as const;

/** Painel editorial da direita (lg+). Fora do `<main>`: é contexto, não a tarefa da tela. */
function BrandPanel() {
  return (
    <aside
      aria-label="Sobre a Leadium"
      className="relative hidden min-h-dvh flex-1 overflow-hidden border-l border-border bg-bg-elevated lg:flex"
    >
      <CompanionPerch />
      {/* Grid de hairlines (maquete DS 3.0): camada decorativa, some para baixo. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] bg-[length:40px_40px] opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent_75%)]"
      />
      {/* Luz da marca no canto: só atmosfera, sem texto por cima. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 -top-40 size-[36rem] rounded-full bg-[radial-gradient(closest-side,var(--brand-faint),transparent)] opacity-40"
      />

      <div className="relative flex w-full flex-col justify-between gap-16 p-12 xl:p-16">
        <p className="flex items-center gap-2.5 font-mono text-xs font-medium uppercase tracking-[0.14em] text-text-low">
          <span aria-hidden className="h-px w-5 bg-brand-text" />
          Atendimento · Vendas · Automação
        </p>

        <div className="flex max-w-[34rem] flex-col gap-10">
          <p className="font-head text-h2 text-balance text-text xl:text-h1">
            Toda conversa vira o próximo passo.
          </p>
          <ol className="flex flex-col border-t border-border">
            {PILLARS.map((p) => (
              <li key={p.n} className="flex gap-5 border-b border-border py-4">
                <span className="pt-0.5 font-mono text-xs font-medium tabular-nums text-text-low">
                  {p.n}
                </span>
                <span className="font-body text-body text-text-mid">{p.text}</span>
              </li>
            ))}
          </ol>
        </div>

        <p className="font-mono text-xs text-text-low">
          Leadium · plataforma de conversas que vendem
        </p>
      </div>
    </aside>
  );
}
