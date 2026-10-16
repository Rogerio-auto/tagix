'use client';

/**
 * Agent Playground de plataforma (F26-S10, super-admin) no DS 3.0 (F72-S08) -- testa um
 * agente de QUALQUER tenant em SANDBOX (zero side-effect): chat via stream SSE, troca de
 * modelo (limitada a `allowed_models` da política), override efêmero de prompt e
 * temperatura, e o TRACE (tool calls "would-do" + custo is_test + latência).
 *
 * Fluxo inalterado: mesmo `useSandboxStream().send(...)` com o mesmo payload. Visual:
 * controles no desenho do `Input`, transcript com `aria-live`, custo e latência em mono,
 * "Enviar" é o único CTA de marca da tela. O cursor pisca só enquanto o modelo escreve
 * (estado vivo, `motion-safe`).
 *
 * UX: §2.5 `?` no título; §2.6 vazio explica o próximo passo; §2.7 botão em carregando;
 * §2.10 Enter envia, Shift+Enter quebra linha.
 */
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Activity, FlaskConical, Send, SlidersHorizontal } from 'lucide-react';
import { Badge, Button } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { formatNumber } from '@/shared/lib/locale';
import { usd } from '../lib/labels';
import { PlatformPageHeader } from '../ui/PlatformPageHeader';
import { controlClass, FieldLabel, Panel, textareaClass } from '../ui/kit';
import { useTenantAgents, useTenantOptions, useWorkspaceModels } from './queries';
import { useSandboxStream } from './useSandboxStream';

