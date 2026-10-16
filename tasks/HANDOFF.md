# Handoff — próxima sessão (atualizado em 2026-10-16)

> Leia este arquivo inteiro antes de qualquer ação. Ele descreve o estado real do repositório e da
> produção no fim da sessão de 14 a 16/10/2026, o que está pronto, o que está decidido e a ordem
> para começar a construir o Copiloto. Depois de concluir cada item, atualize ou apague a linha.

## 1. Estado do repositório

- Branch `main`. O `origin/main` está em `f0d0b29f` (push feito pelo Rogério; CI verde no run
  `38944244423`: ci, e2e e python). Há commits locais de docs/design e de decomposição ainda sem push
  (`git status -sb`).
- **Stashes:** só sobrou o `f70-s02` (antigo; não mexer sem o Rogério). Os de F72 e o do incidente de
  flow já foram integrados.
- **Deploy:** não confirmado nesta sessão se o `deploy.ps1` foi rodado depois do push. Perguntar ao
  Rogério e conferir a tag dos serviços na VPS (`docker service ls`) antes de assumir.

## 2. Produção (VPS 187.77.237.233, deploy manual)

- Última versão **confirmada** no ar: `75de4fd4` (F71). O que está na `main` e pode não estar em produção:
  F70-S36/S37 (nome do contato), F58-S10/S12 (campanhas: etapa "Quando enviar" e entrega confiável,
  migração `0095`), migração `0096` (F70), fix do incidente de flow (`89f65725`), F72-S01..S08 (DS 3.0),
  correção do alinhamento dos KPIs e **IBM Plex Mono de verdade** (`cbee3bb2`; a fonte mono nunca era
  aplicada: olhar visualmente tabelas, kickers e kbd depois do deploy), pin do Python 3.13 no CI.
