import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, membersRepo, schema, workspacesRepo } from '@hm/db';
import { AuthError } from '@hm/shared';
import { getAuthProvider } from './provider';
import {
  clearSessionCookie,
  publicMember,
  readToken,
  resolveSession,
  setSessionCookie,
} from './session';
import { signupHandler } from './signup';
import { resetHandler, verifyHandler, confirmResetHandler } from './reset';
import { loginCaptchaRequired, recordLoginFailure } from './login-captcha';
import { auditAuthEvent, rateLimit, verifyTurnstile, clientIp } from '../middlewares/rate-limit';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Limites de borda (T4). Defaults sãos, ajustáveis por env nos middlewares.
const loginLimiter = rateLimit({ bucket: 'login', max: 10, windowSec: 15 * 60 });
// SEC-05: teto ABSOLUTO por IP, independente do email. O limiter IP+email não barra
// spraying (1 IP × N emails = N chaves novas); este fecha o volume bruto por origem.
const loginIpLimiter = rateLimit({ bucket: 'login_ip', max: 60, windowSec: 60, byEmail: false });
const signupLimiter = rateLimit({ bucket: 'signup', max: 5, windowSec: 60 * 60 });
const resetLimiter = rateLimit({ bucket: 'reset', max: 5, windowSec: 60 * 60 });
// confirm: por IP (o body não tem email, só token+senha). Tolera retentativas de
// quem clicou no link, mas trava brute-force do token.
const resetConfirmLimiter = rateLimit({
  bucket: 'reset_confirm',
  max: 10,
  windowSec: 60 * 60,
  byEmail: false,
});
const verifyLimiter = rateLimit({ bucket: 'verify', max: 20, windowSec: 60 * 60, byEmail: false });

/**
 * Router de auth. Montado pelo servidor Express (F0-S06). Express 5 encaminha
 * erros de handlers async para o error handler central automaticamente.
 */
export function createAuthRouter(): Router {
  // SEC-02: resolve o provider na montagem do app (boot), não no 1º request —
  // AUTH_PROVIDER=mock (ou fallback para mock) em produção aborta aqui, fail-fast.
  getAuthProvider();

  const router = Router();

  router.post('/auth/login', loginIpLimiter, loginLimiter, async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: 'Email e senha são obrigatórios.' });
      return;
    }
    // SEC-05: captcha progressivo — após N falhas de login do IP na janela, exige
    // Turnstile (mesma verificação server-side do signup). `reason` é machine-readable
    // p/ o web renderizar o widget. Fail-closed em prod sem secret (verifyTurnstile).
    const ip = clientIp(req);
    if (await loginCaptchaRequired(ip)) {
      const captchaOk = await verifyTurnstile(extractTurnstileToken(req), ip);
      if (!captchaOk) {
        await auditAuthEvent('auth.login_failed', req, {
          email: parsed.data.email,
          reason: 'captcha_required',
        });
        res.status(403).json({
          message: 'Verificação anti-robô necessária. Complete o desafio e tente de novo.',
          reason: 'captcha_required',
        });
        return;
      }
    }
    try {
      const session = await getAuthProvider().signIn(parsed.data);
      setSessionCookie(res, session.accessToken);
      const member = await membersRepo.findByEmail(session.identity.email);
      const workspace = member ? await workspacesRepo.findById(member.workspaceId) : null;
      if (!member || !workspace) {
        res.status(403).json({ message: 'Usuário sem workspace ativo.' });
        return;
      }
      // Intenção de plano da página de venda (signup): consome 1x e devolve ao web,
      // que redireciona ao checkout. One-shot (não força redirect a cada login) —
      // o usuário pode assinar depois pelo billing. Nunca libera plano pago aqui.
      const pendingPlanKey = await consumePendingPlanKey(workspace.id);
      res.json({ member: publicMember(member), workspace, pendingPlanKey });
    } catch (err) {
      if (err instanceof AuthError) {
        // T10: trilha de login falho (sem senha). Email no metadata p/ correlação.
        // SEC-05: alimenta o contador que arma o captcha progressivo do IP.
        await recordLoginFailure(ip);
        await auditAuthEvent('auth.login_failed', req, { email: parsed.data.email });
        res.status(401).json({ message: 'Email ou senha incorretos.' });
        return;
      }
      throw err;
    }
  });

  // Cadastro self-serve (F44). Captcha server-side ANTES de provisionar; rate-limit
  // por IP+email. Resposta uniforme/anti-enumeração no próprio handler.
  router.post('/auth/signup', signupLimiter, async (req: Request, res: Response) => {
    // Pré-checa só a presença do token para o captcha (forma completa é validada
    // pelo signupSchema dentro do handler).
    const token = extractTurnstileToken(req);
    const ok = await verifyTurnstile(token, clientIp(req));
    if (!ok) {
      res.status(400).json({ message: 'Verificação anti-robô falhou. Recarregue e tente de novo.' });
      return;
    }
    await signupHandler(req, res);
  });

  router.post('/auth/reset', resetLimiter, resetHandler);
  router.post('/auth/reset/confirm', resetConfirmLimiter, confirmResetHandler);
  router.post('/auth/verify', verifyLimiter, verifyHandler);

  router.post('/auth/logout', async (req: Request, res: Response) => {
    const token = readToken(req);
    if (token) await getAuthProvider().signOut(token);
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.get('/api/me', async (req: Request, res: Response) => {
    const token = readToken(req);
    const session = token ? await resolveSession(token) : null;
    if (!session) {
      res.status(401).json({ message: 'Não autenticado.' });
      return;
    }
    res.json({ member: publicMember(session.member), workspace: session.workspace });
  });

  return router;
}

/**
 * Lê e LIMPA a intenção de plano (pending_plan_key) da assinatura do workspace.
 * Caminho privilegiado (login, antes do escopo RLS) — keyed pelo workspaceId já
 * resolvido, consistente com a leitura do catálogo de planos no billing. Retorna a
 * key consumida (ou null) e zera o campo no mesmo passo (one-shot).
 */
async function consumePendingPlanKey(workspaceId: string): Promise<string | null> {
  const db = getDb();
  const [sub] = await db
    .select({ key: schema.subscriptions.pendingPlanKey })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.workspaceId, workspaceId))
    .limit(1);
  const key = sub?.key ?? null;
  if (key) {
    await db
      .update(schema.subscriptions)
      .set({ pendingPlanKey: null, updatedAt: new Date() })
      .where(eq(schema.subscriptions.workspaceId, workspaceId));
  }
  return key;
}

/** Extrai o turnstileToken do body sem assumir forma (zero `any`). */
function extractTurnstileToken(req: Request): string {
  const body: unknown = req.body;
  if (body && typeof body === 'object' && 'turnstileToken' in body) {
    const t = (body as { turnstileToken: unknown }).turnstileToken;
    if (typeof t === 'string') return t;
  }
  return '';
}
