-- Signup self-serve: intenção de plano escolhido na página de venda.
-- `pending_plan_key` guarda a KEY do plano pago escolhido no cadastro (ex.: 'pro').
-- Sobrevive ao round-trip do email de verificação (sem depender de localStorage).
-- O signup SEMPRE provisiona free/trial — esta coluna é só a intenção; o app
-- redireciona ao checkout pós-login e a limpa ao consumir. NUNCA libera plano pago.
-- `subscriptions` já tem RLS (0001) — coluna herda o isolamento por workspace.
-- Idempotente: ADD COLUMN IF NOT EXISTS -> reaplicar não falha.

ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "pending_plan_key" text;
