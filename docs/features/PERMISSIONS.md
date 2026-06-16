# Feature — PERMISSIONS, ROLES e CONFIGURAÇÕES

> **Domínio:** Sistema de permissões por role + 3 níveis de configuração (pessoal, workspace, plataforma).
> **Pacotes:** `apps/api/src/middlewares/requireRole.ts`, `apps/web/features/settings/`, `apps/web/features/platform-admin/`
> **Princípio fundador:** o v1 errou ao tratar permissão como flag binária e configuração como um amontoado de telas sem hierarquia. No v2, permissões e configurações são organizadas por **quem é dono** (pessoa → workspace → plataforma) e cada item tem **um lugar canônico**.

---

## 1. Os 5 roles + flag platform_admin

Roles canônicos do v2 (cravados em `members.role`):

| Role | Propósito | Pode |
|---|---|---|
| **OWNER** | Dono do workspace. Único role que pode billing e excluir workspace. | Tudo no workspace. |
| **ADMIN** | Operador sênior. Faz tudo administrativo menos billing/destruir. | Tudo exceto billing + delete workspace. |
| **SUPERVISOR** | Gerente de equipe. Vê dashboards, gerencia deps/times, não toca em billing/canais. | Visão de equipe + gestão de routing + leitura de tudo. |
| **AGENT** | Atendente. Foco no atendimento. | Atender conversas atribuídas, ver pipeline relevante. Sem admin. |
| **READONLY** | Visualização sem ação. Auditor, observador externo. | Só leitura, sem mutação. |

Mais uma flag ortogonal:

| Flag | Onde mora | Quem dá |
|---|---|---|
| `members.is_platform_admin` | Boolean em `members` | Apenas outro `is_platform_admin` |

Quem tem `is_platform_admin=true` ganha acesso ao painel `/platform/*` — onde gerencia outros workspaces, modelos LLM, secrets da plataforma, infra. Vide [`ARCHITECTURE.md`](../ARCHITECTURE.md) §11.2.

**Vocês (Rogério) e equipe de suporte interno** ganharão `is_platform_admin=true`. Cliente final nunca.

---

## 2. Matriz de permissões (action × role)

Tabela autoritativa. Quando o código fizer `requireRole([...])`, consulta isso. Quando o frontend esconder botão, consulta isso.

### 2.1 Conversações

| Ação | OWNER | ADMIN | SUPERVISOR | AGENT | READONLY |
|---|:-:|:-:|:-:|:-:|:-:|
| Ver inbox completa do workspace | ✅ | ✅ | ✅ | (só atribuídas a ele + do dept) | ✅ |
| Atribuir/reatribuir conversa | ✅ | ✅ | ✅ | (só si mesmo, via "pegar") | ❌ |
| Transferir entre departamentos | ✅ | ✅ | ✅ | ✅ | ❌ |
| Marcar conversa resolved | ✅ | ✅ | ✅ | ✅ (das suas) | ❌ |
| Snooze | ✅ | ✅ | ✅ | ✅ (das suas) | ❌ |
| Ligar/desligar IA (`ai_mode`) | ✅ | ✅ | ✅ | ✅ (das suas) | ❌ |
| Trocar agente de IA da conversa (`assign_agent`) | ✅ | ✅ | ✅ | ✅ (das suas) | ❌ |
| Excluir mensagem (LGPD) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Export histórico | ✅ | ✅ | ✅ | ❌ | ✅ |

### 2.2 Contatos / Pipeline / Deals

| Ação | OWNER | ADMIN | SUPERVISOR | AGENT | READONLY |
|---|:-:|:-:|:-:|:-:|:-:|
| Ver lista de contatos | ✅ | ✅ | ✅ | ✅ | ✅ |
| Criar/editar contato | ✅ | ✅ | ✅ | ✅ | ❌ |
| Excluir contato (LGPD) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Ver pipeline completo | ✅ | ✅ | ✅ | (do dept dele) | ✅ |
| Criar/editar pipeline + stages | ✅ | ✅ | ❌ | ❌ | ❌ |
| Mover deal entre stages | ✅ | ✅ | ✅ | ✅ (dos seus) | ❌ |
| Criar/editar deal | ✅ | ✅ | ✅ | ✅ | ❌ |
| Marcar conversão | ✅ | ✅ | ✅ | ✅ (dos seus) | ❌ |
| Cancelar conversão | ✅ | ✅ | ✅ | (das suas, < 24h) | ❌ |

