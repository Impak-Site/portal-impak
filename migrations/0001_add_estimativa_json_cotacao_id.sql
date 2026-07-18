-- 0001_add_estimativa_json_cotacao_id.sql
--
-- Guarda, dentro do próprio processo, a estimativa da cotação aprovada no
-- Calculador (estimativa_json) e o id da cotação de origem (cotacao_id) —
-- usadas pela feature "Aprovar Cotação → Criar Processo" (ver server.js,
-- rota POST /api/calculador/cotacoes/:id/aprovar, e a seção "Fechamento"
-- em controle_v2.html que compara estimado x real).
--
-- Status: já aplicada manualmente no banco do LAB antes desta pasta de
-- migrations existir. Este arquivo serve pra (a) documentar a mudança e
-- (b) poder aplicar a mesma coisa em qualquer outro banco (main, por
-- exemplo, quando a feature "Aprovar Cotação" for promovida pra produção)
-- de forma rastreável, em vez de digitar de novo no SQL Editor.

alter table controle_processos add column if not exists estimativa_json jsonb;
alter table controle_processos add column if not exists cotacao_id text;
