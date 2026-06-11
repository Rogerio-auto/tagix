'use client';

import { useState } from 'react';
import { Button, Input, useToast } from '@hm/ui';
import { ApiError } from '@/shared/lib/api-client';
import { FieldLabel } from './components';
import { useChangePassword } from './queries';

/** Senha: troca com re-auth (senha atual). Provider sem suporte → aviso honesto. */
export default function PasswordSection(): React.JSX.Element {
  const { toast } = useToast();
  const change = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

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
    <div className="flex max-w-md flex-col gap-4">
      <FieldLabel label="Senha atual">
        <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
      </FieldLabel>
      <FieldLabel label="Nova senha">
        <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
      </FieldLabel>
      <FieldLabel label="Confirmar nova senha">
        <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </FieldLabel>
      <div>
        <Button variant="primary" disabled={!ready || change.isPending} onClick={() => void submit()}>
          {change.isPending ? 'Trocando…' : 'Trocar senha'}
        </Button>
      </div>
    </div>
  );
}
