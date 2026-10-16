'use client';

import { useState } from 'react';
import { formatPercent } from '@/shared/lib/locale';
import { Panel, Row, Toggle } from './components';

/** Sons (MVP local): som ao receber mensagem + volume. Preferência client-side. */
export default function SoundsSection(): React.JSX.Element {
  const [enabled, setEnabled] = useState(true);
  const [volume, setVolume] = useState(70);

  return (
    <Panel
      title="Som de mensagens"
      description="Preferência local deste dispositivo."
      body="rows"
    >
      <Row title="Som de mensagem nova" description="Toca um som ao chegar mensagem.">
        <Toggle checked={enabled} onChange={setEnabled} label="Som de mensagem nova" />
      </Row>
      <Row title="Volume">
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            disabled={!enabled}
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label="Volume"
            aria-valuetext={formatPercent(volume / 100)}
            className="w-40 cursor-pointer accent-brand-text outline-none focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-40"
          />
          <span className="w-10 text-right font-mono text-sm tabular-nums text-text-mid" aria-hidden>
            {formatPercent(volume / 100)}
          </span>
        </div>
      </Row>
    </Panel>
  );
}
