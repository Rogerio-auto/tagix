# Feature — Modelos de mensagem do WhatsApp

> **Domínio:** catálogo de modelos aprovados para iniciar conversas pelo WhatsApp oficial
> **Superfície:** Central de **Modelos de mensagem do WhatsApp** e seletor da etapa **Mensagem**
> **Regra de linguagem:** a interface usa “modelo de mensagem”; `template`, `HSM`, nomes de status da Meta e IDs externos ficam restritos à integração e à ajuda técnica

---

## 1. Propósito

A Central de **Modelos de mensagem do WhatsApp** é o lugar único para consultar, sincronizar, criar e acompanhar os modelos de um canal oficial. Ela resolve a preparação da mensagem antes da campanha: o usuário entende quais modelos já podem ser usados, quais ainda dependem de aprovação e o que precisa ser corrigido.

Um modelo pertence ao canal oficial selecionado e não é compartilhado implicitamente entre números ou contas. A lista sempre identifica o canal e a última sincronização.

---

## 2. Matriz de canal

| Canal | Como a mensagem é preparada | Usa modelo aprovado nesta Central? | Fluxo próprio |
|---|---|---|---|
| WhatsApp oficial (`meta_whatsapp`) | Modelo enviado à Meta e aprovado para um idioma e categoria | Sim | Sincronizar, criar, acompanhar aprovação e escolher na campanha |
| Instagram (`meta_instagram`) | Mensagem direta compatível com a janela e, quando aplicável, uma tag permitida | Não | Editor de mensagem direta da campanha; Instagram não oferece modelos HSM |
| WhatsApp via WAHA (`waha`) | Conteúdo permitido pelo adapter e pelas regras operacionais desse canal | Não | Editor e validações próprios do WAHA; não simular aprovação da Meta |

Se o canal escolhido não for WhatsApp oficial, a interface não mostra “Modelos de mensagem do WhatsApp” como requisito e não reutiliza um modelo oficial fora do canal ao qual ele pertence.

---

## 3. Entrada e navegação

A Central fica acessível por:

- ação visível **Modelos de mensagem** na área de campanhas;
- estado vazio da etapa **Mensagem**;
- link de correção na **Revisão** quando um modelo deixou de estar aprovado;
- detalhe de um canal de WhatsApp oficial conectado.

O cabeçalho mostra **Modelos de mensagem do WhatsApp**, seletor de canal quando existe mais de um número oficial, data da última sincronização e as ações **Sincronizar modelos** e **Criar modelo**.

Filtros usam os nomes **Status**, **Categoria**, **Idioma** e busca por nome. O status e o canal permanecem visíveis em cada item; informações técnicas adicionais ficam no detalhe.

---

## 4. Jornada principal

### 4.1 Sincronizar modelos

1. O usuário escolhe um canal oficial conectado.
2. Clica **Sincronizar modelos**.
3. A ação entra em loading no próprio botão e a lista existente continua visível.
4. O sistema busca a lista completa na Meta, atualiza registros locais e marca como indisponíveis os modelos removidos no provider.
5. O resultado informa quantos modelos foram adicionados, atualizados e deixaram de estar disponíveis, além do horário da sincronização.

Sincronização é idempotente e nunca cria duplicatas. Uma falha não apaga o catálogo local: a tela informa que os dados podem estar desatualizados e oferece **Tentar novamente**.

### 4.2 Criar modelo

1. O usuário clica **Criar modelo** e escolhe o canal oficial.
2. Preenche nome, categoria, idioma e conteúdo. Cabeçalho, rodapé, botões, exemplos de variáveis e mídia aparecem somente quando aplicáveis.
3. Uma prévia permanente mostra exatamente a estrutura que será enviada para análise.
4. **Enviar para aprovação** valida o formulário, cria o modelo na Meta e salva a referência local.
5. O sucesso retorna à Central com o estado **Em análise** e explica que a aprovação depende da Meta.

O produto não promete prazo de aprovação. Antes do envio, explica que nome e idioma não podem ser alterados depois; uma mudança estrutural exige um novo modelo.

### 4.3 Acompanhar aprovação

A Central traduz os estados externos para decisões compreensíveis:

| Nome para o usuário | Status técnico | Pode usar em campanha? | Próxima ação |
|---|---|---|---|
| Em análise | `PENDING` | Não | Aguardar ou sincronizar novamente |
| Aprovado | `APPROVED` | Sim | **Usar em campanha** |
| Precisa de ajustes | `REJECTED` | Não | Ver motivo e criar uma versão corrigida |
| Pausado | `PAUSED` | Não | Ver orientação do provider e escolher outro modelo |
| Desativado | `DISABLED` | Não | Escolher outro modelo ou criar uma nova versão |
| Não disponível | removido/ausente no provider | Não | Sincronizar ou substituir nas campanhas em rascunho |

