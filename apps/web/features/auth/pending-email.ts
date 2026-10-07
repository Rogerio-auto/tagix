/**
 * Guarda o email do último cadastro neste navegador para fechar o ciclo: o link de
 * confirmação abre sem o email (o token não o carrega), e o login precisa chegar
 * preenchido depois do "Email confirmado". Fica em `localStorage` porque o link do
 * email costuma abrir em OUTRA aba. É só conveniência de preenchimento — nunca
 * credencial — e é apagado assim que usado.
 */
const KEY = 'leadium.signup-email';

export function rememberSignupEmail(email: string): void {
  try {
    window.localStorage.setItem(KEY, email);
  } catch {
    // armazenamento bloqueado (modo privado): só perde o preenchimento.
  }
}

export function readSignupEmail(): string {
  try {
    return window.localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function forgetSignupEmail(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // idem
  }
}
