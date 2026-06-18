'use client';

/**
 * Secoes do Portal do Desenvolvedor (F38-S13): Primeiros passos, Autenticacao,
 * Referencia (do OpenAPI live), Webhooks e Exemplos. Os snippets de codigo vivem
 * em ./snippets (strings cruas). Branding Leadium API. DS v2 (zero hex).
 */
import Link from 'next/link';
import { CodeBlock } from './CodeBlock';
import { ApiReference } from './ApiReference';
import { BASE, CURL, CURL_AUTH, JS, PY, WEBHOOK_VERIFY } from './snippets';

export function GettingStarted() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-head text-2xl font-semibold text-text">Primeiros passos</h2>
      <p className="font-body text-text-mid">
        A Leadium API e REST sobre HTTPS, com respostas em JSON. Toda requisicao e autenticada por
        uma API key de workspace e respeita o escopo (scope) concedido a chave.
      </p>
      <ol className="flex list-decimal flex-col gap-2 pl-5 font-body text-text-mid">
        <li>
          Gere uma API key em Configuracoes - Desenvolvedor (
          <Link href="/settings?section=dev" className="text-brand underline-offset-4 hover:underline">
            abrir
          </Link>
          ).
        </li>
        <li>Envie a chave no header Authorization (Bearer) em cada requisicao.</li>
        <li>Confira os scopes necessarios de cada endpoint na Referencia abaixo.</li>
      </ol>
      <CodeBlock label="Base URL" code={BASE} />
    </div>
  );
}

export function Authentication() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-head text-2xl font-semibold text-text">Autenticacao</h2>
      <p className="font-body text-text-mid">
        Autentique-se com uma API key de workspace no header Authorization, no formato Bearer. A
        chave carrega os scopes que limitam o que ela acessa; uma requisicao sem o scope necessario
        recebe 403.
      </p>
      <CodeBlock label="Exemplo de header" code={CURL_AUTH} />
      <div className="rounded-md border border-border-2 bg-surface-2 px-4 py-3">
        <p className="font-body text-sm text-text-mid">
          Trate a API key como uma senha: nunca a exponha no front-end nem em repositorios
          publicos. Rotacione a chave em Configuracoes - Desenvolvedor se houver suspeita de
          vazamento.
        </p>
      </div>
    </div>
  );
}

export function Webhooks() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-head text-2xl font-semibold text-text">Webhooks</h2>
      <p className="font-body text-text-mid">
        Configure endpoints de webhook para receber eventos do seu workspace em tempo real. Cada
        entrega e assinada com HMAC-SHA256 sobre o corpo bruto, usando o secret do webhook; valide a
        assinatura antes de confiar no payload. Entregas com falha sao reenviadas com backoff.
      </p>
      <CodeBlock label="Verificar a assinatura (Node.js)" code={WEBHOOK_VERIFY} />
    </div>
  );
}

export function Examples() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-head text-2xl font-semibold text-text">Exemplos</h2>
      <p className="font-body text-text-mid">
        Registrar uma conversao a partir de um contato, em tres linguagens. Troque SUA_API_KEY pela
        sua chave de workspace.
      </p>
      <CodeBlock label="cURL" code={CURL} />
      <CodeBlock label="JavaScript (fetch)" code={JS} />
      <CodeBlock label="Python (requests)" code={PY} />
    </div>
  );
}

export function ReferenceSection() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-head text-2xl font-semibold text-text">Referencia</h2>
      <p className="font-body text-text-mid">
        Todos os endpoints da Leadium API v1, agrupados por recurso. O scope exigido aparece a
        direita de cada rota.
      </p>
      <ApiReference />
    </div>
  );
}
