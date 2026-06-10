/**
 * `dispatch` — valida coerência `kind ↔ provider` e roteia o job ao método
 * correto do adapter (LIVECHAT.md §3.1/§3.2).
 *
 * Falha rápida no worker (erro tipado) antes da borda Meta quando o tipo de
 * mensagem é incompatível com o provider do canal — ex.: `template` (HSM) só
 * em `meta_whatsapp`. Os `ig_*` da spec entram na fase Instagram (F1.5); aqui
 * cobrimos os kinds suportados por adapters reais (text/media/template/
 * interactive/typing_indicator).
 */
import type { Channel, IChannelAdapter, SendResult } from '@hm/channels';
import type { ChannelProvider } from '@hm/shared';
import type { OutboundJob, OutboundJobKind } from './job';

/** Resultado de dispatch: ou um `SendResult`, ou um mismatch tipado (sem envio). */
export type DispatchResult =
  | { readonly dispatched: true; readonly result: SendResult }
  | { readonly dispatched: false; readonly result: SendResult };

/**
 * Erro tipado de incompatibilidade `kind ↔ provider`. Carregado como
 * `SendResult` falho (`ok:false`) para fluir pela mesma persistência/finalize.
 */
function mismatch(kind: OutboundJobKind, provider: ChannelProvider): DispatchResult {
  return {
    dispatched: false,
    result: {
      ok: false,
      errorCode: 'OUTBOUND_KIND_PROVIDER_MISMATCH',
      errorMessage: `Job '${kind}' não é suportado pelo provider '${provider}'.`,
    },
  };
}

/** Providers que aceitam cada `kind` (coerência checada antes do adapter). */
const SUPPORTED: Record<OutboundJobKind, readonly ChannelProvider[]> = {
  text: ['meta_whatsapp', 'meta_instagram', 'waha'],
  media: ['meta_whatsapp', 'meta_instagram', 'waha'],
  // HSM é exclusivo da Cloud API oficial.
  template: ['meta_whatsapp'],
  // Interativo nativo: WA e IG (WAHA retorna erro próprio, mas nem chega aqui).
  interactive: ['meta_whatsapp', 'meta_instagram'],
  typing_indicator: ['meta_whatsapp', 'meta_instagram', 'waha'],
};

function isSupported(kind: OutboundJobKind, provider: ChannelProvider): boolean {
  const providers = SUPPORTED[kind];
  return providers !== undefined && providers.includes(provider);
}

/**
 * Roteia o job ao adapter, após validar coerência com o provider do canal.
 * Retorna `dispatched:false` em mismatch (não chama a borda Meta).
 */
export async function dispatchOutbound(
  job: OutboundJob,
  channel: Channel,
  adapter: IChannelAdapter,
): Promise<DispatchResult> {
  if (!isSupported(job.kind, channel.provider)) {
    return mismatch(job.kind, channel.provider);
  }

  switch (job.kind) {
    case 'text': {
      const result = await adapter.sendText(
        {
          contactRemoteId: job.chatId,
          text: job.text,
          ...(job.replyToExternalId !== undefined
            ? { replyToExternalId: job.replyToExternalId }
            : {}),
          ...(job.messageTag !== undefined ? { messageTag: job.messageTag } : {}),
        },
        channel,
      );
      return { dispatched: true, result };
    }
    case 'media': {
      const result = await adapter.sendMedia(
        {
          contactRemoteId: job.chatId,
          mediaKind: job.mediaKind,
          publicMediaUrl: job.publicMediaUrl,
          mime: job.mime,
          ...(job.caption !== undefined ? { caption: job.caption } : {}),
          ...(job.replyToExternalId !== undefined
            ? { replyToExternalId: job.replyToExternalId }
            : {}),
          ...(job.messageTag !== undefined ? { messageTag: job.messageTag } : {}),
        },
        channel,
      );
      return { dispatched: true, result };
    }
    case 'template': {
      const result = await adapter.sendTemplate(
        {
          contactRemoteId: job.chatId,
          templateName: job.templateName,
          languageCode: job.languageCode,
          components: job.components,
        },
        channel,
      );
      return { dispatched: true, result };
    }
    case 'interactive': {
      const result = await adapter.sendInteractive(
        {
          contactRemoteId: job.chatId,
          payload: job.payload,
          ...(job.messageTag !== undefined ? { messageTag: job.messageTag } : {}),
        },
        channel,
      );
      return { dispatched: true, result };
    }
    case 'typing_indicator': {
      await adapter.sendTypingIndicator(job.targetExternalId, job.presence, channel);
      // Presença não gera mensagem persistível nem externalId.
      return { dispatched: true, result: { ok: true, externalId: '' } };
    }
    default: {
      // Exaustividade: se um novo kind for adicionado sem case, isto falha o build.
      return assertNever(job);
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Outbound kind não tratado: ${JSON.stringify(value)}`);
}
