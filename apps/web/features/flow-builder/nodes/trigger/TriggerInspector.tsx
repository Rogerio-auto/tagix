'use client';

import { useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { AlertTriangle, Info, X } from 'lucide-react';
import {
  Combobox,
  MetaFlowPicker,
  PipelinePicker,
  StagePicker,
  TagPicker,
} from '@/features/flow-builder/inspector/pickers';
import { cn } from '@/shared/lib/cn';
import { useFlowEditor } from '../../hooks/useFlowEditor';
import { Field, SelectField } from '../inspector-fields';
import {
  DEFAULT_MATCH_MODE,
  MATCH_MODE_OPTIONS,
  MESSAGE_TYPE_OPTIONS,
  readString,
  readStringArray,
  readTriggerConfig,
  readTriggerType,
  SOURCE_OPTIONS,
  SYSTEM_EVENT_OPTIONS,
  TRIGGER_TYPE_OPTIONS,
  type TriggerType,
  validateTriggerConfig,
} from './config';

type ConfigSetter = (patch: Record<string, unknown>) => void;

/**
 * Inspector do node `trigger` (F31-S07). Permite (a) trocar o TIPO de gatilho apos a
 * criacao e (b) configurar o `trigger_config` dos 8 tipos com pickers pesquisaveis
 * (sem id cru). O estado vive em `node.data.{triggerType,triggerConfig}`; a integracao
 * sincroniza esses campos com as colunas `flows.triggerType/triggerConfig` no save
 * (ver seam no relato do slot).
 */
export function TriggerInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const data = (node.data ?? {}) as Record<string, unknown>;
  const triggerType = readTriggerType(data);
  const config = readTriggerConfig(data);

  // Trocar de tipo limpa a config (as chaves diferem por tipo — evita dados orfaos).
  const setType = (value: string) => update(nodeId, { triggerType: value, triggerConfig: {} });
  const setConfig: ConfigSetter = (patch) =>
    update(nodeId, { triggerConfig: { ...config, ...patch } });

  const description =
    TRIGGER_TYPE_OPTIONS.find((o) => o.value === triggerType)?.description ?? '';
  const warning = validateTriggerConfig(triggerType, config);

  return (
    <div className="flex flex-col gap-4">
      <SelectField
        label="Tipo de gatilho"
        value={triggerType}
        hint={description}
        options={TRIGGER_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        onChange={setType}
      />

      <div className="flex flex-col gap-3 border-t border-border-2 pt-3">
        <TriggerConfigFields type={triggerType} config={config} setConfig={setConfig} />
      </div>

      {warning ? (
        <p className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{warning}</span>
        </p>
      ) : (
        <p className="flex items-start gap-2 text-[11px] text-text-low">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>O gatilho entra em vigor depois de salvar e publicar o flow.</span>
        </p>
      )}
    </div>
  );
}

/** Roteia para o formulario de config do tipo selecionado. */
function TriggerConfigFields({
  type,
  config,
  setConfig,
}: {
  type: TriggerType;
  config: Record<string, unknown>;
  setConfig: ConfigSetter;
}) {
  switch (type) {
    case 'keyword':
      return <KeywordConfig config={config} setConfig={setConfig} />;
    case 'new_message':
      return <NewMessageConfig config={config} setConfig={setConfig} />;
    case 'new_lead':
      return <NewLeadConfig config={config} setConfig={setConfig} />;
    case 'stage_change':
      return <StageChangeConfig config={config} setConfig={setConfig} />;
    case 'tag_added':
      return <TagAddedConfig config={config} setConfig={setConfig} />;
    case 'system_event':
      return <SystemEventConfig config={config} setConfig={setConfig} />;
    case 'flow_submission':
      return <FlowSubmissionConfig config={config} setConfig={setConfig} />;
    case 'manual':
    default:
      return (
        <p className="text-xs text-text-low">
          Sem configuracao. Acione o flow pelo botao na conversa quando ele estiver ativo.
        </p>
      );
  }
}

// ── keyword ───────────────────────────────────────────────────────────────────

function KeywordConfig({
  config,
  setConfig,
}: {
  config: Record<string, unknown>;
  setConfig: ConfigSetter;
}) {
  const keywords = readStringArray(config, 'keywords');
  const matchMode = readString(config, 'match_mode') || DEFAULT_MATCH_MODE;
  const [draft, setDraft] = useState('');

  // Espelha `keyword` (1ª palavra) para compat com o dispatcher inbound atual.
  const commit = (next: string[]) => setConfig({ keywords: next, keyword: next[0] ?? '' });

  const add = () => {
    const value = draft.trim();
    if (!value) return;
    if (keywords.some((k) => k.toLowerCase() === value.toLowerCase())) {
      setDraft('');
      return;
    }
    commit([...keywords, value]);
    setDraft('');
  };

  const remove = (keyword: string) => commit(keywords.filter((k) => k !== keyword));

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && draft.length === 0 && keywords.length > 0) {
      remove(keywords[keywords.length - 1] ?? '');
    }
  };

  return (
    <>
      <Field
        label="Palavras-chave"
        hint="Enter ou vírgula adiciona. Casa com a mensagem do contato."
      >
        <div className="flex flex-wrap gap-1.5 rounded-md border border-border-2 bg-surface-2 p-1.5 focus-within:border-accent focus-within:shadow-glow-sm">
          {keywords.map((keyword) => (
            <span
              key={keyword}
              className="inline-flex items-center gap-1 rounded bg-surface-3 py-0.5 pl-2 pr-1 text-xs text-text"
            >
              {keyword}
              <button
                type="button"
                onClick={() => remove(keyword)}
                aria-label={`Remover ${keyword}`}
                className="rounded-sm p-0.5 text-text-low transition-colors hover:text-text focus:text-text focus:outline-none focus:shadow-glow-sm"
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={add}
            placeholder={keywords.length === 0 ? 'Ex.: orçamento, preço' : 'Adicionar…'}
            className="min-w-[7rem] flex-1 bg-transparent px-1 py-0.5 text-sm text-text outline-none placeholder:text-text-low"
          />
        </div>
      </Field>

      <SelectField
        label="Comparação"
        value={matchMode}
        options={[...MATCH_MODE_OPTIONS]}
        hint="Como a palavra-chave é comparada com a mensagem."
        onChange={(v) => setConfig({ match_mode: v })}
      />
    </>
  );
}

// ── new_message ─────────────────────────────────────────────────────────────--

function NewMessageConfig({
  config,
  setConfig,
}: {
  config: Record<string, unknown>;
  setConfig: ConfigSetter;
}) {
  const selected = readStringArray(config, 'message_types');
  const toggle = (value: string) =>
    setConfig({
      message_types: selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    });

  return (
    <Field label="Tipos de mensagem" hint="Vazio = qualquer tipo de mensagem dispara.">
      <div className="flex flex-wrap gap-1.5">
        {MESSAGE_TYPE_OPTIONS.map((option) => (
          <ToggleChip
            key={option.value}
            active={selected.includes(option.value)}
            onClick={() => toggle(option.value)}
          >
            {option.label}
          </ToggleChip>
        ))}
      </div>
    </Field>
  );
}

// ── new_lead ────────────────────────────────────────────────────────────────--

function NewLeadConfig({
  config,
  setConfig,
}: {
  config: Record<string, unknown>;
  setConfig: ConfigSetter;
}) {
  return (
    <SelectField
      label="Origem do contato"
      value={readString(config, 'source')}
      options={[...SOURCE_OPTIONS]}
      hint="Filtra por como o contato chegou (vazio = qualquer)."
      onChange={(v) => setConfig({ source: v })}
    />
  );
}

// ── stage_change ──────────────────────────────────────────────────────────────

function StageChangeConfig({
  config,
  setConfig,
}: {
  config: Record<string, unknown>;
  setConfig: ConfigSetter;
}) {
  const pipelineId = readString(config, 'pipeline_id') || undefined;
  return (
    <>
      <PipelinePicker
        value={pipelineId}
        onChange={(v) => setConfig({ pipeline_id: v, from_stage_id: '', to_stage_id: '' })}
        label="Pipeline (opcional)"
        hint="Filtra as etapas selecionáveis abaixo."
      />
      <StagePicker
        pipelineId={pipelineId}
        value={readString(config, 'from_stage_id') || undefined}
        onChange={(v) => setConfig({ from_stage_id: v })}
        label="Etapa de origem (opcional)"
        hint="Vazio = qualquer etapa de origem."
      />
      <StagePicker
        pipelineId={pipelineId}
        value={readString(config, 'to_stage_id') || undefined}
        onChange={(v) => setConfig({ to_stage_id: v })}
        label="Etapa de destino (opcional)"
        hint="Vazio = qualquer etapa de destino."
      />
    </>
  );
}

// ── tag_added ─────────────────────────────────────────────────────────────────

function TagAddedConfig({
  config,
  setConfig,
}: {
  config: Record<string, unknown>;
  setConfig: ConfigSetter;
}) {
  return (
    <TagPicker
      value={readString(config, 'tag_id') || undefined}
      onChange={(v) => setConfig({ tag_id: v })}
      label="Tag (opcional)"
      hint="Vazio = qualquer tag aplicada dispara o flow."
    />
  );
}

// ── system_event ──────────────────────────────────────────────────────────────

function SystemEventConfig({
  config,
  setConfig,
}: {
  config: Record<string, unknown>;
  setConfig: ConfigSetter;
}) {
  return (
    <Combobox
      value={readString(config, 'event') || undefined}
      onChange={(v) => setConfig({ event: v })}
      options={[...SYSTEM_EVENT_OPTIONS]}
      label="Evento do sistema"
      hint="Selecione um evento conhecido ou digite o nome do evento."
      placeholder="Selecionar evento"
      searchPlaceholder="Buscar ou digitar evento…"
      emptyLabel="Digite o nome do evento"
      allowCustom
    />
  );
}

// ── flow_submission ───────────────────────────────────────────────────────────

function FlowSubmissionConfig({
  config,
  setConfig,
}: {
  config: Record<string, unknown>;
  setConfig: ConfigSetter;
}) {
  return (
    <MetaFlowPicker
      value={readString(config, 'meta_flow_id') || undefined}
      onChange={(v) => setConfig({ meta_flow_id: v })}
      label="Meta Flow"
      hint="Formulário cuja resposta dispara este flow."
    />
  );
}

// ── primitivos locais ─────────────────────────────────────────────────────────

function ToggleChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-md border px-2.5 py-1 text-xs transition-colors focus:outline-none focus:shadow-glow-sm',
        active
          ? 'border-accent bg-accent/10 text-text'
          : 'border-border-2 bg-surface-2 text-text-mid hover:text-text',
      )}
    >
      {children}
    </button>
  );
}