export function AgentPlayground() {
  const params = useSearchParams();
  const [workspaceId, setWorkspaceId] = useState(params.get('workspace') ?? '');
  const [agentId, setAgentId] = useState('');
  const [model, setModel] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [temperature, setTemperature] = useState<number | ''>('');
  const [input, setInput] = useState('');

  const { data: tenants } = useTenantOptions();
  const { data: agents } = useTenantAgents(workspaceId);
  const { data: policy } = useWorkspaceModels(workspaceId);
  const { turns, trace, running, error, send, reset } = useSandboxStream();

  const allowedModels = policy?.policy.allowedModels ?? [];

  function submit() {
    if (!workspaceId || !agentId || !input.trim() || running) return;
    void send({
      workspaceId,
      agentId,
      userInput: input.trim(),
      model: model || undefined,
      systemPrompt: systemPrompt || undefined,
      temperature: temperature === '' ? undefined : temperature,
    });
    setInput('');
  }

  const emptyHint = !workspaceId
    ? 'Escolha um tenant e um agente para começar.'
    : !agentId
      ? 'Escolha o agente que vai responder.'
      : 'Envie uma mensagem de teste. Nada chega ao cliente.';

  return (
    <div className="flex flex-col">
      <PlatformPageHeader
        href="/platform/playground"
        title="Playground"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone="info" size="sm" dot>
              Sandbox
            </Badge>
            Nada é enviado ao cliente nem persistido; o custo entra como teste.
          </span>
        }
        help={
          <p>
            O modelo de override se limita aos permitidos pela política do workspace. As tool calls
            aparecem no trace como &ldquo;would-do&rdquo;: o agente decide, mas nada é executado.
          </p>
        }
      />

      <div className="flex flex-col gap-4">
        <section aria-label="Configuração do teste" className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3 md:p-5">
          <FieldLabel label="Tenant">
            <select
              value={workspaceId}
              onChange={(e) => {
                setWorkspaceId(e.target.value);
                setAgentId('');
                setModel('');
                reset();
              }}
              className={controlClass}
            >
              <option value="">Selecione…</option>
              {tenants?.tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </FieldLabel>
          <FieldLabel label="Agente">
            <select
              value={agentId}
              onChange={(e) => {
                setAgentId(e.target.value);
                reset();
              }}
              disabled={!workspaceId}
              className={controlClass}
            >
              <option value="">Selecione…</option>
              {agents?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </FieldLabel>
          <FieldLabel label="Modelo (override)">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={!agentId}
              className={cn(controlClass, 'font-mono')}
            >
              <option value="">Padrão do agente</option>
              {allowedModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </FieldLabel>
        </section>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-3">
            <details className="group rounded-lg border border-border bg-surface">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-4 font-body text-sm font-bold text-text-mid outline-none transition-colors duration-(--dur-fast) hover:text-text focus-visible:focus-ring [&::-webkit-details-marker]:hidden">
                <SlidersHorizontal className="size-4 text-text-low" aria-hidden />
                Override efêmero (prompt e temperatura)
              </summary>
              <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
                <FieldLabel label="System prompt" hint="Vazio usa o prompt do agente.">
                  <textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    rows={3}
                    className={textareaClass}
                  />
                </FieldLabel>
                <FieldLabel label="Temperatura" className="w-40">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    inputMode="decimal"
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value === '' ? '' : Number(e.target.value))}
                    className={cn(controlClass, 'font-mono tabular-nums')}
                  />
                </FieldLabel>
              </div>
            </details>

            <Panel title="Conversa de teste" titleId="playground-chat" icon={FlaskConical} body="flush">
              <div
                role="log"
                aria-label="Transcrição do teste"
                className="flex min-h-72 flex-col gap-3 px-4 py-4 md:px-5"
              >
                {turns.length === 0 && (
                  <p className="m-auto max-w-xs text-center font-body text-sm text-text-low">{emptyHint}</p>
                )}
                {turns.map((t) => (
                  <div
                    key={t.id}
                    className={cn(
                      'max-w-[85%] rounded-lg border px-3.5 py-2.5',
                      t.role === 'user'
                        ? 'self-end rounded-br-xs border-brand-text/20 bg-brand-text/10'
                        : 'self-start rounded-bl-xs border-border bg-surface-2',
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words font-body text-sm text-text">
                      {t.text}
                      {t.streaming && (
                        <span
                          aria-hidden
                          className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 rounded-xs bg-text-mid motion-safe:animate-pulse"
                        />
                      )}
                    </p>
                    {t.usage && (
                      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs tabular-nums text-text-low">
                        <span>{usd(t.usage.total_cost_usd, 5)}</span>
                        <span aria-hidden>·</span>
                        <span>{formatNumber(t.usage.total_tokens ?? 0)} tokens</span>
                        <Badge tone="info" size="sm">
                          is_test
                        </Badge>
                      </p>
                    )}
                  </div>
                ))}
                {error && (
                  <p role="alert" className="font-body text-sm text-danger">
                    {error}
                  </p>
                )}
              </div>

              <form
                className="flex gap-2 border-t border-border p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  placeholder="Mensagem de teste…"
                  aria-label="Mensagem de teste"
                  disabled={!agentId || running}
                  className={cn(controlClass, 'flex-1')}
                />
                <Button
                  type="submit"
                  variant="primary"
                  loading={running}
                  disabled={!agentId || !input.trim()}
                  leftIcon={<Send className="size-4" aria-hidden />}
                >
                  {running ? 'Rodando…' : 'Enviar'}
                </Button>
              </form>
            </Panel>
          </div>

          <Panel
            title="Trace de execução"
            titleId="playground-trace"
            icon={Activity}
            body="flush"
            className="lg:sticky lg:top-24"
          >
            {trace.length === 0 ? (
              <p className="px-5 py-6 font-body text-sm text-text-low">
                As tool calls aparecem aqui. Em sandbox elas são simuladas (would-do).
              </p>
            ) : (
              <ol className="divide-y divide-border">
                {trace.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span className="truncate font-mono text-sm text-text">{e.toolKey}</span>
                    {e.status === 'done' ? (
                      <span className="shrink-0 font-mono text-xs tabular-nums text-text-low">
                        {formatNumber(e.durationMs ?? 0)} ms · would-do
                      </span>
                    ) : (
                      <Badge tone="info" size="sm" live>
                        rodando
                      </Badge>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
