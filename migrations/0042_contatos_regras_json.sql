-- Migration 0042: regras por cadastro (contatos_clientes.regras_json)
--
-- Pedido da Emanuelly (01/10/2026), proforma da Tyre Export, Inc.:
-- "Consegue criar uma nova regra para esse expo? sempre que for ele, ler o
-- nº da proforma no campo escrito Number PO" — e o Ayslan confirmou que
-- esse número vira a REFERÊNCIA do processo.
--
-- Em vez de uma regra fixa no código pra cada exportador, o cadastro da
-- empresa passa a guardar as regras de leitura dos documentos dela. Hoje
-- só existe uma chave; outras entram aqui sem nova migration:
--
--   regras_json = {
--     "referencia_origem": "PO"    -- de onde vem a referência do processo
--                                  -- quando a IA lê uma PI/CI deste
--                                  -- fornecedor: "" (padrão, a IA decide),
--                                  -- "PO" (Number PO / Purchase Order),
--                                  -- "PI" (nº da PI) ou "CI" (nº da CI)
--   }
--
-- Rodar no SQL Editor do Supabase (produção). Coluna nova em tabela que já
-- tem GRANT pro service_role — não precisa de GRANT extra.

ALTER TABLE contatos_clientes
  ADD COLUMN IF NOT EXISTS regras_json JSONB DEFAULT '{}'::jsonb;
