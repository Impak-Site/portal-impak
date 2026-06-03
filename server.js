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
  { usuario: 'narcelio',  senha: 'Narcelio@2026',      modulos: ['tyredesk','processos'], nome: 'Narcelio' },
  { usuario: 'jean',      senha: 'Jeanimpak2026',      modulos: ['tyredesk','processos'], nome: 'Jean'     },
  { usuario: 'paula',     senha: 'Paula@2026',         modulos: ['processos'],            nome: 'Paula',     role: 'gerente',  displayName: 'Paula'     },
  { usuario: 'emanuelly', senha: 'EmanuellyImpak2026', modulos: ['processos'],            nome: 'Emanuelly', role: 'analista', displayName: 'Emanuelly' },
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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
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
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#e8f0f8;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:'Barlow',sans-serif;}
.box{background:#fff;border:1px solid #c8d8e8;border-top:3px solid #1a7fd4;border-radius:14px;padding:40px 36px;width:400px;max-width:94vw;box-shadow:0 8px 32px rgba(26,127,212,.12);}
.logo-row{display:flex;align-items:center;gap:10px;margin-bottom:28px;justify-content:center}
.logo{background:#1a7fd4;color:#fff;font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:800;padding:6px 14px;border-radius:6px;letter-spacing:1px}
.sub{font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;color:#4a6480;letter-spacing:2px;text-transform:uppercase}
h1{font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;text-align:center;color:#0d1e2e;margin-bottom:4px;text-transform:uppercase}
.versao{font-size:10px;color:#1a7fd4;font-weight:700;letter-spacing:1px;text-align:center;margin-bottom:24px;text-transform:uppercase}
label{font-size:10px;font-weight:700;color:#4a6480;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;display:block}
input{width:100%;background:#dce8f5;border:1px solid #c8d8e8;border-radius:7px;color:#0d1e2e;font-family:'Barlow',sans-serif;font-size:14px;padding:11px 14px;outline:none;margin-bottom:16px;}
input:focus{border-color:#1a7fd4;background:#c8ddf0}
button{width:100%;background:#1a7fd4;border:none;border-radius:7px;color:#fff;font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;padding:12px;cursor:pointer;letter-spacing:.5px;text-transform:uppercase;}
button:hover{background:#1567b8}
.err{background:rgba(192,57,43,.08);border:1px solid rgba(192,57,43,.25);border-radius:6px;padding:10px 14px;font-size:12px;color:#c0392b;font-weight:600;margin-bottom:14px;text-align:center;}
.footer{text-align:center;margin-top:20px;font-size:10px;color:#a8bfd4}
.modulos{display:flex;gap:8px;justify-content:center;margin-top:16px;}
.mod-btn{flex:1;background:#f0f6ff;border:1px solid #c8d8e8;border-radius:7px;color:#1a7fd4;font-family:'Barlow',sans-serif;font-size:13px;font-weight:600;padding:10px;cursor:pointer;text-align:center;text-decoration:none;display:block;}
.mod-btn:hover{background:#dce8f5}
</style>
</head>
<body>
<div class="box">
  <div class="logo-row"><div class="logo">IMPAK</div><div class="sub">Portal</div></div>
  <h1>Acesso ao Sistema</h1>
  <div class="versao">TyreDesk + Gestão de Processos</div>
  ERRO_PLACEHOLDER
  <form method="POST" action="/login">
    <label>Usuário</label>
    <input name="usuario" type="text" placeholder="seu usuário" autocomplete="username" required>
    <label>Senha</label>
    <input name="senha" type="password" placeholder="sua senha" autocomplete="current-password" required>
    <input type="hidden" name="destino" value="DESTINO_PLACEHOLDER">
    <button type="submit">Entrar</button>
  </form>
  <div class="footer">IMPAK Comercial Importadora · Portal v1.0 · Confidencial</div>
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
  const u = USUARIOS.find(x => x.usuario === (usuario||'').trim().toLowerCase() && x.senha === senha);
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

// ── HEALTH ────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true }));

// ── START ─────────────────────────────────────────────────────
initDrive();
app.listen(PORT, () => console.log(`IMPAK Portal rodando na porta ${PORT}`));
