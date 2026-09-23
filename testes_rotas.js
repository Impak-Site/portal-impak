// Testes de rota (19/09/2026) -- primeira cobertura das ROTAS do servidor,
// não só das funções puras. Sobe o Express exportado por server.js sem abrir
// porta (require.main !== module) e sem banco: só valida o que dá pra
// validar antes de qualquer consulta ao Supabase -- principalmente que as
// rotas sensíveis (admin, exclusões, gravação de processo, backup) recusam
// quem não está logado, e que o erro genérico não vaza stack trace.
// Rodar: node testes_rotas.js
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'teste-rotas-secret';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://exemplo.supabase.co';
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || 'chave-falsa-so-pra-instanciar';
const request = require('supertest');
const app = require('./server.js');

let total = 0, passaram = 0;
async function teste(nome, fn){
  total++;
  try { await fn(); passaram++; console.log('  ✓ ' + nome); }
  catch (e) { console.log('  ✗ ' + nome + '\n      ' + (e.message || e)); }
}
function iguais(a, b, msg){ if (a !== b) throw new Error((msg ? msg + ' — ' : '') + `esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); }

(async () => {
  console.log('\n── Rotas: acesso sem login ──');
  const protegidasPost = [
    '/api/admin/backup', '/api/admin/alertas-diarios', '/api/admin/alertas-separados',
    '/api/admin/followup-semanal', '/api/admin/permissoes/fulano',
    '/api/controle/v2/processo',
  ];
  for (const rota of protegidasPost) {
    await teste(`POST ${rota} sem sessão → 401`, async () => {
      const r = await request(app).post(rota).send({});
      iguais(r.status, 401, rota);
      iguais(r.body.ok, false);
    });
  }
  const protegidasDelete = [
    '/api/controle/v2/processo/abc', '/api/controle/processo/abc',
    '/api/controle/v2/arquivos/abc', '/api/contatos/abc', '/api/cadastros/pessoas/abc',
    '/api/calculador/cotacoes/abc', '/api/conferencia/processo/abc', '/api/catalogo-produtos/abc',
  ];
  for (const rota of protegidasDelete) {
    await teste(`DELETE ${rota} sem sessão → 401`, async () => {
      const r = await request(app).delete(rota);
      iguais(r.status, 401, rota);
    });
  }
  await teste('GET /api/controle/v2/processos sem sessão → 401', async () => {
    const r = await request(app).get('/api/controle/v2/processos');
    iguais(r.status, 401);
  });

  console.log('\n── Rotas: respostas públicas ──');
  await teste('GET /health responde 200 sem expor segredos', async () => {
    const r = await request(app).get('/health');
    iguais(r.status, 200);
    const txt = JSON.stringify(r.body);
    if (/supabase\.co|ghp_|sk-ant|re_[A-Za-z0-9]/.test(txt)) throw new Error('health expõe segredo: ' + txt);
  });
  await teste('POST /api/login sem corpo → 4xx (não 500)', async () => {
    const r = await request(app).post('/api/login').send({});
    if (r.status >= 500) throw new Error('status ' + r.status + ' ' + JSON.stringify(r.body));
  });
  await teste('JSON malformado → 400 com mensagem genérica (sem stack trace)', async () => {
    const r = await request(app).post('/api/login').set('Content-Type', 'application/json').send('{"usuario": ');
    if (r.status >= 500) throw new Error('status ' + r.status);
    if (/at .*\.js:\d+/.test(r.text)) throw new Error('vazou stack trace');
  });

  console.log('\n── Segurança: CSRF por Origin ──');
  await teste('POST vindo de outro site (Origin estrangeiro) → 403', async () => {
    const r = await request(app).post('/login').set('Origin', 'https://site-malicioso.com').type('form').send({ usuario: 'x', senha: 'y' });
    iguais(r.status, 403);
  });
  await teste('POST do próprio site (Origin = Host) passa pela checagem', async () => {
    const r = await request(app).post('/login').set('Host', 'portal.teste').set('Origin', 'https://portal.teste').type('form').send({ usuario: 'x', senha: 'y' });
    if (r.status === 403) throw new Error('bloqueou requisição legítima do próprio site');
  });

  console.log('\n──────────────────────────────────────────────────');
  console.log(`Total: ${total} testes, ${passaram} passaram, ${total - passaram} falharam`);
  process.exit(passaram === total ? 0 : 1);
})();
