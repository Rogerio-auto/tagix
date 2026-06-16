'use client';

import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Save } from 'lucide-react';
import { z } from 'zod';
import { Button, Card, Input, useToast } from '@hm/ui';
import { Field, Select, Textarea, Toggle } from '@/features/agents/wizard/fields';
import { DepartmentsField } from '@/features/agents/DepartmentsField';
import { ApiError } from '@/shared/lib/api-client';
import { useAgentModels } from '../queries';
import type { Agent, AgentDepartmentLink } from '../types';
import { useUpdateAgent, type UpdateAgentInput } from './queries';

/** Igualdade estrutural de dois conjuntos de departamentos (ordem-insensível). */
function departmentsEqual(a: AgentDepartmentLink[], b: AgentDepartmentLink[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(b.map((d) => [d.departmentId, d.isDefault]));
  return a.every((d) => byId.get(d.departmentId) === d.isDefault);
}

/**
 * Form de configuração do agente (UX §2 / DS v2). RHF + Zod (`zodResolver`).
 * Espelha o `updateSchema` da API (F2-S16) nos campos editáveis aqui:
 * nome, prompt, modelo, params (temperature/maxTokens), vision/transcription,
 * agregação e handoff. Salva via `PATCH /api/agents/:id` enviando só os campos
 * que mudaram (diff contra os valores atuais).
 */

const configSchema = z.object({
  name: z.string().trim().min(1, 'Dê um nome ao agente').max(120, 'No máximo 120 caracteres'),
  description: z.string().trim().max(2000, 'No máximo 2000 caracteres'),
  systemPrompt: z
    .string()
    .trim()
    .min(1, 'O prompt do sistema é obrigatório')
    .max(20000, 'No máximo 20000 caracteres'),
  model: z.string().trim().max(120),
  temperature: z
    .union([z.literal(''), z.coerce.number().min(0, 'Mínimo 0').max(2, 'Máximo 2')])
    .optional(),
  maxTokens: z
    .union([z.literal(''), z.coerce.number().int('Use um inteiro').min(1, 'Mínimo 1').max(200000)])
    .optional(),
  visionModel: z.string().trim().max(120),
  transcriptionModel: z.string().trim().max(120),
  aggregationEnabled: z.boolean(),
  aggregationWindowSec: z.coerce.number().int().min(0).max(600),
  maxBatchMessages: z.coerce.number().int().min(1).max(200),
  allowHandoff: z.boolean(),
  ignoreGroupMessages: z.boolean(),
});

type ConfigForm = z.infer<typeof configSchema>;

/** Lê `temperature`/`maxTokens` de `modelParams` (Record<string, unknown>). */
function numParam(params: Record<string, unknown> | null, key: string): number | '' {
  const raw = params?.[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : '';
}

function toDefaults(agent: Agent): ConfigForm {
  return {
    name: agent.name,
    description: agent.description ?? '',
    systemPrompt: agent.systemPrompt,
    model: agent.model ?? '',
    temperature: numParam(agent.modelParams, 'temperature'),
    maxTokens: numParam(agent.modelParams, 'maxTokens'),
    visionModel: agent.visionModel ?? '',
    transcriptionModel: agent.transcriptionModel ?? '',
    aggregationEnabled: agent.aggregationEnabled,
    aggregationWindowSec: agent.aggregationWindowSec,
    maxBatchMessages: agent.maxBatchMessages,
    allowHandoff: agent.allowHandoff,
    ignoreGroupMessages: agent.ignoreGroupMessages,
  };
}

export function ConfigTab({ agent, canEdit }: { agent: Agent; canEdit: boolean }) {
  const { toast } = useToast();
  const modelsQuery = useAgentModels();
  const update = useUpdateAgent(agent.id);
  const models = useMemo(() => modelsQuery.data ?? [], [modelsQuery.data]);

  const defaults = useMemo(() => toDefaults(agent), [agent]);

  // Departamentos vivem fora do RHF (estrutura de array N:N). Estado controlado +
  // dirty-tracking próprio, combinado ao dirty do form abaixo.
  const agentDepartments = useMemo<AgentDepartmentLink[]>(
    () => agent.departments ?? [],
    [agent.departments],
  );
  const [departments, setDepartments] = useState<AgentDepartmentLink[]>(agentDepartments);
  const departmentsDirty = !departmentsEqual(departments, agentDepartments);

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty: formDirty },
  } = useForm<ConfigForm>({
    resolver: zodResolver(configSchema),
    defaultValues: defaults,
  });

  const isDirty = formDirty || departmentsDirty;

  // Resincroniza quando o agente muda (ex.: refetch após save em outra aba).
  useEffect(() => {
    reset(defaults);
  }, [defaults, reset]);

  useEffect(() => {
    setDepartments(agentDepartments);
  }, [agentDepartments]);

  const onSubmit = handleSubmit(async (values) => {
    // Reconstrói modelParams preservando chaves desconhecidas + aplicando os
    // campos editáveis (omitindo os vazios).
    const nextParams: Record<string, unknown> = { ...(agent.modelParams ?? {}) };
    if (values.temperature === '' || values.temperature === undefined) {
      delete nextParams['temperature'];
    } else {
      nextParams['temperature'] = values.temperature;
    }
    if (values.maxTokens === '' || values.maxTokens === undefined) {
      delete nextParams['maxTokens'];
    } else {
      nextParams['maxTokens'] = values.maxTokens;
    }

    const payload: UpdateAgentInput = {
      name: values.name.trim(),
      description: values.description.trim() === '' ? null : values.description.trim(),
      systemPrompt: values.systemPrompt.trim(),
      ...(values.model.trim() === '' ? {} : { model: values.model.trim() }),
      modelParams: nextParams,
      visionModel: values.visionModel.trim() === '' ? null : values.visionModel.trim(),
      transcriptionModel:
        values.transcriptionModel.trim() === '' ? null : values.transcriptionModel.trim(),
      aggregationEnabled: values.aggregationEnabled,
      aggregationWindowSec: values.aggregationWindowSec,
      maxBatchMessages: values.maxBatchMessages,
      allowHandoff: values.allowHandoff,
      ignoreGroupMessages: values.ignoreGroupMessages,
      // Só envia o conjunto de departamentos quando mudou (replace-all no backend).
      ...(departmentsDirty ? { departments } : {}),
    };

    try {
      const { agent: saved } = await update.mutateAsync(payload);
      reset(toDefaults(saved));
      setDepartments(saved.departments ?? departments);
      toast({ variant: 'success', title: 'Configuração salva', description: saved.name });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Tente novamente.';
      const ref = err instanceof ApiError ? err.ref : undefined;
      toast({
        variant: 'error',
        title: 'Falha ao salvar',
        description: ref ? `${message} (ref ${ref})` : message,
      });
    }
  });

  const readOnly = !canEdit;

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-6">
      <Card elevation={1} className="flex flex-col gap-5 p-5">
        <h2 className="font-head text-base font-semibold text-text">Identidade</h2>

        <Input label="Nome" error={errors.name?.message} disabled={readOnly} {...register('name')} />

        <Field id="description" label="Descrição" error={errors.description?.message}>
          <Textarea
            id="description"
            rows={2}
            disabled={readOnly}
            error={Boolean(errors.description)}
            placeholder="Resumo curto do que este agente faz."
            {...register('description')}
          />
        </Field>

        <Field id="systemPrompt" label="Prompt do sistema" error={errors.systemPrompt?.message}>
          <Textarea
            id="systemPrompt"
            rows={8}
            disabled={readOnly}
            error={Boolean(errors.systemPrompt)}
            placeholder="Instruções de comportamento do agente."
            {...register('systemPrompt')}
          />
        </Field>
      </Card>

      <Card elevation={1} className="flex flex-col gap-5 p-5">
        <h2 className="font-head text-base font-semibold text-text">Modelo</h2>

        <Field
          id="model"
          label="Modelo de chat"
          hint={
            models.length === 0
              ? 'Catálogo indisponível — informe o slug do modelo manualmente.'
              : 'Filtrado pela policy do workspace.'
          }
          error={errors.model?.message}
        >
          {models.length > 0 ? (
            <Select id="model" disabled={readOnly} error={Boolean(errors.model)} {...register('model')}>
              <option value="">Modelo padrão do template</option>
              {models.map((m) => (
                <option key={m.slug} value={m.slug} disabled={!m.allowed}>
                  {m.displayName}
                  {m.allowed ? '' : ' (bloqueado pela policy)'}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              id="model"
              disabled={readOnly}
              error={errors.model?.message}
              placeholder="ex.: anthropic/claude-3.5-sonnet"
              {...register('model')}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="temperature" label="Temperature" hint="0–2 (vazio = default)" error={errors.temperature?.message}>
            <Input
              id="temperature"
              type="number"
              step="0.1"
              min={0}
              max={2}
              disabled={readOnly}
              error={errors.temperature?.message}
              {...register('temperature')}
            />
          </Field>
          <Field id="maxTokens" label="Max tokens" hint="vazio = default" error={errors.maxTokens?.message}>
            <Input
              id="maxTokens"
              type="number"
              min={1}
              disabled={readOnly}
              error={errors.maxTokens?.message}
              {...register('maxTokens')}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Modelo de visão"
            hint="vazio = desativado"
            disabled={readOnly}
            error={errors.visionModel?.message}
            placeholder="ex.: anthropic/claude-3.5-sonnet"
            {...register('visionModel')}
          />
          <Input
            label="Modelo de transcrição"
            hint="vazio = desativado"
            disabled={readOnly}
            error={errors.transcriptionModel?.message}
            placeholder="ex.: openai/whisper-1"
            {...register('transcriptionModel')}
          />
        </div>
      </Card>

      <Card elevation={1} className="flex flex-col gap-5 p-5">
        <h2 className="font-head text-base font-semibold text-text">Comportamento</h2>

        <Controller
          control={control}
          name="aggregationEnabled"
          render={({ field }) => (
            <Toggle
              checked={field.value}
              onChange={(next) => !readOnly && field.onChange(next)}
              label="Agregar mensagens (debounce antes de responder)"
            />
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="aggregationWindowSec"
            label="Janela de agregação (s)"
            error={errors.aggregationWindowSec?.message}
          >
            <Input
              id="aggregationWindowSec"
              type="number"
              min={0}
              max={600}
              disabled={readOnly}
              error={errors.aggregationWindowSec?.message}
              {...register('aggregationWindowSec')}
            />
          </Field>
          <Field
            id="maxBatchMessages"
            label="Máx. mensagens por lote"
            error={errors.maxBatchMessages?.message}
          >
            <Input
              id="maxBatchMessages"
              type="number"
              min={1}
              max={200}
              disabled={readOnly}
              error={errors.maxBatchMessages?.message}
              {...register('maxBatchMessages')}
            />
          </Field>
        </div>

        <Controller
          control={control}
          name="allowHandoff"
          render={({ field }) => (
            <Toggle
              checked={field.value}
              onChange={(next) => !readOnly && field.onChange(next)}
              label="Permitir handoff para atendente humano"
            />
          )}
        />
        <Controller
          control={control}
          name="ignoreGroupMessages"
          render={({ field }) => (
            <Toggle
              checked={field.value}
              onChange={(next) => !readOnly && field.onChange(next)}
              label="Ignorar mensagens de grupo"
            />
          )}
        />
      </Card>

      <Card elevation={1} className="flex flex-col gap-5 p-5">
        <div>
          <h2 className="font-head text-base font-semibold text-text">Departamentos</h2>
          <p className="mt-1 font-body text-sm text-text-low">
            Quais departamentos este agente atende. Marque um como{' '}
            <span className="font-medium text-text-mid">agente de entrada</span> para que ele receba
            a primeira mensagem desse departamento.
          </p>
        </div>
        <DepartmentsField value={departments} onChange={setDepartments} disabled={readOnly} />
      </Card>

      {canEdit && (
        <div className="flex items-center justify-end gap-3 border-t border-border-2 pt-4">
          {isDirty && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                reset(defaults);
                setDepartments(agentDepartments);
              }}
              disabled={update.isPending}
            >
              Descartar
            </Button>
          )}
          <Button
            type="submit"
            variant="primary"
            loading={update.isPending}
            disabled={!isDirty}
            leftIcon={<Save className="size-4" aria-hidden />}
          >
            Salvar alterações
          </Button>
        </div>
      )}
    </form>
  );
}
