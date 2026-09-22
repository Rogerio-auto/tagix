/**
 * Envio de Web Push (F61-S03 — APP_MOBILE_PLAN.md §4.1/§4.3).
 *
 * ## Privacidade é parte da assinatura, não um detalhe do chamador
 *
 * `PushNotification` **não tem campo para conteúdo de mensagem de cliente**. Não é
 * disciplina, é o tipo: celular de obra se perde, e notificação de tela bloqueada
 * é lida por quem estiver com o aparelho na mão. O aviso diz o que aconteceu e de
 * onde veio ("Lead novo · WhatsApp"); o conteúdo aparece depois de abrir o app.
 *
 * Se algum dia alguém precisar mandar o texto do cliente, vai ter que mudar este
 * tipo — e aí a decisão fica visível na revisão, em vez de escorregar num
 * `body: mensagem.content`.
 *
 * ## Push desligado NÃO é erro
 *
 * Sem VAPID configurado, `isPushConfigured()` devolve `false` e o envio vira no-op.
 * O produto inteiro não pode deixar de subir porque o canal de aviso não foi
 * configurado — em dev ele nem faz sentido.
 */
import webpush, { WebPushError } from 'web-push';
import { pushRepo, withWorkspace } from '@hm/db';
import { createLogger } from '@hm/logger';

const logger = createLogger('info', { svc: '@hm/api' });

/**
 * O que pode ser notificado.
 *
 * Sem `body` livre de propósito — ver o bloco de privacidade acima. `title` e
 * `origin` são rótulos curtos que o produto controla; `url` leva à tela certa
 * quando o usuário toca.
 */
export interface PushNotification {
  /** Rótulo do que aconteceu. Ex.: "Lead novo". */
  readonly title: string;
  /** De onde veio. Ex.: "WhatsApp". NUNCA o nome nem a mensagem do cliente. */
  readonly origin?: string;
  /** Para onde levar ao tocar. Caminho relativo dentro do app. */
  readonly url?: string;
  /**
   * Agrupa notificações do mesmo assunto — o navegador substitui a anterior em
   * vez de empilhar. Cinco avisos de "lead novo" viram um.
   */
  readonly tag?: string;
}

let configurado: boolean | null = null;

/**
 * VAPID configurado? Memoiza porque é lido a cada envio e o ambiente não muda
 * durante o processo.
 */
export function isPushConfigured(): boolean {
  if (configurado !== null) return configurado;

  const publica = process.env['VAPID_PUBLIC_KEY'];
  const privada = process.env['VAPID_PRIVATE_KEY'];
  // `mailto:` é exigido pela especificação VAPID — é como o serviço de push
  // avisa o dono da aplicação quando algo está errado.
  const subject = process.env['VAPID_SUBJECT'] ?? 'mailto:suporte@leadium.com.br';

  if (!publica || !privada) {
    configurado = false;
    return false;
  }
  try {
    webpush.setVapidDetails(subject, publica, privada);
    configurado = true;
  } catch (err) {
    // Chave malformada: melhor push desligado e log alto que processo caído.
    logger.error('push: VAPID inválido — canal de aviso desligado', {
      erro: err instanceof Error ? err.message : String(err),
    });
    configurado = false;
  }
  return configurado;
}

/** A chave pública que o navegador precisa para assinar. */
export function publicKey(): string | null {
  return isPushConfigured() ? (process.env['VAPID_PUBLIC_KEY'] ?? null) : null;
}

/** Zera a memoização — testes trocam o ambiente entre casos. */
export function resetPushConfig(): void {
  configurado = null;
}

/**
 * Um envio é "morto" quando o provedor diz que o endereço não existe.
 *
 * `404` e `410` são a fonte da verdade sobre a existência da assinatura: o usuário
 * desinstalou ou revogou. Qualquer outro erro (rede, 5xx, 429) é ambíguo — um
 * serviço de push fora do ar por dez minutos não pode custar a base de assinaturas
 * do cliente.
 */
export function isDeadEndpoint(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410;
}

export interface PushResult {
  readonly enviados: number;
  readonly removidos: number;
  readonly falhas: number;
}

/**
 * Notifica todos os aparelhos de um membro.
 *
 * Envia em paralelo: o dono com iPhone e desktop não deve esperar o primeiro
 * terminar para o segundo começar, e um endpoint lento não pode segurar os outros.
 */
export async function notifyMember(
  input: { workspaceId: string; memberId: string },
  notificacao: PushNotification,
): Promise<PushResult> {
  if (!isPushConfigured()) return { enviados: 0, removidos: 0, falhas: 0 };

  const assinaturas = await withWorkspace(input.workspaceId, (tx) =>
    pushRepo.listForMember(tx, input),
  );
  if (assinaturas.length === 0) return { enviados: 0, removidos: 0, falhas: 0 };

  const payload = JSON.stringify(notificacao);

  const resultados = await Promise.all(
    assinaturas.map(async (a) => {
      try {
        await webpush.sendNotification(
          { endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
          payload,
        );
        await withWorkspace(input.workspaceId, (tx) => pushRepo.markUsed(tx, a.endpoint));
        return 'enviado' as const;
      } catch (err) {
        const status = err instanceof WebPushError ? err.statusCode : undefined;
        if (isDeadEndpoint(status)) {
          await withWorkspace(input.workspaceId, (tx) =>
            pushRepo.removeByEndpoint(tx, a.endpoint),
          );
          return 'removido' as const;
        }
        await withWorkspace(input.workspaceId, (tx) => pushRepo.markFailure(tx, a.endpoint));
        logger.warn('push: falha ambígua ao notificar', {
          status: status ?? null,
          workspaceId: input.workspaceId,
        });
        return 'falha' as const;
      }
    }),
  );

  return {
    enviados: resultados.filter((r) => r === 'enviado').length,
    removidos: resultados.filter((r) => r === 'removido').length,
    falhas: resultados.filter((r) => r === 'falha').length,
  };
}
