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
function verdadeiroRota(c, msg){ if(!c) throw new Error(msg || 'esperava verdadeiro'); }
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
  await teste('GET /api/controle/v2/processos?desde= sem sessão → 401', async () => {
    const r = await request(app).get('/api/controle/v2/processos?desde=2026-09-24T10:00:00.000000%2B00:00');
    iguais(r.status, 401);
  });
  await teste('GET /api/controle/v2/processo/:id sem sessão → 401', async () => {
    const r = await request(app).get('/api/controle/v2/processo/abc');
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

  console.log('\n── Segurança: limite de login (item 9) ──');
  await teste('8 logins errados de usuários diferentes no mesmo IP não bloqueiam o IP (limite agora é 20 falhas)', async () => {
    for (let i = 0; i < 8; i++) {
      const r = await request(app).post('/login').set('Host', 'portal.teste').set('Origin', 'https://portal.teste').set('X-Forwarded-For', '10.9.9.9')
        .type('form').send({ usuario: 'naoexiste' + i, senha: 'errada' });
      if (/Muitas tentativas/.test(r.text)) throw new Error('bloqueou na tentativa ' + (i + 1));
    }
  });
  await teste('5 erros no mesmo usuário (mesmo IP) bloqueiam só aquele usuário naquele IP', async () => {
    let r;
    for (let i = 0; i < 6; i++) {
      r = await request(app).post('/login').set('Host', 'portal.teste').set('Origin', 'https://portal.teste').set('X-Forwarded-For', '10.8.8.8')
        .type('form').send({ usuario: 'alvo', senha: 'errada' });
    }
    if (!/Muitas tentativas erradas para esse usu/.test(r.text)) throw new Error('deveria bloquear o usuário "alvo" nesse IP');
    const outroIp = await request(app).post('/login').set('Host', 'portal.teste').set('Origin', 'https://portal.teste').set('X-Forwarded-For', '10.7.7.7')
      .type('form').send({ usuario: 'alvo', senha: 'errada' });
    if (/Muitas tentativas/.test(outroIp.text)) throw new Error('outro IP não deveria estar bloqueado');
  });

  console.log('\n── Segurança: arquivos internos não são servidos ──');
  for (const caminho of ['/server.js', '/package.json', '/migrations/0036_pi_cambio_codigo_bacen.sql', '/testes_rotas.js', '/lib/totp.js',
      '/%73erver.js', '/%6cib/totp.js', '/README.m%64', '/./server.js', '//server.js', '/x/../server.js', '/%2e/server.js', '/SERVER.JS', '/.git/config', '/.idea/dataSources.xml']) {
    await teste(`GET ${caminho} → 404`, async () => {
      const r = await request(app).get(caminho);
      iguais(r.status, 404, caminho);
    });
  }
  await teste('processos.html não contém senha nem config do Firebase', async () => {
    const r = await request(app).get('/processos.html');
    iguais(r.status, 200);
    if (/password\s*:/i.test(r.text)) throw new Error('ainda tem password: no HTML');
    if (/apiKey\s*:/i.test(r.text)) throw new Error('ainda tem apiKey no HTML');
  });
  await teste('GET /chat.js (arquivo público do front) continua 200', async () => {
    const r = await request(app).get('/chat.js');
    iguais(r.status, 200);
  });

  console.log('\n── Sessão: banco fora nega acesso (revisão 17/10/2026) ──');
  const I = app._interno;
  // req/res de mentira pra rodar o auth() direto, sem banco.
  function fakeReqRes(path, sessao) {
    const req = { path, method: 'GET', session: Object.assign({ destroy(cb) { this._destruida = true; cb && cb(); } }, sessao) };
    const res = { statusCode: 200, corpo: null, redir: null,
      status(c) { this.statusCode = c; return this; }, json(b) { this.corpo = b; return this; },
      send(b) { this.corpo = b; return this; }, redirect(u) { this.redir = u; return this; } };
    return { req, res };
  }
  await teste('cadastro de usuários não carregado (banco fora no boot) → 503, não libera com a sessão antiga', async () => {
    I.definirCacheUsuarios([], false);
    const { req, res } = fakeReqRes('/api/controle/v2/processos', { usuario: 'fulano', versao: 1, modulos: ['controle'], role: 'gerente' });
    let passou = false; I.auth('controle')(req, res, () => { passou = true; });
    iguais(passou, false, 'não pode liberar'); iguais(res.statusCode, 503);
    iguais(req.session._destruida, undefined, 'não derruba a sessão (quando o banco voltar a pessoa segue logada)');
  });
  await teste('usuário que saiu do cadastro → sessão encerrada (401)', async () => {
    I.definirCacheUsuarios([{ usuario: 'outro', modulos: ['controle'], role: 'analista', sessao_versao: 1 }], true);
    const { req, res } = fakeReqRes('/api/controle/v2/processos', { usuario: 'fulano', versao: 1, modulos: ['controle'] });
    let passou = false; I.auth('controle')(req, res, () => { passou = true; });
    iguais(passou, false); iguais(res.statusCode, 401); iguais(req.session._destruida, true);
  });
  await teste('permissões vêm do cadastro ATUAL, não do login (perdeu o módulo → 403)', async () => {
    I.definirCacheUsuarios([{ usuario: 'fulano', modulos: ['tyredesk'], role: 'analista', sessao_versao: 1 }], true);
    const { req, res } = fakeReqRes('/api/controle/v2/processos', { usuario: 'fulano', versao: 1, modulos: ['controle', 'financeiro'], role: 'gerente' });
    let passou = false; I.auth('controle')(req, res, () => { passou = true; });
    iguais(passou, false); iguais(res.statusCode, 403); iguais(req.session.role, 'analista');
  });
  await teste('logout forçado (versão nova no cadastro) derruba a sessão antiga', async () => {
    I.definirCacheUsuarios([{ usuario: 'fulano', modulos: ['controle'], role: 'analista', sessao_versao: 3 }], true);
    const { req, res } = fakeReqRes('/api/x', { usuario: 'fulano', versao: 2, modulos: ['controle'] });
    let passou = false; I.auth('controle')(req, res, () => { passou = true; });
    iguais(passou, false); iguais(res.statusCode, 401); iguais(req.session._destruida, true);
  });
  await teste('sessão válida com módulo certo passa', async () => {
    I.definirCacheUsuarios([{ usuario: 'fulano', modulos: ['controle'], role: 'analista', sessao_versao: 3 }], true);
    const { req, res } = fakeReqRes('/api/x', { usuario: 'fulano', versao: 3, modulos: [] });
    let passou = false; I.auth('controle')(req, res, () => { passou = true; });
    iguais(passou, true);
  });
  await teste('código 2FA: 6 erros bloqueiam o usuário de qualquer IP e só acertar o código zera', async () => {
    I.limparFalhas2FA('alvo2fa');
    for (let i = 0; i < 5; i++) I.registrarFalha2FA('alvo2fa');
    iguais(I.bloqueado2FA('alvo2fa'), false, '5 erros ainda não bloqueiam');
    I.registrarFalha2FA('alvo2fa');
    iguais(I.bloqueado2FA('alvo2fa'), true, '6 erros bloqueiam');
    I.limparFalhas2FA('alvo2fa');
    iguais(I.bloqueado2FA('alvo2fa'), false);
  });
  I.definirCacheUsuarios([], false);

  console.log('\n── Mensagens de erro úteis (lib/erros-amigaveis.js) ──');
  const { traduzirErro } = require('./lib/erros-amigaveis');
  await teste('erro técnico do banco vira motivo + próximo passo', async () => {
    verdadeiroRota(/Registro duplicado/.test(traduzirErro('duplicate key value violates unique constraint "idx_faturas_numero"').msg));
    verdadeiroRota(/Data inválida/.test(traduzirErro('invalid input syntax for type date: "07/08/2026"').msg));
    verdadeiroRota(/não conseguiu falar com o banco/.test(traduzirErro('TypeError: fetch failed').msg));
    verdadeiroRota(/Falta preencher um campo obrigatório \(referencia\)/.test(traduzirErro('null value in column "referencia" violates not-null constraint').msg));
  });
  await teste('mensagem que já é do sistema passa intacta', async () => {
    const t = traduzirErro('Processo fechado — reabra para editar (só gerente pode reabrir).');
    iguais(t.traduzido, false); iguais(t.msg, 'Processo fechado — reabra para editar (só gerente pode reabrir).');
  });
  await teste('arquivo grande demais antes do login → mensagem clara (não "Requisição inválida")', async () => {
    const r = await request(app).post('/login').set('Content-Type', 'application/json').send(JSON.stringify({ x: 'a'.repeat(1100000) }));
    iguais(r.status, 413);
    verdadeiroRota(/Arquivo grande demais/.test(r.body.erro), r.body.erro);
  });
  await teste('sem sessão: API responde 401 com mensagem de sessão expirada', async () => {
    const r = await request(app).get('/api/controle/v2/processos');
    iguais(r.status, 401);
    verdadeiroRota(/sessão expirou/.test(r.body.erro), r.body.erro);
  });

  console.log('\n── Velocidade: arquivos com versão ficam em cache (revisão 17/10/2026) ──');
  await teste('telas apontam pra .js com ?v=<impressão digital> (menos vendor/)', async () => {
    const h = I.versionarHtml('<script src="/controle-core.js"></script><script src="excel-styles.js"></script><script src="/vendor/xlsx.full.min.js"></script>');
    verdadeiroRota(/src="\/controle-core\.js\?v=[0-9a-f]{10}"/.test(h), h);
    verdadeiroRota(/src="excel-styles\.js\?v=[0-9a-f]{10}"/.test(h), h);
    verdadeiroRota(/src="\/vendor\/xlsx\.full\.min\.js"/.test(h), 'vendor fica como está');
  });
  await teste('.js com ?v= vai pro cache longo; sem ?v= continua revalidando', async () => {
    const a = await request(app).get('/controle-core.js?v=abc123');
    iguais(a.status, 200); verdadeiroRota(/immutable/.test(a.headers['cache-control'] || ''), a.headers['cache-control']);
    const b = await request(app).get('/controle-core.js');
    iguais(b.headers['cache-control'], 'no-cache');
    const c = await request(app).get('/chat.js?v=abc123');
    verdadeiroRota(/immutable/.test(c.headers['cache-control'] || ''), c.headers['cache-control']);
  });

  console.log('\n──────────────────────────────────────────────────');
  console.log(`Total: ${total} testes, ${passaram} passaram, ${total - passaram} falharam`);
  process.exit(passaram === total ? 0 : 1);
})();
