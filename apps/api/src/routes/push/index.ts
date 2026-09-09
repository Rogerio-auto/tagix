/**
 * Rotas de Web Push (F61-S03).
 *
 *  - `GET  /api/push/public-key` — a chave VAPID que o navegador precisa para
 *    assinar. Devolve `null` quando o push não está configurado, e a UI esconde o
 *    interruptor: melhor não oferecer que oferecer e falhar.
 *  - `POST /api/push/subscribe`   — registra/atualiza o aparelho.
 *  - `POST /api/push/unsubscribe` — remove o aparelho.
 *
 * Sem guard de papel além de sessão + RLS: qualquer membro pode querer ser avisado
 * no próprio celular, e a assinatura é sempre do membro da sessão — o corpo da
 * requisição não escolhe de quem é.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { pushRepo } from '@hm/db';
import { requireAuth, withRLS } from '../../middlewares/auth';
import { publicKey } from '../../services/push';

/**
 * O que `PushSubscription.toJSON()` entrega. Validado de verdade porque vem do
 * cliente: um `endpoint` gigante ou não-URL viraria lixo permanente na tabela.
 */
const subscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
  /** Como o usuário reconhece o aparelho. Opcional; a UI sugere um. */
  label: z.string().trim().max(80).optional(),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
});

/**
 * Rótulo legível a partir do user agent, para a lista de dispositivos não virar
 * uma coluna de strings de 200 caracteres.
 *
 * Deliberadamente grosseiro: o objetivo é o usuário reconhecer o próprio aparelho,
 * não fazer analytics de navegador.
 */
export function labelFromUserAgent(ua: string | undefined): string {
  if (ua === undefined || ua === '') return 'Este aparelho';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Este aparelho';
}

export function createPushRouter(): Router {
  const router = Router();
  const guard = [requireAuth, withRLS] as const;

  router.get('/api/push/public-key', ...guard, (_req: Request, res: Response): void => {
    // `null` quando não configurado: a UI usa isso para nem mostrar o interruptor.
    res.json({ publicKey: publicKey() });
  });

  router.post(
    '/api/push/subscribe',
    ...guard,
    async (req: Request, res: Response): Promise<void> => {
      const parsed = subscribeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: 'Assinatura inválida.', issues: parsed.error.issues });
        return;
      }
      const { endpoint, keys, label } = parsed.data;
      const ua = req.headers['user-agent'];
      const userAgent = typeof ua === 'string' ? ua.slice(0, 500) : null;

      // A assinatura é SEMPRE do membro da sessão. O corpo não escolhe de quem é —
      // senão qualquer membro poderia redirecionar os avisos de outro para o
      // próprio aparelho.
      const row = await req.scoped!((tx) =>
        pushRepo.upsertSubscription(tx, {
          workspaceId: req.auth!.workspace.id,
          memberId: req.auth!.member.id,
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
          label: label ?? labelFromUserAgent(userAgent ?? undefined),
          userAgent,
        }),
      );

      res.status(201).json({ id: row.id, label: row.label });
    },
  );

  router.post(
    '/api/push/unsubscribe',
    ...guard,
    async (req: Request, res: Response): Promise<void> => {
      const parsed = unsubscribeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: 'Endpoint inválido.' });
        return;
      }
      // RLS já escopa ao workspace da sessão; o endpoint é único no mundo, então
      // não há como apagar a assinatura de outro tenant por aqui.
      await req.scoped!((tx) => pushRepo.removeByEndpoint(tx, parsed.data.endpoint));
      res.status(204).end();
    },
  );

  return router;
}
