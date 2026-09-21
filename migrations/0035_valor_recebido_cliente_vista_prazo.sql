-- 0035_valor_recebido_cliente_vista_prazo.sql
--
-- Pedido do Ayslan (21/09/2026): "quando a forma de pagamento for diferente
-- do parcelado, precisa ter o valor recebido do cliente e a data também" --
-- hoje só a forma "Parcelado" tem esse controle (por parcela). Adiciona os
-- mesmos 2 campos em nível de processo, usados pelas formas "100% à Vista"
-- e "100% a Prazo" (a "Parcelado" continua usando o controle por parcela,
-- que já existe em pi_parcelas_json).

alter table controle_processos add column if not exists pi_valor_recebido_cliente numeric;
alter table controle_processos add column if not exists pi_data_recebimento date;
