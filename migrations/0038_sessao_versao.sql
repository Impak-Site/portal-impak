-- Migration 0038: versão da sessão persistida por usuário
-- Relatório de segurança (23/09/2026, item 7): o "logout forçado" e a
-- retirada de permissões guardavam a versão só na memória do servidor e
-- deixavam de valer no deploy seguinte. Com esta coluna a versão sobrevive
-- a deploys/restarts. Idempotente.
alter table public.usuarios add column if not exists sessao_versao integer not null default 1;
