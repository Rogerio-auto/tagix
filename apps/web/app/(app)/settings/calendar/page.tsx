import { AvailabilityRulesSettings } from '@/features/calendar/availability';
import { PageContainer } from '@/shared/components/layout';

export const metadata = { title: 'Disponibilidade' };

export default function Page(): React.JSX.Element {
  return (
    <PageContainer>
      <AvailabilityRulesSettings />
    </PageContainer>
  );
}
