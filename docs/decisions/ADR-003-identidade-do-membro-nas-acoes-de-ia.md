# ADR-003: Identidade do membro nas ações de IA (o Copiloto age como quem pede)

> **Status:** aceita · **Data:** 2026-10-16 · **Fase:** F73
> **Decisor:** Rogério (princípio "age com as permissões de quem pede", maquete aprovada); desenho técnico desta ADR.
> **Contexto:** [`../features/COPILOTO.md`](../features/COPILOTO.md) §2, §3 e §8 · maquete A5 e A11.

## Contexto

O caminho de IA que existe hoje é o do **agente de atendimento**. A identidade é o agente (`agent_executions` com `agent_id NOT NULL`). A autorização de uma ferramenta é "a ferramenta está habilitada em `agent_tools` e a execução está viva e é recente" (`apps/api/src/internal/tools/access.ts`). O envelope do callback (`workspace_id`, `agent_id`, `execution_id`, `conversation_id`) não tem membro nem papel, e as leituras ficam presas ao contato da conversa.

O Copiloto é outra coisa. Ele é **uma pessoa da equipe pedindo**, com o papel dela (`ROLE_CAN`/`can()`), o escopo fino dela (visibilidade da inbox da F30, "só os seus" do AGENT), o estado da assinatura da empresa (só leitura com 402) e, às vezes, sob view-as de um admin da plataforma. Se reusarmos a identidade de agente, um atendente teria pelo Copiloto o poder do agente, que é configurado pelo admin e não pelo papel. Se confiarmos no que o modelo diz ("sou a Bruna, gestora"), qualquer prompt injection vira escalonamento.

## Decisão

1. **O principal é o membro.** Todo turno do Copiloto nasce de uma sessão autenticada (`requireAuth → withRLS`). O `CopilotPrincipal { workspaceId, memberId, role, requestedByMemberId }` é resolvido no servidor. Nada do modelo, do contexto de página ou dos `args` entra na identidade.

2. **O turno é a credencial.** Antes de chamar o runtime, a API grava `copilot_turns` (`status='running'`, `expires_at = now() + 120 s`, `max_tool_calls`, `grant_nonce`) e assina um **grant**:
   `grant = b64url(payload) + "." + b64url(HMAC-SHA256(COPILOT_GRANT_SECRET, payload))`, com `payload = { v: 1, tid, ws, mid, exp, nonce }`.
   O segredo é **próprio** (não é o `AGENT_RUNTIME_TOKEN`) e entra no `apps/api/src/config.ts` com validação de tamanho (≥ 32 bytes) e falha no boot se faltar em produção. O runtime trata o grant como opaco e o devolve em `X-Copilot-Grant` a cada callback.

3. **Toda chamada de ferramenta reautoriza do zero** (`/internal/copilot/tools/:key`), nesta ordem, falhando fechado:
   1. bearer de serviço (`AGENT_RUNTIME_TOKEN`, comparação em tempo constante, igual ao caminho de agente);
   2. HMAC do grant (tempo constante), `v`, `exp > now`;
   3. sob `withWorkspace(payload.ws)`: o turno existe, está `running`, é do `mid`, o `nonce` confere, não expirou, e `tool_calls < max_tool_calls` (incremento atômico `UPDATE … SET tool_calls = tool_calls + 1 WHERE … AND tool_calls < max_tool_calls RETURNING`);
   4. **recarrega o membro**: `status = 'active'` e papel **atual** (rebaixar ou remover alguém vale na chamada seguinte, no meio do turno);
   5. workspace: assinatura efetiva (`effectiveSubscriptionStatus`) e `copilot_settings.enabled`;
   6. capacidade da ferramenta: `can(role, perm)` ∧ `matriz[role][capability] ≠ false` ∧ (não é escrita ∨ a assinatura está ativa) ∧ orçamento (escritas param em `queries_only`).
   A identidade nunca vem de `args`. Os schemas Zod de cada ferramenta são `.strict()` e não têm campo de membro nem de workspace.

4. **Escopo fino igual ao da interface.** As consultas usam os mesmos predicados que as telas: `buildVisibilityPredicate` (`@hm/db`) para conversas; para negócios do AGENT, `owner_id = membro` ou a conversa vinculada visível; contatos conforme `contact.view`. Todo id recebido (dos `args` ou do contexto de página) é **re-resolvido** sob RLS e escopo. O que o membro não vê é tratado como inexistente: a resposta é `not_found`, nunca "sem permissão", para não virar oráculo.

