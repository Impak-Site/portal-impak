-- Antes cada usuário tinha só 2 módulos possíveis: "tyredesk" e "processos"
-- (esse segundo cobria Controle+Conferência+Financeiro+Resultado+TV+Narcélio
-- de uma vez só, sem distinção). Agora cada tela vira o próprio módulo, pra
-- dar pra tela de Permissões (/permissoes) controlar cada uma
-- independentemente. Essa migration só TRADUZ o que cada usuário já tinha
-- pro novo formato — ninguém perde nem ganha acesso além do que já tinha.
update usuarios
set modulos = (
  select array_agg(distinct m) from unnest(
    array(select unnest(modulos) except select 'processos')
    || case when 'processos' = any(modulos)
         then array['conferencia','controle','financeiro','resultado','tv']
         else array[]::text[]
       end
    || case when usuario in ('narcelio','paula','suporte')
         then array['narcelio']
         else array[]::text[]
       end
  ) as m
)
where modulos is not null;
