-- 0024_add_demurrage_tab_fields.sql
--
-- Divisao do Demurrage em aba propria no modal do processo (pedido
-- Emanuelly 03/09/2026), com novos campos:
--
--   ric_status              -- "Isento" ou "Termo" (so informativo, nao
--                              entra em nenhum calculo)
--   depot                   -- texto livre, qual depot
--   data_envio_termo        -- data de envio do termo (manual)
--   data_pagamento_lavagem  -- data de pagamento da lavacao do container
--                              antes da devolucao (manual)
--   data_pagamento_demurrage -- data de pagamento da demurrage (manual);
--                              substitui o antigo dropdown Sim/Nao
--                              (demurrage_pago), que agora e derivado
--                              automaticamente: demurrage_pago = true
--                              quando esta data estiver preenchida.

alter table controle_processos add column if not exists ric_status text;
alter table controle_processos add column if not exists depot text;
alter table controle_processos add column if not exists data_envio_termo date;
alter table controle_processos add column if not exists data_pagamento_lavagem date;
alter table controle_processos add column if not exists data_pagamento_demurrage date;
