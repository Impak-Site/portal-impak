-- 0023_add_armazenagem_vencimento.sql
--
-- Vencimento do 1o periodo de armazenagem gratis no porto. Pedido da
-- Emanuelly (03/09/2026): o sistema ja calcula e avisa o vencimento do
-- Demurrage (multa da armadora por atraso na devolucao do container) mas
-- nao tinha nada equivalente para a armazenagem cobrada pelo PORTO --
-- Navegantes da 5 dias gratis, Itapoa da 4 dias, contados a partir da
-- Presenca de Carga (chegada fisica no terminal).
--
-- Calculado automaticamente em salvarProcesso() (controle-core.js) a partir
-- de data_presenca + porto_destino + PORTO_ARMAZENAGEM_FREE_DIAS
-- (controle-campos.js), mas tambem editavel manualmente no campo
-- "Armazenagem Vence" (aba Logistica), igual ja funciona com o Demurrage.

alter table controle_processos add column if not exists armazenagem_vencimento date;
