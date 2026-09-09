---
id: F59-S04
title: Portão de consentimento como serviço único
phase: F59
status: review
priority: critical
estimated_size: M
depends_on: [F59-S01, F59-S03]
blocks: [F59-S05, F59-S06]
source_docs:
  - docs/features/AGENCIA_PLAN.md
agent_id: backend-engineer
claimed_at: 2026-09-09T05:49:26Z
completed_at: 2026-09-09T06:05:55Z

---
# F59-S04 — Portão de consentimento como serviço único

## Objetivo

Uma função, testada, que decide se uma mensagem pode sair: consulta supressão, consentimento por
canal e finalidade, janela horária no fuso do contato e estado de registro do canal. Devolve
autorização ou recusa **com motivo estável**.

## Contexto

`AGENCIA_PLAN` §4.4: o portão precisa ser código, não disciplina — "a pessoa apressada às 23h não vai
lembrar da regra". Este slot cria o serviço; F59-S05 o pluga nos três pontos de chamada.

## Escopo

### files_allowed

- `apps/api/src/services/consent/**`
- `packages/shared/src/consent.ts`
- `packages/shared/src/index.ts`

### files_forbidden

- `apps/workers/**`
- `packages/db/src/schema/**`

## Contratos

```ts
export type OutboundDenyReason =
  | 'suppressed'            // supressão global ou de canal
  | 'no_consent'            // marketing sem consentimento onde o mercado exige
  | 'quiet_hours'           // fora da janela legal no fuso do contato
  | 'registration_pending'  // 10DLC não aprovado
  | 'channel_disabled';     // canal não habilitado no market pack

export type OutboundDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: OutboundDenyReason;
      readonly message: string; readonly retryAt?: Date };

export function decideOutbound(input: {
  readonly market: MarketCode;
  readonly channel: ChannelKind;
  readonly purpose: MessagePurpose;
  readonly consent: ConsentSnapshot;
  readonly contactTimezone: string | null;
  readonly channelRegistration: 'none' | 'pending' | 'approved';
  readonly now: Date;
}): OutboundDecision;
```

## Definition of Done

- [ ] `decideOutbound` é **pura**: recebe `now` e o snapshot, não consulta banco nem relógio. O I/O fica no serviço que a chama.
- [ ] Ordem de avaliação fixa e testada: supressão → canal habilitado → registro → consentimento → janela horária. Supressão sempre vence.
- [ ] `purpose: 'transactional'` **nunca** é bloqueado por `no_consent` — confirmação de agendamento não é marketing. Bloqueia por supressão, sim.
- [ ] Janela horária usa o fuso do contato; quando `contactTimezone` é nulo, cai no `defaultTimezone` do market pack, e isso é registrado na decisão.
- [ ] `retryAt` vem preenchido em `quiet_hours` com o próximo horário permitido no fuso correto — o chamador reagenda em vez de descartar.
- [ ] Recusa **nunca é silenciosa**: cada `allowed: false` produz `message` pronta para log e para exibição ao atendente.
- [ ] Testes com fuso real cobrindo virada de dia e horário de verão americano (contato em `America/New_York` às 20h59 e 21h00 locais).
- [ ] Serviço em `apps/api/src/services/consent/` carrega o snapshot sob RLS e delega a decisão à função pura.

## Validação

```bash
pnpm --filter @hm/shared typecheck
pnpm --filter @hm/shared test
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api test
```

## Notas

- Horário de verão é o ponto onde implementação ingênua erra. Usar `Intl.DateTimeFormat` com
  `timeZone`, nunca aritmética de offset fixo.
- A decisão é auditável de propósito: o motivo é enum estável, não string livre, para virar métrica.

## Decisões tomadas na execução (2026-09-09)

1. **`checkOutboundInTx` além de `checkOutbound`.** O worker de campanha resolve centenas de
   destinatários; abrir um `withWorkspace` por destinatário seria uma transação por mensagem.
   A variante recebe a `tx` já aberta. A regra pura é a mesma nas duas — só muda quem abre a conexão.
2. **Workspace/contato inexistente é RECUSA, não exceção.** O caminho de envio precisa de decisão,
   não de stack trace. Recusa com `reason: 'suppressed'` (o mais restritivo) e mensagem explícita.
3. **Mercado corrompido no banco cai em `BR`, não estoura.** `isMarketCode` filtra; o valor default
   da coluna é `BR` e todo workspace existente é brasileiro.
4. **`retryAt` calcula o offset duas vezes.** Na virada de horário de verão, o offset do momento
   atual não é o do momento alvo — uma passada só erra a hora local em uma hora, exatamente na noite
   em que a janela legal mais importa. Teste cobre 01/11/2026.
5. **`localHourIn` exportada.** É usada no teste para asserir a hora local do `retryAt`, e vai
   servir ao agendador da F59-S05 para agrupar destinatários por janela.

## Achado de ambiente

`pnpm --filter @hm/api test` exige **RabbitMQ**, além de Postgres e Redis: `app.test.ts` (health) e
`routes/v1/routes.test.ts` falham com `ECONNREFUSED 127.0.0.1:5672` sem ele. Não estava óbvio.
Com os três no ar: 1021 testes, todos verdes.
