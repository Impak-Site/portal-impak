-- 0041_pi_duimp_pagamento_unico.sql (01/10/2026)
--
-- Pedido da Emanuelly (01/10/2026, IMPAK-OID2605A): "quando que o sistema
-- abre em Financeiro o campo para pôr o nº da chave de acesso da DUIMP?".
-- Os campos Venc. DI/DUIMP, Nº DUIMP e Protocolo/Chave de Acesso só
-- existiam DENTRO de cada parcela (pi_parcelas_json), ou seja, só apareciam
-- com Forma de Pagamento = Parcelado. Um câmbio "pagamento posterior" de um
-- processo 100% a Prazo (caso dela: Santander 21/09, US$ 32.300,44 pagando
-- OID2605A + OID2605C) também precisa da chave, e não tinha onde gravar.
--
-- Mesmo padrão do pi_cambio_codigo_bacen (0036) e do pi_valor_recebido_cliente
-- (0035): equivalente em nível de processo pra À Vista / 100% a Prazo /
-- Entrada+Saldo. Em Parcelado continua valendo o que está em cada parcela.
alter table controle_processos add column if not exists pi_venc_di date;
alter table controle_processos add column if not exists pi_duimp_numero text;
alter table controle_processos add column if not exists pi_duimp_protocolo text;
