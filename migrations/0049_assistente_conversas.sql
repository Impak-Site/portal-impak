-- Migration 0049: conversas do Assistente (chat com ferramentas), 14/10/2026.
--
-- Uma linha por conversa, por usuário. `mensagens` guarda só o texto
-- (user/assistant) e, por mensagem do assistente, quais ferramentas foram
-- usadas — nunca credencial nem dado bruto do banco. Nada é apagado:
-- "arquivada" esconde da lista.
CREATE TABLE IF NOT EXISTS assistente_conversas (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  usuario     text NOT NULL,
  titulo      text,
  mensagens   jsonb NOT NULL DEFAULT '[]'::jsonb,
  arquivada   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assistente_conversas_usuario ON assistente_conversas (usuario, updated_at DESC);
ALTER TABLE assistente_conversas ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.assistente_conversas TO service_role;
