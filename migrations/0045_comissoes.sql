-- Migration 0045: Comissões de vendedores/representantes (#517) — 13/10/2026
--
-- Uso INTERNO (o cliente não sabe dessas comissões). Guarda, por processo,
-- quais comissionados valem pra ele e o registro de pagamento de cada
-- comissão. O cadastro dos comissionados (nome, %, base, clientes) fica em
-- cadastros_listas, categoria 'comissionado' — os valores reais são
-- inseridos direto no banco/aba Listas, NUNCA neste arquivo (repo público).
-- Idempotente.
alter table controle_processos add column if not exists comissoes_json jsonb;
