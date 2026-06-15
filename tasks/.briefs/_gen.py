# -*- coding: utf-8 -*-
import io

S09 = u"""

=== SLOT-ESPECIFICO F31-S09 — set_variable + input ===
files_allowed:
- packages/flow-engine/src/handlers/set_variable.handler.ts
- packages/flow-engine/src/handlers/input.handler.ts
- apps/web/features/flow-builder/nodes/set_variable/**
- apps/web/features/flow-builder/nodes/input/**

CONTEXTO: S08 (em main) criou STUBS dos 2 handlers e 2 dirs de UI (SetVariableNode/SetVariableInspector, InputNode/InputInspector, metadata.ts). Voce SOBRESCREVE com a logica real. CRITICO: mantenha os MESMOS export names (SetVariableNode, SetVariableInspector, InputNode, InputInspector) — nodeTypes.ts/nodeInspectors.ts (em main, NAO toque) importam por esses nomes. NAO toque registry/validation/node-catalog/nodeTypes/nodeInspectors (donos: S08). registry ja registra os 2 handlers; validation ja tem var roots vars/input.

set_variable: grava variavel da execucao. Retorne status SUCCESS com campo variables = um objeto { [nome]: valor } (o dispatcher faz merge em flow_executions.variables). Namespacing: use prefixo vars. nas chaves. schema { name, value, valueType? (string|number|boolean|json) }. value interpolado via interpolate(value, ctx.variables). UI: nome + valor (VariablesPicker p/ referenciar outras vars) + tipo. Var usavel a jusante via token vars.nome.

input: captura tipada com validacao + retry + timeout. ESPELHE o padrao bistavel de wait_for_response.handler.ts (em main):
  1a chamada: envia prompt (ctx.sendMessage texto interpolado — ENVIA DE VERDADE via bridge S01) e retorna status WAITING com nextStepAt = now + timeout, setando markers em variables (ex.: waiting_for_input:true).
  Resumption: quando vars.responded === true, valida a ULTIMA resposta do contato pelo validationType; em sucesso grava ctx.variables[variable] e retorna SUCCESS edgeHandle 'response' (limpando markers); em falha de validacao, re-envia retryMessage e continua WAITING ate maxRetries; ao exceder, roteia 'timeout' (ou edge de erro).
  Timeout: vars.waiting_for_input === true sem responded -> SUCCESS edgeHandle 'timeout'.
  Edges do catalogo (S08): input = [response, timeout]. schema { prompt, variable, validationType (text|email|phone|number|date), retryMessage?, maxRetries?, timeoutSeconds? }. A resposta crua do contato chega via ctx.variables (mesma mecanica de wait_for_response — leia como resumeFlowWithResponse semeia last_response/responded). UI: prompt (TextArea + VariablesPicker), seletor de tipo, variable name, retry message, max retries, timeout. Preview do prompt.

DoD: set_variable grava e var usavel a jusante; input valida tipo, faz retry e roteia response/timeout. typecheck/lint/test verdes.
Validacao: pnpm --filter @hm/flow-engine typecheck; pnpm --filter @hm/web typecheck; pnpm --filter @hm/flow-engine test; eslint nos arquivos.
"""

