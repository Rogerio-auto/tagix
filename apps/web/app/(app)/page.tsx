import { HomeClient } from '@/features/dashboard';
import { PageContainer } from '@/shared/components/layout';

export const metadata = { title: 'Home' };

/**
 * Home (F72-S04). Server Component fino: o shell client carrega o resumo da Home e o
 * painel completo. Server-driven: a página nunca decide visibilidade por papel, o
 * servidor já entrega só o que cada papel pode ver (DASHBOARD.md §8).
 */
export default function HomePage() {
  return (
    <PageContainer>
      <HomeClient />
    </PageContainer>
  );
}
