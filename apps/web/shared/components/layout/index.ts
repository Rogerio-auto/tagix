// Barrel das primitivas de layout server-safe. NÃO re-exporta AppLayout/Sidebar/
// TopBar (componentes client 'use client') — importá-los por caminho direto evita
// arrastar useEffect/createContext para Server Components que só querem o container
// (mesmo princípio do leaf `@hm/ui/cn`, ver F10-S10).
export { PageContainer, type PageContainerProps, type PageContainerVariant } from './PageContainer';
export { PageHeader, type PageHeaderProps } from './PageHeader';
