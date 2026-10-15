-- Migration 0051: baixas (pagamentos parciais/totais) e anexos das faturas, 14/10/2026.
--
-- pagamentos: [{id, data, valor, forma, identificador, obs, comprovante:{path,nome,media_type,tamanho},
--               por, em, estornado:{por,em,motivo}?}] — estorno marca, nunca apaga.
-- anexos:     [{id, tipo:'fatura'|'comprovante'|'outro', path, nome, media_type, tamanho, por, em}]
-- Arquivos ficam no bucket privado do GED (controle-arquivos/faturas/<id>/...).
-- valor_pago / status / pago_em continuam sendo a fonte das telas, recalculados
-- a partir de pagamentos a cada baixa ou estorno.
ALTER TABLE faturas ADD COLUMN IF NOT EXISTS pagamentos jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE faturas ADD COLUMN IF NOT EXISTS anexos     jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_faturas_pagamentos ON faturas USING gin (pagamentos);
