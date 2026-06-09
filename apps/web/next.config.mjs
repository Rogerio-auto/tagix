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
};

export default nextConfig;
