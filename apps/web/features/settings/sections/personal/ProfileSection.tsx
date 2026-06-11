'use client';

import { useEffect, useState } from 'react';
import { Button, Input, useToast } from '@hm/ui';
import { FieldLabel } from './components';
import { useMe, useUpdateMe } from './queries';

/** Perfil: nome, telefone, avatar. Salvar desabilitado até haver mudança (§5.1). */
export default function ProfileSection(): React.JSX.Element {
  const { toast } = useToast();
  const meQuery = useMe();
  const update = useUpdateMe();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [initial, setInitial] = useState({ name: '', phone: '', avatarUrl: '' });

  useEffect(() => {
    const m = meQuery.data?.member;
    if (m) {
      const next = { name: m.name ?? '', phone: '', avatarUrl: '' };
      setName(next.name);
      setPhone(next.phone);
      setAvatarUrl(next.avatarUrl);
      setInitial(next);
    }
  }, [meQuery.data]);

  const dirty = name !== initial.name || phone !== initial.phone || avatarUrl !== initial.avatarUrl;

  const save = async () => {
    try {
      await update.mutateAsync({
        name: name.trim() || null,
        phone: phone.trim() || null,
        avatarUrl: avatarUrl.trim() || null,
      });
      setInitial({ name, phone, avatarUrl });
      toast({ variant: 'success', title: 'Perfil atualizado.' });
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao salvar.' });
    }
  };

  if (meQuery.isLoading) return <p className="text-sm text-text-low">Carregando…</p>;

  return (
    <div className="flex max-w-md flex-col gap-4">
      <FieldLabel label="Nome de exibição">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" />
      </FieldLabel>
      <FieldLabel label="Telefone">
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+55 11 90000-0000" />
      </FieldLabel>
      <FieldLabel label="Avatar (URL)">
        <Input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" />
      </FieldLabel>
      <div>
        <Button variant="primary" disabled={!dirty || update.isPending} onClick={() => void save()}>
          {update.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </div>
  );
}
