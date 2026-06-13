import { ContactsPage } from '@/features/contacts';
import { PageContainer } from '@/shared/components/layout';

export const metadata = { title: 'Contatos' };

export default function Page() {
  return (
    <PageContainer>
      <ContactsPage />
    </PageContainer>
  );
}