### 2.3 Agentes IA / Tools / KB

| Ação | OWNER | ADMIN | SUPERVISOR | AGENT | READONLY |
|---|:-:|:-:|:-:|:-:|:-:|
| Listar agentes | ✅ | ✅ | ✅ | ✅ | ✅ |
| Criar/editar/arquivar agente | ✅ | ✅ | ❌ | ❌ | ❌ |
| Toggle agent_tools (habilitar/desabilitar) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Usar playground | ✅ | ✅ | ✅ | ✅ | ❌ |
| Ver tool_logs / agent_executions | ✅ | ✅ | ✅ | ❌ | ✅ |
| Ver llm_usage_logs (custos) | ✅ | ✅ | ❌ | ❌ | ✅ |
| Definir model do agente | ✅ | ✅ | ❌ | ❌ | ❌ |
| KB upload/edit | ✅ | ✅ | ✅ | ❌ | ❌ |
| KB delete | ✅ | ✅ | ❌ | ❌ | ❌ |

### 2.4 Flow Builder

| Ação | OWNER | ADMIN | SUPERVISOR | AGENT | READONLY |
|---|:-:|:-:|:-:|:-:|:-:|
| Listar flows | ✅ | ✅ | ✅ | ✅ | ✅ |
| Criar/editar flow | ✅ | ✅ | ❌ | ❌ | ❌ |
| Publicar flow (cria version) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Disparar manual flow | ✅ | ✅ | ✅ | ✅ (autorizados) | ❌ |
| Cancelar execução em curso | ✅ | ✅ | ✅ | ✅ (das suas conv) | ❌ |
| Ver flow_logs | ✅ | ✅ | ✅ | ✅ (das suas) | ✅ |

### 2.5 Campanhas

| Ação | OWNER | ADMIN | SUPERVISOR | AGENT | READONLY |
|---|:-:|:-:|:-:|:-:|:-:|
| Listar campanhas | ✅ | ✅ | ✅ | ❌ | ✅ |
| Criar/editar campanha (draft) | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Ativar campanha** (validation + send) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Pausar/retomar | ✅ | ✅ | ✅ | ❌ | ❌ |
| Cancelar | ✅ | ✅ | ❌ | ❌ | ❌ |
| Upload bulk recipients | ✅ | ✅ | ✅ | ❌ | ❌ |
| Bulk opt-in LGPD | ✅ | ✅ | ❌ | ❌ | ❌ |
| Ver métricas | ✅ | ✅ | ✅ | ❌ | ✅ |

### 2.6 Canais / Workspace settings

| Ação | OWNER | ADMIN | SUPERVISOR | AGENT | READONLY |
|---|:-:|:-:|:-:|:-:|:-:|
| Conectar canal (FB Login Meta / WAHA) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Desativar canal | ✅ | ✅ | ❌ | ❌ | ❌ |
| Excluir canal | ✅ | ❌ | ❌ | ❌ | ❌ |
| Editar workspace (nome, timezone, logo) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Convidar member | ✅ | ✅ | ❌ | ❌ | ❌ |
| Promover member (mudar role) | ✅ | ✅ (não cria OWNER) | ❌ | ❌ | ❌ |
| Remover member | ✅ | ✅ (não remove OWNER) | ❌ | ❌ | ❌ |
| Criar/editar departamento | ✅ | ✅ | ❌ | ❌ | ❌ |
| Criar/editar time | ✅ | ✅ | ✅ | ❌ | ❌ |

### 2.7 Billing e exclusão de workspace

| Ação | OWNER | ADMIN | SUPERVISOR | AGENT | READONLY |
|---|:-:|:-:|:-:|:-:|:-:|
| Ver plano/assinatura | ✅ | ✅ | ❌ | ❌ | ❌ |
| Mudar plano | ✅ | ❌ | ❌ | ❌ | ❌ |
| Adicionar/trocar método pagamento | ✅ | ❌ | ❌ | ❌ | ❌ |
| Cancelar assinatura | ✅ | ❌ | ❌ | ❌ | ❌ |
| Excluir workspace | ✅ | ❌ | ❌ | ❌ | ❌ |

### 2.8 API keys e webhooks outbound

