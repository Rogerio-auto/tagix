import { Badge, StatusPill } from './Badge';
import { ThemePair } from '../lib/ThemePair';

export const Tones = () => (
  <div className="flex flex-wrap gap-2">
    <StatusPill tone="brand" live>
      Ao vivo
    </StatusPill>
    <StatusPill>Rascunho</StatusPill>
    <StatusPill tone="info">Agendado</StatusPill>
    <StatusPill tone="warning">Revisão</StatusPill>
    <StatusPill tone="danger">Bloqueado</StatusPill>
    <StatusPill tone="success">Entregue</StatusPill>
    <StatusPill tone="violet">IA</StatusPill>
  </div>
);

export const Sizes = () => (
  <div className="flex items-center gap-2">
    <Badge size="sm" tone="info">
      Pequeno
    </Badge>
    <Badge size="md" tone="info">
      Médio
    </Badge>
  </div>
);

export const LiveSignalPulse = () => (
  <div className="flex items-center gap-3">
    <Badge tone="brand" live>
      Conectado
    </Badge>
    <span className="text-sm text-text-mid">
      O pulso existe só em estado vivo e para sob prefers-reduced-motion.
    </span>
  </div>
);

export const BothThemes = () => (
  <ThemePair>
    <div className="flex flex-wrap gap-2">
      <StatusPill tone="brand" live>
        Ao vivo
      </StatusPill>
      <StatusPill>Rascunho</StatusPill>
      <StatusPill tone="info">Agendado</StatusPill>
      <StatusPill tone="warning">Revisão</StatusPill>
      <StatusPill tone="danger">Bloqueado</StatusPill>
      <StatusPill tone="success">Entregue</StatusPill>
      <StatusPill tone="violet">IA</StatusPill>
      <Badge size="sm">Sem ponto</Badge>
    </div>
  </ThemePair>
);
