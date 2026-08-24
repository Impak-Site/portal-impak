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
const helmet  = require('helmet');
const { generateSecret: gerarSegredo2FA, generate: gerarCodigo2FA, verify: verificarCodigoOtplib, generateURI: gerarURI2FA } = require('./lib/totp');
const qrcode  = require('qrcode');

// Wrapper síncrono-de-uso pra verify() do otplib (que é assíncrono e lança
// erro se o texto digitado não tiver exatamente 6 dígitos) — os pontos de
// chamada só precisam saber "código bateu ou não", sem se preocupar com
// formato malformado ou com o await por baixo.
async function verificarCodigo2FA(secret, codigoDigitado) {
  const codigo = String(codigoDigitado || '').trim();
  if (!/^\d{6}$/.test(codigo)) return false;
  try {
    const r = await verificarCodigoOtplib({ secret, token: codigo });
    return !!(r && r.valid);
  } catch (e) {
    return false;
  }
}
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

// ── POLÍTICA DE SENHA (reforçada 22/08/2026) ────────────────────
// Antes só exigia 6 caracteres quaisquer. Agora exige 8+ com pelo menos
// uma letra e um número — reduz bastante o espaço de senhas triviais tipo
// "123456" ou "aaaaaaaa" sem pedir símbolos especiais (que na prática só
// fazem as pessoas anotarem a senha em algum lugar inseguro).
function senhaFraca(senha) {
  if (!senha || senha.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (!/[a-zA-Z]/.test(senha) || !/[0-9]/.test(senha)) return 'A senha precisa ter pelo menos uma letra e um número.';
  return null;
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
//
// HOTFIX 22/08/2026: o cliente do Supabase (@supabase/supabase-js) sempre
// inicializa um RealtimeClient no construtor, mesmo quando a gente só usa
// consultas normais (.from().select()) e nunca .channel()/.on() — e esse
// RealtimeClient exige um WebSocket disponível. O Node 18 (versão rodando
// no Railway) não tem WebSocket global (só a partir do Node 22), então
// createClient() lançava uma exceção síncrona logo na primeira chamada,
// derrubando com "erro interno" QUALQUER rota que dependesse de sessão
// (a sessão é lida do Supabase a cada requisição). Isso ficou invisível
// localmente porque o teste rápido `node server.js` sem SUPABASE_URL nunca
// chega a instanciar o client de verdade. Corrigido passando o pacote
// `ws` (WebSocket puro-Node) explicitamente como transport.
const WebSocket = require('ws');
let _sb = null;
function sb() {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL ou SUPABASE_KEY não configurados no Railway');
  _sb = createClient(url, key, { auth: { persistSession: false }, realtime: { transport: WebSocket } });
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
  { usuario: 'narcelio',  senhaHashEnv: envSenhaHash('SENHA_NARCELIO'),  email: 'narcelio@impak.com.br',      modulos: ['tyredesk','conferencia','controle','financeiro','resultado','tv','narcelio'], nome: 'Narcelio',  role: 'gerente',  displayName: 'Narcelio',  home: '/'           },
  { usuario: 'jean',      senhaHashEnv: envSenhaHash('SENHA_JEAN'),      email: 'jean@impak.com.br',          modulos: ['tyredesk','conferencia','controle','financeiro','resultado','tv'], nome: 'Jean',      role: 'gerente',  displayName: 'Jean',      home: '/'           },
  { usuario: 'paula',     senhaHashEnv: envSenhaHash('SENHA_PAULA'),     email: 'paula@impak.com.br',         modulos: ['tyredesk','conferencia','controle','financeiro','resultado','tv','narcelio'], nome: 'Paula',     role: 'gerente',  displayName: 'Paula',     home: '/processos'  },
  { usuario: 'amanda',    senhaHashEnv: envSenhaHash('SENHA_AMANDA'),    email: 'amanda@findcomex.com.br',    modulos: ['tyredesk','conferencia','controle','financeiro','resultado','tv'], nome: 'Amanda',    role: 'analista',  displayName: 'Amanda',    home: '/processos'  },
  { usuario: 'bianca',    senhaHashEnv: envSenhaHash('SENHA_BIANCA'),    email: 'financeiro@impak.com.br',    modulos: ['tyredesk','conferencia','controle','financeiro','resultado','tv'], nome: 'Bianca',    role: 'analista',  displayName: 'Bianca',    home: '/processos'  },
  { usuario: 'emanuelly', senhaHashEnv: envSenhaHash('SENHA_EMANUELLY'), email: 'importacao1@impak.com.br',   modulos: ['tyredesk','conferencia','controle','financeiro','resultado','tv'], nome: 'Emanuelly', role: 'analista', displayName: 'Emanuelly', home: '/processos'  },
  { usuario: 'italo',     senhaHashEnv: envSenhaHash('SENHA_ITALO'),     email: 'fiscal01@impak.com.br',      modulos: ['tyredesk','conferencia','controle','financeiro','resultado','tv'], nome: 'Italo',     role: 'analista', displayName: 'Italo',     home: '/processos'  },
  { usuario: 'maria',     senhaHashEnv: envSenhaHash('SENHA_MARIA'),     email: 'fiscal@impak.com.br',        modulos: ['tyredesk','conferencia','controle','financeiro','resultado','tv'], nome: 'Maria',     role: 'analista', displayName: 'Maria',     home: '/processos'  },
  { usuario: 'joyce',     senhaHashEnv: envSenhaHash('SENHA_JOYCE'),     email: 'nfe@impak.com.br',           modulos: ['tyredesk','conferencia','controle','financeiro','resultado','tv'], nome: 'Joyce',     role: 'analista', displayName: 'Joyce',     home: '/processos'  },
  { usuario: 'neide',     senhaHashEnv: envSenhaHash('SENHA_NEIDE'),     email: 'operacional01@impak.com.br', modulos: ['tyredesk','conferencia','controle','financeiro','resultado','tv'], nome: 'Neide',     role: 'analista', displayName: 'Neide',     home: '/processos'  },
  { usuario: 'everton',   senhaHashEnv: envSenhaHash('SENHA_EVERTON'),   email: 'administrativo@impak.com.br', modulos: ['tyredesk','conferencia','controle','financeiro','resultado','tv'], nome: 'Everton',   role: 'analista', displayName: 'Everton',   home: '/processos'  },
  { usuario: 'isabella',  senhaHashEnv: envSenhaHash('SENHA_ISABELLA'),  email: 'operacional@impak.com.br',   modulos: ['tyredesk','conferencia','controle','financeiro','resultado','tv'], nome: 'Isabella',  role: 'analista', displayName: 'Isabella',  home: '/processos'  },
  { usuario: 'suporte',   senhaHashEnv: envSenhaHash('SENHA_SUPORTE'),   email: 'suporte@impak.com.br',       modulos: ['tyredesk','conferencia','controle','financeiro','resultado','tv','narcelio'], nome: 'Suporte',   role: 'gerente',  displayName: 'Suporte',   home: '/'           },
];

// Cache em memória dos usuários carregados do Supabase (recarregado no boot
// e sempre que alguém redefine a senha). O login lê DAQUI, não do array acima.
let _usuariosCache = new Map();

async function sincronizarUsuarios(){
  for(const u of USUARIOS){
    try{
      const { data: existente } = await sb().from('usuarios').select('senha_hash, modulos, role, home').eq('usuario', u.usuario).maybeSingle();
      const senha_hash = existente ? existente.senha_hash : u.senhaHashEnv;
      if(!senha_hash){
        console.error(`⚠️  Usuário "${u.usuario}" sem senha (nem no Supabase, nem no env var) — login vai falhar.`);
        continue;
      }
      const payload = {
        usuario: u.usuario, senha_hash, email: u.email, nome: u.nome, display_name: u.displayName,
      };
      // "role", "modulos" e "home" só usam o valor fixo do código quando o
      // usuário está sendo CRIADO agora pela primeira vez. Se já existe no
      // banco, esses campos ficam intocados — são geridos pela tela de
      // Permissões (Narcelio/Paula/Ayslan) e não podem ser apagados a cada
      // deploy/restart do servidor (antes disso acontecia: qualquer
      // permissão setada na tela era resetada no próximo boot).
      if(!existente){
        payload.role = u.role;
        payload.modulos = u.modulos;
        payload.home = u.home;
      }
      await sb().from('usuarios').upsert(payload, { onConflict: 'usuario' });
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
    const mensagem = `Muitas tentativas. Tente novamente em ${minutosRestantes} minuto(s).`;
    // /login (form tradicional) espera uma pagina HTML de volta; ja
    // /login/configurar-2fa e /login/verificar-2fa sao chamados via fetch()
    // e fazem `await r.json()` no cliente -- mandar HTML pra eles faz o
    // parse falhar e o usuario ver "Erro de rede" (mensagem errada,
    // escondendo o motivo real). Detecta pelo path pra responder no
    // formato certo em cada caso.
    if (req.path !== '/login') {
      return res.status(429).json({ ok: false, erro: mensagem });
    }
    return res.send(loginPage(mensagem, req.body?.destino || '/'));
  }
  tentativas.push(agora);
  _loginTentativas.set(ip, tentativas);
  next();
}

// ── BLOQUEIO POR CONTA (além do limite por IP acima) ───────────
// O limite por IP acima não segura um ataque que troca de IP a cada
// tentativa (proxy, rede móvel, etc.) mirando numa única conta. Esta trava
// é por USUÁRIO: 5 senhas erradas em 15 minutos bloqueiam aquela conta
// especificamente, não importa de onde venham as tentativas seguintes.
const _loginFalhasPorUsuario = new Map(); // usuario -> [timestamps]
const CONTA_MAX_FALHAS = 5;
const CONTA_JANELA_MS = 15 * 60 * 1000;

function contaBloqueada(usuario) {
  if (!usuario) return false;
  const falhas = (_loginFalhasPorUsuario.get(usuario) || []).filter(t => Date.now() - t < CONTA_JANELA_MS);
  _loginFalhasPorUsuario.set(usuario, falhas);
  return falhas.length >= CONTA_MAX_FALHAS;
}
function registrarFalhaLogin(usuario) {
  if (!usuario) return;
  const falhas = (_loginFalhasPorUsuario.get(usuario) || []).filter(t => Date.now() - t < CONTA_JANELA_MS);
  falhas.push(Date.now());
  _loginFalhasPorUsuario.set(usuario, falhas);
}
function limparFalhasLogin(usuario) {
  _loginFalhasPorUsuario.delete(usuario);
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
// Headers de segurança (helmet) — CSP fica desligada de propósito: o app
// usa script/estilo inline (onclick=, style=) em várias telas legadas, e
// uma CSP padrão bloquearia isso e quebraria a aplicação inteira. O que
// dá pra ligar sem risco de quebrar nada (anti-clickjacking, anti-MIME-
// sniffing, HSTS) já ajuda bastante. Revisitar CSP no futuro se/quando
// o front-end for migrado pra scripts externos.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
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
  cookie: { secure: true, maxAge: 8 * 60 * 60 * 1000, sameSite: 'lax' },
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
  if(novaSenha.length < 8){ msg.innerHTML = '<div class="err">A senha precisa ter pelo menos 8 caracteres.</div>'; return; }
  if(!/[a-zA-Z]/.test(novaSenha) || !/[0-9]/.test(novaSenha)){ msg.innerHTML = '<div class="err">A senha precisa ter pelo menos uma letra e um número.</div>'; return; }
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

// Tela de configuração obrigatória do autenticador (2FA) — aparece uma
// única vez, logo após a senha certa, pra quem ainda não tem o TOTP
// configurado. Mostra o QR code (pra escanear com Google Authenticator,
// Authy, etc.) e também o código em texto, pra quem preferir digitar
// manualmente. Só libera a sessão de verdade depois de confirmar um
// código válido gerado pelo app — isso garante que o segredo foi mesmo
// registrado no autenticador da pessoa, e não só mostrado na tela.
function configurar2faPage(qrDataUrl, secretTexto, erro) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>IMPAK — Configurar autenticação em duas etapas</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
${AUTH_CSS}
<style>.qr-box{text-align:center;margin-bottom:18px;}.qr-box img{width:180px;height:180px;border:1px solid #c8d8e8;border-radius:8px;}
.secret-txt{font-family:monospace;font-size:13px;letter-spacing:1px;background:#dce8f5;border:1px solid #c8d8e8;border-radius:6px;padding:8px 10px;text-align:center;word-break:break-all;margin-bottom:16px;color:#0d1e2e;}
.codigo-input{letter-spacing:6px;font-size:22px;text-align:center;font-weight:700;}</style>
</head>
<body>
<div class="wrap">
  <div class="logo-row"><div class="logo-badge">IMPAK</div><div class="logo-sub">Portal</div></div>
  <div class="box">
    <h1>Proteger sua conta</h1>
    <div class="sub">Configuração obrigatória — só na primeira vez</div>
    <div id="msg">${erro ? `<div class="err">${escapeHtml(erro)}</div>` : ''}</div>
    <p style="font-size:12px;color:#4a6480;margin-bottom:14px;line-height:1.5;">Escaneie o código abaixo com um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, Authy...) e digite o código de 6 dígitos que ele mostrar.</p>
    <div class="qr-box">${qrDataUrl ? `<img src="${qrDataUrl}" alt="QR code">` : '<div class="err">Não foi possível gerar o QR code — use o código manual abaixo.</div>'}</div>
    <label>Ou digite manualmente no app</label>
    <div class="secret-txt">${escapeHtml(secretTexto)}</div>
    <label>Código de 6 dígitos</label>
    <input id="codigo" class="codigo-input" type="text" inputmode="numeric" maxlength="6" placeholder="000000" autofocus>
    <button onclick="confirmar()">Confirmar e entrar</button>
    <div class="footer">IMPAK Comercial Importadora · Portal v2.0 · Confidencial</div>
  </div>
</div>
<script>
async function confirmar(){
  const codigo = document.getElementById('codigo').value.trim();
  const msg = document.getElementById('msg');
  if(codigo.length !== 6){ msg.innerHTML = '<div class="err">Digite os 6 dígitos do código.</div>'; return; }
  const btn = document.querySelector('button');
  btn.disabled = true; btn.textContent = 'Confirmando...';
  try{
    const r = await fetch('/login/configurar-2fa', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ codigo })
    });
    const d = await r.json();
    if(d.ok){ location.href = d.destino || '/'; return; }
    msg.innerHTML = '<div class="err">'+(d.erro||'Erro ao confirmar.')+'</div>';
  }catch(e){
    msg.innerHTML = '<div class="err">Erro de rede. Tente novamente.</div>';
  }
  btn.disabled = false; btn.textContent = 'Confirmar e entrar';
}
document.getElementById('codigo').addEventListener('keydown', e=>{ if(e.key==='Enter') confirmar(); });
</script>
</body>
</html>`;
}

// Tela de verificação do código (login normal, depois da primeira vez que
// já configurou o autenticador).
function verificar2faPage(erro) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>IMPAK — Código de verificação</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
${AUTH_CSS}
<style>.codigo-input{letter-spacing:6px;font-size:22px;text-align:center;font-weight:700;}</style>
</head>
<body>
<div class="wrap">
  <div class="logo-row"><div class="logo-badge">IMPAK</div><div class="logo-sub">Portal</div></div>
  <div class="box">
    <h1>Verificação em duas etapas</h1>
    <div class="sub">Digite o código do seu autenticador</div>
    <div id="msg">${erro ? `<div class="err">${escapeHtml(erro)}</div>` : ''}</div>
    <label>Código de 6 dígitos</label>
    <input id="codigo" class="codigo-input" type="text" inputmode="numeric" maxlength="6" placeholder="000000" autofocus>
    <button onclick="verificar()">Entrar</button>
    <div style="text-align:center;margin-top:14px;">
      <a href="/login" style="font-size:12px;color:#1a7fd4;text-decoration:none;font-weight:600;">Voltar pro login</a>
    </div>
    <div class="footer">IMPAK Comercial Importadora · Portal v2.0 · Confidencial</div>
  </div>
</div>
<script>
async function verificar(){
  const codigo = document.getElementById('codigo').value.trim();
  const msg = document.getElementById('msg');
  if(codigo.length !== 6){ msg.innerHTML = '<div class="err">Digite os 6 dígitos do código.</div>'; return; }
  const btn = document.querySelector('button');
  btn.disabled = true; btn.textContent = 'Verificando...';
  try{
    const r = await fetch('/login/verificar-2fa', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ codigo })
    });
    const d = await r.json();
    if(d.ok){ location.href = d.destino || '/'; return; }
    msg.innerHTML = '<div class="err">'+(d.erro||'Código inválido.')+'</div>';
    document.getElementById('codigo').value = '';
  }catch(e){
    msg.innerHTML = '<div class="err">Erro de rede. Tente novamente.</div>';
  }
  btn.disabled = false; btn.textContent = 'Entrar';
}
document.getElementById('codigo').addEventListener('keydown', e=>{ if(e.key==='Enter') verificar(); });
</script>
</body>
</html>`;
}

// ── AUTENTICAÇÃO ──────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session.usuario) return res.redirect(sanitizeDestino(req.query.destino));
  res.send(loginPage('', req.query.destino));
});

