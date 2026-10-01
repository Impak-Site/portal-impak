-- Migration 0040: Cadastros pra todo o sistema — fase 1b (01/10/2026)
--
-- Pedido do Ayslan (01/10/2026): "a parte dos cadastros que serve pra todo
-- sistema, inclusive funcionario, portos, etc... como voce melhoraria?".
-- O relatório "De-para Cadastros 01-10-2026.xlsx" mostrou o tamanho do
-- problema: o mesmo armador/agente/despachante/armazém escrito de 3 a 8
-- jeitos diferentes nos processos, e listas (portos, dias grátis, bancos)
-- fixas no código — só dava pra mudar com deploy.
--
-- O que muda aqui (tudo idempotente, pode rodar mais de uma vez):
--
-- 1) contatos_clientes ganha PAPÉIS (text[]) e SINÔNIMOS (text[]).
--    Uma empresa só passa a poder ter vários papéis (ex.: RF LOGISTICA é
--    transportadora E armazém; PORTONAVE é porto/armazém E armazém
--    alfandegado) sem precisar de 2 cadastros. A coluna "tipo" antiga
--    continua existindo como papel principal (compatibilidade com tudo
--    que já lê/filtra por ela) — o servidor mantém as duas em sincronia.
--    Sinônimos = outras grafias que o time usa pro mesmo cadastro
--    (ex.: "PILL", "PIL SHIPPING", "PACIFIC INTERNATIONAL LINES" → PIL);
--    o servidor usa isso pra padronizar o valor ao salvar o processo.
--
-- 2) cadastros_listas: listas/parâmetros que hoje estão fixos no código
--    (PORTOS_DESTINO + dias grátis de armazenagem, PORTOS_ORIGEM + país,
--    BANCOS_CAMBIO). Passam a ser editáveis na tela /cadastros (aba
--    Listas), sem deploy. O código continua com a lista padrão embutida
--    como fallback (lib/listas-padrao.js) — se a tabela estiver vazia ou
--    fora do ar, o sistema segue funcionando igual a hoje.
--
-- 3) cadastros_log: quem alterou o quê nos cadastros (empresas, pessoas
--    e listas) — hoje só processos têm histórico (controle_log).
--
-- NÃO mexe em nenhum dado de processo. A unificação dos valores já
-- gravados (ex.: 127 processos com "PIL"/"PILL"/"PIL SHIPPING") é um
-- passo separado, feito via API com log, depois que o Ayslan aprovar o
-- de-para.

-- 1) Empresas: papéis múltiplos + sinônimos
ALTER TABLE contatos_clientes
  ADD COLUMN IF NOT EXISTS papeis    text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sinonimos text[] NOT NULL DEFAULT '{}';

-- Backfill: todo cadastro existente passa a ter o tipo atual como único papel.
UPDATE contatos_clientes
   SET papeis = ARRAY[tipo]
 WHERE (papeis IS NULL OR papeis = '{}')
   AND tipo IS NOT NULL AND tipo <> '';

CREATE INDEX IF NOT EXISTS idx_contatos_clientes_papeis    ON contatos_clientes USING gin (papeis);
CREATE INDEX IF NOT EXISTS idx_contatos_clientes_sinonimos ON contatos_clientes USING gin (sinonimos);

-- 2) Listas/parâmetros do sistema
CREATE TABLE IF NOT EXISTS cadastros_listas (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  categoria      text NOT NULL,                       -- 'porto_destino' | 'porto_origem' | 'banco_cambio'
  codigo         text NOT NULL,                       -- ITJ / SHANGHAI / ITAU — o valor que é gravado no processo
  nome           text NOT NULL,                       -- Itajaí / Shanghai / Itaú — o que aparece na tela
  dados          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- porto_destino: {"dias_gratis":5}; porto_origem: {"pais":"China"}; banco: {"agencia","conta","pix","codigo_banco","cnpj"}
  sinonimos      text[] NOT NULL DEFAULT '{}',        -- outras grafias (ITAJAI, PORTO DE ITAJAÍ...) — usadas pra normalizar
  ativo          boolean NOT NULL DEFAULT true,
  ordem          int NOT NULL DEFAULT 0,
  atualizado_por text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (categoria, codigo)
);
CREATE INDEX IF NOT EXISTS idx_cadastros_listas_categoria ON cadastros_listas (categoria, ativo, ordem);
ALTER TABLE cadastros_listas ENABLE ROW LEVEL SECURITY;

