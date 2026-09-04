-- 0026_add_aprovacao_hbl_li.sql
--
-- Dois novos campos na aba Logistica, entre "Booking & Embarque" e
-- "Carregamento" (secao "Aprovacoes Pre-Embarque"). Pedido da Emanuelly
-- (04/09/2026): controlar se o HBL ja foi aprovado e se a LI (Licenca de
-- Importacao) ja foi solicitada, com um alerta quando o processo ja
-- embarcou (Data de Embarque preenchida) e algum dos dois ainda nao foi
-- marcado como "Sim" (ver verificarAlertas() em controle-core.js).
--
-- Guardado como texto ('' | 'Sim' | 'Não') em vez de boolean pra manter o
-- mesmo padrao de outros campos de selecao do sistema (ex: ric_status).

alter table controle_processos add column if not exists aprovacao_hbl text;
alter table controle_processos add column if not exists solicitacao_li text;