// Completa o login "de verdade" (grava tudo na sessão) — usada tanto no
// fluxo sem 2FA (legado, enquanto ainda existir alguém sem configurar)
// quanto depois que o código do autenticador é confirmado. Extraída pra
// não duplicar essa lista de campos em 3 lugares (senha ok direto,
// verificar-2fa, configurar-2fa).
function completarLogin(req, u, destino) {
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
  return destinoSeguro !== '/' ? destinoSeguro : (u.home || '/');
}

app.post('/login', rateLimitLogin, (req, res) => {
  const { usuario, senha, destino } = req.body;
  const login = (usuario || '').trim().toLowerCase();
  // Aceita tanto o usuário curto (ex: "emanuelly") quanto o e-mail
  // cadastrado (ex: "importacao1@impak.com.br") no mesmo campo — mesma
  // lógica de busca já usada em /api/auth/esqueci-senha. Sem isso, quem
  // digitasse o e-mail (rotulado como "Login" na planilha de cadastro)
  // caía em "usuário ou senha incorretos" mesmo com a senha certa.
  if (contaBloqueada(login)) {
    return res.send(loginPage('Muitas tentativas erradas para esse usuário. Tente novamente em alguns minutos, ou use "Esqueci minha senha".', destino || '/'));
  }
  const u = _usuariosCache.get(login) || [..._usuariosCache.values()].find(x => (x.email||'').toLowerCase() === login);
  if (!u || !u.senha_hash || !verificarSenha(senha || '', u.senha_hash)) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'desconhecido';
    // Nunca logar a senha digitada, mesmo errada — só o usuário tentado, o
    // IP, e o horário, suficiente para notar um padrão de ataque sem criar
    // outro vazamento de dado sensível dentro dos próprios logs.
    console.warn(`[LOGIN FALHOU] usuário="${login}" ip=${ip} em ${new Date().toISOString()}`);
    registrarFalhaLogin(login);
    return res.send(loginPage('Usuário ou senha incorretos.', destino || '/'));
  }
  limparFalhasLogin(login);
  // ── 2FA (obrigatório pra todo mundo, pedido do Ayslan 22/08/2026) ──
  // Senha certa não é mais suficiente sozinha: se o usuário já tem o
  // autenticador configurado, pede o código de 6 dígitos antes de abrir
  // sessão de verdade. Se ainda não configurou, obriga a configurar agora
  // (gera o QR code) antes de deixar entrar — não dá pra "pular" o setup.
  const destinoSeguro = sanitizeDestino(destino);
  if (u.totp_enabled && u.totp_secret) {
    req.session.pending2fa = { usuario: u.usuario, destino: destinoSeguro };
    return res.redirect('/login/verificar-2fa');
  }
  const secret = gerarSegredo2FA();
  req.session.pendingSetup2fa = { usuario: u.usuario, secret, destino: destinoSeguro };
  return res.redirect('/login/configurar-2fa');
});

