-- 0057_conexos_id_unico.sql
--
-- Pedido Emanuelly (20/10/2026): o "ID no Conexos" nunca pode se repetir
-- entre processos -- cada processo tem o seu numero no Conexos Cloud.
--
-- Trava final no banco (o painel e o servidor ja conferem antes, com
-- mensagem dizendo em qual processo o numero esta -- conexos-id.js). A
-- comparacao segue a mesma regra do conexos-id.js: ignora espacos, zeros a
-- esquerda ("0123" = "123") e maiusculas/minusculas. Processo sem ID (vazio)
-- fica de fora. Vale tambem para processo cancelado.
--
-- Antes de rodar: nao pode haver repetido (a criacao do indice falha). Para
-- conferir:
--   select k, count(*), string_agg(referencia, ', ') from (
--     select referencia, case when regexp_replace(conexos_id, '\s', '', 'g') ~ '^[0-9]+$'
--       then coalesce(nullif(ltrim(regexp_replace(conexos_id, '\s', '', 'g'), '0'), ''), '0')
--       else upper(regexp_replace(conexos_id, '\s', '', 'g')) end as k
--     from controle_processos where regexp_replace(coalesce(conexos_id, ''), '\s', '', 'g') <> '') t
--   group by k having count(*) > 1;

create unique index if not exists ux_controle_processos_conexos_id
  on controle_processos ((
    case when regexp_replace(conexos_id, '\s', '', 'g') ~ '^[0-9]+$'
      then coalesce(nullif(ltrim(regexp_replace(conexos_id, '\s', '', 'g'), '0'), ''), '0')
      else upper(regexp_replace(conexos_id, '\s', '', 'g'))
    end
  ))
  where regexp_replace(coalesce(conexos_id, ''), '\s', '', 'g') <> '';
