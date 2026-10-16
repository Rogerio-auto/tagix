---
id: F74-S07
title: Tela cheia /copiloto (histórico de conversas, painel de confiança) e Atividade com Desfazer (A7, A8)
phase: F74
status: blocked
priority: high
estimated_size: M
model: sonnet
ui: true
depends_on: [F74-S03, F74-S04]
blocks: [F74-S12]
source_docs:
  - docs/features/COPILOTO.md
  - docs/design/copilot-integracoes-ux.md
  - docs/design/copilot-integracoes.html
agent_id: frontend-engineer
---
# F74-S07 — Tela cheia e Atividade

## Objetivo

O lugar para conversas longas e para conferir:

- `/copiloto` tem o histórico à esquerda, a conversa no centro com medida de leitura e, à direita, o que dá confiança (atividade recente, uso do mês só para quem pode ver custo, e o que ele sabe sobre a empresa).
- `/copiloto/atividade` é o registro legível de tudo o que ele fez: quem pediu, o que mudou, resultado e Desfazer enquanto der. Inclui o piloto automático e os pedidos bloqueados com encaminhamento.

## Escopo (faz)

- `apps/web/app/(app)/copiloto/layout.tsx`: cabeçalho "Copiloto" e as abas Conversas, Atividade, Memória do negócio e Configurações. A aba Configurações só aparece com `copilot.manage`; as rotas das abas 3 e 4 são dos S08 e S09.
- `apps/web/app/(app)/copiloto/page.tsx` + `apps/web/features/copilot/fullscreen/**`:
  - histórico: `listSessions` paginado, renomear, arquivar, nova conversa e busca local por título;
  - conversa: reusa `CopilotConversation` (S03) com largura de leitura de ~68 ch;
  - painel direito: 5 últimas atividades, uso do mês (só com `view_costs`; o resto vê "Dentro do limite do mês") e 3 fatos da memória com link;
  - chegar pelo botão "tela cheia" do balão abre a **mesma sessão**, sem perder o turno em andamento;
  - ao sair da rota, o balão retoma a sessão;
  - sem sessões: vazio com 3 sugestões.
- `apps/web/app/(app)/copiloto/atividade/page.tsx` + `apps/web/features/copilot/activity/**`:
  - lista paginada por cursor (`listActivity`), agrupada por dia; cada linha com hora, avatar/iniciais de quem pediu (ou "Piloto automático"), descrição com os números em destaque, `RiskMeter`, selo de resultado e Desfazer enquanto houver janela; o Desfazer reusa `useProposalActions` do S04;
  - filtros: Minhas / Todas (com `copilot.activity.view_all`), por nível e por resultado;
  - expandir a linha mostra os itens e os motivos dos pulados;
  - linha bloqueada: "Pedido enviado a Bruna para aprovar", e o aprovador vê Aprovar / Recusar;
  - rodapé: "Desfazer de ações em lote fica disponível por 24 h; do piloto automático, por 7 dias. Mensagens já enviadas não voltam.";
  - "Exportar atividade" (CSV) só com `view_all`;
  - atualização em tempo real por `copilot:proposal_updated`.
- `apps/web/e2e/specs/copilot-fullscreen.spec.ts`: balão → tela cheia mantém a conversa; histórico (abrir, renomear, arquivar); Atividade com desfazer, filtro Minhas/Todas por papel e linha bloqueada com aprovação.

### files_allowed

- `apps/web/app/(app)/copiloto/layout.tsx`
- `apps/web/app/(app)/copiloto/page.tsx`
- `apps/web/app/(app)/copiloto/atividade/**`
- `apps/web/features/copilot/fullscreen/**`
- `apps/web/features/copilot/activity/**`
- `apps/web/e2e/specs/copilot-fullscreen.spec.ts`

### files_forbidden

- `apps/web/features/copilot/conversation/**`
- `apps/web/features/copilot/actions/**`

## Definition of Done

- [ ] Fiel à A7 e à A8 nos dois temas; capturas 1440 e 375 em `apps/web/e2e/.artifacts/f74-s07/`
- [ ] Continuidade balão ↔ tela cheia sem perder o turno (e2e)
- [ ] Atividade: Desfazer some quando a janela fecha (relógio do mock); AGENT não vê "Todas"; custo invisível sem `view_costs`
- [ ] axe sem violação séria; tabela/lista navegável por teclado; `/hm-designer` contra A7 e A8

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web exec vitest run features/copilot/fullscreen features/copilot/activity --maxWorkers=1
pnpm exec eslint apps/web/features/copilot/fullscreen apps/web/features/copilot/activity "apps/web/app/(app)/copiloto" --max-warnings=0
```

## Notas

- Agente: `frontend-engineer`.
- Rota em pt-BR (`/copiloto`), como `/hoje`. O botão de entrada na sidebar é da F76.