O detalhe preserva o status técnico e o motivo devolvido pela Meta para suporte, mas o alerta principal sempre descreve o impacto e a próxima ação. Mudanças recebidas por webhook atualizam a lista; **Sincronizar modelos** é a recuperação manual quando o webhook atrasar.

### 4.4 Usar em campanha

**Usar em campanha** abre o criador na etapa **Mensagem**, já com canal e modelo selecionados. Se houver um rascunho em andamento, a seleção acontece dentro dele sem criar outra campanha.

Na etapa **Mensagem**:

- somente modelos **Aprovados** do canal da campanha podem ser selecionados;
- a prévia exibe o conteúdo e o idioma antes da confirmação;
- cada variável é ligada a um campo do contato ou a um valor fixo e recebe um exemplo;
- trocar o canal limpa uma escolha incompatível e explica o motivo;
- se o status mudar antes da ativação, a **Revisão** bloqueia o envio e aponta para a escolha de outro modelo.

---

## 5. Estados de interface

Todos os estados mantêm o canal selecionado e apresentam uma ação clara.

| Estado | Mensagem e comportamento | Ação disponível |
|---|---|---|
| Carregando lista | Skeleton com a estrutura dos itens; sem tela em branco | Aguardar; filtros ficam desabilitados até os dados essenciais chegarem |
| Sincronizando | Lista atual continua navegável, com aviso discreto de que pode mudar | Botão mostra progresso e evita clique duplicado |
| Vazio | “Nenhum modelo encontrado neste canal” e explicação sobre criar ou trazer modelos existentes | **Criar modelo** e **Sincronizar modelos** |
| Busca sem resultado | “Nenhum modelo corresponde a estes filtros” | **Limpar filtros** |
| Erro ao carregar | Não apresenta lista antiga como atual sem aviso | **Tentar novamente** |
| Erro ao sincronizar | Mantém o catálogo local e mostra a data da última sincronização bem-sucedida | **Tentar novamente** |
| Sem permissão | Exibe a lista somente quando a role pode consultar e explica quem pode alterá-la | **Voltar para campanhas**; ações de mutação não aparecem |
| Canal desconectado | Explica que é necessário reconectar o WhatsApp oficial para sincronizar, criar ou usar modelos | **Reconectar canal** para `OWNER`/`ADMIN` |
| Token expirado | Trata como conexão indisponível, sem culpar o conteúdo do modelo | **Atualizar conexão** para `OWNER`/`ADMIN` |

Feedback de criação ou sincronização aparece junto à ação que o originou e também em toast curto. Erros de campo ficam ao lado do campo; mensagens genéricas não substituem orientações específicas.

---

## 6. Permissões

As permissões seguem `PERMISSIONS.md` e são validadas no backend:

- `OWNER` e `ADMIN`: consultar, sincronizar, criar e usar modelos;
- `SUPERVISOR`: consultar e usar modelos aprovados em campanhas em rascunho; não altera a conexão nem envia modelo à Meta;
- `READONLY`: consultar catálogo e detalhes sem ações de mutação;
- `AGENT`: não acessa campanhas nem a Central no MVP.

Uma pessoa que pode preparar o rascunho, mas não ativar campanhas, vê na **Revisão** a ação **Deixar rascunho pronto** e a orientação de que `OWNER` ou `ADMIN` deve concluir o envio.

---

## 7. Contrato entre Central e campanha

O catálogo local é a fonte de leitura rápida da interface, mas a validação final confirma o estado atual do canal e do modelo. Cada seleção conserva a identidade do canal, nome externo, idioma e versão de componentes usada na prévia.

Ao criar ou editar uma campanha:

1. o canal limita os modelos disponíveis;
2. a escolha salva a referência local e os identificadores necessários ao provider;
3. a Revisão verifica aprovação, variáveis, categoria, consentimento e conexão;
4. apenas uma validação segura permite iniciar ou agendar;
5. uma mudança posterior de status pausa ou bloqueia novos envios e orienta a substituição.

---

## 8. Não-objetivos do MVP

- Editar na plataforma um modelo já enviado à Meta.
- Compartilhar automaticamente modelos entre contas ou números oficiais.
- Tratar mensagens de Instagram ou WAHA como se fossem modelos aprovados.
- Prometer ou forçar aprovação da Meta.
- Expor payloads, IDs externos ou códigos de erro como conteúdo principal da interface.
