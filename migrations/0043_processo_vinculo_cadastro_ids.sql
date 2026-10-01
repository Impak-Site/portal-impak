-- Migration 0043: processo vinculado ao cadastro por ID (cadastros fase 2a)
--
-- Revisão da tela de Cadastros (Ayslan, 01/10/2026): o processo guardava só
-- o NOME da empresa em cada campo (cliente, fornecedor, armador...). Tudo
-- que sai do cadastro (follow-up por pessoa, Conexos, relatórios) dependia
-- de o texto bater letra por letra — e renomear um cadastro não propagava.
--
-- Agora cada campo de empresa ganha uma coluna <campo>_id com o id de
-- contatos_clientes. O texto continua sendo gravado (espelho legível e
-- compatibilidade com telas/relatórios antigos); o id é o vínculo de
-- verdade. Preenchido pelo servidor em todo save (lib/cadastros-normalizar)
-- e, pros processos existentes, pela revinculação em massa
-- (POST /api/admin/cadastros/revincular). Sem FK de propósito: cadastro
-- inativado continua referenciado (histórico), e o app nunca grava id que
-- não veio do próprio índice de cadastros.
--
-- Rodar no SQL Editor do Supabase (produção). Colunas novas em tabela que
-- já tem GRANT pro service_role — não precisa de GRANT extra.

ALTER TABLE controle_processos
  ADD COLUMN IF NOT EXISTS cliente_id        TEXT,
  ADD COLUMN IF NOT EXISTS fornecedor_id     TEXT,
  ADD COLUMN IF NOT EXISTS armador_id        TEXT,
  ADD COLUMN IF NOT EXISTS agente_id         TEXT,
  ADD COLUMN IF NOT EXISTS transportadora_id TEXT,
  ADD COLUMN IF NOT EXISTS despachante_id    TEXT,
  ADD COLUMN IF NOT EXISTS armazem_id        TEXT,
  ADD COLUMN IF NOT EXISTS depot_id          TEXT;

CREATE INDEX IF NOT EXISTS idx_controle_processos_cliente_id    ON controle_processos (cliente_id)    WHERE cliente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_controle_processos_fornecedor_id ON controle_processos (fornecedor_id) WHERE fornecedor_id IS NOT NULL;

-- FORNECEDOR e EXPORTADOR eram dois tipos pra mesma coisa (quem vende/
-- embarca pra IMPAK): o campo do processo se chama "Fornecedor (Exportador)"
-- e não existia nenhum cadastro FORNECEDOR, só EXPORTADOR (52). Unificados
-- em FORNECEDOR; o servidor converte EXPORTADOR na entrada daqui pra frente.
UPDATE contatos_clientes SET tipo = 'FORNECEDOR' WHERE tipo = 'EXPORTADOR';
UPDATE contatos_clientes
   SET papeis = (SELECT array_agg(DISTINCT x) FROM unnest(array_replace(papeis, 'EXPORTADOR', 'FORNECEDOR')) x)
 WHERE papeis IS NOT NULL AND 'EXPORTADOR' = ANY(papeis);