| Ação | OWNER | ADMIN | SUPERVISOR | AGENT | READONLY |
|---|:-:|:-:|:-:|:-:|:-:|
| Listar API keys | ✅ | ✅ | ❌ | ❌ | ❌ |
| Criar API key | ✅ | ✅ | ❌ | ❌ | ❌ |
| Revogar API key | ✅ | ✅ | ❌ | ❌ | ❌ |
| Criar/editar webhook outbound | ✅ | ✅ | ❌ | ❌ | ❌ |

### 2.9 Plataforma (super-admin)

Tudo aqui exige `is_platform_admin=true`. Nenhum role normal acessa. Lista:

- Listar/editar todos os workspaces
- Editar `workspace_agent_policies` (caps de IA por workspace)
- Sincronizar / editar `llm_models_whitelist`
- Editar `platform_secrets` (OpenRouter key, Meta App Secret)
- Ver dashboard de plataforma + métricas agregadas
- Ver audit logs cross-workspace
- Ver/dispatchar correção de DLQ
- Ver health da infra

---

## 3. Como a permissão é aplicada

### 3.1 Backend (autoridade)

Toda rota Node Express usa middleware composto:

```ts
router.post('/api/conversations/:id/transfer',
  requireAuth,
  requireRole(['OWNER', 'ADMIN', 'SUPERVISOR', 'AGENT']),
  transferConversationHandler
);

router.delete('/api/contacts/:id',
  requireAuth,
  requireRole(['OWNER', 'ADMIN']),    // LGPD: só admin
  deleteContactHandler
);

router.post('/api/workspaces/:id/delete',
  requireAuth,
  requireRole(['OWNER']),
  deleteWorkspaceHandler
);

router.patch('/platform/workspaces/:id/agent-policy',
  requireAuth,
  requirePlatformAdmin,                 // flag, não role
  updateAgentPolicyHandler
);
```

A matriz §2 vira **constantes tipadas** em `packages/shared/src/permissions.ts`:

```ts
export const ROLE_CAN = {
  'conversation.transfer': ['OWNER', 'ADMIN', 'SUPERVISOR', 'AGENT'],
  'conversation.delete_message': ['OWNER', 'ADMIN'],
  'contact.delete': ['OWNER', 'ADMIN'],
  'campaign.activate': ['OWNER', 'ADMIN'],
  'workspace.delete': ['OWNER'],
  // ... centenas
} as const satisfies Record<string, Role[]>;

export type Permission = keyof typeof ROLE_CAN;

export function can(role: Role, perm: Permission): boolean {
  return ROLE_CAN[perm].includes(role);
}
```

Mesmo objeto importado no frontend pra esconder botões.

### 3.2 Frontend (UX)

```tsx
'use client';
import { can } from '@hm/shared/permissions';
import { useAuth } from '@/shared/hooks/useAuth';

export function DeleteContactButton({ contactId }: { contactId: string }) {
  const { role } = useAuth();
  if (!can(role, 'contact.delete')) return null;
  return <Button onClick={() => deleteContact(contactId)}>Excluir</Button>;
}
```

Esconder no frontend é **UX**, não segurança. A autoridade final está no backend + RLS.

### 3.3 RLS Postgres (defesa em profundidade)

Mesmo se um endpoint esquecer o `requireRole`, Postgres bloqueia escrita cross-workspace via RLS (workspace_id). Para permissões **dentro do workspace** (ex: AGENT não pode ver custo LLM), a aplicação é via SQL query do endpoint específico (filtra por role no service layer).

---

## 4. Configurações: 3 níveis, 3 lugares

O v1 misturou tudo em "Settings" sem hierarquia clara. No v2, cada configuração tem **um lugar canônico**:

```
┌───────────────────────────────────────────────────────────┐
│  CONFIGURAÇÕES PESSOAIS  /settings/me                     │
│  Só você muda. Aplicam só pra você.                       │
└───────────────────────────────────────────────────────────┘
┌───────────────────────────────────────────────────────────┐
│  CONFIGURAÇÕES DO WORKSPACE  /settings                    │
│  OWNER/ADMIN mudam (ou SUPERVISOR em algumas seções).     │
│  Aplicam pra todos do workspace.                          │
└───────────────────────────────────────────────────────────┘
┌───────────────────────────────────────────────────────────┐
│  CONFIGURAÇÕES DA PLATAFORMA  /platform/settings          │
│  Só platform_admin muda. Aplicam globalmente.             │
└───────────────────────────────────────────────────────────┘
```