S10 = u"""

=== SLOT-ESPECIFICO F31-S10 — assign + template/HSM ===
files_allowed:
- packages/flow-engine/src/handlers/assign.handler.ts
- packages/flow-engine/src/handlers/template.handler.ts
- apps/web/features/flow-builder/nodes/assign/**
- apps/web/features/flow-builder/nodes/template/**

CONTEXTO: S08 (em main) criou STUBS. Sobrescreva. MANTENHA export names (AssignNode, AssignInspector, TemplateNode, TemplateInspector). NAO toque registry/validation/catalog/nodeTypes/nodeInspectors.

assign: atribui a conversa a member/time ou por estrategia (logica de auto-assign do F30-S09). A flow-engine NAO importa apps/api; mutacao via @hm/db sob RLS com withWorkspace — espelhe register_conversion.handler.ts (que usa @hm/db direto). Cheque ctx em packages/flow-engine/src/types.ts: ha setConversationAi/setConversationStatus; se NAO houver setConversationAssignee no ctx, escreva conversations.assignedMemberId direto sob RLS via withWorkspace (import { schema, withWorkspace } from '@hm/db'). Estrategia de referencia: apps/workers/src/inbound/ports.ts + db-ports.ts (pickAutoAssignee). schema { strategy (specific|round_robin|least_busy), memberId? }. Registre auditoria/historico se houver padrao. PERMISSIONS.md: assign no flow age como SISTEMA; RLS garante escopo. UI: MemberPicker (S03) + seletor de estrategia.

template: HSM aprovado (reabre janela 24h). ATENCAO: FlowOutboundMessage (S01) cobre text/media mas provavelmente NAO template. types.ts e o publisher sao do S01 (FORA do seu files_allowed). Faca o HANDLER SHAPE + UI corretos (templateName, languageCode, params por componente interpolados) e, se ctx.sendMessage nao aceitar template, RELATE o seam (FlowOutboundMessage precisa variante template + publisher montar OutboundJob kind template). NAO quebre typecheck: use o que ctx.sendMessage aceitar e documente a limitacao no header do handler. UI: campo/seletor de template + languageCode + params dinamicos com VariablesPicker.

DoD: assign atribui via member/estrategia + historico; template shape+UI corretos (envio real ou seam relatado). typecheck/lint/test verdes.
Validacao: pnpm --filter @hm/flow-engine typecheck; pnpm --filter @hm/web typecheck; pnpm --filter @hm/flow-engine test; eslint nos arquivos.
"""

S11 = u"""

=== SLOT-ESPECIFICO F31-S11 — ab_split + go_to_flow + UI register_conversion ===
files_allowed:
- packages/flow-engine/src/handlers/ab_split.handler.ts
- packages/flow-engine/src/handlers/go_to_flow.handler.ts
- apps/web/features/flow-builder/nodes/ab_split/**
- apps/web/features/flow-builder/nodes/go_to_flow/**
- apps/web/features/flow-builder/nodes/register_conversion/**

PROIBIDO: handlers/register_conversion.handler.ts (JA EXISTE e funciona — so faca a UI), registry, validation, node-catalog, nodeTypes, nodeInspectors. MANTENHA export names dos stubs do S08 (AbSplitNode/AbSplitInspector, GoToFlowNode/GoToFlowInspector, RegisterConversionNode/RegisterConversionInspector).

ab_split: distribui execucoes por PESO entre variantes (A/B). Edges do catalogo (S08): [a, b]. schema { weightA, weightB }. Execute: sorteio ponderado -> retorna status SUCCESS com edgeHandle 'a' ou 'b'. Opcional: gravar a variante em variables (root ab_variant ja conhecido). UI: inputs de peso + preview da distribuicao percentual.

go_to_flow: encadeia para outro flow (subflow). PROTECAO CONTRA LOOP obrigatoria (impedir A->B->A; rastreie flows visitados em ctx.variables ou limite de profundidade). schema { targetFlowId }. Execute: dispara/encadeia o flow alvo — veja como o dispatcher inicia flows (createFlowEngine/processFlowStepScoped + queue port em packages/flow-engine). Provavelmente enfileira nova execucao do flow alvo p/ o mesmo contato/conversa. Se exigir capability fora do ctx, faca o melhor e RELATE o seam. UI: seletor/campo de flow alvo + aviso de loop.

register_conversion UI: handler JA EXISTE (schema { conversionTypeKey, valueCents?, note? }). Faca SO a UI (RegisterConversionInspector + RegisterConversionNode): ConversionTypePicker do S03 tem value = conversion type ID, mas o handler espera conversionTypeKey; o helper conversionTypes expoe { id, name, key } — mapeie o id escolhido p/ key e grave conversionTypeKey em node.data. valueCents (input de moeda), note. Preview no node.

DoD: ab_split por peso; go_to_flow com protecao de loop; register_conversion configuravel pela UI. typecheck/lint/test verdes.
Validacao: pnpm --filter @hm/flow-engine typecheck; pnpm --filter @hm/web typecheck; pnpm --filter @hm/flow-engine test; eslint nos arquivos.
"""

for name, txt in [("F31-S09.md", S09), ("F31-S10.md", S10), ("F31-S11.md", S11)]:
    with io.open("tasks/.briefs/" + name, "a", encoding="utf-8", newline="\n") as f:
        f.write(txt)
print("appended slot-specific to S09/S10/S11")
