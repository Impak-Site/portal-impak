-- 0036_pi_cambio_codigo_bacen.sql
--
-- Bug reportado pela Paula (22/09/2026, processo UD25-368/OID2605A): a IA lia
-- o Código BACEN certinho do comprovante de câmbio, mas ele nunca aparecia
-- no processo. Causa: o campo "Código BACEN" só existia na UI da forma de
-- pagamento "Parcelado" (por parcela) -- em "100% a Prazo"/"100% à Vista"/
-- "Entrada + Saldo" não havia NENHUM campo pra guardar esse dado, então ele
-- era descartado em silêncio ao confirmar o comprovante.
--
-- Esta coluna é o equivalente, a nível de processo, do "codigo_bacen" que já
-- existe em cada parcela (pi_parcelas_json) -- usada quando a Forma de
-- Pagamento é Único/Prazo/Entrada+Saldo.

alter table controle_processos add column if not exists pi_cambio_codigo_bacen text;
