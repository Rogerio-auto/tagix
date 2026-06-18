import { ArticleView } from '@/features/help';
import { PageContainer } from '@/shared/components/layout';

export const metadata = { title: 'Ajuda' };

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <PageContainer>
      <ArticleView slug={slug} />
    </PageContainer>
  );
}
