'use client';

// Inspector 'template' (F31-S10). Configura o envio de um template/HSM aprovado
// (WhatsApp Business): nome, idioma e parametros por componente, interpolaveis.
import { Info, Plus, Trash2 } from 'lucide-react';
import { useFlowEditor } from '../../hooks/useFlowEditor';
import { VariablesPicker } from '../../inspector/VariablesPicker';
import { SelectField, TextField } from '../inspector-fields';

const COMPONENT_OPTIONS = [
  { value: 'body', label: 'Corpo' },
  { value: 'header', label: 'Cabeçalho' },
  { value: 'button', label: 'Botão' },
] as const;

const LANGUAGE_RE = /^[a-z]{2}(_[A-Z]{2})?$/;

interface ParamRow {
  component: string;
  text: string;
}

function readParams(raw: unknown): ParamRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const o = (entry ?? {}) as Record<string, unknown>;
    return {
      component: typeof o['component'] === 'string' ? o['component'] : 'body',
      text: typeof o['text'] === 'string' ? o['text'] : '',
    };
  });
}

export function TemplateInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const d = (node.data ?? {}) as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => update(nodeId, patch);

  const templateName = (d['templateName'] as string) ?? '';
  const languageCode = (d['languageCode'] as string) ?? '';
  const params = readParams(d['params']);

  const setParams = (next: ParamRow[]) => set({ params: next });
  const addParam = () => setParams([...params, { component: 'body', text: '' }]);
  const updateParam = (index: number, patch: Partial<ParamRow>) =>
    setParams(params.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  const removeParam = (index: number) => setParams(params.filter((_, i) => i !== index));

  const nameError = templateName.trim().length === 0 ? 'Informe o nome do template aprovado.' : null;
  const langError =
    languageCode.trim().length === 0
      ? 'Informe o código de idioma do template.'
      : !LANGUAGE_RE.test(languageCode.trim())
        ? 'Código inválido. Use o formato ll ou ll_RR, ex.: pt_BR.'
        : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <TextField
          label="Nome do template"
          value={templateName}
          placeholder="boas_vindas_v2"
          hint="Nome exato do template aprovado na Meta."
          onChange={(v) => set({ templateName: v })}
        />
        {nameError && <span className="text-[11px] text-danger">{nameError}</span>}
      </div>

      <div className="flex flex-col gap-1.5">
        <TextField
          label="Idioma"
          value={languageCode}
          placeholder="pt_BR"
          hint="Código de idioma da versão aprovada do template."
          onChange={(v) => set({ languageCode: v })}
        />
        {langError && <span className="text-[11px] text-danger">{langError}</span>}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-text-low">Parâmetros</span>
          <button
            type="button"
            onClick={addParam}
            className="inline-flex items-center gap-1 rounded-pill border border-border-2 bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-text-low transition-colors hover:border-accent hover:text-text focus:border-accent focus:shadow-glow-sm focus:outline-none"
          >
            <Plus className="size-3.5" aria-hidden />
            Adicionar
          </button>
        </div>

        {params.length === 0 ? (
          <p className="text-[11px] text-text-low">
            Nenhum parâmetro. Adicione um para preencher as variáveis do template.
          </p>
        ) : (
          params.map((param, index) => (
            <div
              key={index}
              className="flex flex-col gap-2 rounded-md border border-border-2 bg-surface-1 p-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <SelectField
                  label="Componente"
                  value={param.component}
                  options={[...COMPONENT_OPTIONS]}
                  onChange={(v) => updateParam(index, { component: v })}
                />
                <button
                  type="button"
                  onClick={() => removeParam(index)}
                  aria-label="Remover parâmetro"
                  className="mt-5 inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border-2 bg-surface-2 text-text-low transition-colors hover:border-danger hover:text-danger focus:border-danger focus:outline-none"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-text-low">Valor</span>
                  <VariablesPicker
                    onPick={(token) => updateParam(index, { text: `${param.text}${token}` })}
                  />
                </div>
                <input
                  type="text"
                  value={param.text}
                  placeholder="{{contact.name}}"
                  onChange={(e) => updateParam(index, { text: e.target.value })}
                  className="rounded-md border border-border-2 bg-surface-2 px-3 py-2 text-sm text-text focus:border-accent focus:shadow-glow-sm focus:outline-none"
                />
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Templates reabrem a janela de 24h. O envio real depende do bridge de saída ganhar suporte
          a HSM (publisher S01 ainda não traduz templates). A configuração fica salva e válida.
        </span>
      </div>
    </div>
  );
}
