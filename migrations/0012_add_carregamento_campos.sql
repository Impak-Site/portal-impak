-- 0012_add_carregamento_campos.sql
--
-- Novos campos na area de Carregamento do processo: horario em que a carga
-- foi retirada no porto (controle de retirada) e motivo do cancelamento,
-- preenchido quando o agendamento de retirada e cancelado. Ver
-- controle-modal.js (bloco Carregamento), controle-campos.js
-- (coletarESalvar) e controle-dash-carregamento.js (Dashboard de
-- Carregamentos + alertas automaticos em server.js).

alter table controle_processos add column if not exists horario_retirada text;
alter table controle_processos add column if not exists agendamento_cancelado boolean default false;
alter table controle_processos add column if not exists motivo_cancelamento text;
