-- Migration 0037: liga Row Level Security em TODAS as tabelas do schema public
-- e tira o acesso das roles públicas do Supabase (anon/authenticated).
--
-- Relatório de segurança (23/09/2026, item 3): o Supabase expõe cada tabela
-- como API REST pública; quem controla o acesso é o RLS. Várias tabelas
-- foram criadas à mão sem RLS (usuarios, app_sessions, controle_*, ...).
--
-- NÃO quebra o portal: o server.js usa a chave service_role, que ignora RLS
-- e não depende dos grants de anon/authenticated. Mesmo padrão da 0019.
-- Idempotente: pode rodar mais de uma vez, e só mexe em tabelas que existem.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- Sem nenhuma policy: com RLS ligado e sem policy, anon/authenticated não
-- leem nem gravam nada. Além disso, remove os grants públicos.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- Conferência (deve voltar tudo com rls_ligado = true):
-- select tablename, rowsecurity as rls_ligado from pg_tables where schemaname='public' order by 1;
