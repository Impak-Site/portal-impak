-- 0060_di_taxa_valor_aduaneiro.sql
--
-- Pedido do Ayslan (21/10/2026): o DRE de cada processo passa a ter o
-- cabeçalho "CHECK-LIST FECHAMENTO IMPORTAÇÃO" da planilha de fechamento
-- (DI, DA, Processo, Fornecedor, NF Entrada, Qtde, Taxa DI, Frete, FOB US$ e
-- R$). Dois dados ainda não existiam no processo:
--   di_taxa_cambio     — taxa do dólar da DI/DUIMP ("TAXA USD: 5,0908")
--   di_valor_aduaneiro — total da DI em R$ (FOB + frete + seguro na taxa da
--                        DI — "TOTAL: USD ... - BRL ...")
-- Preenchidos pela leitura da DUIMP (Extração com IA) ou à mão, na aba
-- Documentos (bloco DI/DUIMP). Só informativos: não entram em nenhuma conta.

alter table controle_processos add column if not exists di_taxa_cambio numeric;
alter table controle_processos add column if not exists di_valor_aduaneiro numeric;
