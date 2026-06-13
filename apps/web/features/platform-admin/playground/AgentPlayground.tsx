'use client';

/**
 * Agent Playground de plataforma (F26-S10, super-admin) -- testa um agente de QUALQUER
 * tenant em SANDBOX (zero side-effect): chat via stream SSE, troca de modelo (limitada
 * a allowed_models da policy), override efemero de system prompt/temperatura, e painel
 * de TRACE (tool calls "would-do" + custo is_test + latencia). DS v2 dark-first.
 */
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Bot, FlaskConical, Send } from 'lucide-react';
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

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-text-high">
          <FlaskConical className="size-6 text-accent" aria-hidden /> Playground
        </h1>
        <p className="text-sm text-text-mid">
          Teste um agente de qualquer tenant em <strong className="text-text-high">sandbox</strong>: nada e
          enviado ao cliente, nada e persistido; o custo vai como teste (is_test).
        </p>
      </header>

      <div className="flex flex-wrap gap-3 rounded-xl border border-border bg-surface-1 p-4">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
          <span className="text-text-mid">Tenant</span>
          <select
            value={workspaceId}
            onChange={(e) => {
              setWorkspaceId(e.target.value);
              setAgentId('');
              setModel('');
              reset();
            }}
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text-high focus:border-accent focus:outline-none"
          >
            <option value="">Selecione…</option>
            {tenants?.tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
          <span className="text-text-mid">Agente</span>
          <select
            value={agentId}
            onChange={(e) => {
              setAgentId(e.target.value);
              reset();
            }}
            disabled={!workspaceId}
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text-high disabled:opacity-50 focus:border-accent focus:outline-none"
          >
            <option value="">Selecione…</option>
            {agents?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
          <span className="text-text-mid">Modelo (override)</span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={!agentId}
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text-high disabled:opacity-50 focus:border-accent focus:outline-none"
          >
            <option value="">Padrão do agente</option>
            {allowedModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-3">
          <details className="rounded-xl border border-border bg-surface-1 p-4 text-sm">
            <summary className="cursor-pointer text-text-mid">Override efêmero (prompt / temperatura)</summary>
            <div className="mt-3 flex flex-col gap-3">
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={3}
                placeholder="System prompt (vazio = o do agente)"
                className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text-high placeholder:text-text-low focus:border-accent focus:outline-none"
              />
              <label className="flex w-40 flex-col gap-1">
                <span className="text-text-mid">Temperatura</span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value === '' ? '' : Number(e.target.value))}
                  className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text-high focus:border-accent focus:outline-none"
                />
              </label>
            </div>
          </details>

          <div className="flex min-h-64 flex-col gap-3 rounded-xl border border-border bg-surface-1 p-4">
            {turns.length === 0 && (
              <p className="m-auto text-sm text-text-low">Envie uma mensagem para testar (sandbox).</p>
            )}
            {turns.map((t) => (
              <div
                key={t.id}
                className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${t.role === 'user' ? 'self-end bg-accent/15 text-text-high' : 'self-start bg-surface-2 text-text-high'}`}
              >
                {t.text || (t.streaming ? '…' : '')}
                {t.usage && (
                  <div className="mt-1 text-xs text-text-low">
                    ${t.usage.total_cost_usd.toFixed(5)} · {t.usage.total_tokens ?? 0} tokens ·{' '}
                    <span className="text-accent">is_test</span>
                  </div>
                )}
              </div>
            ))}
            {error && <p className="text-sm text-danger">{error}</p>}
          </div>

          <div className="flex gap-2">
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
              disabled={!agentId || running}
              className="flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text-high placeholder:text-text-low disabled:opacity-50 focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={submit}
              disabled={!agentId || !input.trim() || running}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface-0 disabled:opacity-50"
            >
              <Send className="size-4" aria-hidden /> {running ? 'Rodando…' : 'Enviar'}
            </button>
          </div>
        </div>

        <aside className="flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text-high">
            <Bot className="size-4 text-text-mid" aria-hidden /> Trace de execução
          </h2>
          {trace.length === 0 ? (
            <p className="text-sm text-text-low">As tool calls aparecem aqui. Em sandbox, elas são mockadas (would-do).</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {trace.map((e) => (
                <li key={e.id} className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2">
                  <span className="font-mono text-text-high">{e.toolKey}</span>
                  <span className={`text-xs ${e.status === 'done' ? 'text-ok' : 'text-text-low'}`}>
                    {e.status === 'done' ? `${e.durationMs ?? 0}ms · would-do` : 'running…'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
