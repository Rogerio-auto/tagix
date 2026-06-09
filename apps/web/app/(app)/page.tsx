import { PageHeader } from '@/shared/components/layout/PageHeader';

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" />
      <div className="rounded-lg border border-border bg-surface p-8">
        <p className="font-body text-text-mid">
          Bem-vindo ao Highermind. As métricas do workspace aparecem aqui.
        </p>
      </div>
    </>
  );
}
