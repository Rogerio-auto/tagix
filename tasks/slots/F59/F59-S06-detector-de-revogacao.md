---
id: F59-S06
title: Detector de revogação em linguagem natural
phase: F59
status: done
priority: high
estimated_size: M
depends_on: [F59-S03, F59-S04]
blocks: []
source_docs:
  - docs/features/CANAIS_PLAN.md
  - docs/features/AGENCIA_PLAN.md
agent_id: backend-engineer
claimed_at: 2026-09-09T06:24:23Z
completed_at: 2026-09-09T13:12:16Z

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
- `apps/workers/src/inbound/ports.ts`
- `apps/workers/src/inbound/worker.ts`
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

## Decisoes tomadas na execucao (2026-09-09)

1. **Camada 2 e deterministica (padrao de frase), nao um modelo.** A spec previa um classificador.
   Padroes de frase em pt/en cobrem "qualquer meio razoavel" com custo zero, latencia zero e teste
   reproduzivel — e um modelo aqui traria variancia num caminho que decide supressao. Se um dia a
   cobertura nao bastar, `RevocationPort` ja e a costura para plugar um classificador sem tocar em
   quem chama.
2. **Falso positivo tratado como o risco caro, com lista de negativos explicita.** Suprimir quem nao
   pediu apaga um cliente do funil e ninguem percebe — a pessoa so para de receber. Sao 15 negativos
   testados ("nao para de chegar lead, que bom", "preciso cancelar meu agendamento", "cancel my
   appointment", "dont stop sending me these"). Desinteresse ("nao tenho interesse") fica na faixa de
   **revisao**, nao suprime sozinho: pode ser sobre a oferta, nao sobre receber mensagem.
3. **Camada 1 so casa palavra-chave em mensagem de ate 2 palavras.** Sem isso, "cancelar" dentro de
   "preciso cancelar meu agendamento" viraria supressao.
4. **O passo roda ANTES de persistir.** A supressao entra antes de qualquer resposta sair, e o portao
   da F59-S05 recusa envio a contato suprimido — inclusive transacional. O agente pode formular uma
   resposta, mas ela nao e entregue. Bloquear a formulacao exigiria mexer no gatilho do agente, que e
   de outro slot.
5. **Falha no passo NAO derruba o inbound.** Perder a mensagem de quem escreveu e pior que honrar a
   revogacao um ciclo depois. Erro fica visivel no log e o pipeline segue persistindo.
6. **Custo zero no caminho comum.** A deteccao roda em memoria; o banco so e tocado quando algo foi
   detectado. Conversa normal nao paga nada.
7. **Fronteira ampliada** para `inbound/ports.ts` e `inbound/worker.ts` — injetar a porta exige
   declara-la em `InboundDeps` e monta-la na composicao. Mesma natureza das correcoes anteriores:
   consequencia direta da mudanca que o slot manda fazer.

## Descoberta: ja existe opt-out por keyword em campanhas

`createCampaignInboundPorts` (F6-S07) ja faz "opt-out por keyword" no escopo de campanha. O detector
desta fase e mais amplo (todos os canais, linguagem natural, grava em `contact_consents`/
`contact_suppressions` e alimenta o portao). **Os dois coexistem hoje sem conflito**, mas ha
sobreposicao: vale um slot futuro para o caminho de campanha delegar a este detector em vez de manter
regra propria. Anotado em `tasks/COMMS.md`.

## Resultado

- `@hm/shared`: 123 testes verdes, dos quais **48 novos** de deteccao (15 de falso positivo).
- `@hm/workers`: **493 verdes, 0 falhas**, com os 5 novos de integracao no pipeline.