app.get('/login/configurar-2fa', async (req, res) => {
  const pend = req.session.pendingSetup2fa;
  if (!pend) return res.redirect('/login');
  const u = _usuariosCache.get(pend.usuario);
  const otpauth = gerarURI2FA({ secret: pend.secret, label: u ? (u.email || pend.usuario) : pend.usuario, issuer: 'IMPAK Portal' });
  let qrDataUrl = '';
  try { qrDataUrl = await qrcode.toDataURL(otpauth); } catch (e) { console.error('QR code erro:', e.message); }
  res.send(configurar2faPage(qrDataUrl, pend.secret, null));
});

app.post('/login/configurar-2fa', rateLimitLogin, async (req, res) => {
  try {
    const pend = req.session.pendingSetup2fa;
    if (!pend) return res.json({ ok: false, erro: 'Sessão de configuração expirada. Faça login novamente.' });
    const codigo = (req.body.codigo || '').trim();
    if (!(await verificarCodigo2FA(pend.secret, codigo))) {
      return res.json({ ok: false, erro: 'Código inválido. Confira o horário do celular e tente de novo.' });
    }
    await sb().from('usuarios').update({
      totp_secret: pend.secret, totp_enabled: true, totp_confirmed_at: new Date().toISOString(),
    }).eq('usuario', pend.usuario);
    await recarregarCacheUsuarios();
    const u = _usuariosCache.get(pend.usuario);
    const destinoFinal = completarLogin(req, u, pend.destino);
    delete req.session.pendingSetup2fa;
    res.json({ ok: true, destino: destinoFinal });
  } catch (e) {
    console.error('Erro ao confirmar setup 2FA:', e.message);
    res.json({ ok: false, erro: 'Erro interno. Tente novamente.' });
  }
});

app.get('/login/verificar-2fa', (req, res) => {
  if (!req.session.pending2fa) return res.redirect('/login');
  res.send(verificar2faPage(null));
});

