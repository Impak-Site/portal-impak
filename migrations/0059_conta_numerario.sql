-- 0059 — Faturas fase 2 (21/10/2026): numerário do despachante.
--
-- O numerário (adiantamento que o despachante pede antes do desembaraço) é
-- uma fatura a pagar com origem {tipo:'numerario'}; o acerto do despachante
-- abate esse valor (baixa "compensação", sem caixa) e a sobra vira devolução
-- a receber (origem {tipo:'devolucao_numerario'}). Nenhum dos dois é custo
-- nem receita: entram na conta abaixo, do grupo 'neutra' (fora do DRE). O
-- export pro contador usa esta conta como contrapartida do adiantamento.
--
-- Só um INSERT (idempotente). Sem esta linha o sistema funciona igual (o
-- código cai no plano padrão); com ela, a conta aparece no Plano de contas e
-- dá pra informar a conta contábil do contador.
-- Já aplicada em produção em 21/10/2026 (SQL Editor; conferida: 9.1.05, neutra, ordem 31).
INSERT INTO fin_contas (codigo, nome, grupo, ordem) VALUES
  ('9.1.05', 'Adiantamentos a despachante (numerário)', 'neutra', 31)
ON CONFLICT (codigo) DO NOTHING;
