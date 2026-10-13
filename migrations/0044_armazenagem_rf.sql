-- Migration 0044: Armazenagem pós-nacionalização no armazém geral (RF) — 13/10/2026
--
-- Pedido do Ayslan: container nacionalizado vai pro armazém geral (RF) pra
-- venda fracionada; a RF cobra por pneu por dia, por tipo, depois de uma
-- carência. Hoje isso é recalculado à mão na planilha (MIX - COMPLETO, CJ2)
-- a cada cotação. Agora o Controle calcula por venda (aba Vendas) e simula
-- vendas futuras. Tudo idempotente.
--
-- 1) controle_processos.entrada_armazem: data em que a carga entrou no
--    armazém (RF). É daí que conta a carência. Vazio = usa data_chegada
--    (igual a planilha, DADOS!E4).
alter table controle_processos add column if not exists entrada_armazem date;

-- 2) cadastros_listas, categoria armazenagem_rf: tarifa R$/pneu/dia e
--    carência por tipo (valores da planilha Modelo Rev97). Editável em
--    /cadastros → Listas. Se não rodar, o sistema usa o padrão embutido
--    (listas-padrao.js) — idêntico a esta semente.
insert into cadastros_listas (categoria, codigo, nome, dados, ordem) values
  ('armazenagem_rf', 'PCR',    'PCR (passeio)',         '{"tarifa_dia":0.045,"carencia_dias":29}', 1),
  ('armazenagem_rf', 'SUV',    'SUV / LT',              '{"tarifa_dia":0.18,"carencia_dias":29}',  2),
  ('armazenagem_rf', 'TBR',    'TBR (caminhão/ônibus)', '{"tarifa_dia":0.40,"carencia_dias":29}',  3),
  ('armazenagem_rf', 'RODAS',  'Rodas',                 '{"tarifa_dia":0.40,"carencia_dias":29}',  4),
  ('armazenagem_rf', 'METAIS', 'Metais',                '{"tarifa_dia":1.65,"carencia_dias":29}',  5)
on conflict (categoria, codigo) do nothing;
