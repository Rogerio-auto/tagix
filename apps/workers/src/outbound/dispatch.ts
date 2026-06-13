/**
 * dispatch — valida coerencia kind<->provider e roteia o job ao metodo correto
 * do adapter (LIVECHAT.md 3.1/3.2; INSTAGRAM.md 5.3/6 para IG).
 *
 * Falha rapida no worker (erro tipado) antes da borda Meta quando o tipo de
 * mensagem e incompativel com o provider do canal — ex.: template (HSM) so em
 * meta_whatsapp; ig_* so em meta_instagram. Para envios IG (text/media/
 * interactive) tambem aplica a janela de 24h + MESSAGE_TAG: fora da janela sem
 * tag valido => bloqueio tipado (nao chama a borda).
 */
import type { Channel, IChannelAdapter, IInstagramAdapter, SendResult } from '@hm/channels';
import type { ChannelProvider } from '@hm/shared';
import type { IgMessageTag, OutboundJob, OutboundJobKind } from './job';
import { evaluateInstagramWindow, type WindowEvaluation } from './instagram-window';

export type DispatchResult =
  | { readonly dispatched: true; readonly result: SendResult; readonly messageTagUsed?: IgMessageTag }
  | { readonly dispatched: false; readonly result: SendResult; readonly windowBlocked?: boolean };

function mismatch(kind: OutboundJobKind, provider: ChannelProvider): DispatchResult {
  return {
    dispatched: false,
    result: {
      ok: false,
      errorCode: 'OUTBOUND_KIND_PROVIDER_MISMATCH',
      errorMessage: "Job '" + kind + "' nao e suportado pelo provider '" + provider + "'.",
    },
  };
}

function windowBlock(evaluation: WindowEvaluation): DispatchResult {
  return {
    dispatched: false,
    windowBlocked: true,
    result: {
      ok: false,
      errorCode: 'IG_WINDOW_CLOSED',
      errorMessage:
        evaluation.reason === 'ig_messaging_window_closed'
          ? 'Instagram: janela de mensagens fechada (>7d sem interacao).'
          : 'Instagram: fora da janela 24h — requer MESSAGE_TAG valido (ex.: HUMAN_AGENT).',
    },
  };
}

const SUPPORTED: Record<OutboundJobKind, readonly ChannelProvider[]> = {
  text: ['meta_whatsapp', 'meta_instagram', 'waha'],
  media: ['meta_whatsapp', 'meta_instagram', 'waha'],
  template: ['meta_whatsapp'],
  interactive: ['meta_whatsapp', 'meta_instagram'],
  ig_private_reply: ['meta_instagram'],
  ig_public_reply: ['meta_instagram'],
  ig_hide_comment: ['meta_instagram'],
  typing_indicator: ['meta_whatsapp', 'meta_instagram', 'waha'],
};

function isSupported(kind: OutboundJobKind, provider: ChannelProvider): boolean {
  const providers = SUPPORTED[kind];
  return providers !== undefined && providers.includes(provider);
}

function asInstagram(adapter: IChannelAdapter): IInstagramAdapter {
  return adapter as IInstagramAdapter;
}

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
      const win = enforceWindow(job, channel);
      if (win.blocked) return win.result;
      const result = await adapter.sendText(
        {
          contactRemoteId: job.chatId,
          text: job.text,
          ...(job.replyToExternalId !== undefined
            ? { replyToExternalId: job.replyToExternalId }
            : {}),
          ...(win.tag !== undefined ? { messageTag: win.tag } : {}),
        },
        channel,
      );
      return { dispatched: true, result, ...(win.tag !== undefined ? { messageTagUsed: win.tag } : {}) };
    }
    case 'media': {
      const win = enforceWindow(job, channel);
      if (win.blocked) return win.result;
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
          ...(win.tag !== undefined ? { messageTag: win.tag } : {}),
        },
        channel,
      );
      return { dispatched: true, result, ...(win.tag !== undefined ? { messageTagUsed: win.tag } : {}) };
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
      const win = enforceWindow(job, channel);
      if (win.blocked) return win.result;
      const result = await adapter.sendInteractive(
        {
          contactRemoteId: job.chatId,
          payload: job.payload,
          ...(win.tag !== undefined ? { messageTag: win.tag } : {}),
        },
        channel,
      );
      return { dispatched: true, result, ...(win.tag !== undefined ? { messageTagUsed: win.tag } : {}) };
    }
    case 'ig_private_reply': {
      const result = await asInstagram(adapter).sendPrivateReplyToComment(
        { commentId: job.commentId, text: job.text },
        channel,
      );
      return { dispatched: true, result };
    }
    case 'ig_public_reply': {
      const result = await asInstagram(adapter).replyPublicToComment(
        { commentId: job.commentId, text: job.text },
        channel,
      );
      return { dispatched: true, result };
    }
    case 'ig_hide_comment': {
      await asInstagram(adapter).hideComment(job.commentId, channel, job.hide ?? true);
      return { dispatched: true, result: { ok: true, externalId: job.commentId } };
    }
    case 'typing_indicator': {
      await adapter.sendTypingIndicator(job.targetExternalId, job.presence, channel);
      return { dispatched: true, result: { ok: true, externalId: '' } };
    }
    default: {
      return assertNever(job);
    }
  }
}

type WindowDecision =
  | { readonly blocked: true; readonly result: DispatchResult }
  | { readonly blocked: false; readonly tag?: IgMessageTag };

function enforceWindow(
  job: Extract<OutboundJob, { kind: 'text' | 'media' | 'interactive' }>,
  channel: Channel,
): WindowDecision {
  if (channel.provider !== 'meta_instagram') {
    return job.messageTag !== undefined
      ? { blocked: false, tag: job.messageTag }
      : { blocked: false };
  }
  const evaluation = evaluateInstagramWindow({
    ...(job.lastInboundFromContactAt !== undefined
      ? { lastInboundFromContactAt: job.lastInboundFromContactAt }
      : {}),
    ...(job.messageTag !== undefined ? { messageTag: job.messageTag } : {}),
  });
  if (!evaluation.allowed) {
    return { blocked: true, result: windowBlock(evaluation) };
  }
  return evaluation.tag !== undefined
    ? { blocked: false, tag: evaluation.tag }
    : { blocked: false };
}

function assertNever(value: never): never {
  throw new Error('Outbound kind nao tratado: ' + JSON.stringify(value));
}
