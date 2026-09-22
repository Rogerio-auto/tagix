/**
 * Telefone digitado por humano → E.164 (F69-S03).
 *
 * A mesma regra conservadora da importação de público (F58-S08), agora do lado do
 * servidor: o lead do formulário de anúncio chega com o telefone como a pessoa
 * digitou, e o worker precisa normalizar sem chutar.
 *
 * **Conservador de propósito.** `(66) 99934-2444` num workspace brasileiro é
 * claramente +55; `5551234` não é nada. Chutar um DDI transformaria um erro visível
 * num envio para o número errado — que custa dinheiro e reputação de remetente.
 */

const E164 = /^\+[1-9]\d{6,14}$/;

export function isE164Phone(phone: string): boolean {
  return E164.test(phone.trim());
}

export type PhoneCountryCode = '55' | '1';

/**
 * Tamanho do número NACIONAL (sem DDI). Brasil: DDD + 8 ou 9. América do Norte: 10.
 *
 * Sem este comprimento, `5551234` passaria como se já tivesse DDI brasileiro,
 * porque começa com "55" e tem sete dígitos — o bastante para o formato E.164.
 */
const TAMANHO_NACIONAL: Readonly<Record<PhoneCountryCode, readonly number[]>> = {
  '55': [10, 11],
  '1': [10],
};

export function normalizeE164(raw: string, defaultCountry: PhoneCountryCode): string | null {
  const limpo = raw.trim();
  if (limpo === '') return null;
  // E.164 explícito: confiar no que a pessoa afirmou, mesmo de outro país.
  if (limpo.startsWith('+') && isE164Phone(limpo)) return limpo;

  const digitos = limpo.replace(/[^0-9]/g, '');
  if (digitos === '') return null;
  const nacionais = TAMANHO_NACIONAL[defaultCountry];

  if (digitos.startsWith(defaultCountry)) {
    const candidato = `+${digitos}`;
    if (nacionais.includes(digitos.length - defaultCountry.length) && isE164Phone(candidato)) {
      return candidato;
    }
  }
  if (nacionais.includes(digitos.length)) {
    const candidato = `+${defaultCountry}${digitos}`;
    if (isE164Phone(candidato)) return candidato;
  }
  return null;
}

/** DDI padrão do mercado do workspace. */
export function countryCodeForMarket(market: 'BR' | 'US'): PhoneCountryCode {
  return market === 'US' ? '1' : '55';
}
