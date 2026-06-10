/** @type {import('next').NextConfig} */
const nextConfig = {
  // `standalone` (para a imagem Docker de produção) é ativado via env no build
  // Linux/CI. No Windows local fica off: o passo de symlink do standalone falha
  // com EPERM sem Modo de Desenvolvedor/admin, e standalone não é usado em dev.
  output: process.env.BUILD_STANDALONE === 'true' ? 'standalone' : undefined,
  // Pacotes do monorepo são TS-source — Next transpila.
  transpilePackages: ['@hm/ui', '@hm/design-tokens', '@hm/shared'],
  images: {
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
      { source: '/socket.io/:path*', destination: `${target}/socket.io/:path*` },
    ];
  },
};

export default nextConfig;
