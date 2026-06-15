'use client';

// Inspector 'input' (F31-S09). Pergunta ao contato, valida a resposta pelo tipo, refaz a
// pergunta ate `maxRetries` e roteia por `response`/`timeout`. A resposta validada fica em
// `{{input.<variable>}}`.
import { useRef } from 'react';
import { useFlowEditor } from '../../hooks/useFlowEditor';
import { VariablesPicker } from '../../inspector/VariablesPicker';
import { Field, NumberField, SelectField, TextField } from '../inspector-fields';

const VALIDATION_OPTIONS = [
  { value: 'text', label: 'Texto livre' },
  { value: 'email', label: 'E-mail' },
  { value: 'phone', label: 'Telefone' },
  { value: 'number', label: 'Número' },
  { value: 'date', label: 'Data' },
];

/** Textarea com inserção de variáveis no cursor. */
function VarTextArea({
  label,
  value,
  placeholder,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  hint?: string;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (token: string) => {
    const el = ref.current;
    if (!el) {
      onChange(value + token);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-low">{label}</span>
        <VariablesPicker onPick={insert} />
      </div>
      <textarea
        ref={ref}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[80px] rounded-md border border-border-2 bg-surface-2 px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
      />
      {hint && <span className="text-[11px] text-text-low">{hint}</span>}
    </div>
  );
}

export function InputInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);

  if (!node) return null;
  const d = (node.data ?? {}) as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => update(nodeId, patch);

  const prompt = (d['prompt'] as string) ?? '';
  const variable = (d['variable'] as string) ?? '';
  const validationType = (d['validationType'] as string) ?? 'text';
  const retryMessage = (d['retryMessage'] as string) ?? '';
  const maxRetries = d['maxRetries'] as number | undefined;
  const timeoutSeconds = d['timeoutSeconds'] as number | undefined;

  const trimmedVar = variable.trim();

  return (
    <div className="flex flex-col gap-4">
      <VarTextArea
        label="Pergunta"
        value={prompt}
        placeholder="Qual é o seu e-mail, {{contact.name}}?"
        hint="Enviada ao contato antes de aguardar a resposta."
        onChange={(v) => set({ prompt: v })}
      />

      {prompt.trim().length > 0 && (
        <Field label="Pré-visualização">
          <div className="max-w-[85%] self-start rounded-lg rounded-bl-sm border border-border-2 bg-surface-2 px-3 py-2 text-sm text-text">
            {prompt}
          </div>
        </Field>
      )}

      <SelectField
        label="Tipo de validação"
        value={validationType}
        options={VALIDATION_OPTIONS}
        hint="A resposta é validada e normalizada por esse tipo."
        onChange={(v) => set({ validationType: v })}
      />

      <TextField
        label="Salvar resposta em"
        value={variable}
        placeholder="ex.: email_cliente"
        hint="Sem espaços. Usada a jusante como {{input.nome}}."
        onChange={(v) => set({ variable: v })}
      />

      <Field label="Disponível a jusante como">
        <code className="rounded-sm border border-border-2 bg-surface-2 px-2 py-1.5 font-mono text-[12px] text-text-mid">
          {trimmedVar ? `{{input.${trimmedVar}}}` : '{{input.…}}'}
        </code>
      </Field>

      <div className="flex flex-col gap-4 border-t border-border-2 pt-4">
        <VarTextArea
          label="Mensagem de retry (opcional)"
          value={retryMessage}
          placeholder="Não entendi. Pode repetir?"
          hint="Reenviada quando a resposta não passa na validação. Padrão: a própria pergunta."
          onChange={(v) => set({ retryMessage: v })}
        />

        <NumberField
          label="Máximo de tentativas"
          value={maxRetries}
          hint="Tentativas extras antes de seguir por “timeout”. Padrão 2."
          onChange={(v) => set({ maxRetries: v })}
        />

        <NumberField
          label="Timeout (segundos)"
          value={timeoutSeconds}
          hint="Tempo de espera por resposta. Padrão 300. Edges: response / timeout."
          onChange={(v) => set({ timeoutSeconds: v })}
        />
      </div>
    </div>
  );
}
