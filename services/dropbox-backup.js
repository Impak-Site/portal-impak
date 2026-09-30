// services/dropbox-backup.js — cópia de segurança FORA do Supabase (30/09/2026)
//
// Por quê: o backup diário do Supabase e o nosso backup semanal (bucket
// "backups") ficam os dois DENTRO do Supabase, e nenhum dos dois guarda os
// arquivos do GED (PDFs de CI/PL/BL/NF...). Este módulo copia pro Dropbox da
// empresa:
//   - /GED/<referência do processo>/<data>_<id>_<nome original>  (incremental:
//     só o que ainda não foi enviado; arquivo excluído do sistema CONTINUA no
//     Dropbox — é justamente pra isso que serve);
//   - /Tabelas/<AAAA-MM-DD>/<tabela>.json  (1x por semana, sem hash de senha).
//
// Autenticação: OAuth do Dropbox com PKCE (sem "app secret"). O Railway só
// precisa de DROPBOX_APP_KEY (identificador público do app). Um admin clica em
// "Conectar Dropbox" na tela /backup, autoriza no site do Dropbox, e o
// refresh token volta direto pro servidor, que guarda num arquivo privado
// (_config/dropbox.json no bucket privado de backups — só a service_role lê).
// Ninguém precisa copiar/colar token em lugar nenhum.
//
// Nada aqui APAGA dado: nem no Supabase, nem no Dropbox (upload em modo
// "add" — se o arquivo já existe lá, é considerado enviado e segue).
//
// Tudo recebe `sb` (client Supabase) e `fetchFn` por parâmetro → testável sem
// rede (ver testes_dropbox.js).

'use strict';

const crypto = require('crypto');

const CONFIG_BUCKET = process.env.BACKUP_BUCKET || 'backups';
const CONFIG_PATH = '_config/dropbox.json';
const MANIFESTO_PATH = '_config/dropbox_ged_enviados.json';
const STATUS_PATH = '_config/dropbox_status.json';
const GED_BUCKET = 'controle-arquivos';
const OAUTH_AUTHORIZE = 'https://www.dropbox.com/oauth2/authorize';
const OAUTH_TOKEN = 'https://api.dropboxapi.com/oauth2/token';
const UPLOAD_URL = 'https://content.dropboxapi.com/2/files/upload';

// ── utilitários ───────────────────────────────────────────────────────
function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function gerarPkce() {
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}
// Dropbox-API-Arg é cabeçalho HTTP: caracteres fora do ASCII precisam ir
// escapados como \uXXXX, senão o upload de "Fatura Comercial - São Paulo.pdf"
// quebra.
function argHeader(obj) {
  return JSON.stringify(obj).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}
// Nome seguro pra pasta/arquivo no Dropbox (e no Windows de quem sincroniza).
function nomeSeguro(s, max = 120) {
  let n = String(s == null ? '' : s).normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ').trim()
    .replace(/[. ]+$/, '');
  if (!n) n = 'sem_nome';
  if (n.length > max) {
    const ext = (n.match(/\.[a-z0-9]{1,5}$/i) || [''])[0];
    n = n.slice(0, max - ext.length) + ext;
  }
  return n;
}
function caminhoGed(arquivo, referencia) {
  const pasta = nomeSeguro(referencia || arquivo.processo_id || 'sem_processo', 80);
  const dia = String(arquivo.created_at || '').slice(0, 10) || 'sem_data';
  const id8 = String(arquivo.id || '').slice(0, 8);
  let nome = nomeSeguro(arquivo.nome || 'arquivo', 100);
  const extStorage = (String(arquivo.storage_path || '').match(/\.([a-z0-9]{1,5})$/i) || [])[1];
  if (extStorage && !new RegExp('\\.' + extStorage + '$', 'i').test(nome)) nome += '.' + extStorage;
  return `/GED/${pasta}/${dia}_${id8}_${nome}`;
}
const esperar = ms => new Promise(r => setTimeout(r, ms));

// ── config/status guardados no bucket privado ─────────────────────────
async function lerJson(sb, path) {
  const { data, error } = await sb.storage.from(CONFIG_BUCKET).download(path);
  if (error || !data) return null;
  try {
    const txt = typeof data.text === 'function' ? await data.text() : Buffer.from(data).toString('utf8');
    return JSON.parse(txt);
  } catch (e) { return null; }
}
async function gravarJson(sb, path, obj) {
  const { error } = await sb.storage.from(CONFIG_BUCKET)
    .upload(path, Buffer.from(JSON.stringify(obj), 'utf8'), { contentType: 'application/json', upsert: true });
  if (error) throw new Error(`gravar ${path}: ${error.message}`);
}
async function garantirBucket(sb) {
  const { data: buckets } = await sb.storage.listBuckets();
  if ((buckets || []).some(b => b.name === CONFIG_BUCKET)) return;
  const { error } = await sb.storage.createBucket(CONFIG_BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) throw new Error('criar bucket: ' + error.message);
}

