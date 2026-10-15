-- Migration 0052: faturas — origem (a receber gerado de parcela de câmbio /
-- venda do processo) e aprovação de pagamento, 14/10/2026.
--
-- origem:    {tipo:'parcela_cambio'|'venda', processo_id, referencia, idx}
--            O índice único impede gerar 2 faturas (não canceladas) pra mesma
--            parcela/venda. Baixas dessas faturas espelham o recebido no processo.
-- aprovacao: {por, nome, em} — gerente aprova o pagamento (não bloqueia a baixa).
ALTER TABLE faturas ADD COLUMN IF NOT EXISTS origem    jsonb;
ALTER TABLE faturas ADD COLUMN IF NOT EXISTS aprovacao jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS idx_faturas_origem_unica
  ON faturas ((origem->>'tipo'), (origem->>'processo_id'), (origem->>'idx'))
  WHERE origem IS NOT NULL AND status <> 'cancelada';
