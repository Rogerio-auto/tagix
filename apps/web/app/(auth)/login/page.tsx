import { LoginForm } from '@/features/auth/components/LoginForm';
import { loginNoticeFor, sanitizeEmailParam } from '@/features/auth/resend';
import { SESSION_EXPIRED_REASON } from '@/shared/auth/route-guard';

interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  // F70-S28: `?motivo=sessao-expirada` vem do middleware (cookie morto) ou do handler
  // central de 401. Lido no servidor para o aviso já vir no HTML, sem piscar.
  const { motivo, email, from } = await searchParams;
  const sessionExpired = motivo === SESSION_EXPIRED_REASON;
  // `?email=` (convite aceito / email confirmado) pré-preenche o campo; `?from=` escolhe
  // o aviso. Só aceita email plausível: a URL pode ter sido escrita por qualquer um.
  const initialEmail = sanitizeEmailParam(email);
  const notice = loginNoticeFor(from, initialEmail !== '');
  return (
    // Mobile: card full-width com paddings generosos. md+: largura travada,
    // sem chrome de card (visual original preservado).
    <div className="mx-auto w-full max-w-sm py-8 md:py-0">
      <div className="mb-8 flex items-center gap-2">
        <span className="font-display text-2xl text-brand" aria-hidden>
          ◢
        </span>
        <span className="font-head text-2xl font-semibold text-text">Leadium</span>
      </div>
      <h1 className="mb-1 font-head text-3xl font-semibold text-text">Entrar</h1>
      <p className="mb-6 font-body text-text-mid">Acesse o seu workspace.</p>
      <LoginForm sessionExpired={sessionExpired} initialEmail={initialEmail} notice={notice} />
    </div>
  );
}
