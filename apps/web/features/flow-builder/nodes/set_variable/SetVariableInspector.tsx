'use client';

// Inspector stub 'set_variable' (F31-S08 espinha). S09 preenche a UI rica.
import { useFlowEditor } from '../../hooks/useFlowEditor';

export function SetVariableInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-low">Configuracao disponivel em breve.</p>
    </div>
  );
}
