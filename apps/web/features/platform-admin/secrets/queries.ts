'use client';

/**
 * React Query hooks da rotação de secrets (F25-S08) sobre a API F25-S04. O valor
 * em claro NUNCA trafega na listagem — só metadados (key_version/updated_at).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platformSecrets } from '@/features/platform-admin/lib';
import type { PlatformSecretMeta } from '@/features/platform-admin/lib';

const secretsKey = ['platform', 'secrets'] as const;

export function useSecrets() {
  return useQuery({ queryKey: secretsKey, queryFn: () => platformSecrets.list() });
}

export function useRotateSecret() {
  const qc = useQueryClient();
  return useMutation<{ secret: PlatformSecretMeta }, Error, { key: string; value: string }>({
    mutationFn: ({ key, value }) => platformSecrets.rotate(key, value),
    onSuccess: () => void qc.invalidateQueries({ queryKey: secretsKey }),
  });
}
