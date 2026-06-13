import { ConversionTypesSettings } from '@/features/conversions';
import { PageContainer } from '@/shared/components/layout';

export const metadata = { title: 'Tipos de conversão' };

export default function Page() {
  return (
    <PageContainer>
      <ConversionTypesSettings />
    </PageContainer>
  );
}
