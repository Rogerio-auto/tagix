'use client';

import { useState } from 'react';
import { Button, useToast } from '@hm/ui';
import { Row, Toggle } from './components';
import { useUpdateMe } from './queries';

/** Notificações: toggles in-app/email/push (MVP — persiste em notification_prefs). */
export default function NotificationsSection(): React.JSX.Element {
  const { toast } = useToast();
  const update = useUpdateMe();
  const [prefs, setPrefs] = useState({ in_app: true, email: true, push: false });
  const [dirty, setDirty] = useState(false);

  const set = (k: keyof typeof prefs, v: boolean) => {
    setPrefs((p) => ({ ...p, [k]: v }));
    setDirty(true);
  };

  const save = async () => {
    try {
      await update.mutateAsync({ notificationPrefs: prefs });
      setDirty(false);
      toast({ variant: 'success', title: 'Notificações salvas.' });
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao salvar.' });
    }
  };

  return (
    <div className="flex max-w-md flex-col gap-2">
      <Row title="No app" description="Alertas dentro da plataforma.">
        <Toggle checked={prefs.in_app} onChange={(v) => set('in_app', v)} label="Notificações no app" />
      </Row>
      <Row title="E-mail" description="Resumos e alertas por e-mail.">
        <Toggle checked={prefs.email} onChange={(v) => set('email', v)} label="Notificações por e-mail" />
      </Row>
      <Row title="Push" description="Notificações push no navegador.">
        <Toggle checked={prefs.push} onChange={(v) => set('push', v)} label="Notificações push" />
      </Row>
      <div className="pt-2">
        <Button variant="primary" disabled={!dirty || update.isPending} onClick={() => void save()}>
          {update.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </div>
  );
}
