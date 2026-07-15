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
const { randomUUID, scryptSync, randomBytes, timingSafeEqual } = require('crypto');

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
function avisarErroSessao(error, operacao) {
  if (!error) return;
  const msg = error.message || String(error);
  const tabelaAusente = error.code === 'PGRST205' || error.code === '42P01' || /schema cache|does not exist/i.test(msg);
  if (tabelaAusente) {
    if (_avisouTabelaAusente) return;
    _avisouTabelaAusente = true;
    console.error(`⚠️  Tabela app_sessions ainda não existe no Supabase — sessão vai continuar caindo a cada deploy até criar a tabela (ver instruções no topo do arquivo). [${operacao}]`, msg);
  } else {
    console.error(`🛑 ERRO REAL ao acessar app_sessions — sessão NÃO está sendo salva/lida, login pode estar quebrado para todo mundo. [${operacao}] code=${error.code||'?'}:`, msg);
  }
}

class SupabaseSessionStore extends session.Store {
  get(sid, callback) {
    sb().from('app_sessions').select('sess, expire').eq('sid', sid).maybeSingle()
      .then(({ data, error }) => {
        if (error) { avisarErroSessao(error, 'get'); return callback(null, null); }
        if (!data) return callback(null, null);
        if (new Date(data.expire) < new Date()) {
          this.destroy(sid, () => {});
          return callback(null, null);
        }
        callback(null, data.sess);
      })
      .catch(err => { avisarErroSessao(err, 'get'); callback(null, null); });
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
  { usuario: 'narcelio',  senhaHashEnv: envSenhaHash('SENHA_NARCELIO'),  email: 'narcelio@impak.com.br',  modulos: ['tyredesk','processos'], nome: 'Narcelio',  role: 'gerente',  displayName: 'Narcelio',  home: '/'           },
  { usuario: 'jean',      senhaHashEnv: envSenhaHash('SENHA_JEAN'),      email: 'jean@impak.com.br',      modulos: ['tyredesk','processos'], nome: 'Jean',      role: 'gerente',  displayName: 'Jean',      home: '/'           },
  { usuario: 'paula',     senhaHashEnv: envSenhaHash('SENHA_PAULA'),     email: 'paula@impak.com.br',     modulos: ['tyredesk','processos'], nome: 'Paula',     role: 'gerente',  displayName: 'Paula',     home: '/processos'  },
  { usuario: 'amanda',    senhaHashEnv: envSenhaHash('SENHA_AMANDA'),    email: 'amanda@impak.com.br',    modulos: ['tyredesk','processos'], nome: 'Amanda',    role: 'gerente',  displayName: 'Amanda',    home: '/processos'  },
  { usuario: 'bianca',    senhaHashEnv: envSenhaHash('SENHA_BIANCA'),    email: 'bianca@impak.com.br',    modulos: ['tyredesk','processos'], nome: 'Bianca',    role: 'gerente',  displayName: 'Bianca',    home: '/processos'  },
  { usuario: 'emanuelly', senhaHashEnv: envSenhaHash('SENHA_EMANUELLY'), email: 'emanuelly@impak.com.br', modulos: ['tyredesk','processos'], nome: 'Emanuelly', role: 'analista', displayName: 'Emanuelly', home: '/processos'  },
  { usuario: 'italo',     senhaHashEnv: envSenhaHash('SENHA_ITALO'),     email: 'italo@impak.com.br',     modulos: ['tyredesk','processos'], nome: 'Italo',     role: 'analista', displayName: 'Italo',     home: '/processos'  },
  { usuario: 'maria',     senhaHashEnv: envSenhaHash('SENHA_MARIA'),     email: 'maria@impak.com.br',     modulos: ['tyredesk','processos'], nome: 'Maria',     role: 'analista', displayName: 'Maria',     home: '/processos'  },
  { usuario: 'joyce',     senhaHashEnv: envSenhaHash('SENHA_JOYCE'),     email: 'joyce@impak.com.br',     modulos: ['tyredesk','processos'], nome: 'Joyce',     role: 'analista', displayName: 'Joyce',     home: '/processos'  },
  { usuario: 'neide',     senhaHashEnv: envSenhaHash('SENHA_NEIDE'),     email: 'neide@impak.com.br',     modulos: ['tyredesk','processos'], nome: 'Neide',     role: 'analista', displayName: 'Neide',     home: '/processos'  },
  { usuario: 'suporte',   senhaHashEnv: envSenhaHash('SENHA_SUPORTE'),   email: 'suporte@impak.com.br',   modulos: ['tyredesk','processos'], nome: 'Suporte',   role: 'gerente',  displayName: 'Suporte',   home: '/'           },
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
      <label>Usuário</label>
      <input name="usuario" type="text" placeholder="seu usuário" autocomplete="username" required autofocus>
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
  const u = _usuariosCache.get(login);
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
    await sb().from('usuarios').update({ reset_token: token, reset_token_expira: expira.toISOString() }).eq('usuario', u.usuario);
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
    const u = [..._usuariosCache.values()].find(x => x.reset_token === token);
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
    const u = [..._usuariosCache.values()].find(x => x.reset_token === token);
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

app.delete('/api/conferencia/processo/:id', auth('processos'), async (req, res) => {
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

app.delete('/api/controle/v2/processo/:id', auth('processos'), async (req, res) => {
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

app.delete('/api/controle/processo/:id', auth('processos'), async (req, res) => {
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
app.post('/api/analisar', auth('processos'), async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || !Array.isArray(content)) {
      return res.status(400).json({ erro: 'Conteúdo inválido' });
    }
    // Única chave da Anthropic é a configurada no servidor (Railway →
    // variável ANTHROPIC_API_KEY). Não aceitamos mais chave vinda do
    // cliente/navegador — evita que cada usuário use uma chave própria e
    // garante que a chave nunca fique salva no navegador de ninguém.
    const key = (process.env.ANTHROPIC_API_KEY || '').trim();
    if (!key || key.length < 20) {
      return res.status(500).json({ erro: 'ANTHROPIC_API_KEY não configurada no servidor. Configure-a nas variáveis de ambiente do Railway.' });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);
    let respData;
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 16000, messages: [{ role: 'user', content }] }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        return res.status(resp.status).json({ erro: `API Anthropic erro ${resp.status}: ${err?.error?.message || resp.statusText}` });
      }
      respData = await resp.json();
    } catch (fetchErr) {
      clearTimeout(timeout);
      if (fetchErr.name === 'AbortError') {
        return res.status(504).json({ erro: 'Análise demorou mais de 3 minutos. Tente com menos documentos.' });
      }
      throw fetchErr;
    }
    res.json({ ok: true, data: respData });
  } catch (e) {
    console.error('Erro /api/analisar:', e.message);
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

app.delete('/api/controle/v2/arquivos/:id', auth('processos'), async (req, res) => {
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
    if (tipo) query = query.eq('tipo', tipo.toUpperCase());
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

app.delete('/api/contatos/:id', auth('processos'), async (req, res) => {
  try {
    const { error } = await sb().from('contatos_clientes').update({ ativo: false }).eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

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
app.post('/api/calculador/cotacoes', auth('tyredesk'), async (req, res) => {
  try {
    const c = req.body;
    if (!c.cliente) return res.status(400).json({ erro: 'Cliente obrigatório' });
    if (!c.id) c.id = require('crypto').randomUUID();
    c.ativo = true;
    c.updated_at = new Date().toISOString();
    c.updated_by = req.session.usuario || null;
    const { error } = await sb().from('calculador_cotacoes').upsert(c, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    res.json({ ok: true, id: c.id });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

app.delete('/api/calculador/cotacoes/:id', auth('tyredesk'), async (req, res) => {
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
app.post('/api/chat', auth('processos'), async (req, res) => {
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

    // Timeout de 25s para evitar conexão pendurada no Railway
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

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
