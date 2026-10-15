-- Migration 0054: despesas/receitas recorrentes + classificação mais
-- detalhada (folha, encargos, benefícios, impostos…), 15/10/2026.
--
-- fin_recorrencias: cada linha gera as faturas sozinha (job diário no
-- servidor), com antecedência. As faturas geradas têm
-- origem = {tipo:'recorrencia', processo_id:<id da recorrência>, idx:'AAAA-MM'}
-- e o índice único da 0052 impede duplicar o mês. Nada é apagado:
-- pausar = ativo false; encerrar = data fim.
CREATE TABLE IF NOT EXISTS fin_recorrencias (
  id                text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  descricao         text NOT NULL,
  tipo              text NOT NULL DEFAULT 'pagar',
  empresa_nome      text NOT NULL,
  empresa_id        text,
  moeda             text NOT NULL DEFAULT 'BRL',
  valor             numeric NOT NULL,
  conta_id          text NOT NULL,
  centro_custo_id   text,
  frequencia        text NOT NULL DEFAULT 'mensal',
  inicio            date NOT NULL,
  fim               date,
  valor_variavel    boolean NOT NULL DEFAULT false,
  antecedencia_dias int NOT NULL DEFAULT 30,
  obs               text,
  ativo             boolean NOT NULL DEFAULT true,
  criado_por        text,
  alterado_por      text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE fin_recorrencias ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.fin_recorrencias TO service_role;

-- Classificações novas (não sobrescreve nada que já exista)
INSERT INTO fin_contas (codigo, nome, grupo, ordem) VALUES
  ('4.1.02','ICMS / ICMS-ST a recolher (apuração)','deducoes',31),
  ('4.1.03','PIS / COFINS a recolher (apuração)','deducoes',32),
  ('5.1.10','Encargos sociais (INSS, FGTS)','despesa_operacional',33),
  ('5.1.11','Benefícios (VT, VR, plano de saúde)','despesa_operacional',34),
  ('5.1.12','Férias, 13º e rescisões','despesa_operacional',35),
  ('5.1.13','Seguros','despesa_operacional',36),
  ('5.1.14','Manutenção e conservação','despesa_operacional',37),
  ('5.1.15','Veículos e combustível','despesa_operacional',38)
ON CONFLICT (codigo) DO NOTHING;
-- encargos agora têm conta própria: só renomeia se ainda estiver com o nome original
UPDATE fin_contas SET nome = 'Salários (folha de pagamento)', updated_at = now()
 WHERE codigo = '5.1.01' AND nome = 'Salários e encargos';
