/**
 * IMPAK Portal — Servidor v2.0
 * Banco de dados: Supabase PostgreSQL
 *
 * Variáveis Railway obrigatórias:
 *   SUPABASE_URL  → URL do projeto Supabase
 *   SUPABASE_KEY  → service_role key
 *
 * Variáveis Railway opcionais:
 *   ANTHROPIC_API_KEY → chave da API Anthropic
 *   SESSION_SECRET    → segredo da sessão (fixo — se não tiver, sessão morre a cada deploy)
 *   SENHA_*           → senhas dos usuários
 *
 * Tabela extra necessária no Supabase (sessão persistente, sobrevive a deploy):
 *   create table if not exists app_sessions (
 *     sid text primary key,
 *     sess jsonb not null,
 *     expire timestamptz not null
 *   );
 *   create index if not exists app_sessions_expire_idx on app_sessions (expire);
 */

const express = require('express');
const session = require('express-session');
const path    = require('path');
const { createClient } = require('@supabase/supabase-js');
const { randomUUID, scryptSync, randomBytes, timingSafeEqual, createHash } = require('crypto');
const { mapearCotacaoParaProcesso, mapearProcessoParaCotacao, extrairEstimativa, gerarRealJsonInicial } = require('./mapeamento_cotacao_processo.js'); const { importarPlanilhaBase, importarFechamentoBase } = require('./planilha-import.js');

function gerarUUID(){ return randomUUID(); }

// ── HASH DE SENHA (scrypt nativo do Node — sem dependência externa) ──
// Formato do hash armazenado: "salt:hash" (ambos em hex).
function hashSenha(senhaPura){
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(senhaPura, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verificarSenha(senhaPura, hashArmazenado){
  if(!hashArmazenado || !hashArmazenado.includes(':')) return false;
  const [salt, hashOriginal] = hashArmazenado.split(':');
  const hashTentativa = scryptSync(senhaPura, salt, 64).toString('hex');
  // timingSafeEqual evita "timing attack" (comparar com === pode revelar,
  // pelo tempo de resposta, quantos caracteres já bateram).
  const bufOriginal  = Buffer.from(hashOriginal, 'hex');
  const bufTentativa = Buffer.from(hashTentativa, 'hex');
  if(bufOriginal.length !== bufTentativa.length) return false;
  return timingSafeEqual(bufOriginal, bufTentativa);
}

// ── SEGURANÇA: sanitização do parâmetro "destino" (usado no fluxo de login) ──
// "destino" chega direto da query string / body (controlado pelo visitante),
// e era antes inserido sem escapar num atributo HTML e usado em res.redirect
// sem validação — abrindo brecha de XSS refletido e de "open redirect"
// (alguém manda um link tipo /login?destino=https://site-falso.com e, após
// o login legítimo, o usuário é levado pra fora do domínio do IMPAK).
// Aqui só aceitamos caminhos relativos internos (começando com uma única
// barra, nunca "//" — que os navegadores tratam como protocol-relative URL).
function sanitizeDestino(destino) {
  if (typeof destino !== 'string' || !destino.startsWith('/') || destino.startsWith('//')) return '/';
  return destino;
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── HASH DO TOKEN DE REDEFINIÇÃO DE SENHA ─────────────────────
// Antes o reset_token era salvo em texto puro no banco — quem tivesse
// acesso de leitura à tabela "usuarios" (um dump, um backup vazado, uma
// query mal protegida) podia usar o token direto pra resetar a senha de
// qualquer usuário, sem nunca precisar do e-mail. Agora só o HASH do
// token fica no banco; o token em si só existe no link enviado por
// e-mail. SHA-256 (não scrypt) é suficiente aqui porque o token já nasce
// com 32 bytes de entropia aleatória (randomBytes) — diferente de uma
// senha escolhida por humano, não há risco de força bruta por dicionário.
function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
// Busca o usuário dono de um token, comparando o HASH com timingSafeEqual
// (em vez de === direto) para não vazar, pelo tempo de resposta, quantos
// bytes do hash já bateram — mesma lógica de verificarSenha() acima.
function buscarUsuarioPorTokenReset(token) {
  if (!token) return null;
  const tentativaBuf = Buffer.from(hashToken(token), 'hex');
  for (const u of _usuariosCache.values()) {
    if (!u.reset_token) continue;
    const armazenadoBuf = Buffer.from(u.reset_token, 'hex');
    if (armazenadoBuf.length === tentativaBuf.length && timingSafeEqual(armazenadoBuf, tentativaBuf)) {
      return u;
    }
  }
  return null;
}

const app  = express();
const PORT = process.env.PORT || 3000;

// ── SUPABASE ──────────────────────────────────────────────────
// Inicialização lazy — variáveis de ambiente disponíveis somente
// após o processo iniciar, não no momento do require()
let _sb = null;
function sb() {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL ou SUPABASE_KEY não configurados no Railway');
  _sb = createClient(url, key, { auth: { persistSession: false } });
  console.log('✓ Supabase conectado:', url.slice(0, 40) + '...');
  return _sb;
}

// ── SESSION STORE PERSISTENTE (Supabase) ─────────────────────────
// Antes: sessão vivia só na memória do processo Node (MemoryStore, o padrão
// do express-session). Resultado: TODO deploy/restart do Railway derrubava a
// sessão de TODOS os usuários logados, mesmo com SESSION_SECRET fixo — o
// segredo só evita erro de assinatura do cookie, mas sem um lugar persistente
// pra guardar os dados da sessão em si, o servidor não reconhece mais o
// cookie depois de reiniciar. Isso causava o erro "Unexpected token '<' ...
// is not valid JSON" ao salvar: a chamada à API era redirecionada
// silenciosamente pra /login (HTML) e o front tentava ler aquilo como JSON.
// Este store salva a sessão na tabela `app_sessions` do Supabase, então ela
// sobrevive a deploys normalmente (precisa existir a tabela — ver README).
// Se a tabela `app_sessions` ainda não existir no Supabase (setup pendente),
// nenhuma chamada aqui deve derrubar a requisição nem travar login — só
// registra um aviso uma vez e segue como se não houvesse sessão persistida
// (mesmo comportamento de antes, sem quebrar nada enquanto a tabela não sai).
// Duas categorias de erro bem diferentes aqui:
//  1. "Tabela ainda não existe" (setup pendente) — situação SEGURA e
//     esperada logo após o deploy deste código, antes de alguém rodar o SQL
//     de criação da tabela. Avisa só 1x pra não poluir o log.
//  2. QUALQUER outro erro (ex: permissão faltando — já aconteceu: a tabela
//     foi criada mas o Supabase não deu GRANT pro service_role, e isso
//     travou login de todo mundo silenciosamente até alguém notar) — isso
//     é grave, avisa SEMPRE (não só 1x) e de um jeito bem visível, porque
//     "só 1 aviso perdido no meio do log" foi exatamente o que escondeu o
//     problema real da última vez.
let _avisouTabelaAusente = false;
// Retorna true se o erro é o caso conhecido/esperado "tabela ainda não existe"
// (degradação graciosa é ok), ou false se é um erro real (outage, permissão
// faltando, etc) — nesse caso quem chamou NÃO deve fingir que "não tem sessão".
function avisarErroSessao(error, operacao) {
  if (!error) return false;
  const msg = error.message || String(error);
  const tabelaAusente = error.code === 'PGRST205' || error.code === '42P01' || /schema cache|does not exist/i.test(msg);
  if (tabelaAusente) {
    if (!_avisouTabelaAusente) {
      _avisouTabelaAusente = true;
      console.error(`⚠️  Tabela app_sessions ainda não existe no Supabase — sessão vai continuar caindo a cada deploy até criar a tabela (ver instruções no topo do arquivo). [${operacao}]`, msg);
    }
  } else {
    console.error(`🛑 ERRO REAL ao acessar app_sessions — sessão NÃO está sendo salva/lida, login pode estar quebrado para todo mundo. [${operacao}] code=${error.code||'?'}:`, msg);
  }
  return tabelaAusente;
}

class SupabaseSessionStore extends session.Store {
  get(sid, callback) {
    sb().from('app_sessions').select('sess, expire').eq('sid', sid).maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          const tabelaAusente = avisarErroSessao(error, 'get');
          // "Tabela ainda não existe" é um estado conhecido/esperado (antes da
          // tabela ser criada) — degradar pra "sem sessão" está ok. QUALQUER
          // outro erro (outage passageiro do Supabase, permissão revogada, etc)
          // é propagado como erro real: NÃO fingimos "sessão não encontrada",
          // porque isso derrubaria o login de todo mundo silenciosamente até
          // alguém notar (foi exatamente o incidente que motivou este arquivo).
          return callback(tabelaAusente ? null : error, null);
        }
        if (!data) return callback(null, null);
        if (new Date(data.expire) < new Date()) {
          this.destroy(sid, () => {});
          return callback(null, null);
        }
        callback(null, data.sess);
      })
      .catch(err => {
        const tabelaAusente = avisarErroSessao(err, 'get');
        callback(tabelaAusente ? null : err, null);
      });
  }

  set(sid, sessionData, callback) {
    const maxAge = (sessionData.cookie && sessionData.cookie.maxAge) || 8 * 60 * 60 * 1000;
    const expire = new Date(Date.now() + maxAge).toISOString();
    sb().from('app_sessions').upsert({ sid, sess: sessionData, expire }, { onConflict: 'sid' })
      .then(({ error }) => { if (error) avisarErroSessao(error, 'set'); callback && callback(null); })
      .catch(err => { avisarErroSessao(err, 'set'); callback && callback(null); });
  }

  destroy(sid, callback) {
    sb().from('app_sessions').delete().eq('sid', sid)
      .then(({ error }) => { if (error) avisarErroSessao(error, 'destroy'); callback && callback(null); })
      .catch(err => { avisarErroSessao(err, 'destroy'); callback && callback(null); });
  }

  touch(sid, sessionData, callback) {
    const maxAge = (sessionData.cookie && sessionData.cookie.maxAge) || 8 * 60 * 60 * 1000;
    const expire = new Date(Date.now() + maxAge).toISOString();
    sb().from('app_sessions').update({ expire }).eq('sid', sid)
      .then(({ error }) => { if (error) avisarErroSessao(error, 'touch'); callback && callback(null); })
      .catch(err => { avisarErroSessao(err, 'touch'); callback && callback(null); });
  }
}

// Limpeza periódica de sessões expiradas (evita a tabela crescer sem fim)
setInterval(() => {
  sb().from('app_sessions').delete().lt('expire', new Date().toISOString())
    .then(({ error }) => { if (error) avisarErroSessao(error, 'limpeza'); })
    .catch(err => avisarErroSessao(err, 'limpeza'));
}, 60 * 60 * 1000); // a cada 1h

// ── USUÁRIOS ──────────────────────────────────────────────────
// Esta lista continua sendo a FONTE DOS METADADOS (nome, módulos, role, home,
// email) — mas a SENHA de verdade agora mora na tabela `usuarios` do Supabase,
// não mais só na variável de ambiente. Isso é o que permite "Esqueci minha
// senha" funcionar: a senha pode mudar em tempo real, sem precisar mexer no
// Railway. Na subida do servidor, sincronizarUsuarios() garante que cada
// usuário exista no Supabase — usando a senha do env var SÓ NA PRIMEIRA VEZ
// (se a pessoa já resetou a própria senha depois, isso nunca é sobrescrito).
function envSenhaHash(key) {
  const v = process.env[key];
  if (!v) console.error(`⚠️  ${key} não configurada no Railway — login deste usuário vai falhar.`);
  return v || null;
}

const USUARIOS = [
  { usuario: 'narcelio',  senhaHashEnv: envSenhaHash('SENHA_NARCELIO'),  email: 'narcelio@impak.com.br',      modulos: ['tyredesk','processos'], nome: 'Narcelio',  role: 'gerente',  displayName: 'Narcelio',  home: '/'           },
  { usuario: 'jean',      senhaHashEnv: envSenhaHash('SENHA_JEAN'),      email: 'jean@impak.com.br',          modulos: ['tyredesk','processos'], nome: 'Jean',      role: 'gerente',  displayName: 'Jean',      home: '/'           },
  { usuario: 'paula',     senhaHashEnv: envSenhaHash('SENHA_PAULA'),     email: 'paula@impak.com.br',         modulos: ['tyredesk','processos'], nome: 'Paula',     role: 'gerente',  displayName: 'Paula',     home: '/processos'  },
  { usuario: 'amanda',    senhaHashEnv: envSenhaHash('SENHA_AMANDA'),    email: 'amanda@findcomex.com.br',    modulos: ['tyredesk','processos'], nome: 'Amanda',    role: 'gerente',  displayName: 'Amanda',    home: '/processos'  },
  { usuario: 'bianca',    senhaHashEnv: envSenhaHash('SENHA_BIANCA'),    email: 'financeiro@impak.com.br',    modulos: ['tyredesk','processos'], nome: 'Bianca',    role: 'gerente',  displayName: 'Bianca',    home: '/processos'  },
  { usuario: 'emanuelly', senhaHashEnv: envSenhaHash('SENHA_EMANUELLY'), email: 'importacao1@impak.com.br',   modulos: ['tyredesk','processos'], nome: 'Emanuelly', role: 'analista', displayName: 'Emanuelly', home: '/processos'  },
  { usuario: 'italo',     senhaHashEnv: envSenhaHash('SENHA_ITALO'),     email: 'fiscal01@impak.com.br',      modulos: ['tyredesk','processos'], nome: 'Italo',     role: 'analista', displayName: 'Italo',     home: '/processos'  },
  { usuario: 'maria',     senhaHashEnv: envSenhaHash('SENHA_MARIA'),     email: 'fiscal@impak.com.br',        modulos: ['tyredesk','processos'], nome: 'Maria',     role: 'analista', displayName: 'Maria',     home: '/processos'  },
  { usuario: 'joyce',     senhaHashEnv: envSenhaHash('SENHA_JOYCE'),     email: 'nfe@impak.com.br',           modulos: ['tyredesk','processos'], nome: 'Joyce',     role: 'analista', displayName: 'Joyce',     home: '/processos'  },
  { usuario: 'neide',     senhaHashEnv: envSenhaHash('SENHA_NEIDE'),     email: 'operacional01@impak.com.br', modulos: ['tyredesk','processos'], nome: 'Neide',     role: 'analista', displayName: 'Neide',     home: '/processos'  },
  { usuario: 'everton',   senhaHashEnv: envSenhaHash('SENHA_EVERTON'),   email: 'administrativo@impak.com.br', modulos: ['tyredesk','processos'], nome: 'Everton',   role: 'analista', displayName: 'Everton',   home: '/processos'  },
  { usuario: 'isabella',  senhaHashEnv: envSenhaHash('SENHA_ISABELLA'),  email: 'operacional@impak.com.br',   modulos: ['tyredesk','processos'], nome: 'Isabella',  role: 'analista', displayName: 'Isabella',  home: '/processos'  },
  { usuario: 'suporte',   senhaHashEnv: envSenhaHash('SENHA_SUPORTE'),   email: 'suporte@impak.com.br',       modulos: ['tyredesk','processos'], nome: 'Suporte',   role: 'gerente',  displayName: 'Suporte',   home: '/'           },
];

// Cache em memória dos usuários carregados do Supabase (recarregado no boot
// e sempre que alguém redefine a senha). O login lê DAQUI, não do array acima.
let _usuariosCache = new Map();

async function sincronizarUsuarios(){
  for(const u of USUARIOS){
    try{
      const { data: existente } = await sb().from('usuarios').select('senha_hash').eq('usuario', u.usuario).maybeSingle();
      const senha_hash = existente ? existente.senha_hash : u.senhaHashEnv;
      if(!senha_hash){
        console.error(`⚠️  Usuário "${u.usuario}" sem senha (nem no Supabase, nem no env var) — login vai falhar.`);
        continue;
      }
      await sb().from('usuarios').upsert({
        usuario: u.usuario, senha_hash, email: u.email, nome: u.nome,
        display_name: u.displayName, role: u.role, modulos: u.modulos, home: u.home,
      }, { onConflict: 'usuario' });
    }catch(e){ console.error(`Erro sincronizando usuário ${u.usuario}:`, e.message); }
  }
  await recarregarCacheUsuarios();
  console.log('✓ Usuários sincronizados com o Supabase:', _usuariosCache.size);
}

async function recarregarCacheUsuarios(){
  const { data, error } = await sb().from('usuarios').select('*');
  if(error){ console.error('Erro ao carregar usuários do Supabase:', error.message); return; }
  _usuariosCache = new Map((data||[]).map(u => [u.usuario, u]));
}

// ── INVALIDAÇÃO DE SESSÃO POR USUÁRIO ─────────────────────────
// Cada usuário tem um "número de versão" da sessão (começa em 1). A sessão
// guarda a versão vigente no momento do login; o middleware auth() compara
// com a versão atual do usuário a cada requisição. Incrementar a versão
// (ex: ao trocar senha, ou via "Forçar logout") invalida instantaneamente
// qualquer sessão antiga daquele usuário, mesmo que o cookie ainda exista
// no navegador da pessoa — sem precisar de um banco de sessões externo.
const _sessaoVersao = new Map(USUARIOS.map(u => [u.usuario, 1]));

function forcarLogoutUsuario(usuario) {
  _sessaoVersao.set(usuario, (_sessaoVersao.get(usuario) || 1) + 1);
}

// ── RATE LIMITING NO LOGIN ────────────────────────────────────
// Proteção simples contra força bruta: no máximo 5 tentativas de login por
// IP a cada 10 minutos. Em memória (sem dependência externa) — suficiente
// para o volume de uso deste sistema; reinicia se o servidor reiniciar,
// o que é aceitável aqui (não é uma defesa contra ataque distribuído).
const _loginTentativas = new Map(); // ip -> [timestamps]
const LOGIN_MAX_TENTATIVAS = 5;
const LOGIN_JANELA_MS = 10 * 60 * 1000;

function rateLimitLogin(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'desconhecido';
  const agora = Date.now();
  const tentativas = (_loginTentativas.get(ip) || []).filter(t => agora - t < LOGIN_JANELA_MS);
  if (tentativas.length >= LOGIN_MAX_TENTATIVAS) {
    const minutosRestantes = Math.ceil((LOGIN_JANELA_MS - (agora - tentativas[0])) / 60000);
    return res.send(loginPage(`Muitas tentativas. Tente novamente em ${minutosRestantes} minuto(s).`, req.body?.destino || '/'));
  }
  tentativas.push(agora);
  _loginTentativas.set(ip, tentativas);
  next();
}
// ── RATE LIMITING GENÉRICO (IA: /api/analisar e /api/chat) ────
// Mesmas ideias do rateLimitLogin acima (em memória, por IP), mas em fábrica
// pra poder configurar limite/janela por endpoint. Protege os proxies pra
// API paga da Anthropic contra uso abusivo/loop de erro no cliente — sem
// isso, qualquer usuário autenticado podia disparar chamadas ilimitadas.
function criarRateLimiter(nome, maxTentativas, janelaMs) {
  const tentativasPorIp = new Map(); // ip -> [timestamps]
  setInterval(() => {
    const agora = Date.now();
    for (const [ip, tentativas] of tentativasPorIp.entries()) {
      const ativas = tentativas.filter(t => agora - t < janelaMs);
      if (ativas.length) tentativasPorIp.set(ip, ativas);
      else tentativasPorIp.delete(ip);
    }
  }, 5 * 60 * 1000).unref?.();

  return function rateLimitMiddleware(req, res, next) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'desconhecido';
    const agora = Date.now();
    const tentativas = (tentativasPorIp.get(ip) || []).filter(t => agora - t < janelaMs);
    if (tentativas.length >= maxTentativas) {
      const minutosRestantes = Math.ceil((janelaMs - (agora - tentativas[0])) / 60000);
      return res.status(429).json({ erro: `Muitas requisições a ${nome}. Tente novamente em ${minutosRestantes} minuto(s).` });
    }
    tentativas.push(agora);
    tentativasPorIp.set(ip, tentativas);
    next();
  };
}
const rateLimitAnalisar = criarRateLimiter('/api/analisar', 20, 10 * 60 * 1000);
const rateLimitChat = criarRateLimiter('/api/chat', 30, 10 * 60 * 1000);

// Limpeza periódica para a memória não crescer indefinidamente
setInterval(() => {
  const agora = Date.now();
  for (const [ip, tentativas] of _loginTentativas.entries()) {
    const ativas = tentativas.filter(t => agora - t < LOGIN_JANELA_MS);
    if (ativas.length) _loginTentativas.set(ip, ativas);
    else _loginTentativas.delete(ip);
  }
}, 5 * 60 * 1000);

// ── MIDDLEWARE ────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
// Necessário para o Express reconhecer conexões como HTTPS mesmo estando
// atrás do proxy do Railway (que termina o SSL antes do container) — sem
// isso, cookie.secure=true bloquearia o cookie de sessão para todo mundo.
app.set('trust proxy', 1);
app.use(session({
  store: new SupabaseSessionStore(),
  secret: process.env.SESSION_SECRET || (() => {
    console.error('⚠️  SESSION_SECRET não configurado no Railway — usando valor temporário gerado neste boot (sessões serão invalidadas a cada deploy, mesmo com o store persistente).');
    return randomBytes(32).toString('hex');
  })(),
  resave: false,
  saveUninitialized: false,
  cookie: { secure: true, maxAge: 8 * 60 * 60 * 1000 },
}));
app.use(express.static(__dirname));