// ── OAuth ─────────────────────────────────────────────────────────────
function urlAutorizacao({ appKey, redirectUri, state, challenge }) {
  const q = new URLSearchParams({
    client_id: appKey, response_type: 'code', token_access_type: 'offline',
    code_challenge: challenge, code_challenge_method: 'S256',
    redirect_uri: redirectUri, state,
  });
  return `${OAUTH_AUTHORIZE}?${q.toString()}`;
}

async function trocarCodigo({ sb, fetchFn, appKey, code, verifier, redirectUri, usuario }) {
  const r = await fetchFn(OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: appKey, code_verifier: verifier, redirect_uri: redirectUri }).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.refresh_token) throw new Error('Dropbox recusou a autorização: ' + (j.error_description || j.error || r.status));
  await garantirBucket(sb);
  await gravarJson(sb, CONFIG_PATH, {
    refresh_token: j.refresh_token, account_id: j.account_id || null,
    conectado_em: new Date().toISOString(), conectado_por: usuario || null,
  });
  _tokenCache = { token: j.access_token, expira: Date.now() + ((j.expires_in || 14400) - 300) * 1000 };
  return { ok: true };
}

let _tokenCache = null;
async function accessToken({ sb, fetchFn, appKey }) {
  if (_tokenCache && _tokenCache.expira > Date.now()) return _tokenCache.token;
  const cfg = await lerJson(sb, CONFIG_PATH);
  if (!cfg || !cfg.refresh_token) throw new Error('Dropbox não conectado.');
  const r = await fetchFn(OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cfg.refresh_token, client_id: appKey }).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('Falha ao renovar acesso ao Dropbox (reconecte em /backup): ' + (j.error_description || j.error || r.status));
  _tokenCache = { token: j.access_token, expira: Date.now() + ((j.expires_in || 14400) - 300) * 1000 };
  return _tokenCache.token;
}

// Upload com retry em limite de taxa / erro transitório.
// Retorna 'enviado' | 'ja_existia'.
async function enviar({ fetchFn, token, path, conteudo, sobrescrever = false }) {
  for (let tentativa = 1; tentativa <= 4; tentativa++) {
    const r = await fetchFn(UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': argHeader({ path, mode: sobrescrever ? 'overwrite' : 'add', autorename: false, mute: true }),
      },
      body: conteudo,
    });
    if (r.ok) return 'enviado';
    const txt = await r.text().catch(() => '');
    if (r.status === 409 && /path\/conflict/.test(txt)) return 'ja_existia';
    if (r.status === 429 || r.status >= 500) {
      const ra = parseInt(r.headers && r.headers.get ? r.headers.get('retry-after') : '', 10);
      const espera = Math.min(60, Number.isNaN(ra) ? 5 * tentativa : ra);
      await esperar(espera * 1000);
      continue;
    }
    throw new Error(`upload ${path}: HTTP ${r.status} ${txt.slice(0, 200)}`);
  }
  throw new Error(`upload ${path}: Dropbox indisponível após 4 tentativas`);
}

// ── backup ────────────────────────────────────────────────────────────
async function lerTudo(sb, tabela, colunas) {
  const linhas = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb.from(tabela).select(colunas).range(off, off + 999);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    if (!data || !data.length) break;
    linhas.push(...data);
    if (data.length < 1000) break;
  }
  return linhas;
}

let _rodando = false;
function estaRodando() { return _rodando; }

/**
 * Roda um ciclo de backup no Dropbox.
 * @param {object} o { sb, fetchFn, appKey, tabelas:[...], incluirTabelas:bool, limiteArquivos? }
 */
