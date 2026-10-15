-- Migration 0053: financeiro da empresa — plano de contas, centros de custo,
-- contas bancárias e transferências; classificação das faturas, 14/10/2026.
--
-- Nada é apagado: contas/centros/bancos são desativados (ativo=false);
-- transferências são estornadas (estornado jsonb).
CREATE TABLE IF NOT EXISTS fin_contas (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  codigo         text NOT NULL UNIQUE,
  nome           text NOT NULL,
  grupo          text NOT NULL,   -- linha do DRE (ver fin-core.js GRUPOS)
  conta_contabil text,            -- código no plano do contador (opcional)
  ativo          boolean NOT NULL DEFAULT true,
  ordem          int,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fin_centros_custo (
  id         text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  codigo     text,
  nome       text NOT NULL,
  ativo      boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fin_bancos (
  id               text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  nome             text NOT NULL,
  banco            text,
  agencia          text,
  conta            text,
  moeda            text NOT NULL DEFAULT 'BRL',
  saldo_inicial    numeric(14,2) NOT NULL DEFAULT 0,
  saldo_inicial_em date,
  conta_contabil   text,
  ativo            boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fin_transferencias (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  data          date NOT NULL,
  de_banco_id   text NOT NULL,
  para_banco_id text NOT NULL,
  valor         numeric(14,2) NOT NULL,
  valor_destino numeric(14,2),
  obs           text,
  estornado     jsonb,
  criado_por    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE faturas ADD COLUMN IF NOT EXISTS conta_id        text;
ALTER TABLE faturas ADD COLUMN IF NOT EXISTS centro_custo_id text;
ALTER TABLE faturas ADD COLUMN IF NOT EXISTS externo         jsonb;
CREATE INDEX IF NOT EXISTS idx_faturas_conta ON faturas (conta_id) WHERE conta_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_faturas_externo_chave ON faturas ((externo->>'chave')) WHERE externo->>'chave' IS NOT NULL AND status <> 'cancelada';
ALTER TABLE fin_contas ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_centros_custo ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_bancos ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_transferencias ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.fin_contas, public.fin_centros_custo, public.fin_bancos, public.fin_transferencias TO service_role;
-- Plano de contas inicial (gerencial, editável na tela). Não sobrescreve o que já existir.
INSERT INTO fin_contas (codigo, nome, grupo, ordem) VALUES
  ('3.1.01','Receita de vendas de mercadorias','receita_bruta',1),
  ('3.1.02','Reembolsos de clientes (câmbio / despesas)','receita_bruta',2),
  ('3.1.03','Outras receitas operacionais','receita_bruta',3),
  ('3.2.01','Juros e descontos obtidos','receita_financeira',4),
  ('3.2.02','Variação cambial ativa','receita_financeira',5),
  ('4.1.01','Impostos sobre vendas (ICMS, PIS, COFINS, IPI)','deducoes',6),
  ('4.2.01','Custo da mercadoria importada (FOB)','custo',7),
  ('4.2.02','Frete e seguro internacional','custo',8),
  ('4.2.03','Impostos de importação','custo',9),
  ('4.2.04','Despesas portuárias, armazenagem e despachante','custo',10),
  ('4.2.05','Frete nacional','custo',11),
  ('4.2.06','Comissões','custo',12),
  ('5.1.01','Salários e encargos','despesa_operacional',13),
  ('5.1.02','Pró-labore','despesa_operacional',14),
  ('5.1.03','Aluguel e condomínio','despesa_operacional',15),
  ('5.1.04','Energia, água, telefone e internet','despesa_operacional',16),
  ('5.1.05','Sistemas e software','despesa_operacional',17),
  ('5.1.06','Contabilidade e jurídico','despesa_operacional',18),
  ('5.1.07','Marketing e viagens','despesa_operacional',19),
  ('5.1.08','Material e despesas gerais','despesa_operacional',20),
  ('5.1.09','Impostos e taxas (não sobre vendas)','despesa_operacional',21),
  ('5.2.01','Tarifas bancárias','despesa_financeira',22),
  ('5.2.02','Juros e multas pagos','despesa_financeira',23),
  ('5.2.03','Variação cambial passiva','despesa_financeira',24),
  ('5.2.04','IOF','despesa_financeira',25),
  ('6.1.01','IRPJ e CSLL','impostos_lucro',26),
  ('9.1.01','Impostos retidos a recolher (repasse)','neutra',27),
  ('9.1.02','Empréstimos e financiamentos (principal)','neutra',28),
  ('9.1.03','Distribuição de lucros','neutra',29),
  ('9.1.04','Aplicações e resgates','neutra',30)
ON CONFLICT (codigo) DO NOTHING;
