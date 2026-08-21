-- 0014_add_cancelado_processo.sql
--
-- Cancelamento de processo ("Cancelar Processo"): pedido da Emanuelly
-- (21/08/2026) -- alguns processos precisam sair da operação ativa sem
-- serem excluídos, pra manter o histórico. Diferente de "Excluir" (que
-- apaga de vez), cancelar só marca o processo como cancelado -- ele
-- continua aparecendo na lista/histórico, só sai das contagens
-- operacionais (Dashboard TV, etc).
--
-- Mesmo padrão de fechado/fechado_em/fechado_por (ver 0006): restrito a
-- gerente, igual à exclusão. Ver server.js (POST /api/controle/v2/processo)
-- e controle-core.js/controle-modal.js (cancelarProcesso/reverterCancelamento).
--
-- cancelado: true quando o processo está cancelado.
-- cancelado_em / cancelado_por: quando e quem cancelou -- sempre escritos
-- pelo servidor, nunca aceitos direto do cliente.
-- cancelado_motivo: motivo informado por quem cancelou (opcional, texto livre).

alter table controle_processos add column if not exists cancelado boolean default false;
alter table controle_processos add column if not exists cancelado_em timestamptz;
alter table controle_processos add column if not exists cancelado_por text;
alter table controle_processos add column if not exists cancelado_motivo text;
