'use client';

/**
 * Seção Settings → Dev (F9-S06). Plugada no SectionRegistry do shell (F8-S05) via
 * `lazy()` no id `dev`. Reúne a gestão de API keys e webhooks outbound (F9-S04) e um
 * deep-link para a documentação OpenAPI/Swagger da API pública (F9-S03).
 */
import ApiKeysManager from './ApiKeysManager';
import WebhooksManager from './WebhooksManager';

export default function DevSection(): React.JSX.Element {
  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <p className="text-sm text-text-mid">
        Credenciais e integrações da API pública do workspace. Consulte a{' '}
        <a
          href="/api/v1/docs"
          target="_blank"
          rel="noreferrer"
          className="text-brand underline-offset-4 hover:underline"
        >
          documentação da API (Swagger)
        </a>{' '}
        para os endpoints disponíveis.
      </p>

      <ApiKeysManager />
      <WebhooksManager />
    </div>
  );
}
