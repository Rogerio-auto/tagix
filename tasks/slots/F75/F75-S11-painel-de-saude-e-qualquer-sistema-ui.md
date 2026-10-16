---
id: F75-S11
title: Painel de saúde da integração e tela "Conectar qualquer sistema" com teste ao vivo
phase: F75
status: blocked
priority: high
estimated_size: M
model: sonnet
ui: true
depends_on: [F75-S09, F75-S08, F75-S06]
blocks: [F75-S15]
source_docs:
  - docs/features/INTEGRACOES.md
  - docs/design/copilot-integracoes.html
  - docs/UX_PRINCIPLES.md
agent_id: frontend-engineer
---
# F75-S11 — Saúde (B4) e Qualquer sistema (B6)

## Objetivo

Funcionando, devagar ou quebrado: dá para saber em 2 segundos. E para o que não está na loja, um endereço, uma
chave e um teste ao vivo em que o primeiro evento aparece com o que ele criou.

## Contexto

Maquete `?solo=saude` e `?solo=webhook` (capturas `saude-*`, `webhook-*`). APIs: S08 (saúde, registro, ações,
desconectar) e S06 (endpoint, chave, teste, eventos, socket `integration:event`).

## Escopo (faz)

- `apps/web/features/integrations/health/` e a troca no `apps/web/app/(app)/integracoes/[slug]/page.tsx` (conexão
  existente ⇒ painel):
  - cabeçalho: monograma, nome, selo de estado ("Atenção · 3 erros"), "Conectada por <nome> em <data> · direções";
    ações Pausar/Retomar, Sincronizar agora (desabilita com contagem regressiva no cooldown), Desconectar;
  - 4 KPIs em mono: última sincronização (relativa, atualiza a cada 30 s, "próxima em"), registros hoje (+% vs
    média), na fila (+ ETA), erros 24 h (+ registros afetados);
  - "Erros abertos" com causa, explicação, sugestão e Reprocessar (por erro e todos), com estado otimista e
    rollback em falha;
  - "Volume por hora" (24 barras, hora com erro marcada por cor **e** padrão, legenda textual); gráfico em SVG
    acessível (`role="img"` + `aria-label` com o resumo);
  - "Registro" com filtro Tudo/Erros/Negócios criados e paginação infinita;
  - modal Desconectar com o que para e o que fica (números da prévia), "Entendi…" libera o botão de perigo,
    foco inicial em "Manter conectado";
  - dado velho: faixa "Os dados do <sistema> estão parados há 3 h" com Sincronizar agora (lição "parar, não
    esconder");
  - permissões: READONLY vê sem botões; AGENT não vê Desconectar.
- `apps/web/app/(app)/integracoes/qualquer-sistema/page.tsx` + `apps/web/features/integrations/any-system/`:
  passo 1 endereço (copiar) e chave (gerar na primeira visita, mostrada **uma vez**, depois só os 4 últimos com
  "Trocar chave" que explica a janela de 24 h); passo 2 "O que enviar" com segmentado Contato e negócio / Pedido,
  bloco de código copiável e "Peça ao Copiloto: gere esse exemplo em curl"; passo 3 "Teste ao vivo": "Escutando
  eventos" (ponto vivo só enquanto o socket está conectado), "Enviar evento de teste", lista de eventos com o que
  criou (link para o contato/negócio), "Eventos de teste… apagados sozinhos em 24 h".
- Testes de componente e e2e `apps/web/e2e/specs/integrations-health.spec.ts` e
  `apps/web/e2e/specs/integrations-any-system.spec.ts` (API e socket mockados).

### files_allowed

- `apps/web/app/(app)/integracoes/[slug]/page.tsx`
- `apps/web/app/(app)/integracoes/qualquer-sistema/**`
- `apps/web/features/integrations/health/**`
- `apps/web/features/integrations/any-system/**`
- `apps/web/e2e/specs/integrations-health.spec.ts`
- `apps/web/e2e/specs/integrations-any-system.spec.ts`

### files_forbidden

- `apps/web/features/integrations/{shared,store,wizard}/**`

## Definition of Done

- [ ] fiel à maquete B4 e B6, dois temas, 1440 e 375
- [ ] e2e: reprocessar some com o erro; desconectar exige o "Entendi"; sync-now respeita o cooldown
- [ ] e2e: evento de teste aparece na lista via socket com o que criou
- [ ] a chave nunca aparece de novo depois de sair da tela (só os 4 últimos)
- [ ] capturas 375/768/1440 × dark/light em `apps/web/e2e/.artifacts/f75-s11/`; axe sem violação séria; peso
- [ ] revisão `/hm-designer` aprovada contra B4 e B6

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm exec eslint apps/web/features/integrations/health apps/web/features/integrations/any-system "apps/web/app/(app)/integracoes"
pnpm --filter @hm/web exec vitest run features/integrations/health features/integrations/any-system --maxWorkers=1
```

## Notas

- Agente: `frontend-engineer`.
