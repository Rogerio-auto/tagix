/**
 * Denylist de domínios de email descartável/temporário (F44 decisão #4).
 * Bloqueio leve no signup self-serve — reduz mass-signup com contas throwaway.
 * Lista curada dos provedores mais comuns; não pretende ser exaustiva (defesa em
 * camadas com rate-limit + captcha). Comparação exata por domínio, lowercase.
 */
export const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'mailinator.com',
  'temp-mail.org',
  'tempmail.com',
  'guerrillamail.com',
  'guerrillamail.info',
  'sharklasers.com',
  '10minutemail.com',
  '10minutemail.net',
  'throwawaymail.com',
  'yopmail.com',
  'getnada.com',
  'maildrop.cc',
  'dispostable.com',
  'trashmail.com',
  'fakeinbox.com',
  'mailnesia.com',
  'mintemail.com',
  'mohmal.com',
  'emailondeck.com',
  'tempinbox.com',
  'spamgourmet.com',
  'mytemp.email',
  'tempmailo.com',
  'moakt.com',
  'inboxkitten.com',
]);
