import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { membersRepo, workspacesRepo } from '@hm/db';
import { AuthError } from '@hm/shared';
import { getAuthProvider } from './provider';
import {
  clearSessionCookie,
  publicMember,
  readToken,
  resolveSession,
  setSessionCookie,
} from './session';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Router de auth. Montado pelo servidor Express (F0-S06). Express 5 encaminha
 * erros de handlers async para o error handler central automaticamente.
 */
export function createAuthRouter(): Router {
  const router = Router();

  router.post('/auth/login', async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: 'Email e senha são obrigatórios.' });
      return;
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
      res.json({ member: publicMember(member), workspace });
    } catch (err) {
      if (err instanceof AuthError) {
        res.status(401).json({ message: 'Email ou senha incorretos.' });
        return;
      }
      throw err;
    }
  });

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