- Deploy: `./scripts/deploy.ps1 -Branch main`. O `deploy.sh` faz backup fail-closed, migra **antes** de
  subir o código e aborta sem alterar nada se o dump falhar. O job `deploy` do CI não faz nada (faltam os
  secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`).
- Depois do deploy: `/health` com `db: up` e `storage: ok`; migrações `0095` e `0096` aplicadas; caso
  do incidente de flow (runbook `docs/runbooks/incident-flow-media-mismatch-2026-10-09.md`, "Verificação
  depois do deploy").
- **Storage R2:** ainda falta rodar o reprocessamento da mídia parada (runbook `storage-recusou-midia`
  §4, começar com `--dry-run`).

## 3. F72 (DS 3.0)

S01 a S08 done. **S09 (auditoria final) segue bloqueada e é do Rogério decidir.** Antes dela: ligar o
Docker e rodar os testes de banco e a prova visual manual em 375 e 1440 nos dois temas. Dívidas
registradas na COMMS (seção lote B e lote C): `channelProvider` na API de conversas, fuso da agenda
(`workspace.timezone`), tokens/helpers duplicados, intermitência do e2e `conversations-inbox-ds3:318`
(clique no item do chat que às vezes não navega).

## 4. NOVO — Copiloto, Loja de Integrações e Mascote (F73–F76): decomposto, nada construído

Decisão do Rogério em 16/10/2026: construir o Copiloto, a Loja de Integrações e o mascote
(**direção C, Personagem**; a B "Órbita" foi descartada). A maquete aprovada está em
`docs/design/copilot-integracoes.html` e a demo dos botões em `docs/design/copilot-botao-animacao.html`.
O mascote vai além do botão: carregamento, "pensando", vazios, recibos, onboarding, de forma
estratégica (esqueleto imediato; personagem só em espera longa).

| Fase | O quê | Spec | Slots |
|---|---|---|---|
| F73 | Fundação do Copiloto (backend/runtime) | `docs/features/COPILOTO.md`, ADR-003, ADR-004 | 16 |
| F74 | Copiloto — experiência (frontend) | idem | 13 |
| F75 | Loja de Integrações | `docs/features/INTEGRACOES.md`, ADR-005 | 16 |
| F76 | Mascote e animações | `docs/features/MASCOTE_ANIMACOES.md`, ADR-006 | 9 |

Decisões já assumidas nos slots (confirmar com o Rogério): assistente se chama "Copiloto" (placeholder);
teto mensal de IA US$ 30 por padrão e custo visível só para OWNER/ADMIN; "mover sozinho" fica para a
v1.1 (F73-S16 bloqueado); abertura automática "uma vez por dia"; desfazer 24 h (lote) e 7 dias (piloto);
Copiloto **indisponível em view-as**; sem microfone na v1; agência parceira desligada; Odonto sem
mascote; Maian com glifo por padrão; a loja é catálogo curado, não marketplace aberto.

**Ordem recomendada** (use `python scripts/slot.py plan-batch`; a máquina estoura memória com muitos
typecheck/vitest de `@hm/web` em paralelo, então no máximo 3 workers e 2 de frontend):
1. **Primeiro lote:** F73-S01 (schema, db-engineer) ‖ F73-S02 (contratos em `@hm/shared`) ‖ F73-S04
   (runtime Python). Em seguida ou junto: **F75-S16** (hotfix, abaixo) e **F76-S01** (spike do mascote,
   único frontend do lote).
2. Depois: F73-S03 ‖ F74-S01; depois F74-S02 ‖ F74-S04.
3. **Não** rodar F75-S14 junto com F73-S04 (ambos editam `main.py`/`config.py` do runtime).
4. Dependências cruzadas já aplicadas: F75-S04/S06/S07/S08 e F76-S04 dependem de F73-S02 (arquivos
   compartilhados `permissions.ts`, `socket-events.ts`, `notifications.ts`, `shared/index.ts`).
   F75-S01 depende de F73-S01 (migrações são sequenciais; próxima livre = 0097).
5. A F74 implementa localmente os contratos `Thinking`/`ActionReceipt`/`CopilotPeek` e a F74-S12 troca
   pelos componentes da F76 quando chegarem.
6. Workers **sempre em primeiro plano**, orquestrados por `.claude/agents/orchestrator.md`.

## 5. Achados de risco (dos agentes de decomposição, confirmados no código)

- **F75-S16 (critical): o `http_request` do flow-engine não tem proteção contra SSRF.** O
  `packages/flow-engine/src/ports/http.port.ts` usa `fetch` direto; um admin de empresa pode fazer o
  servidor chamar a rede interna. **Já existe em produção.** Recomendo fazer esse slot como hotfix
  antes do resto.
- `DELETE /api/campaigns/:id` usa `campaign.edit` (SUPERVISOR) em vez de `campaign.cancel` e não confere
  status (ação irreversível). `GET /api/agents/:id/metrics` devolve `totalCostUsd` a todos os papéis. A
  cor do tipo de conversão aceita `max(32)` sem regex no schema. Precisam de slots de API próprios.
- `evaluate.py` grava `request_type='evaluation'`, mas o CHECK de `llm_usage_logs` (migração 0014) não
  aceita: a gravação do custo do juiz falha em silêncio (corrigido dentro de F75-S01).
- O CHECK `channels_provider_columns` (migração 0002) não tem ramo para `email`: criar canal de e-mail
  provavelmente falha. Pede slot próprio (fora da F75).
- A chave de cifra: `getKey` ignora a versão; o runbook de rotação omite `meta_connections` e
  `workspace_custom_values` (tratado no F75-S03).
- `stages.automation_rules` pode enviar mensagem, disparar flow ou registrar conversão: mover um negócio
  pode falar com o cliente (F73-S08 eleva esse movimento ao nível 4).

## 6. Maian (clone do Leadium) — só documentação e apresentação, nada decomposto

O Rogério decidiu clonar o Leadium para a Maian. **Nada da Maian foi decomposto em slots** (decisão
dele). O que existe: vault do Obsidian `projetos/maian/` (análise de unificação, cobrança dos vendedores,
apresentação atualizada, ficha `clientes/maian.md`) e o §14 do `PLANO-plataforma-unica.md` no projeto
`Jobs\Maya - Fabio\config-vps`. Bloqueios antes de qualquer código da Maian: chave `anon` do Supabase
deles lê e escreve tudo (S00) e o MCP do ERP não tem autenticação. Decisões abertas do Rogério:
licença/infra do fork, fork separado vs. perfil de nicho, Supabase sai ou fica, "cobrança" (produtividade
vs. dívida), se pode citar o nome "Leadium" ao cliente antes de a questão de licença/white-label.

## 7. Pendências que dependem do Rogério

- **Leadium (única empresa em produção) está em trial:** expira ~22/10/2026. Marcar a assinatura como
  **Ativa** no painel de plataforma antes disso; se expirar, vira só leitura e o agente da Arcada para
  de responder.
- **Email de confirmação de cadastro não chegou** (teste de 07/10): o Supabase aceitou (HTTP 200); o
  problema está no SMTP ou na entrega. Fazer os testes 5.1 a 5.4 de `docs/runbooks/supabase-auth-emails.md`.
- Desligar "Allow new users to sign up" no Supabase (recomendação da auditoria F71).
- Go-live público do cadastro depende de F71-S11 (headers de segurança do web) e F71-S15 (verify define
  senha).
- Opcional: secrets de deploy no GitHub para o CI publicar sozinho.
- **Avisos do GitHub Actions:** Node 20 descontinuado e `ubuntu-latest` vira Ubuntu 26 em **19/10**.
  Atualizar as actions.
- Perguntas de produto do Copiloto: nome do assistente, preço/créditos de IA, integrações prioritárias,
  frequência do mascote, mascote na Maian.

## 8. Prompt pronto para abrir a próxima sessão

> Leia `tasks/HANDOFF.md` inteiro e o `CLAUDE.md`. Confirme comigo se o deploy foi feito. Depois comece
> a construção da F73/F76 pelo orchestrator conforme o §4: primeiro lote F73-S01, F73-S02 e F73-S04,
> mais o hotfix F75-S16 e o spike F76-S01, workers em primeiro plano e no máximo 3 em paralelo. Sem
> push nem deploy sem o meu ok. Me reporte ao fim de cada etapa.
