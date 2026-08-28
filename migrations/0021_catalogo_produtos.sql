-- Migration 0021: catálogo de produtos vinculado ao Conexos
--
-- Hoje o vínculo entre o produto de cada processo e o Código Conexos (código
-- interno do ERP usado pela empresa pra estoque/faturamento, ex: 1, 2, 3...)
-- e o Código UD00xx (código interno de uso do time, usado nas planilhas de
-- fechamento) só existe numa planilha manual ("aba Cód Prod."), com ~600
-- itens cadastrados (nem todos com os 3 campos preenchidos). Essa tabela
-- traz esse catálogo pro sistema, pra virar a fonte única de verdade e
-- alimentar o dropdown de produto do Calculador.
create table if not exists catalogo_produtos (
  id                bigint generated always as identity primary key,
  descricao          text not null,
  codigo_interno     text,
  codigo_conexos     integer,
  medida             text,
  ativo              boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists catalogo_produtos_codigo_conexos_uk
  on catalogo_produtos (codigo_conexos)
  where codigo_conexos is not null;

create unique index if not exists catalogo_produtos_codigo_interno_uk
  on catalogo_produtos (codigo_interno)
  where codigo_interno is not null;

create index if not exists catalogo_produtos_descricao_idx
  on catalogo_produtos using gin (to_tsvector('portuguese', descricao));

alter table catalogo_produtos enable row level security;

