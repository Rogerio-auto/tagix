import { FlowEditorPage } from '@/features/flow-builder/FlowEditorPage';

export const metadata = {
  title: 'Editor de flow',
};

export default async function FlowEditorRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FlowEditorPage flowId={id} />;
}
