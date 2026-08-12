-- Migration 0013: tabela de controle de execução de jobs agendados
-- (ex: e-mail de follow-up semanal) — evita disparo duplicado se o
-- servidor reiniciar/redeploy no mesmo dia em que o job já rodou.

create table if not exists app_job_runs (
  job_name    text primary key,
  last_run_at timestamptz not null default now()
);

-- Sem RLS de propósito: tabela puramente interna (nome do job + timestamp),
-- sem dado de cliente/processo, e só o backend (via SUPABASE_KEY) acessa —
-- evita o risco de a tabela ficar inacessível se essa chave não for a
-- service role (como aconteceria se RLS fosse ligado sem políticas).
