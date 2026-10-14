-- Migration 0048: validação antes de Finalizado (14/10/2026, pedido Emanuelly)
--
-- O processo só vira FINALIZADO depois que a pessoa configurada em
-- Cadastros → Listas → "Aprovação por etapa" clica em "Validar e finalizar".
-- Guarda quem/quando validou. Vale só pra processos cuja etapa final
-- (devolução do vazio / carregamento LCL) é a partir de 15/10/2026
-- (VALIDACAO_FINALIZACAO_DESDE em controle-core.js) — o histórico não muda.
ALTER TABLE controle_processos
  ADD COLUMN IF NOT EXISTS finalizacao_validada_em  timestamptz,
  ADD COLUMN IF NOT EXISTS finalizacao_validada_por text;
