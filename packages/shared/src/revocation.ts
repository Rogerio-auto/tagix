/**
 * Detector de revogação (F59-S06 — AGENCIA_PLAN.md §4.1).
 *
 * A regra americana em vigor desde 11/04/2025 diz que o consumidor revoga por
 * **qualquer meio razoável** e proíbe exigir palavra-chave específica. Casar
 * `STOP` não protege: "para de me mandar mensagem" conta igual.
 *
 * Vale para os dois mercados. No Brasil não é a mesma lei, mas ignorar um pedido
 * de parada queima o número do cliente na Meta — o custo é o mesmo, cobrado por
 * outra via.
 *
 * Duas camadas, ambas determinísticas:
 *   1. palavra-chave isolada (`STOP`, `PARE`, `SAIR`…) — confiança máxima
 *   2. padrão de frase em pt/en, com confiança — cobre o "qualquer meio razoável"
 *
 * **O risco caro aqui é o falso positivo.** Suprimir quem não pediu apaga um
 * cliente do funil, e ninguém percebe: a pessoa simplesmente para de receber. Por
 * isso a camada 2 tem lista de negativos explícita e teto de tamanho — texto
 * longo é conversa, não comando.
 */

/** O que fazer com a mensagem detectada. */
export type RevocationScope = 'channel' | 'company';

export interface RevocationDetection {
  readonly detected: boolean;
  /** 0..1 — a camada 1 devolve 1. */
  readonly confidence: number;
  /** Qual camada decidiu; entra na evidência e na métrica. */
  readonly layer: 'keyword' | 'phrase' | 'none';
  /**
   * Escopo pedido. Fala genérica ("não quero mais nada de vocês") revoga a
   * empresa inteira; pedido dentro de um canal revoga o canal.
   */
  readonly scope: RevocationScope;
  /** Trecho que disparou a detecção — evidência auditável. */
  readonly matched?: string;
}

const NAO_DETECTADO: RevocationDetection = {
  detected: false,
  confidence: 0,
  layer: 'none',
  scope: 'channel',
};

/** Acima disto, suprime sozinho. Entre o piso e este valor, marca para revisão. */
export const REVOCATION_AUTO_THRESHOLD = 0.85;
/** Abaixo disto, ignora. */
export const REVOCATION_REVIEW_THRESHOLD = 0.6;

/**
 * Teto de tamanho da camada 2. Quem escreve um parágrafo está conversando; quem
 * quer parar escreve pouco. O teto também é o que segura o custo se um dia entrar
 * uma camada com modelo.
 */
export const MAX_PHRASE_LENGTH = 120;

/** Minúsculas, sem acento, sem pontuação, espaços colapsados. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Frases que PARECEM revogação e não são. Verificadas antes de tudo — sem esta
 * lista, "não para de chegar lead, que bom" viraria supressão de um cliente feliz.
 */
const NEGATIVOS: readonly RegExp[] = [
  /\bnao para de (chegar|entrar|vir|aparecer)\b/u,
  /\bnao parou de (chegar|entrar|vir|aparecer)\b/u,
  /\bnao pare de (mandar|enviar|me mandar)\b/u,
  /\bpode (continuar|mandar|seguir)\b/u,
  /\bnao quero parar\b/u,
  /\bnao precisa parar\b/u,
  /\bdont stop\b/u,
  /\bkeep (sending|me posted|going)\b/u,
  /\bnao e para parar\b/u,
  /\bnao cancela\b/u,
  /\bnao cancele\b/u,
  /\bnao quero cancelar\b/u,
  // Pergunta sobre cancelamento de serviço não é pedido de parar mensagem.
  /\bcomo (faco|faz|posso) para cancelar (o|meu|a|minha) (servico|plano|assinatura|contrato)\b/u,
  /\bcancelar (o|meu|a|minha) (agendamento|horario|consulta|visita|orcamento)\b/u,
  /\bcancel (my|the) (appointment|booking|visit|estimate)\b/u,
];