### 4.1 Pessoal (`/settings/me`)

Granularidade real. Cada item afeta SOMENTE o member que mexeu.

| Seção | Item |
|---|---|
| **Perfil** | Nome de exibição, avatar, telefone pessoal, idioma, bio curta |
| **Preferências** | Tema (dark/light/system), idioma interface, fuso horário (default workspace), formato de data (DD/MM vs MM/DD), formato de moeda |
| **Dashboard** | Cards visíveis, ordem dos cards, período padrão (hoje/7d/30d/mês), cards pinned |
| **Notificações** | **MVP: toggles globais on/off por canal** (`in_app`, `email`, `push` futuro). Granularidade por tipo (mention, assignment, deal_closed, campaign_done) fica para fase 2 — decisão fechada em PRD §3.3 #7. Persistido em `members.notification_prefs` jsonb |
| **Sons** | Som ao receber mensagem nova: ativar/desativar, volume |
| **Atalhos de teclado** | Lista referência (futuro: customização) |
| **Sessões** | Lista de devices logados, botão "encerrar sessão em <device>" |
| **Senha** | Trocar senha (se auth local) ou link pra provider externo |
| **Conta** | Email, MFA toggle (futuro), exclusão de conta |

**Princípio de configuração pessoal:** se você sair do workspace, suas preferências te seguem (não é apagada com remoção de member).

### 4.2 Workspace (`/settings`)

Configurações que afetam TODOS no workspace.

| Seção | Itens | Quem edita |
|---|---|---|
| **Workspace** | Nome, slug, logo, descrição, indústria/nicho, timezone, locale, currency default | OWNER/ADMIN |
| **Marca** (DS v2 leve customization) | Cor de destaque (pequena paleta, default verde-neon), logo na sidebar | OWNER/ADMIN |
| **Canais** | Conectar/desconectar Meta WA, Meta IG, WAHA; status, qualidade, validade do token | OWNER/ADMIN |
| **Membros** | Convidar, listar, mudar role, remover, ver atividade | OWNER/ADMIN |
| **Departamentos** | Criar, editar, cor, ícone, ordem | OWNER/ADMIN |
| **Times** | Criar, editar, alocar members, schedule, auto-assign | OWNER/ADMIN, SUPERVISOR (edita o próprio) |
| **Auto-assign** | Regras de roteamento por canal/dept/team | OWNER/ADMIN |
| **Horário comercial** | Janelas semanais, exceções, mensagem fora do horário | OWNER/ADMIN |
| **Agentes IA** | Criar, editar, definir tools, KB, modelo (entre os permitidos pela policy do super-admin) | OWNER/ADMIN |
| **Knowledge Base** | Upload, organizar, taggar | OWNER/ADMIN, SUPERVISOR (upload) |
| **Pipeline e stages** | Criar pipelines, configurar stages, automation rules | OWNER/ADMIN |
| **Conversões** | Criar `conversion_types`, configurar gatilhos (stage / tag), attribution window | OWNER/ADMIN |
| **Tags** | Criar, editar, cor | OWNER/ADMIN, SUPERVISOR |
| **Custom fields** (contato + deal) | Definir campos extras dinâmicos | OWNER/ADMIN |
| **SLAs** | Tempo máximo de resposta, alertas, regras por canal | OWNER/ADMIN |
| **Webhooks outbound** | Cadastrar URL, secret, eventos inscritos | OWNER/ADMIN |
| **API keys** | Listar, criar, revogar, scopes | OWNER/ADMIN |
| **Billing** (se ativo) | Plano, método pagamento, faturas, uso vs limite | OWNER |
| **Privacidade / LGPD** | Política, retenção, export, esquecimento | OWNER/ADMIN |
| **Compliance Meta** | Quality rating dos canais, alertas, opt-in default | OWNER/ADMIN |
| **Auditoria** | Logs de ações administrativas | OWNER/ADMIN, READONLY |

### 4.3 Plataforma (`/platform/settings`)

Apenas `is_platform_admin`.

