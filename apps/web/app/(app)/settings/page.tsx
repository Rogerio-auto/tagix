import { redirect } from 'next/navigation';

/**
 * `/settings` ainda não tem um índice próprio (o painel completo de settings é a
 * F8). Por ora redireciona para a primeira seção real, evitando 404 no item
 * "Configurações" do nav.
 */
export default function SettingsIndexPage() {
  redirect('/settings/channels');
}
