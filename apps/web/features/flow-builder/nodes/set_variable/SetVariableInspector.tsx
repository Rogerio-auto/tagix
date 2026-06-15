'use client';

// Inspector 'set_variable' (F31-S09). Define uma variavel da execucao no namespace `vars.*`,
// com valor literal ou referencia a outras variaveis ({{...}}) e tipo de coercao.
import { useRef } from 'react';
import { useFlowEditor } from '../../hooks/useFlowEditor';
import { VariablesPicker } from '../../inspector/VariablesPicker';
import { Field, SelectField, TextField } from '../inspector-fields';

const VALUE_TYPE_OPTIONS = [
  { value: 'string', label: 'Texto' },
  { value: 'number', label: 'Número' },
  { value: 'boolean', label: 'Booleano' },
  { value: 'json', label: 'JSON' },
];

export function SetVariableInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);
  const valueRef = useRef<HTMLTextAreaElement>(null);

  if (!node) return null;
  const d = (node.data ?? {}) as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => update(nodeId, patch);

  const name = (d['name'] as string) ?? '';
  const value = (d['value'] as string) ?? '';
  const valueType = (d['valueType'] as string) ?? 'string';

  // Insere o token no cursor da textarea de valor.
  const insertValue = (token: string) => {
    const el = valueRef.current;
    if (!el) {
      set({ value: value + token });
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    set({ value: value.slice(0, start) + token + value.slice(end) });
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const trimmedName = name.trim();

  return (
    <div className="flex flex-col gap-4">
      <TextField
        label="Nome da variável"
        value={name}
        placeholder="ex.: cidade"
        hint="Sem espaços. Usada a jusante como {{vars.nome}}."
        onChange={(v) => set({ name: v })}
      />

      <SelectField
        label="Tipo do valor"
        value={valueType}
        options={VALUE_TYPE_OPTIONS}
        hint="Define como o valor é convertido ao gravar."
        onChange={(v) => set({ valueType: v })}
      />

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-text-low">Valor</span>
          <VariablesPicker onPick={insertValue} />
        </div>
        <textarea
          ref={valueRef}
          value={value}
          placeholder={
            valueType === 'json'
              ? '{ "chave": "valor" }'
              : valueType === 'boolean'
                ? 'true'
                : 'Valor ou {{contact.name}}'
          }
          onChange={(e) => set({ value: e.target.value })}
          className="min-h-[80px] rounded-md border border-border-2 bg-surface-2 px-3 py-2 font-mono text-sm text-text focus:border-accent focus:outline-none"
        />
        <span className="text-[11px] text-text-low">
          Pode referenciar outras variáveis com {'{{...}}'}.
        </span>
      </div>

      <Field label="Disponível a jusante como">
        <code className="rounded-sm border border-border-2 bg-surface-2 px-2 py-1.5 font-mono text-[12px] text-text-mid">
          {trimmedName ? `{{vars.${trimmedName}}}` : '{{vars.…}}'}
        </code>
      </Field>
    </div>
  );
}