| Seção | Itens |
|---|---|
| **Workspaces** | Listar, ver detalhe, suspender, promover platform_admin |
| **Modelos LLM** | Catálogo `llm_models_whitelist`, sync com OpenRouter, marcar ativo/inativo |
| **Políticas de IA padrão** | Defaults por plano (`workspace_agent_policies` herda) |
| **Secrets** | `openrouter_api_key`, `meta_app_secret`, `meta_app_id`, `meta_webhook_verify_token`, `openai_api_key`, `encryption_key_active_version` — rotação com histórico |
| **Templates globais** | Catálogo de `agent_templates` e `pipelines` por nicho |
| **Planos** | CRUD de `plans` (preços, limites, features) |
| **Infraestrutura** | Health de serviços, DLQ, slow queries |
| **Audit logs cross-workspace** | Buscar por workspace/actor/action |
| **Manutenção** | Modo manutenção, banners globais, notificações forçadas |

---

## 5. Estrutura visual do panel `/settings`

```
┌──────────────────────────────────────────────────────────────────┐
│ Configurações                                  [busca: ____]     │
├──────────────────────────────────────────────────────────────────┤
│  Sidebar (agrupada)             │   Conteúdo (lazy, RSC)         │
│                                  │                                │
│  PESSOAL                         │   Editor da seção ativa        │
│   • Perfil                       │                                │
│   • Preferências                 │                                │
│   • Dashboard                    │                                │
│   • Notificações                 │                                │
│   • Sons                         │                                │
│   • Atalhos                      │                                │
│   • Sessões                      │                                │
│   • Senha                        │                                │
│   • Conta                        │                                │
│                                  │                                │
│  WORKSPACE                       │                                │
│   • Workspace                    │                                │
│   • Marca                        │                                │
│   • Canais            [3 ativos] │                                │
│   • Membros           [12]       │                                │
│   • Departamentos     [4]        │                                │
│   • Times             [6]        │                                │
│   • Auto-assign                  │                                │
│   • Horário comercial            │                                │
│   • Agentes IA        [5]        │                                │
│   • Knowledge Base    [127 docs] │                                │
│   • Pipeline          [2]        │                                │
│   • Conversões        [3 tipos]  │                                │
│   • Tags              [24]       │                                │
│   • Custom fields                │                                │
│   • SLAs                         │                                │
│   • Webhooks outbound [2]        │                                │
│   • API keys          [4]        │                                │
│   • Billing                      │                                │
│   • Privacidade / LGPD           │                                │
│   • Compliance Meta              │                                │
│   • Auditoria                    │                                │
│                                  │                                │
│  PLATAFORMA  (só platform_admin) │                                │
│   • Workspaces                   │                                │
│   • Modelos LLM                  │                                │
│   • Políticas IA                 │                                │
│   • Secrets                      │                                │
│   • ... etc                      │                                │
└──────────────────────────────────────────────────────────────────┘
```

Cada item da sidebar mostra **contador / status / alerta** quando relevante (ex: "Canais [3 ativos, 1 com token expirando]" em vermelho).

Busca global no topo (Cmd+K) localiza qualquer setting por nome, descrição ou palavra-chave (ex: "fuso" leva pra preferências; "opt-in" leva pra compliance).

### 5.1 Princípios visuais

- **Cada seção tem um único formulário com dirty-tracking** — botão "Salvar" desabilita até alguém mudar algo.
- **Cada campo tem help inline** (`?` que abre popover lateral, não tooltip — vide UX_PRINCIPLES.md).
- **Mudança crítica pede confirmação** (mudar role de OWNER, revogar API key, deletar canal) com **typing-to-confirm** (digite "REMOVER" pra continuar).
- **Audit log** mostra na própria seção quem mexeu por último e quando.

---

## 6. Auditoria de mudanças

Toda mudança em settings vira row em `audit_logs`:

```sql
{
  workspace_id: ...,
  actor_member_id: ...,
  actor_type: 'member' | 'platform_admin',
  action: 'settings.workspace.timezone_changed',     -- key estável
  resource_type: 'workspace',
  resource_id: ...,
  metadata: { old_value: 'UTC', new_value: 'America/Sao_Paulo' },
  ip_address: ...,
  user_agent: ...,
  created_at: now(),
}
```

OWNER/ADMIN podem ver em `/settings/audit`. platform_admin vê tudo em `/platform/audit-logs`.

Toda mudança de **secret** (`platform_secrets`) registra também na timeline do platform_admin com banner destacado: "API key da plataforma rotacionada por <user> em <data>".

