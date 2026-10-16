import { AuthHeading } from '@/features/auth/components/AuthKit';
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
    <>
      <AuthHeading eyebrow="Acesso" title="Entrar" lead="Acesse o seu workspace." />
      <LoginForm sessionExpired={sessionExpired} initialEmail={initialEmail} notice={notice} />
    </>
  );
}
