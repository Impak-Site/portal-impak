-- Migration 0046: Agenda de atividades por etapa (#675) — 13/10/2026
--
-- As tarefas da agenda são calculadas na hora a partir dos processos (não
-- ficam gravadas). Esta tabela guarda só o que a pessoa marca à mão:
-- "Feito" (atividades manuais), "Não se aplica" e "Reabrir".
-- chave = CODIGO|processo_id|instancia (ex.: A21|abc123| ; A33|-|2026-09).
-- Nada é apagado: reabrir grava tipo = 'reaberta'. Idempotente.
CREATE TABLE IF NOT EXISTS agenda_conclusoes (
  chave       text PRIMARY KEY,
  codigo      text NOT NULL,
  processo_id text,
  tipo        text NOT NULL CHECK (tipo IN ('feita','nao_aplica','reaberta')),
  obs         text,
  usuario     text,
  em          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agenda_conclusoes_proc ON agenda_conclusoes (processo_id);
ALTER TABLE agenda_conclusoes ENABLE ROW LEVEL SECURITY;
