import { BackupPage } from '@/features/flow-builder/backup/BackupPage';
import { PageContainer } from '@/shared/components/layout';

export const metadata = {
  title: 'Backup de Flows',
};

export default function FlowsBackupPage() {
  return (
    <PageContainer>
      <BackupPage />
    </PageContainer>
  );
}
