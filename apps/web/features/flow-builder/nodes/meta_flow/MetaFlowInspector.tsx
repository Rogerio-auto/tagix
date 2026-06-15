'use client';

import { useState } from 'react';
import { Info } from 'lucide-react';
import { useFlowEditor } from '../../hooks/useFlowEditor';
import { Field, TextAreaField, TextField } from '../inspector-fields';

/**
 * Inspector meta_flow (F32-S05). Expõe todos os 6 campos suportados pelo handler:
 * metaFlowId, ctaText, body, flowToken, screen, flowActionPayload.
 *
 * Campos agrupados em seções:
 * - Identificação: metaFlowId, flowToken
 * - Mensagem: ctaText, body
 * - Configuração: screen, flowActionPayload (JSON livre)
 *
 * Banner de compatibilidade: exclusivo do canal WhatsApp Cloud API.
 */
export function MetaFlowInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);

  // Local state for the JSON textarea (string while editing; parsed on blur)
  const [jsonRaw, setJsonRaw] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const d = (node.data ?? {}) as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => update(nodeId, patch);

  const metaFlowId = typeof d['metaFlowId'] === 'string' ? d['metaFlowId'] : '';
  const ctaText = typeof d['ctaText'] === 'string' ? d['ctaText'] : '';
  const body = typeof d['body'] === 'string' ? d['body'] : '';
  const flowToken = typeof d['flowToken'] === 'string' ? d['flowToken'] : '';
  const screen = typeof d['screen'] === 'string' ? d['screen'] : '';

  // Stored payload as Record; display as JSON string
  const storedPayload = d['flowActionPayload'];
  const payloadDisplay =
    jsonRaw !== null
      ? jsonRaw
      : storedPayload && typeof storedPayload === 'object'
        ? JSON.stringify(storedPayload, null, 2)
        : '';

  const handlePayloadBlur = (raw: string) => {
    setJsonRaw(null);
    const trimmed = raw.trim();
    if (!trimmed) {
      setJsonError(null);
      set({ flowActionPayload: undefined });
      return;
    }
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      setJsonError(null);
      set({ flowActionPayload: parsed });
    } catch {
      setJsonError('JSON inválido — verifique a sintaxe');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Compatibility banner */}
      <div className="flex items-start gap-2 rounded-md border border-info/30 bg-info/10 px-3 py-2.5">
        <Info className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden />
        <p className="text-[11px] text-info">
          Este node funciona apenas em canais WhatsApp Cloud API. WAHA não suporta WhatsApp Flows.
        </p>
      </div>

      {/* Section: Identificação */}
      <div className="flex flex-col gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-low">
          Identificação
        </p>
        <TextField
          label="Meta Flow ID"
          value={metaFlowId}
          placeholder="1234567890"
          hint="ID do flow criado no Meta Business Suite"
          onChange={(v) => set({ metaFlowId: v })}
        />
        <TextField
          label="Flow Token (opcional)"
          value={flowToken}
          placeholder="token_gerado_pela_meta"
          hint="Token de autenticidade do flow (gerado no Meta Business Suite)"
          onChange={(v) => set({ flowToken: v })}
        />
      </div>

      {/* Section: Mensagem */}
      <div className="flex flex-col gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-low">Mensagem</p>
        <TextField
          label="Texto do CTA"
          value={ctaText}
          placeholder="Preencher formulário"
          onChange={(v) => set({ ctaText: v })}
        />
        <TextAreaField
          label="Corpo da mensagem (opcional)"
          value={body}
          placeholder="Texto de acompanhamento enviado junto ao flow…"
          hint="Máximo 1024 caracteres. Suporta variáveis {{contact.name}}."
          onChange={(v) => set({ body: v })}
        />
      </div>

      {/* Section: Configuração */}
      <div className="flex flex-col gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-low">
          Configuração
        </p>
        <TextField
          label="Tela inicial (opcional)"
          value={screen}
          placeholder="WELCOME"
          hint="ID da tela inicial do flow (ex: WELCOME)"
          onChange={(v) => set({ screen: v })}
        />

        {/* JSON editor for flowActionPayload */}
        <Field
          label="Payload inicial (opcional)"
          hint="JSON livre enviado como dados iniciais do form. Validado ao sair do campo."
        >
          <textarea
            value={payloadDisplay}
            placeholder="{}"
            onChange={(e) => setJsonRaw(e.target.value)}
            onBlur={(e) => handlePayloadBlur(e.target.value)}
            className="min-h-[80px] rounded-md border border-border-2 bg-surface-2 px-3 py-2 font-mono text-xs text-text focus:border-accent focus:outline-none"
            spellCheck={false}
          />
          {jsonError && (
            <p className="mt-1 text-[11px] text-danger">{jsonError}</p>
          )}
        </Field>
      </div>
    </div>
  );
}