-- Semente: as mesmas listas que estavam fixas no código (controle-campos.js),
-- pra tela já nascer preenchida. ON CONFLICT DO NOTHING: se alguém já editou
-- uma linha, a migration não sobrescreve.
INSERT INTO cadastros_listas (categoria, codigo, nome, dados, sinonimos, ordem) VALUES
  ('porto_destino', 'ITJ',   'Itajaí',     '{"dias_gratis":5}', ARRAY['ITAJAI','ITAJAÍ','PORTO DE ITAJAI'], 1),
  ('porto_destino', 'IOA',   'Itapoá',     '{"dias_gratis":4}', ARRAY['ITAPOA','ITAPOÁ','PORTO ITAPOA'], 2),
  ('porto_destino', 'NVT',   'Navegantes', '{"dias_gratis":5}', ARRAY['NAVEGANTES','PORTONAVE'], 3),
  ('porto_destino', 'BRIBB', 'Imbituba',   '{"dias_gratis":5}', ARRAY['IMBITUBA','PORTO DE IMBITUBA'], 4)
ON CONFLICT (categoria, codigo) DO NOTHING;

INSERT INTO cadastros_listas (categoria, codigo, nome, dados, ordem) VALUES
  ('porto_origem', 'SHANGHAI',      'Shanghai',      '{"pais":"China"}', 1),
  ('porto_origem', 'NINGBO',        'Ningbo',        '{"pais":"China"}', 2),
  ('porto_origem', 'QINGDAO',       'Qingdao',       '{"pais":"China"}', 3),
  ('porto_origem', 'TIANJIN',       'Tianjin',       '{"pais":"China"}', 4),
  ('porto_origem', 'XIAMEN',        'Xiamen',        '{"pais":"China"}', 5),
  ('porto_origem', 'SHENZHEN',      'Shenzhen',      '{"pais":"China"}', 6),
  ('porto_origem', 'GUANGZHOU',     'Guangzhou',     '{"pais":"China"}', 7),
  ('porto_origem', 'NANSHA',        'Nansha',        '{"pais":"China"}', 8),
  ('porto_origem', 'YANTIAN',       'Yantian',       '{"pais":"China"}', 9),
  ('porto_origem', 'DALIAN',        'Dalian',        '{"pais":"China"}', 10),
  ('porto_origem', 'LIANYUNGANG',   'Lianyungang',   '{"pais":"China"}', 11),
  ('porto_origem', 'ZHANGJIAGANG',  'Zhangjiagang',  '{"pais":"China"}', 12),
  ('porto_origem', 'HO CHI MINH',   'Ho Chi Minh',   '{"pais":"Vietnã"}', 20),
  ('porto_origem', 'HAI PHONG',     'Hai Phong',     '{"pais":"Vietnã"}', 21),
  ('porto_origem', 'VUNG TAU',      'Vung Tau',      '{"pais":"Vietnã"}', 22),
  ('porto_origem', 'SIHANOUKVILLE', 'Sihanoukville', '{"pais":"Camboja"}', 30),
  ('porto_origem', 'PHNOM PENH',    'Phnom Penh',    '{"pais":"Camboja"}', 31),
  ('porto_origem', 'LAEM CHABANG',  'Laem Chabang',  '{"pais":"Tailândia"}', 40),
  ('porto_origem', 'BANGKOK',       'Bangkok',       '{"pais":"Tailândia"}', 41),
  ('porto_origem', 'JAKARTA',       'Jakarta',       '{"pais":"Indonésia"}', 50),
  ('porto_origem', 'SURABAYA',      'Surabaya',      '{"pais":"Indonésia"}', 51),
  ('porto_origem', 'SEMARANG',      'Semarang',      '{"pais":"Indonésia"}', 52),
  ('porto_origem', 'CHENNAI',       'Chennai',       '{"pais":"Índia"}', 60),
  ('porto_origem', 'NHAVA SHEVA',   'Nhava Sheva',   '{"pais":"Índia"}', 61),
  ('porto_origem', 'MUNDRA',        'Mundra',        '{"pais":"Índia"}', 62),
  ('porto_origem', 'BUSAN',         'Busan',         '{"pais":"Coreia do Sul"}', 70),
  ('porto_origem', 'PORT KLANG',    'Port Klang',    '{"pais":"Malásia"}', 80)
