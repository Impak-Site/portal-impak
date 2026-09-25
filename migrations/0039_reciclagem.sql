-- Reciclagem de pneus (25/09/2026) — pedido do Ayslan.
-- Processos com NCM 4011/4012 entram na relação trimestral de reciclagem por
-- cliente. Peso a reciclar = 70% do peso total da DI/DUIMP.

-- 1) Dados lidos da DI/DUIMP (campo "Informações Complementares")
ALTER TABLE controle_processos ADD COLUMN IF NOT EXISTS di_peso_liquido numeric;
ALTER TABLE controle_processos ADD COLUMN IF NOT EXISTS di_ncms text;

-- 2) Acompanhamento de cada relação trimestral por cliente
CREATE TABLE IF NOT EXISTS reciclagem_lotes (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  cliente         text NOT NULL,
  cliente_cnpj    text,
  ano             int  NOT NULL,
  trimestre       int  NOT NULL CHECK (trimestre BETWEEN 1 AND 4),
  data_envio      date,
  data_realizacao date,
  data_pagamento  date,
  valor           numeric,
  obs             text,
  processos       jsonb,
  atualizado_por  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cliente, ano, trimestre)
);
ALTER TABLE reciclagem_lotes ENABLE ROW LEVEL SECURITY;
