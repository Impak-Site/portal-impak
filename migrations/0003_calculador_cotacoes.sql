-- 0003_calculador_cotacoes.sql
--
-- Cria a tabela calculador_cotacoes, usada pelo recurso "Salvar Cotação" /
-- "Minhas Cotações" do Calculador (calculador.html) e pelo fluxo de
-- aprovação de cotação -> criação de processo (POST
-- /api/calculador/cotacoes/:id/aprovar em server.js).
--
-- NOTA HISTÓRICA (18-19/07/2026): esta tabela já foi criada manualmente
-- via SQL Editor do Supabase de produção durante a promoção lab -> main,
-- porque a funcionalidade já estava visível/em uso na tela sem ter banco
-- por trás (bug). Este arquivo documenta retroativamente o que já foi
-- rodado, pra manter o histórico de migrations consistente com o que
-- existe de fato no banco. Se você está rodando isso do zero (banco novo,
-- ambiente de teste, etc.), o "create table if not exists" garante que
-- é seguro rodar mesmo que a tabela já exista.
--
-- Chave de serviço (service_role) é usada pelo servidor pra tudo — não
-- há client anônimo exposto nesse app, então RLS foi deixado desligado
-- aqui, consistente com as demais tabelas do banco.

create table if not exists calculador_cotacoes (
  id uuid primary key,
  cliente text,
  numero text,
  dados jsonb,
  resumo jsonb,
  ativo boolean not null default true,
  updated_at timestamptz,
  updated_by text
);

create index if not exists calculador_cotacoes_ativo_idx
  on calculador_cotacoes (ativo, updated_at desc);
