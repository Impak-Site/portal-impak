-- 0027_add_demurrage_solicitacao_isencao.sql
--
-- Pedido Emanuelly 08/09/2026: 2 novos campos de data na aba Demurrage
-- do modal do processo, no mesmo formato (input type=date) usado no
-- resto do sistema.
--
--   data_solicitacao_demurrage -- data em que a isencao/desconto de
--                                  demurrage foi solicitada
--   data_isencao_demurrage     -- data em que a isencao foi concedida

alter table controle_processos add column if not exists data_solicitacao_demurrage date;
alter table controle_processos add column if not exists data_isencao_demurrage date;
