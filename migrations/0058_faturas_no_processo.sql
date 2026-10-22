-- Migration 0058: faturas dentro do processo (aba Faturas), 21/10/2026.
--
-- conferencia: resultado guardado da conferência da fatura com o sistema
--   {em, por, nome, resumo:{ok,aviso,erro,info}, checks:[{nivel,tipo,msg,item}],
--    divergencias, valor, moeda, documento}
--   Gravada por POST /api/faturas/:id/conferencia; volta a null quando a
--   fatura é editada (valor, taxas, documento, empresa ou câmbio). Alimenta a
--   etapa "Conferida" / "com diferença" e o selo da lista de processos.
--
-- origem.parcela / origem.de: venda a prazo em vários boletos (30/60/90 →
--   parcela 1 de 3, 2 de 3, 3 de 3) vira uma fatura a receber por parcela.
--   O índice único da origem passa a considerar a parcela (antes só tipo +
--   processo + idx, o que barrava a 2ª parcela da mesma venda). Venda de
--   uma parcela só continua sem "parcela" — mesma chave de antes.
ALTER TABLE faturas ADD COLUMN IF NOT EXISTS conferencia jsonb;

DROP INDEX IF EXISTS idx_faturas_origem_unica;
CREATE UNIQUE INDEX IF NOT EXISTS idx_faturas_origem_unica
  ON faturas ((origem->>'tipo'), (origem->>'processo_id'), (origem->>'idx'), (coalesce(origem->>'parcela', '')))
  WHERE origem IS NOT NULL AND status <> 'cancelada';

-- faturas a receber do processo (GET /api/faturas?processo_id=) buscam também pela origem
CREATE INDEX IF NOT EXISTS idx_faturas_origem_processo
  ON faturas ((origem->>'processo_id'))
  WHERE origem IS NOT NULL;
