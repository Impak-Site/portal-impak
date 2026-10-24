// Backups automáticos: semanal no Supabase Storage e no Dropbox (fora do
// Supabase), com as rotas de admin e a tela /backup. Saiu de server.js em
// 24/10/2026 sem mudar a lógica: o código é o mesmo, só recebe por parâmetro
// (deps) o que vinha do escopo do server.js, e é registrado na mesma posição.
'use strict';
const path = require('path');

function registrar(app, deps) {
  const {
    ADMINS_PERMISSOES, auth, jaEnviouJobHoje, marcarJobEnviadoHoje,
    requireAdminPermissoes, requireGerente, sb,
  } = deps;

// ── BACKUP SEMANAL (pedido Ayslan, 19/09/2026) ──────────────────────
// Exporta todas as tabelas em JSON pro bucket privado BACKUP_BUCKET, um
// arquivo por tabela, numa pasta por data (backups/2026-09-21/...). Mantém
// as últimas BACKUP_MANTER_SEMANAS pastas. Roda toda segunda ~03h BRT via
// agendarBackupSemanal() (controlado por app_job_runs, job 'backup_semanal',
// então não repete se o servidor reiniciar no mesmo dia) ou na mão por
// POST /api/admin/backup. Complementa (não substitui) o backup nativo do
// Supabase: este aqui fica num lugar que a gente controla, em formato
// legível, e cobre o caso de "apaguei/alterei errado e só percebi depois".
const BACKUP_BUCKET = process.env.BACKUP_BUCKET || 'backups';
const BACKUP_MANTER_SEMANAS = parseInt(process.env.BACKUP_MANTER_SEMANAS || '8', 10);
const BACKUP_TABELAS = [
  'controle_processos','controle_arquivos','controle_log','controle_notificacoes',
  'calculador_cotacoes','contatos_clientes','cadastros_pessoas','catalogo_produtos',
  'tyredesk_fornecedores','tyredesk_base','tyredesk_historico',
  'usuarios','app_job_runs',
];

async function _garantirBucketBackup(){
  const { data: buckets } = await sb().storage.listBuckets();
  if ((buckets || []).some(b => b.name === BACKUP_BUCKET)) return;
  const { error } = await sb().storage.createBucket(BACKUP_BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) throw new Error('criar bucket de backup: ' + error.message);
}

async function _lerTabelaInteira(tabela){
  const PAGINA = 1000;
  const linhas = [];
  for (let offset = 0; ; offset += PAGINA) {
    const { data, error } = await sb().from(tabela).select('*').range(offset, offset + PAGINA - 1);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    if (!data || !data.length) break;
    linhas.push(...data);
    if (data.length < PAGINA) break;
  }
  return linhas;
}

async function executarBackup(){
  await _garantirBucketBackup();
  const dia = new Date().toISOString().slice(0,10);
  const resumo = { dia, tabelas: {}, erros: [] };
  for (const tabela of BACKUP_TABELAS) {
    try {
      const linhas = await _lerTabelaInteira(tabela);
      // usuarios: nunca gravar hash de senha/segredo TOTP no backup
      const seguras = tabela === 'usuarios'
        ? linhas.map(u => { const c = { ...u }; delete c.senha_hash; delete c.senha; delete c.totp_secret; return c; })
        : linhas;
      const conteudo = Buffer.from(JSON.stringify(seguras), 'utf8');
      const { error } = await sb().storage.from(BACKUP_BUCKET)
        .upload(`${dia}/${tabela}.json`, conteudo, { contentType: 'application/json', upsert: true });
      if (error) throw new Error(error.message);
      resumo.tabelas[tabela] = { linhas: linhas.length, bytes: conteudo.length };
    } catch (e) {
      resumo.erros.push(`${tabela}: ${e.message}`);
      console.error('Backup falhou em', tabela, e.message);
    }
  }
  // Limpeza: mantém só as N pastas (datas) mais recentes.
  try {
    const { data: pastas } = await sb().storage.from(BACKUP_BUCKET).list('', { limit: 500 });
    const datas = (pastas || []).map(x => x.name).filter(n => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort();
    const remover = datas.slice(0, Math.max(0, datas.length - BACKUP_MANTER_SEMANAS));
    for (const d of remover) {
      const { data: arquivos } = await sb().storage.from(BACKUP_BUCKET).list(d, { limit: 500 });
      const paths = (arquivos || []).map(a => `${d}/${a.name}`);
      if (paths.length) await sb().storage.from(BACKUP_BUCKET).remove(paths);
    }
    resumo.removidas = remover;
  } catch (e) { resumo.erros.push('limpeza: ' + e.message); }
  console.log('Backup semanal concluído:', JSON.stringify(resumo));
  return resumo;
}

function agendarBackupSemanal(){
  const checar = async () => {
    try {
      const agora = new Date();
      const hBrt = (agora.getUTCHours() - 3 + 24) % 24;
      const diaSemanaBrt = new Date(agora.getTime() - 3*3600*1000).getUTCDay(); // 1 = segunda
      if (diaSemanaBrt !== 1 || hBrt < 3) return;
      if (await jaEnviouJobHoje('backup_semanal', { diaBR: true })) return; // segunda de Brasília (não refaz às 21h)
      await executarBackup();
      await marcarJobEnviadoHoje('backup_semanal');
    } catch (e) { console.error('agendarBackupSemanal:', e.message); }
  };
  setTimeout(checar, 60 * 1000);
  setInterval(checar, 30 * 60 * 1000);
}

app.post('/api/admin/backup', auth(), requireGerente, (req, res) => {
  executarBackup()
    .then(resumo => res.json({ ok: true, resumo }))
    .catch(e => res.status(500).json({ ok: false, erro: e.message }));
});

// ── BACKUP NO DROPBOX (fora do Supabase, 30/09/2026) ────────────────
// Ver services/dropbox-backup.js. Precisa só de DROPBOX_APP_KEY no Railway
// (identificador público do app — não é senha). A conexão é feita por um
// admin em /backup → "Conectar Dropbox" (OAuth PKCE; o token volta direto
// pro servidor, ninguém copia/cola token). Roda todo dia ~04h BRT: GED
// incremental; tabelas 1x por semana.
const dropboxBackup = require('../services/dropbox-backup.js');
const DROPBOX_APP_KEY = () => (process.env.DROPBOX_APP_KEY || '').trim();
function _dropboxRedirectUri(req) {
  if (process.env.DROPBOX_REDIRECT_URI) return process.env.DROPBOX_REDIRECT_URI.trim();
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  return `${proto}://${req.get('x-forwarded-host') || req.get('host')}/api/admin/dropbox/callback`;
}
function _rodarDropbox(incluirTabelas) {
  return dropboxBackup.executar({
    sb: sb(), fetchFn: fetch, appKey: DROPBOX_APP_KEY(),
    tabelas: BACKUP_TABELAS, incluirTabelas,
  });
}

app.get('/backup', (req, res) => {
  if (!req.session.usuario) return res.redirect('/login?destino=/backup');
  if (!ADMINS_PERMISSOES.includes(req.session.usuario)) return res.status(403).send('<h2>Acesso restrito.</h2>');
  res.sendFile(path.join(__dirname, '..', 'backup.html'));
});

app.get('/api/admin/dropbox/status', auth(), requireAdminPermissoes, async (req, res) => {
  try {
    const st = await dropboxBackup.status(sb());
    res.json({ ok: true, configurado: !!DROPBOX_APP_KEY(), redirect_uri: _dropboxRedirectUri(req), ...st });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

app.get('/api/admin/dropbox/conectar', auth(), requireAdminPermissoes, (req, res) => {
  if (!DROPBOX_APP_KEY()) return res.status(400).send('DROPBOX_APP_KEY não configurada no Railway.');
  const { verifier, challenge } = dropboxBackup.gerarPkce();
  const state = require('crypto').randomBytes(16).toString('hex');
  req.session.dropboxOauth = { verifier, state, em: Date.now() };
  req.session.save(() => res.redirect(dropboxBackup.urlAutorizacao({
    appKey: DROPBOX_APP_KEY(), redirectUri: _dropboxRedirectUri(req), state, challenge,
  })));
});

app.get('/api/admin/dropbox/callback', auth(), requireAdminPermissoes, async (req, res) => {
  const pend = req.session.dropboxOauth;
  delete req.session.dropboxOauth;
  if (req.query.error) return res.redirect('/backup?erro=' + encodeURIComponent(String(req.query.error_description || req.query.error).slice(0, 200)));
  if (!pend || !req.query.code || req.query.state !== pend.state || Date.now() - pend.em > 15 * 60 * 1000) {
    return res.redirect('/backup?erro=' + encodeURIComponent('Autorização expirada ou inválida. Clique em Conectar de novo.'));
  }
  try {
    await dropboxBackup.trocarCodigo({
      sb: sb(), fetchFn: fetch, appKey: DROPBOX_APP_KEY(), code: String(req.query.code),
      verifier: pend.verifier, redirectUri: _dropboxRedirectUri(req), usuario: req.session.usuario,
    });
    res.redirect('/backup?ok=1');
  } catch (e) {
    console.error('dropbox callback:', e.message);
    res.redirect('/backup?erro=' + encodeURIComponent(e.message.slice(0, 200)));
  }
});

// Dispara em segundo plano (o 1º envio do GED pode levar bastante tempo).
app.post('/api/admin/dropbox/rodar', auth(), requireAdminPermissoes, (req, res) => {
  if (!DROPBOX_APP_KEY()) return res.status(400).json({ ok: false, erro: 'DROPBOX_APP_KEY não configurada.' });
  if (dropboxBackup.estaRodando()) return res.json({ ok: true, jaRodando: true });
  _rodarDropbox(true).catch(e => console.error('dropbox manual:', e.message));
  res.json({ ok: true, iniciado: true });
});

function agendarBackupDropbox(){
  const checar = async () => {
    try {
      if (!DROPBOX_APP_KEY()) return;
      const hBrt = (new Date().getUTCHours() - 3 + 24) % 24;
      if (hBrt < 4) return;
      const st = await dropboxBackup.status(sb());
      if (!st.conectado || st.rodando) return;
      if (await jaEnviouJobHoje('backup_dropbox')) return;
      const ultTab = st.ultimas_tabelas_em ? new Date(st.ultimas_tabelas_em).getTime() : 0;
      const incluirTabelas = Date.now() - ultTab > 6.5 * 24 * 3600 * 1000;
      await _rodarDropbox(incluirTabelas);
    } catch (e) { console.error('agendarBackupDropbox:', e.message); }
  };
  setTimeout(checar, 3 * 60 * 1000);
  setInterval(checar, 30 * 60 * 1000);
}

  return { agendarBackupSemanal, agendarBackupDropbox };
}

module.exports = { registrar };
