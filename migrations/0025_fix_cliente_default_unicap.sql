-- 0025_fix_cliente_default_unicap.sql
--
-- Bug relatado pela Emanuelly (03/09/2026): sempre que um processo era
-- salvo sem informar o Cliente, o campo ficava "Unicap" em vez de vazio.
--
-- Causa raiz: a coluna controle_processos.cliente tinha um DEFAULT
-- 'UNICAP' configurado direto no banco (não em nenhum migration deste
-- repo — provavelmente setado manualmente em algum momento). O
-- salvamento parcial (patchFields) só envia ao servidor os campos que o
-- usuário de fato editou nesta sessão; se "cliente" nunca é tocado ao
-- criar um processo novo, a coluna simplesmente não entra no INSERT e o
-- Postgres aplica o DEFAULT — preenchendo "UNICAP" sem o usuário pedir.
--
-- Fix: remover o DEFAULT. Cliente vazio agora fica NULL de verdade.

alter table controle_processos alter column cliente drop default;
