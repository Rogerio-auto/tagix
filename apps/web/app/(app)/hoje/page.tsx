import { TodayClient } from '@/features/today';
import { PageContainer } from '@/shared/components/layout';

export const metadata = { title: 'Hoje' };

/**
 * `/hoje` — a visão de dono (F61-S02 · APP_MOBILE_PLAN §3.1).
 *
 * Convive com `/` (o dashboard role-aware) em vez de substituí-lo: são públicos
 * diferentes. O dashboard serve quem opera o dia inteiro; esta tela serve quem
 * abre o celular entre uma tarefa e outra e quer três respostas.
 */
export default function HojePage() {
  return (
    <PageContainer>
      <TodayClient />
    </PageContainer>
  );
}
