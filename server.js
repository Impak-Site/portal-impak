/**
 * IMPAK Portal — Servidor
 * Dois módulos separados:
 *   GET /            → tyredesk.html  (narcelio, jean)
 *   GET /processos   → processos.html (todos)
 *
 * Variáveis Railway:
 *   GOOGLE_CREDENTIALS  → JSON da conta de serviço
 *   DRIVE_FOLDER_ID     → ID pasta Drive
 *   SESSION_SECRET      → texto aleatório
 *   NODE_ENV            → production
 */

const express    = require('express');
const session    = require('express-session');
const path       = require('path');
const fs         = require('fs');
const { google } = require('googleapis');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── USUÁRIOS ─────────────────────────────────────────────────
const USUARIOS = [
  { usuario: 'narcelio',  email: 'Narcelio@impak.com.br',    senha: 'Narcelio@2026',      modulos: ['tyredesk','processos'], nome: 'Narcelio', role: 'gerente',  displayName: 'Narcelio'  },
  { usuario: 'jean',      email: 'Jean@impak.com.br',        senha: 'Jeanimpak2026',      modulos: ['tyredesk','processos'], nome: 'Jean',     role: 'gerente',  displayName: 'Jean'      },
  { usuario: 'paula',     email: 'Paula@impak.com.br',       senha: 'Paula@2026',         modulos: ['processos'],            nome: 'Paula',    role: 'gerente',  displayName: 'Paula'     },
  { usuario: 'emanuelly', email: 'importacao1@impak.com.br', senha: 'EmanuellyImpak2026', modulos: ['processos'],            nome: 'Emanuelly',role: 'analista', displayName: 'Emanuelly' },
];

// ── GOOGLE DRIVE ──────────────────────────────────────────────
const FOLDER_ID = process.env.DRIVE_FOLDER_ID || '';
let driveClient = null;

function initDrive() {
  try {
    const creds = process.env.GOOGLE_CREDENTIALS;
    if (!creds) { console.warn('⚠ GOOGLE_CREDENTIALS não configurado'); return; }
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(creds),
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    driveClient = google.drive({ version: 'v3', auth });
    console.log('✓ Google Drive conectado');
  } catch (e) { console.error('✗ Drive error:', e.message); }
}

async function driveUpsert(nome, conteudo) {
  if (!driveClient || !FOLDER_ID) return null;
  try {
    const { data: lista } = await driveClient.files.list({
      q: `name='${nome}' and '${FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id)',
    });
    const media = { mimeType: 'application/json', body: typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo) };
    if (lista.files.length) {
      await driveClient.files.update({ fileId: lista.files[0].id, media });
      return lista.files[0].id;
    }
    const { data: f } = await driveClient.files.create({
      requestBody: { name: nome, parents: [FOLDER_ID] }, media, fields: 'id',
    });
    return f.id;
  } catch (e) { console.error('Drive upsert error:', e.message); return null; }
}

async function driveRead(nome) {
  if (!driveClient || !FOLDER_ID) return null;
  try {
    const { data: lista } = await driveClient.files.list({
      q: `name='${nome}' and '${FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id)',
    });
    if (!lista.files.length) return null;
    const { data } = await driveClient.files.get(
      { fileId: lista.files[0].id, alt: 'media' },
      { responseType: 'text' }
    );
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (e) { console.error('Drive read error:', e.message); return null; }
}

// ── MIDDLEWARE ────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'impak-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 8 * 60 * 60 * 1000 },
}));

// Servir arquivos estáticos da pasta atual
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
    <div class="footer">IMPAK Comercial Importadora · Portal v1.0 · Confidencial</div>
  </div>
