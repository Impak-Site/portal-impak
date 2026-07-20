-- 0004_add_custos_reais_processo.sql
--
-- Guarda os custos REAIS (efetivamente pagos) de cada rubrica de despesa
-- aduaneira do processo, pra comparar Estimado x Real no Fechamento
-- (ver controle-core.js: calcularFechamento / renderFechamentoInfo /
-- renderCustosReaisForm).
--
-- real_json: mesma estrutura de "txOp" do Calculador -> { fixas: {...R$},
-- usd: {...US$} } com as 21 rubricas (siscomex, marinha, armazenagem,
-- emissao_li, baixa_patio, capatazia, liberacao_bl, despachante, sda,
-- lavacao, administrativo, agente, handling, additional_costs,
-- import_logistics, trs, tsc, drop_off, isps, iof, desconsolidacao).
-- real_cambio: câmbio usado pra converter a parte em US$ desse json pra R$.
--
-- Status: aplicada manualmente no banco de PRODUÇÃO (impak-portal) e no
-- banco do LAB (impak-portal-lab) em 2026-07-19. Este arquivo documenta
-- a mudança pra manter as migrations rastreáveis.

alter table controle_processos add column if not exists real_json jsonb;
alter table controle_processos add column if not exists real_cambio numeric;
