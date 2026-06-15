'use client';

// Inspector stub 'register_conversion' (F31-S08 espinha). S09/S10/S11 preenchem a UI rica.
import { useFlowEditor } from '../../hooks/useFlowEditor';

export function RegisterConversionInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-low">Configuracao disponivel em breve.</p>
    </div>
  );
}
