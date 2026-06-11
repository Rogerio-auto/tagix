'use client';

import { useState } from 'react';
import { Row, Toggle } from './components';

/** Sons (MVP local): som ao receber mensagem + volume. Preferência client-side. */
export default function SoundsSection(): React.JSX.Element {
  const [enabled, setEnabled] = useState(true);
  const [volume, setVolume] = useState(70);

  return (
    <div className="flex max-w-md flex-col gap-2">
      <Row title="Som de mensagem nova" description="Toca um som ao chegar mensagem.">
        <Toggle checked={enabled} onChange={setEnabled} label="Som de mensagem nova" />
      </Row>
      <Row title="Volume">
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          disabled={!enabled}
          onChange={(e) => setVolume(Number(e.target.value))}
          aria-label="Volume"
          className="w-40 accent-brand disabled:opacity-50"
        />
      </Row>
      <p className="pt-2 text-xs text-text-low">
        Preferência local deste dispositivo (MVP).
      </p>
    </div>
  );
}
