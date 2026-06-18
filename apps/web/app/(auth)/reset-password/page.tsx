import { ResetPasswordForm } from '@/features/auth/components/ResetPasswordForm';

export default function ResetPasswordPage() {
  return (
    <div className="mx-auto w-full max-w-sm py-8 md:py-0">
      <div className="mb-8 flex items-center gap-2">
        <span className="font-display text-2xl text-brand" aria-hidden>
          ◢
        </span>
        <span className="font-head text-2xl font-semibold text-text">Highermind</span>
      </div>
      <h1 className="mb-1 font-head text-3xl font-semibold text-text">Redefinir senha</h1>
      <p className="mb-6 font-body text-text-mid">
        Informe seu email e enviaremos as instruções.
      </p>
      <ResetPasswordForm />
    </div>
  );
}
