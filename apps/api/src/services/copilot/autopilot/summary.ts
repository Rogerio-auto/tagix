/**
 * Texto do resultado de "aprovar/recusar sugestões" (F73-S13): "Aprovadas 7, puladas 1 (editada
 * por Paula)". Modelo de texto, duas famílias (pt e en, como o Briefing). Só nomes de membros e
 * contagens; nada de dado de cliente.
 */
export type DecideItemStatus =
  | 'approved'
  | 'rejected'
  | 'skipped'
  | 'not_found'
  | 'awaiting_confirmation';

export type DecideSkipReason =
  | 'already_decided'
  | 'no_longer_in_stage'
  | 'edited'
  | 'policy'
  | 'failed'
  | 'blocked';

export interface DecideItem {
  readonly id: string;
  readonly status: DecideItemStatus;
  readonly reason?: DecideSkipReason;
  /** Quem editou o negócio depois da sugestão (`reason: 'edited'`), quando se sabe. */
  readonly edited_by?: string;
  /** Proposta do motor que moveu (ou vai mover) o negócio. */
  readonly proposal_id?: string;
}

type Family = 'pt' | 'en';

export function summaryFamily(locale: string): Family {
  return locale.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

const REASON_TEXT: Record<Family, Record<Exclude<DecideSkipReason, 'edited'>, [string, string]>> = {
  pt: {
    already_decided: ['já decidida', 'já decididas'],
    no_longer_in_stage: ['saiu do estágio', 'saíram do estágio'],
    policy: ['o destino exige aprovação no Pipeline', 'o destino exige aprovação no Pipeline'],
    failed: ['não foi possível mover', 'não foi possível mover'],
    blocked: ['bloqueada pelas configurações', 'bloqueadas pelas configurações'],
  },
  en: {
    already_decided: ['already decided', 'already decided'],
    no_longer_in_stage: ['left the stage', 'left the stage'],
    policy: [
      'the destination requires approval in the Pipeline',
      'the destination requires approval in the Pipeline',
    ],
    failed: ['could not be moved', 'could not be moved'],
    blocked: ['blocked by settings', 'blocked by settings'],
  },
};

function joinNames(names: readonly string[], family: Family): string {
  if (names.length <= 1) return names[0] ?? '';
  const last = names[names.length - 1] ?? '';
  return `${names.slice(0, -1).join(', ')} ${family === 'pt' ? 'e' : 'and'} ${last}`;
}

/** Parênteses das puladas: "editada por Paula", "2 já decididas". */
function skippedReasons(skipped: readonly DecideItem[], family: Family): string {
  const counts = new Map<DecideSkipReason, number>();
  const editors: string[] = [];
  for (const item of skipped) {
    const reason = item.reason ?? 'failed';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
    if (reason === 'edited' && item.edited_by && !editors.includes(item.edited_by)) {
      editors.push(item.edited_by);
    }
  }
  const phrases: string[] = [];
  for (const [reason, n] of counts) {
    if (reason === 'edited') {
      const by = joinNames(editors, family);
      if (family === 'pt') {
        const base = n === 1 ? 'editada' : 'editadas';
        phrases.push(
          `${n > 1 ? `${n} ` : ''}${by ? `${base} por ${by}` : `${base} depois da sugestão`}`,
        );
      } else {
        phrases.push(
          `${n > 1 ? `${n} ` : ''}${by ? `edited by ${by}` : 'edited after the suggestion'}`,
        );
      }
      continue;
    }
    const [one, many] = REASON_TEXT[family][reason];
    phrases.push(n === 1 ? one : `${n} ${many}`);
  }
  return phrases.join('; ');
}

export interface SummaryInput {
  readonly family: Family;
  readonly decision: 'approve' | 'reject';
  readonly done: number;
  readonly skipped: readonly DecideItem[];
  readonly notFound: number;
  readonly awaiting: number;
}

export function summarizeDecision(input: SummaryInput): string {
  const { family } = input;
  const head =
    family === 'pt'
      ? `${input.decision === 'approve' ? 'Aprovadas' : 'Recusadas'} ${input.done}`
      : `${input.decision === 'approve' ? 'Approved' : 'Rejected'} ${input.done}`;
  const parts = [head];
  if (input.awaiting > 0) {
    parts.push(
      family === 'pt'
        ? `aguardando confirmação ${input.awaiting}`
        : `awaiting confirmation ${input.awaiting}`,
    );
  }
  if (input.skipped.length > 0) {
    const why = skippedReasons(input.skipped, family);
    parts.push(
      `${family === 'pt' ? 'puladas' : 'skipped'} ${input.skipped.length}${why ? ` (${why})` : ''}`,
    );
  }
  if (input.notFound > 0) {
    parts.push(
      family === 'pt' ? `não encontradas ${input.notFound}` : `not found ${input.notFound}`,
    );
  }
  return parts.join(', ');
}