// ── LOGIN PAGE ────────────────────────────────────────────────
const LOGIN_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>IMPAK — Acesso</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#e8f0f8;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:'DM Sans',sans-serif;}
.wrap{width:400px;max-width:94vw;}
.logo-row{display:flex;align-items:center;gap:12px;justify-content:center;margin-bottom:28px;}
.logo-badge{background:#1a7fd4;color:#fff;font-family:'Syne',sans-serif;font-size:22px;font-weight:800;padding:6px 14px;border-radius:6px;letter-spacing:1px;}
.logo-sub{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#4a6480;letter-spacing:2px;text-transform:uppercase;}
.box{background:#fff;border:1px solid #c8d8e8;border-top:3px solid #1a7fd4;border-radius:14px;padding:36px 32px;box-shadow:0 8px 32px rgba(26,127,212,.1);}
h1{font-family:'Syne',sans-serif;font-size:17px;font-weight:700;color:#0d1e2e;text-align:center;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;}
.sub{font-size:11px;color:#1a7fd4;text-align:center;font-weight:600;letter-spacing:1px;text-transform:uppercase;margin-bottom:28px;}
label{display:block;font-size:10px;font-weight:700;color:#4a6480;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;}
input{width:100%;background:#dce8f5;border:1px solid #c8d8e8;border-radius:7px;color:#0d1e2e;font-family:'DM Sans',sans-serif;font-size:14px;padding:11px 14px;outline:none;transition:all .15s;margin-bottom:16px;}
input:focus{border-color:#1a7fd4;background:#c8ddf0;}
button{width:100%;background:#1a7fd4;border:none;border-radius:7px;color:#fff;font-family:'Syne',sans-serif;font-size:15px;font-weight:700;padding:12px;cursor:pointer;letter-spacing:.5px;text-transform:uppercase;transition:background .15s;margin-top:4px;}
button:hover{background:#1567b8;}
.err{background:rgba(192,57,43,.08);border:1px solid rgba(192,57,43,.25);border-radius:6px;padding:10px 14px;font-size:12px;color:#c0392b;font-weight:600;text-align:center;margin-bottom:16px;}
.footer{text-align:center;margin-top:18px;font-size:10px;color:#a8bfd4;}
</style>
</head>
<body>
<div class="wrap">
  <div class="logo-row">
    <div class="logo-badge">IMPAK</div>
    <div class="logo-sub">Portal</div>
  </div>
  <div class="box">
    <h1>Acesso ao Sistema</h1>
    <div class="sub">TyreDesk + Gestão de Processos</div>
    ERRO_PLACEHOLDER
    <form method="POST" action="/login">
      <label>Usuário ou e-mail</label>
      <input name="usuario" type="text" placeholder="seu usuário ou e-mail" autocomplete="username" required autofocus>
      <label>Senha</label>
      <input name="senha" type="password" placeholder="sua senha" autocomplete="current-password" required>
      <input type="hidden" name="destino" value="DESTINO_PLACEHOLDER">
      <button type="submit">Entrar</button>
    </form>
    <div style="text-align:center;margin-top:14px;">
      <a href="/esqueci-senha" style="font-size:12px;color:#1a7fd4;text-decoration:none;font-weight:600;">Esqueci minha senha</a>
    </div>
    <div class="footer">IMPAK Comercial Importadora · Portal v2.0 · Confidencial</div>
  </div>
</div>
</body>
</html>`;

function loginPage(erro, destino) {
  const destinoSeguro = sanitizeDestino(destino);
  return LOGIN_HTML
    .replace('ERRO_PLACEHOLDER', erro ? `<div class="err">${escapeHtml(erro)}</div>` : '')
    .replace('DESTINO_PLACEHOLDER', escapeHtml(destinoSeguro));
}

// Mesmo CSS da tela de login (extraído do LOGIN_HTML) — reaproveitado aqui
// pra manter a identidade visual sem duplicar o bloco <style> inteiro.
const AUTH_CSS = LOGIN_HTML.slice(LOGIN_HTML.indexOf('<style>'), LOGIN_HTML.indexOf('</style>')+8);

function esqueciSenhaPage(){
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>IMPAK — Esqueci minha senha</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
${AUTH_CSS}
</head>
<body>
<div class="wrap">
  <div class="logo-row"><div class="logo-badge">IMPAK</div><div class="logo-sub">Portal</div></div>
  <div class="box">
    <h1>Esqueci minha senha</h1>
    <div class="sub">Digite seu usuário ou e-mail</div>
    <div id="msg"></div>
    <label>Usuário ou e-mail</label>
    <input id="identificador" type="text" placeholder="ex: narcelio ou narcelio@impak.com.br" autofocus>
    <button onclick="enviar()">Enviar link de redefinição</button>
    <div style="text-align:center;margin-top:14px;">
      <a href="/login" style="font-size:12px;color:#1a7fd4;text-decoration:none;font-weight:600;">Voltar pro login</a>
    </div>
    <div class="footer">IMPAK Comercial Importadora · Portal v2.0 · Confidencial</div>
  </div>
</div>
<script>
async function enviar(){
  const identificador = document.getElementById('identificador').value.trim();
  const msg = document.getElementById('msg');
  if(!identificador){ msg.innerHTML = '<div class="err">Digite seu usuário ou e-mail.</div>'; return; }
  const btn = document.querySelector('button');
  btn.disabled = true; btn.textContent = 'Enviando...';
  try{
    const r = await fetch('/api/auth/esqueci-senha', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ identificador })
    });
    const d = await r.json();
    msg.innerHTML = '<div style="background:rgba(26,127,212,.08);border:1px solid rgba(26,127,212,.25);border-radius:6px;padding:12px 14px;font-size:12px;color:#1a7fd4;font-weight:600;text-align:center;margin-bottom:16px;">'+d.mensagem+'</div>';
    document.getElementById('identificador').value = '';
  }catch(e){
    msg.innerHTML = '<div class="err">Erro ao enviar. Tente novamente.</div>';
  }
  btn.disabled = false; btn.textContent = 'Enviar link de redefinição';
}
document.getElementById('identificador').addEventListener('keydown', e=>{ if(e.key==='Enter') enviar(); });
</script>
</body>
</html>`;
}

function redefinirSenhaPage(tokenValido){
  if(!tokenValido){
    return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>IMPAK — Link inválido</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
${AUTH_CSS}
</head><body><div class="wrap">
  <div class="logo-row"><div class="logo-badge">IMPAK</div><div class="logo-sub">Portal</div></div>
  <div class="box">
    <h1>Link expirado ou inválido</h1>
    <div class="err">Esse link de redefinição não é mais válido. Peça um novo.</div>
    <a href="/esqueci-senha"><button type="button">Pedir novo link</button></a>
  </div>
</div></body></html>`;
  }
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>IMPAK — Definir nova senha</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
${AUTH_CSS}
</head>
<body>
<div class="wrap">
  <div class="logo-row"><div class="logo-badge">IMPAK</div><div class="logo-sub">Portal</div></div>
  <div class="box">
    <h1>Definir nova senha</h1>
    <div class="sub">Mínimo de 6 caracteres</div>
    <div id="msg"></div>
    <label>Nova senha</label>
    <input id="novaSenha" type="password" placeholder="nova senha" autofocus>
    <label>Confirmar nova senha</label>
    <input id="confirmar" type="password" placeholder="repita a nova senha">
    <button onclick="salvar()">Salvar nova senha</button>
    <div class="footer">IMPAK Comercial Importadora · Portal v2.0 · Confidencial</div>
  </div>
</div>
<script>
async function salvar(){
  const novaSenha = document.getElementById('novaSenha').value;
  const confirmar = document.getElementById('confirmar').value;
  const msg = document.getElementById('msg');
  if(novaSenha.length < 6){ msg.innerHTML = '<div class="err">A senha precisa ter pelo menos 6 caracteres.</div>'; return; }
  if(novaSenha !== confirmar){ msg.innerHTML = '<div class="err">As senhas não são iguais.</div>'; return; }
  const btn = document.querySelector('button');
  btn.disabled = true; btn.textContent = 'Salvando...';
  try{
    const r = await fetch('/api/auth/redefinir-senha', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ token: new URLSearchParams(location.search).get('token'), novaSenha })
    });
    const d = await r.json();
    if(d.ok){
      msg.innerHTML = '<div style="background:rgba(22,163,74,.08);border:1px solid rgba(22,163,74,.25);border-radius:6px;padding:12px 14px;font-size:12px;color:#16a34a;font-weight:600;text-align:center;margin-bottom:16px;">✓ Senha alterada! Redirecionando pro login...</div>';
      setTimeout(()=>location.href='/login', 1500);
    } else {
      msg.innerHTML = '<div class="err">'+(d.erro||'Erro ao salvar.')+'</div>';
      btn.disabled = false; btn.textContent = 'Salvar nova senha';
    }
  }catch(e){
    msg.innerHTML = '<div class="err">Erro ao salvar. Tente novamente.</div>';
    btn.disabled = false; btn.textContent = 'Salvar nova senha';
  }
}
</script>
</body>
</html>`;
}

// ── AUTENTICAÇÃO ──────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session.usuario) return res.redirect(sanitizeDestino(req.query.destino));
  res.send(loginPage('', req.query.destino));
});

app.post('/login', rateLimitLogin, (req, res) => {
  const { usuario, senha, destino } = req.body;
  const login = (usuario || '').trim().toLowerCase();
  // Aceita tanto o usuário curto (ex: "emanuelly") quanto o e-mail
  // cadastrado (ex: "importacao1@impak.com.br") no mesmo campo — mesma
  // lógica de busca já usada em /api/auth/esqueci-senha. Sem isso, quem
  // digitasse o e-mail (rotulado como "Login" na planilha de cadastro)
  // caía em "usuário ou senha incorretos" mesmo com a senha certa.
  const u = _usuariosCache.get(login) || [..._usuariosCache.values()].find(x => (x.email||'').toLowerCase() === login);
  if (!u || !u.senha_hash || !verificarSenha(senha || '', u.senha_hash)) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'desconhecido';
    // Nunca logar a senha digitada, mesmo errada — só o usuário tentado, o
    // IP, e o horário, suficiente para notar um padrão de ataque sem criar
    // outro vazamento de dado sensível dentro dos próprios logs.
    console.warn(`[LOGIN FALHOU] usuário="${login}" ip=${ip} em ${new Date().toISOString()}`);
    return res.send(loginPage('Usuário ou senha incorretos.', destino || '/'));
  }
  req.session.usuario     = u.usuario;
  req.session.nome        = u.nome;
  req.session.modulos     = u.modulos;
  req.session.role        = u.role;
  req.session.displayName = u.display_name;
  // A senha (nem em hash) nunca é guardada na sessão — ela só precisa
  // existir no momento do login. Guardá-la aqui não tem uso real e só
  // criava o risco de ser devolvida de volta ao navegador via /api/me.
  req.session.versao      = _sessaoVersao.get(u.usuario) || 1;
  req.session.home        = u.home || '/';
  const destinoSeguro = sanitizeDestino(destino);
  res.redirect(destinoSeguro !== '/' ? destinoSeguro : (u.home || '/'));
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

// ── ENVIO DE E-MAIL (Resend) ────────────────────────────────────
// RESEND_API_KEY precisa estar configurada no Railway. RESEND_FROM é
// opcional — se não configurada, usa o domínio sandbox do Resend (só
// funciona pra testes, pra produção precisa verificar impak.com.br no
// painel do Resend e configurar RESEND_FROM=algo@impak.com.br).
async function enviarEmail(destinatario, assunto, html){
  const apiKey = process.env.RESEND_API_KEY;
  if(!apiKey) throw new Error('RESEND_API_KEY não configurada no Railway');
  const from = process.env.RESEND_FROM || 'IMPAK Portal <onboarding@resend.dev>';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [destinatario], subject: assunto, html }),
  });
  if(!r.ok){
    const erro = await r.text();
    throw new Error(`Resend respondeu ${r.status}: ${erro}`);
  }
  return await r.json();
}

// ── ESQUECI MINHA SENHA ──────────────────────────────────────────
// Fluxo: usuário pede reset (por usuário ou e-mail) → gera token aleatório,
// válido por 1h, salvo no Supabase → manda e-mail com link → usuário abre
// o link, define senha nova → token é invalidado e todas as sessões antigas
// daquele usuário são derrubadas (mesmo mecanismo do "Forçar logout").
//
// Sempre responde com a MESMA mensagem de sucesso, exista ou não o usuário/
// e-mail digitado — evita que alguém descubra quais usuários existem no
// sistema só testando e-mails aqui.
app.get('/esqueci-senha', (req, res) => {
  res.send(esqueciSenhaPage());
});

app.post('/api/auth/esqueci-senha', rateLimitLogin, async (req, res) => {
  const identificador = (req.body.identificador || '').trim().toLowerCase();
  const mensagemGenerica = { ok: true, mensagem: 'Se esse usuário ou e-mail existir, um link de redefinição foi enviado.' };
  if(!identificador) return res.json(mensagemGenerica);
  try{
    await recarregarCacheUsuarios();
    const u = [..._usuariosCache.values()].find(x => x.usuario === identificador || (x.email||'').toLowerCase() === identificador);
    if(!u) return res.json(mensagemGenerica); // não revela se existe ou não

    const token = randomBytes(32).toString('hex');
    const expira = new Date(Date.now() + 60*60*1000); // 1 hora
    // Só o hash do token é persistido — ver hashToken() acima.
    await sb().from('usuarios').update({ reset_token: hashToken(token), reset_token_expira: expira.toISOString() }).eq('usuario', u.usuario);
    await recarregarCacheUsuarios();

    const link = `${req.protocol}://${req.get('host')}/redefinir-senha?token=${token}`;
    await enviarEmail(u.email, 'Redefinir senha — IMPAK Portal',
      `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <h2 style="color:#1a7fd4;">IMPAK Portal</h2>
        <p>Olá, ${u.nome || u.usuario}. Foi solicitada a redefinição da sua senha.</p>
        <p><a href="${link}" style="background:#1a7fd4;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block;">Redefinir minha senha</a></p>
        <p style="font-size:12px;color:#666;">Esse link expira em 1 hora. Se você não pediu isso, pode ignorar este e-mail com segurança — sua senha não vai mudar.</p>
      </div>`
    );
    res.json(mensagemGenerica);
  } catch(e){
    console.error('Erro no esqueci-senha:', e.message);
    // Mesmo em erro interno, não expõe detalhe pro usuário final — só loga.
    res.json(mensagemGenerica);
  }
});

app.get('/redefinir-senha', async (req, res) => {
  const token = req.query.token || '';
  try{
    await recarregarCacheUsuarios();
    const u = buscarUsuarioPorTokenReset(token);
    const valido = u && u.reset_token_expira && new Date(u.reset_token_expira) > new Date();
    res.send(redefinirSenhaPage(valido ? token : null));
  } catch(e){
    res.send(redefinirSenhaPage(null));
  }
});

app.post('/api/auth/redefinir-senha', rateLimitLogin, async (req, res) => {
  try{
    const { token, novaSenha } = req.body;
    if(!token || !novaSenha || novaSenha.length < 6){
      return res.json({ ok: false, erro: 'Senha precisa ter pelo menos 6 caracteres.' });
    }
    await recarregarCacheUsuarios();
    const u = buscarUsuarioPorTokenReset(token);
    if(!u || !u.reset_token_expira || new Date(u.reset_token_expira) <= new Date()){
      return res.json({ ok: false, erro: 'Link expirado ou inválido. Peça um novo.' });
    }
    const novoHash = hashSenha(novaSenha);
    await sb().from('usuarios').update({
      senha_hash: novoHash, reset_token: null, reset_token_expira: null,
    }).eq('usuario', u.usuario);
    await recarregarCacheUsuarios();
    forcarLogoutUsuario(u.usuario); // derruba qualquer sessão antiga com a senha velha
    res.json({ ok: true });
  } catch(e){
    console.error('Erro ao redefinir senha:', e.message);
    res.json({ ok: false, erro: 'Erro interno. Tente novamente.' });
  }
});

// Força o logout de um usuário em TODOS os dispositivos/sessões abertas —
// útil ao trocar a senha de alguém, ou se houver suspeita de acesso
// indevido (ex: notebook perdido). Restrito a gerentes.
app.post('/api/usuarios/:usuario/forcar-logout', (req, res) => {
  if (!req.session.usuario) return res.status(401).json({ ok: false, erro: 'Não autenticado' });
  if (req.session.role !== 'gerente') return res.status(403).json({ ok: false, erro: 'Apenas gerentes podem fazer isso' });
  const alvo = (req.params.usuario || '').trim().toLowerCase();
  if (!USUARIOS.some(u => u.usuario === alvo)) return res.status(404).json({ ok: false, erro: 'Usuário não encontrado' });
  forcarLogoutUsuario(alvo);
  res.json({ ok: true, mensagem: `Todas as sessões de "${alvo}" foram invalidadas.` });
});

// Recarrega o cache de usuários (_usuariosCache) sob demanda. Necessário
// sempre que alguém edita senha_hash (ou qualquer outro campo de usuários)
// direto no Supabase via SQL — sem isso, o processo rodando continua com
// os dados antigos em memória até o próximo restart/deploy. Restrito a
// gerentes, e sujeito ao mesmo rate limit do login (evita brute-force via
// esse endpoint também).
app.post('/api/admin/recarregar-cache', rateLimitLogin, (req, res) => {
  if (!req.session.usuario) return res.status(401).json({ ok: false, erro: 'Não autenticado' });
  if (req.session.role !== 'gerente') return res.status(403).json({ ok: false, erro: 'Apenas gerentes podem fazer isso' });
  recarregarCacheUsuarios()
    .then(() => res.json({ ok: true, mensagem: `Cache recarregado (${_usuariosCache.size} usuários).` }))
    .catch(e => {
      console.error('Erro ao recarregar cache de usuários:', e.message);
      res.status(500).json({ ok: false, erro: 'Erro ao recarregar cache.' });
    });
});

function auth(modulo) {
  return (req, res, next) => {
    if (!req.session.usuario) return res.redirect('/login?destino=' + req.path);
    // Se a versão da sessão estiver desatualizada (alguém forçou logout
    // deste usuário, ex: ao trocar a senha), invalida mesmo com cookie válido.
    const versaoAtual = _sessaoVersao.get(req.session.usuario) || 1;
    if (req.session.versao !== versaoAtual) {
      return req.session.destroy(() => res.redirect('/login?destino=' + req.path));
    }
    if (modulo && !req.session.modulos.includes(modulo)) return res.status(403).send('<h2>Acesso negado</h2>');
    next();
  };
}

// Restringe exclusões (DELETE) a usuários com role "gerente". Antes, qualquer
// usuário do módulo "processos"/"tyredesk" podia excluir permanentemente
// processos, contatos, cotações e arquivos de outros — só o "forçar logout"
// era restrito a gerente. Usar SEMPRE depois de auth(modulo) na cadeia de
// middlewares (auth() já garante req.session.usuario/role existirem).
function requireGerente(req, res, next) {
  if (req.session.role !== 'gerente') {
    return res.status(403).json({ ok: false, erro: 'Apenas gerentes podem excluir.' });
  }
  next();
}

// ── PÁGINAS ───────────────────────────────────────────────────
app.get('/',          auth('tyredesk'),  (req, res) => res.sendFile(path.join(__dirname, 'tyredesk.html')));
app.get('/processos', auth('processos'), (req, res) => res.sendFile(path.join(__dirname, 'processos.html')));

// ── API: SESSÃO ───────────────────────────────────────────────
app.get('/api/me', (req, res) => {
  if (!req.session.usuario) return res.json({ logado: false });
  res.json({
    logado:      true,
    usuario:     req.session.usuario,
    nome:        req.session.nome,
    modulos:     req.session.modulos,
    role:        req.session.role,
    displayName: req.session.displayName,
  });
});

// ── API: CONFERÊNCIA ──────────────────────────────────────────
app.get('/api/conferencia/index', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('conferencia_processos')
      .select('id, ref, exportador, obs, status, data, created_by, updated_at, dados')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    const index = (data || []).map(p => ({
      id:           p.id,
      ref:          p.ref        || '',
      exportador:   p.exportador || '',
      obs:          p.obs        || '',
      status:       p.status     || 'ok',
      data:         p.data       || '',
      _user:        p.created_by || '',
      _updatedAt:   new Date(p.updated_at).getTime(),
      _divResolvedMap: (p.dados && p.dados._divResolvedMap) ? p.dados._divResolvedMap : {},
      analises:     (p.dados && p.dados.analises) ? p.dados.analises.map(a => ({
        id: a.id, data: a.data, docs: a.docs, resumo: a.resumo,
        grupos: a.grupos || [],
        alertas: a.alertas || [],
      })) : [],
    }));
    console.log(`/api/conferencia/index: ${index.length} processos`);
    res.json({ ok: true, index, total: index.length });
  } catch (e) {
    console.error('conferencia/index erro:', e.message);
    res.json({ ok: true, index: [], total: 0 });
  }
});

app.get('/api/conferencia/processo/:id', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('conferencia_processos')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    if (!data) return res.json({ ok: false, processo: null });
    const proc = { ...data.dados, id: data.id, ref: data.ref,
      exportador: data.exportador, obs: data.obs, status: data.status,
      data: data.data, _user: data.created_by,
      _updatedAt: new Date(data.updated_at).getTime() };
    res.json({ ok: true, processo: proc });
  } catch (e) {
    console.error('conferencia/processo GET erro:', e.message);
    res.json({ ok: false, processo: null });
  }
});

app.post('/api/conferencia/processo', auth('processos'), async (req, res) => {
  try {
    const { processo } = req.body;
    if (!processo || !processo.id) return res.status(400).json({ erro: 'Processo inválido' });
    const row = {
      id:         processo.id,
      ref:        processo.ref        || '',
      exportador: processo.exportador || '',
      obs:        processo.obs        || '',
      status:     processo.status     || 'ok',
      data:       processo.data       || new Date().toLocaleDateString('pt-BR'),
      created_by: processo._user      || req.session.usuario,
      updated_by: req.session.usuario,
      updated_at: new Date().toISOString(),
      dados:      processo,
    };
    const { error } = await sb()
      .from('conferencia_processos')
      .upsert(row, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    console.log(`conferencia salvo: ${processo.ref} por ${req.session.usuario}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('conferencia/processo POST erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

app.delete('/api/conferencia/processo/:id', auth('processos'), requireGerente, async (req, res) => {
  try {
    const { error } = await sb()
      .from('conferencia_processos')
      .delete()
      .eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (e) {
    console.error('conferencia/processo DELETE erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// ── API: CONTROLE v2 ──────────────────────────────────────────
app.get('/controle', auth('processos'), (req, res) => res.sendFile(path.join(__dirname, 'controle_v2.html')));
// "Tela exclusiva" do Dashboard Financeiro — serve o MESMO controle_v2.html
// (o front-end detecta location.pathname==='/financeiro' e ajusta o que
// aparece na tela). Evita duplicar toda a lógica de abrir/editar processo,
// upload de documentos, autocomplete de contatos etc. num arquivo separado
// que rapidamente ficaria desatualizado em relação ao Controle de verdade.
app.get('/financeiro', auth('processos'), (req, res) => res.sendFile(path.join(__dirname, 'controle_v2.html')));
// "Tela exclusiva" do Dashboard Resultado (lucro estimado x real de todos
// os processos) — mesmo esquema do /financeiro acima: serve o MESMO
// controle_v2.html, e o front-end detecta location.pathname==='/resultado'
// pra abrir direto no Dashboard Resultado (ver ativarTelaResultadoExclusiva
// em controle-core.js).
app.get('/resultado', auth('processos'), (req, res) => res.sendFile(path.join(__dirname, 'controle_v2.html')))
// "Tela exclusiva" do Dashboard Narcélio (visão do dono da empresa) —
// diferente de /financeiro e /resultado (visíveis a qualquer usuário com o
// módulo "processos"), aqui o back-end também confere o usuário logado:
// containers em água, faturamento e previsão de caixa são dados sensíveis
// que não devem ficar visíveis pra todo mundo que usa o Controle. Ver
// renderDashNarcelio() em controle-dash-narcelio.js e
// ativarTelaNarcelioExclusiva() em controle-core.js.
app.get('/narcelio', auth('processos'), (req, res) => {
  if (!['narcelio', 'suporte'].includes(req.session.usuario)) return res.status(403).send('Acesso restrito.')
  res.sendFile(path.join(__dirname, 'controle_v2.html'))
});
// Deep-link por processo — /controle/UD26-005 serve o mesmo controle_v2.html;
// o front-end lê location.pathname no load e abre o painel lateral do
// processo correspondente automaticamente (ver abrirProcessoPorURL()).
app.get('/controle/:ref', auth('processos'), (req, res) => res.sendFile(path.join(__dirname, 'controle_v2.html')));
app.get('/calculador', auth('tyredesk'), (req, res) => res.sendFile(path.join(__dirname, 'calculador.html'), {headers:{'Content-Type':'text/html; charset=utf-8'}}));

app.get('/api/controle/v2/processos', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_processos')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    res.json({ ok: true, processos: data || [] });
  } catch (e) {
    console.error('controle v2 GET erro:', e.message);
    res.json({ ok: true, processos: [] });
  }
});

app.post('/api/controle/v2/importar', auth('processos'), async (req, res) => {
  try {
    const { processos } = req.body;
    if (!processos || !processos.length) return res.json({ ok: true, total: 0 });
    const agora = new Date().toISOString();

    // Buscar referências já existentes para evitar duplicatas
    const refs = processos.map(p => p.referencia).filter(Boolean);
    const { data: existentes } = await sb()
      .from('controle_processos')
      .select('id, referencia')
      .in('referencia', refs);

    const refsExistentes = new Set((existentes||[]).map(e => e.referencia));

    // Só inserir os que não existem
    const novos = processos
      .filter(p => p.referencia && !refsExistentes.has(p.referencia))
      .map(p => ({
        ...p,
        id: p.id || gerarUUID(),
        updated_at: agora,
        created_at: p.created_at || agora,
      }));

    if (!novos.length) {
      return res.json({ ok: true, total: 0, msg: 'Todos os processos já existem' });
    }

    // Inserir em lotes de 50
    for (let i = 0; i < novos.length; i += 50) {
      const { error } = await sb()
        .from('controle_processos')
        .insert(novos.slice(i, i + 50));
      if (error) throw new Error(error.message);
    }

    console.log(`controle v2 importar: ${novos.length} novos de ${processos.length} por ${req.session.usuario}`);
    res.json({ ok: true, total: novos.length, ignorados: processos.length - novos.length });
  } catch (e) {
    console.error('controle v2 importar erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

app.post('/api/controle/v2/processo', auth('processos'), async (req, res) => {
  try {
    const { processo } = req.body;
    if (!processo) return res.status(400).json({ erro: 'Processo ausente' });
    // Referência só é obrigatória ao CRIAR (sem id ainda) — em edições
    // parciais (ver controle_v2.html: coletarESalvar/salvarProcesso agora
    // manda só os campos que o usuário de fato alterou, pra não sobrescrever
    // edições concorrentes de outro usuário) o payload pode legitimamente
    // não incluir "referencia" se ela não foi um dos campos alterados.
    if (!processo.id && !processo.referencia) return res.status(400).json({ erro: 'Referência obrigatória' });

    // ── TRAVA DE PROCESSO ("Fechar Processo") ────────────────────────
    // Depois de conferido, o processo pode ser fechado (ver botão 🔒 no
    // painel do processo) pra impedir que NF, custos reais, lucro etc.
    // mudem por engano — trava o processo INTEIRO, não só os campos
    // financeiros, porque é mais simples e mais previsível do que travar
    // campo a campo. Isso é reforçado aqui no servidor (não só escondido/
    // desabilitado no front-end) porque a trava só vale alguma coisa se
    // não der pra contornar chamando a API direto.
    if (processo.id) {
      const { data: atual } = await sb()
        .from('controle_processos')
        .select('fechado')
        .eq('id', processo.id)
        .maybeSingle();
      const estavaFechado = !!(atual && atual.fechado);
      const tentandoDestravar = estavaFechado && processo.fechado === false;
      const tentandoTravar    = !estavaFechado && processo.fechado === true;

      if (estavaFechado && !tentandoDestravar) {
        return res.status(403).json({ erro: 'Processo fechado — reabra para editar (só gerente pode reabrir).' });
      }
      if (tentandoDestravar && req.session.role !== 'gerente') {
        return res.status(403).json({ erro: 'Só um gerente pode reabrir um processo fechado.' });
      }
      // fechado_em/fechado_por são registrados pelo servidor, nunca aceitos
      // direto do cliente — evita que alguém finja ter travado/destravado
      // em outro momento ou como outro usuário.
      if (tentandoTravar) {
        processo.fechado_em = new Date().toISOString();
        processo.fechado_por = req.session.usuario;
      } else if (tentandoDestravar) {
        processo.fechado_em = null;
        processo.fechado_por = null;
      } else {
        delete processo.fechado; // não deixa alterar a trava por acidente num save comum
      }
    }

    if (!processo.id) processo.id = gerarUUID();
    processo.updated_at = new Date().toISOString();

    // Log de auditoria no banco
    const logEntries = (processo.log || []).filter(l => !l._saved);
    if (logEntries.length) {
      const rows = logEntries.map(l => ({
        processo_id: processo.id,
        usuario: l.usuario || req.session.usuario,
        campo: l.campo || '',
        valor_antes: String(l.valor_antes || ''),
        valor_depois: String(l.valor_depois || ''),
        created_at: l.created_at || new Date().toISOString(),
      }));
      try {
        await sb().from('controle_log').insert(rows);
      } catch(logErr) {
        console.warn('log erro:', logErr.message);
      }
      processo.log = (processo.log || []).map(l => ({ ...l, _saved: true }));
    }

    // Remover campos internos antes de salvar no banco
    const { log: _log, _fasePrevista, _savedAt, ...processoLimpo } = processo;

    const { error } = await sb()
      .from('controle_processos')
      .upsert(processoLimpo, { onConflict: 'id' });
    if (error) throw new Error(error.message);

    // Criar notificação de demurrage se necessário
    if (processo.demurrage_vencimento) {
      const venc = new Date(processo.demurrage_vencimento);
      const dias = Math.ceil((venc - new Date()) / 86400000);
      if (dias <= 5 && dias >= 0 && !processo.data_devolucao_vazio) {
        try {
          await sb().from('controle_notificacoes').insert({
            processo_id: processo.id,
            tipo: 'urgente',
            titulo: `Demurrage: ${processo.referencia}`,
            mensagem: `Container vence em ${dias} dia(s)!`,
            created_by: req.session.usuario,
          });
        } catch(notifErr) {
          console.warn('notificacao erro:', notifErr.message);
        }
      }
    }

    console.log(`controle v2 salvo: ${processo.referencia} por ${req.session.usuario}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('controle v2 POST erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// Histórico de alterações de um processo — faltava esta rota: o front-end
// (controle_v2.html) já chamava GET /api/controle/v2/processo/:id/log desde
// sempre, mas como a rota nunca existiu, a aba "Histórico" sempre recebia
// 404 e mostrava "sem histórico" mesmo com registros salvos normalmente na
// tabela controle_log (o insert em POST /api/controle/v2/processo sempre
// funcionou — só faltava como ler de volta).
app.get('/api/controle/v2/processo/:id/log', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_log')
      .select('usuario, campo, valor_antes, valor_depois, created_at')
      .eq('processo_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    res.json({ ok: true, log: data || [] });
  } catch (e) {
    console.error('controle v2 log erro:', e.message);
    res.json({ ok: true, log: [] });
  }
});

app.delete('/api/controle/v2/processo/:id', auth('processos'), requireGerente, async (req, res) => {
  try {
    const { error } = await sb().from('controle_processos').delete().eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

app.get('/api/controle/v2/notificacoes', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_notificacoes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    res.json({ ok: true, notificacoes: data || [] });
  } catch (e) {
    res.json({ ok: true, notificacoes: [] });
  }
});

app.post('/api/controle/v2/notificacao', auth('processos'), async (req, res) => {
  try {
    const { processo_id, tipo, titulo, mensagem } = req.body;
    await sb().from('controle_notificacoes').insert({
      processo_id, tipo, titulo, mensagem, created_by: req.session.usuario,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

app.post('/api/controle/v2/notificacao/:id/lida', auth('processos'), async (req, res) => {
  try {
    const { usuario } = req.body;
    const { data } = await sb().from('controle_notificacoes').select('lida_por').eq('id', req.params.id).single();
    const lidaPor = [...(data?.lida_por || [])];
    if (!lidaPor.includes(usuario)) lidaPor.push(usuario);
    await sb().from('controle_notificacoes').update({ lida_por: lidaPor }).eq('id', req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});


app.get('/api/controle/index', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_processos')
      .select('id, referencia, cliente, fase, status, updated_at, dados')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    const index = (data || []).map(p => {
      const d = p.dados || {};
      return {
        id: p.id, referencia: p.referencia, cliente: p.cliente,
        fase: p.fase, status: p.status,
        exportador: d.exportador||'', eta: d.eta||'',
        data_chegada: d.data_chegada||'', data_embarque: d.data_embarque||'',
        porto: d.porto||'', armador: d.armador||'', free_time: d.free_time||21,
        canal_parametrizacao: d.canal_parametrizacao||'', hbl: d.hbl||'',
        numero_di: d.numero_di||'', data_presenca: d.data_presenca||'',
        data_retirada: d.data_retirada||'', data_ric: d.data_ric||'',
        navio: d.navio||'', previsao_prontidao: d.previsao_prontidao||'',
        agente: d.agente||'', despachante: d.despachante||'',
        produtos: d.produtos||'', quant_containers: d.quant_containers||'',
        _updatedAt: new Date(p.updated_at).getTime(),
      };
    });
    res.json({ ok: true, index, processos: index, total: index.length });
  } catch (e) {
    console.error('controle/index erro:', e.message);
    res.json({ ok: true, index: [], processos: [], total: 0 });
  }
});

app.get('/api/controle/processo/:id', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_processos')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    if (!data) return res.json({ ok: false, processo: null });
    const proc = { ...data.dados, id: data.id, referencia: data.referencia,
      cliente: data.cliente, fase: data.fase };
    res.json({ ok: true, processo: proc });
  } catch (e) {
    console.error('controle/processo GET erro:', e.message);
    res.json({ ok: false, processo: null });
  }
});

app.post('/api/controle/processo', auth('processos'), async (req, res) => {
  try {
    const { processo } = req.body;
    if (!processo || !processo.id) return res.status(400).json({ erro: 'Processo inválido' });
    const row = {
      id:         processo.id,
      referencia: processo.referencia || '',
      cliente:    processo.cliente    || '',
      fase:       processo.fase       || 'PRODUCAO',
      status:     processo.status     || 'ativo',
      updated_by: req.session.usuario,
      updated_at: new Date().toISOString(),
      dados:      processo,
    };
    const { error } = await sb()
      .from('controle_processos')
      .upsert(row, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    console.log(`controle salvo: ${processo.referencia} por ${req.session.usuario}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('controle/processo POST erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

app.delete('/api/controle/processo/:id', auth('processos'), requireGerente, async (req, res) => {
  try {
    const { error } = await sb()
      .from('controle_processos')
      .delete()
      .eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (e) {
    console.error('controle/processo DELETE erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

app.post('/api/controle/importar', auth('processos'), async (req, res) => {
  try {
    const { processos } = req.body;
    if (!processos || !processos.length) return res.json({ ok: true, total: 0 });

    const agora = new Date().toISOString();

    // Buscar referências já existentes
    const refs = processos.map(p => p.referencia).filter(Boolean);
    const { data: existentes } = await sb()
      .from('controle_processos')
      .select('referencia')
      .in('referencia', refs);
    const refsExistentes = new Set((existentes||[]).map(e => e.referencia));

    const novos = processos
      .filter(p => p.referencia && !refsExistentes.has(p.referencia))
      .map(p => {
        // Suportar tanto formato antigo (com dados{}) quanto novo (campos diretos)
        const d = p.dados || p;
        return {
          id:                  p.id || gerarUUID(),
          referencia:          p.referencia || d.referencia || '',
          fornecedor:          d.fornecedor  || '',
          cliente:             d.cliente     || p.cliente || '',
          produto:             d.produto     || '',
          fase:                d.fase        || p.fase || 'PI',
          eta:                 d.eta         || null,
          etd:                 d.etd         || null,
          data_embarque:       d.data_embarque || null,
          data_chegada:        d.data_chegada  || null,
          data_presenca:       d.data_presenca || null,
          armador:             d.armador     || '',
          navio:               d.navio       || '',
          container:           d.container   || '',
          hbl:                 d.hbl         || '',
          mbl:                 d.mbl         || '',
          numero_di:           d.numero_di   || '',
          obs:                 d.obs         || '',
          free_time:           d.free_time   || 21,
          demurrage_vencimento: d.demurrage_vencimento || null,
          created_by:          p.created_by || req.session.usuario,
          updated_by:          req.session.usuario,
          updated_at:          agora,
          created_at:          p.created_at || agora,
        };
      });

    if (!novos.length) {
      return res.json({ ok: true, total: 0, msg: 'Todos já existem' });
    }

    for (let i = 0; i < novos.length; i += 50) {
      const { error } = await sb()
        .from('controle_processos')
        .insert(novos.slice(i, i + 50));
      if (error) throw new Error(error.message);
    }

    console.log(`controle/importar: ${novos.length} novos de ${processos.length} por ${req.session.usuario}`);
    res.json({ ok: true, total: novos.length, ignorados: processos.length - novos.length });
  } catch (e) {
    console.error('controle/importar erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

app.get('/api/controle/carregar', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_processos')
      .select('dados')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    res.json({ ok: true, processos: (data || []).map(r => r.dados) });
  } catch (e) { res.json({ ok: true, processos: [] }); }
});

// ── API: TYREDESK ─────────────────────────────────────────────
app.post('/api/base/salvar', auth('tyredesk'), async (req, res) => {
  try {
    const { base } = req.body;
    const { error } = await sb()
      .from('tyredesk_base')
      .upsert({ id: 1, dados: base, updated_by: req.session.usuario, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    console.log(`TyreDesk base salva por ${req.session.usuario}: ${base.length} itens`);
    res.json({ ok: true, total: base.length });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/base/carregar', auth(), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('tyredesk_base')
      .select('dados, updated_at, updated_by')
      .eq('id', 1)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    const base = data ? data.dados : null;
    res.json({
      ok: !!base,
      base,
      total: base ? base.length : 0,
      updated_at: data ? data.updated_at : null,
      updated_by: data ? data.updated_by : null,
    });
  } catch (e) { res.json({ ok: false, base: null }); }
});

app.post('/api/base/salvar-fornecedores', auth('tyredesk'), async (req, res) => {
  try {
    const { fornecedores } = req.body;
    const { error } = await sb()
      .from('tyredesk_fornecedores')
      .upsert({ id: 1, dados: fornecedores, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/base/carregar-fornecedores', auth(), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('tyredesk_fornecedores')
      .select('dados')
      .eq('id', 1)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    res.json({ ok: true, fornecedores: data ? data.dados : null });
  } catch (e) { res.json({ ok: false, fornecedores: null }); }
});

app.post('/api/base/salvar-snapshots', auth('tyredesk'), async (req, res) => {
  try {
    const { snapshots } = req.body;
    const { error } = await sb()
      .from('tyredesk_fornecedores')
      .upsert({ id: 2, dados: snapshots, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/base/carregar-snapshots', auth(), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('tyredesk_fornecedores')
      .select('dados')
      .eq('id', 2)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    res.json({ ok: true, snapshots: data ? data.dados : [] });
  } catch (e) { res.json({ ok: true, snapshots: [] }); }
});

// ── API: ANÁLISE DOCUMENTAL ───────────────────────────────────
app.post('/api/analisar', auth('processos'), rateLimitAnalisar, async (req, res) => {
  const { content } = req.body;
  if (!content || !Array.isArray(content)) {
    return res.status(400).json({ erro: 'Conteúdo inválido' });
  }
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key || key.length < 20) {
    return res.status(500).json({ erro: 'ANTHROPIC_API_KEY não configurada no servidor. Configure-a nas variáveis de ambiente do Railway.' });
  }

  // ── Padrão job assíncrono ───────────────────────────────────
  // Análises longas (até ~2-3min com vários documentos) não podem viver
  // dentro de uma única requisição HTTP: qualquer proxy no meio do caminho
  // (Railway, navegador) pode considerar a conexão parada e derrubá-la —
  // aí o usuário via "Erro 502" mesmo com o processamento ainda rodando.
  // Aqui só criamos o job e respondemos na hora; o processamento roda em
  // background e o cliente consulta o resultado via polling em
  // GET /api/analisar/job/:id (ver runAnalysis() em processos.html).
  const jobId = gerarUUID();
  const usuario = req.session?.usuario || '?';
  const _nDocs = content.length;
  const { error: insErr } = await sb()
    .from('analise_jobs')
    .insert({ id: jobId, status: 'processando', usuario });
  if (insErr) {
    console.error('analisar: erro ao criar job:', insErr.message);
    return res.status(500).json({ erro: 'Erro ao iniciar análise: ' + insErr.message });
  }
  res.json({ ok: true, jobId });

  // Processamento em background — não bloqueia a resposta acima.
  (async () => {
    const _t0 = Date.now();
    console.log(`analisar: início (job ${jobId}) | ${_nDocs} item(ns) | usuario=${usuario}`);
    // Erros transitórios (sobrecarga/instabilidade momentânea da Anthropic) não
    // devem virar erro pro usuário — como o processamento roda em background,
    // dá pra tentar de novo sem custo de UX. 429/500/502/503/529 são status
    // que a própria Anthropic recomenda re-tentar.
    const RETRYAVEIS = [429, 500, 502, 503, 529];
    const MAX_TENTATIVAS = 2;
    async function _callAnthropic(tentativa){
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 150000);
      try {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 16000, messages: [{ role: 'user', content }] }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!resp.ok) {
          if (RETRYAVEIS.includes(resp.status) && tentativa < MAX_TENTATIVAS) {
            const espera = 2000 * tentativa;
            console.warn(`analisar: erro transitório (job ${jobId}, Anthropic ${resp.status}, tentativa ${tentativa}/${MAX_TENTATIVAS}) | retry em ${espera}ms`);
            await new Promise(r => setTimeout(r, espera));
            return _callAnthropic(tentativa + 1);
          }
          const err = await resp.json().catch(() => ({}));
          throw new Error(`API Anthropic erro ${resp.status}: ${err?.error?.message || resp.statusText}`);
        }
        return await resp.json();
      } catch (e) {
        clearTimeout(timeout);
        if (e.name === 'AbortError' && tentativa < MAX_TENTATIVAS) {
          console.warn(`analisar: timeout parcial (job ${jobId}, tentativa ${tentativa}/${MAX_TENTATIVAS}) | retry`);
          return _callAnthropic(tentativa + 1);
        }
        throw e;
      }
    }
    try {
      const respData = await _callAnthropic(1);
      console.log(`analisar: ok (job ${jobId}) | ${Date.now() - _t0}ms | ${_nDocs} item(ns)`);
      await sb().from('analise_jobs').update({ status: 'concluido', resultado: respData, updated_at: new Date().toISOString() }).eq('id', jobId);
    } catch (fetchErr) {
      const msg = fetchErr.name === 'AbortError'
        ? 'Análise demorou demais mesmo com novas tentativas. Tente com menos documentos.'
        : fetchErr.message;
      console.warn(`analisar: erro (job ${jobId}): ${msg} | ${Date.now() - _t0}ms`);
      await sb().from('analise_jobs').update({ status: 'erro', erro: msg, updated_at: new Date().toISOString() }).eq('id', jobId);
    }
  })();
});

app.get('/api/analisar/job/:id', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('analise_jobs')
      .select('status, resultado, erro')
      .eq('id', req.params.id)
      .single();
    if (error) throw new Error(error.message);
    res.json({ ok: true, status: data.status, resultado: data.resultado, erro: data.erro });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ── GED — ARQUIVOS DO PROCESSO (Supabase Storage) ──────────────
const GED_BUCKET = 'controle-arquivos';

app.get('/api/controle/v2/arquivos/:processoId', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_arquivos')
      .select('id, nome, tipo, tamanho, storage_path, created_at, created_by')
      .eq('processo_id', req.params.processoId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    const arquivos = await Promise.all((data || []).map(async a => {
      const { data: urlData } = sb().storage.from(GED_BUCKET).getPublicUrl(a.storage_path);
      return { ...a, url: urlData?.publicUrl || '' };
    }));
    res.json({ ok: true, arquivos });
  } catch (e) {
    console.error('ged listar erro:', e.message);
    res.json({ ok: true, arquivos: [] });
  }
});

app.post('/api/controle/v2/arquivos', auth('processos'), async (req, res) => {
  try {
    const { processo_id, nome, tipo, base64 } = req.body;
    if (!processo_id || !nome || !base64) return res.status(400).json({ erro: 'Dados incompletos' });

    const tiposPermitidos = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (!tiposPermitidos.includes(tipo)) return res.status(400).json({ erro: 'Tipo de arquivo não permitido' });

    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length > 15 * 1024 * 1024) return res.status(400).json({ erro: 'Arquivo maior que 15MB' });

    const arquivoId = gerarUUID();
    const extensao = nome.split('.').pop();
    const storagePath = `${processo_id}/${arquivoId}.${extensao}`;

    const { error: uploadError } = await sb().storage
      .from(GED_BUCKET)
      .upload(storagePath, buffer, { contentType: tipo, upsert: false });
    if (uploadError) throw new Error(uploadError.message);

    const { error: dbError } = await sb().from('controle_arquivos').insert({
      id: arquivoId,
      processo_id,
      nome,
      tipo,
      tamanho: buffer.length,
      storage_path: storagePath,
      created_by: req.session.usuario,
      created_at: new Date().toISOString(),
    });
    if (dbError) throw new Error(dbError.message);

    console.log(`ged upload: ${nome} (${(buffer.length/1024).toFixed(0)}KB) processo=${processo_id} por ${req.session.usuario}`);
    res.json({ ok: true, id: arquivoId });
  } catch (e) {
    console.error('ged upload erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

app.delete('/api/controle/v2/arquivos/:id', auth('processos'), requireGerente, async (req, res) => {
  try {
    const { data: arquivo } = await sb()
      .from('controle_arquivos')
      .select('storage_path')
      .eq('id', req.params.id)
      .single();
    if (arquivo?.storage_path) {
      await sb().storage.from(GED_BUCKET).remove([arquivo.storage_path]);
    }
    const { error } = await sb().from('controle_arquivos').delete().eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (e) {
    console.error('ged excluir erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// ── CONTATOS (Clientes, Fornecedores, Despachantes, Agentes) ──
app.get('/api/contatos', auth(), async (req, res) => {
  try {
    const { q, tipo, uf, limit } = req.query;
    const lim = Math.min(parseInt(limit) || 30, 1000);
    let query = sb().from('contatos_clientes').select('id,cnpj,razao_social,nome_fantasia,cidade,uf,email,telefone,tipo,obs').eq('ativo', true);
    // tipo aceita mais de um valor separado por vírgula (ex: "FORNECEDOR,EXPORTADOR")
    // — usado pelo campo "Fornecedor (Exportador)" do processo, que precisa achar
    // contatos cadastrados em QUALQUER uma dessas duas categorias (antes buscava
    // só EXPORTADOR, então um contato cadastrado como Fornecedor nunca aparecia
    // no autocomplete daquele campo, mesmo existindo no cadastro).
    if (tipo) {
      const tipos = tipo.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
      query = tipos.length > 1 ? query.in('tipo', tipos) : query.eq('tipo', tipos[0]);
    }
    if (uf)   query = query.eq('uf', uf.toUpperCase());
    if (q && q.length >= 2) {
      // Remove caracteres com significado especial na sintaxe do filtro
      // .or() do PostgREST (vírgula separa condições, % é wildcard do
      // ilike, parênteses/asterisco também têm sentido sintático) — sem
      // isso, buscar por algo como "Silva, Lima" quebrava a query com erro.
      const qSeguro = q.replace(/[,%*()]/g, '').trim();
      if (qSeguro.length >= 2) {
        query = query.or(`razao_social.ilike.%${qSeguro}%,cnpj.ilike.%${qSeguro}%,nome_fantasia.ilike.%${qSeguro}%`);
      }
    }
    query = query.order('razao_social').limit(lim);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    res.json({ ok: true, contatos: data || [] });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

app.post('/api/contatos', auth('processos'), async (req, res) => {
  try {
    const c = req.body;
    if (!c.razao_social) return res.status(400).json({ erro: 'Razão social obrigatória' });
    const isNovo = !c.id;
    if (!c.id) c.id = require('crypto').randomUUID();

    // Trava de duplicidade — só entra em ação na CRIAÇÃO de um contato novo
    // (editar um contato existente passa direto, mesmo mantendo o nome).
    // Considera duplicado quando: (a) o CNPJ informado já existe em outro
    // cadastro ativo, ou (b) a razão social (ignorando maiúsculas/espaços
    // extras) já existe ativa NO MESMO TIPO. CNPJs diferentes com o mesmo
    // nome continuam permitidos de propósito — isso normalmente é
    // matriz/filial em cidades diferentes, não duplicidade de cadastro
    // (mesma lógica usada na limpeza dos duplicados existentes).
    if (isNovo) {
      const cnpjDigits = (c.cnpj || '').replace(/\D/g, '');
      const nomeNorm = (c.razao_social || '').trim().toUpperCase().replace(/\s+/g, ' ');
      const { data: existentes, error: buscaErro } = await sb()
        .from('contatos_clientes')
        .select('id, razao_social, cnpj, tipo')
        .eq('ativo', true);
      if (buscaErro) throw new Error(buscaErro.message);
      const duplicado = (existentes || []).find(e => {
        if (cnpjDigits && (e.cnpj || '') === cnpjDigits) return true;
        // Duplicidade por NOME só conta quando NENHUM dos dois lados tem
        // CNPJ pra diferenciar (caso típico: exportador/armador/agente
        // estrangeiro, sem CNPJ brasileiro). Se qualquer um dos dois tiver
        // CNPJ e forem diferentes, não bloqueia — é matriz/filial legítima
        // com o mesmo nome em CNPJs diferentes (mesma regra usada na
        // limpeza dos duplicados existentes).
        if (cnpjDigits || e.cnpj) return false;
        const eNome = (e.razao_social || '').trim().toUpperCase().replace(/\s+/g, ' ');
        return eNome === nomeNorm && e.tipo === c.tipo;
      });
      if (duplicado) {
        const motivo = cnpjDigits && duplicado.cnpj === cnpjDigits ? 'esse CNPJ' : 'esse nome e tipo';
        return res.status(409).json({
          erro: `Já existe um cadastro ativo com ${motivo}: "${duplicado.razao_social}". Edite o cadastro existente em vez de criar outro.`,
          duplicado_id: duplicado.id,
        });
      }
    }

    c.updated_at = new Date().toISOString();
    const { error } = await sb().from('contatos_clientes').upsert(c, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    res.json({ ok: true, id: c.id });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

app.delete('/api/contatos/:id', auth('processos'), requireGerente, async (req, res) => {
  try {
    const { error } = await sb().from('contatos_clientes').update({ ativo: false }).eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

app.post('/api/calculador/importar-planilha', auth('tyredesk'), (req, res) => { try { const { arquivo_base64 } = req.body; if (!arquivo_base64) return res.status(400).json({ ok: false, erro: 'Nenhum arquivo enviado.' }); const buffer = Buffer.from(arquivo_base64, 'base64'); const resultado = importarPlanilhaBase(buffer); res.json({ ok: true, campos: resultado.campos, mix: resultado.mix }); } catch (e) { console.error('Erro ao importar planilha:', e.message); res.status(400).json({ ok: false, erro: e.message }); } });
app.post('/api/controle/importar-fechamento', auth('processos'), (req, res) => { try { const { arquivo_base64 } = req.body; if (!arquivo_base64) return res.status(400).json({ ok: false, erro: 'Nenhum arquivo enviado.' }); const buffer = Buffer.from(arquivo_base64, 'base64'); const resultado = importarFechamentoBase(buffer); res.json({ ok: true, datas: resultado.datas, real_json: resultado.real_json, moedas: resultado.moedas, avisos: resultado.avisos }); } catch (e) { console.error('Erro ao importar fechamento:', e.message); res.status(400).json({ ok: false, erro: e.message }); } });
// ── CALCULADOR: COTAÇÕES SALVAS ──────────────────────────────────
// Lista leve (só o resumo, não o formulário inteiro) pra tela de listagem.
app.get('/api/calculador/cotacoes', auth('tyredesk'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('calculador_cotacoes')
      .select('id,cliente,numero,resumo,updated_at,updated_by')
      .eq('ativo', true)
      .order('updated_at', { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    res.json({ ok: true, cotacoes: data || [] });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// Registro completo (formulário + mix) pra reabrir no Calculador.
app.get('/api/calculador/cotacoes/:id', auth('tyredesk'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('calculador_cotacoes')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) throw new Error(error.message);
    res.json({ ok: true, cotacao: data });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// Criar/atualizar. Sem id no corpo = cria novo (usado tanto pra "Salvar"
// quanto pra "Duplicar", já que duplicar só manda os dados sem o id original).
//
// IMPORTANTE: o front (resumoParaLista, calculador.html) só manda os campos
// de CÁLCULO dentro de `resumo` (tipo, uf, custo_total, etc) — ele não sabe
// nada sobre status de aprovação/rejeição, porque isso é decidido pelos
// endpoints /aprovar e /rejeitar abaixo. Se a gente simplesmente sobrescrever
// `resumo` inteiro aqui, salvar uma edição numa cotação já aprovada ou
// rejeitada IA PERDER esse status (voltava pra "rascunho" sem querer). Por
// isso, quando já existe uma cotação com esse id, busca o resumo salvo antes
// e faz merge: os campos de cálculo vêm do front (mais recentes), mas
// status/processo_id/motivo_perda/etc só são tocados pelos endpoints
// dedicados de aprovar/rejeitar, nunca por um "Salvar" comum.
app.post('/api/calculador/cotacoes', auth('tyredesk'), async (req, res) => {
  try {
    const c = req.body;
    if (!c.cliente) return res.status(400).json({ erro: 'Cliente obrigatório' });
    if (c.id) {
      const { data: existente } = await sb()
        .from('calculador_cotacoes')
        .select('resumo')
        .eq('id', c.id)
        .maybeSingle();
      if (existente && existente.resumo) {
        c.resumo = { ...existente.resumo, ...(c.resumo || {}) };
      }
    } else {
      c.id = require('crypto').randomUUID();
    }
    c.ativo = true;
    c.updated_at = new Date().toISOString();
    c.updated_by = req.session.usuario || null;
    const { error } = await sb().from('calculador_cotacoes').upsert(c, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    res.json({ ok: true, id: c.id });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// ── Aprovar cotação → cria processo em Controle de Processos ────
// Idempotente: se a cotação já foi aprovada antes (já tem processo_id no
// resumo), não cria um processo novo de novo — só devolve o que já existe.
// Isso evita duplicar processo se o usuário clicar "Aprovar" duas vezes
// (ex: clique duplo, ou dar refresh e clicar de novo sem perceber que já
// tinha aprovado).
//
// Aprovar cria dado em outro sistema (Controle de Processos), então exige
// os DOIS módulos — não basta ter acesso ao Calculador (`auth('tyredesk')`
// só cobre isso), também precisa ter acesso a Processos. Hoje todo usuário
// já tem os dois (ver USUARIOS no topo do arquivo), mas isso evita abrir uma
// brecha se um dia existir um usuário só com acesso ao Calculador.
app.post('/api/calculador/cotacoes/:id/aprovar', auth('tyredesk'), (req, res, next) => {
  if (!req.session.modulos.includes('processos')) {
    return res.status(403).json({ erro: 'Sem acesso a Processos — não é possível aprovar cotações' });
  }
  next();
}, async (req, res) => {
  try {
    const { data: cot, error: errBusca } = await sb()
      .from('calculador_cotacoes')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (errBusca) throw new Error(errBusca.message);
    if (!cot) return res.status(404).json({ erro: 'Cotação não encontrada' });

    const resumoAtual = cot.resumo || {};
    if (resumoAtual.status === 'aprovada' && resumoAtual.processo_id) {
      return res.json({ ok: true, ja_aprovada: true, processo_id: resumoAtual.processo_id, processo_referencia: resumoAtual.processo_referencia });
    }

    const processoBase = mapearCotacaoParaProcesso(cot.dados, cot.cliente);
    // Guarda o "cotado" (custo/faturamento/lucro estimados dos dois cenários) junto
    // do processo, pra dar pra comparar depois com o resultado real no Fechamento
    // (ver seção 💰 Fechamento na ficha do processo).
    const estimativa = extrairEstimativa(cot.resumo);
    // Além de guardar a estimativa (só leitura), já grava os custos cotados
    // como ponto de partida REAL da aba Custos Reais — antes disso o usuário
    // precisava abrir a aba manualmente pra ver o "Cotado" como sugestão; agora
    // o processo já nasce com esses valores preenchidos em "Pago" (ver
    // gerarRealJsonInicial em mapeamento_cotacao_processo.js).
    const custosCotados = estimativa && estimativa.custos_cotados_json;
    const processo = {
      ...processoBase,
      id: gerarUUID(),
      updated_at: new Date().toISOString(),
      estimativa_json: estimativa,
      real_json: gerarRealJsonInicial(custosCotados),
      real_cambio: (custosCotados && Number.isFinite(parseFloat(custosCotados.cambio)) ? parseFloat(custosCotados.cambio) : null),
      cotacao_id: cot.id,
    };
    const { error: errProc } = await sb().from('controle_processos').insert(processo);
    if (errProc) throw new Error(errProc.message);

    const novoResumo = {
      ...resumoAtual,
      status: 'aprovada',
      processo_id: processo.id,
      processo_referencia: processo.referencia,
      data_aprovacao: new Date().toISOString(),
      aprovado_por: req.session.usuario || null,
      // se tinha sido rejeitada antes e o usuário mudou de ideia, limpa o motivo antigo
      motivo_perda: undefined,
      data_rejeicao: undefined,
      rejeitado_por: undefined,
    };
    const { error: errUpd } = await sb()
      .from('calculador_cotacoes')
      .update({ resumo: novoResumo })
      .eq('id', req.params.id);
    if (errUpd) throw new Error(errUpd.message);

    console.log(`cotação aprovada: ${cot.cliente} → processo ${processo.referencia} por ${req.session.usuario}`);
    res.json({ ok: true, processo_id: processo.id, processo_referencia: processo.referencia });
  } catch(e) {
    console.error('aprovar cotação erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// ── Rejeitar cotação (registra motivo de perda) ──────────────────
app.post('/api/calculador/cotacoes/:id/rejeitar', auth('tyredesk'), async (req, res) => {
  try {
    const motivo = (req.body && req.body.motivo || '').trim();
    if (!motivo) return res.status(400).json({ erro: 'Informe o motivo da perda' });

    const { data: cot, error: errBusca } = await sb()
      .from('calculador_cotacoes')
      .select('resumo')
      .eq('id', req.params.id)
      .maybeSingle();
    if (errBusca) throw new Error(errBusca.message);
    if (!cot) return res.status(404).json({ erro: 'Cotação não encontrada' });

    const novoResumo = {
      ...(cot.resumo || {}),
      status: 'rejeitada',
      motivo_perda: motivo,
      data_rejeicao: new Date().toISOString(),
      rejeitado_por: req.session.usuario || null,
    };
    const { error } = await sb()
      .from('calculador_cotacoes')
      .update({ resumo: novoResumo })
      .eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

app.delete('/api/calculador/cotacoes/:id', auth('tyredesk'), requireGerente, async (req, res) => {
  try {
    const { error } = await sb().from('calculador_cotacoes').update({ ativo: false }).eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// ── HEALTH ────────────────────────────────────────────────────

// Servir chat.js
app.get('/chat.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, 'chat.js'));
});

// ════════════════════════════════════════════════════════════════
// CHAT COM IA — consulta inteligente sobre processos
// ════════════════════════════════════════════════════════════════
app.post('/api/chat', auth('processos'), rateLimitChat, async (req, res) => {
  try {
    const { mensagem, historico = [] } = req.body;
    if (!mensagem) return res.status(400).json({ erro: 'Mensagem vazia' });

    // Buscar todos os processos do banco para contexto
    const { data: processos, error } = await sb()
      .from('controle_processos')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) throw new Error(error.message);

    const hoje = new Date();
    const ativos = (processos || []).filter(p => p.fase !== 'FINALIZADO');
    const finalizados = (processos || []).filter(p => p.fase === 'FINALIZADO');

    // Calcular demurrage para cada processo ativo
    function demDias(p) {
      if (!p.demurrage_vencimento || p.data_devolucao_vazio) return null;
      const d = new Date(p.demurrage_vencimento);
      return Math.ceil((d - hoje) / 86400000);
    }

    // Resumo executivo para contexto da IA
    const porFase = {};
    ativos.forEach(p => { porFase[p.fase] = (porFase[p.fase] || 0) + 1; });

    const demCrit = ativos.filter(p => { const d = demDias(p); return d !== null && d <= 5; });
    const etaVenc = ativos.filter(p => p.eta && p.fase === 'EMBARCADO' && new Date(p.eta) < hoje);
    const semana  = new Date(hoje); semana.setDate(hoje.getDate() + 7);
    const etaSem  = ativos.filter(p => p.eta && new Date(p.eta) >= hoje && new Date(p.eta) <= semana && p.fase === 'EMBARCADO');
    const piVenc  = ativos.filter(p => p.pi_data_saldo && !p.pi_pago && new Date(p.pi_data_saldo) < hoje);

    // Montar contexto compacto (evitar context window enorme)
    const ctx = {
      data_hoje: hoje.toLocaleDateString('pt-BR'),
      total_processos: processos.length,
      em_andamento: ativos.length,
      finalizados: finalizados.length,
      por_fase: porFase,
      alertas: {
        demurrage_critico: demCrit.map(p => ({
          ref: p.referencia, fornecedor: p.fornecedor, armador: p.armador,
          dias: demDias(p), container: p.container
        })),
        eta_vencido: etaVenc.map(p => ({
          ref: p.referencia, fornecedor: p.fornecedor, eta: p.eta, armador: p.armador
        })),
        pi_vencida: piVenc.map(p => ({
          ref: p.referencia, fornecedor: p.fornecedor, vencimento: p.pi_data_saldo,
          valor: p.pi_valor_usd
        })),
        chegando_semana: etaSem.map(p => ({
          ref: p.referencia, fornecedor: p.fornecedor, eta: p.eta, armador: p.armador
        }))
      },
      processos_ativos: ativos.map(p => ({
        ref: p.referencia, fornecedor: p.fornecedor, cliente: p.cliente,
        fase: p.fase, eta: p.eta, hbl: p.hbl, mbl: p.mbl,
        container: p.container, armador: p.armador, navio: p.navio,
        numero_di: p.numero_di, pi_valor_usd: p.pi_valor_usd,
        pi_pago: p.pi_pago, pi_data_saldo: p.pi_data_saldo,
        nf_entrada_numero: p.nf_entrada_numero, nf_saida_numero: p.nf_saida_numero,
        nf_saida_valor: p.nf_saida_valor, obs: p.obs,
        demurrage_vencimento: p.demurrage_vencimento,
        data_embarque: p.data_embarque, data_chegada: p.data_chegada,
      }))
    };

    const systemPrompt = `Você é o assistente de importação da IMPAK COMERCIAL IMPORTADORA LTDA, especializado em pneus importados da Ásia (Vietnam e China) para o Brasil.

Você tem acesso em tempo real a todos os processos de importação. Responda de forma direta, objetiva e em português brasileiro.

DADOS ATUAIS (${hoje.toLocaleDateString('pt-BR')}):
${JSON.stringify(ctx, null, 2)}

INSTRUÇÕES:
- Responda perguntas sobre status de processos, ETAs, demurrage, pagamentos e faturamento
- Dê alertas proativos quando identificar riscos (demurrage, pagamentos vencidos, ETA vencido)
- Use os dados reais acima para responder com precisão
- Quando listar processos, use o formato: REF | FORNECEDOR | FASE | detalhe relevante
- Seja conciso mas completo
- Sugira ações quando pertinente (ex: "Recomendo contatar o armador X sobre o container Y")
- Valores em USD mantenha em USD, valores em BRL no formato R$ X.XXX,XX`;

    // Chamar Claude API
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada');

    const messages = [
      ...historico.slice(-8), // últimas 8 mensagens para contexto
      { role: 'user', content: mensagem }
    ];

    // Timeout menor por tentativa, com retry automático em erros transitórios
    // da Anthropic (429/500/502/503/529) — a resposta do chat é curta, então
    // dá pra tentar de novo sem que o total ultrapasse o que a conexão do
    // Railway aguenta (orçamento total ~27s, próximo do limite original de 25s).
    const RETRYAVEIS_CHAT = [429, 500, 502, 503, 529];
    const MAX_TENTATIVAS_CHAT = 3;
    async function _callAnthropicChat(tentativa){
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      try {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 1024,
            system: systemPrompt,
            messages
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (RETRYAVEIS_CHAT.includes(resp.status) && tentativa < MAX_TENTATIVAS_CHAT) {
          const espera = 1000 * tentativa;
          console.warn(`chat: erro transitório (Anthropic ${resp.status}, tentativa ${tentativa}/${MAX_TENTATIVAS_CHAT}) | retry em ${espera}ms`);
          await new Promise(r => setTimeout(r, espera));
          return _callAnthropicChat(tentativa + 1);
        }
        return resp;
      } catch (e) {
        clearTimeout(timeoutId);
        if (e.name === 'AbortError' && tentativa < MAX_TENTATIVAS_CHAT) {
          console.warn(`chat: timeout parcial (tentativa ${tentativa}/${MAX_TENTATIVAS_CHAT}) | retry`);
          return _callAnthropicChat(tentativa + 1);
        }
        throw e;
      }
    }

    const resp = await _callAnthropicChat(1);
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);

    const resposta = data.content?.[0]?.text || 'Não consegui processar sua pergunta.';
    console.log(`chat: ${req.session.usuario} → "${mensagem.slice(0,50)}..."`);

    res.json({ ok: true, resposta });
  } catch (e) {
    console.error('chat erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// ── HISTÓRICO TYREDESK (email de cotações) ──────────────────────
app.get('/api/drive/historico', auth('tyredesk'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('tyredesk_historico')
      .select('*')
      .order('data', { ascending: false })
      .limit(100);
    if (error) {
      // Tabela pode não existir ainda — retornar vazio sem erro
      return res.json({ ok: true, historico: [] });
    }
    res.json({ ok: true, historico: data || [] });
  } catch(e) {
    res.json({ ok: true, historico: [] });
  }
});

app.post('/api/drive/historico', auth('tyredesk'), async (req, res) => {
  try {
    const { entrada } = req.body;
    if (!entrada) return res.json({ ok: true });
    entrada.id = entrada.id || gerarUUID();
    const { error } = await sb()
      .from('tyredesk_historico')
      .insert([entrada]);
    // Ignorar erro se tabela não existir — não é crítico
    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: true }); // não crítico
  }
});

app.post('/api/drive/historico/limpar', auth('tyredesk'), async (req, res) => {
  try {
    await sb().from('tyredesk_historico').delete().neq('id', '');
    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: true });
  }
});

app.get('/health', async (req, res) => {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_KEY || '';
  const anthropicKey = process.env.ANTHROPIC_API_KEY || '';

  // Decodificar role da key sem dependência externa
  let keyRole = 'desconhecido';
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64').toString());
    keyRole = payload.role || 'desconhecido';
  } catch(e) {}

  let supabaseOk = false;
  let supabaseErro = null;
  try {
    const { data, error } = await sb().from('conferencia_processos').select('id').limit(1);
    supabaseOk = !error;
    supabaseErro = error ? (error.message + ' | code: ' + error.code + ' | hint: ' + error.hint) : null;
  } catch (e) {
    supabaseErro = e.message;
  }

  res.json({
    ok: true,
    supabase: supabaseOk,
    supabase_erro: supabaseErro,
    key_role: keyRole,
    key_len: key.length,
    url_ok: url.includes('supabase.co'),
    node: process.version,
    anthropic_key_configurada: anthropicKey.length > 20,
    anthropic_key_len: anthropicKey.length,
    anthropic_key_prefixo: anthropicKey.slice(0, 10),
  });
});

// ── Vincular cotação a processo existente (item d) ──────────────────────
app.get('/api/controle/processos-abertos', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_processos')
      .select('id, referencia, cliente, fase')
      .neq('fase', 'FINALIZADO')
      .order('referencia', { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    res.json({ ok: true, processos: data || [] });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.post('/api/calculador/cotacoes/:id/vincular-processo', auth('tyredesk'), (req, res, next) => {
  if (!req.session.modulos.includes('processos')) {
    return res.status(403).json({ erro: 'Sem acesso a Processos — não é possível vincular cotações' });
  }
  next();
}, async (req, res) => {
  try {
    const { processo_id } = req.body;
    if (!processo_id) return res.status(400).json({ erro: 'processo_id obrigatório' });

    const { data: cot, error: eCot } = await sb()
      .from('calculador_cotacoes').select('*').eq('id', req.params.id).single();
    if (eCot) throw new Error(eCot.message);

    const { data: proc, error: eProc } = await sb()
      .from('controle_processos').select('id, referencia, estimativa_json, real_json')
      .eq('id', processo_id).single();
    if (eProc) throw new Error(eProc.message);

    const estimativa = extrairEstimativa(cot.resumo);
    const custosCotados = (cot.resumo && cot.resumo.custos_cotados_json) || null;
    const realInicial = proc.real_json ? null : gerarRealJsonInicial(custosCotados);

    const patch = {};
    if (estimativa) patch.estimativa_json = estimativa;
    if (realInicial) patch.real_json = realInicial;
    if (Object.keys(patch).length) {
      const { error: eUpd } = await sb().from('controle_processos').update(patch).eq('id', processo_id);
      if (eUpd) throw new Error(eUpd.message);
    }

    const novoResumo = {
      ...(cot.resumo || {}),
      status: 'aprovada',
      processo_id: proc.id,
      processo_referencia: proc.referencia,
      data_aprovacao: new Date().toISOString(),
      aprovado_por: req.session.usuario || null,
    };
    const { error: eCotUpd } = await sb().from('calculador_cotacoes')
      .update({ resumo: novoResumo }).eq('id', req.params.id);
    if (eCotUpd) throw new Error(eCotUpd.message);

    res.json({ ok: true, processo_id: proc.id, processo_referencia: proc.referencia });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ── Vincular ao Calculador — prefill reverso (item e) ────────────────────
// Lê um processo do Controle e devolve o `dados` já no formato que o wizard
// do Calculador espera (aplicarEstadoFormulario), pra abrir pré-preenchido
// pra revisão antes de salvar como cotação nova. Só faz sentido pra
// processos ainda no início (sem Custos Reais lançados) — depois disso, a
// estimativa "cotada" já não tem tanto valor e o link fica mais confuso do
// que ajuda.
app.get('/api/controle/processos/:id/prefill-cotacao', auth('processos'), async (req, res) => {
  try {
    const { data: proc, error } = await sb()
      .from('controle_processos').select('*').eq('id', req.params.id).single();
    if (error) throw new Error(error.message);
    if (proc.custos_reais_json) {
      return res.status(400).json({ erro: 'Este processo já tem Custos Reais lançados — vincular ao Calculador só faz sentido na fase inicial.' });
    }
    const dados = mapearProcessoParaCotacao(proc);
    res.json({ ok: true, dados, referencia: proc.referencia });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ── TRATAMENTO DE ERRO GENÉRICO ────────────────────────────────
// Captura qualquer erro não tratado que escape de uma rota (ex: exceção
// síncrona, erro de parsing) antes que o Express devolva sua página de
// erro padrão — que pode incluir stack trace e detalhes da estrutura
// interna do código, úteis para quem estiver tentando mapear o sistema.
app.use((err, req, res, next) => {
  console.error('Erro não tratado:', err.stack || err.message || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, erro: 'Erro interno no servidor. Tente novamente em alguns instantes.' });
});

// ── START ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`IMPAK Portal v2.0 na porta ${PORT}`);
  console.log(`Variáveis de ambiente carregadas: ${Object.keys(process.env).filter(k=>k.includes('ANTHROPIC')||k.includes('SUPABASE')).join(', ')}`);
  console.log(`ANTHROPIC_API_KEY presente: ${!!process.env.ANTHROPIC_API_KEY} | tamanho: ${(process.env.ANTHROPIC_API_KEY||'').length}`);
  sincronizarUsuarios().catch(e => console.error('Erro ao sincronizar usuários no boot:', e.message));
});
/**
 * IMPAK Portal — Servidor v2.0
 * Banco de dados: Supabase PostgreSQL
 *
 * Variáveis Railway obrigatórias:
 *   SUPABASE_URL  → URL do projeto Supabase
 *   SUPABASE_KEY  → service_role key
 *
 * Variáveis Railway opcionais:
 *   ANTHROPIC_API_KEY → chave da API Anthropic
 *   SESSION_SECRET    → segredo da sessão (fixo — se não tiver, sessão morre a cada deploy)
 *   SENHA_*           → senhas dos usuários
 *
 * Tabela extra necessária no Supabase (sessão persistente, sobrevive a deploy):
 *   create table if not exists app_sessions (
 *     sid text primary key,
 *     sess jsonb not null,
 *     expire timestamptz not null
 *   );
 *   create index if not exists app_sessions_expire_idx on app_sessions (expire);
 */

const express = require('express');
const session = require('express-session');
const path    = require('path');
const { createClient } = require('@supabase/supabase-js');
const { randomUUID, scryptSync, randomBytes, timingSafeEqual, createHash } = require('crypto');
const { mapearCotacaoParaProcesso, mapearProcessoParaCotacao, extrairEstimativa, gerarRealJsonInicial } = require('./mapeamento_cotacao_processo.js'); const { importarPlanilhaBase, importarFechamentoBase } = require('./planilha-import.js');

function gerarUUID(){ return randomUUID(); }

// ── HASH DE SENHA (scrypt nativo do Node — sem dependência externa) ──
// Formato do hash armazenado: "salt:hash" (ambos em hex).
function hashSenha(senhaPura){
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(senhaPura, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verificarSenha(senhaPura, hashArmazenado){
  if(!hashArmazenado || !hashArmazenado.includes(':')) return false;
  const [salt, hashOriginal] = hashArmazenado.split(':');
  const hashTentativa = scryptSync(senhaPura, salt, 64).toString('hex');
  // timingSafeEqual evita "timing attack" (comparar com === pode revelar,
  // pelo tempo de resposta, quantos caracteres já bateram).
  const bufOriginal  = Buffer.from(hashOriginal, 'hex');
  const bufTentativa = Buffer.from(hashTentativa, 'hex');
  if(bufOriginal.length !== bufTentativa.length) return false;
  return timingSafeEqual(bufOriginal, bufTentativa);
}

// ── SEGURANÇA: sanitização do parâmetro "destino" (usado no fluxo de login) ──
// "destino" chega direto da query string / body (controlado pelo visitante),
// e era antes inserido sem escapar num atributo HTML e usado em res.redirect
// sem validação — abrindo brecha de XSS refletido e de "open redirect"
// (alguém manda um link tipo /login?destino=https://site-falso.com e, após
// o login legítimo, o usuário é levado pra fora do domínio do IMPAK).
// Aqui só aceitamos caminhos relativos internos (começando com uma única
// barra, nunca "//" — que os navegadores tratam como protocol-relative URL).
function sanitizeDestino(destino) {
  if (typeof destino !== 'string' || !destino.startsWith('/') || destino.startsWith('//')) return '/';
  return destino;
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── HASH DO TOKEN DE REDEFINIÇÃO DE SENHA ─────────────────────
// Antes o reset_token era salvo em texto puro no banco — quem tivesse
// acesso de leitura à tabela "usuarios" (um dump, um backup vazado, uma
// query mal protegida) podia usar o token direto pra resetar a senha de
// qualquer usuário, sem nunca precisar do e-mail. Agora só o HASH do
// token fica no banco; o token em si só existe no link enviado por
// e-mail. SHA-256 (não scrypt) é suficiente aqui porque o token já nasce
// com 32 bytes de entropia aleatória (randomBytes) — diferente de uma
// senha escolhida por humano, não há risco de força bruta por dicionário.
function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
// Busca o usuário dono de um token, comparando o HASH com timingSafeEqual
// (em vez de === direto) para não vazar, pelo tempo de resposta, quantos
// bytes do hash já bateram — mesma lógica de verificarSenha() acima.
function buscarUsuarioPorTokenReset(token) {
  if (!token) return null;
  const tentativaBuf = Buffer.from(hashToken(token), 'hex');
  for (const u of _usuariosCache.values()) {
    if (!u.reset_token) continue;
    const armazenadoBuf = Buffer.from(u.reset_token, 'hex');
    if (armazenadoBuf.length === tentativaBuf.length && timingSafeEqual(armazenadoBuf, tentativaBuf)) {
      return u;
    }
  }
  return null;
}

const app  = express();
const PORT = process.env.PORT || 3000;

// ── SUPABASE ──────────────────────────────────────────────────
// Inicialização lazy — variáveis de ambiente disponíveis somente
// após o processo iniciar, não no momento do require()
let _sb = null;
function sb() {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL ou SUPABASE_KEY não configurados no Railway');
  _sb = createClient(url, key, { auth: { persistSession: false } });
  console.log('✓ Supabase conectado:', url.slice(0, 40) + '...');
  return _sb;
}

// ── SESSION STORE PERSISTENTE (Supabase) ─────────────────────────
// Antes: sessão vivia só na memória do processo Node (MemoryStore, o padrão
// do express-session). Resultado: TODO deploy/restart do Railway derrubava a
// sessão de TODOS os usuários logados, mesmo com SESSION_SECRET fixo — o
// segredo só evita erro de assinatura do cookie, mas sem um lugar persistente
// pra guardar os dados da sessão em si, o servidor não reconhece mais o
// cookie depois de reiniciar. Isso causava o erro "Unexpected token '<' ...
// is not valid JSON" ao salvar: a chamada à API era redirecionada
// silenciosamente pra /login (HTML) e o front tentava ler aquilo como JSON.
// Este store salva a sessão na tabela `app_sessions` do Supabase, então ela
// sobrevive a deploys normalmente (precisa existir a tabela — ver README).
// Se a tabela `app_sessions` ainda não existir no Supabase (setup pendente),
// nenhuma chamada aqui deve derrubar a requisição nem travar login — só
// registra um aviso uma vez e segue como se não houvesse sessão persistida
// (mesmo comportamento de antes, sem quebrar nada enquanto a tabela não sai).
// Duas categorias de erro bem diferentes aqui:
//  1. "Tabela ainda não existe" (setup pendente) — situação SEGURA e
//     esperada logo após o deploy deste código, antes de alguém rodar o SQL
//     de criação da tabela. Avisa só 1x pra não poluir o log.
//  2. QUALQUER outro erro (ex: permissão faltando — já aconteceu: a tabela
//     foi criada mas o Supabase não deu GRANT pro service_role, e isso
//     travou login de todo mundo silenciosamente até alguém notar) — isso
//     é grave, avisa SEMPRE (não só 1x) e de um jeito bem visível, porque
//     "só 1 aviso perdido no meio do log" foi exatamente o que escondeu o
//     problema real da última vez.
let _avisouTabelaAusente = false;
// Retorna true se o erro é o caso conhecido/esperado "tabela ainda não existe"
// (degradação graciosa é ok), ou false se é um erro real (outage, permissão
// faltando, etc) — nesse caso quem chamou NÃO deve fingir que "não tem sessão".
function avisarErroSessao(error, operacao) {
  if (!error) return false;
  const msg = error.message || String(error);
  const tabelaAusente = error.code === 'PGRST205' || error.code === '42P01' || /schema cache|does not exist/i.test(msg);
  if (tabelaAusente) {
    if (!_avisouTabelaAusente) {
      _avisouTabelaAusente = true;
      console.error(`⚠️  Tabela app_sessions ainda não existe no Supabase — sessão vai continuar caindo a cada deploy até criar a tabela (ver instruções no topo do arquivo). [${operacao}]`, msg);
    }
  } else {
    console.error(`🛑 ERRO REAL ao acessar app_sessions — sessão NÃO está sendo salva/lida, login pode estar quebrado para todo mundo. [${operacao}] code=${error.code||'?'}:`, msg);
  }
  return tabelaAusente;
}

class SupabaseSessionStore extends session.Store {
  get(sid, callback) {
    sb().from('app_sessions').select('sess, expire').eq('sid', sid).maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          const tabelaAusente = avisarErroSessao(error, 'get');
          // "Tabela ainda não existe" é um estado conhecido/esperado (antes da
          // tabela ser criada) — degradar pra "sem sessão" está ok. QUALQUER
          // outro erro (outage passageiro do Supabase, permissão revogada, etc)
          // é propagado como erro real: NÃO fingimos "sessão não encontrada",
          // porque isso derrubaria o login de todo mundo silenciosamente até
          // alguém notar (foi exatamente o incidente que motivou este arquivo).
          return callback(tabelaAusente ? null : error, null);
        }
        if (!data) return callback(null, null);
        if (new Date(data.expire) < new Date()) {
          this.destroy(sid, () => {});
          return callback(null, null);
        }
        callback(null, data.sess);
      })
      .catch(err => {
        const tabelaAusente = avisarErroSessao(err, 'get');
        callback(tabelaAusente ? null : err, null);
      });
  }

  set(sid, sessionData, callback) {
    const maxAge = (sessionData.cookie && sessionData.cookie.maxAge) || 8 * 60 * 60 * 1000;
    const expire = new Date(Date.now() + maxAge).toISOString();
    sb().from('app_sessions').upsert({ sid, sess: sessionData, expire }, { onConflict: 'sid' })
      .then(({ error }) => { if (error) avisarErroSessao(error, 'set'); callback && callback(null); })
      .catch(err => { avisarErroSessao(err, 'set'); callback && callback(null); });
  }

  destroy(sid, callback) {
    sb().from('app_sessions').delete().eq('sid', sid)
      .then(({ error }) => { if (error) avisarErroSessao(error, 'destroy'); callback && callback(null); })
      .catch(err => { avisarErroSessao(err, 'destroy'); callback && callback(null); });
  }

  touch(sid, sessionData, callback) {
    const maxAge = (sessionData.cookie && sessionData.cookie.maxAge) || 8 * 60 * 60 * 1000;
    const expire = new Date(Date.now() + maxAge).toISOString();
    sb().from('app_sessions').update({ expire }).eq('sid', sid)
      .then(({ error }) => { if (error) avisarErroSessao(error, 'touch'); callback && callback(null); })
      .catch(err => { avisarErroSessao(err, 'touch'); callback && callback(null); });
  }
}

// Limpeza periódica de sessões expiradas (evita a tabela crescer sem fim)
setInterval(() => {
  sb().from('app_sessions').delete().lt('expire', new Date().toISOString())
    .then(({ error }) => { if (error) avisarErroSessao(error, 'limpeza'); })
    .catch(err => avisarErroSessao(err, 'limpeza'));
}, 60 * 60 * 1000); // a cada 1h

// ── USUÁRIOS ──────────────────────────────────────────────────
// Esta lista continua sendo a FONTE DOS METADADOS (nome, módulos, role, home,
// email) — mas a SENHA de verdade agora mora na tabela `usuarios` do Supabase,
// não mais só na variável de ambiente. Isso é o que permite "Esqueci minha
// senha" funcionar: a senha pode mudar em tempo real, sem precisar mexer no
// Railway. Na subida do servidor, sincronizarUsuarios() garante que cada
// usuário exista no Supabase — usando a senha do env var SÓ NA PRIMEIRA VEZ
// (se a pessoa já resetou a própria senha depois, isso nunca é sobrescrito).
function envSenhaHash(key) {
  const v = process.env[key];
  if (!v) console.error(`⚠️  ${key} não configurada no Railway — login deste usuário vai falhar.`);
  return v || null;
}

const USUARIOS = [
  { usuario: 'narcelio',  senhaHashEnv: envSenhaHash('SENHA_NARCELIO'),  email: 'narcelio@impak.com.br',      modulos: ['tyredesk','processos'], nome: 'Narcelio',  role: 'gerente',  displayName: 'Narcelio',  home: '/'           },
  { usuario: 'jean',      senhaHashEnv: envSenhaHash('SENHA_JEAN'),      email: 'jean@impak.com.br',          modulos: ['tyredesk','processos'], nome: 'Jean',      role: 'gerente',  displayName: 'Jean',      home: '/'           },
  { usuario: 'paula',     senhaHashEnv: envSenhaHash('SENHA_PAULA'),     email: 'paula@impak.com.br',         modulos: ['tyredesk','processos'], nome: 'Paula',     role: 'gerente',  displayName: 'Paula',     home: '/processos'  },
  { usuario: 'amanda',    senhaHashEnv: envSenhaHash('SENHA_AMANDA'),    email: 'amanda@findcomex.com.br',    modulos: ['tyredesk','processos'], nome: 'Amanda',    role: 'gerente',  displayName: 'Amanda',    home: '/processos'  },
  { usuario: 'bianca',    senhaHashEnv: envSenhaHash('SENHA_BIANCA'),    email: 'financeiro@impak.com.br',    modulos: ['tyredesk','processos'], nome: 'Bianca',    role: 'gerente',  displayName: 'Bianca',    home: '/processos'  },
  { usuario: 'emanuelly', senhaHashEnv: envSenhaHash('SENHA_EMANUELLY'), email: 'importacao1@impak.com.br',   modulos: ['tyredesk','processos'], nome: 'Emanuelly', role: 'analista', displayName: 'Emanuelly', home: '/processos'  },
  { usuario: 'italo',     senhaHashEnv: envSenhaHash('SENHA_ITALO'),     email: 'fiscal01@impak.com.br',      modulos: ['tyredesk','processos'], nome: 'Italo',     role: 'analista', displayName: 'Italo',     home: '/processos'  },
  { usuario: 'maria',     senhaHashEnv: envSenhaHash('SENHA_MARIA'),     email: 'fiscal@impak.com.br',        modulos: ['tyredesk','processos'], nome: 'Maria',     role: 'analista', displayName: 'Maria',     home: '/processos'  },
  { usuario: 'joyce',     senhaHashEnv: envSenhaHash('SENHA_JOYCE'),     email: 'nfe@impak.com.br',           modulos: ['tyredesk','processos'], nome: 'Joyce',     role: 'analista', displayName: 'Joyce',     home: '/processos'  },
  { usuario: 'neide',     senhaHashEnv: envSenhaHash('SENHA_NEIDE'),     email: 'operacional01@impak.com.br', modulos: ['tyredesk','processos'], nome: 'Neide',     role: 'analista', displayName: 'Neide',     home: '/processos'  },
  { usuario: 'everton',   senhaHashEnv: envSenhaHash('SENHA_EVERTON'),   email: 'administrativo@impak.com.br', modulos: ['tyredesk','processos'], nome: 'Everton',   role: 'analista', displayName: 'Everton',   home: '/processos'  },
  { usuario: 'isabella',  senhaHashEnv: envSenhaHash('SENHA_ISABELLA'),  email: 'operacional@impak.com.br',   modulos: ['tyredesk','processos'], nome: 'Isabella',  role: 'analista', displayName: 'Isabella',  home: '/processos'  },
  { usuario: 'suporte',   senhaHashEnv: envSenhaHash('SENHA_SUPORTE'),   email: 'suporte@impak.com.br',       modulos: ['tyredesk','processos'], nome: 'Suporte',   role: 'gerente',  displayName: 'Suporte',   home: '/'           },
];

// Cache em memória dos usuários carregados do Supabase (recarregado no boot
// e sempre que alguém redefine a senha). O login lê DAQUI, não do array acima.
let _usuariosCache = new Map();

async function sincronizarUsuarios(){
  for(const u of USUARIOS){
    try{
      const { data: existente } = await sb().from('usuarios').select('senha_hash').eq('usuario', u.usuario).maybeSingle();
      const senha_hash = existente ? existente.senha_hash : u.senhaHashEnv;
      if(!senha_hash){
        console.error(`⚠️  Usuário "${u.usuario}" sem senha (nem no Supabase, nem no env var) — login vai falhar.`);
        continue;
      }
      await sb().from('usuarios').upsert({
        usuario: u.usuario, senha_hash, email: u.email, nome: u.nome,
        display_name: u.displayName, role: u.role, modulos: u.modulos, home: u.home,
      }, { onConflict: 'usuario' });
    }catch(e){ console.error(`Erro sincronizando usuário ${u.usuario}:`, e.message); }
  }
  await recarregarCacheUsuarios();
  console.log('✓ Usuários sincronizados com o Supabase:', _usuariosCache.size);
}

async function recarregarCacheUsuarios(){
  const { data, error } = await sb().from('usuarios').select('*');
  if(error){ console.error('Erro ao carregar usuários do Supabase:', error.message); return; }
  _usuariosCache = new Map((data||[]).map(u => [u.usuario, u]));
}

// ── INVALIDAÇÃO DE SESSÃO POR USUÁRIO ─────────────────────────
// Cada usuário tem um "número de versão" da sessão (começa em 1). A sessão
// guarda a versão vigente no momento do login; o middleware auth() compara
// com a versão atual do usuário a cada requisição. Incrementar a versão
// (ex: ao trocar senha, ou via "Forçar logout") invalida instantaneamente
// qualquer sessão antiga daquele usuário, mesmo que o cookie ainda exista
// no navegador da pessoa — sem precisar de um banco de sessões externo.
const _sessaoVersao = new Map(USUARIOS.map(u => [u.usuario, 1]));

function forcarLogoutUsuario(usuario) {
  _sessaoVersao.set(usuario, (_sessaoVersao.get(usuario) || 1) + 1);
}

// ── RATE LIMITING NO LOGIN ────────────────────────────────────
// Proteção simples contra força bruta: no máximo 5 tentativas de login por
// IP a cada 10 minutos. Em memória (sem dependência externa) — suficiente
// para o volume de uso deste sistema; reinicia se o servidor reiniciar,
// o que é aceitável aqui (não é uma defesa contra ataque distribuído).
const _loginTentativas = new Map(); // ip -> [timestamps]
const LOGIN_MAX_TENTATIVAS = 5;
const LOGIN_JANELA_MS = 10 * 60 * 1000;

function rateLimitLogin(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'desconhecido';
  const agora = Date.now();
  const tentativas = (_loginTentativas.get(ip) || []).filter(t => agora - t < LOGIN_JANELA_MS);
  if (tentativas.length >= LOGIN_MAX_TENTATIVAS) {
    const minutosRestantes = Math.ceil((LOGIN_JANELA_MS - (agora - tentativas[0])) / 60000);
    return res.send(loginPage(`Muitas tentativas. Tente novamente em ${minutosRestantes} minuto(s).`, req.body?.destino || '/'));
  }
  tentativas.push(agora);
  _loginTentativas.set(ip, tentativas);
  next();
}
// ── RATE LIMITING GENÉRICO (IA: /api/analisar e /api/chat) ────
// Mesmas ideias do rateLimitLogin acima (em memória, por IP), mas em fábrica
// pra poder configurar limite/janela por endpoint. Protege os proxies pra
// API paga da Anthropic contra uso abusivo/loop de erro no cliente — sem
// isso, qualquer usuário autenticado podia disparar chamadas ilimitadas.
function criarRateLimiter(nome, maxTentativas, janelaMs) {
  const tentativasPorIp = new Map(); // ip -> [timestamps]
  setInterval(() => {
    const agora = Date.now();
    for (const [ip, tentativas] of tentativasPorIp.entries()) {
      const ativas = tentativas.filter(t => agora - t < janelaMs);
      if (ativas.length) tentativasPorIp.set(ip, ativas);
      else tentativasPorIp.delete(ip);
    }
  }, 5 * 60 * 1000).unref?.();

  return function rateLimitMiddleware(req, res, next) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'desconhecido';
    const agora = Date.now();
    const tentativas = (tentativasPorIp.get(ip) || []).filter(t => agora - t < janelaMs);
    if (tentativas.length >= maxTentativas) {
      const minutosRestantes = Math.ceil((janelaMs - (agora - tentativas[0])) / 60000);
      return res.status(429).json({ erro: `Muitas requisições a ${nome}. Tente novamente em ${minutosRestantes} minuto(s).` });
    }
    tentativas.push(agora);
    tentativasPorIp.set(ip, tentativas);
    next();
  };
}
const rateLimitAnalisar = criarRateLimiter('/api/analisar', 20, 10 * 60 * 1000);
const rateLimitChat = criarRateLimiter('/api/chat', 30, 10 * 60 * 1000);

// Limpeza periódica para a memória não crescer indefinidamente
setInterval(() => {
  const agora = Date.now();
  for (const [ip, tentativas] of _loginTentativas.entries()) {
    const ativas = tentativas.filter(t => agora - t < LOGIN_JANELA_MS);
    if (ativas.length) _loginTentativas.set(ip, ativas);
    else _loginTentativas.delete(ip);
  }
}, 5 * 60 * 1000);

// ── MIDDLEWARE ────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
// Necessário para o Express reconhecer conexões como HTTPS mesmo estando
// atrás do proxy do Railway (que termina o SSL antes do container) — sem
// isso, cookie.secure=true bloquearia o cookie de sessão para todo mundo.
app.set('trust proxy', 1);
app.use(session({
  store: new SupabaseSessionStore(),
  secret: process.env.SESSION_SECRET || (() => {
    console.error('⚠️  SESSION_SECRET não configurado no Railway — usando valor temporário gerado neste boot (sessões serão invalidadas a cada deploy, mesmo com o store persistente).');
    return randomBytes(32).toString('hex');
  })(),
  resave: false,
  saveUninitialized: false,
  cookie: { secure: true, maxAge: 8 * 60 * 60 * 1000 },
}));
app.use(express.static(__dirname));

// ── LOGIN PAGE ────────────────────────────────────────────────
const LOGIN_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>IMPAK — Acesso</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#e8f0f8;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:'DM Sans',sans-serif;}
.wrap{width:400px;max-width:94vw;}
.logo-row{display:flex;align-items:center;gap:12px;justify-content:center;margin-bottom:28px;}
.logo-badge{background:#1a7fd4;color:#fff;font-family:'Syne',sans-serif;font-size:22px;font-weight:800;padding:6px 14px;border-radius:6px;letter-spacing:1px;}
.logo-sub{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#4a6480;letter-spacing:2px;text-transform:uppercase;}
.box{background:#fff;border:1px solid #c8d8e8;border-top:3px solid #1a7fd4;border-radius:14px;padding:36px 32px;box-shadow:0 8px 32px rgba(26,127,212,.1);}
h1{font-family:'Syne',sans-serif;font-size:17px;font-weight:700;color:#0d1e2e;text-align:center;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;}
.sub{font-size:11px;color:#1a7fd4;text-align:center;font-weight:600;letter-spacing:1px;text-transform:uppercase;margin-bottom:28px;}
label{display:block;font-size:10px;font-weight:700;color:#4a6480;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;}
input{width:100%;background:#dce8f5;border:1px solid #c8d8e8;border-radius:7px;color:#0d1e2e;font-family:'DM Sans',sans-serif;font-size:14px;padding:11px 14px;outline:none;transition:all .15s;margin-bottom:16px;}
input:focus{border-color:#1a7fd4;background:#c8ddf0;}
button{width:100%;background:#1a7fd4;border:none;border-radius:7px;color:#fff;font-family:'Syne',sans-serif;font-size:15px;font-weight:700;padding:12px;cursor:pointer;letter-spacing:.5px;text-transform:uppercase;transition:background .15s;margin-top:4px;}
button:hover{background:#1567b8;}
.err{background:rgba(192,57,43,.08);border:1px solid rgba(192,57,43,.25);border-radius:6px;padding:10px 14px;font-size:12px;color:#c0392b;font-weight:600;text-align:center;margin-bottom:16px;}
.footer{text-align:center;margin-top:18px;font-size:10px;color:#a8bfd4;}
</style>
</head>
<body>
<div class="wrap">
  <div class="logo-row">
    <div class="logo-badge">IMPAK</div>
    <div class="logo-sub">Portal</div>
  </div>
  <div class="box">
    <h1>Acesso ao Sistema</h1>
    <div class="sub">TyreDesk + Gestão de Processos</div>
    ERRO_PLACEHOLDER
    <form method="POST" action="/login">
      <label>Usuário ou e-mail</label>
      <input name="usuario" type="text" placeholder="seu usuário ou e-mail" autocomplete="username" required autofocus>
      <label>Senha</label>
      <input name="senha" type="password" placeholder="sua senha" autocomplete="current-password" required>
      <input type="hidden" name="destino" value="DESTINO_PLACEHOLDER">
      <button type="submit">Entrar</button>
    </form>
    <div style="text-align:center;margin-top:14px;">
      <a href="/esqueci-senha" style="font-size:12px;color:#1a7fd4;text-decoration:none;font-weight:600;">Esqueci minha senha</a>
    </div>
    <div class="footer">IMPAK Comercial Importadora · Portal v2.0 · Confidencial</div>
  </div>
</div>
</body>
</html>`;

function loginPage(erro, destino) {
  const destinoSeguro = sanitizeDestino(destino);
  return LOGIN_HTML
    .replace('ERRO_PLACEHOLDER', erro ? `<div class="err">${escapeHtml(erro)}</div>` : '')
    .replace('DESTINO_PLACEHOLDER', escapeHtml(destinoSeguro));
}

// Mesmo CSS da tela de login (extraído do LOGIN_HTML) — reaproveitado aqui
// pra manter a identidade visual sem duplicar o bloco <style> inteiro.
const AUTH_CSS = LOGIN_HTML.slice(LOGIN_HTML.indexOf('<style>'), LOGIN_HTML.indexOf('</style>')+8);

function esqueciSenhaPage(){
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>IMPAK — Esqueci minha senha</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
${AUTH_CSS}
</head>
<body>
<div class="wrap">
  <div class="logo-row"><div class="logo-badge">IMPAK</div><div class="logo-sub">Portal</div></div>
  <div class="box">
    <h1>Esqueci minha senha</h1>
    <div class="sub">Digite seu usuário ou e-mail</div>
    <div id="msg"></div>
    <label>Usuário ou e-mail</label>
    <input id="identificador" type="text" placeholder="ex: narcelio ou narcelio@impak.com.br" autofocus>
    <button onclick="enviar()">Enviar link de redefinição</button>
    <div style="text-align:center;margin-top:14px;">
      <a href="/login" style="font-size:12px;color:#1a7fd4;text-decoration:none;font-weight:600;">Voltar pro login</a>
    </div>
    <div class="footer">IMPAK Comercial Importadora · Portal v2.0 · Confidencial</div>
  </div>
</div>
<script>
async function enviar(){
  const identificador = document.getElementById('identificador').value.trim();
  const msg = document.getElementById('msg');
  if(!identificador){ msg.innerHTML = '<div class="err">Digite seu usuário ou e-mail.</div>'; return; }
  const btn = document.querySelector('button');
  btn.disabled = true; btn.textContent = 'Enviando...';
  try{
    const r = await fetch('/api/auth/esqueci-senha', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ identificador })
    });
    const d = await r.json();
    msg.innerHTML = '<div style="background:rgba(26,127,212,.08);border:1px solid rgba(26,127,212,.25);border-radius:6px;padding:12px 14px;font-size:12px;color:#1a7fd4;font-weight:600;text-align:center;margin-bottom:16px;">'+d.mensagem+'</div>';
    document.getElementById('identificador').value = '';
  }catch(e){
    msg.innerHTML = '<div class="err">Erro ao enviar. Tente novamente.</div>';
  }
  btn.disabled = false; btn.textContent = 'Enviar link de redefinição';
}
document.getElementById('identificador').addEventListener('keydown', e=>{ if(e.key==='Enter') enviar(); });
</script>
</body>
</html>`;
}

function redefinirSenhaPage(tokenValido){
  if(!tokenValido){
    return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>IMPAK — Link inválido</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
${AUTH_CSS}
</head><body><div class="wrap">
  <div class="logo-row"><div class="logo-badge">IMPAK</div><div class="logo-sub">Portal</div></div>
  <div class="box">
    <h1>Link expirado ou inválido</h1>
    <div class="err">Esse link de redefinição não é mais válido. Peça um novo.</div>
    <a href="/esqueci-senha"><button type="button">Pedir novo link</button></a>
  </div>
</div></body></html>`;
  }
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>IMPAK — Definir nova senha</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
${AUTH_CSS}
</head>
<body>
<div class="wrap">
  <div class="logo-row"><div class="logo-badge">IMPAK</div><div class="logo-sub">Portal</div></div>
  <div class="box">
    <h1>Definir nova senha</h1>
    <div class="sub">Mínimo de 6 caracteres</div>
    <div id="msg"></div>
    <label>Nova senha</label>
    <input id="novaSenha" type="password" placeholder="nova senha" autofocus>
    <label>Confirmar nova senha</label>
    <input id="confirmar" type="password" placeholder="repita a nova senha">
    <button onclick="salvar()">Salvar nova senha</button>
    <div class="footer">IMPAK Comercial Importadora · Portal v2.0 · Confidencial</div>
  </div>
</div>
<script>
async function salvar(){
  const novaSenha = document.getElementById('novaSenha').value;
  const confirmar = document.getElementById('confirmar').value;
  const msg = document.getElementById('msg');
  if(novaSenha.length < 6){ msg.innerHTML = '<div class="err">A senha precisa ter pelo menos 6 caracteres.</div>'; return; }
  if(novaSenha !== confirmar){ msg.innerHTML = '<div class="err">As senhas não são iguais.</div>'; return; }
  const btn = document.querySelector('button');
  btn.disabled = true; btn.textContent = 'Salvando...';
  try{
    const r = await fetch('/api/auth/redefinir-senha', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ token: new URLSearchParams(location.search).get('token'), novaSenha })
    });
    const d = await r.json();
    if(d.ok){
      msg.innerHTML = '<div style="background:rgba(22,163,74,.08);border:1px solid rgba(22,163,74,.25);border-radius:6px;padding:12px 14px;font-size:12px;color:#16a34a;font-weight:600;text-align:center;margin-bottom:16px;">✓ Senha alterada! Redirecionando pro login...</div>';
      setTimeout(()=>location.href='/login', 1500);
    } else {
      msg.innerHTML = '<div class="err">'+(d.erro||'Erro ao salvar.')+'</div>';
      btn.disabled = false; btn.textContent = 'Salvar nova senha';
    }
  }catch(e){
    msg.innerHTML = '<div class="err">Erro ao salvar. Tente novamente.</div>';
    btn.disabled = false; btn.textContent = 'Salvar nova senha';
  }
}
</script>
</body>
</html>`;
}

// ── AUTENTICAÇÃO ──────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session.usuario) return res.redirect(sanitizeDestino(req.query.destino));
  res.send(loginPage('', req.query.destino));
});

app.post('/login', rateLimitLogin, (req, res) => {
  const { usuario, senha, destino } = req.body;
  const login = (usuario || '').trim().toLowerCase();
  // Aceita tanto o usuário curto (ex: "emanuelly") quanto o e-mail
  // cadastrado (ex: "importacao1@impak.com.br") no mesmo campo — mesma
  // lógica de busca já usada em /api/auth/esqueci-senha. Sem isso, quem
  // digitasse o e-mail (rotulado como "Login" na planilha de cadastro)
  // caía em "usuário ou senha incorretos" mesmo com a senha certa.
  const u = _usuariosCache.get(login) || [..._usuariosCache.values()].find(x => (x.email||'').toLowerCase() === login);
  if (!u || !u.senha_hash || !verificarSenha(senha || '', u.senha_hash)) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'desconhecido';
    // Nunca logar a senha digitada, mesmo errada — só o usuário tentado, o
    // IP, e o horário, suficiente para notar um padrão de ataque sem criar
    // outro vazamento de dado sensível dentro dos próprios logs.
    console.warn(`[LOGIN FALHOU] usuário="${login}" ip=${ip} em ${new Date().toISOString()}`);
    return res.send(loginPage('Usuário ou senha incorretos.', destino || '/'));
  }
  req.session.usuario     = u.usuario;
  req.session.nome        = u.nome;
  req.session.modulos     = u.modulos;
  req.session.role        = u.role;
  req.session.displayName = u.display_name;
  // A senha (nem em hash) nunca é guardada na sessão — ela só precisa
  // existir no momento do login. Guardá-la aqui não tem uso real e só
  // criava o risco de ser devolvida de volta ao navegador via /api/me.
  req.session.versao      = _sessaoVersao.get(u.usuario) || 1;
  req.session.home        = u.home || '/';
  const destinoSeguro = sanitizeDestino(destino);
  res.redirect(destinoSeguro !== '/' ? destinoSeguro : (u.home || '/'));
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

// ── ENVIO DE E-MAIL (Resend) ────────────────────────────────────
// RESEND_API_KEY precisa estar configurada no Railway. RESEND_FROM é
// opcional — se não configurada, usa o domínio sandbox do Resend (só
// funciona pra testes, pra produção precisa verificar impak.com.br no
// painel do Resend e configurar RESEND_FROM=algo@impak.com.br).
async function enviarEmail(destinatario, assunto, html){
  const apiKey = process.env.RESEND_API_KEY;
  if(!apiKey) throw new Error('RESEND_API_KEY não configurada no Railway');
  const from = process.env.RESEND_FROM || 'IMPAK Portal <onboarding@resend.dev>';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [destinatario], subject: assunto, html }),
  });
  if(!r.ok){
    const erro = await r.text();
    throw new Error(`Resend respondeu ${r.status}: ${erro}`);
  }
  return await r.json();
}

// ── ESQUECI MINHA SENHA ──────────────────────────────────────────
// Fluxo: usuário pede reset (por usuário ou e-mail) → gera token aleatório,
// válido por 1h, salvo no Supabase → manda e-mail com link → usuário abre
// o link, define senha nova → token é invalidado e todas as sessões antigas
// daquele usuário são derrubadas (mesmo mecanismo do "Forçar logout").
//
// Sempre responde com a MESMA mensagem de sucesso, exista ou não o usuário/
// e-mail digitado — evita que alguém descubra quais usuários existem no
// sistema só testando e-mails aqui.
app.get('/esqueci-senha', (req, res) => {
  res.send(esqueciSenhaPage());
});

app.post('/api/auth/esqueci-senha', rateLimitLogin, async (req, res) => {
  const identificador = (req.body.identificador || '').trim().toLowerCase();
  const mensagemGenerica = { ok: true, mensagem: 'Se esse usuário ou e-mail existir, um link de redefinição foi enviado.' };
  if(!identificador) return res.json(mensagemGenerica);
  try{
    await recarregarCacheUsuarios();
    const u = [..._usuariosCache.values()].find(x => x.usuario === identificador || (x.email||'').toLowerCase() === identificador);
    if(!u) return res.json(mensagemGenerica); // não revela se existe ou não

    const token = randomBytes(32).toString('hex');
    const expira = new Date(Date.now() + 60*60*1000); // 1 hora
    // Só o hash do token é persistido — ver hashToken() acima.
    await sb().from('usuarios').update({ reset_token: hashToken(token), reset_token_expira: expira.toISOString() }).eq('usuario', u.usuario);
    await recarregarCacheUsuarios();

    const link = `${req.protocol}://${req.get('host')}/redefinir-senha?token=${token}`;
    await enviarEmail(u.email, 'Redefinir senha — IMPAK Portal',
      `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <h2 style="color:#1a7fd4;">IMPAK Portal</h2>
        <p>Olá, ${u.nome || u.usuario}. Foi solicitada a redefinição da sua senha.</p>
        <p><a href="${link}" style="background:#1a7fd4;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block;">Redefinir minha senha</a></p>
        <p style="font-size:12px;color:#666;">Esse link expira em 1 hora. Se você não pediu isso, pode ignorar este e-mail com segurança — sua senha não vai mudar.</p>
      </div>`
    );
    res.json(mensagemGenerica);
  } catch(e){
    console.error('Erro no esqueci-senha:', e.message);
    // Mesmo em erro interno, não expõe detalhe pro usuário final — só loga.
    res.json(mensagemGenerica);
  }
});

app.get('/redefinir-senha', async (req, res) => {
  const token = req.query.token || '';
  try{
    await recarregarCacheUsuarios();
    const u = buscarUsuarioPorTokenReset(token);
    const valido = u && u.reset_token_expira && new Date(u.reset_token_expira) > new Date();
    res.send(redefinirSenhaPage(valido ? token : null));
  } catch(e){
    res.send(redefinirSenhaPage(null));
  }
});

app.post('/api/auth/redefinir-senha', rateLimitLogin, async (req, res) => {
  try{
    const { token, novaSenha } = req.body;
    if(!token || !novaSenha || novaSenha.length < 6){
      return res.json({ ok: false, erro: 'Senha precisa ter pelo menos 6 caracteres.' });
    }
    await recarregarCacheUsuarios();
    const u = buscarUsuarioPorTokenReset(token);
    if(!u || !u.reset_token_expira || new Date(u.reset_token_expira) <= new Date()){
      return res.json({ ok: false, erro: 'Link expirado ou inválido. Peça um novo.' });
    }
    const novoHash = hashSenha(novaSenha);
    await sb().from('usuarios').update({
      senha_hash: novoHash, reset_token: null, reset_token_expira: null,
    }).eq('usuario', u.usuario);
    await recarregarCacheUsuarios();
    forcarLogoutUsuario(u.usuario); // derruba qualquer sessão antiga com a senha velha
    res.json({ ok: true });
  } catch(e){
    console.error('Erro ao redefinir senha:', e.message);
    res.json({ ok: false, erro: 'Erro interno. Tente novamente.' });
  }
});

// Força o logout de um usuário em TODOS os dispositivos/sessões abertas —
// útil ao trocar a senha de alguém, ou se houver suspeita de acesso
// indevido (ex: notebook perdido). Restrito a gerentes.
app.post('/api/usuarios/:usuario/forcar-logout', (req, res) => {
  if (!req.session.usuario) return res.status(401).json({ ok: false, erro: 'Não autenticado' });
  if (req.session.role !== 'gerente') return res.status(403).json({ ok: false, erro: 'Apenas gerentes podem fazer isso' });
  const alvo = (req.params.usuario || '').trim().toLowerCase();
  if (!USUARIOS.some(u => u.usuario === alvo)) return res.status(404).json({ ok: false, erro: 'Usuário não encontrado' });
  forcarLogoutUsuario(alvo);
  res.json({ ok: true, mensagem: `Todas as sessões de "${alvo}" foram invalidadas.` });
});

// Recarrega o cache de usuários (_usuariosCache) sob demanda. Necessário
// sempre que alguém edita senha_hash (ou qualquer outro campo de usuários)
// direto no Supabase via SQL — sem isso, o processo rodando continua com
// os dados antigos em memória até o próximo restart/deploy. Restrito a
// gerentes, e sujeito ao mesmo rate limit do login (evita brute-force via
// esse endpoint também).
app.post('/api/admin/recarregar-cache', rateLimitLogin, (req, res) => {
  if (!req.session.usuario) return res.status(401).json({ ok: false, erro: 'Não autenticado' });
  if (req.session.role !== 'gerente') return res.status(403).json({ ok: false, erro: 'Apenas gerentes podem fazer isso' });
  recarregarCacheUsuarios()
    .then(() => res.json({ ok: true, mensagem: `Cache recarregado (${_usuariosCache.size} usuários).` }))
    .catch(e => {
      console.error('Erro ao recarregar cache de usuários:', e.message);
      res.status(500).json({ ok: false, erro: 'Erro ao recarregar cache.' });
    });
});

function auth(modulo) {
  return (req, res, next) => {
    if (!req.session.usuario) return res.redirect('/login?destino=' + req.path);
    // Se a versão da sessão estiver desatualizada (alguém forçou logout
    // deste usuário, ex: ao trocar a senha), invalida mesmo com cookie válido.
    const versaoAtual = _sessaoVersao.get(req.session.usuario) || 1;
    if (req.session.versao !== versaoAtual) {
      return req.session.destroy(() => res.redirect('/login?destino=' + req.path));
    }
    if (modulo && !req.session.modulos.includes(modulo)) return res.status(403).send('<h2>Acesso negado</h2>');
    next();
  };
}

// Restringe exclusões (DELETE) a usuários com role "gerente". Antes, qualquer
// usuário do módulo "processos"/"tyredesk" podia excluir permanentemente
// processos, contatos, cotações e arquivos de outros — só o "forçar logout"
// era restrito a gerente. Usar SEMPRE depois de auth(modulo) na cadeia de
// middlewares (auth() já garante req.session.usuario/role existirem).
function requireGerente(req, res, next) {
  if (req.session.role !== 'gerente') {
    return res.status(403).json({ ok: false, erro: 'Apenas gerentes podem excluir.' });
  }
  next();
}

// ── PÁGINAS ───────────────────────────────────────────────────
app.get('/',          auth('tyredesk'),  (req, res) => res.sendFile(path.join(__dirname, 'tyredesk.html')));
app.get('/processos', auth('processos'), (req, res) => res.sendFile(path.join(__dirname, 'processos.html')));

// ── API: SESSÃO ───────────────────────────────────────────────
app.get('/api/me', (req, res) => {
  if (!req.session.usuario) return res.json({ logado: false });
  res.json({
    logado:      true,
    usuario:     req.session.usuario,
    nome:        req.session.nome,
    modulos:     req.session.modulos,
    role:        req.session.role,
    displayName: req.session.displayName,
  });
});

// ── API: CONFERÊNCIA ──────────────────────────────────────────
app.get('/api/conferencia/index', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('conferencia_processos')
      .select('id, ref, exportador, obs, status, data, created_by, updated_at, dados')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    const index = (data || []).map(p => ({
      id:           p.id,
      ref:          p.ref        || '',
      exportador:   p.exportador || '',
      obs:          p.obs        || '',
      status:       p.status     || 'ok',
      data:         p.data       || '',
      _user:        p.created_by || '',
      _updatedAt:   new Date(p.updated_at).getTime(),
      _divResolvedMap: (p.dados && p.dados._divResolvedMap) ? p.dados._divResolvedMap : {},
      analises:     (p.dados && p.dados.analises) ? p.dados.analises.map(a => ({
        id: a.id, data: a.data, docs: a.docs, resumo: a.resumo,
        grupos: a.grupos || [],
        alertas: a.alertas || [],
      })) : [],
    }));
    console.log(`/api/conferencia/index: ${index.length} processos`);
    res.json({ ok: true, index, total: index.length });
  } catch (e) {
    console.error('conferencia/index erro:', e.message);
    res.json({ ok: true, index: [], total: 0 });
  }
});

app.get('/api/conferencia/processo/:id', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('conferencia_processos')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    if (!data) return res.json({ ok: false, processo: null });
    const proc = { ...data.dados, id: data.id, ref: data.ref,
      exportador: data.exportador, obs: data.obs, status: data.status,
      data: data.data, _user: data.created_by,
      _updatedAt: new Date(data.updated_at).getTime() };
    res.json({ ok: true, processo: proc });
  } catch (e) {
    console.error('conferencia/processo GET erro:', e.message);
    res.json({ ok: false, processo: null });
  }
});

app.post('/api/conferencia/processo', auth('processos'), async (req, res) => {
  try {
    const { processo } = req.body;
    if (!processo || !processo.id) return res.status(400).json({ erro: 'Processo inválido' });
    const row = {
      id:         processo.id,
      ref:        processo.ref        || '',
      exportador: processo.exportador || '',
      obs:        processo.obs        || '',
      status:     processo.status     || 'ok',
      data:       processo.data       || new Date().toLocaleDateString('pt-BR'),
      created_by: processo._user      || req.session.usuario,
      updated_by: req.session.usuario,
      updated_at: new Date().toISOString(),
      dados:      processo,
    };
    const { error } = await sb()
      .from('conferencia_processos')
      .upsert(row, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    console.log(`conferencia salvo: ${processo.ref} por ${req.session.usuario}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('conferencia/processo POST erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

app.delete('/api/conferencia/processo/:id', auth('processos'), requireGerente, async (req, res) => {
  try {
    const { error } = await sb()
      .from('conferencia_processos')
      .delete()
      .eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (e) {
    console.error('conferencia/processo DELETE erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// ── API: CONTROLE v2 ──────────────────────────────────────────
app.get('/controle', auth('processos'), (req, res) => res.sendFile(path.join(__dirname, 'controle_v2.html')));
// "Tela exclusiva" do Dashboard Financeiro — serve o MESMO controle_v2.html
// (o front-end detecta location.pathname==='/financeiro' e ajusta o que
// aparece na tela). Evita duplicar toda a lógica de abrir/editar processo,
// upload de documentos, autocomplete de contatos etc. num arquivo separado
// que rapidamente ficaria desatualizado em relação ao Controle de verdade.
app.get('/financeiro', auth('processos'), (req, res) => res.sendFile(path.join(__dirname, 'controle_v2.html')));
// "Tela exclusiva" do Dashboard Resultado (lucro estimado x real de todos
// os processos) — mesmo esquema do /financeiro acima: serve o MESMO
// controle_v2.html, e o front-end detecta location.pathname==='/resultado'
// pra abrir direto no Dashboard Resultado (ver ativarTelaResultadoExclusiva
// em controle-core.js).
app.get('/resultado', auth('processos'), (req, res) => res.sendFile(path.join(__dirname, 'controle_v2.html')))
// "Tela exclusiva" do Dashboard Narcélio (visão do dono da empresa) —
// diferente de /financeiro e /resultado (visíveis a qualquer usuário com o
// módulo "processos"), aqui o back-end também confere o usuário logado:
// containers em água, faturamento e previsão de caixa são dados sensíveis
// que não devem ficar visíveis pra todo mundo que usa o Controle. Ver
// renderDashNarcelio() em controle-dash-narcelio.js e
// ativarTelaNarcelioExclusiva() em controle-core.js.
app.get('/narcelio', auth('processos'), (req, res) => {
  if (req.session.usuario !== 'narcelio') return res.status(403).send('Acesso restrito.')
  res.sendFile(path.join(__dirname, 'controle_v2.html'))
});
// Deep-link por processo — /controle/UD26-005 serve o mesmo controle_v2.html;
// o front-end lê location.pathname no load e abre o painel lateral do
// processo correspondente automaticamente (ver abrirProcessoPorURL()).
app.get('/controle/:ref', auth('processos'), (req, res) => res.sendFile(path.join(__dirname, 'controle_v2.html')));
app.get('/calculador', auth('tyredesk'), (req, res) => res.sendFile(path.join(__dirname, 'calculador.html'), {headers:{'Content-Type':'text/html; charset=utf-8'}}));

app.get('/api/controle/v2/processos', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_processos')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    res.json({ ok: true, processos: data || [] });
  } catch (e) {
    console.error('controle v2 GET erro:', e.message);
    res.json({ ok: true, processos: [] });
  }
});

app.post('/api/controle/v2/importar', auth('processos'), async (req, res) => {
  try {
    const { processos } = req.body;
    if (!processos || !processos.length) return res.json({ ok: true, total: 0 });
    const agora = new Date().toISOString();

    // Buscar referências já existentes para evitar duplicatas
    const refs = processos.map(p => p.referencia).filter(Boolean);
    const { data: existentes } = await sb()
      .from('controle_processos')
      .select('id, referencia')
      .in('referencia', refs);

    const refsExistentes = new Set((existentes||[]).map(e => e.referencia));

    // Só inserir os que não existem
    const novos = processos
      .filter(p => p.referencia && !refsExistentes.has(p.referencia))
      .map(p => ({
        ...p,
        id: p.id || gerarUUID(),
        updated_at: agora,
        created_at: p.created_at || agora,
      }));

    if (!novos.length) {
      return res.json({ ok: true, total: 0, msg: 'Todos os processos já existem' });
    }

    // Inserir em lotes de 50
    for (let i = 0; i < novos.length; i += 50) {
      const { error } = await sb()
        .from('controle_processos')
        .insert(novos.slice(i, i + 50));
      if (error) throw new Error(error.message);
    }

    console.log(`controle v2 importar: ${novos.length} novos de ${processos.length} por ${req.session.usuario}`);
    res.json({ ok: true, total: novos.length, ignorados: processos.length - novos.length });
  } catch (e) {
    console.error('controle v2 importar erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

app.post('/api/controle/v2/processo', auth('processos'), async (req, res) => {
  try {
    const { processo } = req.body;
    if (!processo) return res.status(400).json({ erro: 'Processo ausente' });
    // Referência só é obrigatória ao CRIAR (sem id ainda) — em edições
    // parciais (ver controle_v2.html: coletarESalvar/salvarProcesso agora
    // manda só os campos que o usuário de fato alterou, pra não sobrescrever
    // edições concorrentes de outro usuário) o payload pode legitimamente
    // não incluir "referencia" se ela não foi um dos campos alterados.
    if (!processo.id && !processo.referencia) return res.status(400).json({ erro: 'Referência obrigatória' });

    // ── TRAVA DE PROCESSO ("Fechar Processo") ────────────────────────
    // Depois de conferido, o processo pode ser fechado (ver botão 🔒 no
    // painel do processo) pra impedir que NF, custos reais, lucro etc.
    // mudem por engano — trava o processo INTEIRO, não só os campos
    // financeiros, porque é mais simples e mais previsível do que travar
    // campo a campo. Isso é reforçado aqui no servidor (não só escondido/
    // desabilitado no front-end) porque a trava só vale alguma coisa se
    // não der pra contornar chamando a API direto.
    if (processo.id) {
      const { data: atual } = await sb()
        .from('controle_processos')
        .select('fechado')
        .eq('id', processo.id)
        .maybeSingle();
      const estavaFechado = !!(atual && atual.fechado);
      const tentandoDestravar = estavaFechado && processo.fechado === false;
      const tentandoTravar    = !estavaFechado && processo.fechado === true;

      if (estavaFechado && !tentandoDestravar) {
        return res.status(403).json({ erro: 'Processo fechado — reabra para editar (só gerente pode reabrir).' });
      }
      if (tentandoDestravar && req.session.role !== 'gerente') {
        return res.status(403).json({ erro: 'Só um gerente pode reabrir um processo fechado.' });
      }
      // fechado_em/fechado_por são registrados pelo servidor, nunca aceitos
      // direto do cliente — evita que alguém finja ter travado/destravado
      // em outro momento ou como outro usuário.
      if (tentandoTravar) {
        processo.fechado_em = new Date().toISOString();
        processo.fechado_por = req.session.usuario;
      } else if (tentandoDestravar) {
        processo.fechado_em = null;
        processo.fechado_por = null;
      } else {
        delete processo.fechado; // não deixa alterar a trava por acidente num save comum
      }
    }

    if (!processo.id) processo.id = gerarUUID();
    processo.updated_at = new Date().toISOString();

    // Log de auditoria no banco
    const logEntries = (processo.log || []).filter(l => !l._saved);
    if (logEntries.length) {
      const rows = logEntries.map(l => ({
        processo_id: processo.id,
        usuario: l.usuario || req.session.usuario,
        campo: l.campo || '',
        valor_antes: String(l.valor_antes || ''),
        valor_depois: String(l.valor_depois || ''),
        created_at: l.created_at || new Date().toISOString(),
      }));
      try {
        await sb().from('controle_log').insert(rows);
      } catch(logErr) {
        console.warn('log erro:', logErr.message);
      }
      processo.log = (processo.log || []).map(l => ({ ...l, _saved: true }));
    }

    // Remover campos internos antes de salvar no banco
    const { log: _log, _fasePrevista, _savedAt, ...processoLimpo } = processo;

    const { error } = await sb()
      .from('controle_processos')
      .upsert(processoLimpo, { onConflict: 'id' });
    if (error) throw new Error(error.message);

    // Criar notificação de demurrage se necessário
    if (processo.demurrage_vencimento) {
      const venc = new Date(processo.demurrage_vencimento);
      const dias = Math.ceil((venc - new Date()) / 86400000);
      if (dias <= 5 && dias >= 0 && !processo.data_devolucao_vazio) {
        try {
          await sb().from('controle_notificacoes').insert({
            processo_id: processo.id,
            tipo: 'urgente',
            titulo: `Demurrage: ${processo.referencia}`,
            mensagem: `Container vence em ${dias} dia(s)!`,
            created_by: req.session.usuario,
          });
        } catch(notifErr) {
          console.warn('notificacao erro:', notifErr.message);
        }
      }
    }

    console.log(`controle v2 salvo: ${processo.referencia} por ${req.session.usuario}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('controle v2 POST erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// Histórico de alterações de um processo — faltava esta rota: o front-end
// (controle_v2.html) já chamava GET /api/controle/v2/processo/:id/log desde
// sempre, mas como a rota nunca existiu, a aba "Histórico" sempre recebia
// 404 e mostrava "sem histórico" mesmo com registros salvos normalmente na
// tabela controle_log (o insert em POST /api/controle/v2/processo sempre
// funcionou — só faltava como ler de volta).
app.get('/api/controle/v2/processo/:id/log', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_log')
      .select('usuario, campo, valor_antes, valor_depois, created_at')
      .eq('processo_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    res.json({ ok: true, log: data || [] });
  } catch (e) {
    console.error('controle v2 log erro:', e.message);
    res.json({ ok: true, log: [] });
  }
});

app.delete('/api/controle/v2/processo/:id', auth('processos'), requireGerente, async (req, res) => {
  try {
    const { error } = await sb().from('controle_processos').delete().eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

app.get('/api/controle/v2/notificacoes', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_notificacoes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    res.json({ ok: true, notificacoes: data || [] });
  } catch (e) {
    res.json({ ok: true, notificacoes: [] });
  }
});

app.post('/api/controle/v2/notificacao', auth('processos'), async (req, res) => {
  try {
    const { processo_id, tipo, titulo, mensagem } = req.body;
    await sb().from('controle_notificacoes').insert({
      processo_id, tipo, titulo, mensagem, created_by: req.session.usuario,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

app.post('/api/controle/v2/notificacao/:id/lida', auth('processos'), async (req, res) => {
  try {
    const { usuario } = req.body;
    const { data } = await sb().from('controle_notificacoes').select('lida_por').eq('id', req.params.id).single();
    const lidaPor = [...(data?.lida_por || [])];
    if (!lidaPor.includes(usuario)) lidaPor.push(usuario);
    await sb().from('controle_notificacoes').update({ lida_por: lidaPor }).eq('id', req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});


app.get('/api/controle/index', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_processos')
      .select('id, referencia, cliente, fase, status, updated_at, dados')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    const index = (data || []).map(p => {
      const d = p.dados || {};
      return {
        id: p.id, referencia: p.referencia, cliente: p.cliente,
        fase: p.fase, status: p.status,
        exportador: d.exportador||'', eta: d.eta||'',
        data_chegada: d.data_chegada||'', data_embarque: d.data_embarque||'',
        porto: d.porto||'', armador: d.armador||'', free_time: d.free_time||21,
        canal_parametrizacao: d.canal_parametrizacao||'', hbl: d.hbl||'',
        numero_di: d.numero_di||'', data_presenca: d.data_presenca||'',
        data_retirada: d.data_retirada||'', data_ric: d.data_ric||'',
        navio: d.navio||'', previsao_prontidao: d.previsao_prontidao||'',
        agente: d.agente||'', despachante: d.despachante||'',
        produtos: d.produtos||'', quant_containers: d.quant_containers||'',
        _updatedAt: new Date(p.updated_at).getTime(),
      };
    });
    res.json({ ok: true, index, processos: index, total: index.length });
  } catch (e) {
    console.error('controle/index erro:', e.message);
    res.json({ ok: true, index: [], processos: [], total: 0 });
  }
});

app.get('/api/controle/processo/:id', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_processos')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    if (!data) return res.json({ ok: false, processo: null });
    const proc = { ...data.dados, id: data.id, referencia: data.referencia,
      cliente: data.cliente, fase: data.fase };
    res.json({ ok: true, processo: proc });
  } catch (e) {
    console.error('controle/processo GET erro:', e.message);
    res.json({ ok: false, processo: null });
  }
});

app.post('/api/controle/processo', auth('processos'), async (req, res) => {
  try {
    const { processo } = req.body;
    if (!processo || !processo.id) return res.status(400).json({ erro: 'Processo inválido' });
    const row = {
      id:         processo.id,
      referencia: processo.referencia || '',
      cliente:    processo.cliente    || '',
      fase:       processo.fase       || 'PRODUCAO',
      status:     processo.status     || 'ativo',
      updated_by: req.session.usuario,
      updated_at: new Date().toISOString(),
      dados:      processo,
    };
    const { error } = await sb()
      .from('controle_processos')
      .upsert(row, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    console.log(`controle salvo: ${processo.referencia} por ${req.session.usuario}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('controle/processo POST erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

app.delete('/api/controle/processo/:id', auth('processos'), requireGerente, async (req, res) => {
  try {
    const { error } = await sb()
      .from('controle_processos')
      .delete()
      .eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (e) {
    console.error('controle/processo DELETE erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

app.post('/api/controle/importar', auth('processos'), async (req, res) => {
  try {
    const { processos } = req.body;
    if (!processos || !processos.length) return res.json({ ok: true, total: 0 });

    const agora = new Date().toISOString();

    // Buscar referências já existentes
    const refs = processos.map(p => p.referencia).filter(Boolean);
    const { data: existentes } = await sb()
      .from('controle_processos')
      .select('referencia')
      .in('referencia', refs);
    const refsExistentes = new Set((existentes||[]).map(e => e.referencia));

    const novos = processos
      .filter(p => p.referencia && !refsExistentes.has(p.referencia))
      .map(p => {
        // Suportar tanto formato antigo (com dados{}) quanto novo (campos diretos)
        const d = p.dados || p;
        return {
          id:                  p.id || gerarUUID(),
          referencia:          p.referencia || d.referencia || '',
          fornecedor:          d.fornecedor  || '',
          cliente:             d.cliente     || p.cliente || '',
          produto:             d.produto     || '',
          fase:                d.fase        || p.fase || 'PI',
          eta:                 d.eta         || null,
          etd:                 d.etd         || null,
          data_embarque:       d.data_embarque || null,
          data_chegada:        d.data_chegada  || null,
          data_presenca:       d.data_presenca || null,
          armador:             d.armador     || '',
          navio:               d.navio       || '',
          container:           d.container   || '',
          hbl:                 d.hbl         || '',
          mbl:                 d.mbl         || '',
          numero_di:           d.numero_di   || '',
          obs:                 d.obs         || '',
          free_time:           d.free_time   || 21,
          demurrage_vencimento: d.demurrage_vencimento || null,
          created_by:          p.created_by || req.session.usuario,
          updated_by:          req.session.usuario,
          updated_at:          agora,
          created_at:          p.created_at || agora,
        };
      });

    if (!novos.length) {
      return res.json({ ok: true, total: 0, msg: 'Todos já existem' });
    }

    for (let i = 0; i < novos.length; i += 50) {
      const { error } = await sb()
        .from('controle_processos')
        .insert(novos.slice(i, i + 50));
      if (error) throw new Error(error.message);
    }

    console.log(`controle/importar: ${novos.length} novos de ${processos.length} por ${req.session.usuario}`);
    res.json({ ok: true, total: novos.length, ignorados: processos.length - novos.length });
  } catch (e) {
    console.error('controle/importar erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

app.get('/api/controle/carregar', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_processos')
      .select('dados')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    res.json({ ok: true, processos: (data || []).map(r => r.dados) });
  } catch (e) { res.json({ ok: true, processos: [] }); }
});

// ── API: TYREDESK ─────────────────────────────────────────────
app.post('/api/base/salvar', auth('tyredesk'), async (req, res) => {
  try {
    const { base } = req.body;
    const { error } = await sb()
      .from('tyredesk_base')
      .upsert({ id: 1, dados: base, updated_by: req.session.usuario, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    console.log(`TyreDesk base salva por ${req.session.usuario}: ${base.length} itens`);
    res.json({ ok: true, total: base.length });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/base/carregar', auth(), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('tyredesk_base')
      .select('dados, updated_at, updated_by')
      .eq('id', 1)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    const base = data ? data.dados : null;
    res.json({
      ok: !!base,
      base,
      total: base ? base.length : 0,
      updated_at: data ? data.updated_at : null,
      updated_by: data ? data.updated_by : null,
    });
  } catch (e) { res.json({ ok: false, base: null }); }
});

app.post('/api/base/salvar-fornecedores', auth('tyredesk'), async (req, res) => {
  try {
    const { fornecedores } = req.body;
    const { error } = await sb()
      .from('tyredesk_fornecedores')
      .upsert({ id: 1, dados: fornecedores, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/base/carregar-fornecedores', auth(), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('tyredesk_fornecedores')
      .select('dados')
      .eq('id', 1)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    res.json({ ok: true, fornecedores: data ? data.dados : null });
  } catch (e) { res.json({ ok: false, fornecedores: null }); }
});

app.post('/api/base/salvar-snapshots', auth('tyredesk'), async (req, res) => {
  try {
    const { snapshots } = req.body;
    const { error } = await sb()
      .from('tyredesk_fornecedores')
      .upsert({ id: 2, dados: snapshots, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/base/carregar-snapshots', auth(), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('tyredesk_fornecedores')
      .select('dados')
      .eq('id', 2)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    res.json({ ok: true, snapshots: data ? data.dados : [] });
  } catch (e) { res.json({ ok: true, snapshots: [] }); }
});

// ── API: ANÁLISE DOCUMENTAL ───────────────────────────────────
app.post('/api/analisar', auth('processos'), rateLimitAnalisar, async (req, res) => {
  const { content } = req.body;
  if (!content || !Array.isArray(content)) {
    return res.status(400).json({ erro: 'Conteúdo inválido' });
  }
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key || key.length < 20) {
    return res.status(500).json({ erro: 'ANTHROPIC_API_KEY não configurada no servidor. Configure-a nas variáveis de ambiente do Railway.' });
  }

  // ── Padrão job assíncrono ───────────────────────────────────
  // Análises longas (até ~2-3min com vários documentos) não podem viver
  // dentro de uma única requisição HTTP: qualquer proxy no meio do caminho
  // (Railway, navegador) pode considerar a conexão parada e derrubá-la —
  // aí o usuário via "Erro 502" mesmo com o processamento ainda rodando.
  // Aqui só criamos o job e respondemos na hora; o processamento roda em
  // background e o cliente consulta o resultado via polling em
  // GET /api/analisar/job/:id (ver runAnalysis() em processos.html).
  const jobId = gerarUUID();
  const usuario = req.session?.usuario || '?';
  const _nDocs = content.length;
  const { error: insErr } = await sb()
    .from('analise_jobs')
    .insert({ id: jobId, status: 'processando', usuario });
  if (insErr) {
    console.error('analisar: erro ao criar job:', insErr.message);
    return res.status(500).json({ erro: 'Erro ao iniciar análise: ' + insErr.message });
  }
  res.json({ ok: true, jobId });

  // Processamento em background — não bloqueia a resposta acima.
  (async () => {
    const _t0 = Date.now();
    console.log(`analisar: início (job ${jobId}) | ${_nDocs} item(ns) | usuario=${usuario}`);
    // Erros transitórios (sobrecarga/instabilidade momentânea da Anthropic) não
    // devem virar erro pro usuário — como o processamento roda em background,
    // dá pra tentar de novo sem custo de UX. 429/500/502/503/529 são status
    // que a própria Anthropic recomenda re-tentar.
    const RETRYAVEIS = [429, 500, 502, 503, 529];
    const MAX_TENTATIVAS = 2;
    async function _callAnthropic(tentativa){
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 150000);
      try {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 16000, messages: [{ role: 'user', content }] }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!resp.ok) {
          if (RETRYAVEIS.includes(resp.status) && tentativa < MAX_TENTATIVAS) {
            const espera = 2000 * tentativa;
            console.warn(`analisar: erro transitório (job ${jobId}, Anthropic ${resp.status}, tentativa ${tentativa}/${MAX_TENTATIVAS}) | retry em ${espera}ms`);
            await new Promise(r => setTimeout(r, espera));
            return _callAnthropic(tentativa + 1);
          }
          const err = await resp.json().catch(() => ({}));
          throw new Error(`API Anthropic erro ${resp.status}: ${err?.error?.message || resp.statusText}`);
        }
        return await resp.json();
      } catch (e) {
        clearTimeout(timeout);
        if (e.name === 'AbortError' && tentativa < MAX_TENTATIVAS) {
          console.warn(`analisar: timeout parcial (job ${jobId}, tentativa ${tentativa}/${MAX_TENTATIVAS}) | retry`);
          return _callAnthropic(tentativa + 1);
        }
        throw e;
      }
    }
    try {
      const respData = await _callAnthropic(1);
      console.log(`analisar: ok (job ${jobId}) | ${Date.now() - _t0}ms | ${_nDocs} item(ns)`);
      await sb().from('analise_jobs').update({ status: 'concluido', resultado: respData, updated_at: new Date().toISOString() }).eq('id', jobId);
    } catch (fetchErr) {
      const msg = fetchErr.name === 'AbortError'
        ? 'Análise demorou demais mesmo com novas tentativas. Tente com menos documentos.'
        : fetchErr.message;
      console.warn(`analisar: erro (job ${jobId}): ${msg} | ${Date.now() - _t0}ms`);
      await sb().from('analise_jobs').update({ status: 'erro', erro: msg, updated_at: new Date().toISOString() }).eq('id', jobId);
    }
  })();
});

app.get('/api/analisar/job/:id', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('analise_jobs')
      .select('status, resultado, erro')
      .eq('id', req.params.id)
      .single();
    if (error) throw new Error(error.message);
    res.json({ ok: true, status: data.status, resultado: data.resultado, erro: data.erro });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ── GED — ARQUIVOS DO PROCESSO (Supabase Storage) ──────────────
const GED_BUCKET = 'controle-arquivos';

app.get('/api/controle/v2/arquivos/:processoId', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_arquivos')
      .select('id, nome, tipo, tamanho, storage_path, created_at, created_by')
      .eq('processo_id', req.params.processoId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    const arquivos = await Promise.all((data || []).map(async a => {
      const { data: urlData } = sb().storage.from(GED_BUCKET).getPublicUrl(a.storage_path);
      return { ...a, url: urlData?.publicUrl || '' };
    }));
    res.json({ ok: true, arquivos });
  } catch (e) {
    console.error('ged listar erro:', e.message);
    res.json({ ok: true, arquivos: [] });
  }
});

app.post('/api/controle/v2/arquivos', auth('processos'), async (req, res) => {
  try {
    const { processo_id, nome, tipo, base64 } = req.body;
    if (!processo_id || !nome || !base64) return res.status(400).json({ erro: 'Dados incompletos' });

    const tiposPermitidos = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (!tiposPermitidos.includes(tipo)) return res.status(400).json({ erro: 'Tipo de arquivo não permitido' });

    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length > 15 * 1024 * 1024) return res.status(400).json({ erro: 'Arquivo maior que 15MB' });

    const arquivoId = gerarUUID();
    const extensao = nome.split('.').pop();
    const storagePath = `${processo_id}/${arquivoId}.${extensao}`;

    const { error: uploadError } = await sb().storage
      .from(GED_BUCKET)
      .upload(storagePath, buffer, { contentType: tipo, upsert: false });
    if (uploadError) throw new Error(uploadError.message);

    const { error: dbError } = await sb().from('controle_arquivos').insert({
      id: arquivoId,
      processo_id,
      nome,
      tipo,
      tamanho: buffer.length,
      storage_path: storagePath,
      created_by: req.session.usuario,
      created_at: new Date().toISOString(),
    });
    if (dbError) throw new Error(dbError.message);

    console.log(`ged upload: ${nome} (${(buffer.length/1024).toFixed(0)}KB) processo=${processo_id} por ${req.session.usuario}`);
    res.json({ ok: true, id: arquivoId });
  } catch (e) {
    console.error('ged upload erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

app.delete('/api/controle/v2/arquivos/:id', auth('processos'), requireGerente, async (req, res) => {
  try {
    const { data: arquivo } = await sb()
      .from('controle_arquivos')
      .select('storage_path')
      .eq('id', req.params.id)
      .single();
    if (arquivo?.storage_path) {
      await sb().storage.from(GED_BUCKET).remove([arquivo.storage_path]);
    }
    const { error } = await sb().from('controle_arquivos').delete().eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (e) {
    console.error('ged excluir erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// ── CONTATOS (Clientes, Fornecedores, Despachantes, Agentes) ──
app.get('/api/contatos', auth(), async (req, res) => {
  try {
    const { q, tipo, uf, limit } = req.query;
    const lim = Math.min(parseInt(limit) || 30, 1000);
    let query = sb().from('contatos_clientes').select('id,cnpj,razao_social,nome_fantasia,cidade,uf,email,telefone,tipo,obs').eq('ativo', true);
    // tipo aceita mais de um valor separado por vírgula (ex: "FORNECEDOR,EXPORTADOR")
    // — usado pelo campo "Fornecedor (Exportador)" do processo, que precisa achar
    // contatos cadastrados em QUALQUER uma dessas duas categorias (antes buscava
    // só EXPORTADOR, então um contato cadastrado como Fornecedor nunca aparecia
    // no autocomplete daquele campo, mesmo existindo no cadastro).
    if (tipo) {
      const tipos = tipo.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
      query = tipos.length > 1 ? query.in('tipo', tipos) : query.eq('tipo', tipos[0]);
    }
    if (uf)   query = query.eq('uf', uf.toUpperCase());
    if (q && q.length >= 2) {
      // Remove caracteres com significado especial na sintaxe do filtro
      // .or() do PostgREST (vírgula separa condições, % é wildcard do
      // ilike, parênteses/asterisco também têm sentido sintático) — sem
      // isso, buscar por algo como "Silva, Lima" quebrava a query com erro.
      const qSeguro = q.replace(/[,%*()]/g, '').trim();
      if (qSeguro.length >= 2) {
        query = query.or(`razao_social.ilike.%${qSeguro}%,cnpj.ilike.%${qSeguro}%,nome_fantasia.ilike.%${qSeguro}%`);
      }
    }
    query = query.order('razao_social').limit(lim);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    res.json({ ok: true, contatos: data || [] });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

app.post('/api/contatos', auth('processos'), async (req, res) => {
  try {
    const c = req.body;
    if (!c.razao_social) return res.status(400).json({ erro: 'Razão social obrigatória' });
    const isNovo = !c.id;
    if (!c.id) c.id = require('crypto').randomUUID();

    // Trava de duplicidade — só entra em ação na CRIAÇÃO de um contato novo
    // (editar um contato existente passa direto, mesmo mantendo o nome).
    // Considera duplicado quando: (a) o CNPJ informado já existe em outro
    // cadastro ativo, ou (b) a razão social (ignorando maiúsculas/espaços
    // extras) já existe ativa NO MESMO TIPO. CNPJs diferentes com o mesmo
    // nome continuam permitidos de propósito — isso normalmente é
    // matriz/filial em cidades diferentes, não duplicidade de cadastro
    // (mesma lógica usada na limpeza dos duplicados existentes).
    if (isNovo) {
      const cnpjDigits = (c.cnpj || '').replace(/\D/g, '');
      const nomeNorm = (c.razao_social || '').trim().toUpperCase().replace(/\s+/g, ' ');
      const { data: existentes, error: buscaErro } = await sb()
        .from('contatos_clientes')
        .select('id, razao_social, cnpj, tipo')
        .eq('ativo', true);
      if (buscaErro) throw new Error(buscaErro.message);
      const duplicado = (existentes || []).find(e => {
        if (cnpjDigits && (e.cnpj || '') === cnpjDigits) return true;
        // Duplicidade por NOME só conta quando NENHUM dos dois lados tem
        // CNPJ pra diferenciar (caso típico: exportador/armador/agente
        // estrangeiro, sem CNPJ brasileiro). Se qualquer um dos dois tiver
        // CNPJ e forem diferentes, não bloqueia — é matriz/filial legítima
        // com o mesmo nome em CNPJs diferentes (mesma regra usada na
        // limpeza dos duplicados existentes).
        if (cnpjDigits || e.cnpj) return false;
        const eNome = (e.razao_social || '').trim().toUpperCase().replace(/\s+/g, ' ');
        return eNome === nomeNorm && e.tipo === c.tipo;
      });
      if (duplicado) {
        const motivo = cnpjDigits && duplicado.cnpj === cnpjDigits ? 'esse CNPJ' : 'esse nome e tipo';
        return res.status(409).json({
          erro: `Já existe um cadastro ativo com ${motivo}: "${duplicado.razao_social}". Edite o cadastro existente em vez de criar outro.`,
          duplicado_id: duplicado.id,
        });
      }
    }

    c.updated_at = new Date().toISOString();
    const { error } = await sb().from('contatos_clientes').upsert(c, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    res.json({ ok: true, id: c.id });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

app.delete('/api/contatos/:id', auth('processos'), requireGerente, async (req, res) => {
  try {
    const { error } = await sb().from('contatos_clientes').update({ ativo: false }).eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

app.post('/api/calculador/importar-planilha', auth('tyredesk'), (req, res) => { try { const { arquivo_base64 } = req.body; if (!arquivo_base64) return res.status(400).json({ ok: false, erro: 'Nenhum arquivo enviado.' }); const buffer = Buffer.from(arquivo_base64, 'base64'); const resultado = importarPlanilhaBase(buffer); res.json({ ok: true, campos: resultado.campos, mix: resultado.mix }); } catch (e) { console.error('Erro ao importar planilha:', e.message); res.status(400).json({ ok: false, erro: e.message }); } });
app.post('/api/controle/importar-fechamento', auth('processos'), (req, res) => { try { const { arquivo_base64 } = req.body; if (!arquivo_base64) return res.status(400).json({ ok: false, erro: 'Nenhum arquivo enviado.' }); const buffer = Buffer.from(arquivo_base64, 'base64'); const resultado = importarFechamentoBase(buffer); res.json({ ok: true, datas: resultado.datas, real_json: resultado.real_json, moedas: resultado.moedas, avisos: resultado.avisos }); } catch (e) { console.error('Erro ao importar fechamento:', e.message); res.status(400).json({ ok: false, erro: e.message }); } });
// ── CALCULADOR: COTAÇÕES SALVAS ──────────────────────────────────
// Lista leve (só o resumo, não o formulário inteiro) pra tela de listagem.
app.get('/api/calculador/cotacoes', auth('tyredesk'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('calculador_cotacoes')
      .select('id,cliente,numero,resumo,updated_at,updated_by')
      .eq('ativo', true)
      .order('updated_at', { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    res.json({ ok: true, cotacoes: data || [] });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// Registro completo (formulário + mix) pra reabrir no Calculador.
app.get('/api/calculador/cotacoes/:id', auth('tyredesk'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('calculador_cotacoes')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) throw new Error(error.message);
    res.json({ ok: true, cotacao: data });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// Criar/atualizar. Sem id no corpo = cria novo (usado tanto pra "Salvar"
// quanto pra "Duplicar", já que duplicar só manda os dados sem o id original).
//
// IMPORTANTE: o front (resumoParaLista, calculador.html) só manda os campos
// de CÁLCULO dentro de `resumo` (tipo, uf, custo_total, etc) — ele não sabe
// nada sobre status de aprovação/rejeição, porque isso é decidido pelos
// endpoints /aprovar e /rejeitar abaixo. Se a gente simplesmente sobrescrever
// `resumo` inteiro aqui, salvar uma edição numa cotação já aprovada ou
// rejeitada IA PERDER esse status (voltava pra "rascunho" sem querer). Por
// isso, quando já existe uma cotação com esse id, busca o resumo salvo antes
// e faz merge: os campos de cálculo vêm do front (mais recentes), mas
// status/processo_id/motivo_perda/etc só são tocados pelos endpoints
// dedicados de aprovar/rejeitar, nunca por um "Salvar" comum.
app.post('/api/calculador/cotacoes', auth('tyredesk'), async (req, res) => {
  try {
    const c = req.body;
    if (!c.cliente) return res.status(400).json({ erro: 'Cliente obrigatório' });
    if (c.id) {
      const { data: existente } = await sb()
        .from('calculador_cotacoes')
        .select('resumo')
        .eq('id', c.id)
        .maybeSingle();
      if (existente && existente.resumo) {
        c.resumo = { ...existente.resumo, ...(c.resumo || {}) };
      }
    } else {
      c.id = require('crypto').randomUUID();
    }
    c.ativo = true;
    c.updated_at = new Date().toISOString();
    c.updated_by = req.session.usuario || null;
    const { error } = await sb().from('calculador_cotacoes').upsert(c, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    res.json({ ok: true, id: c.id });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// ── Aprovar cotação → cria processo em Controle de Processos ────
// Idempotente: se a cotação já foi aprovada antes (já tem processo_id no
// resumo), não cria um processo novo de novo — só devolve o que já existe.
// Isso evita duplicar processo se o usuário clicar "Aprovar" duas vezes
// (ex: clique duplo, ou dar refresh e clicar de novo sem perceber que já
// tinha aprovado).
//
// Aprovar cria dado em outro sistema (Controle de Processos), então exige
// os DOIS módulos — não basta ter acesso ao Calculador (`auth('tyredesk')`
// só cobre isso), também precisa ter acesso a Processos. Hoje todo usuário
// já tem os dois (ver USUARIOS no topo do arquivo), mas isso evita abrir uma
// brecha se um dia existir um usuário só com acesso ao Calculador.
app.post('/api/calculador/cotacoes/:id/aprovar', auth('tyredesk'), (req, res, next) => {
  if (!req.session.modulos.includes('processos')) {
    return res.status(403).json({ erro: 'Sem acesso a Processos — não é possível aprovar cotações' });
  }
  next();
}, async (req, res) => {
  try {
    const { data: cot, error: errBusca } = await sb()
      .from('calculador_cotacoes')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (errBusca) throw new Error(errBusca.message);
    if (!cot) return res.status(404).json({ erro: 'Cotação não encontrada' });

    const resumoAtual = cot.resumo || {};
    if (resumoAtual.status === 'aprovada' && resumoAtual.processo_id) {
      return res.json({ ok: true, ja_aprovada: true, processo_id: resumoAtual.processo_id, processo_referencia: resumoAtual.processo_referencia });
    }

    const processoBase = mapearCotacaoParaProcesso(cot.dados, cot.cliente);
    // Guarda o "cotado" (custo/faturamento/lucro estimados dos dois cenários) junto
    // do processo, pra dar pra comparar depois com o resultado real no Fechamento
    // (ver seção 💰 Fechamento na ficha do processo).
    const estimativa = extrairEstimativa(cot.resumo);
    // Além de guardar a estimativa (só leitura), já grava os custos cotados
    // como ponto de partida REAL da aba Custos Reais — antes disso o usuário
    // precisava abrir a aba manualmente pra ver o "Cotado" como sugestão; agora
    // o processo já nasce com esses valores preenchidos em "Pago" (ver
    // gerarRealJsonInicial em mapeamento_cotacao_processo.js).
    const custosCotados = estimativa && estimativa.custos_cotados_json;
    const processo = {
      ...processoBase,
      id: gerarUUID(),
      updated_at: new Date().toISOString(),
      estimativa_json: estimativa,
      real_json: gerarRealJsonInicial(custosCotados),
      real_cambio: (custosCotados && Number.isFinite(parseFloat(custosCotados.cambio)) ? parseFloat(custosCotados.cambio) : null),
      cotacao_id: cot.id,
    };
    const { error: errProc } = await sb().from('controle_processos').insert(processo);
    if (errProc) throw new Error(errProc.message);

    const novoResumo = {
      ...resumoAtual,
      status: 'aprovada',
      processo_id: processo.id,
      processo_referencia: processo.referencia,
      data_aprovacao: new Date().toISOString(),
      aprovado_por: req.session.usuario || null,
      // se tinha sido rejeitada antes e o usuário mudou de ideia, limpa o motivo antigo
      motivo_perda: undefined,
      data_rejeicao: undefined,
      rejeitado_por: undefined,
    };
    const { error: errUpd } = await sb()
      .from('calculador_cotacoes')
      .update({ resumo: novoResumo })
      .eq('id', req.params.id);
    if (errUpd) throw new Error(errUpd.message);

    console.log(`cotação aprovada: ${cot.cliente} → processo ${processo.referencia} por ${req.session.usuario}`);
    res.json({ ok: true, processo_id: processo.id, processo_referencia: processo.referencia });
  } catch(e) {
    console.error('aprovar cotação erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// ── Rejeitar cotação (registra motivo de perda) ──────────────────
app.post('/api/calculador/cotacoes/:id/rejeitar', auth('tyredesk'), async (req, res) => {
  try {
    const motivo = (req.body && req.body.motivo || '').trim();
    if (!motivo) return res.status(400).json({ erro: 'Informe o motivo da perda' });

    const { data: cot, error: errBusca } = await sb()
      .from('calculador_cotacoes')
      .select('resumo')
      .eq('id', req.params.id)
      .maybeSingle();
    if (errBusca) throw new Error(errBusca.message);
    if (!cot) return res.status(404).json({ erro: 'Cotação não encontrada' });

    const novoResumo = {
      ...(cot.resumo || {}),
      status: 'rejeitada',
      motivo_perda: motivo,
      data_rejeicao: new Date().toISOString(),
      rejeitado_por: req.session.usuario || null,
    };
    const { error } = await sb()
      .from('calculador_cotacoes')
      .update({ resumo: novoResumo })
      .eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

app.delete('/api/calculador/cotacoes/:id', auth('tyredesk'), requireGerente, async (req, res) => {
  try {
    const { error } = await sb().from('calculador_cotacoes').update({ ativo: false }).eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// ── HEALTH ────────────────────────────────────────────────────

// Servir chat.js
app.get('/chat.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, 'chat.js'));
});

// ════════════════════════════════════════════════════════════════
// CHAT COM IA — consulta inteligente sobre processos
// ════════════════════════════════════════════════════════════════
app.post('/api/chat', auth('processos'), rateLimitChat, async (req, res) => {
  try {
    const { mensagem, historico = [] } = req.body;
    if (!mensagem) return res.status(400).json({ erro: 'Mensagem vazia' });

    // Buscar todos os processos do banco para contexto
    const { data: processos, error } = await sb()
      .from('controle_processos')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) throw new Error(error.message);

    const hoje = new Date();
    const ativos = (processos || []).filter(p => p.fase !== 'FINALIZADO');
    const finalizados = (processos || []).filter(p => p.fase === 'FINALIZADO');

    // Calcular demurrage para cada processo ativo
    function demDias(p) {
      if (!p.demurrage_vencimento || p.data_devolucao_vazio) return null;
      const d = new Date(p.demurrage_vencimento);
      return Math.ceil((d - hoje) / 86400000);
    }

    // Resumo executivo para contexto da IA
    const porFase = {};
    ativos.forEach(p => { porFase[p.fase] = (porFase[p.fase] || 0) + 1; });

    const demCrit = ativos.filter(p => { const d = demDias(p); return d !== null && d <= 5; });
    const etaVenc = ativos.filter(p => p.eta && p.fase === 'EMBARCADO' && new Date(p.eta) < hoje);
    const semana  = new Date(hoje); semana.setDate(hoje.getDate() + 7);
    const etaSem  = ativos.filter(p => p.eta && new Date(p.eta) >= hoje && new Date(p.eta) <= semana && p.fase === 'EMBARCADO');
    const piVenc  = ativos.filter(p => p.pi_data_saldo && !p.pi_pago && new Date(p.pi_data_saldo) < hoje);

    // Montar contexto compacto (evitar context window enorme)
    const ctx = {
      data_hoje: hoje.toLocaleDateString('pt-BR'),
      total_processos: processos.length,
      em_andamento: ativos.length,
      finalizados: finalizados.length,
      por_fase: porFase,
      alertas: {
        demurrage_critico: demCrit.map(p => ({
          ref: p.referencia, fornecedor: p.fornecedor, armador: p.armador,
          dias: demDias(p), container: p.container
        })),
        eta_vencido: etaVenc.map(p => ({
          ref: p.referencia, fornecedor: p.fornecedor, eta: p.eta, armador: p.armador
        })),
        pi_vencida: piVenc.map(p => ({
          ref: p.referencia, fornecedor: p.fornecedor, vencimento: p.pi_data_saldo,
          valor: p.pi_valor_usd
        })),
        chegando_semana: etaSem.map(p => ({
          ref: p.referencia, fornecedor: p.fornecedor, eta: p.eta, armador: p.armador
        }))
      },
      processos_ativos: ativos.map(p => ({
        ref: p.referencia, fornecedor: p.fornecedor, cliente: p.cliente,
        fase: p.fase, eta: p.eta, hbl: p.hbl, mbl: p.mbl,
        container: p.container, armador: p.armador, navio: p.navio,
        numero_di: p.numero_di, pi_valor_usd: p.pi_valor_usd,
        pi_pago: p.pi_pago, pi_data_saldo: p.pi_data_saldo,
        nf_entrada_numero: p.nf_entrada_numero, nf_saida_numero: p.nf_saida_numero,
        nf_saida_valor: p.nf_saida_valor, obs: p.obs,
        demurrage_vencimento: p.demurrage_vencimento,
        data_embarque: p.data_embarque, data_chegada: p.data_chegada,
      }))
    };

    const systemPrompt = `Você é o assistente de importação da IMPAK COMERCIAL IMPORTADORA LTDA, especializado em pneus importados da Ásia (Vietnam e China) para o Brasil.

Você tem acesso em tempo real a todos os processos de importação. Responda de forma direta, objetiva e em português brasileiro.

DADOS ATUAIS (${hoje.toLocaleDateString('pt-BR')}):
${JSON.stringify(ctx, null, 2)}

INSTRUÇÕES:
- Responda perguntas sobre status de processos, ETAs, demurrage, pagamentos e faturamento
- Dê alertas proativos quando identificar riscos (demurrage, pagamentos vencidos, ETA vencido)
- Use os dados reais acima para responder com precisão
- Quando listar processos, use o formato: REF | FORNECEDOR | FASE | detalhe relevante
- Seja conciso mas completo
- Sugira ações quando pertinente (ex: "Recomendo contatar o armador X sobre o container Y")
- Valores em USD mantenha em USD, valores em BRL no formato R$ X.XXX,XX`;

    // Chamar Claude API
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada');

    const messages = [
      ...historico.slice(-8), // últimas 8 mensagens para contexto
      { role: 'user', content: mensagem }
    ];

    // Timeout menor por tentativa, com retry automático em erros transitórios
    // da Anthropic (429/500/502/503/529) — a resposta do chat é curta, então
    // dá pra tentar de novo sem que o total ultrapasse o que a conexão do
    // Railway aguenta (orçamento total ~27s, próximo do limite original de 25s).
    const RETRYAVEIS_CHAT = [429, 500, 502, 503, 529];
    const MAX_TENTATIVAS_CHAT = 3;
    async function _callAnthropicChat(tentativa){
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      try {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 1024,
            system: systemPrompt,
            messages
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (RETRYAVEIS_CHAT.includes(resp.status) && tentativa < MAX_TENTATIVAS_CHAT) {
          const espera = 1000 * tentativa;
          console.warn(`chat: erro transitório (Anthropic ${resp.status}, tentativa ${tentativa}/${MAX_TENTATIVAS_CHAT}) | retry em ${espera}ms`);
          await new Promise(r => setTimeout(r, espera));
          return _callAnthropicChat(tentativa + 1);
        }
        return resp;
      } catch (e) {
        clearTimeout(timeoutId);
        if (e.name === 'AbortError' && tentativa < MAX_TENTATIVAS_CHAT) {
          console.warn(`chat: timeout parcial (tentativa ${tentativa}/${MAX_TENTATIVAS_CHAT}) | retry`);
          return _callAnthropicChat(tentativa + 1);
        }
        throw e;
      }
    }

    const resp = await _callAnthropicChat(1);
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);

    const resposta = data.content?.[0]?.text || 'Não consegui processar sua pergunta.';
    console.log(`chat: ${req.session.usuario} → "${mensagem.slice(0,50)}..."`);

    res.json({ ok: true, resposta });
  } catch (e) {
    console.error('chat erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// ── HISTÓRICO TYREDESK (email de cotações) ──────────────────────
app.get('/api/drive/historico', auth('tyredesk'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('tyredesk_historico')
      .select('*')
      .order('data', { ascending: false })
      .limit(100);
    if (error) {
      // Tabela pode não existir ainda — retornar vazio sem erro
      return res.json({ ok: true, historico: [] });
    }
    res.json({ ok: true, historico: data || [] });
  } catch(e) {
    res.json({ ok: true, historico: [] });
  }
});

app.post('/api/drive/historico', auth('tyredesk'), async (req, res) => {
  try {
    const { entrada } = req.body;
    if (!entrada) return res.json({ ok: true });
    entrada.id = entrada.id || gerarUUID();
    const { error } = await sb()
      .from('tyredesk_historico')
      .insert([entrada]);
    // Ignorar erro se tabela não existir — não é crítico
    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: true }); // não crítico
  }
});

app.post('/api/drive/historico/limpar', auth('tyredesk'), async (req, res) => {
  try {
    await sb().from('tyredesk_historico').delete().neq('id', '');
    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: true });
  }
});

app.get('/health', async (req, res) => {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_KEY || '';
  const anthropicKey = process.env.ANTHROPIC_API_KEY || '';

  // Decodificar role da key sem dependência externa
  let keyRole = 'desconhecido';
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64').toString());
    keyRole = payload.role || 'desconhecido';
  } catch(e) {}

  let supabaseOk = false;
  let supabaseErro = null;
  try {
    const { data, error } = await sb().from('conferencia_processos').select('id').limit(1);
    supabaseOk = !error;
    supabaseErro = error ? (error.message + ' | code: ' + error.code + ' | hint: ' + error.hint) : null;
  } catch (e) {
    supabaseErro = e.message;
  }

  res.json({
    ok: true,
    supabase: supabaseOk,
    supabase_erro: supabaseErro,
    key_role: keyRole,
    key_len: key.length,
    url_ok: url.includes('supabase.co'),
    node: process.version,
    anthropic_key_configurada: anthropicKey.length > 20,
    anthropic_key_len: anthropicKey.length,
    anthropic_key_prefixo: anthropicKey.slice(0, 10),
  });
});

// ── Vincular cotação a processo existente (item d) ──────────────────────
app.get('/api/controle/processos-abertos', auth('processos'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_processos')
      .select('id, referencia, cliente, fase')
      .neq('fase', 'FINALIZADO')
      .order('referencia', { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    res.json({ ok: true, processos: data || [] });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.post('/api/calculador/cotacoes/:id/vincular-processo', auth('tyredesk'), (req, res, next) => {
  if (!req.session.modulos.includes('processos')) {
    return res.status(403).json({ erro: 'Sem acesso a Processos — não é possível vincular cotações' });
  }
  next();
}, async (req, res) => {
  try {
    const { processo_id } = req.body;
    if (!processo_id) return res.status(400).json({ erro: 'processo_id obrigatório' });

    const { data: cot, error: eCot } = await sb()
      .from('calculador_cotacoes').select('*').eq('id', req.params.id).single();
    if (eCot) throw new Error(eCot.message);

    const { data: proc, error: eProc } = await sb()
      .from('controle_processos').select('id, referencia, estimativa_json, real_json')
      .eq('id', processo_id).single();
    if (eProc) throw new Error(eProc.message);

    const estimativa = extrairEstimativa(cot.resumo);
    const custosCotados = (cot.resumo && cot.resumo.custos_cotados_json) || null;
    const realInicial = proc.real_json ? null : gerarRealJsonInicial(custosCotados);

    const patch = {};
    if (estimativa) patch.estimativa_json = estimativa;
    if (realInicial) patch.real_json = realInicial;
    if (Object.keys(patch).length) {
      const { error: eUpd } = await sb().from('controle_processos').update(patch).eq('id', processo_id);
      if (eUpd) throw new Error(eUpd.message);
    }

    const novoResumo = {
      ...(cot.resumo || {}),
      status: 'aprovada',
      processo_id: proc.id,
      processo_referencia: proc.referencia,
      data_aprovacao: new Date().toISOString(),
      aprovado_por: req.session.usuario || null,
    };
    const { error: eCotUpd } = await sb().from('calculador_cotacoes')
      .update({ resumo: novoResumo }).eq('id', req.params.id);
    if (eCotUpd) throw new Error(eCotUpd.message);

    res.json({ ok: true, processo_id: proc.id, processo_referencia: proc.referencia });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ── Vincular ao Calculador — prefill reverso (item e) ────────────────────
// Lê um processo do Controle e devolve o `dados` já no formato que o wizard
// do Calculador espera (aplicarEstadoFormulario), pra abrir pré-preenchido
// pra revisão antes de salvar como cotação nova. Só faz sentido pra
// processos ainda no início (sem Custos Reais lançados) — depois disso, a
// estimativa "cotada" já não tem tanto valor e o link fica mais confuso do
// que ajuda.
app.get('/api/controle/processos/:id/prefill-cotacao', auth('processos'), async (req, res) => {
  try {
    const { data: proc, error } = await sb()
      .from('controle_processos').select('*').eq('id', req.params.id).single();
    if (error) throw new Error(error.message);
    if (proc.custos_reais_json) {
      return res.status(400).json({ erro: 'Este processo já tem Custos Reais lançados — vincular ao Calculador só faz sentido na fase inicial.' });
    }
    const dados = mapearProcessoParaCotacao(proc);
    res.json({ ok: true, dados, referencia: proc.referencia });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ── TRATAMENTO DE ERRO GENÉRICO ────────────────────────────────
// Captura qualquer erro não tratado que escape de uma rota (ex: exceção
// síncrona, erro de parsing) antes que o Express devolva sua página de
// erro padrão — que pode incluir stack trace e detalhes da estrutura
// interna do código, úteis para quem estiver tentando mapear o sistema.
app.use((err, req, res, next) => {
  console.error('Erro não tratado:', err.stack || err.message || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, erro: 'Erro interno no servidor. Tente novamente em alguns instantes.' });
});

// ── START ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`IMPAK Portal v2.0 na porta ${PORT}`);
  console.log(`Variáveis de ambiente carregadas: ${Object.keys(process.env).filter(k=>k.includes('ANTHROPIC')||k.includes('SUPABASE')).join(', ')}`);
  console.log(`ANTHROPIC_API_KEY presente: ${!!process.env.ANTHROPIC_API_KEY} | tamanho: ${(process.env.ANTHROPIC_API_KEY||'').length}`);
  sincronizarUsuarios().catch(e => console.error('Erro ao sincronizar usuários no boot:', e.message));
});
