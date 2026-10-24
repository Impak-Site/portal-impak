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
    // Vínculo cotação ↔ processo (20/10/2026)
    '/api/calculador/cotacoes/abc/vincular-processo', '/api/calculador/cotacoes/abc/desvincular-processo',
    '/api/calculador/cotacoes/abc/restaurar', '/api/calculador/vinculos/corrigir', '/api/calculador/cotacoes',
    // Aba Faturas do processo (21/10/2026): conferência guardada na fatura
    '/api/faturas/abc/conferencia',
    '/api/faturas/abc/conferencia/decisao',
    // Numerário do despachante (fase 2)
    '/api/faturas/numerarios', '/api/faturas/abc/abater-numerario', '/api/faturas/abc/devolucao-numerario',
    // Atualizar pelo Conexos (Catálogo, 23/10/2026)
    '/api/conexos/cadastro/previa', '/api/conexos/cadastro/aplicar',
    // E-mails automáticos (lib/jobs-email.js, 24/10/2026)
    '/api/admin/newsletter/teste', '/api/carregamento/pedir-transportadora/enviar-teste',
    '/api/admin/verificacao-dados/rodar',
  ];
  for (const rota of ['/api/carregamento/pedir-transportadora/previa', '/api/carregamento/pedir-transportadora/ultimo-envio',
    '/api/admin/verificacao-dados', '/api/admin/auditoria-datas/previa']) {
    await teste(`GET ${rota} sem sessão → 401 (lib/jobs-email.js)`, async () => {
      const r = await request(app).get(rota);
      iguais(r.status, 401, rota);
    });
  }
  for (const rota of ['/api/admin/dropbox/status', '/api/admin/dropbox/conectar', '/api/admin/dropbox/callback']) {
    await teste(`GET ${rota} sem sessão → 401 (lib/jobs-backup.js)`, async () => {
      const r = await request(app).get(rota);
      iguais(r.status, 401, rota);
    });
  }
  await teste('POST /api/admin/dropbox/rodar sem sessão → 401 (lib/jobs-backup.js)', async () => {
    const r = await request(app).post('/api/admin/dropbox/rodar').send({});
    iguais(r.status, 401);
  });
  await teste('GET /backup sem sessão → vai para o login (lib/jobs-backup.js)', async () => {
    const r = await request(app).get('/backup');
    iguais(r.status, 302);
    verdadeiroRota(/\/login\?destino=\/backup/.test(r.headers.location || ''), r.headers.location);
  });
  for (const [metodo, rota] of [['get', '/api/fin/cadastros'], ['post', '/api/fin/contas'], ['post', '/api/fin/recorrencias/gerar'],
    ['post', '/api/faturas/baixa-lote'], ['post', '/api/faturas/abc/baixa'], ['post', '/api/faturas/abc/estornar'], ['get', '/api/faturas/abc/arquivo'],
    ['post', '/api/faturas/ler-documento'], ['post', '/api/faturas/importar'], ['get', '/api/faturas/receber-pendentes']]) {
    await teste(`${metodo.toUpperCase()} ${rota} sem sessão → 401 (lib/rotas-faturas.js)`, async () => {
      const r = await request(app)[metodo](rota).send({});
      iguais(r.status, 401, rota);
    });
  }
  await teste('GET /faturas sem sessão → vai para o login (lib/rotas-faturas.js)', async () => {
    const r = await request(app).get('/faturas');
    verdadeiroRota(r.status === 302 || r.status === 401, 'status ' + r.status);
  });
  await teste('lib/rotas-faturas.js: registrar() registra as rotas sem ler constantes que o server.js declara depois', async () => {
    const rotas = [];
    const appFalso = { get: (c) => rotas.push('GET ' + c), post: (c) => rotas.push('POST ' + c), use: (c) => rotas.push('USE ' + c) };
    const lidas = [];
    require('./lib/rotas-faturas.js').registrar(appFalso, new Proxy({ auth: () => () => {},
      gedBucket: () => { lidas.push('gedBucket'); return 'x'; }, midiasAnalise: () => { lidas.push('midiasAnalise'); return new Set(); },
      reivindicarJobHoje: async () => { lidas.push('reivindicarJobHoje'); return false; } },
      { get: (t, k) => (k in t ? t[k] : () => '') }));
    iguais(lidas.length, 0, 'leu na hora de registrar: ' + lidas.join(','));
    ['USE /api/faturas', 'GET /faturas', 'GET /api/faturas', 'POST /api/faturas/:id/baixa', 'GET /api/fin/cadastros', 'POST /api/faturas/:id/:acao']
      .forEach(x => verdadeiroRota(rotas.includes(x), x));
    verdadeiroRota(rotas.indexOf('POST /api/faturas/:id/:acao') > rotas.indexOf('POST /api/faturas/:id/baixa'), 'rota genérica :acao continua depois das específicas');
  });
  await teste('lib/jobs-backup.js: registrar() devolve os agendadores e registra as rotas', async () => {
    const rotas = [];
    const appFalso = { get: (c) => rotas.push('GET ' + c), post: (c) => rotas.push('POST ' + c) };
    const r = require('./lib/jobs-backup.js').registrar(appFalso, new Proxy({ auth: () => () => {}, ADMINS_PERMISSOES: [] },
      { get: (t, k) => (k in t ? t[k] : () => '') }));
    iguais(typeof r.agendarBackupSemanal, 'function');
    iguais(typeof r.agendarBackupDropbox, 'function');
    ['POST /api/admin/backup', 'GET /backup', 'GET /api/admin/dropbox/status', 'POST /api/admin/dropbox/rodar']
      .forEach(x => verdadeiroRota(rotas.includes(x), x + ' — ' + rotas.join(', ')));
  });
  await teste('lib/jobs-email.js: registrar() devolve as funções que o server.js usa', async () => {
    const rotas = [];
    const appFalso = { get: (c) => rotas.push('GET ' + c), post: (c) => rotas.push('POST ' + c) };
    const r = require('./lib/jobs-email.js').registrar(appFalso, new Proxy(
      { usuariosCache: () => new Map(), Newsletter: require('./newsletter-servidor.js'), auth: () => () => {} },
      { get: (t, k) => (k in t ? t[k] : () => '') }));  // dependências que não importam aqui viram função vazia
    ['reivindicarJobHoje', 'jaEnviouJobHoje', 'marcarJobEnviadoHoje', 'decidirFollowUp', 'dispararFollowUp', 'ehLCLServidor',
      'atualizarHistoricoAgenda', 'enviarResumoSemanalAgenda', 'agendarAlertasDiarios', 'agendarAlertasSeparados']
      .forEach(n => iguais(typeof r[n], 'function', n));
    iguais(r.ehLCLServidor({ tipo_container: 'lcl' }), true);
    iguais(r.ehLCLServidor({ tipo_container: 'FCL' }), false);
    verdadeiroRota(rotas.includes('POST /api/admin/alertas-diarios') && rotas.includes('POST /api/admin/followup-semanal'), rotas.join(', '));
  });
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
  for (const rota of ['/api/calculador/cotacoes?completa=1', '/api/calculador/vinculos', '/api/controle/processos/abc/cotacao', '/api/calculador/cotacoes/abc', '/api/faturas/resumo-processos', '/api/faturas?processo_id=abc',
    '/api/agenda/faturas']) { // faturas na Agenda (fase 2)
    await teste(`GET ${rota} sem sessão → 401`, async () => {
      const r = await request(app).get(rota);
      iguais(r.status, 401, rota);
    });
  }
  await teste('GET /cotacoes (tela) sem sessão → vai pro login', async () => {
    const r = await request(app).get('/cotacoes');
    iguais(r.status, 302);
    verdadeiroRota(/\/login/.test(r.headers.location || ''), 'redireciona pro login: ' + r.headers.location);
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

  console.log('\n── Edição simultânea: quem salvou no meio (21/10/2026) ──');
  await teste('só a própria pessoa no histórico e no último save → mesmo_usuario (não acusa a si mesma)', async () => {
    const r = I.quemSalvouNoMeio([{ usuario: 'Fulana' }, { usuario: 'fulana' }], 'fulana', 'fulana');
    iguais(r.mesmoUsuario, true); iguais(r.login, null);
  });
  await teste('outra pessoa no histórico → é ela, mesmo que o último save tenha sido da própria pessoa', async () => {
    const r = I.quemSalvouNoMeio([{ usuario: 'fulana' }, { usuario: 'beltrano' }], 'fulana', 'fulana');
    iguais(r.mesmoUsuario, false); iguais(r.login, 'beltrano');
  });
  await teste('sem histórico: último save de outra pessoa → é ela', async () => {
    const r = I.quemSalvouNoMeio([], 'ciclano', 'fulana');
    iguais(r.mesmoUsuario, false); iguais(r.login, 'ciclano');
  });
  await teste('conferência da tela antiga recebe as regras novas do CE (situação de pagamento e lacre)', async () => {
    const content = [{ type: 'text', text: 'Especialista em conferencia documental ... NCM(verificar se tem 8 digitos) ...' }];
    iguais(I.atualizarRegrasConferenciaAntiga(content), true);
    verdadeiroRota(/SITUACAO DE PAGAMENTO do CE/.test(content[0].text) && /NAO traz lacre/.test(content[0].text) && /4 digitos/.test(content[0].text), content[0].text.slice(-300));
    const outro = [{ type: 'text', text: 'prompt da aba Conferência do Controle' }];
    iguais(I.atualizarRegrasConferenciaAntiga(outro), false, 'o prompt do Controle já leva as regras — não duplica');
  });

  console.log('\n── ID no Conexos nunca repetido no servidor (21/10/2026) ──');
  // Lista fictícia no lugar da consulta ao banco.
  const outrosCx = [{ id: 'cx-1', referencia: 'TESTE-CX-1', conexos_id: '04321', cancelado: false }, { id: 'cx-2', referencia: 'TESTE-CX-2', conexos_id: '4322', cancelado: true }];
  const listarCx = async () => outrosCx;
  await teste('número de outro processo → mensagem com o processo (e "cancelado")', async () => {
    const p = { id: 'cx-9', conexos_id: ' 4322 ' };
    const msg = await I.conferirConexosIdRepetido(p, { conexos_id: null }, listarCx);
    verdadeiroRota(/O ID no Conexos 4322 já está no processo TESTE-CX-2 \(cancelado\)/.test(msg || ''), msg);
    iguais(p.conexos_id, '4322', 'grava sem espaços nas pontas');
  });
  await teste('zeros à esquerda contam como o mesmo número; processo novo (sem id) também confere', async () => {
    const msg = await I.conferirConexosIdRepetido({ conexos_id: '4321' }, null, listarCx);
    verdadeiroRota(/TESTE-CX-1/.test(msg || ''), msg);
  });
  await teste('sem mudança no número, vazio ou sem o campo: não consulta e não bloqueia', async () => {
    let consultou = 0; const contar = async () => { consultou++; return outrosCx; };
    iguais(await I.conferirConexosIdRepetido({ id: 'cx-1', conexos_id: '4321' }, { conexos_id: '04321' }, contar), null, 'é o próprio número (só mudou a escrita)');
    const vazio = { id: 'cx-9', conexos_id: '  ' };
    iguais(await I.conferirConexosIdRepetido(vazio, { conexos_id: '5' }, contar), null); iguais(vazio.conexos_id, null, 'vazio vira null (apagar o ID)');
    iguais(await I.conferirConexosIdRepetido({ id: 'cx-9', obs: 'x' }, null, contar), null);
    iguais(consultou, 0);
    iguais(await I.conferirConexosIdRepetido({ id: 'cx-9', conexos_id: '4323' }, null, contar), null, 'número livre passa');
    iguais(consultou, 1);
  });
  await teste('erro de índice único do banco (gravação ao mesmo tempo) é reconhecido', async () => {
    iguais(I.ehErroConexosRepetido({ message: 'duplicate key value violates unique constraint "ux_controle_processos_conexos_id"' }), true);
    iguais(I.ehErroConexosRepetido({ message: 'duplicate key value violates unique constraint "controle_processos_pkey"' }), false);
    iguais(I.ehErroConexosRepetido(null), false);
  });

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

  console.log('\n── E-mails: logo visível e respostas no suporte@ (22/10/2026) ──');
  await teste('imagem de /assets pode aparecer dentro de e-mail (CORP cross-origin)', async () => {
    const r = await request(app).get('/assets/logo-email-impak.png');
    iguais(r.status, 200);
    iguais(r.headers['cross-origin-resource-policy'], 'cross-origin');
  });
  await teste('o resto continua same-origin (helmet)', async () => {
    const r = await request(app).get('/controle-core.js');
    iguais(r.headers['cross-origin-resource-policy'], 'same-origin');
  });
  await teste('todo e-mail sai com resposta para o suporte@; o remetente pode ser trocado', async () => {
    const fetchOriginal = global.fetch, chaveOriginal = process.env.RESEND_API_KEY;
    const corpos = [];
    global.fetch = async (url, init) => {
      if (String(url).includes('api.resend.com')) { corpos.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ id: 'teste' }) }; }
      return fetchOriginal(url, init);
    };
    process.env.RESEND_API_KEY = 'chave-de-teste-ficticia';
    try {
      await I.enviarEmail('fulano@impak.com.br', 'Teste', '<p>x</p>', { alerta: true });
      await I.enviarEmail('fulano@impak.com.br', 'Teste', '<p>x</p>', { alerta: true, from: 'Suporte IMPAK <suporte@impak.com.br>' });
    } finally {
      global.fetch = fetchOriginal;
      if (chaveOriginal === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = chaveOriginal;
    }
    iguais(corpos.length, 2);
    iguais(corpos[0].reply_to, 'suporte@impak.com.br');
    iguais(corpos[1].reply_to, 'suporte@impak.com.br');
    iguais(corpos[1].from, 'Suporte IMPAK <suporte@impak.com.br>');
  });

  console.log('\n── Troca da chave do 2FA (TOTP_ENC_KEY) e SENHA_* (22/10/2026) ──');
  {
    // Chaves e segredos fictícios — só para o teste.
    const A = 'chave-ficticia-A-0123456789', B = 'chave-ficticia-B-0123456789', C = 'chave-ficticia-C-0123456789';
    const envAntes = { k: process.env.TOTP_ENC_KEY, a: process.env.TOTP_ENC_KEY_ANTERIOR };
    const usarChaves = (atual, anterior) => {
      if (atual === undefined) delete process.env.TOTP_ENC_KEY; else process.env.TOTP_ENC_KEY = atual;
      if (anterior === undefined) delete process.env.TOTP_ENC_KEY_ANTERIOR; else process.env.TOTP_ENC_KEY_ANTERIOR = anterior;
    };
    const silenciar = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
    try {
      usarChaves(A);
      const cifradoA = I.cifrarSegredo2FA('SEGREDOFICTICIO1');
      usarChaves(C);
      const cifradoC = I.cifrarSegredo2FA('SEGREDOFICTICIO4');
      usarChaves(B);
      const cifradoB = I.cifrarSegredo2FA('SEGREDOFICTICIO2');

      await teste('chave atual abre o que ela mesma cifrou', async () => {
        usarChaves(B);
        verdadeiroRota(cifradoB.startsWith('enc:v1:'), 'deveria sair cifrado');
        iguais(I.decifrarSegredo2FA(cifradoB), 'SEGREDOFICTICIO2');
        iguais(I.chaveDoSegredo2FA(cifradoB), 'atual');
      });
      await teste('durante a troca: chave nova + TOTP_ENC_KEY_ANTERIOR abre o segredo antigo', async () => {
        usarChaves(B, A);
        iguais(I.decifrarSegredo2FA(cifradoA), 'SEGREDOFICTICIO1');
        iguais(I.chaveDoSegredo2FA(cifradoA), 'anterior');
        iguais(I.chaveDoSegredo2FA('SEGREDOEMTEXTO'), 'texto');
        iguais(I.chaveDoSegredo2FA(null), 'vazio');
      });
      await teste('sem a chave anterior o segredo antigo não abre (e não derruba nada)', async () => {
        usarChaves(B);
        iguais(await silenciar(() => I.decifrarSegredo2FA(cifradoA)), null);
        iguais(I.chaveDoSegredo2FA(cifradoA), 'nenhuma');
      });
      await teste('recifrar regrava anterior e texto na chave atual, com update condicional', async () => {
        usarChaves(B, A);
        const linhas = [
          { usuario: 'u1', totp_secret: cifradoA },
          { usuario: 'u2', totp_secret: cifradoB },
          { usuario: 'u3', totp_secret: 'SEGREDOEMTEXTO' },
          { usuario: 'u4', totp_secret: cifradoC },
        ];
        const filtrosUsados = [];
        const db = {
          from() {
            return {
              select() { return { not: async () => ({ data: linhas.map(l => ({ ...l })), error: null }) }; },
              update(valores) {
                const f = [];
                const q = { eq(c, v) {
                  f.push([c, v]);
                  if (f.length < 2) return q;
                  filtrosUsados.push(f.map(x => x[0]).join('+'));
                  const l = linhas.find(x => x.usuario === f[0][1] && x.totp_secret === f[1][1]);
                  if (l) Object.assign(l, valores);
                  return Promise.resolve({ error: null });
                } };
                return q;
              },
            };
          },
        };
        const r = await I.recifrarSegredos2FA(db);
        iguais(r.ok, true);
        iguais(r.total, 4);
        iguais(r.ja_na_atual, 1);
        iguais(r.recifrados, 1);
        iguais(r.cifrados_texto, 1);
        iguais(JSON.stringify(r.nao_abrem), '["u4"]');
        iguais(filtrosUsados.join(','), 'usuario+totp_secret,usuario+totp_secret');
        usarChaves(B); // sem a anterior: u1 e u3 já abrem só com a chave nova
        iguais(I.decifrarSegredo2FA(linhas[0].totp_secret), 'SEGREDOFICTICIO1');
        iguais(I.decifrarSegredo2FA(linhas[2].totp_secret), 'SEGREDOEMTEXTO');
        iguais(linhas[3].totp_secret, cifradoC, 'quem não abre fica como estava');
      });
      await teste('situação do 2FA: só contagens e nomes, e diz quando pode apagar a anterior', async () => {
        usarChaves(B, A);
        const s1 = I.situacaoSegredos2FA([{ usuario: 'u1', totp_secret: cifradoA }, { usuario: 'u2', totp_secret: cifradoB }, { usuario: 'u5', totp_secret: null }]);
        iguais(s1.com_2fa, 2); iguais(s1.atual, 1); iguais(s1.anterior, 1);
        iguais(s1.pode_apagar_anterior, false);
        iguais(s1.chave_anterior_configurada, true);
        verdadeiroRota(!JSON.stringify(s1).includes('SEGREDO') && !JSON.stringify(s1).includes('enc:v1:'), 'não pode expor segredo');
        const s2 = I.situacaoSegredos2FA([{ usuario: 'u2', totp_secret: cifradoB }]);
        iguais(s2.pode_apagar_anterior, true);
      });
      await teste('SENHA_* ausente não gera aviso falso de "login vai falhar"', async () => {
        const e = console.error; let avisos = 0; console.error = () => { avisos++; };
        try { iguais(I.envSenhaHash('SENHA_QUE_NAO_EXISTE_TESTE'), null); } finally { console.error = e; }
        iguais(avisos, 0);
      });
      for (const [metodo, rota] of [['get', '/api/admin/2fa/situacao'], ['post', '/api/admin/2fa/recifrar']]) {
        await teste(`${metodo.toUpperCase()} ${rota} sem sessão → 401`, async () => {
          const r = await request(app)[metodo](rota).send({});
          iguais(r.status, 401);
        });
      }
    } finally {
      usarChaves(envAntes.k, envAntes.a);
    }
  }

  console.log('\n──────────────────────────────────────────────────');
  console.log(`Total: ${total} testes, ${passaram} passaram, ${total - passaram} falharam`);
  process.exit(passaram === total ? 0 : 1);
})();
