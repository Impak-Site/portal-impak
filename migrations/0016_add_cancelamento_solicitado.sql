alter table controle_processos add column if not exists cancelamento_solicitado boolean default false;
alter table controle_processos add column if not exists cancelamento_solicitado_em timestamptz;
alter table controle_processos add column if not exists cancelamento_solicitado_por text;
