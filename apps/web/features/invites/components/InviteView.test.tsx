/**
 * F71-S07 — tela do convite: um teste por estado. O vitest do @hm/web roda em `node`
 * (sem DOM): renderizamos HTML estático do componente apresentacional.
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InviteView, type InviteViewProps, type PageState, type Stage } from './InviteView';
import type { InvitePreview } from '../types';

Reflect.set(globalThis, 'React', React);

const preview: InvitePreview = {
  workspaceName: 'Acme Ltda',
  inviterName: 'Ana Souza',
  role: 'AGENT',
  emailMasked: 'b***@acme.com',
  requiresEmailProof: false,
  expiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
};

function render(state: PageState, over: Partial<InviteViewProps> = {}): string {
  return renderToStaticMarkup(
    <InviteView
      state={state}
      loginHref="/login?next=%2Fconvite%2Ftok"
      busy={false}
      error={null}
      cooldown={0}
      onAccept={vi.fn()}
      onCreate={vi.fn()}
      onSendProof={vi.fn()}
      onLogout={vi.fn()}
      onRetry={vi.fn()}
      {...over}
    />,
  );
}

const ready = (stage: Stage): PageState => ({ kind: 'ready', preview, stage });

describe('InviteView', () => {
  it('cabeçalho: quem convidou, a empresa e o papel em português', () => {
    const html = render(ready({ kind: 'accept', sessionEmail: 'bia@acme.com' }));
    expect(html).toContain('Acme Ltda');
    expect(html).toContain('Ana Souza');
    expect(html).toContain('Atendente');
    expect(html).toContain('b***@acme.com');
    expect(html).toContain('<h1');
  });

  it('(a) conta com senha, logado: botão "Entrar na Empresa"', () => {
    const html = render(ready({ kind: 'accept', sessionEmail: 'bia@acme.com' }));
    expect(html).toContain('Entrar na Acme Ltda');
    expect(html).toContain('bia@acme.com');
  });

  it('(a) botão em loading fica bloqueado (UX 2.7)', () => {
    const html = render(ready({ kind: 'accept', sessionEmail: null }), { busy: true });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled');
  });

  it('(b) deslogado: "Entre para aceitar" volta ao convite pelo next', () => {
    const html = render(ready({ kind: 'login' }));
    expect(html).toContain('Entre para aceitar');
    expect(html).toContain('href="/login?next=%2Fconvite%2Ftok"');
  });

  it('(c) outra conta: explica e oferece sair', () => {
    const html = render(ready({ kind: 'wrong-account', sessionEmail: 'outra@x.com' }));
    expect(html).toContain('Este convite é para outra conta');
    expect(html).toContain('outra@x.com');
    expect(html).toContain('Sair e entrar com outra conta');
  });

  it('(d) prova válida: formulário de nome + senha com medidor', () => {
    const html = render(ready({ kind: 'create-password' }));
    expect(html).toContain('Seu nome');
    expect(html).toContain('Crie uma senha');
    expect(html).toContain('type="password"');
    expect(html).toMatch(/autocomplete="new-password"/i);
    expect(html).toContain('Use letras e números, mín. 10 caracteres.');
    expect(html).toContain('Criar conta e entrar');
  });

  it('(e) sem fragmento: pede para enviar o email de confirmação', () => {
    const html = render(ready({ kind: 'send-proof' }));
    expect(html).toContain('Receber email de confirmação');
    expect(html).toContain('Confirme que o email é seu');
  });

  it('(e) cooldown: botão desabilitado com a contagem', () => {
    const html = render(ready({ kind: 'send-proof' }), { cooldown: 42 });
    expect(html).toContain('Enviar de novo em 42s');
    expect(html).toContain('disabled');
  });

  it('(e) email enviado: orienta a abrir o link do email', () => {
    const html = render(ready({ kind: 'proof-sent', emailMasked: 'b***@acme.com' }), { cooldown: 10 });
    expect(html).toContain('Email enviado');
    expect(html).toContain('Aceitar convite');
    expect(html).toContain('Não chegou? Reenviar em 10s');
  });

  it('conta criada: aviso e CTA para o login', () => {
    const html = render(ready({ kind: 'created', next: '/login?email=bia%40acme.com&from=invite' }));
    expect(html).toContain('Conta criada');
    expect(html).toContain('Entre com a sua senha para abrir a');
    expect(html).toContain('href="/login?email=bia%40acme.com&amp;from=invite"');
  });

  it('erro de ação aparece em 3 partes com role=alert', () => {
    const html = render(ready({ kind: 'accept', sessionEmail: null }), {
      error: { title: 'Não foi possível entrar', description: 'Fale com quem convidou.' },
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Não foi possível entrar');
    expect(html).toContain('Fale com quem convidou.');
  });

  it('(f) inválido/expirado: estado claro, sem detalhar o motivo', () => {
    const html = render({ kind: 'invalid' });
    expect(html).toContain('Este convite não está mais disponível');
    expect(html).toContain('Peça um novo convite a quem convidou você');
    expect(html).not.toMatch(/expirou|revogado|já foi aceito/i);
  });

  it('carregando: esqueleto anunciado', () => {
    const html = render({ kind: 'loading' });
    expect(html).toContain('role="status"');
    expect(html).toContain('Carregando convite');
  });

  it('serviço indisponível: erro com "Tentar de novo"', () => {
    const html = render({ kind: 'unavailable' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Tentar de novo');
  });

  it('não usa cor fixa (só tokens do DS v2)', () => {
    for (const s of [
      ready({ kind: 'accept', sessionEmail: null }),
      ready({ kind: 'create-password' }),
      { kind: 'invalid' } as PageState,
    ]) {
      expect(render(s)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