ON CONFLICT (categoria, codigo) DO NOTHING;

-- Sinônimos de origem = as grafias que de fato aparecem nos processos hoje
-- (relatório de-para 01/10: 8 grafias de Ho Chi Minh, 4 de Qingdao, 3 de
-- Vung Tau, 3 de Semarang). A comparação ignora maiúsculas/acentos, então
-- basta uma grafia por variação.
UPDATE cadastros_listas SET sinonimos = ARRAY['HO CHI MINH PORT, VIETNAM','HO CHI MINH CITY PORT, VIETNAM','HOCHIMINH, VIETNAM','HO CHI MINH, VIETNAM','HO CHI MINH - VIETNAM','HO CHI MINH CITY','HOCHIMINH','HCMC']
 WHERE categoria = 'porto_origem' AND codigo = 'HO CHI MINH' AND sinonimos = '{}';
UPDATE cadastros_listas SET sinonimos = ARRAY['QINGDAO, CHINA','QINGDAO CHINA']
 WHERE categoria = 'porto_origem' AND codigo = 'QINGDAO' AND sinonimos = '{}';
UPDATE cadastros_listas SET sinonimos = ARRAY['VUNG TAU PORT, VIETNAM','VUNG TAU, VIETNAM','VUNGTAU']
 WHERE categoria = 'porto_origem' AND codigo = 'VUNG TAU' AND sinonimos = '{}';
UPDATE cadastros_listas SET sinonimos = ARRAY['SEMARANG PORT, INDONESIA','SEMARANG, INDONESIA']
 WHERE categoria = 'porto_origem' AND codigo = 'SEMARANG' AND sinonimos = '{}';

-- Bancos: só o nome vai na semente. Agência/conta/PIX são preenchidos na
-- tela (ficam só no banco de dados, não no código — o repositório é público).
INSERT INTO cadastros_listas (categoria, codigo, nome, dados, ordem) VALUES
  ('banco_cambio', 'ITAU',      'Itaú',      '{"codigo_banco":"341"}', 1),
  ('banco_cambio', 'SANTANDER', 'Santander', '{"codigo_banco":"033"}', 2)
ON CONFLICT (categoria, codigo) DO NOTHING;

-- 3) Histórico de alterações dos cadastros
CREATE TABLE IF NOT EXISTS cadastros_log (
  id          bigserial PRIMARY KEY,
  tabela      text NOT NULL,       -- 'contatos_clientes' | 'cadastros_pessoas' | 'cadastros_listas'
  registro_id text NOT NULL,
  acao        text NOT NULL,       -- 'criar' | 'editar' | 'excluir'
  antes       jsonb,
  depois      jsonb,
  usuario     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cadastros_log_registro ON cadastros_log (tabela, registro_id, created_at DESC);
ALTER TABLE cadastros_log ENABLE ROW LEVEL SECURITY;

-- 4) Permissões pro backend. Neste projeto, tabela nova criada pelo SQL
-- Editor NÃO herda os grants pra service_role (mesmo caso de app_sessions e
-- analise_jobs, que precisaram de GRANT à parte) — sem isto o servidor
-- recebe "permission denied for table cadastros_listas" e cai no fallback.
GRANT ALL ON TABLE public.cadastros_listas TO service_role;
GRANT ALL ON TABLE public.cadastros_log    TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.cadastros_log_id_seq TO service_role;

-- Conferência:
-- select categoria, count(*) from cadastros_listas group by 1;          -- porto_destino 4, porto_origem 27, banco_cambio 2
-- select tipo, papeis from contatos_clientes where ativo limit 10;       -- papeis = {tipo}
