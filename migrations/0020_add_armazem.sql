-- 0020_add_armazem.sql
--
-- Novo campo na aba Logistica: armazem onde a carga fica guardada apos
-- desembaraco/chegada. Pedido da Emanuelly -- hoje ha cargas LCL (nao um
-- container fechado, e sim uma parte/consolidado) que ficam armazenadas
-- em locais diferentes do padrao, e nao havia onde registrar isso no
-- processo. Ver controle-modal.js (aba Logistica, bloco Chegada &
-- Demurrage) e controle-campos.js (coletarESalvar).

alter table controle_processos add column if not exists armazem text;
