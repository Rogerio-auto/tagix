import { LazyCalendarPage } from '@/features/calendar';

export const metadata = { title: 'Agenda' };

export default function Page(): React.JSX.Element {
  return <LazyCalendarPage />;
}