/** Padrões que indicam pedido de parar, com confiança e escopo. */
const PADROES: readonly {
  readonly re: RegExp;
  readonly confidence: number;
  readonly scope: RevocationScope;
}[] = [
  // Escopo de empresa — fala genérica sobre "vocês".
  { re: /\bnao quero (mais )?(receber )?nada de voces\b/u, confidence: 0.95, scope: 'company' },
  { re: /\bnao quero mais contato\b/u, confidence: 0.92, scope: 'company' },
  { re: /\bme (tira|tire|remova|remove) (dessa|desta|da) lista\b/u, confidence: 0.95, scope: 'company' },
  { re: /\bme (tira|tire|remova|remove) daqui\b/u, confidence: 0.88, scope: 'company' },
  { re: /\bme (descadastr|desinscrev)\w*\b/u, confidence: 0.95, scope: 'company' },
  { re: /\bremove me from (your|the) list\b/u, confidence: 0.95, scope: 'company' },
  { re: /\btake me off (your|the) list\b/u, confidence: 0.95, scope: 'company' },
  { re: /\bi (dont|do not) want (anything|any more|anymore) from you\b/u, confidence: 0.93, scope: 'company' },

  // Escopo de canal — pedido sobre as mensagens.
  { re: /\b(para|parem|pare) de (me )?(mandar|enviar)\b/u, confidence: 0.93, scope: 'channel' },
  { re: /\bnao (me )?(mande|manda|mandem|envie|envia) mais\b/u, confidence: 0.93, scope: 'channel' },
  { re: /\bnao quero (mais )?receber (mais )?(essas |suas |as )?(mensagens|mensagem|msg)\b/u, confidence: 0.94, scope: 'channel' },
  { re: /\bnao me (mande|manda|envie|perturbe|incomode)\b/u, confidence: 0.9, scope: 'channel' },
  { re: /\bpare com (essas|as) mensagens\b/u, confidence: 0.94, scope: 'channel' },
  { re: /\bchega de mensagens?\b/u, confidence: 0.9, scope: 'channel' },
  { re: /\bstop (texting|messaging|sending|emailing) me\b/u, confidence: 0.95, scope: 'channel' },
  { re: /\b(dont|do not) (text|message|email|contact) me( again| anymore)?\b/u, confidence: 0.93, scope: 'channel' },
  { re: /\bno more (texts|messages|emails)\b/u, confidence: 0.93, scope: 'channel' },
  { re: /\bunsubscribe me\b/u, confidence: 0.95, scope: 'channel' },

  // Desinteresse explícito — mais fraco, cai na faixa de revisão.
  { re: /\bnao tenho interesse\b/u, confidence: 0.72, scope: 'channel' },
  { re: /\bsem interesse\b/u, confidence: 0.68, scope: 'channel' },
  { re: /\b(not|no longer) interested\b/u, confidence: 0.72, scope: 'channel' },
];

/**
 * Detecta pedido de revogação.
 *
 * @param text mensagem recebida do contato
 * @param optOutKeywords palavras-chave do market pack (já normalizadas)
 */
export function detectRevocation(
  text: string,
  optOutKeywords: readonly string[],
): RevocationDetection {
  const limpo = normalize(text);
  if (limpo.length === 0) return NAO_DETECTADO;

  // Camada 1 — palavra-chave. Vale quando a mensagem É a palavra (com no máximo
  // uma palavra de cortesia junto: "stop please", "por favor pare"). Exigir a
  // mensagem inteira evita casar "cancel" dentro de "cancelar meu agendamento".
  const palavras = limpo.split(' ');
  if (palavras.length <= 2) {
    for (const kw of optOutKeywords) {
      if (palavras.includes(kw)) {
        return { detected: true, confidence: 1, layer: 'keyword', scope: 'company', matched: kw };
      }
    }
  }

  // Camada 2 — padrão de frase. Só para texto curto: parágrafo é conversa.
  if (limpo.length > MAX_PHRASE_LENGTH) return NAO_DETECTADO;

  for (const neg of NEGATIVOS) {
    if (neg.test(limpo)) return NAO_DETECTADO;
  }

  let melhor: RevocationDetection = NAO_DETECTADO;
  for (const p of PADROES) {
    const m = p.re.exec(limpo);
    if (m === null) continue;
    if (p.confidence <= melhor.confidence) continue;
    melhor = {
      detected: true,
      confidence: p.confidence,
      layer: 'phrase',
      scope: p.scope,
      matched: m[0],
    };
  }

  if (melhor.confidence < REVOCATION_REVIEW_THRESHOLD) return NAO_DETECTADO;
  return melhor;
}

/** O que fazer com a detecção. */
export type RevocationAction = 'suppress' | 'review' | 'ignore';

export function actionFor(detection: RevocationDetection): RevocationAction {
  if (!detection.detected) return 'ignore';
  if (detection.confidence >= REVOCATION_AUTO_THRESHOLD) return 'suppress';
  if (detection.confidence >= REVOCATION_REVIEW_THRESHOLD) return 'review';
  return 'ignore';
}