---

## 7. Convites de members e propagação de role

Fluxo:

1. ADMIN clica "Convidar member" → modal: email, role inicial, depto/time.
2. Sistema cria row `members(status='invited')` + envia email com token.
3. Member abre link → Supabase Auth cria conta → linka `auth_user_id` no `members`.
4. `members.status='active'`, `joined_at=now()`.
5. Audit registra `member.invited` e depois `member.joined`.

**Não dá pra criar OWNER por convite.** Sempre começa como ADMIN ou abaixo. Mudança pra OWNER é cerimônia separada que exige confirmação do OWNER atual (porque OWNER é único? — não, podem ser múltiplos. Mas promoção a OWNER tem typing-to-confirm).

---

## 8. Convidando membros para nichos diferentes

Workspaces específicos de nichos (imobiliária, clínica, etc.) têm **convites tipados**: ao convidar, ADMIN pode escolher um **role+departamento template** que já alocam ao depto certo + dão acesso ao pipeline certo.

Ex: workspace "Imobiliária X" tem departamentos "Captação", "Vendas", "Locação". Convite tipado "Corretor de Vendas" = AGENT + dept Vendas + pipeline "Vendas" + tags relevantes.

---

## 9. Custom roles?

**Fora do MVP.** Os 5 roles + 1 flag cobrem 95% dos casos. Custom roles introduzem complexidade que não vale agora.

Se a demanda real aparecer pós-MVP, considerar:
- **Modo 1: claims overrides** — `members.permission_overrides jsonb` adiciona/remove permissões específicas em cima do role base.
- **Modo 2: custom roles** — tabela `custom_roles(workspace_id, name, permissions[])` substitui o enum role.

Modo 1 é mais leve e cobre maioria dos casos.

---

## 10. Exemplos concretos de uso

### 10.1 "Quero que esse member SUPERVISOR também possa ativar campanha"

→ Modo 1 (futuro): permission_overrides = `['+campaign.activate']`. No MVP, promove pra ADMIN ou deixa o ADMIN ativar.

### 10.2 "Quero esconder o painel financeiro pra esse OWNER específico" 

→ Não faz sentido — OWNER vê tudo. Se a pessoa não devia ver, ela não é OWNER. Promove pra ADMIN.

### 10.3 "Quero dar acesso só-leitura pra um cliente externo (CRM consultor)"

→ Cria member com role READONLY. Vê tudo, não muta nada.

### 10.4 "Quero que esse agente AI só toque conversas de um departamento"

→ Não é permissão de role, é configuração do agente: `agents.enabled_channel_ids` + lógica de roteamento no worker-inbound.

---

## 11. Anti-padrões do v1 (não repetir)

- ❌ **6 roles parecidos** (USER/AGENT/SUPERVISOR/TECHNICIAN/MANAGER/ADMIN/SUPER_ADMIN). No v2: 5 + flag clara.
- ❌ **Permissão como flag escondida em meio a campos** (`users.can_edit_pipeline boolean`). No v2: matriz centralizada tipada.
- ❌ **Settings de pessoal + workspace misturados na mesma tela.** No v2: sidebar separa em 3 grupos.
- ❌ **Notification preferences granulares na primeira versão** (vide PRD §3.3 #7). No MVP: apenas toggle on/off por canal. Granularidade entra com demanda.
- ❌ **Esconder no frontend e expor no backend.** No v2: permissão é enforcada server-side + RLS; frontend só esconde UI.
- ❌ **Não auditar mudança de role.** No v2: toda mudança de role registra `members.role_changed` em audit_logs.
- ❌ **Custom roles desde dia 1.** No v2: rejeitado pra MVP. Só se a demanda for clara.

---

## 12. Não-objetivos MVP

- ❌ Custom roles dinâmicos
- ❌ SCIM provisioning (sincronizar membros com Azure AD/Okta) — fase 3
- ❌ SSO (Google Workspace, Microsoft Entra) — fase 2
- ❌ MFA opt-in por workspace policy — fase 2
- ❌ Permission overrides per-member — fase 2
- ❌ Approval workflow pra mudança de settings críticas — fase 2

---

> Sistema de permissões e configurações **organizado** é precondição pra produto que escala. O v1 não tinha; o v2 tem desde o primeiro commit.
