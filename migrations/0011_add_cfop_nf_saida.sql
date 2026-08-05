-- 0011_add_cfop_nf_saida.sql
--
-- CFOP da NF de Saida, usado pelo Dashboard Narcelio (visao do dono da
-- empresa) para identificar estoque parado no armazem: processo com NF de
-- Entrada lancada mas cuja NF de Saida tem CFOP 5905 (ou ainda nao foi
-- emitida) e container importado que ainda nao teve venda efetiva - o
-- CFOP 5905 e usado internamente pra "remessa/retorno" e nao representa
-- venda real. Ver controle-modal.js (aba Financeiro, campo f_nf_saida_cfop)
-- e controle-dash-narcelio.js (calcularEstoqueParado).

alter table controle_processos add column if not exists nf_saida_cfop text;
