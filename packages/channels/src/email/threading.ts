/**
 * Encadeamento de e-mail (F60-S03 — CANAIS_PLAN §4.2).
 *
 * A thread se mantém por **cabeçalho**: `Message-ID`, `In-Reply-To` e
 * `References`. Nunca por assunto.
 *
 * Encadear por assunto parece funcionar até o primeiro cliente que responde
 * mudando o texto — e aí a resposta vira uma conversa nova, o atendente perde o
 * contexto e o histórico se parte em dois. "Re:", "RE:", "Fwd:", "ENC:" e a
 * tradução de cada cliente de e-mail tornam a heurística pior a cada idioma.
 *
 * O que o assunto serve é para EXIBIR a thread, não para identificá-la.
 */

/** Prefixos de resposta/encaminhamento em pt, en, es, de e fr. */
const PREFIXOS =
  /^(?:\s*(?:re|res|rsp|fwd|fw|enc|encaminhada|tr|aw|antw)\s*(?:\[\d+\])?\s*:\s*)+/i;

/**
 * Assunto sem os prefixos de resposta, para exibição.
 *
 * NÃO use isto para identificar thread — só para mostrar um título limpo.
 */
export function normalizeSubject(subject: string): string {
  let anterior = subject.trim();
  // Laço porque "Re: Fwd: Re: assunto" tem prefixos aninhados.
  for (let i = 0; i < 10; i += 1) {
    const proximo = anterior.replace(PREFIXOS, '').trim();
    if (proximo === anterior) break;
    anterior = proximo;
  }
  return anterior;
}

/** Assunto de resposta, sem empilhar "Re: Re: Re:". */
export function replySubject(subject: string): string {
  const limpo = normalizeSubject(subject);
  return limpo.length === 0 ? 'Re:' : `Re: ${limpo}`;
}

/**
 * `Message-ID` normalizado: sem os sinais de menor/maior nem espaço.
 *
 * Os cabeçalhos chegam com os sinais e as comparações precisam ser feitas sem
 * eles, senão o mesmo id com e sem sinais vira dois identificadores diferentes.
 */
export function normalizeMessageId(id: string): string {
  return id.trim().replace(/^</, '').replace(/>$/, '').trim();
}

/** Extrai e normaliza os ids de um cabeçalho `References` (separados por espaço). */
export function parseReferences(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(/\s+/)
    .map((r) => normalizeMessageId(r))
    .filter((r) => r.length > 0);
}

/**
 * Cadeia de `References` para a resposta.
 *
 * A regra do RFC 5322: repetir as referências recebidas e acrescentar o
 * `Message-ID` da mensagem que está sendo respondida. É isso que faz cliente de
 * e-mail agrupar a conversa.
 *
 * O teto existe porque thread longa infla o cabeçalho até o provedor recusar;
 * mantemos a raiz e as pontas, que é o que os clientes usam para agrupar.
 */
export function buildReferences(
  received: readonly string[],
  inReplyTo: string | null,
  max = 40,
): string[] {
  const cadeia = [...received.map(normalizeMessageId)].filter((r) => r.length > 0);
  if (inReplyTo) {
    const id = normalizeMessageId(inReplyTo);
    if (id.length > 0 && !cadeia.includes(id)) cadeia.push(id);
  }
  if (cadeia.length <= max) return cadeia;
  const raiz = cadeia[0] as string;
  return [raiz, ...cadeia.slice(cadeia.length - (max - 1))];
}

/**
 * Identificador estável da thread.
 *
 * A raiz da cadeia de `References` é a mesma para toda a conversa, então serve
 * como chave. Sem `References` (primeira mensagem), a própria mensagem é a raiz.
 */
export function threadKeyFrom(input: {
  readonly messageId: string;
  readonly inReplyTo: string | null;
  readonly references: readonly string[];
}): string {
  const refs = input.references.map(normalizeMessageId).filter((r) => r.length > 0);
  if (refs.length > 0) return refs[0] as string;
  if (input.inReplyTo) {
    const id = normalizeMessageId(input.inReplyTo);
    if (id.length > 0) return id;
  }
  return normalizeMessageId(input.messageId);
}
