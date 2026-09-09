-- Migration 0028: Banco/Corretora + Custo da Operação de câmbio
-- Pedido do Ayslan (09/09/2026), sugestão do "se você fosse o financeiro
-- da Impak, o que gostaria de ver" -- concentração de risco por
-- banco/corretora e custo total real da operação de câmbio (não só a taxa).
--
-- Cobre o caso "pagamento único" (À Vista/Prazo/Entrada+Saldo legado), que
-- vive direto na tabela controle_processos. Parcelas do tipo "Parcelado"
-- não precisam de coluna nova -- ganham as mesmas chaves (banco,
-- custo_operacao) dentro do próprio pi_parcelas_json (JSON livre, sem
-- migration necessária).

ALTER TABLE controle_processos
  ADD COLUMN IF NOT EXISTS pi_cambio_banco TEXT,
  ADD COLUMN IF NOT EXISTS pi_cambio_custo NUMERIC;
