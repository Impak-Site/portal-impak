#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
// RUNNER DE MIGRATIONS — aplica, em ordem, os arquivos .sql da pasta
// /migrations que ainda não rodaram NESSE banco específico.
//
// Uso:
//   DATABASE_URL="postgresql://...pooler.supabase.com:5432/postgres" npm run migrate
//
// Ver migrations/README.md pra instruções completas (onde pegar a
// connection string, ordem recomendada lab → main, etc.).
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Erro: defina DATABASE_URL antes de rodar.');
    console.error('Exemplo: DATABASE_URL="postgresql://..." npm run migrate');
    console.error('Ver migrations/README.md pra saber onde pegar essa connection string.');
    process.exit(1);
  }

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // Tabela que guarda quais migrations já rodaram nesse banco — cada
  // banco (main, lab, e qualquer outro no futuro) tem seu próprio
  // controle independente.
  await client.query(`
    create table if not exists _schema_migrations (
      id text primary key,
      aplicada_em timestamptz not null default now()
    );
  `);

  const dir = path.join(__dirname, '..', 'migrations');
  const arquivos = fs.readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const { rows } = await client.query('select id from _schema_migrations');
  const jaAplicadas = new Set(rows.map(r => r.id));

  let alguma = false;
  for (const arquivo of arquivos) {
    if (jaAplicadas.has(arquivo)) {
      console.log(`(já aplicada) ${arquivo}`);
      continue;
    }
    alguma = true;
    const sql = fs.readFileSync(path.join(dir, arquivo), 'utf8');
    console.log(`Aplicando ${arquivo}...`);
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into _schema_migrations (id) values ($1)', [arquivo]);
      await client.query('commit');
      console.log(`  ✓ ${arquivo} aplicada com sucesso`);
    } catch (e) {
      await client.query('rollback');
      console.error(`  ✗ erro em ${arquivo}: ${e.message}`);
      await client.end();
      process.exit(1);
    }
  }

  if (!alguma) console.log('Nada pra aplicar — banco já está em dia.');
  else console.log('Migrations em dia.');

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
