// Importa o `cn` do subpath leaf (util puro: clsx+tailwind-merge), NÃO do barrel
// `@hm/ui` — o barrel re-exporta componentes client ('use client'), o que arrastaria
// useEffect/createContext para qualquer Server Component que use skeletons (ex.
// app/(app)/loading.tsx). Ver F10-S10/integração.
export { cn } from '@hm/ui/cn';
