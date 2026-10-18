-- Migration 0055: índices de desempenho (revisão 17/10/2026, item 8).
-- Só índices — nenhum dado muda. Medido antes (pg_stat_user_tables):
--   controle_log          ~53 mil linhas, lido inteiro (seq scan) a cada
--                         aba Histórico / conflito de edição;
--   controle_processos    "última atualização" (versão da lista, a cada
--                         ~30 s por aba aberta) e atualização incremental
--                         (?desde=) sem índice em updated_at;
--   controle_notificacoes checagem "já avisei?" a cada save de processo
--                         sem índice em processo_id.
CREATE INDEX IF NOT EXISTS idx_controle_log_processo ON controle_log (processo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_controle_processos_updated ON controle_processos (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_controle_notificacoes_processo ON controle_notificacoes (processo_id);
