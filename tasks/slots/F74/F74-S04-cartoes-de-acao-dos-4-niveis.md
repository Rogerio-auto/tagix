---
id: F74-S04
title: Cartões de ação dos 4 níveis (recibo com Desfazer, lote com antes e depois, externo com política e Revisei, bloqueios por papel e assinatura)
phase: F74
status: blocked
priority: critical
estimated_size: L
model: opus
ui: true
depends_on: [F74-S01]
blocks: [F74-S03, F74-S07, F74-S09, F74-S10, F74-S11, F74-S12]
source_docs:
  - docs/features/COPILOTO.md
  - docs/decisions/ADR-004-motor-de-acoes-com-confirmacao-humana.md
  - docs/design/copilot-integracoes-ux.md
  - docs/design/copilot-integracoes.html
agent_id: frontend-engineer
---
# F74-S04 — Cartões de ação

## Objetivo

Cada ação do Copiloto aparece com o tratamento do seu nível (A5), sempre a partir do `ProposalDTO` e **sem regra de risco no cliente**:

- **nível 2:** recibo "Feito · Desfazer" com anel de 30 s;
- **nível 3:** cartão com antes → depois, impacto, lista expansível, Confirmar / Ajustar / Cancelar, executando com Parar, concluído, "falhou parcial (movi 5 de 7…)" e desfeito;
- **nível 4:** prévia da mensagem, checagem de política, caixa "Revisei" que libera o botão, "Pausar em vez disso";
- **bloqueios:** por papel, com "Pedir à <gestora>" e o seletor de aprovador, e por assinatura em só leitura.

## Contexto

Os cartões são componentes isolados, que o S03 coloca na linha do tempo, a Atividade (S07) reutiliza e o piloto (S11) também. Desenvolvidos contra o mock do S01 e os estados das fixtures.

## Escopo (faz)

- `apps/web/features/copilot/actions/**`:
  - `RiskMeter.tsx`: medidor de 4 traços + rótulo ("Nível 3 · Em lote"). Cinza para 1–2, `--info` para 3, `--warn` para 4. A cor nunca é o único sinal;
  - `ActionReceipt.tsx` (nível 2), com **o mesmo contrato** que a F76-S07 publica em `@hm/ui` (`<ActionReceipt status="done"|"failed" message undoUntil? onUndo? />`, ver `docs/features/MASCOTE_ANIMACOES.md` §6.6). Quando o da F76 existir, a F74-S12 troca o import e apaga este. O recibo daqui tem: anel de 30 s em SVG (stroke-dashoffset, `prefers-reduced-motion` → contagem textual), Desfazer, e depois do anel "Desfazer fica na Atividade";
  - `BatchActionCard.tsx` (nível 3): estados `proposed | adjusting | executing | completed | partially_completed | failed | undone | cancelled | expired`, como no código da maquete:
    - antes → depois;
    - impacto ("R$ 38.500 saem da previsão do mês", "Avisa Paula e Rafael", critério);
    - `<details>` com a lista (virtualizada acima de 30 itens);
    - Ajustar: tirar itens, trocar destino, desligar o aviso; chama `adjust` e mostra a versão nova;
    - Confirmar mostra a contagem; executando: progresso real por `copilot:proposal_updated` e Parar;
    - parcial: motivo por item e "Tentar as 2 de novo" → `retryFailed`;
    - concluído: Desfazer + "Desfazer fica na Atividade por 24 h";
  - `ExternalActionCard.tsx` (nível 4):
    - prévia da mensagem com as variáveis destacadas e "ver para 3 destinatários";
    - `PolicyChecks` (ok/warn/block com ícone **e** texto);
    - caixa "Revisei…" que habilita o CTA (`aria-disabled` até marcar, com motivo anunciado);
    - CTA `btn-danger` para irreversível;
    - "Pausar em vez disso" chamando `adjust`;
    - concluído com "Cancelar envio" quando houver;
  - `BlockedCard.tsx`:
    - papel: "Seu papel não pode X", com "Pedir à <nome>" (lista de `listApprovers`; um aprovador = botão direto; vários = menu) e "O que meu papel pode fazer" (capacidades de `useCopilot().capabilities`);
    - assinatura: "A assinatura está em modo somente leitura", com "Ver assinatura" e "Continuar só consultando";
  - `useProposalActions(id)`: confirm, adjust, cancel, undo e retry com `Idempotency-Key` por intenção, estado otimista só onde é seguro (nunca marcar "feito" antes do servidor), tratamento de 402/403/409/410/422 com texto em pt-BR;
  - `ActionCard.tsx`: escolhe o componente por `risk_level` + `status` + `blocked_reason`.
- Confirmar no **teclado**: Enter não confirma nível 4 sem o "Revisei" marcado; o foco vai ao primeiro controle do cartão quando ele aparece por gesto da pessoa (não quando aparece sozinho).
- Movimento: o cartão concluído "pousa" com brilho breve (≤ 600 ms, só `opacity` e `box-shadow`); o progresso é linear; reduced motion sem brilho.
- Capturas de cada estado pelo e2e, usando `?copilot_mock_script=<roteiro>&copilot_mock_state=<status>` do mock do S01 (o `apps/web` não tem Ladle; ele só existe em `packages/ui`).
- `apps/web/e2e/specs/copilot-actions.spec.ts`: o fluxo inteiro da A4 com o mock (Confirmar → executando → concluído → Desfazer), o parcial "5 de 7" e o nível 4 (o botão só libera com "Revisei"). Com `copilot_mock_role=AGENT`, o bloqueio por papel e o pedido de aprovação; com `copilot_mock_sub=readonly`, o bloqueio por assinatura.

## Fora de escopo

- Linha do tempo da conversa (S03). Tela de Atividade (S07). Animação dos cards no quadro do pipeline (vem do socket existente; verificado no S12).

### files_allowed

- `apps/web/features/copilot/actions/**`
- `apps/web/e2e/specs/copilot-actions.spec.ts`

### files_forbidden

- `apps/web/features/copilot/core/**`

## Definition of Done

- [ ] Todos os estados de cada cartão, fiéis à A5 e à A4, nos dois temas (capturas 1440 e 375 em `apps/web/e2e/.artifacts/f74-s04/`)
- [ ] Nenhuma regra de nível no cliente (teste: o cartão segue o `risk_level` do DTO, mesmo que o resto "pareça" outro nível)
- [ ] Nível 4: CTA inacessível sem "Revisei" (mouse, teclado e leitor de tela); política com texto, não só cor
- [ ] Desfazer e Confirmar idempotentes no clique duplo (teste: duas chamadas → mesma `Idempotency-Key`)
- [ ] axe sem violação séria; contraste do medidor e dos selos ≥ 3:1 (gráfico) e ≥ 4,5:1 (texto)
- [ ] e2e verde com `--workers=1` (registrado na nota)
- [ ] `/hm-designer` contra A4 e A5

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web exec vitest run features/copilot/actions --maxWorkers=1
pnpm exec eslint apps/web/features/copilot/actions --max-warnings=0
```

## Notas

- Agente: `frontend-engineer` (opus). Paralelo ao S02 (pastas disjuntas); no máximo 2 frontends simultâneos.
- Textos da maquete são o padrão de voz: "Movi 5 de 7. Parei em dois.", "Nada foi perdido", "Dá para desfazer depois".
