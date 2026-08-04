-- 0010_add_brand.sql
--
-- Marca (brand) do produto, separada do Fornecedor: em muitos casos o
-- fornecedor real (quem fatura/exporta, ex: "Sailun Group") é diferente da
-- marca impressa no pneu (ex: "Maxam"). Antes disso o campo Fornecedor
-- acabava recebendo a marca por engano. Ver controle-modal.js (aba
-- Identificação, campo f_brand), controle-import-ia.js (extração por IA) e
-- controle-export.js (planilha "Exportar p/ Cliente" usa brand||fornecedor
-- como label do agrupamento).

alter table controle_processos add column if not exists brand text;
