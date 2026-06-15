'use client';

import { Info } from 'lucide-react';
import { ChannelPicker } from '@/features/flow-builder/inspector/pickers';
import { useFlowEditor } from '../../hooks/useFlowEditor';
import { VariablesPicker } from '../../inspector/VariablesPicker';
import { NumberField, SelectField, TextField } from '../inspector-fields';

const TARGET_OPTIONS = [
  { value: 'RESPONSIBLE', label: 'Responsável' },
  { value: 'ENTITY_CUSTOMER', label: 'Cliente' },
  { value: 'FLOW_CONTACT', label: 'Contato do flow' },
  { value: 'CUSTOM', label: 'Telefone específico' },
] as const;

const PHONE_RE = /^\+?[1-9]\d{6,14}$/;

export function ExternalNotifyInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const d = (node.data ?? {}) as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => update(nodeId, patch);

  const target = ((d['target'] as string) ?? '') || 'RESPONSIBLE';
  const channelId = (d['channelId'] as string) ?? undefined;
  const customPhone = (d['customPhone'] as string) ?? '';
  const text = (d['text'] as string) ?? '';
  const waitForResponse = d['waitForResponse'] === true;

  const phoneError =
    target === 'CUSTOM'
      ? customPhone.trim().length === 0
        ? 'Informe o telefone de destino.'
        : !PHONE_RE.test(customPhone.trim())
          ? 'Telefone inválido. Use o formato internacional, ex.: +5511999999999.'
          : null
      : null;

  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label="Destino"
        value={target}
        options={[...TARGET_OPTIONS]}
        onChange={(v) => set({ target: v })}
        hint={target === 'CUSTOM' ? undefined : 'O telefone é resolvido pelas variáveis do flow.'}
      />

      {target === 'CUSTOM' && (
        <div className="flex flex-col gap-1.5">
          <TextField
            label="Telefone de destino"
            value={customPhone}
            placeholder="+5511999999999"
            onChange={(v) => set({ customPhone: v })}
          />
          {phoneError && <span className="text-[11px] text-danger">{phoneError}</span>}
        </div>
      )}

      <ChannelPicker
        label="Canal de envio"
        value={channelId}
        onChange={(v) => set({ channelId: v })}
        hint="Canal pelo qual a notificação será enviada."
      />
      {!channelId && <span className="text-[11px] text-danger">Selecione um canal de envio.</span>}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-text-low">Mensagem</span>
          <VariablesPicker onPick={(token) => set({ text: `${text}${token}` })} />
        </div>
        <textarea
          value={text}
          placeholder="Novo lead aguardando: {{contact.name}}"
          onChange={(e) => set({ text: e.target.value })}
          className="min-h-[90px] rounded-md border border-border-2 bg-surface-2 px-3 py-2 text-sm text-text focus:border-accent focus:shadow-glow-sm focus:outline-none"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-text-mid">
        <input
          type="checkbox"
          checked={waitForResponse}
          onChange={(e) => set({ waitForResponse: e.target.checked })}
          className="size-4 rounded border-border-2 bg-surface-2 accent-accent focus:shadow-glow-sm focus:outline-none"
        />
        Aguardar resposta do destinatário
      </label>

      {waitForResponse && (
        <NumberField
          label="Timeout (minutos)"
          value={typeof d['timeoutMinutes'] === 'number' ? (d['timeoutMinutes'] as number) : undefined}
          hint="Saídas: resposta / timeout."
          onChange={(v) => set({ timeoutMinutes: v })}
        />
      )}

      <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          O roteamento para outra conversa/telefone depende do bridge de saída (publisher S01 ainda
          não traduz este caso). A configuração fica salva e válida.
        </span>
      </div>
    </div>
  );
}
