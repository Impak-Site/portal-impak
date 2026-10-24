// Faturas (contas a pagar / a receber), baixas e anexos, financeiro da
// empresa (plano de contas, centros, bancos, transferências, DRE), despesas
// recorrentes, DARF de retenções e numerário do despachante. Saiu de server.js
// em 24/10/2026 sem mudar a lógica: o código é o mesmo, só recebe por parâmetro
// (deps) o que vinha do escopo do server.js, e é registrado na mesma posição.
// Constantes que no server.js são declaradas DEPOIS deste ponto chegam como
// funções (gedBucket, midiasAnalise, reivindicarJobHoje) — só são lidas quando
// uma rota ou o job roda, nunca na hora de registrar.
'use strict';
const CadastrosNormalizar = require('./cadastros-normalizar.js');
const DocumentoBR = require('../documento-br.js');

function registrar(app, deps) {
  const {
    auth, sb, buscarTodosProcessos, enviarControleV2, obterIndiceCadastros, rateLimitAnalisar,
    reivindicarJobHoje, gedBucket, midiasAnalise,
  } = deps;

// ── FATURAS — contas a pagar / a receber (14/10/2026, faturas-core.js) ──
// Geradas da aba Custos Reais (linhas com "Pagamos para" / "Receber de")
// e acompanhadas na tela /faturas. Nunca apaga: cancelar = status.
// Ao criar/cancelar, grava em cada processo real_json._meta[taxa].fatura_id
// (ou remove) pra aba mostrar "fatura aberta/paga" na linha.
const FaturasCore = require('../faturas-core.js');
const FinCore = require('../fin-core.js');
// Referência com ou sem o prefixo "IMPAK-" (19/10/2026): faturas, planilhas
// do despachante/interna e criação em lote acham o processo do mesmo jeito.
const RefProcesso = require('../referencia-processo.js');
app.get('/faturas', auth('financeiro'), (req, res) => enviarControleV2(res));
// Resumo por processo (selo da lista) em cache curto — qualquer escrita em
// /api/faturas* invalida (baixa, estorno, edição, anexo, conferência...).
let _resumoFaturasCache = null, _resumoFaturasEm = 0;
app.use('/api/faturas', (req, res, next) => { if (req.method !== 'GET') _resumoFaturasCache = null; next(); });

async function vincularFaturaNosProcessos(fatura, remover) {
  const porProcesso = {};
  (fatura.itens || []).forEach(it => { if (it.processo_id && it.taxa) (porProcesso[it.processo_id] = porProcesso[it.processo_id] || []).push(it.taxa); });
  for (const pid of Object.keys(porProcesso)) {
    try {
      const { data: proc } = await sb().from('controle_processos').select('id, real_json').eq('id', pid).maybeSingle();
      if (!proc) continue;
      const rj = (proc.real_json && typeof proc.real_json === 'object') ? proc.real_json : {};
      rj._meta = (rj._meta && typeof rj._meta === 'object') ? rj._meta : {};
      let mexeu = false;
      porProcesso[pid].forEach(taxa => {
        rj._meta[taxa] = rj._meta[taxa] || {};
        if (remover) { if (rj._meta[taxa].fatura_id === fatura.id) { delete rj._meta[taxa].fatura_id; mexeu = true; } }
        else if (rj._meta[taxa].fatura_id !== fatura.id) { rj._meta[taxa].fatura_id = fatura.id; mexeu = true; }
        // fatura quitada → "Pago em" da taxa nos Custos Reais (só se estiver vazio)
        if (!remover && fatura.status === 'paga' && fatura.pago_em && !rj._meta[taxa].pago_em) { rj._meta[taxa].pago_em = fatura.pago_em; mexeu = true; }
        if (!Object.keys(rj._meta[taxa]).length) delete rj._meta[taxa];
      });
      if (!Object.keys(rj._meta).length) delete rj._meta;
      if (mexeu) await sb().from('controle_processos').update({ real_json: rj, updated_at: new Date().toISOString() }).eq('id', pid);
    } catch (e) { console.warn('vincularFaturaNosProcessos:', e.message); }
  }
}

// Mesmas taxas (processo, taxa e valor) — o jsonb não guarda a ordem das
// chaves, então comparar o JSON inteiro dava "mudou" sem ter mudado.
function mesmosItensFatura(a, b) {
  const norm = l => (Array.isArray(l) ? l : []).map(it => [String((it && it.processo_id) || ''), String((it && it.taxa) || ''), Math.round((parseFloat(it && it.valor) || 0) * 100)].join('|')).sort();
  const x = norm(a), y = norm(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}
function temFinanceiro(req) {
  const mods = Array.isArray(req.session.modulos) ? req.session.modulos : [];
  return req.session.role === 'gerente' || mods.includes('financeiro');
}
app.get('/api/faturas', auth('financeiro', 'controle'), async (req, res) => {
  try {
    const q = req.query || {};
    if (!temFinanceiro(req) && !q.processo_id) {
      return res.status(403).json({ ok: false, erro: 'A lista completa de faturas é do Financeiro. No Controle, abra o processo para ver as faturas dele.', faturas: [] });
    }
    const montar = () => {
      let query = sb().from('faturas').select('*').order('vencimento', { ascending: true, nullsFirst: false }).limit(2000);
      if (q.status && FaturasCore.STATUS.includes(q.status)) query = query.eq('status', q.status);
      if (q.tipo && FaturasCore.TIPOS.includes(q.tipo)) query = query.eq('tipo', q.tipo);
      if (q.empresa_id) query = query.eq('empresa_id', String(q.empresa_id).slice(0, 80));
      if (q.de && /^\d{4}-\d{2}-\d{2}$/.test(q.de)) query = query.gte('vencimento', q.de);
      if (q.ate && /^\d{4}-\d{2}-\d{2}$/.test(q.ate)) query = query.lte('vencimento', q.ate);
      return query;
    };
    let lista;
    if (q.processo_id) {
      // Faturas do processo: as que têm taxa dele (itens) + as a receber
      // geradas da parcela de câmbio / venda dele (origem, sem itens) —
      // antes só as primeiras apareciam (aba Faturas do processo, 21/10/2026).
      const pid = String(q.processo_id).slice(0, 80);
      const [porItens, porOrigem] = await Promise.all([
        montar().contains('itens', FaturasCore.filtroJsonbContem({ processo_id: pid })),
        montar().eq('origem->>processo_id', pid),
      ]);
      const error = porItens.error || porOrigem.error;
      if (error) return res.json({ ok: false, erro: error.message, semTabela: /faturas/.test(error.message), faturas: [] });
      const vistos = new Set();
      lista = [...(porItens.data || []), ...(porOrigem.data || [])].filter(f => !vistos.has(f.id) && vistos.add(f.id));
      lista.sort((a, b) => (a.vencimento || '9999') < (b.vencimento || '9999') ? -1 : (a.vencimento || '9999') > (b.vencimento || '9999') ? 1 : 0);
    } else {
      const { data, error } = await montar();
      if (error) return res.json({ ok: false, erro: error.message, semTabela: /faturas/.test(error.message), faturas: [] });
      lista = data || [];
    }
    if (q.empresa) { const k = String(q.empresa).toLowerCase(); lista = lista.filter(f => (f.empresa_nome || '').toLowerCase().includes(k) || (f.documento || '').toLowerCase().includes(k)); }
    res.json({ ok: true, faturas: lista });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

// Cria (sem id) ou edita (com id) — aceita uma fatura ou um array (gerar
// várias de uma vez a partir da aba Custos Reais).
app.post('/api/faturas', auth('financeiro', 'controle'), async (req, res) => {
  try {
    const lote = Array.isArray(req.body) ? req.body : (req.body && Array.isArray(req.body.faturas) ? req.body.faturas : [req.body]);
    if (!lote.length || lote.length > 50) return res.status(400).json({ ok: false, erro: 'Envie de 1 a 50 faturas.' });
    const agora = new Date().toISOString();
    const salvas = [];
    for (const b of lote) {
      const v = FaturasCore.validarFatura(b);
      if (!v.ok) return res.status(400).json({ ok: false, erro: v.erro });
      // despesa sem processo (aluguel, folha, imposto…) precisa de classificação
      if (!(b && b.id) && FinCore.precisaClassificar(v.fatura)) return res.status(400).json({ ok: false, erro: 'Classifique a despesa (aluguel, folha, imposto, sistemas…) no campo Classificação.' });
      const row = { ...v.fatura, alterado_por: req.session.usuario || null, updated_at: agora };
      // empresa sem id: tenta achar no cadastro (qualquer papel)
      if (!row.empresa_id) { try { const r = CadastrosNormalizar.resolverEmpresaQualquerPapel(row.empresa_nome, await obterIndiceCadastros()); if (r && r.id) row.empresa_id = r.id; } catch (e) { /* segue sem id */ } }
      let salva;
      if (b && b.id) {
        const { data: atual } = await sb().from('faturas').select('id,status,itens,valor,valor_pago,pago_em,pagamentos,documento,empresa_nome,moeda,cambio').eq('id', String(b.id)).maybeSingle();
        if (!atual) return res.status(404).json({ ok: false, erro: 'Fatura não encontrada.' });
        if (atual.status === 'cancelada') return res.status(400).json({ ok: false, erro: 'Fatura cancelada não pode ser editada.' });
        // edição não mexe nas baixas: status/valor pago saem da lista de pagamentos
        if (Array.isArray(atual.pagamentos) && atual.pagamentos.length) {
          const r = FaturasCore.aplicarPagamentos({ ...row, pagamentos: atual.pagamentos, status: atual.status });
          Object.assign(row, atual.status === 'paga' ? { status: 'paga', valor_pago: r.valor_pago, pago_em: atual.pago_em } : { status: r.status, valor_pago: r.valor_pago, pago_em: r.pago_em });
        } else { Object.assign(row, { status: atual.status, valor_pago: atual.valor_pago, pago_em: atual.pago_em }); }
        const { data, error } = await sb().from('faturas').update(row).eq('id', atual.id).select().single();
        if (error) return res.status(500).json({ ok: false, erro: error.message });
        salva = data;
        // conferência salva vale para o que foi conferido: mudou valor, taxas,
        // documento, empresa ou câmbio → volta a "precisa conferir"
        const mudouConferido = ['valor', 'documento', 'empresa_nome', 'moeda', 'cambio'].some(k => String(atual[k] == null ? '' : atual[k]) !== String(row[k] == null ? '' : row[k]))
          || !mesmosItensFatura(atual.itens, row.itens);
        if (mudouConferido) { try { const r = await sb().from('faturas').update({ conferencia: null }).eq('id', atual.id); if (!r.error) salva.conferencia = null; } catch (e) { /* banco sem a coluna (0058) */ } }
        await vincularFaturaNosProcessos({ id: atual.id, itens: atual.itens }, true);
      } else {
        row.criado_por = req.session.usuario || null; row.created_at = agora;
        // nº sequencial por ano (NNNNNN/AA) — pega o maior do ano e soma 1
        try {
          const ano = new Date().getFullYear();
          const { data: ult } = await sb().from('faturas').select('numero').like('numero', '%/' + String(ano).slice(-2)).order('numero', { ascending: false }).limit(1);
          row.numero = FaturasCore.proximoNumero(ult && ult[0] ? ult[0].numero : null, ano);
        } catch (e) { row.numero = null; }
        let data, error;
        for (let tentativa = 0; tentativa < 4; tentativa++) {
          ({ data, error } = await sb().from('faturas').insert(row).select().single());
          if (!(error && error.code === '23505' && /numero/.test(String(error.message || '') + String(error.details || '')))) break;
          try {
            const ano = new Date().getFullYear();
            const { data: ult } = await sb().from('faturas').select('numero').like('numero', '%/' + String(ano).slice(-2)).order('numero', { ascending: false }).limit(1);
            row.numero = FaturasCore.proximoNumero(ult && ult[0] ? ult[0].numero : null, ano);
          } catch (e) { break; }
        }
        if (error) return res.status(500).json({ ok: false, erro: error.message, semTabela: /faturas/.test(error.message) });
        salva = data;
      }
      await vincularFaturaNosProcessos(salva, false);
      salvas.push(salva);
    }
    res.json({ ok: true, faturas: salvas });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

// Ler fatura/boleto/DARF com IA (14/10/2026): devolve os campos pra tela
// pré-preencher uma fatura — nada é gravado aqui. O documento vai só pra
// API da Anthropic (mesma chave do resto do sistema, variável de ambiente).
// Conferência (cross-check) de uma fatura com o que já está no sistema:
// duplicidade de documento, taxa já faturada, valor x Custos Reais (ou x
// cotado), "pagar para" do processo, processo fechado/cancelado, soma x total.
// Regras em FaturasCore.conferirFatura (testadas). A rota /conferir só lê;
// a /:id/conferencia (aba Faturas do processo, 21/10/2026) grava o resultado
// na fatura, pra etapa "Conferida" / "com diferença" e o selo da lista.
async function conferirFaturaNoServidor(f, labelsBody, cambioBody) {
  const itens = Array.isArray(f.itens) ? f.itens.slice(0, 80).map(it => (it && typeof it === 'object') ? { ...it } : it) : [];
  // processos: por id, e os que vieram só com referência são resolvidos aqui
  const ids = [...new Set(itens.map(it => it && it.processo_id).filter(Boolean).map(String))];
  const refs = [...new Set(itens.filter(it => it && !it.processo_id && it.referencia).map(it => String(it.referencia).trim()).filter(Boolean))].slice(0, 30);
  const cols = 'id, referencia, real_json, estimativa_json, fechado, cancelado';
  const processos = {};
  if (ids.length) {
    const { data, error } = await sb().from('controle_processos').select(cols).in('id', ids);
    if (error) return { erro: error.message };
    (data || []).forEach(p => { processos[p.id] = p; });
  }
  // Referência resolvida com a mesma regra das importações (19/10/2026):
  // igual, ou com/sem o prefixo "IMPAK-" quando só um processo bate.
  if (refs.length) {
    const { data: todos, error: errTodos } = await buscarTodosProcessos('id, referencia');
    if (errTodos) return { erro: errTodos.message };
    const indiceRefs = RefProcesso.criarIndice(todos);
    const idPorRef = new Map();
    refs.forEach(ref => { const achado = RefProcesso.encontrar(indiceRefs, ref); if (achado.processo) idPorRef.set(ref, achado.processo.id); });
    const faltam = [...new Set(idPorRef.values())].filter(pid => !processos[pid]);
    if (faltam.length) {
      const { data, error } = await sb().from('controle_processos').select(cols).in('id', faltam);
      if (error) return { erro: error.message };
      (data || []).forEach(p => { processos[p.id] = p; });
    }
    itens.forEach(it => { if (it && !it.processo_id && it.referencia) { const pid = idPorRef.get(String(it.referencia).trim()); if (pid) it.processo_id = pid; } });
  }
  // faturas existentes: as que citam esses processos + as do mesmo nº de documento
  const existentes = new Map();
  for (const pid of Object.keys(processos)) {
    const { data } = await sb().from('faturas').select('id, numero, documento, empresa_id, empresa_nome, status, itens').contains('itens', FaturasCore.filtroJsonbContem({ processo_id: pid })).limit(200);
    (data || []).forEach(x => existentes.set(x.id, x));
  }
  const digitos = String(f.documento || '').replace(/\D/g, '').replace(/^0+/, '');
  if (digitos.length >= 3) {
    const { data } = await sb().from('faturas').select('id, numero, documento, empresa_id, empresa_nome, status, itens').ilike('documento', '%' + digitos.slice(-8) + '%').limit(50);
    (data || []).forEach(x => existentes.set(x.id, x));
  }
  // faturas citadas no _meta.fatura_id dos processos (pra mostrar o nº)
  const metaIds = new Set();
  Object.values(processos).forEach(p => { const m = (p.real_json && p.real_json._meta) || {}; Object.values(m).forEach(v => { if (v && v.fatura_id && !existentes.has(v.fatura_id)) metaIds.add(v.fatura_id); }); });
  if (metaIds.size) {
    const { data } = await sb().from('faturas').select('id, numero, documento, empresa_id, empresa_nome, status').in('id', [...metaIds].slice(0, 100));
    (data || []).forEach(x => existentes.set(x.id, x));
  }
  const labels = {};
  if (labelsBody && typeof labelsBody === 'object') Object.keys(labelsBody).slice(0, 200).forEach(k => { labels[String(k).slice(0, 60)] = String(labelsBody[k]).slice(0, 80); });
  const cambio = {};
  ['USD', 'EUR'].forEach(m => { const v = parseFloat(cambioBody && cambioBody[m]); if (v > 0 && v < 100) cambio[m] = v; });
  const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const r = FaturasCore.conferirFatura({ ...f, itens }, processos, [...existentes.values()], { hoje, cambio, labels });
  return { ...r, itens: itens.map(it => ({ processo_id: it && it.processo_id || null })) };
}
app.post('/api/faturas/conferir', auth('financeiro', 'controle'), async (req, res) => {
  try {
    const b = req.body || {};
    const r = await conferirFaturaNoServidor(b.fatura || {}, b.labels, b.cambio);
    if (r.erro) return res.json({ ok: false, erro: r.erro });
    res.json({ ok: true, ...r });
  } catch (e) {
    console.error('faturas/conferir:', e.message);
    res.status(500).json({ ok: false, erro: 'Erro ao conferir a fatura.' });
  }
});
// Confere uma fatura já gravada e guarda o resultado nela (faturas.conferencia,
// migration 0058): quem, quando, o resumo e as checagens. Não mexe em
// updated_at (é anotação, não muda a fatura) — assim não atrapalha uma baixa
// que alguém esteja dando ao mesmo tempo.
app.post('/api/faturas/:id/conferencia', auth('financeiro', 'controle'), async (req, res) => {
  try {
    const f = await _faturaPorId(req.params.id);
    if (!f) return res.status(404).json({ ok: false, erro: 'Fatura não encontrada.' });
    if (f.status === 'cancelada') return res.status(400).json({ ok: false, erro: 'Fatura cancelada.' });
    const b = req.body || {};
    const r = await conferirFaturaNoServidor(f, b.labels, b.cambio);
    if (r.erro) return res.json({ ok: false, erro: r.erro });
    const conferencia = {
      em: new Date().toISOString(), por: req.session.usuario || null, nome: req.session.displayName || req.session.nome || null,
      resumo: r.resumo, checks: (r.checks || []).slice(0, 40),
      valor: f.valor, moeda: f.moeda, documento: f.documento || null,
    };
    // aceites/contestações da conferência anterior que continuam valendo
    // (mesma diferença) passam pra nova (fase 2, 21/10/2026)
    conferencia.decisoes = FaturasCore.mesclarDecisoes(conferencia, f.conferencia);
    conferencia.divergencias = FaturasCore.divergenciasConferencia(conferencia);
    const { error } = await sb().from('faturas').update({ conferencia }).eq('id', f.id);
    if (error) return res.json({ ok: false, erro: /conferencia/.test(error.message) ? 'Falta a coluna "conferencia" no banco (migration 0058).' : error.message, semColuna: /conferencia/.test(error.message), ...r });
    _resumoFaturasCache = null;
    res.json({ ok: true, conferencia, ...r });
  } catch (e) {
    console.error('faturas/conferencia:', e.message);
    res.status(500).json({ ok: false, erro: 'Erro ao conferir a fatura.' });
  }
});
// Aceitar / contestar uma diferença da conferência guardada (fase 2,
// 21/10/2026). Body: { chave, acao: 'aceita' | 'contestada' | '' (desfaz),
// motivo }. Aceita exige motivo. Só mexe em conferencia.decisoes — as
// checagens ficam como foram. Lê a fatura de novo logo antes de gravar, pra
// não perder a decisão de outra pessoa na mesma fatura.
app.post('/api/faturas/:id/conferencia/decisao', auth('financeiro', 'controle'), async (req, res) => {
  try {
    const b = req.body || {};
    const chave = String(b.chave || '').slice(0, 120);
    const acao = b.acao ? String(b.acao) : '';
    if (!chave) return res.status(400).json({ ok: false, erro: 'Diferença não informada.' });
    const f = await _faturaPorId(req.params.id);
    if (!f) return res.status(404).json({ ok: false, erro: 'Fatura não encontrada.' });
    if (f.status === 'cancelada') return res.status(400).json({ ok: false, erro: 'Fatura cancelada.' });
    const r = FaturasCore.decidirDiferenca(f.conferencia, chave, acao, b.motivo, {
      por: req.session.usuario || null, nome: req.session.displayName || req.session.nome || null, em: new Date().toISOString(),
    });
    if (r.erro) return res.status(400).json({ ok: false, erro: r.erro });
    const { error } = await sb().from('faturas').update({ conferencia: r.conferencia }).eq('id', f.id);
    if (error) return res.status(500).json({ ok: false, erro: error.message });
    _resumoFaturasCache = null;
    res.json({ ok: true, conferencia: r.conferencia });
  } catch (e) {
    console.error('faturas/conferencia/decisao:', e.message);
    res.status(500).json({ ok: false, erro: 'Erro ao gravar a decisão.' });
  }
});
// Selo da lista de processos (aba Faturas, 21/10/2026): por processo, quantas
// faturas abertas, vencidas, com diferença na conferência e pagas. Cache de
// 20 s (a lista de processos chama a cada carga); ?fresh=1 ignora o cache.
app.get('/api/faturas/resumo-processos', auth('controle', 'financeiro'), async (req, res) => {
  try {
    if (!(req.query && req.query.fresh) && _resumoFaturasCache && Date.now() - _resumoFaturasEm < 20000) return res.json({ ok: true, resumo: _resumoFaturasCache, cache: true });
    const lista = [];
    let cols = 'id, tipo, status, vencimento, valor, valor_pago, itens, origem, aprovacao, conferencia';
    for (let de = 0; de < 20000; de += 1000) {
      let { data, error } = await sb().from('faturas').select(cols).neq('status', 'cancelada').order('id').range(de, de + 999);
      // banco ainda sem a coluna da conferência (migration 0058): segue sem ela
      if (error && /conferencia/.test(error.message) && cols.includes('conferencia')) {
        cols = 'id, tipo, status, vencimento, valor, valor_pago, itens, origem, aprovacao';
        ({ data, error } = await sb().from('faturas').select(cols).neq('status', 'cancelada').order('id').range(de, de + 999));
      }
      if (error) return res.json({ ok: false, erro: error.message, semTabela: /faturas/.test(error.message), resumo: {} });
      lista.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
    _resumoFaturasCache = FaturasCore.resumoPorProcesso(lista, hoje);
    _resumoFaturasEm = Date.now();
    res.json({ ok: true, resumo: _resumoFaturasCache });
  } catch (e) { res.status(500).json({ ok: false, erro: 'Erro ao resumir as faturas.' }); }
});

const PROMPT_LER_FATURA = `Você lê documentos de cobrança de uma IMPORTADORA brasileira de pneus: fatura/invoice de armador ou agente de carga, nota de débito, nota fiscal de serviço do despachante, boleto, DARF/guia de imposto, fatura de armazém/terminal. Responda SOMENTE com um JSON válido, sem texto antes ou depois, neste formato:
{"tipo_documento":"fatura|nota_debito|nfse|boleto|darf|acerto_despachante|numerario|outro","emitente":"razão social de quem COBRA","cnpj_emitente":"só dígitos ou vazio","destinatario":"quem PAGA","documento":"número da fatura/nota/boleto","emissao":"AAAA-MM-DD ou vazio","vencimento":"AAAA-MM-DD ou vazio","moeda":"BRL|USD|EUR","valor_total":0,"adiantamento_brl":0,"itens":[{"descricao":"texto da linha","moeda":"BRL|USD|EUR","valor":0,"valor_brl":0}],"pistas_processo":["só os códigos, sem o rótulo: referência do cliente/processo, HBL, MBL, booking, número de container — tudo que identifique o embarque"],"linha_digitavel":"se houver","observacao":"algo importante em 1 frase ou vazio"}
Regras: valores como número com ponto decimal (1234.56), nunca texto. Em cada item, valor_brl = o valor em reais impresso para aquela linha (coluna "Valor em R$"), ou 0 se o documento não mostrar. Se o documento estiver em dólar mas tiver total em reais, use a moeda das linhas e coloque o total em reais na observacao. "itens" = só as cobranças (uma por taxa/imposto); não inclua totais, subtotais, adiantamento/numerário já pago nem o saldo ("total a favor de..."). Acerto / prestação de contas / faturamento do despachante: tipo_documento "acerto_despachante", valor_total = total das despesas ANTES de descontar o adiantamento, adiantamento_brl = numerário/adiantamento que o documento desconta (ou 0). Pedido de numerário (adiantamento com valores estimados): tipo_documento "numerario". Não invente: campo que não existe fica vazio ou lista vazia.`;
// Leitura para a aba Custos Reais (19/10/2026): o mesmo documento, mas
// linha a linha com o valor em R$ que foi pago (nota de débito do agente
// de carga, faturamento/acerto do despachante, fatura do terminal). As
// regras de negócio (taxa de cada linha, o que fica de fora, conferência
// do total) ficam em FaturasCore.linhasCustoDocumento — aqui só a leitura.
const PROMPT_LER_CUSTOS = `Você lê documentos de CUSTO de um processo de importação da IMPAK COMERCIAL E IMPORTADORA LTDA (importadora brasileira de pneus), para lançar o que ela pagou, taxa por taxa. Tipos comuns: nota de débito / demonstrativo de débito / fatura do agente de carga ou armador (frete, THC, BL fee, ISPS, drop off, desconsolidação, logistic fee, IOF, impostos do agente...); faturamento / acerto / prestação de contas do despachante (II, IPI, PIS, COFINS, ICMS, Siscomex, AFRMM, armazenagem, licenças/LPCO, lavação, honorários...); numerário (pedido de adiantamento do despachante, com valores estimados); fatura ou demonstrativo de armazenagem do terminal/porto; nota fiscal de serviço (NFS-e); DARF/guia; boleto. Responda SOMENTE com um JSON válido, sem texto antes ou depois:
{"tipo_documento":"nota_debito_agente|acerto_despachante|numerario|fatura_terminal|nfse|darf|boleto|outro","emitente":"razão social de quem emitiu/cobra","cnpj_emitente":"só dígitos ou vazio","documento":"número do documento (ex.: IM 12345) ou vazio","emissao":"AAAA-MM-DD ou vazio","vencimento":"AAAA-MM-DD ou vazio","taxa_cambio_usd":0,"linhas":[{"descricao":"texto da linha como está no documento","moeda":"BRL|USD|EUR","valor":0,"valor_brl":0}],"ir_retido_brl":0,"total_brl":0,"adiantamento_brl":0,"saldo_brl":0,"saldo_a_favor":"importadora|emitente|","pistas_processo":["só os códigos, sem o rótulo: referência do importador/cliente, HBL, MBL, container, nº da DI/DUIMP — tudo que identifique o embarque"],"observacao":"algo importante em 1 frase ou vazio"}
Regras:
- "linhas" = SOMENTE as cobranças, uma por taxa/imposto cobrado, na ordem do documento. NÃO inclua: subtotais e totais ("Total por moeda", "Subtotal da fatura", "Subtotal Nota Fiscal", "Total da Fatura", "TOTAL DESPESAS ADUANEIRAS", "Total Geral", "Valor do Serviço" repetido), adiantamento/numerário já pago, saldo ("TOTAL A FAVOR DE..."), nem as linhas do topo do faturamento do despachante que só mostram a base do CIF (VALOR MLE/FOB, VALOR FRETE, TAXA CE / CE PREPAID, SEGURO, Total CIF).
- "IR Retido" (retenção na fonte, aparece negativo) NÃO é linha: vai em ir_retido_brl, como número positivo. "Impostos (IR/PCC/ISS)" e outros impostos COBRADOS pelo emitente SÃO linhas.
- valor = valor na moeda da linha. valor_brl = o valor em reais impresso para aquela linha (coluna "Valor em R$", "REAL", "Valor R$"); linha em reais: valor_brl = valor. Se o documento não mostrar o valor em reais de uma linha em moeda estrangeira, use valor_brl 0.
- taxa_cambio_usd = taxa do dólar usada no documento ("Taxa USD 5,123456", "TAXA MOEDA", "TAXA DO DIA USD"), ou 0.
- total_brl = total cobrado em reais antes de descontar adiantamento ("Total da Fatura", "TOTAL DESPESAS ADUANEIRAS", "Total Geral", "TOTAL A PAGAR"). adiantamento_brl = adiantamento/numerário descontado, ou 0. saldo_brl = a diferença final, sempre positiva; saldo_a_favor = "importadora" quando o saldo é a favor da IMPAK (ex.: "TOTAL A FAVOR DA IMPAK"), "emitente" quando a IMPAK ainda deve.
- Valores como número com ponto decimal (1234.56), nunca texto. Não invente: o que não existe fica vazio, 0 ou lista vazia.`;
app.post('/api/faturas/ler-documento', auth('financeiro', 'controle'), rateLimitAnalisar, async (req, res) => {
  try {
    const { arquivo_base64, media_type, modo } = req.body || {};
    const lerCustos = modo === 'custos';
    const mt = String(media_type || '').toLowerCase();
    if (!arquivo_base64 || typeof arquivo_base64 !== 'string') return res.status(400).json({ ok: false, erro: 'Envie o arquivo (PDF ou imagem).' });
    if (!midiasAnalise().has(mt)) return res.status(400).json({ ok: false, erro: 'Tipo de arquivo não suportado — envie PDF ou imagem.' });
    if (arquivo_base64.length > 20 * 1024 * 1024) return res.status(400).json({ ok: false, erro: 'Arquivo grande demais (máx. ~15 MB).' });
    const key = (process.env.ANTHROPIC_API_KEY || '').trim();
    if (!key || key.length < 20) return res.status(500).json({ ok: false, erro: 'ANTHROPIC_API_KEY não configurada no servidor.' });
    const bloco = mt === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: mt, data: arquivo_base64 } }
      : { type: 'image', source: { type: 'base64', media_type: mt, data: arquivo_base64 } };
    let resp, tentativa = 0;
    while (true) {
      tentativa++;
      const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 90000);
      try {
        resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4000, system: lerCustos ? PROMPT_LER_CUSTOS : PROMPT_LER_FATURA, messages: [{ role: 'user', content: [bloco, { type: 'text', text: lerCustos ? 'Extraia os custos deste documento, linha por linha.' : 'Extraia os dados deste documento de cobrança.' }] }] }),
        });
      } finally { clearTimeout(to); }
      if (resp.ok || tentativa >= 2 || ![429, 500, 502, 503, 529].includes(resp.status)) break;
      await new Promise(r => setTimeout(r, 2500));
    }
    if (!resp.ok) { const e = await resp.json().catch(() => ({})); return res.status(502).json({ ok: false, erro: 'IA indisponível: ' + ((e.error && e.error.message) || resp.status) }); }
    const data = await resp.json();
    const texto = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const m = texto.match(/\{[\s\S]*\}/);
    let dados; try { dados = JSON.parse(m ? m[0] : texto); } catch (e) { return res.status(422).json({ ok: false, erro: 'Não consegui entender o documento. Tente outro arquivo ou lance manualmente.' }); }
    // empresa no cadastro (pelo CNPJ ou nome)
    let empresa_id = null;
    try {
      const idx = await obterIndiceCadastros();
      const r = CadastrosNormalizar.resolverEmpresaQualquerPapel(dados.emitente, idx);
      if (r && r.id) { empresa_id = r.id; dados.emitente_cadastro = r.nome; }
      if (!empresa_id && dados.cnpj_emitente) {
        const cnpj = String(dados.cnpj_emitente).replace(/\D/g, '');
        if (cnpj.length === 14) {
          const { data: c } = await sb().from('contatos_clientes').select('id,razao_social,cnpj,documento').or(`cnpj.eq.${cnpj},documento.eq.${cnpj}`).limit(1);
          if (c && c[0]) { empresa_id = c[0].id; dados.emitente_cadastro = c[0].razao_social; }
        }
      }
    } catch (e) { /* segue sem vínculo */ }
    dados.empresa_id = empresa_id;
    res.json({ ok: true, dados });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.name === 'AbortError' ? 'A leitura demorou demais. Tente de novo.' : e.message });
  }
});

