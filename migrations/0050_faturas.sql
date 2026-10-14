-- Migration 0050: faturas (contas a pagar / a receber), 14/10/2026.
--
-- Uma fatura = documento de uma empresa do cadastro (fatura do armador,
-- nota do despachante, DARF, boleto ao cliente) agrupando uma ou mais
-- taxas (itens) de um ou mais processos. Gerada a partir da aba Custos
-- Reais ("Gerar faturas") e acompanhada na tela /faturas. Nunca é apagada:
-- status 'cancelada' guarda o histórico.
CREATE TABLE IF NOT EXISTS faturas (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  numero        text,                       -- sequencial NNNNNN/AA (ex.: 000123/26), gerado no servidor
  tipo          text NOT NULL CHECK (tipo IN ('pagar','receber')),
  empresa_id    text,                       -- contatos_clientes.id (sem FK de propósito, igual migration 0043)
  empresa_nome  text NOT NULL,
  documento     text,                       -- nº da fatura / DARF / NF / boleto
  moeda         text NOT NULL DEFAULT 'BRL',
  cambio        numeric(12,6),              -- fator de conversão pra R$ na data (1 pra BRL)
  valor         numeric(14,2) NOT NULL DEFAULT 0,
  valor_pago    numeric(14,2),
  emissao       date,
  vencimento    date,
  pago_em       date,
  status        text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','paga','cancelada')),
  obs           text,
  itens         jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{processo_id, referencia, taxa, label, valor, moeda}]
  criado_por    text,
  alterado_por  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_faturas_numero ON faturas (numero) WHERE numero IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_faturas_status_venc ON faturas (status, vencimento);
CREATE INDEX IF NOT EXISTS idx_faturas_empresa ON faturas (empresa_id) WHERE empresa_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_faturas_itens ON faturas USING gin (itens);
ALTER TABLE faturas ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.faturas TO service_role;
