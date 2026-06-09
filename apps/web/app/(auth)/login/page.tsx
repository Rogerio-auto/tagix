import { LoginForm } from '@/features/auth/components/LoginForm';

export default function LoginPage() {
  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 flex items-center gap-2">
        <span className="font-display text-2xl text-brand" aria-hidden>
          ◢
        </span>
        <span className="font-head text-2xl font-semibold text-text">Highermind</span>
      </div>
      <h1 className="mb-1 font-head text-3xl font-semibold text-text">Entrar</h1>
      <p className="mb-6 font-body text-text-mid">Acesse o seu workspace.</p>
      <LoginForm />
    </div>
  );
}
