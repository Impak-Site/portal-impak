/**
 * IMPAK TyreDesk v1.0 — Servidor com Google Drive
 * Variáveis no Railway:
 *   GOOGLE_CREDENTIALS  → conteúdo completo do JSON da conta de serviço
 *   DRIVE_FOLDER_ID     → ID da pasta TyreDesk no Drive
 *   SESSION_SECRET      → texto aleatório longo (opcional)
 *   NODE_ENV            → production
 */

const express    = require('express');
const session    = require('express-session');
const bcrypt     = require('bcryptjs');
const path       = require('path');
const fs         = require('fs');
const { google } = require('googleapis');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── USUÁRIOS ────────────────────────────────────────────────
const USUARIOS = [
  { nome: 'Narcelio',  usuario: 'narcelio',  email: 'narcelio@impak.com.br',    senha: 'Narcelio@2026',      modulos: ['tyredesk','processos'] },
  { nome: 'Emanuelly', usuario: 'emanuelly', email: 'importacao1@impak.com.br', senha: 'EmanuellyImpak2026', modulos: ['processos'], role: 'analista', displayName: 'Emanuelly' },
  { nome: 'Paula',     usuario: 'paula',     email: 'paula@impak.com.br',       senha: 'Paula@2026',         modulos: ['processos'], role: 'gerente',  displayName: 'Paula'     },
  { nome: 'Jean',      usuario: 'jean',      email: 'jean@impak.com.br',        senha: 'Jeanimpak2026',      modulos: ['tyredesk','processos'] },
];
const usuarios = USUARIOS.map(u => ({
  nome: u.nome, usuario: u.usuario, hash: bcrypt.hashSync(u.senha, 10),
}));

// ── GOOGLE DRIVE ─────────────────────────────────────────────
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
      fields: 'files(id,modifiedTime)',
    });
    if (!lista.files.length) return null;
    const { data } = await driveClient.files.get(
      { fileId: lista.files[0].id, alt: 'media' }, { responseType: 'text' }
    );
    return { conteudo: data, modificado: lista.files[0].modifiedTime };
  } catch (e) { return null; }
}