</div>
</body>
</html>`;

function loginPage(erro, destino) {
  return LOGIN_HTML
    .replace('ERRO_PLACEHOLDER', erro ? `<div class="err">${erro}</div>` : '')
    .replace('DESTINO_PLACEHOLDER', destino || '/');
}

// ── ROTAS DE AUTENTICAÇÃO ─────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session.usuario) return res.redirect(req.query.destino || '/');
  res.send(loginPage('', req.query.destino || '/'));
});

app.post('/login', (req, res) => {
  const { usuario, senha, destino } = req.body;
  const login = (usuario||'').trim().toLowerCase();
  const u = USUARIOS.find(x => (x.usuario === login || x.email.toLowerCase() === login) && x.senha === senha);
  if (!u) {
    return res.send(loginPage('Usuário ou senha incorretos.', destino || '/'));
  }
  req.session.usuario = u.usuario;
  req.session.nome    = u.nome;
  req.session.modulos = u.modulos;
  req.session.role    = u.role || null;
  req.session.displayName = u.displayName || u.nome;
  // Senha para descriptografar TyreDesk
  req.session.senha = u.senha;
  res.redirect(destino || '/');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ── MIDDLEWARE DE AUTENTICAÇÃO ────────────────────────────────
function auth(modulo) {
  return (req, res, next) => {
    if (!req.session.usuario) {
      return res.redirect('/login?destino=' + req.path);
    }
    if (modulo && !req.session.modulos.includes(modulo)) {
      return res.status(403).send('<h2>Acesso negado</h2>');
    }
    next();
  };
}

// ── PÁGINAS ───────────────────────────────────────────────────
app.get('/', auth('tyredesk'), (req, res) => {
  res.sendFile(path.join(__dirname, 'tyredesk.html'));
});

app.get('/processos', auth('processos'), (req, res) => {
  res.sendFile(path.join(__dirname, 'processos.html'));
});

app.get('/controle', auth('processos'), (req, res) => {
  res.sendFile(path.join(__dirname, 'controle.html'));
});

app.get('/importar', auth('processos'), (req, res) => {
  res.sendFile(path.join(__dirname, 'importar.html'));
});

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
    senha:       req.session.senha,  // para decrypt TyreDesk
  });
});

// ── API: DRIVE TYREDESK ───────────────────────────────────────
app.post('/api/drive/salvar', auth(), async (req, res) => {
  try {
    const { cotacoes } = req.body;
    await driveUpsert(`cotacoes_${req.session.usuario}.json`, cotacoes);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/drive/tudo', auth(), async (req, res) => {
  try {
    const cotacoes = await driveRead(`cotacoes_${req.session.usuario}.json`) || [];
    res.json({ cotacoes });
  } catch (e) { res.json({ cotacoes: [] }); }
});

app.post('/api/drive/historico', auth(), async (req, res) => {
  try {
    const { entrada } = req.body;
    let hist = await driveRead('historico_emails.json') || [];
    hist.unshift(entrada);
    if (hist.length > 200) hist = hist.slice(0, 200);
    await driveUpsert('historico_emails.json', hist);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/drive/historico', auth(), async (req, res) => {
  try {
    const historico = await driveRead('historico_emails.json') || [];
    res.json({ historico });
  } catch (e) { res.json({ historico: [] }); }
});

app.get('/api/drive/status', auth(), (req, res) => {
  res.json({ conectado: !!driveClient, folder: FOLDER_ID || null });
});

// ── API: PROCESSOS ────────────────────────────────────────────
app.post('/api/processos/salvar', auth(), async (req, res) => {
  try {
    const { username, processo } = req.body;
    const nome = `processos_${username}.json`;
    let lista = await driveRead(nome) || [];
    const i = lista.findIndex(p => p.id === processo.id);
    if (i >= 0) lista[i] = processo; else lista.unshift(processo);
    await driveUpsert(nome, lista);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/processos', auth(), async (req, res) => {
  try {
    const username = req.query.usuario || req.session.usuario;
    const processos = await driveRead(`processos_${username}.json`) || [];
    res.json({ processos });
  } catch (e) { res.json({ processos: [] }); }
});

app.get('/api/processos/todos', auth('processos'), async (req, res) => {
  try {
    // Gerentes veem todos
    const todos = [];
    for (const u of USUARIOS.filter(x => x.modulos.includes('processos'))) {
      const lista = await driveRead(`processos_${u.usuario}.json`) || [];
      todos.push(...lista);
    }
    todos.sort((a, b) => new Date(b.updatedAt||0) - new Date(a.updatedAt||0));
    res.json({ processos: todos });
  } catch (e) { res.json({ processos: [] }); }
});

app.get('/api/processos/:id', auth(), async (req, res) => {
  try {
    const username = req.query.usuario || req.session.usuario;
    const lista = await driveRead(`processos_${username}.json`) || [];
    const processo = lista.find(p => p.id === req.params.id) || null;
    res.json({ processo });
  } catch (e) { res.json({ processo: null }); }
});

app.delete('/api/processos/:id', auth(), async (req, res) => {
  try {
    const username = req.body.username || req.session.usuario;
    const nome = `processos_${username}.json`;
    let lista = await driveRead(nome) || [];
    lista = lista.filter(p => p.id !== req.params.id);
    await driveUpsert(nome, lista);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});


// ── API: BASE GLOBAL TYREDESK ─────────────────────────────
app.post('/api/base/salvar', auth('tyredesk'), async (req, res) => {
  try {
    const { base } = req.body;
    await driveUpsert('tyredesk_base_global.json', base);
    console.log(`Base global salva por ${req.session.usuario}: ${base.length} itens`);
    res.json({ ok: true, total: base.length });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/base/carregar', auth(), async (req, res) => {
  try {
    const base = await driveRead('tyredesk_base_global.json');
    if (base) res.json({ ok: true, base, total: base.length });
    else res.json({ ok: false, base: null });
  } catch (e) { res.json({ ok: false, base: null }); }
});

// ── API: CONTROLE DE PROCESSOS ───────────────────────────────
app.post('/api/controle/salvar', auth('processos'), async (req, res) => {
  try {
    const { processos } = req.body;
    await driveUpsert('controle_processos.json', processos);
    res.json({ ok: true, total: processos.length });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/controle/carregar', auth('processos'), async (req, res) => {
  try {
    const processos = await driveRead('controle_processos.json');
    if (processos) res.json({ ok: true, processos });
    else res.json({ ok: true, processos: [] });
  } catch (e) { res.json({ ok: true, processos: [] }); }
});

// ── HEALTH ────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true }));

// ── START ─────────────────────────────────────────────────────
initDrive();
app.listen(PORT, () => console.log(`IMPAK Portal rodando na porta ${PORT}`));
