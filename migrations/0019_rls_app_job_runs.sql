-- Migration 0019: habilita Row Level Security em app_job_runs
--
-- Essa tabela foi criada na migration 0013 sem RLS, com a justificativa de
-- que só o backend (via SUPABASE_KEY = service_role) acessa ela. Isso é
-- verdade para o server.js, mas RLS desabilitada expõe a tabela via API
-- REST do Supabase pra qualquer cliente que tenha a URL do projeto e a
-- chave anon/public (padrão do Supabase, existe sempre) — foi assim que o
-- scanner de segurança do Supabase pegou. Como a service_role key ignora
-- RLS de qualquer forma, habilitar RLS aqui não quebra nada do backend:
-- só fecha o acesso público que nunca deveria ter existido.
alter table app_job_runs enable row level security;

-- Nenhuma policy criada de propósito: sem policy = ninguém com a chave
-- anon/public consegue ler/gravar. O service_role do backend continua
-- acessando normalmente (RLS não se aplica a ele).
