import { redirect } from 'next/navigation';

/**
 * `/hoje` virou a Home (F72-S04). A rota continua existindo porque o PWA instalado
 * antes da F72 abre em `/hoje` (`start_url` antigo) e o atalho precisa seguir
 * funcionando. O redirect acontece no servidor, sem tela intermediária.
 *
 * Temporário (307) de propósito, não `permanentRedirect` (308): o 308 fica gravado no
 * cache do navegador para sempre, e `/hoje` deixaria de ser uma rota que o produto
 * pode reaproveitar. O custo é um salto a mais só para quem tem o atalho antigo.
 */
export default function HojePage(): never {
  redirect('/');
}