app.post('/login/verificar-2fa', rateLimitLogin, async (req, res) => {
  const pend = req.session.pending2fa;
  if (!pend) return res.json({ ok: false, erro: 'Sessão expirada. Faça login novamente.' });
  const u = _usuariosCache.get(pend.usuario);
  const codigo = (req.body.codigo || '').trim();
  if (!u || !u.totp_secret || !(await verificarCodigo2FA(u.totp_secret, codigo))) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'desconhecido';
    console.warn(`[2FA FALHOU] usuário="${pend.usuario}" ip=${ip} em ${new Date().toISOString()}`);
    return res.json({ ok: false, erro: 'Código inválido.' });
  }
  const destinoFinal = completarLogin(req, u, pend.destino);
  delete req.session.pending2fa;
  res.json({ ok: true, destino: destinoFinal });
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
    const problemaSenha = senhaFraca(novaSenha);
    if(!token || problemaSenha){
      return res.json({ ok: false, erro: problemaSenha || 'Token obrigatório.' });
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

// Reseta o 2FA de um usuário (perdeu o celular, trocou de aparelho etc.) —
// limpa o segredo salvo, então no próximo login a pessoa passa pela tela
// de configuração de novo (novo QR code). Restrito a gerente, e força
// logout de todas as sessões abertas daquele usuário por segurança (se
// alguém pediu esse reset por suspeita de conta comprometida, não faz
// sentido deixar uma sessão antiga válida).
app.post('/api/usuarios/:usuario/resetar-2fa', rateLimitLogin, async (req, res) => {
  if (!req.session.usuario) return res.status(401).json({ ok: false, erro: 'Não autenticado' });
  if (req.session.role !== 'gerente') return res.status(403).json({ ok: false, erro: 'Apenas gerentes podem fazer isso' });
  const alvo = (req.params.usuario || '').trim().toLowerCase();
  if (!USUARIOS.some(u => u.usuario === alvo)) return res.status(404).json({ ok: false, erro: 'Usuário não encontrado' });
  try {
    await sb().from('usuarios').update({
      totp_secret: null, totp_enabled: false, totp_confirmed_at: null,
    }).eq('usuario', alvo);
    await recarregarCacheUsuarios();
    forcarLogoutUsuario(alvo);
    res.json({ ok: true, mensagem: `2FA de "${alvo}" foi resetado — vai configurar de novo no próximo login.` });
  } catch (e) {
    console.error('Erro ao resetar 2FA:', e.message);
    res.status(500).json({ ok: false, erro: 'Erro interno.' });
  }
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

// ── PERMISSÕES POR MÓDULO (tela criada 22/08/2026, pedido do Ayslan) ──
// Restrito a Narcelio, Paula e Ayslan (usuário "suporte") — ver
// ADMINS_PERMISSOES logo acima de auth(). Lista todo mundo com os módulos
// que cada um tem hoje, pra montar a tabela usuário x módulo na tela.
app.get('/api/admin/permissoes', requireAdminPermissoes, async (req, res) => {
  try {
    await recarregarCacheUsuarios();
    const usuarios = [..._usuariosCache.values()]
      .map(u => ({
        usuario: u.usuario, nome: u.nome || u.display_name || u.usuario,
        role: u.role, modulos: u.modulos || [],
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    res.json({ ok: true, usuarios, modulosValidos: MODULOS_VALIDOS, admins: ADMINS_PERMISSOES });
  } catch (e) {
    console.error('Erro ao listar permissões:', e.message);
    res.status(500).json({ ok: false, erro: 'Erro ao carregar permissões.' });
  }
});

// Grava os módulos de UM usuário (a tela manda a lista completa de módulos
// marcados pra aquele usuário, não um delta). Só nomes de MODULOS_VALIDOS
// são aceitos — qualquer coisa fora disso é ignorada, pra nunca gravar lixo
// no banco que quebre o auth() depois. Força logout do usuário afetado pra
// a mudança valer imediatamente (sem esperar a sessão antiga expirar).
app.post('/api/admin/permissoes/:usuario', requireAdminPermissoes, async (req, res) => {
  const alvo = (req.params.usuario || '').trim().toLowerCase();
  if (!USUARIOS.some(u => u.usuario === alvo)) {
    return res.status(404).json({ ok: false, erro: 'Usuário não encontrado' });
  }
  const modulosEnviados = Array.isArray(req.body.modulos) ? req.body.modulos : [];
  const modulos = [...new Set(modulosEnviados.filter(m => MODULOS_VALIDOS.includes(m)))];
  const update = { modulos };
  if (req.body.role !== undefined) {
    const ROLES_VALIDAS = ['gerente', 'analista'];
    if (!ROLES_VALIDAS.includes(req.body.role)) {
      return res.status(400).json({ ok: false, erro: 'role inválida (use "gerente" ou "analista").' });
    }
    update.role = req.body.role;
  }
  try {
    await sb().from('usuarios').update(update).eq('usuario', alvo);
    await recarregarCacheUsuarios();
    forcarLogoutUsuario(alvo);
    res.json({ ok: true, mensagem: `Permissões de "${alvo}" atualizadas.`, modulos, role: update.role });
  } catch (e) {
    console.error('Erro ao salvar permissões:', e.message);
    res.status(500).json({ ok: false, erro: 'Erro interno ao salvar.' });
  }
});

// Lista de todos os módulos/telas que existem hoje no sistema — usada pra
// validar o que a tela de Permissões pode gravar (evita salvar um nome de
// módulo digitado errado que nunca vai bater com nenhum auth()).
const MODULOS_VALIDOS = ['tyredesk', 'conferencia', 'controle', 'financeiro', 'resultado', 'tv', 'narcelio'];

// Usuários que podem abrir a tela de Permissões e mudar o acesso de
// qualquer outro usuário — combinado explicitamente com o Ayslan
// (22/08/2026): só ele, o Narcelio e a Paula.
const ADMINS_PERMISSOES = ['narcelio', 'paula', 'suporte'];

// auth(...modulos) — aceita um ou mais nomes de módulo; o acesso é liberado
// se o usuário tiver PELO MENOS UM deles (ex: auth('controle','financeiro')
// libera pra quem tem controle OU financeiro). Sem nenhum argumento, só
// exige estar logado (qualquer módulo).
function auth(...modulos) {
  return (req, res, next) => {
    if (!req.session.usuario) return res.redirect('/login?destino=' + req.path);
    // Se a versão da sessão estiver desatualizada (alguém forçou logout
    // deste usuário, ex: ao trocar a senha ou mudar suas permissões),
    // invalida mesmo com cookie válido.
    const versaoAtual = _sessaoVersao.get(req.session.usuario) || 1;
    if (req.session.versao !== versaoAtual) {
      return req.session.destroy(() => res.redirect('/login?destino=' + req.path));
    }
    if (modulos.length && !modulos.some(m => req.session.modulos.includes(m))) {
      return res.status(403).send('<h2>Acesso negado</h2>');
    }
    next();
  };
}

// Restringe a quem pode gerenciar as permissões de outros usuários.
function requireAdminPermissoes(req, res, next) {
  if (!req.session.usuario) return res.status(401).json({ ok: false, erro: 'Não autenticado' });
  if (!ADMINS_PERMISSOES.includes(req.session.usuario)) {
    return res.status(403).json({ ok: false, erro: 'Apenas Narcelio, Paula ou Ayslan podem gerenciar permissões.' });
  }
  next();
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
app.get('/permissoes', (req, res) => {
  if (!req.session.usuario) return res.redirect('/login?destino=/permissoes');
  if (!ADMINS_PERMISSOES.includes(req.session.usuario)) return res.status(403).send('<h2>Acesso restrito.</h2>');
  res.sendFile(path.join(__dirname, 'permissoes.html'));
});
app.get('/',          auth('tyredesk'),  (req, res) => res.sendFile(path.join(__dirname, 'tyredesk.html')));
app.get('/processos', auth('conferencia'), (req, res) => res.sendFile(path.join(__dirname, 'processos.html')));

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
app.get('/api/conferencia/index', auth('conferencia'), async (req, res) => {
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

app.get('/api/conferencia/processo/:id', auth('conferencia'), async (req, res) => {
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

app.post('/api/conferencia/processo', auth('conferencia'), async (req, res) => {
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

app.delete('/api/conferencia/processo/:id', auth('conferencia'), requireGerente, async (req, res) => {
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
app.get('/controle', auth('controle'), (req, res) => res.sendFile(path.join(__dirname, 'controle_v2.html')));
// "Tela exclusiva" do Dashboard Financeiro — serve o MESMO controle_v2.html
// (o front-end detecta location.pathname==='/financeiro' e ajusta o que
// aparece na tela). Evita duplicar toda a lógica de abrir/editar processo,
// upload de documentos, autocomplete de contatos etc. num arquivo separado
// que rapidamente ficaria desatualizado em relação ao Controle de verdade.
app.get('/financeiro', auth('financeiro'), (req, res) => res.sendFile(path.join(__dirname, 'controle_v2.html')));
// "Tela exclusiva" do Dashboard Resultado (lucro estimado x real de todos
// os processos) — mesmo esquema do /financeiro acima: serve o MESMO
// controle_v2.html, e o front-end detecta location.pathname==='/resultado'
// pra abrir direto no Dashboard Resultado (ver ativarTelaResultadoExclusiva
// em controle-core.js).
app.get('/resultado', auth('resultado'), (req, res) => res.sendFile(path.join(__dirname, 'controle_v2.html')))
// "Tela exclusiva" do Dashboard Narcélio (visão do dono da empresa) —
// diferente de /financeiro e /resultado (visíveis a qualquer usuário com o
// módulo "processos"), aqui o back-end também confere o usuário logado:
// containers em água, faturamento e previsão de caixa são dados sensíveis
// que não devem ficar visíveis pra todo mundo que usa o Controle. Ver
// renderDashNarcelio() em controle-dash-narcelio.js e
// ativarTelaNarcelioExclusiva() em controle-core.js.
app.get('/narcelio', auth('narcelio'), (req, res) => {
  res.sendFile(path.join(__dirname, 'controle_v2.html'))
});
// Deep-link por processo — /controle/UD26-005 serve o mesmo controle_v2.html;
// o front-end lê location.pathname no load e abre o painel lateral do
// processo correspondente automaticamente (ver abrirProcessoPorURL()).
app.get('/controle/:ref', auth('controle'), (req, res) => res.sendFile(path.join(__dirname, 'controle_v2.html')));
// Tela TV — espelhada num monitor da empresa, substitui a planilha Excel
// manual (Backorders/Em Águas/No Chão). Sem restrição extra de usuário:
// qualquer um autenticado no Controle pode abrir (é só leitura ao vivo,
// nada sensível tipo o Dashboard Narcélio). Ver ativarTelaTVExclusiva()
// em controle-core.js e renderDashTV() em controle-dash-tv.js.
app.get('/tv', auth('tv'), (req, res) => res.sendFile(path.join(__dirname, 'controle_v2.html')));
app.get('/calculador', auth('tyredesk'), (req, res) => res.sendFile(path.join(__dirname, 'calculador.html'), {headers:{'Content-Type':'text/html; charset=utf-8'}}));

app.get('/api/controle/v2/processos', auth('controle','financeiro','resultado','tv','narcelio'), async (req, res) => {
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

app.post('/api/controle/v2/importar', auth('controle','financeiro','resultado','tv','narcelio'), async (req, res) => {
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
    // Whitelist de campos aceitos — evita que a planilha importada injete
    // colunas de controle interno (ex: fechado/fechado_por/id de outro processo)
    // que não deveriam vir de fora.
    const CAMPOS_IMPORT_PERMITIDOS = [
      'referencia', 'finalidade', 'fornecedor', 'brand', 'cliente', 'consignatario', 'notify',
      'produtos', 'fase', 'eta', 'data_embarque', 'data_chegada', 'data_prontidao',
      'navio', 'porto_origem', 'porto_destino', 'container_tipo', 'container_qtd',
      'peso_bruto', 'peso_liquido', 'volumes', 'pais_origem',
      'pi_valor_usd', 'pi_forma_pagamento', 'pi_data_saldo', 'pi_pago', 'pi_cambio_fechado',
      'ce_master', 'ce_house', 'transportadora',
    ];
    const novos = processos
      .filter(p => p.referencia && !refsExistentes.has(p.referencia))
      .map(p => {
        const filtrado = {};
        for (const campo of CAMPOS_IMPORT_PERMITIDOS) {
          if (p[campo] !== undefined) filtrado[campo] = p[campo];
        }
        return {
          ...filtrado,
          referencia: p.referencia,
          id: p.id || gerarUUID(),
          updated_at: agora,
          created_at: p.created_at || agora,
        };
      });

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

app.post('/api/controle/v2/processo', auth('controle','financeiro','resultado','tv','narcelio'), async (req, res) => {
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
    let processoExistente = false;
    if (processo.id) {
      const { data: atual } = await sb()
        .from('controle_processos')
        .select('fechado, cancelado, cancelamento_solicitado')
        .eq('id', processo.id)
        .maybeSingle();
      processoExistente = !!atual;
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

      // ── CANCELAMENTO DE PROCESSO ("Cancelar Processo") ──────────────
      // Pedido da Emanuelly (21/08/2026): processos que não vão pra frente
      // precisam sumir das contagens operacionais SEM perder o histórico
      // (diferente de excluir). Cancelar/reverter direto continua restrito
      // a gerente — ver também o fluxo de SOLICITAÇÃO logo abaixo, pedido
      // por ela no mesmo dia: quem não é gerente não cancela mais direto,
      // só "solicita" (com motivo) e um gerente aprova ou rejeita.
      const estavaCancelado = !!(atual && atual.cancelado);
      const tentandoCancelar     = !estavaCancelado && processo.cancelado === true;
      const tentandoDescancelar  = estavaCancelado && processo.cancelado === false;

      const estavaSolicitado  = !!(atual && atual.cancelamento_solicitado);
      const tentandoSolicitar = !estavaSolicitado && processo.cancelamento_solicitado === true;
      const tentandoRejeitar  = estavaSolicitado && processo.cancelamento_solicitado === false;

      if ((tentandoCancelar || tentandoDescancelar) && req.session.role !== 'gerente') {
        return res.status(403).json({ erro: 'Apenas gerentes podem cancelar ou reverter o cancelamento de um processo.' });
      }
      if (tentandoRejeitar && req.session.role !== 'gerente') {
        return res.status(403).json({ erro: 'Apenas gerentes podem rejeitar uma solicitação de cancelamento.' });
      }

      if (tentandoCancelar) {
        processo.cancelado_em = new Date().toISOString();
        processo.cancelado_por = req.session.usuario;
        // Aprovar (cancelar de verdade) encerra qualquer solicitação pendente.
        // cancelado_motivo é texto livre — se não vier no payload da aprovação,
        // mantém o motivo já registrado na solicitação original (não é tocado).
        processo.cancelamento_solicitado = false;
        processo.cancelamento_solicitado_em = null;
        processo.cancelamento_solicitado_por = null;
      } else if (tentandoDescancelar) {
        processo.cancelado_em = null;
        processo.cancelado_por = null;
        processo.cancelado_motivo = null;
      } else {
        delete processo.cancelado; // não deixa alterar por acidente num save comum
        if (!tentandoSolicitar && !tentandoRejeitar) delete processo.cancelado_motivo;
      }

      if (tentandoSolicitar) {
        processo.cancelamento_solicitado_em = new Date().toISOString();
        processo.cancelamento_solicitado_por = req.session.usuario;
        // Notifica (sino de notificações, visível a todos) pra um gerente
        // ver e decidir — clicar na notificação já abre o processo direto.
        try {
          await sb().from('controle_notificacoes').insert({
            processo_id: processo.id,
            tipo: 'alerta',
            titulo: `Solicitação de cancelamento: ${atual && atual.referencia ? atual.referencia : processo.referencia || ''}`,
            mensagem: `${req.session.usuario} solicitou o cancelamento deste processo.${processo.cancelado_motivo ? ' Motivo: ' + processo.cancelado_motivo : ''}`,
            created_by: req.session.usuario,
          });
        } catch (notifErr) {
          console.warn('notificacao solicitacao cancelamento erro:', notifErr.message);
        }
      } else if (tentandoRejeitar) {
        processo.cancelamento_solicitado_em = null;
        processo.cancelamento_solicitado_por = null;
        processo.cancelado_motivo = null;
      } else if (!tentandoCancelar) {
        delete processo.cancelamento_solicitado; // não deixa alterar por acidente num save comum
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

    // Processos já existentes usam UPDATE (não upsert): ações como Fechar/
    // Cancelar/Reabrir mandam só {id, campo} — um upsert nesse caso monta um
    // INSERT ... ON CONFLICT DO UPDATE, e o Postgres valida as colunas
    // NOT NULL (ex.: referencia) do candidato a INSERT mesmo quando a linha
    // já existe e o caminho real vai ser um UPDATE, derrubando esses saves
    // parciais com "null value in column referencia violates not-null
    // constraint" (bug relatado pela Paula, 21/08/2026). UPDATE só toca nas
    // colunas presentes no payload, então não tem esse problema.
    let error;
    if (processoExistente) {
      ({ error } = await sb()
        .from('controle_processos')
        .update(processoLimpo)
        .eq('id', processo.id));
    } else {
      ({ error } = await sb()
        .from('controle_processos')
        .upsert(processoLimpo, { onConflict: 'id' }));
    }
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

    // Alerta: Carregamento pendente (data de presenca preenchida mas sem data de carregamento)
    if (processo.data_presenca && !processo.data_carregamento && !processo.data_devolucao_vazio) {
      try {
        const { data: existenteCarreg } = await sb()
          .from('controle_notificacoes')
          .select('id')
          .eq('processo_id', processo.id)
          .eq('tipo', 'urgente')
          .eq('titulo', `Carregamento pendente: ${processo.referencia}`)
          .limit(1);
        if (!existenteCarreg || existenteCarreg.length === 0) {
          await sb().from('controle_notificacoes').insert({
            processo_id: processo.id,
            tipo: 'urgente',
            titulo: `Carregamento pendente: ${processo.referencia}`,
            mensagem: 'Presença de carga registrada, mas ainda sem Data de Carregamento.',
            created_by: req.session.usuario,
          });
        }
      } catch(notifErr) {
        console.warn('notificacao carregamento pendente erro:', notifErr.message);
      }
    }

    // Alerta: Transportadora pendente (agregado semanal, limiar configuravel)
    if (processo.data_agendamento && !processo.transportadora && !processo.data_devolucao_vazio) {
      try {
        const dataAg = new Date(processo.data_agendamento + 'T00:00:00');
        const diaSemana = dataAg.getDay(); // 0=domingo
        const offsetSegunda = diaSemana === 0 ? 6 : diaSemana - 1;
        const inicio = new Date(dataAg); inicio.setDate(dataAg.getDate() - offsetSegunda);
        const fim = new Date(inicio); fim.setDate(inicio.getDate() + 6);
        const inicioStr = inicio.toISOString().slice(0,10);
        const fimStr = fim.toISOString().slice(0,10);

        const { data: processosSemana } = await sb()
          .from('controle_processos')
          .select('id, transportadora, data_agendamento, data_devolucao_vazio')
          .gte('data_agendamento', inicioStr)
          .lte('data_agendamento', fimStr);

        const semTransportadora = (processosSemana || []).filter(p => !p.transportadora && !p.data_devolucao_vazio);
        const limiar = parseInt(process.env.CARGA_ALERTA_TRANSPORTADORA_LIMIAR || '3', 10);

        if (semTransportadora.length >= limiar) {
          const tituloSemana = `Transportadoras pendentes - semana de ${inicioStr}`;
          const { data: existenteTransp } = await sb()
            .from('controle_notificacoes')
            .select('id')
            .eq('tipo', 'urgente')
            .eq('titulo', tituloSemana)
            .limit(1);
          if (!existenteTransp || existenteTransp.length === 0) {
            await sb().from('controle_notificacoes').insert({
              tipo: 'urgente',
              titulo: tituloSemana,
              mensagem: `${semTransportadora.length} processo(s) agendados nesta semana sem Transportadora preenchida.`,
              created_by: req.session.usuario,
            });
          }
        }
      } catch(notifErr) {
        console.warn('notificacao transportadora pendente erro:', notifErr.message);
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
app.get('/api/controle/v2/processo/:id/log', auth('controle','financeiro','resultado','tv','narcelio'), async (req, res) => {
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

app.delete('/api/controle/v2/processo/:id', auth('controle','financeiro','resultado','tv','narcelio'), requireGerente, async (req, res) => {
  try {
    const id = req.params.id;
    // Antes disto, o DELETE só apagava a linha em controle_processos — em
    // qualquer processo com histórico (controle_log, populado a cada save),
    // notificação (controle_notificacoes) ou arquivo GED (controle_arquivos)
    // isso batia numa violação de foreign key no Postgres e o processo
    // "não excluía" sem mensagem clara (o front-end só mostrava "Erro ao
    // excluir" genérico). Processo novo/vazio excluía normalmente, o que
    // explicava o "só alguns processos não excluem" — na prática, qualquer
    // processo já usado de verdade. Agora apaga os dependentes primeiro
    // (arquivos GED também do Storage, não só a linha da tabela).
    const { data: arquivos } = await sb().from('controle_arquivos').select('storage_path').eq('processo_id', id);
    const paths = (arquivos || []).map(a => a.storage_path).filter(Boolean);
    if (paths.length) {
      try { await sb().storage.from(GED_BUCKET).remove(paths); }
      catch (e) { console.warn('excluir processo: falha ao limpar Storage GED:', e.message); }
    }
    await sb().from('controle_arquivos').delete().eq('processo_id', id);
    await sb().from('controle_notificacoes').delete().eq('processo_id', id);
    await sb().from('controle_log').delete().eq('processo_id', id);

    const { error } = await sb().from('controle_processos').delete().eq('id', id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (e) {
    console.error('controle/v2/processo DELETE erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

app.get('/api/controle/v2/notificacoes', auth('controle','financeiro','resultado','tv','narcelio'), async (req, res) => {
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

app.post('/api/controle/v2/notificacao', auth('controle','financeiro','resultado','tv','narcelio'), async (req, res) => {
  try {
    const { processo_id, tipo, titulo, mensagem } = req.body;
    if (!tipo || !titulo || !mensagem) return res.status(400).json({ erro: 'tipo, titulo e mensagem são obrigatórios' });
    if (processo_id) {
      const { data: procCheck } = await sb().from('controle_processos').select('id').eq('id', processo_id).maybeSingle();
      if (!procCheck) return res.status(400).json({ erro: 'processo_id inválido' });
    }
    await sb().from('controle_notificacoes').insert({
      processo_id, tipo, titulo, mensagem, created_by: req.session.usuario,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

app.post('/api/controle/v2/notificacao/:id/lida', auth('controle','financeiro','resultado','tv','narcelio'), async (req, res) => {
  try {
    const usuario = req.session.usuario;
    const { data } = await sb().from('controle_notificacoes').select('lida_por').eq('id', req.params.id).single();
    const lidaPor = [...(data?.lida_por || [])];
    if (!lidaPor.includes(usuario)) lidaPor.push(usuario);
    await sb().from('controle_notificacoes').update({ lida_por: lidaPor }).eq('id', req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});


app.get('/api/controle/index', auth('controle','financeiro','resultado','tv','narcelio'), async (req, res) => {
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

app.get('/api/controle/processo/:id', auth('controle','financeiro','resultado','tv','narcelio'), async (req, res) => {
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

app.post('/api/controle/processo', auth('controle','financeiro','resultado','tv','narcelio'), async (req, res) => {
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

app.delete('/api/controle/processo/:id', auth('controle','financeiro','resultado','tv','narcelio'), requireGerente, async (req, res) => {
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

app.post('/api/controle/importar', auth('controle','financeiro','resultado','tv','narcelio'), async (req, res) => {
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

app.get('/api/controle/carregar', auth('controle','financeiro','resultado','tv','narcelio'), async (req, res) => {
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
  if (!Array.isArray(base) || base.length === 0) return res.status(400).json({ erro: 'Base inválida ou vazia' });
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
  if (!Array.isArray(fornecedores) || fornecedores.length === 0) return res.status(400).json({ erro: 'Lista de fornecedores inválida ou vazia' });
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
  if (!Array.isArray(snapshots)) return res.status(400).json({ erro: 'Snapshots inválidos' });
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
app.post('/api/analisar', auth('conferencia','controle'), rateLimitAnalisar, async (req, res) => {
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

app.get('/api/analisar/job/:id', auth('conferencia','controle'), async (req, res) => {
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

app.get('/api/controle/v2/arquivos/:processoId', auth('controle','financeiro','resultado','tv','narcelio'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_arquivos')
      .select('id, nome, tipo, tamanho, storage_path, created_at, created_by')
      .eq('processo_id', req.params.processoId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    // Bucket é privado (corrigido 22/08/2026 — estava público, qualquer um
    // com o link abria PI/CI/BL/NF sem estar logado no sistema). Agora usa
    // link assinado, válido por 1h, gerado só pra quem já passou pelo
    // auth('controle',...) desta rota — não dá pra montar a URL sem estar
    // autenticado no Controle.
    const arquivos = await Promise.all((data || []).map(async a => {
      const { data: urlData, error: signErro } = await sb().storage
        .from(GED_BUCKET)
        .createSignedUrl(a.storage_path, 3600);
      if (signErro) console.warn('ged signed url erro:', a.storage_path, signErro.message);
      return { ...a, url: urlData?.signedUrl || '' };
    }));
    res.json({ ok: true, arquivos });
  } catch (e) {
    console.error('ged listar erro:', e.message);
    res.json({ ok: true, arquivos: [] });
  }
});

app.post('/api/controle/v2/arquivos', auth('controle','financeiro','resultado','tv','narcelio'), async (req, res) => {
  try {
    const { processo_id, nome, tipo, base64 } = req.body;
    if (!processo_id || !nome || !base64) return res.status(400).json({ erro: 'Dados incompletos' });

    const tiposPermitidos = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (!tiposPermitidos.includes(tipo)) return res.status(400).json({ erro: 'Tipo de arquivo não permitido' });

    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length > 15 * 1024 * 1024) return res.status(400).json({ erro: 'Arquivo maior que 15MB' });

    const arquivoId = gerarUUID();
    // Extensão vem de um mapa fixo baseado no MIME já validado acima (tiposPermitidos),
    // não do nome enviado pelo cliente — evita caminho de storage com conteúdo inesperado.
    const extPorTipo = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png' };
    const extensao = extPorTipo[tipo] || 'bin';
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

app.delete('/api/controle/v2/arquivos/:id', auth('controle','financeiro','resultado','tv','narcelio'), requireGerente, async (req, res) => {
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

app.post('/api/contatos', auth('controle','financeiro','resultado','tv','narcelio'), async (req, res) => {
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

app.delete('/api/contatos/:id', auth('controle','financeiro','resultado','tv','narcelio'), requireGerente, async (req, res) => {
  try {
    const { error } = await sb().from('contatos_clientes').update({ ativo: false }).eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

app.post('/api/calculador/importar-planilha', auth('tyredesk'), (req, res) => { try { const { arquivo_base64 } = req.body; if (!arquivo_base64) return res.status(400).json({ ok: false, erro: 'Nenhum arquivo enviado.' }); const buffer = Buffer.from(arquivo_base64, 'base64'); const resultado = importarPlanilhaBase(buffer); res.json({ ok: true, campos: resultado.campos, mix: resultado.mix }); } catch (e) { console.error('Erro ao importar planilha:', e.message); res.status(400).json({ ok: false, erro: e.message }); } });
app.post('/api/controle/importar-fechamento', auth('controle','financeiro','resultado','tv','narcelio'), (req, res) => { try { const { arquivo_base64 } = req.body; if (!arquivo_base64) return res.status(400).json({ ok: false, erro: 'Nenhum arquivo enviado.' }); const buffer = Buffer.from(arquivo_base64, 'base64'); const resultado = importarFechamentoBase(buffer); res.json({ ok: true, datas: resultado.datas, real_json: resultado.real_json, moedas: resultado.moedas, avisos: resultado.avisos }); } catch (e) { console.error('Erro ao importar fechamento:', e.message); res.status(400).json({ ok: false, erro: e.message }); } });
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
  if (!req.session.modulos.includes('controle')) {
    return res.status(403).json({ erro: 'Sem acesso ao Controle — não é possível aprovar cotações' });
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

    // Trava contra duplo clique/corrida: só atualiza o resumo (marcando
    // aprovada) se o resumo no banco ainda for exatamente o que acabamos de
    // ler (compare-and-swap via .eq no valor antigo). Se 0 linhas voltarem,
    // outra requisição venceu a corrida — não cria processo duplicado.
    const { data: casRows, error: errCas } = await sb()
      .from('calculador_cotacoes')
      .update({ resumo: novoResumo })
      .eq('id', req.params.id)
      .eq('resumo', cot.resumo)
      .select('id');
    if (errCas) throw new Error(errCas.message);
    if (!casRows || !casRows.length) {
      const { data: fresco } = await sb().from('calculador_cotacoes').select('resumo').eq('id', req.params.id).maybeSingle();
      const r = (fresco && fresco.resumo) || {};
      return res.json({ ok: true, ja_aprovada: true, processo_id: r.processo_id, processo_referencia: r.processo_referencia });
    }

    const { error: errProc } = await sb().from('controle_processos').insert(processo);
    if (errProc) {
      // Resumo já ficou marcado como aprovado mas o processo não foi criado —
      // caso raro (falha do insert depois do CAS); loga alto pra correção manual.
      console.error(`INCONSISTÊNCIA: cotação ${cot.id} marcada aprovada mas processo ${processo.id} falhou ao inserir: ${errProc.message}`);
      throw new Error(errProc.message);
    }

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
app.post('/api/chat', auth(), rateLimitChat, async (req, res) => {
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
  // Não expõe segredos/detalhes internos aqui de propósito — esse endpoint
  // é público (sem auth) pra healthcheck do Railway. Ver logs do servidor
  // pra diagnóstico detalhado de erro do Supabase/Anthropic.
  let supabaseOk = false;
  try {
    const { error } = await sb().from('conferencia_processos').select('id').limit(1);
    supabaseOk = !error;
  } catch (e) {
    supabaseOk = false;
  }

  res.json({ ok: true, supabase: supabaseOk });
});

// ── Vincular cotação a processo existente (item d) ──────────────────────
app.get('/api/controle/processos-abertos', auth('controle','financeiro','resultado','tv','narcelio'), async (req, res) => {
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
  if (!req.session.modulos.includes('controle')) {
    return res.status(403).json({ erro: 'Sem acesso ao Controle — não é possível vincular cotações' });
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
// pra revisão antes de salvar como cotação nova. Antes disto, processos com
// Custos Reais já lançados (real_json) eram bloqueados aqui (erro 400) —
// só era permitido vincular na fase inicial. Ayslan pediu pra permitir
// sempre (ex: UD26-109), inclusive pra replicar/simular no Calculador o
// fechamento de um processo já em andamento. Mantemos só um aviso (não
// bloqueia): salvar essa cotação nova não altera os Custos Reais já
// lançados no processo original — é sempre uma cotação independente.
app.get('/api/controle/processos/:id/prefill-cotacao', auth('controle','financeiro','resultado','tv','narcelio'), async (req, res) => {
  try {
    const { data: proc, error } = await sb()
    .from('controle_processos').select('*').eq('id', req.params.id).single();
    if (error) throw new Error(error.message);
    const dados = mapearProcessoParaCotacao(proc);
    const aviso = proc.real_json
    ? 'Este processo já tem Custos Reais lançados. Os dados pré-preenchidos aqui são só uma referência/simulação — salvar esta cotação não altera os Custos Reais já lançados no processo original.'
      : null;
    res.json({ ok: true, dados, referencia: proc.referencia, aviso });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ── FOLLOW-UP SEMANAL POR E-MAIL (processos com ETA próxima) ────
// Toda semana, junta os processos ativos com chegada prevista (ETA) nos
// próximos 10 dias, agrupa por cliente, e manda por e-mail pra Ayslan e
// Emanuelly conferirem — Emanuelly repassa manualmente ao cliente depois
// (não vai direto pro cliente, de propósito: é um rascunho pra revisão).
// Pede também a transportadora de cada processo, pra dar tempo hábil de
// organizar a retirada assim que a carga desembaraçar.
const FOLLOWUP_DIAS_JANELA = 10;
const FOLLOWUP_DESTINATARIOS = ['suporte@impak.com.br']; // so suporte@impak.com.br por enquanto: a conta Resend ainda nao tem dominio verificado (task #147) e em modo sandbox so entrega pro proprio email da conta. Depois de verificar o dominio, pode voltar a incluir outros destinatarios (Ayslan, Emanuelly, etc).

async function processosParaFollowUpSemanal(){
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const limite = new Date(hoje); limite.setDate(hoje.getDate() + FOLLOWUP_DIAS_JANELA);
  const hojeStr = hoje.toISOString().split('T')[0];
  const limiteStr = limite.toISOString().split('T')[0];

  const { data, error } = await sb()
    .from('controle_processos')
    .select('id, referencia, cliente, fornecedor, produto, produtos_json, eta, porto_destino, armador, navio, transportadora, fase')
    .not('eta', 'is', null)
    .gte('eta', hojeStr)
    .lte('eta', limiteStr)
    .neq('fase', 'FINALIZADO')
    .order('eta', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

function descricaoProdutos(p){
  try{
    if (p.produtos_json) {
      const itens = JSON.parse(p.produtos_json).filter(it => it && it.descricao);
      if (itens.length) return itens.map(it => it.descricao + (it.quantidade ? ` (${it.quantidade})` : '')).join(', ');
    }
  } catch(e) { /* ignora produtos_json malformado, cai no campo legado abaixo */ }
  return p.produto || '—';
}

function montarHtmlFollowUpSemanal(processos){
  const escHtml = v => v ? String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : '';
  const fmtData = iso => { try { return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR'); } catch(e) { return iso || '—'; } };

  const porCliente = {};
  processos.forEach(p => {
    const chave = p.cliente || '(cliente não definido)';
    (porCliente[chave] = porCliente[chave] || []).push(p);
  });

  const blocosCliente = Object.keys(porCliente).sort((a,b)=>a.localeCompare(b,'pt-BR')).map(cliente => {
    const linhas = porCliente[cliente].map(p => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-weight:600;">${escHtml(p.referencia)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${escHtml(p.fornecedor)||'—'}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${escHtml(descricaoProdutos(p))}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;">${fmtData(p.eta)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${escHtml(p.porto_destino)||'—'}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${escHtml(p.navio)||'—'}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:${p.transportadora?'#166534':'#b45309'};font-weight:600;">${escHtml(p.transportadora)||'⚠ a definir'}</td>
      </tr>`).join('');
    return `
      <div style="margin-bottom:24px;">
        <div style="font-size:15px;font-weight:700;color:#0a2d5e;margin-bottom:8px;">${escHtml(cliente)}</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;font-family:sans-serif;">
          <thead>
            <tr style="background:#f3f4f6;">
              <th style="padding:8px 10px;text-align:left;">Referência</th>
              <th style="padding:8px 10px;text-align:left;">Fornecedor</th>
              <th style="padding:8px 10px;text-align:left;">Produto</th>
              <th style="padding:8px 10px;text-align:center;">ETA</th>
              <th style="padding:8px 10px;text-align:left;">Destino</th>
              <th style="padding:8px 10px;text-align:left;">Navio</th>
              <th style="padding:8px 10px;text-align:left;">Transportadora</th>
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>`;
  }).join('');

  return `
    <div style="font-family:sans-serif;max-width:760px;margin:0 auto;">
      <h2 style="color:#1a7fd4;margin-bottom:4px;">IMPAK — Follow-up Semanal</h2>
      <p style="color:#444;font-size:13px;margin-top:0;">Processos com chegada prevista (ETA) nos próximos ${FOLLOWUP_DIAS_JANELA} dias, agrupados por cliente.</p>
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#92400e;">
        ⚠ <strong>Pedir a transportadora de cada processo</strong> o quanto antes — as linhas marcadas "a definir" ainda não têm transportadora informada no sistema. Isso dá tempo hábil pra organizar a retirada assim que a carga desembaraçar.
      </div>
<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#1e3a8a;">
As datas de chegada (ETA) informadas sao previsoes e podem sofrer alteracoes ou atrasos - inclua esse aviso ao repassar o follow-up para os clientes. Para os processos com chegada prevista NESTA SEMANA, pergunte ao cliente qual transportadora sera utilizada, para termos tempo habil de organizar o fluxo do processo.
</div>
      ${blocosCliente || '<p style="color:#666;">Nenhum processo com ETA nos próximos ' + FOLLOWUP_DIAS_JANELA + ' dias.</p>'}
      <p style="font-size:11px;color:#888;margin-top:24px;">Este e-mail é um rascunho interno para conferência — Emanuelly revisa e repassa manualmente aos clientes depois de confirmar os dados.</p>
    </div>`;
}

async function jaEnviouFollowUpHoje(){
  const { data, error } = await sb().from('app_job_runs').select('last_run_at').eq('job_name', 'followup_semanal').maybeSingle();
  if (error) {
    // Falha ao consultar (tabela ausente, permissão, etc): assume que JÁ
    // enviou hoje (fail-closed) pra nunca disparar em loop por causa de um
    // erro de infraestrutura. O erro fica visível no log do Railway.
    console.error('jaEnviouFollowUpHoje: erro ao consultar app_job_runs, assumindo já enviado por segurança:', error.message);
    return true;
  }
  if (!data || !data.last_run_at) return false;
  const ultima = new Date(data.last_run_at);
  const hoje = new Date();
  return ultima.getFullYear() === hoje.getFullYear() && ultima.getMonth() === hoje.getMonth() && ultima.getDate() === hoje.getDate();
}

async function marcarFollowUpEnviadoHoje(){
  const { error } = await sb().from('app_job_runs').upsert({ job_name: 'followup_semanal', last_run_at: new Date().toISOString() });
  if (error) console.error('marcarFollowUpEnviadoHoje: falha ao gravar app_job_runs (job pode repetir!):', error.message);
}

async function enviarFollowUpSemanal(){
  const processos = await processosParaFollowUpSemanal();
  const html = montarHtmlFollowUpSemanal(processos);
  const assunto = `IMPAK — Follow-up Semanal (${processos.length} processo${processos.length===1?'':'s'} com ETA próxima)`;
  for (const destinatario of FOLLOWUP_DESTINATARIOS) {
    await enviarEmail(destinatario, assunto, html);
  }
  await marcarFollowUpEnviadoHoje();
  return processos.length;
}

// Checagem a cada 30 min: dispara automaticamente todo domingo (uma vez só
// por dia, mesmo que o servidor reinicie no meio do domingo — ver
// jaEnviouFollowUpHoje/app_job_runs). Sem lib de cron: o processo do
// Railway fica sempre no ar, então um setInterval simples cobre o caso.
setInterval(() => {
  const agora = new Date();
  if (agora.getDay() !== 0) return; // 0 = domingo
  jaEnviouFollowUpHoje().then(ja => {
    if (ja) return;
    enviarFollowUpSemanal()
      .then(n => console.log(`✓ Follow-up semanal enviado (${n} processos)`))
      .catch(e => console.error('Erro no follow-up semanal:', e.message));
  }).catch(e => console.error('Erro ao checar follow-up semanal:', e.message));
}, 30 * 60 * 1000);

// Disparo manual pra testar sem esperar domingo — restrito a gerente.
app.post('/api/admin/followup-semanal', (req, res) => {
  if (!req.session.usuario) return res.status(401).json({ ok: false, erro: 'Não autenticado' });
  if (req.session.role !== 'gerente') return res.status(403).json({ ok: false, erro: 'Apenas gerentes podem fazer isso' });
  enviarFollowUpSemanal()
    .then(n => res.json({ ok: true, processos: n }))
    .catch(e => res.status(500).json({ ok: false, erro: e.message }));
});

// ── ALERTAS DIÁRIOS (demurrage crítico, ETA vencido, ETA na semana, PI vencida) ──
async function jaEnviouAlertasHoje(){
const { data, error } = await sb().from('app_job_runs').select('last_run_at').eq('job_name', 'alertas_diarios').maybeSingle();
if (error) {
  // Mesmo raciocínio do jaEnviouFollowUpHoje: se a consulta falhar, assume
  // que já foi enviado hoje (fail-closed) em vez de deixar o job repetir
  // a cada 30min indefinidamente. Erro visível no log do Railway.
  console.error('jaEnviouAlertasHoje: erro ao consultar app_job_runs, assumindo já enviado por segurança:', error.message);
  return true;
}
if (!data || !data.last_run_at) return false;
const ultima = new Date(data.last_run_at);
const hoje = new Date();
return ultima.getFullYear() === hoje.getFullYear() && ultima.getMonth() === hoje.getMonth() && ultima.getDate() === hoje.getDate();
}

async function marcarAlertasEnviadosHoje(){
const { error } = await sb().from('app_job_runs').upsert({ job_name: 'alertas_diarios', last_run_at: new Date().toISOString() });
if (error) console.error('marcarAlertasEnviadosHoje: falha ao gravar app_job_runs (job pode repetir!):', error.message);
}

async function verificarAlertasDiarios(){
const { data: processos, error } = await sb().from('controle_processos').select('*').order('updated_at', { ascending: false });
if (error) { console.error('Erro ao buscar processos p/ alertas diarios:', error.message); return 0; }
const hoje = new Date();
const semana = new Date(hoje); semana.setDate(hoje.getDate() + 7);
const ativos = (processos || []).filter(p => p.fase !== 'FINALIZADO');
function demDias(p){
if (!p.demurrage_vencimento || p.data_devolucao_vazio) return null;
const d = new Date(p.demurrage_vencimento);
return Math.ceil((d - hoje) / 86400000);
}
const demCrit = ativos.filter(p => { const d = demDias(p); return d !== null && d <= 5; });
const etaVenc = ativos.filter(p => p.eta && p.fase === 'EMBARCADO' && new Date(p.eta) < hoje);
const etaSem = ativos.filter(p => p.eta && new Date(p.eta) >= hoje && new Date(p.eta) <= semana && p.fase === 'EMBARCADO');
const piVenc = ativos.filter(p => p.pi_data_saldo && !p.pi_pago && new Date(p.pi_data_saldo) < hoje);
const total = demCrit.length + etaVenc.length + etaSem.length + piVenc.length;
if (!total) { await marcarAlertasEnviadosHoje(); return 0; }
const escHtmlAlerta = v => v ? String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : '';
const linhaProc = (p, extra) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;">${escHtmlAlerta(p.referencia) || '-'}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${escHtmlAlerta(p.cliente || p.fornecedor) || '-'}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${escHtmlAlerta(p.fase) || '-'}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${escHtmlAlerta(extra)}</td></tr>`;
const tabela = (titulo, itens, extraFn) => itens.length ? `<h3 style="margin:20px 0 8px;color:#333;">${titulo} (${itens.length})</h3><table style="width:100%;border-collapse:collapse;font-size:13px;"><tr><th style="text-align:left;padding:6px 10px;">Referencia</th><th style="text-align:left;padding:6px 10px;">Cliente/Fornecedor</th><th style="text-align:left;padding:6px 10px;">Fase</th><th style="text-align:left;padding:6px 10px;"></th></tr>${itens.map(p => linhaProc(p, extraFn(p))).join('')}</table>` : '';
let html = `<div style="font-family:sans-serif;max-width:640px;margin:0 auto;"><h2 style="color:#1a7fd4;">IMPAK Portal - Alertas do dia (${hoje.toLocaleDateString('pt-BR')})</h2>`;
html += tabela('Demurrage critico (ate 5 dias)', demCrit, p => { const d = demDias(p); return d < 0 ? `Vencido ha ${-d}d` : `Vence em ${d}d`; });
html += tabela('ETA vencido (ainda embarcado)', etaVenc, p => `ETA: ${new Date(p.eta).toLocaleDateString('pt-BR')}`);
html += tabela('Chegando essa semana', etaSem, p => `ETA: ${new Date(p.eta).toLocaleDateString('pt-BR')}`);
html += tabela('PI vencida (saldo nao pago)', piVenc, p => `Venceu: ${new Date(p.pi_data_saldo).toLocaleDateString('pt-BR')}${p.pi_valor_usd ? ' - US$ ' + Number(p.pi_valor_usd).toLocaleString('pt-BR',{minimumFractionDigits:2}) : ''}`);
html += `<p style="margin-top:20px;font-size:12px;color:#888;">E-mail automatico diario do IMPAK Portal.</p></div>`;
let destinatarios = (process.env.ALERTA_EMAIL_PARA || '').split(',').map(s => s.trim()).filter(Boolean);
if (!destinatarios.length) {
destinatarios = [..._usuariosCache.values()].filter(u => u.role === 'gerente' && u.email).map(u => u.email);
}
for (const email of destinatarios) {
try { await enviarEmail(email, `IMPAK Portal - ${total} alerta(s) hoje`, html); }
catch (e) { console.error(`Erro ao enviar e-mail de alerta pra ${email}:`, e.message); }
}
await marcarAlertasEnviadosHoje();
return total;
}

function agendarAlertasDiarios(){
setInterval(() => {
jaEnviouAlertasHoje().then(ja => {
if (ja) return;
verificarAlertasDiarios().catch(e => console.error('Erro nos alertas diarios:', e.message));
}).catch(e => console.error('Erro ao checar alertas diarios:', e.message));
}, 30 * 60 * 1000); // checa a cada 30min; só dispara 1x/dia (controlado por app_job_runs)
}

app.post('/api/admin/alertas-diarios', (req, res) => {
if (!req.session.usuario) return res.status(401).json({ ok: false, erro: 'Não autenticado' });
if (req.session.role !== 'gerente') return res.status(403).json({ ok: false, erro: 'Apenas gerentes podem fazer isso' });
verificarAlertasDiarios()
.then(n => res.json({ ok: true, total: n || 0 }))
.catch(e => res.status(500).json({ ok: false, erro: e.message }));
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
  console.log(`ANTHROPIC_API_KEY configurada: ${!!process.env.ANTHROPIC_API_KEY} | SUPABASE_URL configurada: ${!!process.env.SUPABASE_URL}`);
  agendarAlertasDiarios();
sincronizarUsuarios().catch(e => console.error('Erro ao sincronizar usuários no boot:', e.message));
});
