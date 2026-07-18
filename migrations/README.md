# Migrations do banco (Supabase / Postgres)

A partir de agora, toda alteração na estrutura do banco (nova coluna, nova
tabela, novo índice etc.) vira um arquivo `.sql` numerado aqui, commitado no
Git — nunca mais direto no SQL Editor do Supabase sem deixar rastro.

Foi exatamente a falta disso que fez o banco do `main` (produção) e do
`lab` (teste) divergirem sem ninguém perceber: na migração de dados de
julho/2026 descobrimos que o `main` tinha uma coluna (`lacre`) que o `lab`
não tinha, e o `lab` tinha duas colunas (`estimativa_json`, `cotacao_id`)
que o `main` não tinha. Ninguém tinha errado de propósito — só não existia
nenhum registro de quem mudou o quê, em qual banco, e por quê.

## Como criar uma migration nova

1. Crie um arquivo `NNNN_nome_curto.sql` aqui — `NNNN` é o próximo número
   em ordem (4 dígitos: `0001`, `0002`, ...).
2. Escreva o SQL de forma seguobserva: sempre que der, use
   `add column if not exists`, `create table if not exists`, etc. — assim
   o arquivo pode ser rodado mais de uma vez sem quebrar nada.
3. Rode no **lab primeiro** (ver "Como rodar" abaixo, com o `DATABASE_URL`
   do lab).
4. Só depois de validar que funciona no lab, rode a mesma migration no
   **main** (trocando o `DATABASE_URL`). Nunca aplique direto no main sem
   já ter testado no lab antes.
5. Depois de aplicar em produção, **atualize o código relacionado** (se a
   migration existe pra suportar uma feature nova) e faça o deploy junto.

## Como rodar

```
DATABASE_URL="postgresql://postgres.XXXX:SENHA@aws-1-sa-east-1.pooler.supabase.com:5432/postgres" npm run migrate
```

A connection string fica em: Supabase → abrir o projeto → botão **Connect**
(topo da tela) → aba **Direct** → opção **Session pooler** → copiar a URI
(trocar `[YOUR-PASSWORD]` pela senha real do banco daquele projeto — em
Database Settings → "Reset password" se não souber a senha atual).

O runner (`scripts/migrate.js`) guarda numa tabela `_schema_migrations`
quais arquivos já rodaram *naquele banco específico* — então rodar de novo
é sempre seguro, ele só aplica o que ainda não tiver rodado ali.

## Migrations existentes

- **0001** — adiciona `estimativa_json`/`cotacao_id` em `controle_processos`
  (usadas pela feature "Aprovar Cotação → Criar Processo"). Já aplicada no
  lab manualmente antes desta pasta existir; falta aplicar no main quando
  essa feature for promovida pra produção.
- **0002** — não altera nada, só documenta a coluna legada `lacre` (existe
  no main, não existe no lab, não é usada em nenhum código atual).