5. **Só leitura e view-as.**
   - Assinatura inativa: o `subscription-guard` ganha exceções **exatas** para `POST /api/copilot/sessions` e `POST /api/copilot/sessions/:id/messages`, porque perguntar é leitura. A recusa de escrita acontece no passo 3.6, devolve `action_blocked { reason: 'subscription_inactive' }` e registra a proposta `blocked`.
   - View-as (impersonation): o Copiloto fica **indisponível**. `/api/copilot/*` responde 403 `copilot_unavailable_impersonation`, inclusive o histórico, porque as conversas do Copiloto são privadas do membro e o view-as não pode lê-las. Também não se gasta o orçamento do tenant em nome de um admin da plataforma. Consulta em view-as para suporte é v1.1 com trilha própria.

6. **Relação com o caminho de agente existente.**

   | | Agente de atendimento | Copiloto |
   |---|---|---|
   | Principal | agente (`agent_executions`) | membro (`copilot_turns`) |
   | Endpoint de callback | `/internal/tools/:key` | `/internal/copilot/tools/:key` |
   | Autorização | `agent_tools` habilitada + execução viva | permissão do papel + matriz + assinatura + turno vivo + grant |
   | Ferramentas | `tools` / `agent_tools` (configuráveis pelo admin) | catálogo fixo em código (`@hm/shared/copilot/capabilities.ts`) |
   | Acesso direto ao banco pelo Python | sim, nas ferramentas leves sob RLS (`DatabaseTool`) | **não**: tudo via Node |
   | Log | `tool_logs` | `copilot_tool_calls` |
   | Auditoria | `actor_type='agent'` | `actor_type='copilot'` (`autopilot` no piloto), `actor_member_id` = permissões usadas, `requested_by_member_id` = quem pediu |

   Os dois caminhos **não se cruzam**: agente nunca recebe ferramenta do Copiloto, e o Copiloto nunca recebe ferramenta de agente. O que compartilham são os **services de domínio** (`deal-move`, `event-service`, `consent`), chamados com `actor = { type: 'member', memberId }` e `metadata.via = 'copilot'`.

7. **Pedido de aprovação.** Quando o papel bloqueia ("Pedir à Bruna"), a proposta passa a `awaiting_approval` com `approver_member_id`. Quem aprova confirma **com as permissões dela**, reavaliadas no confirmar. A trilha registra `actor_member_id = aprovador` e `requested_by_member_id = solicitante`. O aprovador precisa ter a permissão da capacidade, e a lista de aprovadores possíveis é calculada no servidor.

## Alternativas consideradas

- **Reusar `agent_executions` com um "agente Copiloto" por workspace.** Rejeitada: a identidade seria o agente e não a pessoa. Também obrigaria a criar linhas de `tools`/`agent_tools` por empresa para um catálogo que é de produto, e misturaria custo e trilha do atendimento com os do uso interno.
- **JWT do usuário repassado ao runtime.** Rejeitada: espalha uma credencial de longa duração para um serviço que conversa com o modelo. O grant vale um turno, é inútil fora dele e é verificado contra o banco.
- **Python lendo o banco sob RLS, como as ferramentas leves.** Rejeitada para o Copiloto: o RLS isola por workspace, mas o escopo fino (visibilidade da F30, "só os seus") vive no Node. Duplicar em Python garante divergência.
- **Confiar no `execution_id` sem HMAC.** Rejeitada: o caminho de agente aceita isso porque a execução é criada pelo worker. Aqui o turno nasce de um request de usuário, e o HMAC impede que um id vazado em log seja aceito por outro processo com o token de serviço.

## Consequências

- O F73-S03 implementa o grant, o resolvedor de principal, o callback interno, as exceções do guard de assinatura e o bloqueio em view-as. Todos os slots de ferramenta da F73 dependem dele.
- Mudança de papel tem efeito imediato. Uma proposta criada por quem perdeu a permissão é recusada no confirmar (o motor revalida; ADR-004).
- Novo segredo de ambiente: `COPILOT_GRANT_SECRET` (produção, `.env.example`, runbook de deploy).
- `audit_logs` ganha `requested_by_member_id`, `copilot_proposal_id` e `copilot_turn_id`, e os `actor_type` `copilot` e `autopilot` (F73-S01).
