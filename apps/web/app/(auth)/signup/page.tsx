import { SignupForm } from '@/features/auth/components/SignupForm';

/**
 * O título mora no `SignupForm`: ele troca para "Verifique seu email" quando o link sai
 * (ressalva da F71-S09 — antes o H1 seguia "Criar conta" na tela de confirmação).
 */
export default function SignupPage() {
  return <SignupForm />;
}
