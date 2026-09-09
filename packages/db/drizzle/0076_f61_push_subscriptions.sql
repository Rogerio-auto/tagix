-- F61-S03 — assinaturas de Web Push por dispositivo (APP_MOBILE_PLAN §4.1/§4.3).
--
-- Por dispositivo, não por pessoa: a mesma pessoa tem iPhone e desktop, e uma
-- assinatura por membro faria o aviso chegar num aparelho só — quase sempre o
-- errado, porque o último a assinar ganharia. O `endpoint` que o navegador gera
-- por instalação já é único no mundo, então é ele a chave.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- CASCADE de propósito: ex-funcionário com o app no celular não pode continuar
  -- recebendo aviso de lead do workspace de onde saiu.
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  label text,
  user_agent text,
  -- Falhas AMBÍGUAS consecutivas (rede, 5xx). 404/410 não incrementa: apaga a
  -- linha, porque a resposta do provedor é a fonte da verdade sobre a existência
  -- da assinatura.
  failure_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
--> statement-breakpoint

-- Reassinar o mesmo aparelho ATUALIZA (as chaves rotacionam), nunca duplica.
CREATE UNIQUE INDEX IF NOT EXISTS uq_push_subscriptions_endpoint
  ON push_subscriptions (endpoint);
--> statement-breakpoint

-- Hot path do envio: "todas as assinaturas deste membro".
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_member
  ON push_subscriptions (workspace_id, member_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_last_used
  ON push_subscriptions (last_used_at) WHERE last_used_at IS NOT NULL;
--> statement-breakpoint

-- RLS, como toda tabela com workspace_id próprio (regra F0-S04).
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE push_subscriptions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS push_subscriptions_isolation ON push_subscriptions;
--> statement-breakpoint
CREATE POLICY push_subscriptions_isolation ON push_subscriptions
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
