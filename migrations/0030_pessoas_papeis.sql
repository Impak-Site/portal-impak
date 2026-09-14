-- 0030_pessoas_papeis.sql
--
-- Pedido Ayslan (14/09/2026): "eu nao quero só o contato principal.
-- Preciso ter se a pessoa é diretor, contato comercial, contato
-- operacional, quem deve receber cada informacao" — cadastros_pessoas
-- só tinha o booleano "principal" (recebe follow-up/e-mails). Agora cada
-- pessoa pode acumular vários papéis (ex: Diretor + Comercial), usados
-- pra classificar quem é quem numa empresa e, no futuro, rotear qual
-- tipo de informação vai pra qual contato.
--
--   papeis -- array de texto com os papéis marcados: DIRETOR, COMERCIAL,
--             OPERACIONAL, FINANCEIRO (lista fechada mantida no app,
--             ver controle-dash-cadastros.js)
--
-- Campo "principal" (booleano) continua existindo e continua sendo o
-- que alimenta contatosPrincipaisDaEmpresa() (follow-up semanal) — não
-- foi removido nem substituído, é aditivo.

alter table cadastros_pessoas add column if not exists papeis text[] not null default '{}'::text[];
