---
id: F59-S06
title: Detector de revogação em linguagem natural
phase: F59
status: in-progress
priority: high
estimated_size: M
depends_on: [F59-S03, F59-S04]
blocks: []
source_docs:
  - docs/features/CANAIS_PLAN.md
  - docs/features/AGENCIA_PLAN.md
agent_id: backend-engineer
claimed_at: 2026-09-09T06:24:23Z

---
# F59-S06 — Detector de revogação em linguagem natural

## Objetivo

Detectar, no inbound e antes do agente, que a pessoa quer parar de receber mensagem — mesmo sem
palavra-chave — suprimir na hora, confirmar uma única vez e registrar a evidência.

## Contexto

A regra americana em vigor desde 11/04/2025 diz que o consumidor revoga por **qualquer meio
razoável** e proíbe exigir palavra-chave específica (`AGENCIA_PLAN` §4.1). Casar `STOP` não protege.
Vale para os dois mercados: no Brasil não é a mesma lei, mas ignorar "para de me mandar mensagem"
queima o número do cliente no WhatsApp.

## Escopo

### files_allowed

- `packages/shared/src/revocation.ts`
- `packages/shared/src/revocation.test.ts`
- `packages/shared/src/index.ts`
- `apps/workers/src/inbound/revocation.ts`
- `apps/workers/src/inbound/pipeline.ts`
- `apps/workers/src/inbound/*.test.ts`

### files_forbidden

- `apps/workers/src/outbound/**`
- `packages/db/src/schema/**`

## Escopo (faz)

- **Camada 1, determinística:** normaliza (minúscula, sem acento, sem pontuação) e casa as
  `optOutKeywords` do market pack, isoladas ou como mensagem inteira curta.
- **Camada 2, classificador:** só roda quando a 1 não casa **e** a mensagem é curta (≤ 120 caracteres).
  Classifica intenção de revogação em pt e en, devolvendo confiança.
- Ao detectar: cria supressão (escopo de canal, ou global quando a fala é genérica), envia **uma
  única** mensagem de esclarecimento (permitida pela regra), registra evidência com texto original,
  classificação e confiança, e notifica o atendente.
- Corre **antes** do agente: a pessoa que pediu para parar não recebe resposta automática de venda.

## Fora de escopo

- Alterar o schema de supressão (F59-S03).
- UI de revisão das revogações.

## Definition of Done

- [ ] Camada 1 cobre pt e en em ambos os mercados; teste com `PARE`, `stop`, `Stop.`, `SAIR`, `cancelar`.
- [ ] Camada 2 só é chamada quando a 1 falha e a mensagem é curta — teste confirma que mensagem longa não gasta chamada de modelo.
- [ ] Falso positivo é o risco caro: "não para de chegar lead, que bom" **não** pode suprimir. Suíte de negativos com pelo menos 15 frases ambíguas em pt.
- [ ] Confiança abaixo do limiar não suprime sozinha — marca para revisão humana e notifica, sem bloquear o canal.
- [ ] A mensagem de esclarecimento é enviada **uma vez** e é idempotente por contato/canal.
- [ ] Supressão é imediata; a lei dá 10 dias úteis, o produto honra no primeiro segundo.
- [ ] Revogação genérica ("não quero mais nada de vocês") gera supressão de escopo **empresa**, não só do canal.
- [ ] Métrica `hm.revocation.detected{layer,channel,market}`.

## Validação

```bash
pnpm --filter @hm/shared typecheck
pnpm --filter @hm/shared test
pnpm --filter @hm/workers typecheck
pnpm --filter @hm/workers test
```

## Notas

- O conteúdo da mensagem do contato entra no prompt como **dado, nunca instrução** — o endurecimento
  anti-injeção da F56-S11 se aplica.
- Custo: a camada 2 só vê mensagens curtas que não casaram palavra-chave. Volume baixo por desenho.
- Limiar inicial sugerido: suprime acima de 0,85; entre 0,60 e 0,85 marca para revisão. Ajustar com
  dado real depois dos primeiros clientes.
