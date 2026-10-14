-- Migration 0047: histórico da Agenda (14/10/2026, pedido Ayslan)
--
-- A agenda calcula as tarefas na hora; esta tabela guarda quando cada uma
-- foi vista aberta pela primeira vez e quando deixou de estar aberta, pra
-- dar histórico ("fechou N na semana, M com atraso") no resumo semanal
-- dos gerentes e na tela Toda a equipe. Preenchida pelo job diário
-- (agenda-servidor.js → atualizarHistorico). Nada é apagado.
-- chave = CODIGO|processo_id|instancia (mesma de agenda_conclusoes).
CREATE TABLE IF NOT EXISTS agenda_historico (
  chave         text PRIMARY KEY,
  codigo        text NOT NULL,
  processo_id   text,
  referencia    text,
  funcao        text,
  atividade     text,
  prazo         date,
  aberta_em     date NOT NULL,
  fechada_em    date,
  tipo          text,            -- auto | feita | nao_aplica (como fechou)
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agenda_historico_fechada ON agenda_historico (fechada_em);
CREATE INDEX IF NOT EXISTS idx_agenda_historico_funcao  ON agenda_historico (funcao);
ALTER TABLE agenda_historico ENABLE ROW LEVEL SECURITY;
-- Tabela criada pelo SQL Editor não herda o grant do service_role.
GRANT ALL ON TABLE public.agenda_historico TO service_role;
