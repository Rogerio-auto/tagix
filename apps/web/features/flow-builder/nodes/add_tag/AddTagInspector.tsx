'use client';

import { DeferredNotice } from '../inspector-fields';

export function AddTagInspector(_props: { nodeId: string }) {
  return (
    <div className="flex flex-col gap-3">
      <DeferredNotice />
      <p className="text-xs text-text-low">
        Configuracao de tags/etapas entra com o dominio Pipeline (F5).
      </p>
    </div>
  );
}
