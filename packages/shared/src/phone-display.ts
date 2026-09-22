/**
 * Telefone em formato humano (F61-S12).
 *
 * ## Por que existe
 *
 * 199 dos 200 contatos de produção não têm nome — o parser do WhatsApp nunca lia
 * `profile.name`. A tela "Hoje" respondia a isso escrevendo "Contato sem nome"
 * em quase toda linha, e uma lista de leads indistinguíveis não é uma lista.
 *
 * Mas todo contato TEM telefone: é a chave de `uq_contacts_workspace_phone` e o
 * próprio `remote_id` da conversa. A tela tinha identidade para mostrar e
 * escolhia não mostrar. Um telefone identifica um lead; "sem nome" não
 * identifica nada e ainda soa como defeito do produto.
 *
 * ## O formato vem do número, não da configuração
 *
 * O DDI está dentro do próprio E.164, então ele decide o formato. Usar o market
 * pack do workspace erraria justamente no caso que importa: o cliente brasileiro
 * nos EUA, que atende os dois.
 *
 * **Desconhecido devolve o E.164 como está.** Formatar um número sem saber a
 * regra do país produz um número que parece errado — e um telefone que parece
 * errado não é discado.
 */

/** Só dígitos, e o `+` inicial se houver. */
function digitos(raw: string): string {
  return raw.replace(/[^0-9]/g, '');
}

/**
 * Brasil (+55): `(66) 99934-2444` (celular, 9 dígitos) ou `(66) 3934-2444` (fixo).
 * O 9º dígito não é universal nem obrigatório em número antigo, então o formato
 * segue o que o número tem, não o que deveria ter.
 */
function formatarBR(nsn: string): string | null {
  if (nsn.length !== 10 && nsn.length !== 11) return null;
  const ddd = nsn.slice(0, 2);
  const resto = nsn.slice(2);
  const corte = resto.length - 4;
  return `(${ddd}) ${resto.slice(0, corte)}-${resto.slice(corte)}`;
}

/** América do Norte (+1): `(305) 555-0142`. */
function formatarNANP(nsn: string): string | null {
  if (nsn.length !== 10) return null;
  return `(${nsn.slice(0, 3)}) ${nsn.slice(3, 6)}-${nsn.slice(6)}`;
}

/**
 * Formata para exibição. Nunca lança, nunca inventa: o que não reconhece volta
 * como veio.
 */
export function formatPhoneForDisplay(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const bruto = raw.trim();
  if (bruto === '') return null;

  const d = digitos(bruto);
  if (d === '') return null;

  if (d.startsWith('55')) {
    const br = formatarBR(d.slice(2));
    if (br !== null) return br;
  }
  if (d.startsWith('1')) {
    const na = formatarNANP(d.slice(1));
    if (na !== null) return na;
  }
  // Número local sem DDI, do tamanho brasileiro — o caso do dado digitado à mão.
  if (!bruto.startsWith('+')) {
    const br = formatarBR(d);
    if (br !== null) return br;
  }

  // Desconhecido: devolve legível, com o `+` que o E.164 exige.
  return bruto.startsWith('+') ? bruto : `+${d}`;
}
