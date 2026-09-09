'use client';

/**
 * Interruptor de avisos no aparelho (F61-S03).
 *
 * Vive na tela Hoje, logo abaixo do convite de instalação, porque a sequência
 * natural é essa: instalar → ligar aviso. E porque é aqui que a promessa faz
 * sentido — o dono está olhando a fila de quem espera resposta.
 *
 * **O que este componente nunca faz:** pedir permissão sozinho. No iOS, permissão
 * negada é lembrada e só volta pelas configurações do navegador — um pedido
 * automático na abertura gasta a única chance que existe, com o usuário que ainda
 * não entendeu o que ganha.
 */

import type * as React from 'react';
import { Bell, BellOff } from 'lucide-react';
import { usePushNotifications } from './usePushNotifications';

export function PushToggle(): React.JSX.Element | null {
  const { estado, ocupado, ativar, desativar } = usePushNotifications();

  // Sem suporte, sem VAPID, ou ainda não instalado no iOS: o convite de
  // instalação já está na tela dizendo o que fazer. Dois cartões pedindo coisas
  // diferentes ao mesmo tempo é ruído.
  if (estado === 'indisponivel' || estado === 'precisa-instalar') return null;

  if (estado === 'bloqueado') {
    return (
      <section className="rounded-md border border-border bg-surface p-4">
        <p className="flex items-center gap-2 text-small text-text-2">
          <BellOff className="size-4 shrink-0 text-text-3" aria-hidden="true" />
          Os avisos estão bloqueados neste aparelho.
        </p>
        <p className="mt-1 text-small text-text-3">
          Para voltar a ser avisado de lead novo, libere as notificações do Leadium nos ajustes do
          seu navegador.
        </p>
      </section>
    );
  }

  const ativo = estado === 'ativo';

  return (
    <section className="flex items-center gap-3 rounded-md border border-border bg-surface p-4">
      <Bell
        className={`size-5 shrink-0 ${ativo ? 'text-brand' : 'text-text-3'}`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-text">
          {ativo ? 'Avisos ligados' : 'Ser avisado de lead novo'}
        </p>
        <p className="mt-0.5 text-small text-text-2">
          {ativo
            ? 'Você recebe um aviso neste aparelho quando alguém escreve.'
            : 'Quem responde primeiro fecha. O aviso chega no celular.'}
        </p>
      </div>
      <button
        type="button"
        disabled={ocupado}
        onClick={() => void (ativo ? desativar() : ativar())}
        className={`touch-target shrink-0 rounded-md px-4 py-2.5 text-small font-semibold disabled:opacity-50 ${
          ativo
            ? 'border border-border text-text-2 active:bg-surface-2'
            : 'bg-brand text-text-on-brand active:opacity-90'
        }`}
      >
        {ocupado ? '…' : ativo ? 'Desligar' : 'Ligar'}
      </button>
    </section>
  );
}