// Marcar paga / reabrir / cancelar — só Financeiro.
// ── Baixas, comprovantes e anexos das faturas (migration 0051) ─────────
// Arquivos no bucket privado do GED: faturas/<id>/<data>-<nome>. Download só
// por link assinado de 1h gerado pra quem tem acesso à tela de faturas.
async function salvarArquivoFatura(faturaId, arquivo_base64, nome, media_type) {
  const mt = String(media_type || '').toLowerCase();
  if (!midiasAnalise().has(mt)) throw new Error('Tipo de arquivo não suportado — envie PDF ou imagem.');
  if (typeof arquivo_base64 !== 'string' || !arquivo_base64) throw new Error('Arquivo vazio.');
  if (arquivo_base64.length > 20 * 1024 * 1024) throw new Error('Arquivo grande demais (máx. ~15 MB).');
  const buf = Buffer.from(arquivo_base64, 'base64');
  const ext = mt === 'application/pdf' ? 'pdf' : mt.split('/')[1].replace('jpeg', 'jpg');
  const base = String(nome || 'arquivo').replace(/\.[a-z0-9]{2,4}$/i, '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60) || 'arquivo';
  const path = `faturas/${String(faturaId).replace(/[^A-Za-z0-9-]/g, '')}/${Date.now()}-${base}.${ext}`;
  const { error } = await sb().storage.from(gedBucket()).upload(path, buf, { contentType: mt, upsert: false });
  if (error) throw new Error('Falha ao guardar o arquivo: ' + error.message);
  return { path, nome: String(nome || base + '.' + ext).slice(0, 120), media_type: mt, tamanho: buf.length };
}
async function _faturaPorId(id) {
  const { data } = await sb().from('faturas').select('*').eq('id', String(id).slice(0, 80)).maybeSingle();
  return data || null;
}
// Grava na fatura SÓ se ninguém mexeu nela desde que foi lida (mesmo
// updated_at) — revisão 17/10/2026: baixa/estorno/aprovação liam a fatura,
// mudavam a lista de pagamentos e gravavam por cima; duas ações juntas
// (clique duplo, duas pessoas) perdiam ou duplicavam pagamento.
async function gravarFaturaComVersao(f, patch) {
  let q = sb().from('faturas').update(patch).eq('id', f.id);
  q = f.updated_at ? q.eq('updated_at', f.updated_at) : q.is('updated_at', null);
  const { data, error } = await q.select();
  if (error) return { error };
  if (!Array.isArray(data) || !data.length) return { conflito: true };
  return { data: data[0] };
}
const MSG_FATURA_CONFLITO = 'Esta fatura acabou de ser alterada por outra ação (outra baixa, estorno ou outra pessoa). Atualize a lista e confira antes de lançar de novo — nada foi gravado agora.';

// ── Financeiro da empresa: plano de contas, centros, bancos, transferências,
// importação do Conexos (migration 0053). Nada é apagado: desativa/estorna.
app.get('/api/fin/cadastros', auth('financeiro', 'controle'), async (req, res) => {
  try {
    const [c, cc, b] = await Promise.all([
      sb().from('fin_contas').select('*').order('codigo'),
      sb().from('fin_centros_custo').select('*').order('nome'),
      sb().from('fin_bancos').select('*').order('nome'),
    ]);
    if (c.error) return res.json({ ok: false, erro: c.error.message, semTabela: /fin_contas/.test(c.error.message) });
    // Agência/conta só pra quem é do Financeiro (o Controle usa nome e moeda).
    const bancos = (b.data || []).map(x => temFinanceiro(req) ? x : Object.assign({}, x, { agencia: null, conta: null }));
    res.json({ ok: true, contas: c.data || [], centros: cc.data || [], bancos, grupos: FinCore.GRUPOS });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});
app.post('/api/fin/contas', auth('financeiro'), async (req, res) => {
  try {
    const b = req.body || {};
    const v = FinCore.validarConta(b);
    if (!v.ok) return res.status(400).json(v);
    const row = { ...v.conta, updated_at: new Date().toISOString() };
    const q = b.id ? sb().from('fin_contas').update(row).eq('id', String(b.id)) : sb().from('fin_contas').insert(row);
    const { data, error } = await q.select().single();
    if (error) return res.status(400).json({ ok: false, erro: /duplicate|unique/i.test(error.message) ? 'Já existe uma conta com esse código.' : error.message });
    res.json({ ok: true, conta: data });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});
app.post('/api/fin/centros', auth('financeiro'), async (req, res) => {
  try {
    const b = req.body || {};
    const nome = String(b.nome || '').trim().slice(0, 80);
    if (!nome) return res.status(400).json({ ok: false, erro: 'Informe o nome do centro de custo.' });
    const row = { nome, codigo: String(b.codigo || '').trim().slice(0, 20) || null, ativo: b.ativo !== false };
    const q = b.id ? sb().from('fin_centros_custo').update(row).eq('id', String(b.id)) : sb().from('fin_centros_custo').insert(row);
    const { data, error } = await q.select().single();
    if (error) return res.status(400).json({ ok: false, erro: error.message });
    res.json({ ok: true, centro: data });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});
app.post('/api/fin/bancos', auth('financeiro'), async (req, res) => {
  try {
    const b = req.body || {};
    const v = FinCore.validarBanco(b);
    if (!v.ok) return res.status(400).json(v);
    const row = { ...v.banco, updated_at: new Date().toISOString() };
    const q = b.id ? sb().from('fin_bancos').update(row).eq('id', String(b.id)) : sb().from('fin_bancos').insert(row);
    const { data, error } = await q.select().single();
    if (error) return res.status(400).json({ ok: false, erro: error.message });
    res.json({ ok: true, banco: data });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});
app.get('/api/fin/transferencias', auth('financeiro'), async (req, res) => {
  try {
    const { data, error } = await sb().from('fin_transferencias').select('*').order('data', { ascending: false }).limit(2000);
    if (error) return res.json({ ok: false, erro: error.message, transferencias: [] });
    res.json({ ok: true, transferencias: data || [] });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});
app.post('/api/fin/transferencias', auth('financeiro'), async (req, res) => {
  try {
    const v = FinCore.validarTransferencia(req.body || {});
    if (!v.ok) return res.status(400).json(v);
    const vd = FinCore.numBR((req.body || {}).valor_destino);
    // Contas de moedas diferentes (R$ → US$): sem o valor creditado na moeda
    // do destino, o saldo da conta em US$ receberia o valor em R$.
    const { data: contasTr } = await sb().from('fin_bancos').select('id, nome, moeda').in('id', [v.transf.de_banco_id, v.transf.para_banco_id]);
    const cDe = (contasTr || []).find(c => c.id === v.transf.de_banco_id), cPara = (contasTr || []).find(c => c.id === v.transf.para_banco_id);
    if (cDe && cPara && (cDe.moeda || 'BRL') !== (cPara.moeda || 'BRL') && !(vd > 0)) {
      return res.status(400).json({ ok: false, erro: `As contas são de moedas diferentes (${cDe.moeda || 'BRL'} → ${cPara.moeda || 'BRL'}). Informe o "Valor creditado" em ${cPara.moeda || 'BRL'} — nada foi registrado.` });
    }
    if (!(req.body || {}).confirmar_repetido) {
      const desde = new Date(Date.now() - 3 * 60 * 1000).toISOString();
      const { data: iguais } = await sb().from('fin_transferencias').select('id, created_at, estornado')
        .eq('de_banco_id', v.transf.de_banco_id).eq('para_banco_id', v.transf.para_banco_id).eq('data', v.transf.data)
        .eq('valor', v.transf.valor).eq('criado_por', req.session.usuario || '').gte('created_at', desde).limit(5);
      if ((iguais || []).some(t => !t.estornado)) return res.status(409).json({ ok: false, repetido: true, erro: 'Você registrou uma transferência igual (mesmas contas, data e valor) há menos de 3 minutos. É outra transferência?' });
    }
    const { data, error } = await sb().from('fin_transferencias').insert({ ...v.transf, valor_destino: vd > 0 ? vd : null, criado_por: req.session.usuario || null }).select().single();
    if (error) return res.status(400).json({ ok: false, erro: error.message });
    res.json({ ok: true, transferencia: data });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});
app.post('/api/fin/transferencias/:id/estornar', auth('financeiro'), async (req, res) => {
  try {
    const estornado = { por: req.session.usuario || null, em: new Date().toISOString(), motivo: String((req.body || {}).motivo || '').slice(0, 300) || null };
    const { data, error } = await sb().from('fin_transferencias').update({ estornado }).eq('id', String(req.params.id)).is('estornado', null).select().single();
    if (error) return res.status(400).json({ ok: false, erro: error.message });
    res.json({ ok: true, transferencia: data });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});
// ── Despesas / receitas recorrentes (migration 0054, 15/10/2026) ──────
// A recorrência gera as faturas sozinha (job diário + ao salvar). Mês já
// gerado (mesmo cancelado) não é recriado. Nada é apagado.
function _finHojeBR() { return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); }
async function _finNumeroNovaFatura() {
  const ano = new Date().getFullYear();
  const { data: ult } = await sb().from('faturas').select('numero').like('numero', '%/' + String(ano).slice(-2)).order('numero', { ascending: false }).limit(1);
  return FaturasCore.proximoNumero(ult && ult[0] ? ult[0].numero : null, ano);
}
async function gerarFaturasRecorrentes(soId, usuario) {
  let q = sb().from('fin_recorrencias').select('*').eq('ativo', true);
  if (soId) q = q.eq('id', String(soId));
  const { data: recs, error } = await q;
  if (error) throw new Error(error.message);
  if (!recs || !recs.length) return { geradas: [], erros: [] };
  const { data: fats } = await sb().from('faturas').select('origem').eq('origem->>tipo', 'recorrencia').limit(20000);
  const porRec = {};
  (fats || []).forEach(f => { const o = f.origem || {}; (porRec[o.processo_id] = porRec[o.processo_id] || []).push(String(o.idx)); });
  const hoje = _finHojeBR(), geradas = [], erros = [];
  for (const r of recs) {
    for (const x of FinCore.faturasDaRecorrencia(r, porRec[r.id] || [], hoje)) {
      const v = FaturasCore.validarFatura(x.fatura);
      if (!v.ok) { erros.push(`${r.descricao}: ${v.erro}`); continue; }
      const agora = new Date().toISOString();
      const row = { ...v.fatura, origem: { tipo: 'recorrencia', processo_id: r.id, referencia: r.descricao, idx: x.competencia }, criado_por: usuario || 'recorrencia', alterado_por: usuario || 'recorrencia', created_at: agora, updated_at: agora };
      try { row.numero = await _finNumeroNovaFatura(); } catch (e) { row.numero = null; }
      const { data, error: e2 } = await sb().from('faturas').insert(row).select().single();
      if (e2) { if (!/duplicate|unique/i.test(e2.message)) erros.push(`${r.descricao} ${x.competencia}: ${e2.message}`); continue; }
      geradas.push(data);
    }
  }
  return { geradas, erros };
}
app.get('/api/fin/recorrencias', auth('financeiro'), async (req, res) => {
  try {
    const { data, error } = await sb().from('fin_recorrencias').select('*').order('descricao');
    if (error) return res.json({ ok: false, erro: error.message, semTabela: /fin_recorrencias/.test(error.message), recorrencias: [] });
    const { data: fats } = await sb().from('faturas').select('id, numero, origem, status, vencimento, valor').eq('origem->>tipo', 'recorrencia').limit(20000);
    const hoje = _finHojeBR();
    const lista = (data || []).map(r => {
      const minhas = (fats || []).filter(f => f.origem && f.origem.processo_id === r.id);
      return { ...r, proximo: FinCore.proximoVencimento(r, hoje), geradas: minhas.length, abertas: minhas.filter(f => f.status === 'aberta').length, pagas: minhas.filter(f => f.status === 'paga').length };
    });
    res.json({ ok: true, recorrencias: lista });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});
// Cria/edita. Edição com aplicar_futuras: valor/classificação/empresa vão
// também para as faturas futuras ainda em aberto e sem pagamento. Data fim:
// faturas em aberto (sem pagamento) depois do fim são canceladas (não apagadas).
app.post('/api/fin/recorrencias', auth('financeiro'), async (req, res) => {
  try {
    const b = req.body || {};
    const v = FinCore.validarRecorrencia(b);
    if (!v.ok) return res.status(400).json(v);
    const agora = new Date().toISOString(), usuario = req.session.usuario || null;
    const row = { ...v.recorrencia, alterado_por: usuario, updated_at: agora };
    if (!row.empresa_id) { try { const r = CadastrosNormalizar.resolverEmpresaQualquerPapel(row.empresa_nome, await obterIndiceCadastros()); if (r && r.id) row.empresa_id = r.id; } catch (e) { /* segue sem id */ } }
    let rec;
    if (b.id) {
      const { data, error } = await sb().from('fin_recorrencias').update(row).eq('id', String(b.id)).select().single();
      if (error) return res.status(400).json({ ok: false, erro: error.message });
      rec = data;
    } else {
      const { data, error } = await sb().from('fin_recorrencias').insert({ ...row, criado_por: usuario, created_at: agora }).select().single();
      if (error) return res.status(400).json({ ok: false, erro: error.message, semTabela: /fin_recorrencias/.test(error.message) });
      rec = data;
    }
    let atualizadas = 0, canceladas = 0;
    if (b.id) {
      const hoje = _finHojeBR();
      const { data: futuras } = await sb().from('faturas').select('id, vencimento, status, pagamentos, obs').eq('origem->>tipo', 'recorrencia').eq('origem->>processo_id', rec.id).eq('status', 'aberta').gte('vencimento', hoje);
      for (const f of futuras || []) {
        if ((f.pagamentos || []).some(p => !p.estornado)) continue;
        if (rec.fim && f.vencimento > rec.fim || rec.ativo === false && b.cancelar_futuras) {
          await sb().from('faturas').update({ status: 'cancelada', obs: [f.obs, 'Cancelada: recorrência encerrada'].filter(Boolean).join(' · '), alterado_por: usuario, updated_at: agora }).eq('id', f.id);
          canceladas++;
        } else if (b.aplicar_futuras) {
          await sb().from('faturas').update({ valor: rec.valor, moeda: rec.moeda, conta_id: rec.conta_id, centro_custo_id: rec.centro_custo_id, empresa_nome: rec.empresa_nome, empresa_id: rec.empresa_id, alterado_por: usuario, updated_at: agora }).eq('id', f.id);
          atualizadas++;
        }
      }
    }
    const g = rec.ativo ? await gerarFaturasRecorrentes(rec.id, usuario) : { geradas: [], erros: [] };
    res.json({ ok: true, recorrencia: rec, geradas: g.geradas, erros: g.erros, atualizadas, canceladas });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});
app.post('/api/fin/recorrencias/gerar', auth('financeiro'), async (req, res) => {
  try { const g = await gerarFaturasRecorrentes(null, req.session.usuario || null); res.json({ ok: true, geradas: g.geradas.length, erros: g.erros }); }
  catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});
// Job diário: gera as faturas recorrentes que entraram no horizonte.
(function agendarRecorrenciasFinanceiro() {
  const checar = async () => {
    try {
      if (!(await reivindicarJobHoje('recorrencias_financeiro'))) return;
      const g = await gerarFaturasRecorrentes(null, null);
      if (g.geradas.length || g.erros.length) console.log(`recorrências: ${g.geradas.length} fatura(s) gerada(s)` + (g.erros.length ? `; erros: ${g.erros.join(' | ')}` : ''));
    } catch (e) { console.error('recorrências: falha no job diário:', e.message); }
  };
  setTimeout(checar, 90 * 1000);
  setInterval(checar, 30 * 60 * 1000);
})();
// Importação de títulos em aberto (planilha do Conexos já mapeada no navegador).
// Cada linha: {fatura, jaPago}. Pula o que já foi importado (externo.chave).
// O que já tinha sido pago no Conexos vira uma baixa "antes da migração".
app.post('/api/faturas/importar', auth('financeiro'), async (req, res) => {
  try {
    const linhas = Array.isArray(req.body && req.body.linhas) ? req.body.linhas.slice(0, 500) : [];
    if (!linhas.length) return res.status(400).json({ ok: false, erro: 'Nada para importar.' });
    const dataMigracao = /^\d{4}-\d{2}-\d{2}$/.test((req.body || {}).data_migracao || '') ? req.body.data_migracao : new Date().toISOString().slice(0, 10);
    const chaves = linhas.map(l => l && l.fatura && l.fatura.externo && l.fatura.externo.chave).filter(Boolean);
    const existentes = new Set();
    for (let i = 0; i < chaves.length; i += 100) {
      const { data } = await sb().from('faturas').select('externo').in('externo->>chave', chaves.slice(i, i + 100)).neq('status', 'cancelada');
      (data || []).forEach(x => x.externo && existentes.add(x.externo.chave));
    }
    let idx = null; try { idx = await obterIndiceCadastros(); } catch (e) { /* segue sem vínculo */ }
    const ano = new Date().getFullYear();
    const { data: ult } = await sb().from('faturas').select('numero').like('numero', '%/' + String(ano).slice(-2)).order('numero', { ascending: false }).limit(1);
    let numero = ult && ult[0] ? ult[0].numero : null;
    const criadas = [], pulados = [], erros = [];
    const agora = new Date().toISOString();
    for (const l of linhas) {
      const v = FaturasCore.validarFatura(l && l.fatura);
      if (!v.ok) { erros.push({ linha: l && l.linha, erro: v.erro }); continue; }
      const chave = v.fatura.externo && v.fatura.externo.chave;
      if (!chave) { erros.push({ linha: l.linha, erro: 'Sem chave de importação.' }); continue; }
      if (existentes.has(chave)) { pulados.push({ linha: l.linha, documento: v.fatura.documento }); continue; }
      existentes.add(chave);
      const row = { ...v.fatura, criado_por: req.session.usuario || null, alterado_por: req.session.usuario || null, created_at: agora, updated_at: agora };
      if (idx) { try { const r = CadastrosNormalizar.resolverEmpresaQualquerPapel(row.empresa_nome, idx); if (r && r.id) row.empresa_id = r.id; } catch (e) { /* sem vínculo */ } }
      // O CNPJ da planilha do Conexos chega sem os zeros à esquerda (e CPF no
      // formato 9+0000+2): normaliza antes de procurar o cadastro.
      const docExt = row.externo && row.externo.cnpj ? DocumentoBR.normalizarDocumento('JURIDICA', 'Brasil', row.externo.cnpj).documento : '';
      if (!row.empresa_id && (docExt.length === 14 || docExt.length === 11)) {
        const { data: c } = await sb().from('contatos_clientes').select('id').or(`cnpj.eq.${docExt},documento.eq.${docExt}`).limit(1);
        if (c && c[0]) row.empresa_id = c[0].id;
      }
      const jaPago = Math.max(0, Math.round((parseFloat(l.jaPago) || 0) * 100) / 100);
      if (jaPago > 0) {
        row.pagamentos = [{ id: require('crypto').randomUUID(), data: dataMigracao, valor: Math.min(jaPago, row.valor), forma: 'outro', migracao: true, obs: 'Pago no Conexos antes da migração', por: req.session.usuario || null, em: agora }];
        const r = FaturasCore.aplicarPagamentos(row);
        Object.assign(row, { valor_pago: r.valor_pago, status: r.status, pago_em: r.pago_em });
      }
      numero = FaturasCore.proximoNumero(numero, ano);
      row.numero = numero;
      const { data, error } = await sb().from('faturas').insert(row).select('id, numero, tipo, empresa_nome, documento, valor').single();
      if (error) { erros.push({ linha: l.linha, erro: error.message }); continue; }
      criadas.push(data);
    }
    res.json({ ok: true, criadas: criadas.length, pulados, erros, exemplo: criadas.slice(0, 5) });
  } catch (e) { console.error('faturas/importar:', e.message); res.status(500).json({ ok: false, erro: 'Erro na importação.' }); }
});

// ── Faturas: helpers da fase 3 (DARF de retenções, origem a receber) ──
async function criarDarfRetencoes(pag, fatura, usuario) {
  const d = FaturasCore.darfRetencoes(pag);
  if (!d) return null;
  const ano = new Date().getFullYear();
  const { data: ult } = await sb().from('faturas').select('numero').like('numero', '%/' + String(ano).slice(-2)).order('numero', { ascending: false }).limit(1);
  let contaRet = null;
  try { const { data: c } = await sb().from('fin_contas').select('id').eq('codigo', '9.1.01').maybeSingle(); contaRet = c ? c.id : null; } catch (e) { /* tabela pode não existir ainda */ }
  const row = { conta_id: contaRet, numero: FaturasCore.proximoNumero(ult && ult[0] ? ult[0].numero : null, ano), tipo: 'pagar', empresa_nome: 'RECEITA FEDERAL — DARF retenções', documento: `Retenções ${fatura.numero || ''} ${fatura.documento || ''}`.trim(),
    moeda: 'BRL', cambio: 1, valor: d.valor, vencimento: d.vencimento, status: 'aberta', itens: [],
    obs: `IRRF/PIS/COFINS/CSLL retidos no pagamento de ${pag.data} da fatura ${fatura.numero || ''} (${fatura.empresa_nome}).`, criado_por: usuario || null, alterado_por: usuario || null };
  const { data, error } = await sb().from('faturas').insert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}
// A receber com origem (parcela de câmbio / venda): o valor recebido é
// espelhado no processo, pra Dashboard Financeiro e aba Vendas continuarem
// mostrando o mesmo número. Fonte da verdade = fatura.
async function sincronizarOrigemReceber(f) {
  try {
    const o = f && f.origem;
    if (!o || f.tipo !== 'receber' || !o.processo_id) return;
    // câmbio único (À Vista / A Prazo, idx −1): o recebido fica nos campos do
    // próprio processo; entrada/saldo (−2/−3) não têm campo de recebido
    if (o.tipo === 'parcela_cambio' && +o.idx < 0) {
      if (+o.idx !== -1) return;
      const r1 = FaturasCore.aplicarPagamentos(f);
      const v1 = f.status === 'cancelada' ? null : (r1.valor_pago || null);
      const d1 = (f.pagamentos || []).filter(x => !x.estornado).map(x => x.data).filter(Boolean).sort().pop() || null;
      await sb().from('controle_processos').update({ pi_valor_recebido_cliente: v1, pi_data_recebimento: d1, updated_at: new Date().toISOString() }).eq('id', o.processo_id);
      return;
    }
    const col = o.tipo === 'parcela_cambio' ? 'pi_parcelas_json' : o.tipo === 'venda' ? 'vendas_json' : null;
    if (!col) return;
    const { data: p } = await sb().from('controle_processos').select('id, ' + col).eq('id', o.processo_id).maybeSingle();
    if (!p) return;
    let lista = p[col]; const eraTexto = typeof lista === 'string';
    if (eraTexto) { try { lista = JSON.parse(lista); } catch (e) { return; } }
    if (!Array.isArray(lista) || !lista[o.idx]) return;
    const r = FaturasCore.aplicarPagamentos(f);
    let valor = f.status === 'cancelada' ? null : (r.valor_pago || null);
    let ultima = (f.pagamentos || []).filter(x => !x.estornado).map(x => x.data).filter(Boolean).sort().pop() || null;
    // venda em várias parcelas (boletos, 21/10/2026): o recebido da venda é a
    // soma das faturas de todas as parcelas dela
    if (o.tipo === 'venda') {
      const { data: irmas } = await sb().from('faturas').select('id, status, valor, valor_pago, pago_em, pagamentos').eq('origem->>tipo', 'venda').eq('origem->>processo_id', String(o.processo_id)).eq('origem->>idx', String(o.idx));
      const vivas = (irmas || []).filter(x => x.status !== 'cancelada');
      if (vivas.length) {
        const soma = vivas.reduce((s2, x) => s2 + (FaturasCore.aplicarPagamentos(x).valor_pago || 0), 0);
        valor = soma > 0 ? Math.round(soma * 100) / 100 : null;
        ultima = vivas.flatMap(x => (x.pagamentos || []).filter(y => !y.estornado).map(y => y.data)).filter(Boolean).sort().pop() || null;
      }
    }
    const item = { ...lista[o.idx] };
    if (o.tipo === 'parcela_cambio') {
      if ((parseFloat(item.valor_recebido_cliente) || null) === valor && (item.data_recebimento || null) === ultima) return;
      item.valor_recebido_cliente = valor == null ? '' : valor; item.data_recebimento = ultima || '';
    } else {
      if ((parseFloat(item.recebido_valor) || null) === valor && (item.recebido_em || null) === ultima) return;
      item.recebido_valor = valor; item.recebido_em = ultima; item.fatura_id = f.id;
    }
    lista[o.idx] = item;
    await sb().from('controle_processos').update({ [col]: eraTexto ? JSON.stringify(lista) : lista, updated_at: new Date().toISOString() }).eq('id', p.id);
  } catch (e) { console.warn('sincronizarOrigemReceber:', e.message); }
}

// Baixa em lote: 1 pagamento (1 comprovante) quitando várias faturas
app.post('/api/faturas/baixa-lote', auth('financeiro'), async (req, res) => {
  try {
    const b = req.body || {};
    const itens = Array.isArray(b.itens) ? b.itens.filter(i => i && i.fatura_id).slice(0, 50) : [];
    if (itens.length < 1) return res.status(400).json({ ok: false, erro: 'Escolha as faturas do lote.' });
    const ids = itens.map(i => String(i.fatura_id));
    const { data: fats } = await sb().from('faturas').select('*').in('id', ids);
    const porId = Object.fromEntries((fats || []).map(f => [f.id, f]));
    const lote_id = require('crypto').randomUUID();
    const identificador = String(b.identificador || '').trim().slice(0, 120) || null;
    if (identificador && !b.confirmar_repetido) {
      const { data: rep } = await sb().from('faturas').select('id, numero').contains('pagamentos', FaturasCore.filtroJsonbContem({ identificador })).limit(1);
      if (rep && rep.length) return res.status(409).json({ ok: false, repetido: true, erro: `Esse comprovante (${identificador}) já foi usado na fatura ${rep[0].numero || ''}.` });
    }
    // valida tudo antes de gravar qualquer coisa
    const plano = [];
    for (const it of itens) {
      const f = porId[it.fatura_id];
      if (!f) return res.status(404).json({ ok: false, erro: 'Fatura não encontrada no lote.' });
      const v = FaturasCore.validarPagamento({ ...it, data: b.data, forma: b.forma, identificador, obs: b.obs, banco_id: b.banco_id }, f);
      if (!v.ok) return res.status(400).json({ ok: false, erro: `${f.numero || ''}: ${v.erro}` });
      plano.push({ f, pag: { id: require('crypto').randomUUID(), ...v.pagamento, lote_id, por: req.session.usuario || null, em: new Date().toISOString() } });
    }
    let comprovante = null;
    if (b.arquivo_base64) {
      try { comprovante = await salvarArquivoFatura(plano[0].f.id, b.arquivo_base64, b.nome_arquivo, b.media_type); }
      catch (e) { return res.status(400).json({ ok: false, erro: e.message }); }
    }
    const salvas = [];
    for (const { f, pag } of plano) {
      if (comprovante) pag.comprovante = comprovante;
      const pags = (Array.isArray(f.pagamentos) ? f.pagamentos : []).concat([pag]);
      const r = FaturasCore.aplicarPagamentos({ ...f, pagamentos: pags });
      const anexos = (Array.isArray(f.anexos) ? f.anexos : []).concat(comprovante ? [{ id: require('crypto').randomUUID(), tipo: 'comprovante', ...comprovante, pagamento_id: pag.id, lote_id, por: pag.por, em: pag.em }] : []);
      const { data, error } = await sb().from('faturas').update({ pagamentos: pags, anexos, valor_pago: r.valor_pago, status: r.status, pago_em: r.pago_em, alterado_por: req.session.usuario || null, updated_at: new Date().toISOString() }).eq('id', f.id).select().single();
      if (error) return res.status(500).json({ ok: false, erro: `${f.numero || ''}: ${error.message}`, salvas });
      if (data.status === 'paga') await vincularFaturaNosProcessos(data, false);
      await sincronizarOrigemReceber(data);
      salvas.push(data);
    }
    res.json({ ok: true, faturas: salvas, lote_id });
  } catch (e) { console.error('faturas/baixa-lote:', e.message); res.status(500).json({ ok: false, erro: 'Erro na baixa em lote.' }); }
});

// Quais identificadores (de extrato/comprovante) já foram usados em baixas
app.post('/api/faturas/identificadores-usados', auth('financeiro'), async (req, res) => {
  try {
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(x => String(x).slice(0, 120)).slice(0, 500) : [];
    const usados = {};
    for (let i = 0; i < ids.length; i += 50) {
      const lote = ids.slice(i, i + 50);
      const or = lote.map(id => `pagamentos.cs.${JSON.stringify([{ identificador: id }])}`).join(',');
      const { data } = await sb().from('faturas').select('numero, pagamentos').or(or).limit(200);
      (data || []).forEach(f => (f.pagamentos || []).forEach(p => { if (p.identificador && lote.includes(p.identificador) && !p.estornado) usados[p.identificador] = f.numero || '?'; }));
    }
    res.json({ ok: true, usados });
  } catch (e) { res.status(500).json({ ok: false, erro: 'Erro ao checar o extrato.' }); }
});

// Aprovação de pagamento (gerente). Não bloqueia a baixa — marca e avisa.
app.post('/api/faturas/:id/aprovacao', auth('financeiro'), async (req, res) => {
  try {
    if (req.session.role !== 'gerente') return res.status(403).json({ ok: false, erro: 'Só gerente aprova pagamentos.' });
    const f = await _faturaPorId(req.params.id);
    if (!f) return res.status(404).json({ ok: false, erro: 'Fatura não encontrada.' });
    if (f.status === 'cancelada') return res.status(400).json({ ok: false, erro: 'Fatura cancelada.' });
    const aprovar = !(req.body && req.body.desfazer);
    const aprovacao = aprovar ? { por: req.session.usuario || null, nome: req.session.displayName || req.session.nome || null, em: new Date().toISOString() } : null;
    const gv = await gravarFaturaComVersao(f, { aprovacao, updated_at: new Date().toISOString() });
    if (gv.error) return res.status(500).json({ ok: false, erro: gv.error.message });
    if (gv.conflito) return res.status(409).json({ ok: false, conflito: true, erro: MSG_FATURA_CONFLITO });
    res.json({ ok: true, fatura: gv.data });
  } catch (e) { res.status(500).json({ ok: false, erro: 'Erro na aprovação.' }); }
});

// Atualiza os Custos Reais do(s) processo(s) com os valores desta fatura
// (ação explícita do usuário — botão na tela). Não mexe em processo fechado
// nem em taxa lançada por container (essas ficam listadas pra ajuste manual).
app.post('/api/faturas/:id/aplicar-custos-reais', auth('financeiro'), async (req, res) => {
  try {
    const f = await _faturaPorId(req.params.id);
    if (!f) return res.status(404).json({ ok: false, erro: 'Fatura não encontrada.' });
    if (f.status === 'cancelada') return res.status(400).json({ ok: false, erro: 'Fatura cancelada não altera Custos Reais.' });
    const porProc = {};
    (f.itens || []).forEach(it => { if (it.processo_id && it.taxa && parseFloat(it.valor) > 0) (porProc[it.processo_id] = porProc[it.processo_id] || []).push(it); });
    const feitos = [], pulados = [];
    for (const pid of Object.keys(porProc)) {
      const { data: p } = await sb().from('controle_processos').select('id, referencia, real_json, fechado, cancelado').eq('id', pid).maybeSingle();
      if (!p) { pulados.push({ ref: pid, motivo: 'processo não encontrado' }); continue; }
      if (p.fechado || p.cancelado) { pulados.push({ ref: p.referencia, motivo: p.fechado ? 'processo fechado' : 'processo cancelado' }); continue; }
      const rj = (p.real_json && typeof p.real_json === 'object') ? { ...p.real_json } : {};
      rj._meta = (rj._meta && typeof rj._meta === 'object') ? { ...rj._meta } : {};
      let mexeu = false;
      porProc[pid].forEach(it => {
        const chave = f.tipo === 'receber' ? it.taxa + '_cobrado' : it.taxa;
        const atual = rj[chave];
        if (atual && typeof atual === 'object' && atual.porContainer) { pulados.push({ ref: p.referencia, taxa: it.label || it.taxa, motivo: 'lançada por container — ajuste na aba Custos Reais' }); return; }
        const antes = FaturasCore.valorRealPorMoeda(atual);
        const novo = Math.round(parseFloat(it.valor) * 100) / 100;
        if (Object.keys(antes).length === 1 && Math.abs((antes[f.moeda] || -1) - novo) < 0.005) return;
        rj[chave] = { valor: novo, moeda: f.moeda };
        rj._meta[it.taxa] = { ...(rj._meta[it.taxa] || {}), fatura_id: f.id, origem_valor: `fatura ${f.numero || ''}`.trim() };
        mexeu = true;
        feitos.push({ ref: p.referencia, taxa: it.label || it.taxa, antes, depois: { [f.moeda]: novo } });
      });
      if (mexeu) {
        const { error } = await sb().from('controle_processos').update({ real_json: rj, updated_at: new Date().toISOString() }).eq('id', p.id);
        if (error) return res.status(500).json({ ok: false, erro: error.message, feitos });
      }
    }
    res.json({ ok: true, feitos, pulados });
  } catch (e) { console.error('aplicar-custos-reais:', e.message); res.status(500).json({ ok: false, erro: 'Erro ao atualizar Custos Reais.' }); }
});

// A receber pendente: parcelas de câmbio fechadas e vendas com NF que ainda
// não viraram fatura a receber (pra gerar sem digitar e sem duplicar).
app.get('/api/faturas/receber-pendentes', auth('financeiro'), async (req, res) => {
  try {
    // finalidade: quem adianta o câmbio (importação própria não gera a
    // receber da parcela); pi_*: câmbio único / entrada + saldo
    const { data: procs, error } = await sb().from('controle_processos').select('id, referencia, cliente, fase, cancelado, finalidade, pi_pagamento, pi_valor_usd, ci_valor_usd, pi_entrada_pct, pi_cambio_fechado, pi_cambio_entrada, pi_cambio_saldo, pi_data_entrada, pi_data_saldo, pi_valor_recebido_cliente, pi_data_recebimento, pi_parcelas_json, vendas_json').neq('fase', 'FINALIZADO').limit(2000);
    if (error) return res.status(500).json({ ok: false, erro: error.message });
    const { data: fats } = await sb().from('faturas').select('origem, status, valor').not('origem', 'is', null).limit(5000);
    const vivas = (fats || []).filter(f => f.status !== 'cancelada');
    const chaves = vivas.map(f => FaturasCore.chaveOrigem(f.origem)).filter(Boolean);
    const valoresOrigem = {};
    vivas.forEach(f => { const k = FaturasCore.chaveOrigem(f.origem); if (k) valoresOrigem[k] = parseFloat(f.valor) || 0; });
    const lista = [];
    (procs || []).forEach(p => FaturasCore.receberDoProcesso(p, chaves, { valoresOrigem }).forEach(x => lista.push(x)));
    res.json({ ok: true, pendentes: lista.slice(0, 500) });
  } catch (e) { res.status(500).json({ ok: false, erro: 'Erro ao buscar pendências.' }); }
});

// Baixa (parcial ou total) com comprovante opcional
app.post('/api/faturas/:id/baixa', auth('financeiro'), async (req, res) => {
  try {
    const f = await _faturaPorId(req.params.id);
    if (!f) return res.status(404).json({ ok: false, erro: 'Fatura não encontrada.' });
    const b = req.body || {};
    const v = FaturasCore.validarPagamento(b, f);
    if (!v.ok) return res.status(400).json({ ok: false, erro: v.erro });
    const pag = { id: require('crypto').randomUUID(), ...v.pagamento, por: req.session.usuario || null, em: new Date().toISOString() };
    // Mesma baixa (valor, data e forma) pela mesma pessoa há menos de 3 min:
    // quase sempre é clique duplo — pergunta antes de lançar de novo.
    if (!b.confirmar_repetido && !b.lote_id) {
      const recente = (Array.isArray(f.pagamentos) ? f.pagamentos : []).find(p => !p.estornado && p.por === pag.por
        && Math.abs((parseFloat(p.valor) || 0) - (parseFloat(pag.valor) || 0)) < 0.005 && String(p.data || '') === String(pag.data || '')
        && String(p.forma || '') === String(pag.forma || '') && (Date.now() - new Date(p.em || 0).getTime()) < 3 * 60 * 1000);
      if (recente) {
        const seg = Math.max(1, Math.round((Date.now() - new Date(recente.em).getTime()) / 1000));
        return res.status(409).json({ ok: false, repetido: true, erro: `Você registrou uma baixa igual (mesmo valor, data e forma) há ${seg} segundo(s). É outra baixa?` });
      }
    }
    // comprovante repetido em outra baixa (mesma autenticação/ID da transação)
    if (pag.identificador) {
      const { data: rep } = await sb().from('faturas').select('id, numero').contains('pagamentos', FaturasCore.filtroJsonbContem({ identificador: pag.identificador })).limit(1);
      if (rep && rep.length && !b.confirmar_repetido && !b.lote_id) return res.status(409).json({ ok: false, repetido: true, erro: `Esse comprovante (${pag.identificador}) já foi usado na fatura ${rep[0].numero || ''}.` });
    }
    if (b.arquivo_base64) {
      try { pag.comprovante = await salvarArquivoFatura(f.id, b.arquivo_base64, b.nome_arquivo, b.media_type); }
      catch (e) { return res.status(400).json({ ok: false, erro: e.message }); }
    }
    const pags = (Array.isArray(f.pagamentos) ? f.pagamentos : []).concat([pag]);
    const r = FaturasCore.aplicarPagamentos({ ...f, pagamentos: pags });
    const anexos = Array.isArray(f.anexos) ? f.anexos.slice() : [];
    if (pag.comprovante) anexos.push({ id: require('crypto').randomUUID(), tipo: 'comprovante', ...pag.comprovante, pagamento_id: pag.id, por: pag.por, em: pag.em });
    const patch = { pagamentos: pags, anexos, valor_pago: r.valor_pago, status: r.status, pago_em: r.pago_em, alterado_por: req.session.usuario || null, updated_at: new Date().toISOString() };
    const gv = await gravarFaturaComVersao(f, patch);
    if (gv.error) return res.status(500).json({ ok: false, erro: gv.error.message });
    if (gv.conflito) return res.status(409).json({ ok: false, conflito: true, erro: MSG_FATURA_CONFLITO });
    const data = gv.data;
    if (data.status === 'paga') await vincularFaturaNosProcessos(data, false);
    await sincronizarOrigemReceber(data);
    let darf = null;
    if (b.gerar_darf && f.tipo === 'pagar') { try { darf = await criarDarfRetencoes(pag, data, req.session.usuario); } catch (e) { console.warn('darf retenções:', e.message); } }
    res.json({ ok: true, fatura: data, aviso: v.aviso, saldo: r.saldo, darf });
  } catch (e) { console.error('faturas/baixa:', e.message); res.status(500).json({ ok: false, erro: 'Erro ao dar baixa.' }); }
});

// Estorno de uma baixa (marca, não apaga)
app.post('/api/faturas/:id/estornar', auth('financeiro'), async (req, res) => {
  try {
    const f = await _faturaPorId(req.params.id);
    if (!f) return res.status(404).json({ ok: false, erro: 'Fatura não encontrada.' });
    const b = req.body || {};
    let achou = false;
    const pags = (Array.isArray(f.pagamentos) ? f.pagamentos : []).map(p => {
      if (p.id !== b.pagamento_id || p.estornado) return p;
      achou = true;
      return { ...p, estornado: { por: req.session.usuario || null, em: new Date().toISOString(), motivo: String(b.motivo || '').slice(0, 300) || null } };
    });
    if (!achou) return res.status(404).json({ ok: false, erro: 'Pagamento não encontrado.' });
    // numerário já abatido/devolvido: estornar o pagamento dele deixaria o
    // acerto quitado com dinheiro que não saiu — desfaça o abatimento antes
    if (FaturasCore.ehNumerario(f)) {
      const uso = FaturasCore.usoNumerario({ ...f, pagamentos: pags, status: 'aberta' }, await _faturasLigadasAoNumerario(f.id));
      if (uso.disponivel < -0.009) return res.status(400).json({ ok: false, erro: `Este numerário já foi usado (R$ ${(uso.usado + uso.devolvido).toFixed(2).replace('.', ',')} abatidos/devolvidos). Estorne antes o abatimento no acerto do despachante (ou cancele a devolução).` });
    }
    const r = FaturasCore.aplicarPagamentos({ ...f, pagamentos: pags, status: f.status === 'paga' ? 'aberta' : f.status });
    const gv = await gravarFaturaComVersao(f, { pagamentos: pags, valor_pago: r.valor_pago, status: r.status, pago_em: r.pago_em, alterado_por: req.session.usuario || null, updated_at: new Date().toISOString() });
    if (gv.error) return res.status(500).json({ ok: false, erro: gv.error.message });
    if (gv.conflito) return res.status(409).json({ ok: false, conflito: true, erro: MSG_FATURA_CONFLITO });
    const data = gv.data;
    await sincronizarOrigemReceber(data);
    res.json({ ok: true, fatura: data });
  } catch (e) { res.status(500).json({ ok: false, erro: 'Erro ao estornar.' }); }
});

// ── Numerário do despachante (Faturas fase 2, 21/10/2026) ───────────────
// Regras em FaturasCore (usoNumerario / validarAbatimentoNumerario): o
// acerto do despachante é quitado abatendo o numerário já pago (baixa
// "compensação", sem caixa); a sobra vira devolução a receber.
async function _faturasLigadasAoNumerario(numId) {
  const id = String(numId).slice(0, 80);
  const [c, d] = await Promise.all([
    sb().from('faturas').select('id, numero, documento, tipo, status, valor, valor_pago, pagamentos, origem, empresa_nome').contains('pagamentos', FaturasCore.filtroJsonbContem({ compensa: { fatura_id: id } })).limit(300),
    sb().from('faturas').select('id, numero, documento, tipo, status, valor, valor_pago, pagamentos, origem, empresa_nome').eq('origem->>numerario_id', id).limit(100),
  ]);
  if (c.error) throw new Error(c.error.message);
  if (d.error) throw new Error(d.error.message);
  const m = new Map();
  [...(c.data || []), ...(d.data || [])].forEach(x => m.set(x.id, x));
  return [...m.values()];
}
const _resumoNumerario = (n, uso) => ({ id: n.id, numero: n.numero, documento: n.documento, empresa_id: n.empresa_id, empresa_nome: n.empresa_nome, status: n.status, valor: n.valor, valor_pago: n.valor_pago, vencimento: n.vencimento, origem: n.origem, uso });
// Numerários do processo + os com saldo dos despachantes informados (crédito
// que sobrou de outro processo). Body: { processo_id, empresas:[{id,nome}] }
app.post('/api/faturas/numerarios', auth('financeiro', 'controle'), async (req, res) => {
  try {
    const b = req.body || {};
    const pid = String(b.processo_id || '').slice(0, 80);
    const empresas = (Array.isArray(b.empresas) ? b.empresas : []).slice(0, 10);
    const achados = new Map();
    if (pid) {
      const { data, error } = await sb().from('faturas').select('*').eq('origem->>tipo', 'numerario').eq('origem->>processo_id', pid).limit(100);
      if (error) return res.json({ ok: false, erro: error.message, numerarios: [] });
      (data || []).forEach(f => achados.set(f.id, f));
    }
    for (const e of empresas) {
      const nome = String((e && e.nome) || '').trim().slice(0, 120);
      const eid = e && e.id ? String(e.id).slice(0, 80) : '';
      if (!eid && !nome) continue;
      let q = sb().from('faturas').select('*').eq('origem->>tipo', 'numerario').neq('status', 'cancelada');
      q = eid ? q.eq('empresa_id', eid) : q.ilike('empresa_nome', nome.replace(/[%_\\]/g, m => '\\' + m));
      const { data } = await q.limit(50);
      (data || []).forEach(f => achados.set(f.id, f));
    }
    const out = [];
    for (const n of [...achados.values()].slice(0, 60)) {
      const ligadas = await _faturasLigadasAoNumerario(n.id);
      out.push(_resumoNumerario(n, FaturasCore.usoNumerario(n, ligadas)));
    }
    res.json({ ok: true, numerarios: out });
  } catch (e) { console.error('faturas/numerarios:', e.message); res.status(500).json({ ok: false, erro: 'Erro ao buscar os numerários.', numerarios: [] }); }
});
// Abater o numerário numa fatura a pagar do mesmo despachante (o acerto).
// Body: { numerario_id, valor (opcional: o máximo possível), data }
app.post('/api/faturas/:id/abater-numerario', auth('financeiro'), async (req, res) => {
  try {
    const b = req.body || {};
    const f = await _faturaPorId(req.params.id);
    if (!f) return res.status(404).json({ ok: false, erro: 'Fatura não encontrada.' });
    const n = await _faturaPorId(b.numerario_id);
    if (!n) return res.status(404).json({ ok: false, erro: 'Numerário não encontrado.' });
    const ligadas = await _faturasLigadasAoNumerario(n.id);
    const v = FaturasCore.validarAbatimentoNumerario(f, n, b.valor, ligadas);
    if (!v.ok) return res.status(400).json({ ok: false, erro: v.erro });
    const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
    const data = /^\d{4}-\d{2}-\d{2}$/.test(String(b.data || '')) ? String(b.data) : hoje;
    const pag = {
      id: require('crypto').randomUUID(), data, valor: v.valor, juros: 0, desconto: 0, retencoes: {}, cambio_efetivo: null, pago_brl: null,
      forma: 'compensacao', banco_id: null, identificador: null,
      compensa: { tipo: 'numerario', fatura_id: n.id, numero: n.numero || null, documento: n.documento || null },
      obs: `Abatido do numerário ${n.numero || ''}${n.documento ? ' (' + n.documento + ')' : ''}`.trim(),
      por: req.session.usuario || null, em: new Date().toISOString(),
    };
    const pags = (Array.isArray(f.pagamentos) ? f.pagamentos : []).concat([pag]);
    const r = FaturasCore.aplicarPagamentos({ ...f, pagamentos: pags });
    const gv = await gravarFaturaComVersao(f, { pagamentos: pags, valor_pago: r.valor_pago, status: r.status, pago_em: r.pago_em, alterado_por: req.session.usuario || null, updated_at: new Date().toISOString() });
    if (gv.error) return res.status(500).json({ ok: false, erro: gv.error.message });
    if (gv.conflito) return res.status(409).json({ ok: false, conflito: true, erro: MSG_FATURA_CONFLITO });
    if (gv.data.status === 'paga') await vincularFaturaNosProcessos(gv.data, false);
    _resumoFaturasCache = null;
    const uso = FaturasCore.usoNumerario(n, ligadas.filter(x => x.id !== gv.data.id).concat([gv.data]));
    res.json({ ok: true, fatura: gv.data, saldo: r.saldo, numerario: _resumoNumerario(n, uso) });
  } catch (e) { console.error('faturas/abater-numerario:', e.message); res.status(500).json({ ok: false, erro: 'Erro ao abater o numerário.' }); }
});
// Sobra do numerário → fatura a receber do despachante (devolução).
// Body: { valor (opcional: tudo o que sobrou), vencimento }
app.post('/api/faturas/:id/devolucao-numerario', auth('financeiro'), async (req, res) => {
  try {
    const b = req.body || {};
    const n = await _faturaPorId(req.params.id);
    if (!n || !FaturasCore.ehNumerario(n)) return res.status(404).json({ ok: false, erro: 'Numerário não encontrado.' });
    if (n.status === 'cancelada') return res.status(400).json({ ok: false, erro: 'Numerário cancelado.' });
    const uso = FaturasCore.usoNumerario(n, await _faturasLigadasAoNumerario(n.id));
    const valor = b.valor != null && b.valor !== '' ? FinCore.numBR(b.valor) : uso.disponivel;
    if (!(uso.disponivel > 0.009)) return res.status(400).json({ ok: false, erro: 'Não sobrou nada deste numerário pra devolver.' });
    if (!(valor > 0) || valor - uso.disponivel > 0.01) return res.status(400).json({ ok: false, erro: `Só sobrou R$ ${uso.disponivel.toFixed(2).replace('.', ',')} deste numerário.` });
    const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
    const o = n.origem || {};
    const vf = FaturasCore.validarFatura({
      tipo: 'receber', empresa_nome: n.empresa_nome, empresa_id: n.empresa_id, moeda: 'BRL', valor: Math.round(valor * 100) / 100,
      documento: `Devolução do numerário ${n.numero || ''}${n.documento ? ' (' + n.documento + ')' : ''}`.trim(),
      emissao: hoje, vencimento: /^\d{4}-\d{2}-\d{2}$/.test(String(b.vencimento || '')) ? String(b.vencimento) : hoje,
      obs: 'Sobra do numerário depois do acerto do despachante.',
      itens: [{ processo_id: o.processo_id, referencia: o.referencia, taxa: null, label: 'Devolução de numerário', valor: Math.round(valor * 100) / 100 }],
      origem: { tipo: 'devolucao_numerario', processo_id: o.processo_id, referencia: o.referencia, numerario_id: n.id },
    });
    if (!vf.ok) return res.status(400).json({ ok: false, erro: vf.erro });
    const agora = new Date().toISOString();
    const row = { ...vf.fatura, criado_por: req.session.usuario || null, alterado_por: req.session.usuario || null, created_at: agora, updated_at: agora };
    try {
      const ano = new Date().getFullYear();
      const { data: ult } = await sb().from('faturas').select('numero').like('numero', '%/' + String(ano).slice(-2)).order('numero', { ascending: false }).limit(1);
      row.numero = FaturasCore.proximoNumero(ult && ult[0] ? ult[0].numero : null, ano);
    } catch (e) { row.numero = null; }
    let data, error;
    for (let tentativa = 0; tentativa < 4; tentativa++) {
      ({ data, error } = await sb().from('faturas').insert(row).select().single());
      if (!(error && error.code === '23505' && /numero/.test(String(error.message || '') + String(error.details || '')))) break;
      try {
        const ano = new Date().getFullYear();
        const { data: ult } = await sb().from('faturas').select('numero').like('numero', '%/' + String(ano).slice(-2)).order('numero', { ascending: false }).limit(1);
        row.numero = FaturasCore.proximoNumero(ult && ult[0] ? ult[0].numero : null, ano);
      } catch (e) { break; }
    }
    if (error) return res.status(500).json({ ok: false, erro: error.message });
    _resumoFaturasCache = null;
    res.json({ ok: true, fatura: data });
  } catch (e) { console.error('faturas/devolucao-numerario:', e.message); res.status(500).json({ ok: false, erro: 'Erro ao gerar a devolução.' }); }
});

// Anexo avulso (a própria fatura em PDF, boleto, e-mail…)
app.post('/api/faturas/:id/anexo', auth('financeiro', 'controle'), async (req, res) => {
  try {
    const f = await _faturaPorId(req.params.id);
    if (!f) return res.status(404).json({ ok: false, erro: 'Fatura não encontrada.' });
    const b = req.body || {};
    let arq;
    try { arq = await salvarArquivoFatura(f.id, b.arquivo_base64, b.nome_arquivo, b.media_type); }
    catch (e) { return res.status(400).json({ ok: false, erro: e.message }); }
    const tipo = ['fatura', 'comprovante', 'outro'].includes(b.tipo) ? b.tipo : 'outro';
    const anexos = (Array.isArray(f.anexos) ? f.anexos : []).concat([{ id: require('crypto').randomUUID(), tipo, ...arq, por: req.session.usuario || null, em: new Date().toISOString() }]);
    const gv = await gravarFaturaComVersao(f, { anexos, updated_at: new Date().toISOString() });
    if (gv.error) return res.status(500).json({ ok: false, erro: gv.error.message });
    if (gv.conflito) return res.status(409).json({ ok: false, conflito: true, erro: MSG_FATURA_CONFLITO });
    res.json({ ok: true, fatura: gv.data });
  } catch (e) { res.status(500).json({ ok: false, erro: 'Erro ao anexar.' }); }
});

// Link assinado (1h) pra abrir um anexo/comprovante
app.get('/api/faturas/:id/arquivo', auth('financeiro', 'controle'), async (req, res) => {
  try {
    const f = await _faturaPorId(req.params.id);
    if (!f) return res.status(404).json({ ok: false, erro: 'Fatura não encontrada.' });
    const path = String(req.query.path || '');
    const conhecidos = new Set([...(f.anexos || []).map(a => a.path), ...(f.pagamentos || []).map(p => p.comprovante && p.comprovante.path)].filter(Boolean));
    if (!conhecidos.has(path)) return res.status(404).json({ ok: false, erro: 'Arquivo não pertence a esta fatura.' });
    const { data, error } = await sb().storage.from(gedBucket()).createSignedUrl(path, 3600);
    if (error || !data) return res.status(500).json({ ok: false, erro: 'Não consegui gerar o link.' });
    res.json({ ok: true, url: data.signedUrl });
  } catch (e) { res.status(500).json({ ok: false, erro: 'Erro ao abrir o arquivo.' }); }
});

// IA lê o comprovante (PIX, TED, boleto pago, contrato de câmbio, DARF pago)
// e sugere a(s) fatura(s) em aberto que ele quita.
const PROMPT_LER_COMPROVANTE = `Você lê COMPROVANTES DE PAGAMENTO de uma importadora brasileira (PIX, TED/DOC, boleto pago, DARF pago, contrato/fechamento de câmbio, recibo). Responda SOMENTE com um JSON válido, sem texto antes ou depois:
{"tipo":"pix|ted|boleto|darf|cambio|outro","data_pagamento":"AAAA-MM-DD","valor":0,"moeda":"BRL|USD|EUR","favorecido":"quem RECEBEU o dinheiro","cnpj_favorecido":"só dígitos ou vazio","pagador":"quem pagou","banco":"banco/instituição","identificador":"ID da transação, autenticação, nº de controle ou E2E — o código único do comprovante","documento_pago":"nº do boleto/linha digitável/descrição/referência que aparece, se houver","observacao":"algo importante em 1 frase ou vazio"}
Regras: valor é o valor EFETIVAMENTE pago (com juros/multa, se houver). Datas sempre AAAA-MM-DD. Se não achar um campo, deixe vazio ("" ou 0). Não invente.`;
app.post('/api/faturas/ler-comprovante', auth('financeiro'), rateLimitAnalisar, async (req, res) => {
  try {
    const { arquivo_base64, media_type, fatura_id } = req.body || {};
    const mt = String(media_type || '').toLowerCase();
    if (!arquivo_base64 || typeof arquivo_base64 !== 'string') return res.status(400).json({ ok: false, erro: 'Envie o comprovante (PDF ou imagem).' });
    if (!midiasAnalise().has(mt)) return res.status(400).json({ ok: false, erro: 'Tipo de arquivo não suportado — envie PDF ou imagem.' });
    if (arquivo_base64.length > 20 * 1024 * 1024) return res.status(400).json({ ok: false, erro: 'Arquivo grande demais (máx. ~15 MB).' });
    const key = (process.env.ANTHROPIC_API_KEY || '').trim();
    if (!key || key.length < 20) return res.status(500).json({ ok: false, erro: 'ANTHROPIC_API_KEY não configurada no servidor.' });
    const bloco = mt === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: mt, data: arquivo_base64 } }
      : { type: 'image', source: { type: 'base64', media_type: mt, data: arquivo_base64 } };
    let resp, tentativa = 0;
    while (true) {
      tentativa++;
      const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 60000);
      try {
        resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1500, system: PROMPT_LER_COMPROVANTE, messages: [{ role: 'user', content: [bloco, { type: 'text', text: 'Extraia os dados deste comprovante de pagamento.' }] }] }),
        });
      } finally { clearTimeout(to); }
      if (resp.ok || tentativa >= 2 || ![429, 500, 502, 503, 529].includes(resp.status)) break;
      await new Promise(r => setTimeout(r, 2500));
    }
    if (!resp.ok) { const e = await resp.json().catch(() => ({})); return res.status(502).json({ ok: false, erro: 'IA indisponível: ' + ((e.error && e.error.message) || resp.status) }); }
    const data = await resp.json();
    const texto = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const m = texto.match(/\{[\s\S]*\}/);
    let dados; try { dados = JSON.parse(m ? m[0] : texto); } catch (e) { return res.status(422).json({ ok: false, erro: 'Não consegui entender o comprovante. Lance a baixa manualmente.' }); }
    try {
      const idx = await obterIndiceCadastros();
      const r = CadastrosNormalizar.resolverEmpresaQualquerPapel(dados.favorecido, idx);
      if (r && r.id) { dados.empresa_id = r.id; dados.favorecido_cadastro = r.nome; }
    } catch (e) { /* segue sem vínculo */ }
    // já usado em outra baixa?
    if (dados.identificador) {
      const { data: rep } = await sb().from('faturas').select('id, numero').contains('pagamentos', FaturasCore.filtroJsonbContem({ identificador: String(dados.identificador).slice(0, 120) })).limit(1);
      if (rep && rep.length) dados.ja_usado_em = rep[0].numero || rep[0].id;
    }
    let sugestoes = [];
    if (!fatura_id) {
      const { data: abertas } = await sb().from('faturas').select('id, numero, empresa_id, empresa_nome, documento, valor, valor_pago, moeda, vencimento, status').eq('status', 'aberta').limit(1000);
      sugestoes = FaturasCore.sugerirFaturasParaComprovante(dados, abertas || []);
    }
    res.json({ ok: true, dados, sugestoes });
  } catch (e) {
    console.error('faturas/ler-comprovante:', e.message);
    res.status(500).json({ ok: false, erro: 'Erro ao ler o comprovante.' });
  }
});

app.post('/api/faturas/:id/:acao', auth('financeiro'), async (req, res) => {
  try {
    const acao = req.params.acao;
    if (!['pagar', 'reabrir', 'cancelar'].includes(acao)) return res.status(404).json({ ok: false, erro: 'Ação inválida.' });
    const { data: f } = await sb().from('faturas').select('*').eq('id', String(req.params.id).slice(0, 80)).maybeSingle();
    if (!f) return res.status(404).json({ ok: false, erro: 'Fatura não encontrada.' });
    const b = req.body || {};
    // numerário já abatido num acerto (ou com devolução gerada) não pode ser
    // reaberto/cancelado: desfaça antes o uso (fase 2, 21/10/2026)
    if ((acao === 'reabrir' || acao === 'cancelar') && FaturasCore.ehNumerario(f)) {
      const uso = FaturasCore.usoNumerario(f, await _faturasLigadasAoNumerario(f.id));
      if (uso.usado + uso.devolvido > 0.009) return res.status(400).json({ ok: false, erro: `Este numerário já foi usado (R$ ${(uso.usado + uso.devolvido).toFixed(2).replace('.', ',')} abatidos/devolvidos). Estorne antes o abatimento no acerto do despachante (ou cancele a devolução).` });
    }
    const patch = { alterado_por: req.session.usuario || null, updated_at: new Date().toISOString() };
    if (acao === 'pagar') {
      // "Marcar paga" = uma baixa do saldo inteiro (fica na lista de pagamentos)
      const pago_em = /^\d{4}-\d{2}-\d{2}$/.test(b.pago_em || '') ? b.pago_em : new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
      const vp = b.valor_pago != null && b.valor_pago !== '' ? parseFloat(b.valor_pago) : FaturasCore.saldoFatura(f);
      const v = FaturasCore.validarPagamento({ data: pago_em, valor: vp, forma: b.forma || 'outro' }, f);
      if (!v.ok) return res.status(400).json({ ok: false, erro: v.erro });
      const pags = (Array.isArray(f.pagamentos) ? f.pagamentos : []).concat([{ id: require('crypto').randomUUID(), ...v.pagamento, por: req.session.usuario || null, em: new Date().toISOString() }]);
      const r = FaturasCore.aplicarPagamentos({ ...f, pagamentos: pags });
      // marcou paga com valor menor que o saldo: considera quitada (desconto/acordo)
      Object.assign(patch, { pagamentos: pags, valor_pago: r.valor_pago, status: 'paga', pago_em: r.pago_em || pago_em });
    } else if (acao === 'reabrir') {
      const agora = new Date().toISOString();
      const pags = (Array.isArray(f.pagamentos) ? f.pagamentos : []).map(p => p.estornado ? p : { ...p, estornado: { por: req.session.usuario || null, em: agora, motivo: 'Fatura reaberta' } });
      Object.assign(patch, { status: 'aberta', pago_em: null, valor_pago: null, pagamentos: pags });
    } else {
      Object.assign(patch, { status: 'cancelada', obs: [f.obs, b.motivo ? 'Cancelada: ' + String(b.motivo).slice(0, 300) : 'Cancelada'].filter(Boolean).join(' · ') });
    }
    const gv = await gravarFaturaComVersao(f, patch);
    if (gv.error) return res.status(500).json({ ok: false, erro: gv.error.message });
    if (gv.conflito) return res.status(409).json({ ok: false, conflito: true, erro: MSG_FATURA_CONFLITO });
    const data = gv.data;
    await vincularFaturaNosProcessos(data, acao === 'cancelar');
    res.json({ ok: true, fatura: data });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

  return {};
}

module.exports = { registrar };
