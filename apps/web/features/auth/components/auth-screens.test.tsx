/**
 * O vitest do @hm/web roda em `node` (sem DOM): estes testes renderizam o HTML inicial
 * de cada tela (`renderToStaticMarkup`) e verificam copy, rótulos e estado desabilitado.
 * A interação (digitar, clicar, contagem em tempo real) é coberta pelo Playwright
 * (`apps/web/e2e/specs/auth.spec.ts`).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import type { ReactElement } from 'react';
import { ToastProvider } from '@hm/ui';
import { describe, expect, it, vi } from 'vitest';

// O esbuild do vitest compila JSX no runtime clássico (tsconfig `jsx: preserve`, e a
// config do vitest está fora deste slot): os componentes procuram `React` no escopo global.
Object.assign(globalThis, { React });

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

import { ResendVerification } from './ResendVerification';
import { SignupForm } from './SignupForm';
import { UnverifiedPanel, LoginForm } from './LoginForm';
import { ExpiredLinkRecovery, VerifiedSuccess } from './VerifyEmail';

function render(node: ReactElement): string {
  const client = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

describe('ResendVerification', () => {
  it('livre: botão "Reenviar email" (desabilitado até o captcha resolver)', () => {
    const html = render(<ResendVerification email="ana@empresa.com" />);
    expect(html).toContain('Reenviar email');
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it('com a contagem rodando mostra os segundos e bloqueia', () => {
    const html = render(<ResendVerification email="ana@empresa.com" initialCooldownSeconds={60} />);
    expect(html).toContain('Reenviar em 60 s');
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it('email inválido mantém o botão bloqueado', () => {
    const html = render(<ResendVerification email="nao-e-email" />);
    expect(html).toMatch(/<button[^>]*disabled/);
  });
});

describe('Login de não confirmado', () => {
  it('mostra a mensagem e "Reenviar confirmação" inline', () => {
    const html = render(<UnverifiedPanel email="ana@empresa.com" />);
    expect(html).toContain('Confirme seu email para entrar.');
    expect(html).toContain('Reenviar confirmação');
  });

  it('mostra o aviso do convite (o pré-preenchimento do campo é checado no e2e)', () => {
    const html = render(<LoginForm initialEmail="ana@empresa.com" notice="invite" />);
    expect(html).toContain('Conta criada. Entre com sua senha.');
  });
});

describe('Verify com link expirado', () => {
  it('oferece campo de email e reenvio em vez de beco', () => {
    const html = render(<ExpiredLinkRecovery />);
    expect(html).toContain('Link inválido ou expirado');
    expect(html).toContain('Email da sua conta');
    expect(html).toContain('Reenviar email');
    expect(html).toContain('href="/login"');
  });

  it('sem token explica que o link está incompleto', () => {
    expect(render(<ExpiredLinkRecovery missing />)).toContain('Link incompleto');
  });

  it('sucesso leva ao login com o email', () => {
    const html = render(<VerifiedSuccess email="ana@empresa.com" />);
    expect(html).toContain('Email confirmado');
    expect(html).toContain('/login?email=ana%40empresa.com&amp;from=verify');
  });
});

describe('Signup', () => {
  it('traz a caixa de aceite com links para os Termos e a Privacidade', () => {
    const html = render(<SignupForm />);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('Li e aceito os');
    expect(html).toContain('href="/termos"');
    expect(html).toContain('href="/privacidade"');
  });
});

describe('Título acompanha o estado (F72-S08, ressalva da F71-S09)', () => {
  const h1 = (html: string): string | undefined => /<h1[^>]*>([^<]*)<\/h1>/.exec(html)?.[1];

  it('cadastro abre com "Criar conta"', () => {
    expect(h1(render(<SignupForm />))).toBe('Criar conta');
  });

  it('link expirado e link incompleto viram o H1 da verificação', () => {
    expect(h1(render(<ExpiredLinkRecovery />))).toBe('Link inválido ou expirado');
    expect(h1(render(<ExpiredLinkRecovery missing />))).toBe('Link incompleto');
  });

  it('sucesso: H1 "Email confirmado" com foco programático (tabindex -1)', () => {
    const html = render(<VerifiedSuccess email="ana@empresa.com" />);
    expect(h1(html)).toBe('Email confirmado');
    expect(html).toMatch(/<h1[^>]*tabindex="-1"/);
  });
});
