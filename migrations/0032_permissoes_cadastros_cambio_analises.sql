-- 0032_permissoes_cadastros_cambio_analises.sql
--
-- Pedido Ayslan (14/09/2026): a tela de Permissões (/permissoes) só listava
-- 7 módulos (TyreDesk, Conferência, Controle, Financeiro, Resultado, TV,
-- Narcélio), mas o sistema já tinha crescido — Cadastros, Câmbio e Análises
-- viraram telas próprias sem ganhar uma permissão dedicada: elas "pediam
-- emprestado" o acesso de outro módulo (ver comentários antigos em
-- server.js e chat.js), o que não aparecia na tabela de Permissões e
-- confundia quem estava configurando acesso de alguém.
--
-- Esta migration só TRADUZ o acesso que cada usuário já tinha (via o
-- módulo emprestado) pro módulo novo e dedicado — ninguém perde nem ganha
-- acesso além do que já tinha antes desta mudança:
--   • quem tinha 'controle', 'financeiro', 'resultado', 'tv' ou 'narcelio'
--     (o antigo auth() de /cadastros) ganha 'cadastros'
--   • quem tinha 'financeiro' (o antigo auth() de /cambio) ganha 'cambio'
--   • quem tinha 'resultado' (o antigo auth() de /analises) ganha 'analises'
-- Depois de aplicada, o Narcelio/Paula/Ayslan podem ajustar cada um
-- individualmente pela tela de Permissões.

update usuarios
set modulos = (
  select array_agg(distinct m) from unnest(
    modulos
    || case when modulos && array['controle','financeiro','resultado','tv','narcelio']
         then array['cadastros']
         else array[]::text[]
       end
    || case when 'financeiro' = any(modulos)
         then array['cambio']
         else array[]::text[]
       end
    || case when 'resultado' = any(modulos)
         then array['analises']
         else array[]::text[]
       end
  ) as m
)
where modulos is not null;
