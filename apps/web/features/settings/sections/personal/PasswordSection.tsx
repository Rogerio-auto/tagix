'use client';

import { useState } from 'react';
import { Button, Input, useToast } from '@hm/ui';
import { ApiError } from '@/shared/lib/api-client';
import { Panel } from './components';
import { useChangePassword } from './queries';

/**
 * Senha: troca com re-auth (senha atual). Provider sem suporte → aviso honesto.
 * Segurança da PRÓPRIA conta: liberada mesmo com a empresa em só leitura (o servidor
 * isenta `POST /api/members/me/password`).
 */
export default function PasswordSection(): React.JSX.Element {
  const { toast } = useToast();
  const change = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = confirm.length > 0 && next !== confirm;

  const submit = async () => {
    if (next.length < 8) {
      toast({ variant: 'error', title: 'A nova senha precisa ter ao menos 8 caracteres.' });
      return;
    }
    if (next !== confirm) {
      toast({ variant: 'error', title: 'As senhas não conferem.' });
      return;
    }
    try {
      await change.mutateAsync({ currentPassword: current, newPassword: next });
      toast({ variant: 'success', title: 'Senha alterada.' });
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 501) {
        toast({
          variant: 'error',
          title: 'Troca de senha indisponível neste provedor de autenticação.',
        });
        return;
      }
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao trocar senha.' });
    }
  };

  const ready = current.length > 0 && next.length > 0 && confirm.length > 0;

  return (
    <Panel
      title="Trocar senha"
      description="Pedimos a senha atual para confirmar que é você."
      footer={
        <Button variant="primary" disabled={!ready} loading={change.isPending} onClick={() => void submit()}>
          Trocar senha
        </Button>
      }
    >
      <form
        className="flex flex-col gap-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) void submit();
        }}
      >
        <Input
          label="Senha atual"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
        />
        <Input
          label="Nova senha"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          hint={tooShort ? undefined : 'Pelo menos 8 caracteres.'}
          error={tooShort ? 'Use pelo menos 8 caracteres.' : undefined}
        />
        <Input
          label="Confirmar nova senha"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          error={mismatch ? 'As senhas não conferem.' : undefined}
        />
        {/* Enter envia: o botão do rodapé fica fora do <form>. */}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden>
          Trocar senha
        </button>
      </form>
    </Panel>
  );
}
