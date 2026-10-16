'use client';

import { useEffect, useState } from 'react';
import { Button, Input, useToast } from '@hm/ui';
import { Panel, SaveFooter, SectionLoading } from './components';
import { useMe, useUpdateMe } from './queries';

/**
 * Perfil: nome, telefone, avatar. Salvar desabilitado até haver mudança (§5.1).
 * Preferência PESSOAL: segue liberada com a empresa em só leitura (o servidor isenta
 * `PATCH /api/members/me`), então não leva `ReadOnlyGuard`.
 */
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

  if (meQuery.isLoading) return <SectionLoading label="Carregando perfil" />;

  return (
    <Panel
      title="Como a equipe vê você"
      description="Aparece nas conversas atribuídas, nas menções e no histórico."
      footer={
        <SaveFooter dirty={dirty}>
          <Button variant="primary" disabled={!dirty} loading={update.isPending} onClick={() => void save()}>
            Salvar perfil
          </Button>
        </SaveFooter>
      }
    >
      <Input label="Nome de exibição" value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" autoComplete="name" />
      <Input
        label="Telefone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        className="font-mono"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="+55 11 90000-0000"
      />
      <Input
        label="Avatar (URL)"
        type="url"
        value={avatarUrl}
        onChange={(e) => setAvatarUrl(e.target.value)}
        placeholder="https://…"
      />
    </Panel>
  );
}
