-- 0056_pessoas_assuntos_email.sql
--
-- Pedido Ayslan (21/10/2026): "no cadastro, precisamos ter um flag para
-- receber" — cada pessoa (do cliente, fornecedor, despachante,
-- transportadora, agente de cargas ou da própria IMPAK) marca quais e-mails
-- do sistema recebe, e se entra como destinatário (Para) ou em cópia (Cópia).
--
--   assuntos_email = {
--     "CAMBIO":      "para" | "cc",   -- adiantamento de câmbio
--     "TRANSPORTE":  "para" | "cc",   -- transporte rodoviário (pedir a
--                                     -- transportadora / pedido de carregamento)
--     "FOLLOWUP":    "para" | "cc",   -- follow-up (prontidão, embarque, chegada)
--     "FINANCEIRO":  "para" | "cc",   -- resumo do processo, NF, boleto, pagamentos
--     "DESPACHANTE": "para" | "cc",   -- abertura do processo com o despachante
--     "INSTRUCAO":   "para" | "cc"    -- instrução de embarque (agente de cargas)
--   }
--
-- Assunto ausente = não recebe. A lista de assuntos fica no código
-- (destinatarios-core.js, na raiz); assunto novo não precisa de migration.
-- Aditiva e idempotente: pode rodar mais de uma vez.

ALTER TABLE cadastros_pessoas
  ADD COLUMN IF NOT EXISTS assuntos_email JSONB NOT NULL DEFAULT '{}'::jsonb;
