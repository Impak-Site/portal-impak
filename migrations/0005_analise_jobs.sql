-- 0005_analise_jobs.sql
--
-- Suporte ao padrão de análise assíncrona do Conferência (ver
-- /api/analisar e /api/analisar/job/:id em server.js, runAnalysis() em
-- processos.html).
--
-- Antes, /api/analisar era uma chamada síncrona que ficava até ~2-3min
-- esperando a resposta da IA, presa numa única requisição HTTP. Qualquer
-- proxy no meio do caminho (Railway) ou o próprio navegador podia
-- considerar a conexão parada e derrubá-la, resultando em "Erro 502"
-- mesmo com a análise ainda rodando no servidor.
--
-- Agora /api/analisar só cria uma linha aqui e responde na hora; o
-- processamento roda em background e o cliente acompanha via polling.
--
-- Já aplicada no lab (0004_analise_jobs.sql) e em produção via SQL Editor;
-- este arquivo documenta e replica a mesma estrutura no main.

create table if not exists analise_jobs (
  id uuid primary key,
  status text not null default 'processando', -- processando | concluido | erro
  resultado jsonb,
  erro text,
  usuario text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists analise_jobs_status_idx on analise_jobs (status);
create index if not exists analise_jobs_created_at_idx on analise_jobs (created_at);