async function driveList() {
  if (!driveClient || !FOLDER_ID) return [];
  try {
    const { data } = await driveClient.files.list({
      q: `'${FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id,name,modifiedTime)',
      orderBy: 'modifiedTime desc',
    });
    return data.files || [];
  } catch (e) { return []; }
}

// ── MIDDLEWARES ──────────────────────────────────────────────
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'impak-tyredesk-2026',
  resave: false, saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, maxAge: 8 * 60 * 60 * 1000 },
}));

function auth(req, res, next) {
  if (req.session?.usuario) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ erro: 'Não autenticado' });
  res.redirect('/login');
}

// ── LOGIN ────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session?.usuario) return res.redirect('/');
  res.send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>IMPAK TyreDesk</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&family=Barlow+Condensed:wght@700;800&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#e8f0f8;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:'Barlow',sans-serif}.box{background:#fff;border:1px solid #c8d8e8;border-top:3px solid #1a7fd4;border-radius:14px;padding:40px 36px;width:380px;max-width:92vw;box-shadow:0 8px 32px rgba(26,127,212,.1)}.logo-row{display:flex;align-items:center;gap:10px;margin-bottom:28px;justify-content:center}.lb{background:#1a7fd4;color:#fff;font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:800;padding:6px 14px;border-radius:6px;letter-spacing:1px}.ls{font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;color:#4a6480;letter-spacing:2px;text-transform:uppercase}h1{font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;text-align:center;color:#0d1e2e;margin-bottom:4px;text-transform:uppercase}.v{font-size:10px;color:#1a7fd4;font-weight:700;letter-spacing:1px;text-align:center;margin-bottom:8px}.sub{font-size:12px;color:#4a6480;text-align:center;margin-bottom:24px}label{font-size:10px;font-weight:700;color:#4a6480;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;display:block}input{width:100%;background:#f0f4f8;border:1px solid #c8d8e8;border-radius:7px;color:#0d1e2e;font-size:14px;padding:11px 14px;outline:none;transition:border-color .15s;margin-bottom:16px}input:focus{border-color:#1a7fd4;background:#fff}button{width:100%;background:#1a7fd4;border:none;border-radius:7px;color:#fff;font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;padding:12px;cursor:pointer;letter-spacing:.5px;text-transform:uppercase}button:hover{background:#1567b8}.erro{background:rgba(192,57,43,.08);border:1px solid rgba(192,57,43,.25);border-radius:6px;padding:10px 14px;font-size:12px;color:#c0392b;font-weight:600;margin-bottom:14px;text-align:center}.ft{text-align:center;margin-top:20px;font-size:10px;color:#a8bfd4}</style>
</head><body><div class="box">
<div class="logo-row"><div class="lb">IMPAK</div><div class="ls">TyreDesk</div></div>
<h1>Acesso Restrito</h1><div class="v">Versão 1.0</div>
<div class="sub">Sistema interno — IMPAK Comercial Importadora</div>
${req.query.erro ? '<div class="erro">Usuário ou senha incorretos.</div>' : ''}
<form method="POST" action="/login">
  <label>Usuário</label><input type="text" name="usuario" placeholder="seu usuário" autocomplete="username" required autofocus>
  <label>Senha</label><input type="password" name="senha" placeholder="sua senha" autocomplete="current-password" required>
  <button type="submit">Entrar</button>
</form>
<div class="ft">IMPAK Comercial Importadora · TyreDesk v1.0</div>
</div></body></html>`);
});

app.post('/login', (req, res) => {
  const { usuario, senha } = req.body;
  const user = usuarios.find(u => u.usuario === (usuario||'').trim().toLowerCase());
  if (!user || !bcrypt.compareSync(senha||'', user.hash)) return res.redirect('/login?erro=1');
  req.session.usuario = { nome: user.nome, usuario: user.usuario };
  res.redirect('/');
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

// ── APP PRINCIPAL ────────────────────────────────────────────
app.get('/', auth, (req, res) => {
  const f = path.join(__dirname, 'IMPAK_Portal_v1.0.html');
  if (!fs.existsSync(f)) return res.status(404).send('<h2>IMPAK_Portal_v1.0.html não encontrado.</h2>');
  res.sendFile(f);
});

// ── API ME ───────────────────────────────────────────────────
app.get('/api/me', auth, (req, res) => res.json(req.session.usuario));

// ── API DRIVE: SALVAR COTAÇÕES ───────────────────────────────
app.post('/api/drive/salvar', auth, async (req, res) => {
  const { fornecedor, itens } = req.body;
  if (!fornecedor || !itens) return res.status(400).json({ erro: 'Dados inválidos' });
  const nome = `cotacoes_${fornecedor.replace(/[^a-zA-Z0-9]/g,'_')}.json`;
  const id = await driveUpsert(nome, { fornecedor, itens, atualizado: new Date().toISOString() });
  res.json({ ok: true, arquivo: nome, id });
});

// ── API DRIVE: CARREGAR TODAS AS COTAÇÕES ────────────────────
app.get('/api/drive/tudo', auth, async (req, res) => {
  const arquivos = await driveList();
  const cotFiles = arquivos.filter(f => f.name.startsWith('cotacoes_'));
  const resultado = [];
  for (const arq of cotFiles) {
    try {
      const { data } = await driveClient.files.get(
        { fileId: arq.id, alt: 'media' }, { responseType: 'text' }
      );
      const p = JSON.parse(data);
      resultado.push({ fornecedor: p.fornecedor, itens: p.itens, atualizado: p.atualizado });
    } catch (e) { /* pular */ }
  }
  res.json({ cotacoes: resultado });
});

// ── API DRIVE: HISTÓRICO ─────────────────────────────────────
app.post('/api/drive/historico', auth, async (req, res) => {
  const { fornecedor, email, tipo, lang } = req.body;
  const existente = await driveRead('historico_emails.json');
  const historico = existente ? JSON.parse(existente.conteudo) : [];
  historico.push({ fornecedor, email, tipo, lang, usuario: req.session.usuario.nome, data: new Date().toISOString() });
  await driveUpsert('historico_emails.json', historico);
  res.json({ ok: true, total: historico.length });
});

app.get('/api/drive/historico', auth, async (req, res) => {
  const r = await driveRead('historico_emails.json');
  res.json({ historico: r ? JSON.parse(r.conteudo) : [] });
});

// ── API DRIVE: STATUS ────────────────────────────────────────
app.get('/api/drive/status', auth, async (req, res) => {
  if (!driveClient) return res.json({ conectado: false });
  try {
    const arqs = await driveList();
    res.json({ conectado: true, arquivos: arqs.length });
  } catch (e) { res.json({ conectado: false, erro: e.message }); }
});

// ── HEALTH ───────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', versao: '1.0', drive: !!driveClient }));

// ── INICIAR ──────────────────────────────────────────────────
initDrive();
app.listen(PORT, () => console.log(`IMPAK TyreDesk v1.0 | Porta ${PORT} | Drive: ${driveClient?'✓':'✗'}`));

// ── API: PROCESSOS ────────────────────────────────────────────
// Salvar processo
app.post('/api/processos/salvar', auth, async (req, res) => {
  const { username, processo } = req.body;
  if (!username || !processo) return res.status(400).json({ erro: 'Dados inválidos' });

  // Carregar lista atual do usuário
  const nome = `processos_${username.replace(/[^a-zA-Z0-9]/g,'_')}.json`;
  const existente = await driveRead(nome);
  let lista = existente ? JSON.parse(existente.conteudo) : [];

  const idx = lista.findIndex(p => p.id === processo.id);
  if (idx >= 0) lista[idx] = processo;
  else lista.unshift(processo);

  await driveUpsert(nome, lista);
  res.json({ ok: true });
});

// Buscar processos de um usuário
app.get('/api/processos', auth, async (req, res) => {
  const { usuario } = req.query;
  if (!usuario) return res.status(400).json({ erro: 'Usuário não informado' });

  const nome = `processos_${usuario.replace(/[^a-zA-Z0-9]/g,'_')}.json`;
  const resultado = await driveRead(nome);
  res.json({ processos: resultado ? JSON.parse(resultado.conteudo) : [] });
});

// Buscar TODOS os processos (gerente)
app.get('/api/processos/todos', auth, async (req, res) => {
  const arquivos = await driveList();
  const procFiles = arquivos.filter(f => f.name.startsWith('processos_'));
  const todos = [];
  for (const arq of procFiles) {
    try {
      const { data } = await driveClient.files.get(
        { fileId: arq.id, alt: 'media' }, { responseType: 'text' }
      );
      const lista = JSON.parse(data);
      todos.push(...(Array.isArray(lista) ? lista : []));
    } catch(e) { /* pular */ }
  }
  res.json({ processos: todos });
});

// Buscar processo por id
app.get('/api/processos/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { usuario } = req.query;
  if (!usuario) return res.status(400).json({ erro: 'Usuário não informado' });

  const nome = `processos_${usuario.replace(/[^a-zA-Z0-9]/g,'_')}.json`;
  const resultado = await driveRead(nome);
  if (!resultado) return res.json({ processo: null });

  const lista = JSON.parse(resultado.conteudo);
  const proc = lista.find(p => p.id === id) || null;
  res.json({ processo: proc });
});

// Deletar processo
app.delete('/api/processos/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { username } = req.body;
  if (!username) return res.status(400).json({ erro: 'Username não informado' });

  const nome = `processos_${username.replace(/[^a-zA-Z0-9]/g,'_')}.json`;
  const resultado = await driveRead(nome);
  if (!resultado) return res.json({ ok: true });

  const lista = JSON.parse(resultado.conteudo).filter(p => p.id !== id);
  await driveUpsert(nome, lista);
  res.json({ ok: true });
});
