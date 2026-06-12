// @ts-check
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Bundle analyzer OPT-IN. Roda só quando `ANALYZE=true` e o pacote
 * `@next/bundle-analyzer` está instalado (devDependency). Não é importado de forma
 * estática para que `build`/`typecheck` não quebrem quando a dep não está presente
 * (ela ainda não consta em package.json — ver docs/performance/REPORT.md).
 *
 * @param {import('next').NextConfig} config
 * @returns {import('next').NextConfig}
 */
function withOptionalAnalyzer(config) {
  if (process.env.ANALYZE !== 'true') return config;
  try {
    /** @type {(opts: { enabled: boolean }) => (c: import('next').NextConfig) => import('next').NextConfig} */
    const withBundleAnalyzer = require('@next/bundle-analyzer');
    return withBundleAnalyzer({ enabled: true })(config);
  } catch {
    // Dep ausente: segue sem analyzer em vez de quebrar o build.
    console.warn(
      '[next.config] ANALYZE=true mas @next/bundle-analyzer não está instalado — ignorando. ' +
        'Instale com: pnpm --filter @hm/web add -D @next/bundle-analyzer',
    );
    return config;
  }
}

/**
 * Sentry OPT-IN (browser/server/edge via `@sentry/nextjs`). Mesmo padrão guardado
 * do analyzer: o wrap só roda quando o DSN está presente E a dep está instalada.
 *
 * - Sem `NEXT_PUBLIC_SENTRY_DSN`: retorna o config intacto — build não muda, init
 *   no client/server vira no-op. Zero overhead em dev/local.
 * - Sem a dep `@sentry/nextjs` (ainda não instalada quando este slot é escrito):
 *   o `require` lança e caímos no catch, seguindo sem o wrap em vez de quebrar.
 * - Upload de source maps só acontece quando `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` +
 *   `SENTRY_PROJECT` existem (build de CI/Linux). Sem token, `silent` evita ruído.
 *
 * @param {import('next').NextConfig} config
 * @returns {import('next').NextConfig}
 */
function withOptionalSentry(config) {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return config;
  try {
    /** @type {{ withSentryConfig: (c: import('next').NextConfig, opts: Record<string, unknown>) => import('next').NextConfig }} */
    const { withSentryConfig } = require('@sentry/nextjs');
    const hasUploadCreds = Boolean(
      process.env.SENTRY_AUTH_TOKEN &&
        process.env.SENTRY_ORG &&
        process.env.SENTRY_PROJECT,
    );
    return withSentryConfig(config, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      // Sem credenciais de upload (dev/local), desliga a geração/upload de source
      // maps para o build não tentar (e não falhar) o passo de release.
      sourcemaps: { disable: !hasUploadCreds },
      // Reduz o ruído de bundle: desativa o telemetry do plugin de build.
      telemetry: false,
      // Encaminha o tunnel só se configurado; mantém o ad-blocker bypass opt-in.
      tunnelRoute: process.env.NEXT_PUBLIC_SENTRY_TUNNEL_ROUTE,
      disableLogger: true,
    });
  } catch {
    console.warn(
      '[next.config] NEXT_PUBLIC_SENTRY_DSN definido mas @sentry/nextjs não está ' +
        'instalado — seguindo sem o wrap do Sentry.',
    );
    return config;
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // `standalone` (para a imagem Docker de produção) é ativado via env no build
  // Linux/CI. No Windows local fica off: o passo de symlink do standalone falha
  // com EPERM sem Modo de Desenvolvedor/admin, e standalone não é usado em dev.
  output: process.env.BUILD_STANDALONE === 'true' ? 'standalone' : undefined,
  // Pacotes do monorepo são TS-source — Next transpila.
  transpilePackages: ['@hm/ui', '@hm/design-tokens', '@hm/shared'],
  // Compressão gzip no server Next (produção self-hosted atrás do proxy).
  compress: true,
  // Remove o header `X-Powered-By` (superfície de fingerprint a menos).
  poweredByHeader: false,
  // Tree-shaking de barrel imports das libs pesadas: o Next reescreve os imports
  // de pacotes "barrel" (um index re-exportando tudo) para imports diretos do
  // submódulo usado, evitando puxar a lib inteira no bundle da rota. Mensurável
  // em recharts/lucide/@xyflow sem tocar o código das features (boundary sagrada).
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'recharts',
      '@xyflow/react',
      '@fullcalendar/react',
      '@fullcalendar/core',
      '@fullcalendar/daygrid',
      '@fullcalendar/timegrid',
      '@fullcalendar/interaction',
      '@dnd-kit/core',
      '@dnd-kit/sortable',
      '@dnd-kit/utilities',
    ],
  },
  images: {
    // Formatos modernos: o Next serve AVIF/WebP quando o browser aceita.
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [{ protocol: 'https', hostname: '**.r2.cloudflarestorage.com' }],
  },
  // Proxy de dev: o navegador fala só com o web (mesma origem) e o Next encaminha
  // /api, /auth e /socket.io para a API. Evita o inferno de cookie cross-origin
  // (SameSite) no localhost e espelha produção (web + api atrás do mesmo host).
  async rewrites() {
    const target = process.env.API_PROXY_TARGET ?? 'http://localhost:3001';
    return [
      { source: '/api/:path*', destination: `${target}/api/:path*` },
      { source: '/auth/:path*', destination: `${target}/auth/:path*` },
      // socket.io: o handshake bate em /socket.io (sem segmento) e /socket.io/...
      { source: '/socket.io', destination: `${target}/socket.io` },
      { source: '/socket.io/:path*', destination: `${target}/socket.io/:path*` },
    ];
  },
};

export default withOptionalSentry(withOptionalAnalyzer(nextConfig));