async function executar(o) {
  if (_rodando) return { ok: false, erro: 'Já existe um backup em andamento.' };
  _rodando = true;
  const inicio = new Date();
  const resumo = { inicio: inicio.toISOString(), ged: { enviados: 0, ja_existiam: 0, pendentes: 0, erros: 0, bytes: 0 }, tabelas: {}, erros: [] };
  const { sb, fetchFn, appKey } = o;
  try {
    let token = await accessToken({ sb, fetchFn, appKey });

    // 1) GED incremental
    const manifesto = new Set(((await lerJson(sb, MANIFESTO_PATH)) || {}).ids || []);
    const arquivos = await lerTudo(sb, 'controle_arquivos', 'id, processo_id, nome, storage_path, created_at, tamanho');
    const processos = await lerTudo(sb, 'controle_processos', 'id, referencia');
    const refPorId = new Map(processos.map(p => [p.id, p.referencia]));
    const faltando = arquivos.filter(a => a.storage_path && !manifesto.has(a.id));
    const limite = o.limiteArquivos || Infinity;
    let desdeUltimoSalvar = 0;
    for (let i = 0; i < faltando.length; i++) {
      if (i >= limite) { resumo.ged.pendentes = faltando.length - i; break; }
      const a = faltando[i];
      try {
        const { data: blob, error } = await sb.storage.from(GED_BUCKET).download(a.storage_path);
        if (error || !blob) throw new Error('download: ' + (error ? error.message : 'vazio'));
        const buf = typeof blob.arrayBuffer === 'function' ? Buffer.from(await blob.arrayBuffer()) : Buffer.from(blob);
        token = await accessToken({ sb, fetchFn, appKey }); // renova se venceu no meio
        const st = await enviar({ fetchFn, token, path: caminhoGed(a, refPorId.get(a.processo_id)), conteudo: buf });
        if (st === 'enviado') { resumo.ged.enviados++; resumo.ged.bytes += buf.length; } else resumo.ged.ja_existiam++;
        manifesto.add(a.id);
        if (++desdeUltimoSalvar >= 25) { await gravarJson(sb, MANIFESTO_PATH, { ids: [...manifesto] }); desdeUltimoSalvar = 0; }
      } catch (e) {
        resumo.ged.erros++;
        if (resumo.erros.length < 20) resumo.erros.push(`GED ${a.nome || a.id}: ${e.message}`);
      }
    }
    if (desdeUltimoSalvar) await gravarJson(sb, MANIFESTO_PATH, { ids: [...manifesto] });

    // 2) Tabelas (semanal)
    if (o.incluirTabelas) {
      const dia = inicio.toISOString().slice(0, 10);
      for (const tabela of (o.tabelas || [])) {
        try {
          const linhas = await lerTudo(sb, tabela, '*');
          const seguras = tabela === 'usuarios'
            ? linhas.map(u => { const c = { ...u }; delete c.senha_hash; delete c.senha; delete c.totp_secret; delete c.reset_token; return c; })
            : linhas;
          const buf = Buffer.from(JSON.stringify(seguras), 'utf8');
          token = await accessToken({ sb, fetchFn, appKey });
          await enviar({ fetchFn, token, path: `/Tabelas/${dia}/${tabela}.json`, conteudo: buf, sobrescrever: true });
          resumo.tabelas[tabela] = linhas.length;
        } catch (e) { resumo.erros.push(`Tabela ${tabela}: ${e.message}`); }
      }
      resumo.tabelas_dia = dia;
    }
  } catch (e) {
    resumo.erros.push(e.message);
  } finally {
    _rodando = false;
    resumo.fim = new Date().toISOString();
    resumo.ok = resumo.erros.length === 0;
    try {
      const anterior = (await lerJson(sb, STATUS_PATH)) || {};
      await gravarJson(sb, STATUS_PATH, {
        ultimo: resumo,
        ultimo_ok_em: resumo.ok ? resumo.fim : (anterior.ultimo_ok_em || null),
        ultimas_tabelas_em: resumo.tabelas_dia ? resumo.fim : (anterior.ultimas_tabelas_em || null),
      });
    } catch (e) { console.error('dropbox status:', e.message); }
  }
  console.log('Backup Dropbox:', JSON.stringify({ ...resumo, erros: resumo.erros.slice(0, 5) }));
  return resumo;
}

async function status(sb) {
  const cfg = await lerJson(sb, CONFIG_PATH);
  const st = (await lerJson(sb, STATUS_PATH)) || {};
  return {
    conectado: !!(cfg && cfg.refresh_token),
    conectado_em: cfg ? cfg.conectado_em : null,
    conectado_por: cfg ? cfg.conectado_por : null,
    rodando: _rodando,
    ...st,
  };
}

module.exports = {
  gerarPkce, urlAutorizacao, trocarCodigo, accessToken, enviar, executar, status, estaRodando,
  // exportados pra teste
  _interno: { argHeader, nomeSeguro, caminhoGed, CONFIG_PATH, MANIFESTO_PATH, STATUS_PATH, resetCache: () => { _tokenCache = null; } },
};
