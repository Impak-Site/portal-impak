-- Migration 0022: corrige unique index parcial de catalogo_produtos
--
-- O índice único criado na 0021 era parcial (where codigo_conexos is not
-- null), o que quebra o "ON CONFLICT (codigo_conexos)" usado no import em
-- lote (upsert) -- Postgres não aceita índice parcial como alvo de ON
-- CONFLICT sem repetir a mesma condição na cláusula. Como um índice único
-- "normal" no Postgres já permite múltiplos valores NULL (NULLs nunca são
-- considerados iguais entre si), trocar pra não-parcial resolve sem mudar
-- o comportamento pra quem não tem Cod.Conexos preenchido.
drop index if exists catalogo_produtos_codigo_conexos_uk;
create unique index if not exists catalogo_produtos_codigo_conexos_uk
  on catalogo_produtos (codigo_conexos);
