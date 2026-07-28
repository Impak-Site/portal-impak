-- 0006_add_fechado_processo.sql
--
-- Trava de processo ("Fechar Processo"): depois de conferido, o processo
-- pode ser travado pra impedir que NF, custos reais, lucro etc. mudem por
-- engano. Ver server.js (POST /api/controle/v2/processo) e controle-modal.js
-- (renderModal / fecharProcesso / reabrirProcesso).
--
-- fechado: true quando o processo está travado (só leitura no front-end e
-- rejeitado no servidor, exceto a própria ação de destravar).
-- fechado_em / fechado_por: quando e quem travou -- sempre escritos pelo
-- servidor, nunca aceitos direto do cliente.

alter table controle_processos add column if not exists fechado boolean default false;
alter table controle_processos add column if not exists fechado_em timestamptz;
alter table controle_processos add column if not exists fechado_por text;
