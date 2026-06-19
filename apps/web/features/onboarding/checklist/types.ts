/**
 * Tipos do checklist "Primeiros passos" (F43-S06). Espelham o contrato da API
 * (F43-S04): `GET /api/onboarding/checklist` → `{ steps: ChecklistStep[] }`.
 *
 * O estado de cada passo é **derivado do dado real** no servidor (sem checkbox
 * manual): conectar canal, ativar agente, importar contatos, publicar fluxo,
 * enviar campanha. Aqui só consumimos e renderizamos.
 */

/** Um passo do checklist, derivado do dado real do workspace (S04). */
export interface ChecklistStep {
  /** Chave estável do passo (ex.: 'connect_channel'). */
  key: string;
  /** Rótulo pt-BR exibido (ex.: 'Conectar o WhatsApp'). */
  label: string;
  /** Se o passo já foi concluído (derivado no backend). */
  done: boolean;
  /** Rota interna para onde o CTA leva (ex.: '/settings/channels'). */
  href: string;
}

/** Resposta de `GET /api/onboarding/checklist`. */
export interface ChecklistResponse {
  steps: ChecklistStep[];
}
