import { useState } from 'react';
import { Switch } from './Switch';
import { ThemePair } from '../lib/ThemePair';

export const Default = () => (
  <div className="flex flex-col gap-4">
    <Switch label="Agente ativo" description="Responde sozinho fora do horário." defaultChecked />
    <Switch label="Notificações por e-mail" />
  </div>
);

export const States = () => (
  <div className="flex flex-col gap-4">
    <Switch label="Desligado" />
    <Switch label="Ligado" defaultChecked />
    <Switch label="Desabilitado" disabled />
    <Switch label="Desabilitado ligado" disabled defaultChecked />
    <Switch label="Salvando" loading defaultChecked />
  </div>
);

/** Feedback imediato + confirmação assíncrona (UX §2.7). */
export const AsyncToggle = () => {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Switch
      label="Sincronizar com o CRM"
      description={busy ? 'Salvando…' : 'A mudança é salva ao alternar.'}
      checked={on}
      loading={busy}
      onCheckedChange={(next) => {
        setBusy(true);
        setOn(next);
        window.setTimeout(() => setBusy(false), 900);
      }}
    />
  );
};

export const BothThemes = () => (
  <ThemePair>
    <div className="flex flex-col gap-4">
      <Switch label="Ligado" defaultChecked />
      <Switch label="Desligado" />
      <Switch label="Desabilitado" disabled />
      <Switch label="Salvando" loading defaultChecked />
      <Switch aria-label="Sem rótulo visível" defaultChecked />
    </div>
  </ThemePair>
);
