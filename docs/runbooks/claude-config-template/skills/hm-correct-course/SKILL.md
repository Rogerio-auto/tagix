---
name: hm-correct-course
description: Detecta desvio de plano durante execução de uma fase ou feature e propõe correção estruturada. Use quando o Rogério disser "corrige o curso", "estamos longe do plano", "isso não era pra ser assim" — ou quando você (orchestrator) perceber drift entre o que foi planejado nos docs/PRD/ROADMAP e o que os slots estão entregando.
---

# /hm-correct-course — Correção de curso

Você está em **modo gestor de mudança**. Algo mudou: o escopo, a realidade técnica, o entendimento, ou o time bateu numa parede. Sua função NÃO é implementar a correção — é diagnosticar o desvio e propor um caminho concreto.

## Postura

- Honestidade brutal sobre o desvio. Sem suavização.
- Sem replanejamento total: a maioria dos desvios não exige refundação, só ajuste de slots futuros.
- Decisão tomada pelo Rogério no fim. Você apresenta opções, não decreta.

## Entradas

- **gatilho** — o que aconteceu. Pode ser: bug fundamental descoberto, decisão técnica que precisa mudar, dependência externa indisponível, escopo que cresceu, deadline encurtado, ou só "isso aqui não tá fazendo sentido".
- **fase atual** — qual fase do `docs/ROADMAP.md` está em execução (ex: F2, F1.5).
- **slots em voo** — quais slots estão `in_progress` ou `available` afetados.

## Execução

### 1. Diagnóstico do desvio

Leia em ordem:

1. **`docs/PRD.md`** — o que prometemos entregar e por quê.
2. **`docs/ARCHITECTURE.md`** + **`docs/DATA_MODEL.md`** — as decisões travadas.
3. **`docs/ROADMAP.md`** — a sequência planejada de fases e slots.
4. **`tasks/STATUS.md`** — estado real dos slots agora.
5. **`tasks/COMMS.md` (últimas 50 linhas)** — o que os agentes andaram conversando.
6. Os 2-3 slots mais recentes fechados em `tasks/slots/<fase>/` — o que foi de fato entregue.

Escreva o diagnóstico em 3-5 linhas:

- **O que mudou:** descrição concreta do gatilho, com referência a arquivo/linha/decisão.
- **Por que mudou:** causa raiz (não é "alguém esqueceu" — é "a decisão X assumia Y que se mostrou falso").
- **O que isso quebra:** decisões/slots/docs que ficam inconsistentes com a nova realidade.

### 2. Classificação do impacto

Categorize o desvio:

| Categoria | Sintoma | Ação típica |
|---|---|---|
| **Local** | Afeta 1-2 slots da fase corrente, sem mudar decisões dos docs | Replanejar slots, atualizar `tasks/slots/` |
| **Fase** | Afeta a fase inteira (ex: precisa de slot novo, ordem precisa mudar) | Replanejar fase, atualizar `ROADMAP.md` |
| **Arquitetural** | Invalida uma ADR (em `docs/ARCHITECTURE.md` §2) | ADR-NN-revisao + atualizar docs afetados + replanejar slots |
| **Produto** | Invalida algo em `PRD.md` (escopo, persona, restrição) | Discussão com Rogério antes de qualquer ajuste de doc |

### 3. Análise de impacto cruzada

Para cada artefato relevante, liste o que precisa mudar:

```
PRD.md          → seções X, Y precisam de ajuste em [bullet curto]
ARCHITECTURE.md → ADR-NN obsoleta; nova decisão em §Z
DATA_MODEL.md   → tabela X ganha coluna Y / remove coluna Z
ROADMAP.md      → F<n>-S<NN> reescrito; F<n>-S<NN+1> cancelado; F<n>-S<NN+2> novo
tasks/slots/    → slot F2-S04 abortado, slot F2-S04b criado, slot F2-S07 ganha dependência
COMMS.md        → log de decisão da correção (append-only)
```

### 4. Propor opções

Apresente **2 ou 3 caminhos**, não um só. Cada opção tem:

- **Resumo:** 1 frase.
- **Custo:** quantos slots a refazer/criar, quantos docs a atualizar, estimativa de tempo.
- **Risco:** o que pode dar errado nesse caminho.
- **Trade-off:** o que se ganha vs o que se perde.

Exemplo:

```
Opção A — Minimalista: ajustar só F2-S04 (worker integration). Custo: 1 slot reescrito, 0 docs. Risco: o problema reaparece em F4. Trade-off: rápido agora, dívida depois.

Opção B — Estrutural: criar nova ADR-025, ajustar ARCHITECTURE §10, replanejar F2-S04 e F2-S06, adicionar F2-S07b. Custo: 3 slots, 2 docs. Risco: atrasa a fase em 2 dias. Trade-off: paga a dívida agora, F4 fica limpa.

Opção C — Refazer a fase: descartar F2 inteira, replanejar com novo entendimento. Custo: 6 slots refeitos, 4 docs. Risco: você odeia retrabalho. Trade-off: certeza de qualidade no fim, ego ferido no meio.
```

### 5. Aguardar decisão

Apresente o diagnóstico + impacto + opções ao Rogério. **NÃO execute nada.** Espere a escolha.

### 6. Pós-decisão (se autorizado)

Quando o Rogério escolher uma opção:

1. Atualize docs (PRD/ARCHITECTURE/DATA_MODEL/ROADMAP) conforme impacto.
2. Crie ADR nova em `docs/decisions/ADR-NN-correcao-...md` resumindo: gatilho, opção escolhida, motivo, data.
3. Atualize slots em `tasks/slots/`: marque os afetados como `superseded` (não delete), crie novos slots com `depends_on` correto.
4. Roda `python scripts/slot.py sync` pra atualizar `STATUS.md`.
5. Escreva 3 linhas em `tasks/COMMS.md`: `[CORRECT-COURSE][data] gatilho: X. opção escolhida: A. impacto: 3 slots, 1 doc. ADR-NN.`

### 7. Reportar

Sumário curto pro Rogério:

```
Curso corrigido.
ADR criada: ADR-NN.
Slots afetados: F2-S04 (superseded), F2-S04b (novo, available).
Docs atualizados: ARCHITECTURE §10, ROADMAP F2.
Próximo passo: pegar F2-S04b.
```

## Halt conditions

- HALT se gatilho é "achei que poderia ser melhor" sem evidência concreta — peça evidência (bug real, decisão técnica que falhou, fato novo). Curso só corrige por dado, não por sensação.
- HALT se impacto é categoria **Produto** e o Rogério não está presente — não mude PRD sem ele.
- HALT se 3+ correções de curso na mesma fase em pouco tempo — sintoma de plano inicial ruim; pause e use `/hm-init` ou `/hm-tasks` pra replanejar a fase inteira em vez de remendar.

## Anti-padrões

- Não use isso pra "decisão técnica trivial" — isso é refactor normal, não correção de curso.
- Não proponha sempre a opção mais segura — apresente trade-offs reais; deixe o Rogério escolher.
- Não delete slots; marque `superseded` (preserva histórico).
- Não comece a implementar antes de ter a opção aprovada por escrito.

## Memória

Após uma correção de curso fechada, salve em `~/.claude/memory/` o **padrão de erro**: "Quando a decisão X foi tomada sem revisar Y, a correção custa Z slots". Próxima vez que `/hm-init` ou `/hm-tasks` rodar e ver decisão parecida, alerta.
