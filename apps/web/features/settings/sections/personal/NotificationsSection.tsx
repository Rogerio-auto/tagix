'use client';

import { useEffect, useState } from 'react';
import { Button, useToast } from '@hm/ui';
import { Row, Toggle } from './components';
import { useUpdateMe, type NotificationSoundPrefs } from './queries';
import { DEFAULT_SOUND_PREFS, useNotificationsStore } from '@/features/notifications';
import { playChime } from '@/features/notifications/sound';

/**
 * Notificações: toggles in-app/email/push + preferências de SOM da central
 * (F53-S06). As prefs de som têm a FONTE DA VERDADE no servidor — persistem em
 * `notificationPrefs.sound` via `useUpdateMe` (mesmo padrão dos demais campos) e
 * espelham no store da central para o áudio responder sem round-trip.
 */
export default function NotificationsSection(): React.JSX.Element {
  const { toast } = useToast();
  const update = useUpdateMe();

  const hydrate = useNotificationsStore((s) => s.hydrate);
  const storedSound = useNotificationsStore((s) => s.soundPrefs);
  const setStoreSound = useNotificationsStore((s) => s.setSoundPrefs);

  const [prefs, setPrefs] = useState({ in_app: true, email: true, push: false });
  const [sound, setSound] = useState<NotificationSoundPrefs>(DEFAULT_SOUND_PREFS);
  const [dirty, setDirty] = useState(false);

  // Hidrata o espelho de runtime e popula o formulário com o que está salvo.
  useEffect(() => {
    hydrate();
  }, [hydrate]);
  useEffect(() => {
    setSound(storedSound);
  }, [storedSound]);

  const set = (k: keyof typeof prefs, v: boolean) => {
    setPrefs((p) => ({ ...p, [k]: v }));
    setDirty(true);
  };

  const setSoundField = <K extends keyof NotificationSoundPrefs>(k: K, v: NotificationSoundPrefs[K]) => {
    setSound((s) => ({ ...s, [k]: v }));
    setDirty(true);
  };

  const audible = sound.enabled && !sound.visualOnly;

  const save = async () => {
    try {
      await update.mutateAsync({ notificationPrefs: { ...prefs, sound } });
      setStoreSound(sound);
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

      {/* ── Som da central de notificações (F53-S06) ───────────────────────── */}
      <div className="mt-4">
        <h3 className="font-head text-sm font-semibold text-text">Som dos alertas</h3>
        <p className="text-xs text-text-low">Aviso sonoro quando um lembrete de compromisso chega.</p>
      </div>

      <Row title="Tocar som" description="Emite um aviso sonoro ao receber um lembrete.">
        <Toggle
          checked={sound.enabled}
          onChange={(v) => setSoundField('enabled', v)}
          label="Tocar som ao notificar"
        />
      </Row>

      <Row title="Apenas visual" description="Mostra a notificação sem tocar áudio.">
        <Toggle
          checked={sound.visualOnly}
          onChange={(v) => setSoundField('visualOnly', v)}
          label="Apenas visual (sem áudio)"
        />
      </Row>

      <Row
        title="Volume"
        description="Intensidade do aviso sonoro."
      >
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(sound.volume * 100)}
            disabled={!audible}
            onChange={(e) => setSoundField('volume', Number(e.target.value) / 100)}
            aria-label="Volume do som das notificações"
            className="h-1.5 w-32 cursor-pointer appearance-none rounded-pill bg-surface-3 accent-brand disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => playChime(sound.volume)}
            disabled={!audible}
            className="touch-target rounded-sm px-2 text-xs font-medium text-text-mid outline-none transition-colors hover:bg-surface-2 hover:text-text focus-visible:shadow-glow-md disabled:opacity-50"
          >
            Testar
          </button>
        </div>
      </Row>

      <Row
        title="Repetir até confirmar"
        description="Reemite o som em intervalos até você descartar ou concluir."
      >
        <Toggle
          checked={sound.repeatUntilConfirmed}
          onChange={(v) => setSoundField('repeatUntilConfirmed', v)}
          label="Repetir o som até confirmação"
          disabled={!audible}
        />
      </Row>

      <div className="pt-2">
        <Button variant="primary" disabled={!dirty || update.isPending} onClick={() => void save()}>
          {update.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </div>
  );
}
