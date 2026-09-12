-- Migration 0029: Cadastro unificado de Pessoas + endereço/documento em Empresas
--
-- Pedido do Ayslan (12/09/2026): tela de Cadastros pra todo o sistema —
-- clientes com contatos individuais (aniversário, telefone, e-mail por
-- pessoa), funcionários internos com ficha completa, e uma estrutura
-- genérica pra qualquer tipo futuro (fornecedor, agente, etc.).
--
-- Os dados também vão alimentar follow-up e e-mails a clientes/fornecedores,
-- por isso contatos_clientes ganha endereço completo (hoje só tinha
-- cidade/UF, sem logradouro/CEP — não dá pra usar em correspondência real).
--
-- Regra de documento (pedido explícito do Ayslan): empresa brasileira
-- exige CNPJ; pessoa física exige CPF; empresa/pessoa do exterior não tem
-- regra de documento por enquanto. A validação em si fica no server.js
-- (validarDocumento) — aqui só criamos os campos.

-- 1) Empresas (contatos_clientes): endereço completo + tipo_pessoa + documento genérico
ALTER TABLE contatos_clientes
  ADD COLUMN IF NOT EXISTS tipo_pessoa TEXT DEFAULT 'JURIDICA',   -- 'JURIDICA' | 'FISICA'
  ADD COLUMN IF NOT EXISTS pais TEXT DEFAULT 'Brasil',
  ADD COLUMN IF NOT EXISTS documento TEXT,                        -- CNPJ, CPF ou doc. estrangeiro livre
  ADD COLUMN IF NOT EXISTS logradouro TEXT,
  ADD COLUMN IF NOT EXISTS numero TEXT,
  ADD COLUMN IF NOT EXISTS complemento TEXT,
  ADD COLUMN IF NOT EXISTS bairro TEXT,
  ADD COLUMN IF NOT EXISTS cep TEXT;

-- Migra o que já existe em cnpj pra documento (não apaga a coluna cnpj
-- antiga, pra não quebrar nada que ainda leia direto dela — vira só um
-- espelho/legado).
UPDATE contatos_clientes SET documento = cnpj WHERE documento IS NULL AND cnpj IS NOT NULL AND cnpj <> '';

CREATE INDEX IF NOT EXISTS idx_contatos_clientes_documento ON contatos_clientes(documento);

-- 2) Pessoas (novo): contato individual, ligado a uma empresa OU a um
-- usuário de login (funcionário interno) OU nenhum dos dois (funcionário
-- sem acesso ao sistema).
CREATE TABLE IF NOT EXISTS cadastros_pessoas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  cargo TEXT,
  cpf TEXT,
  telefone TEXT,
  whatsapp TEXT,
  email TEXT,
  aniversario DATE,
  tipo TEXT DEFAULT 'CONTATO',        -- 'CONTATO' (pessoa de empresa) | 'FUNCIONARIO' | 'OUTRO'
  empresa_id TEXT REFERENCES contatos_clientes(id) ON DELETE CASCADE,
  usuario_vinculado TEXT REFERENCES usuarios(usuario) ON DELETE SET NULL,
  principal BOOLEAN DEFAULT false,    -- destinatário preferencial de follow-up/e-mails da empresa
  obs TEXT,
  ativo BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cadastros_pessoas_empresa ON cadastros_pessoas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_cadastros_pessoas_usuario ON cadastros_pessoas(usuario_vinculado);
CREATE INDEX IF NOT EXISTS idx_cadastros_pessoas_tipo ON cadastros_pessoas(tipo);
