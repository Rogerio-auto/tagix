import { ProductsCatalogPage } from '@/features/products';
import { PageContainer } from '@/shared/components/layout';

export const metadata = { title: 'Produtos' };

export default function Page() {
  return (
    <PageContainer>
      <ProductsCatalogPage />
    </PageContainer>
  );
}
