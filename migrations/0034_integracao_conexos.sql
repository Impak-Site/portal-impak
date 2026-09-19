-- 0034_integracao_conexos.sql
--
-- Pedido Ayslan (19/09/2026): preparar o sistema pra integrar com o Conexos
-- Cloud (ERP oficial de comex da IMPAK) SEM ainda falar com a API deles --
-- a documentacao tecnica do Conexos so e liberada pra cliente, entao a
-- parte que conversa com eles fica pra depois da reuniao. O que da pra
-- deixar pronto agora:
--
-- 1) conexos_id (text): identificador do MESMO processo la no Conexos.
--    Sem isso nao tem como casar um processo nosso (UD26-117) com o deles
--    no dia da integracao. Preenchido a mao por enquanto (campo na aba
--    Identificacao); a sincronizacao vai usar pra localizar o processo.
-- 2) conexos_ultima_sync (timestamptz): quando foi a ultima sincronizacao
--    bem-sucedida com o Conexos pra este processo (null = nunca).
-- 3) integracao_log: trilha de tudo que qualquer integracao/import fez em
--    cada processo -- Conexos, planilha do despachante, planilha interna.
--    Hoje esses imports nao registram o que aplicaram; quando algo vem
--    errado de fora, ninguem sabe de onde veio. Uma linha por execucao,
--    com o que chegou (payload) e o que foi de fato aplicado (campos).

alter table controle_processos add column if not exists conexos_id text;
alter table controle_processos add column if not exists conexos_ultima_sync timestamptz;
create index if not exists idx_controle_processos_conexos_id on controle_processos (conexos_id) where conexos_id is not null;

create table if not exists integracao_log (
  id bigserial primary key,
  origem text not null,               -- 'conexos' | 'despachante' | 'planilha_interna' | ...
  processo_id text,                   -- controle_processos.id (null se nao casou com nenhum)
  referencia text,                    -- referencia do processo, pra leitura humana
  direcao text not null default 'entrada',  -- 'entrada' (de fora pra ca) | 'saida' (daqui pra fora)
  status text not null,               -- 'ok' | 'erro' | 'ignorado' | 'pendente'
  campos_aplicados jsonb,             -- { campo: valor } do que foi gravado
  payload jsonb,                      -- o que chegou (ja sem dados sensiveis)
  erro text,
  usuario text,                       -- quem disparou (null = job automatico)
  created_at timestamptz not null default now()
);
create index if not exists idx_integracao_log_processo on integracao_log (processo_id, created_at desc);
create index if not exists idx_integracao_log_origem on integracao_log (origem, created_at desc);

alter table integracao_log enable row level security;
-- O app acessa com a service key (bypassa RLS); nao ha politica pra anon.
