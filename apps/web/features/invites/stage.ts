import { safeNextPath } from '@/shared/lib/safe-redirect';
import type { EmailProof, InvitePreview } from './types';
import type { Stage } from './components/InviteView';

export type SessionProbe =
  | { status: 'loading' }
  | { status: 'ready'; email: string | null }
  | { status: 'error' };

export interface StageInput {
  preview: InvitePreview;
  session: SessionProbe;
  /** `undefined` = o fragmento ainda não foi lido (primeiro render no cliente). */
  proof: EmailProof | null | undefined;
  sentEmailMasked: string | null;
  /** O aceite respondeu 401 login_required. */
  loginRequired: boolean;
  /** O aceite respondeu 403 wrong_account. */
  wrongAccount: boolean;
  /** Conta criada: para onde ir (`/login?email=…`). */
  createdNext: string | null;
}

/**
 * Decide a etapa da tela. `null` = ainda não dá para decidir (sessão/fragmento
 * pendentes) — o container mostra o esqueleto em vez de piscar o estado errado.
 */
export function resolveStage(i: StageInput): Stage | null {
  if (i.createdNext !== null) return { kind: 'created', next: i.createdNext };

  if (!i.preview.requiresEmailProof) {
    // Conta com senha: só aceita logado com o email do convite (o servidor confere).
    if (i.wrongAccount) {
      return { kind: 'wrong-account', sessionEmail: i.session.status === 'ready' ? i.session.email : null };
    }
    if (i.loginRequired) return { kind: 'login' };
    if (i.session.status === 'loading') return null;
    if (i.session.status === 'ready' && i.session.email === null) return { kind: 'login' };
    return { kind: 'accept', sessionEmail: i.session.status === 'ready' ? i.session.email : null };
  }

  // Sem senha ainda: a prova de posse do email decide.
  if (i.proof === undefined) return null;
  if (i.proof !== null) return { kind: 'create-password' };
  if (i.sentEmailMasked !== null) return { kind: 'proof-sent', emailMasked: i.sentEmailMasked };
  return { kind: 'send-proof' };
}

/** Destino do login com retorno ao convite. O token só aparece aqui por exigência do `next`. */
export function loginHrefFor(token: string): string {
  return `/login?next=${encodeURIComponent(`/convite/${token}`)}`;
}

const CREATED_FALLBACK = '/login';

/**
 * Destino depois de criar a conta pelo convite. A API devolve `next: '/login?email=…'`;
 * aqui o caminho passa pelo guard de open-redirect e, se for o login, ganha
 * `from=invite` para a tela de login mostrar "Conta criada. Entre com sua senha."
 * Qualquer outro caminho interno segue intocado; externo/inválido cai em `/login`.
 */
export function createdLoginHref(next: string | null | undefined): string {
  const safe = safeNextPath(next, CREATED_FALLBACK);
  const url = new URL(safe, 'https://leadium.internal');
  if (url.pathname !== CREATED_FALLBACK) return safe;
  url.searchParams.set('from', 'invite');
  return url.pathname + url.search + url.hash;
}
