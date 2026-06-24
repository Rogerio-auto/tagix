/**
 * Cliente ViaCEP — autopreenchimento de endereço a partir do CEP (F47-S06).
 *
 * Faz `GET https://viacep.com.br/ws/<cep>/json/` com timeout e tratamento de erro
 * sem `any`. O resultado é discriminado (`ok` | `not_found` | `invalid` | `error`)
 * para que a UI renderize o erro em 3 partes (UX_PRINCIPLES §2.11), nunca um throw
 * cru. A normalização para o shape do nosso cadastro (`street/district/city/state`)
 * acontece aqui — o consumidor recebe campos já no nosso vocabulário.
 */

/** Resposta crua da ViaCEP (campos relevantes). `erro: true` = CEP inexistente. */
interface ViaCepRaw {
  cep?: string;
  logradouro?: string;
  complemento?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
}

/** Endereço normalizado para o nosso vocabulário de cadastro. */
export interface ViaCepAddress {
  cep: string;
  street: string;
  district: string;
  city: string;
  state: string;
}

export type ViaCepResult =
  /** CEP válido e encontrado — campos prontos para preencher. */
  | { status: 'ok'; address: ViaCepAddress }
  /** Formato de CEP inválido (não tem 8 dígitos). */
  | { status: 'invalid' }
  /** CEP bem-formado, mas inexistente nos Correios. */
  | { status: 'not_found' }
  /** Falha de rede/timeout/serviço indisponível. */
  | { status: 'error' };

const VIACEP_TIMEOUT_MS = 6000;

/** Remove tudo que não é dígito do CEP digitado. */
function cepDigits(cep: string): string {
  return cep.replace(/\D/g, '');
}

/**
 * Busca o endereço de um CEP na ViaCEP. Nunca lança — resolve sempre num
 * `ViaCepResult` discriminado. O caller decide a UI a partir do `status`.
 */
export async function fetchCep(cep: string): Promise<ViaCepResult> {
  const digits = cepDigits(cep);
  if (digits.length !== 8) return { status: 'invalid' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VIACEP_TIMEOUT_MS);

  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return { status: 'error' };

    const data = (await res.json()) as ViaCepRaw;
    if (data.erro === true) return { status: 'not_found' };

    return {
      status: 'ok',
      address: {
        cep: data.cep ?? formatCep(digits),
        street: data.logradouro ?? '',
        district: data.bairro ?? '',
        city: data.localidade ?? '',
        state: (data.uf ?? '').toUpperCase(),
      },
    };
  } catch {
    // AbortError (timeout) ou falha de rede caem aqui — UI mostra erro genérico.
    return { status: 'error' };
  } finally {
    clearTimeout(timer);
  }
}

/** Formata 8 dígitos como `00000-000`. */
export function formatCep(cep: string): string {
  const d = cepDigits(cep).slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}
