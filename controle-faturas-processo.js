// controle-faturas-processo.js — aba "🧾 Faturas" dentro do processo (21/10/2026).
//
// Pedido do Ayslan (com as telas do HeadCargo de exemplo): um campo de
// faturas que consolide as despesas lançadas em cada fatura, confira a
// fatura recebida/paga com o sistema e aponte as diferenças, mostre se foi
// paga ou está em aberto — dentro de cada processo, inclusive o que há a
// receber do cliente, parcelado ou não.
//
// Para o processo aberto a aba mostra:
//   1. totais: a pagar, pago, a receber, recebido e custos sem fatura;
//   2. as faturas (pagar e receber) com situação e etapa (Recebida →
//      Conferida → Aprovada → Paga, cada uma com quem faz); ao abrir, as
//      taxas (moeda, valor, fator, convertido, no sistema, diferença), as
//      baixas, os documentos e a conferência guardada;
//   3. o a receber do cliente: faturas + o que ainda não virou fatura
//      (adiantamentos de câmbio e NF de venda em parcelas, já descontado o
//      adiantamento — "NF com o valor total", Ayslan 21/10/2026);
//   4. os custos lançados nos Custos Reais que não estão em nenhuma fatura;
//   5. o extrato do processo (realizado × previsto, saldo acumulado).
// E o selo de faturas na lista de processos (verde / amarelo / vermelho).
//
// Regras puras em faturas-core.js (testes_faturas.js). As ações usam os
// modais de controle-faturas.js (baixa, editar, aprovar, ler PDF com IA).
// A aba fica FORA da trava de processo fechado: fatura que chega ou é paga
// depois do fechamento continua podendo ser registrada.

let _pfFaturas = [];          // faturas do processo aberto (GET /api/faturas?processo_id=)
let _pfProcessoId = null;     // de qual processo são
let _pfCarregadoEm = 0;
let _pfAberta = null;         // id da fatura expandida
let _pfVerPrevisto = true;    // extrato com os previstos
let _pfNumerarios = [];       // numerários do processo + os com saldo dos despachantes dele (com o uso)
let _faturasResumo = {};      // processo_id → resumo (selo da lista)

function _pfPodeFinanceiro(){ return !!(typeof _user !== 'undefined' && _user && (_user.role === 'gerente' || (Array.isArray(_user.modulos) && _user.modulos.includes('financeiro')))); }
function _pfSouGerente(){ return !!(typeof _user !== 'undefined' && _user && _user.role === 'gerente'); }
function _pfCambio(){ return (typeof cambioParaTotais === 'function') ? (cambioParaTotais() || {}) : {}; }
function _pfR(v){ return 'R$ ' + _ftFmt(v); }
function _pfE(v){ return v == null ? '' : esc(String(v)); }
function _pfN(v){ const n = parseFloat(v); return isNaN(n) ? 0 : n; }

function _pfEstilos(){
  if(document.getElementById('pf-estilos')) return;
  const st = document.createElement('style');
  st.id = 'pf-estilos';
  st.textContent = `
.pf-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:12px;}
.pf-card{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:8px 12px;}
.pf-card-l{font-size:11px;color:var(--muted);}
.pf-card-v{font-size:17px;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums;}
.pf-card-s{font-size:10.5px;color:var(--muted);}
.pf-sec{border:1px solid var(--border);border-radius:10px;margin-bottom:12px;background:var(--card);}
.pf-sec > summary{cursor:pointer;padding:9px 12px;font-weight:600;font-size:13px;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;list-style:none;}
.pf-sec > summary > span:last-child{margin-left:auto;}
.pf-sec > summary::-webkit-details-marker{display:none;}
.pf-sec > summary::before{content:'▸';color:var(--muted);}
.pf-sec[open] > summary::before{content:'▾';}
.pf-sec-corpo{padding:0 12px 12px;}
.pf-tab{width:100%;border-collapse:collapse;font-size:12px;}
.pf-tab th{text-align:left;font-size:10.5px;color:var(--muted);font-weight:600;padding:6px;border-bottom:1px solid var(--border);white-space:nowrap;}
.pf-tab td{padding:6px;border-bottom:1px solid var(--border);vertical-align:top;overflow-wrap:break-word;}
.pf-rolar{overflow-x:auto;}
.pf-compacta th,.pf-compacta td{padding:5px 4px;}
.pf-compacta th:first-child,.pf-compacta td:first-child{padding-left:8px;}
.pf-compacta th:last-child,.pf-compacta td:last-child{padding-right:8px;}
.pf-compacta .pf-pill{padding:1px 6px;}
.pf-rolar > .pf-tab{min-width:460px;}
.pf-tab .n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
.pf-linha{cursor:pointer;}
.pf-linha:hover td{background:var(--bg);}
.pf-linha.aberta td{background:var(--bg);}
.pf-det td{background:var(--bg);padding:10px 12px 14px;}
.pf-pill{display:inline-block;font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:999px;white-space:nowrap;border:1px solid transparent;}
.pf-ok{background:var(--ok-bg);color:var(--ok);border-color:rgba(21,128,61,.25);}
.pf-av{background:var(--warn-bg);color:var(--warn);border-color:rgba(180,83,9,.25);}
.pf-er{background:var(--err-bg);color:var(--err);border-color:rgba(220,38,38,.25);}
.pf-ne{background:var(--bg);color:var(--muted);border-color:var(--border);}
.pf-in{background:var(--info-bg);color:var(--info);border-color:rgba(14,116,144,.25);}
.pf-passos{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:4px 0 10px;}
.pf-passo{border:1px solid var(--border);border-radius:8px;padding:6px 8px;font-size:11.5px;background:var(--card);}
.pf-passo b{display:block;font-size:12px;}
.pf-passo.feito{background:var(--ok-bg);border-color:rgba(21,128,61,.3);color:var(--ok);}
.pf-passo.atual{border-color:var(--ac);box-shadow:0 0 0 1px var(--ac) inset;}
.pf-passo.alerta{background:var(--err-bg);border-color:rgba(220,38,38,.3);color:var(--err);}
.pf-passo.pulado{opacity:.6;}
.pf-acoes{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;}
.pf-acoes .btn{padding:5px 10px;font-size:11.5px;}
.pf-prev td{color:var(--muted);font-style:italic;}
.pf-neg{color:var(--err);}
.pf-pos{color:var(--ok);}
.pf-dica{font-size:11.5px;color:var(--muted);margin:4px 0 8px;}
.pf-difs{display:flex;flex-direction:column;gap:4px;margin-top:4px;}
.pf-dif{display:flex;gap:6px 10px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;border:1px solid var(--border);border-radius:8px;padding:5px 8px;background:var(--card);}
.pf-dif.aberta{border-color:rgba(220,38,38,.3);}
.pf-dif.contestada{border-color:rgba(180,83,9,.35);background:var(--warn-bg);}
.pf-dif.aceita .pf-dif-msg{color:var(--muted);}
.pf-dif-msg{flex:1 1 240px;min-width:0;overflow-wrap:break-word;}
.pf-dif-acoes{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:11px;}
.pf-dec{color:var(--muted);font-size:10.5px;}
.pf-mini{font:inherit;font-size:11px;padding:2px 8px;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--text);cursor:pointer;white-space:nowrap;}
.pf-mini:hover{border-color:var(--ac);color:var(--ac);}
.pf-mini:focus-visible{outline:2px solid var(--ac);outline-offset:1px;}
.pf-numerario{border:1px dashed var(--border);border-radius:8px;padding:8px 10px;margin-top:8px;font-size:11.5px;background:var(--card);}
.pf-num-linha{display:flex;gap:6px 14px;flex-wrap:wrap;align-items:center;margin-top:4px;}
@media (max-width:720px){.pf-passos{grid-template-columns:repeat(2,minmax(0,1fr));}.pf-tab .esconder-cel{display:none;}}
#pane-faturas-conteudo{container-type:inline-size;}
@container (max-width:640px){.pf-tab .esconder-cel{display:none;}}
@container (max-width:520px){.pf-passos{grid-template-columns:repeat(2,minmax(0,1fr));}}
`;
  document.head.appendChild(st);
}

// ── Dados do processo (o que está na tela, mesmo antes de salvar) ─────────
function _pfSnapshot(p){
  let snap = { ...p };
  try{
    if(typeof coletarCustosReaisDoForm === 'function' && document.getElementById('pane-custosreais')) snap.real_json = coletarCustosReaisDoForm();
  }catch(e){ /* fica o salvo */ }
  try{ if(typeof _vendas !== 'undefined' && Array.isArray(_vendas) && document.getElementById('pane-vendas')) snap.vendas_json = JSON.stringify(_vendas); }catch(e){}
  try{ if(typeof _parcelas !== 'undefined' && Array.isArray(_parcelas) && _parcelas.length && p.pi_pagamento === 'PARCELADO') snap.pi_parcelas_json = JSON.stringify(_parcelas); }catch(e){}
  return snap;
}
function _pfChavesOrigem(){
  const chaves = [], valores = {};
  _pfFaturas.forEach(f => { if(f.status === 'cancelada' || !f.origem) return; const k = FaturasCore.chaveOrigem(f.origem); if(k){ chaves.push(k); valores[k] = _pfN(f.valor); } });
  return { chaves, valores };
}
function _pfReceberPendentes(snap){
  const { chaves, valores } = _pfChavesOrigem();
  try{ return FaturasCore.receberDoProcesso(snap, chaves, { valoresOrigem: valores }); }catch(e){ console.warn('a receber:', e); return []; }
}
// Valor de uma taxa nos Custos Reais, em R$ (null = não lançada)
function _pfValorSistema(snap, taxa){
  if(!taxa || typeof custosReaisItensFlat !== 'function') return null;
  const base = String(taxa).replace(/_cobrado$/, '');
  const cfg = custosReaisItensFlat().find(x => x.id === base);
  const rj = snap.real_json && typeof snap.real_json === 'object' ? snap.real_json : {};
  const raw = rj[taxa];
  if(raw == null || raw === '' || !cfg || typeof normalizarValorRealItem !== 'function') return null;
  try{ const n = normalizarValorRealItem(raw, cfg, snap); return n && isFinite(n.totalBrl) ? Math.round(n.totalBrl * 100) / 100 : null; }catch(e){ return null; }
}
// Cotação vinculada (Calculador): estimativa_json do processo — valor cotado
// por taxa (total do processo, já multiplicado pelos containers) e o
// faturamento previsto, prazo e juros do boleto da proposta.
function _pfEstimativa(snap){
  let est = snap && snap.estimativa_json;
  if(typeof est === 'string'){ try{ est = JSON.parse(est); }catch(e){ est = null; } }
  return est && typeof est === 'object' ? est : null;
}
function _pfCotados(snap){
  const out = {};
  const est = _pfEstimativa(snap);
  const cot = est && est.custos_cotados_json;
  if(!cot || typeof custosReaisItensFlat !== 'function') return out;
  custosReaisItensFlat().forEach(item => {
    try{
      const v = typeof calcularCustoCotadoItem === 'function' ? calcularCustoCotadoItem(item, cot) : (item.cotado ? item.cotado(cot) : null);
      if(v != null && isFinite(parseFloat(v)) && parseFloat(v) > 0) out[item.id] = Math.round(parseFloat(v) * 100) / 100;
    }catch(e){}
  });
  return out;
}
function _pfPrevistoCotacao(snap){
  const est = _pfEstimativa(snap);
  if(!est) return null;
  const cen = est.cenarios && est.cenarios.com_st;
  const fat = cen && cen.faturamento_total != null ? parseFloat(cen.faturamento_total) : (est.faturamento != null ? parseFloat(est.faturamento) : null);
  if(!(fat > 0)) return null;
  return { faturamento: Math.round(fat * 100) / 100, prazo: est.prazo_texto || '', juros: parseFloat(est.juros_boleto) > 0 ? Math.round(parseFloat(est.juros_boleto) * 100) / 100 : 0 };
}

// Custos lançados (lado Pago) e cobranças à parte (lado Cliente) que não
// estão em nenhuma fatura. O custo da mercadoria fica de fora: é pago pelo
// câmbio (aparece no extrato pelas parcelas de câmbio).
// Vínculo com a cotação (Calculador): o valor que só veio da cotação e
// ninguém conferiu (bolinha azul, fora de real_json._conf) é "estimado"; e o
// "cobrado" que a aprovação da cotação grava é o preço embutido na NF — só
// vira cobrança à parte (a receber separado) quando tem "Receber de".
function _pfSemFatura(snap){
  const out = { pagar: [], receber: [] };
  if(typeof custosReaisItensFlat !== 'function') return out;
  const rj = snap.real_json && typeof snap.real_json === 'object' ? snap.real_json : {};
  const meta = rj._meta && typeof rj._meta === 'object' ? rj._meta : {};
  const faturaViva = id => { if(!id) return false; const f = _pfFaturas.find(x => x.id === id); return f ? f.status !== 'cancelada' : true; };
  custosReaisItensFlat().forEach(item => {
    if(item.id === 'fob' || item.excluirDosTotais) return;
    const m = meta[item.id] || {};
    const brl = _pfValorSistema(snap, item.id);
    const conferido = !!(rj._conf && typeof rj._conf === 'object' && rj._conf[item.id]);
    if(brl && brl > 0 && !faturaViva(m.fatura_id)) out.pagar.push({ taxa: item.id, label: item.label, grupo: item.grupo, valor: brl, para: m.para || '', doc: m.doc || '', pago_em: m.pago_em || '', estimado: !conferido });
    if(item.apenasPago) return;
    const rawC = rj[item.id + '_cobrado'];
    let modo = 'embutido';
    try{ modo = typeof crModoClienteInicial === 'function' ? crModoClienteInicial(rawC, false, rj[item.id]) : 'embutido'; }catch(e){}
    if(modo !== 'aparte' || !String(m.de || '').trim()) return;
    const mc = meta[item.id + '_cobrado'] || {};
    const brlC = _pfValorSistema(snap, item.id + '_cobrado');
    if(brlC && brlC > 0 && !faturaViva(mc.fatura_id)) out.receber.push({ taxa: item.id + '_cobrado', label: item.label, valor: brlC, de: m.de || '', nf: m.nf || '' });
  });
  return out;
}
// Câmbio pago ao fornecedor (saída do processo), pelas mesmas regras do
// Financeiro (listarPagamentosPI). Fora quando o custo da mercadoria já está
// numa fatura deste processo (senão conta duas vezes).
function _pfCambiosFornecedor(snap){
  if(typeof listarPagamentosPI !== 'function') return [];
  if(_pfFaturas.some(f => f.status !== 'cancelada' && (f.itens || []).some(it => it && it.taxa === 'fob' && String(it.processo_id) === String(snap.id)))) return [];
  let pags = [];
  try{ pags = listarPagamentosPI([{ ...snap, fase: snap.fase === 'FINALIZADO' ? 'FATURAMENTO' : snap.fase }]); }catch(e){ return []; }
  let parcelas = [];
  try{ parcelas = snap.pi_parcelas_json ? JSON.parse(snap.pi_parcelas_json) : []; }catch(e){ parcelas = []; }
  const cxDia = (typeof cambioDoDia === 'function' && cambioDoDia('USD')) || 0;
  return pags.map(pg => {
    const cx = pg.cambioFechado || pg.cambioPrevisto || cxDia;
    const pc = pg._parcelaIndex != null ? (parcelas[pg._parcelaIndex] || {}) : {};
    const data = pg.cambioFechado ? (pc.data_fechamento_cambio || pg.vencimento) : pg.vencimento;
    const rot = pg.parcela === 'unico' ? 'pagamento único' : pg.parcela;
    return { data, descricao: `Câmbio ao fornecedor · ${rot} (US$ ${_ftFmt(pg.valorUsd)} × ${cx ? Number(cx).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : '?'}${pg.cambioFechado ? '' : ' previsto'})`,
      valor: cx ? pg.valorUsd * cx : 0, sentido: 'saida', realizado: !!(pg.pago && pg.cambioFechado), grupo: 'cambio' };
  });
}

// ── Carregar e desenhar ────────────────────────────────────────────────────
async function renderFaturasProcesso(p, opts){
  _pfEstilos();
  const box = document.getElementById('pane-faturas-conteudo');
  if(!box) return;
  if(!p || !p.id){ box.innerHTML = '<div class="cr-muted">Salve o processo para ver as faturas dele.</div>'; return; }
  if(typeof FaturasCore === 'undefined'){ box.innerHTML = '<div class="cr-muted">faturas-core.js não carregou — atualize a página.</div>'; return; }
  const recarregar = (opts && opts.recarregar) || _pfProcessoId !== p.id || (Date.now() - _pfCarregadoEm) > 30000;
  if(recarregar){
    if(_pfProcessoId !== p.id){ _pfAberta = null; box.innerHTML = '<div class="cr-muted">Carregando as faturas do processo…</div>'; }
    try{
      const d = await (await fetch('/api/faturas?processo_id=' + encodeURIComponent(p.id))).json();
      if(!d.ok) throw new Error(d.semTabela ? 'a tabela de faturas ainda não existe no banco' : (d.erro || 'erro'));
      _pfFaturas = d.faturas || [];
      _pfProcessoId = p.id; _pfCarregadoEm = Date.now();
      if(typeof _crFaturas !== 'undefined') _pfFaturas.forEach(f => { _crFaturas[f.id] = f; });
    }catch(e){ box.innerHTML = `<div class="empty">Não consegui carregar as faturas: ${_pfE(e.message)}</div>`; return; }
    await _pfCarregarNumerarios(p);
  }
  if(!_editando || _editando.id !== p.id) return; // trocou de processo enquanto carregava
  pfRedesenhar();
}
// Numerários (Faturas fase 2): os deste processo e os que ainda têm saldo
// dos despachantes que cobram neste processo (crédito que sobrou de outro
// processo), cada um com quanto já foi abatido/devolvido. Falhou: segue sem.
async function _pfCarregarNumerarios(p){
  _pfNumerarios = [];
  const empresas = [];
  const vistos = new Set();
  _pfFaturas.forEach(f => {
    if(f.status !== 'aberta' || f.tipo !== 'pagar' || FaturasCore.ehNumerario(f) || (f.moeda || 'BRL') !== 'BRL') return;
    const k = f.empresa_id || String(f.empresa_nome || '').toLowerCase();
    if(!k || vistos.has(k)) return;
    vistos.add(k); empresas.push({ id: f.empresa_id || null, nome: f.empresa_nome || '' });
  });
  const temNumerario = _pfFaturas.some(f => FaturasCore.ehNumerario(f));
  if(!empresas.length && !temNumerario) return;
  try{
    const r = await fetch('/api/faturas/numerarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ processo_id: p.id, empresas: empresas.slice(0, 10) }) });
    const d = await r.json();
    if(d && d.ok) _pfNumerarios = d.numerarios || [];
  }catch(e){ /* sem numerários: a aba funciona igual */ }
}
function _pfUsoNumerario(id){
  const n = _pfNumerarios.find(x => x.id === id);
  return n ? n.uso : null;
}
// Numerários do mesmo despachante com saldo pra abater nesta fatura
function _pfNumerariosParaFatura(f){
  if(!f || f.tipo !== 'pagar' || f.status !== 'aberta' || FaturasCore.ehNumerario(f) || (f.moeda || 'BRL') !== 'BRL') return [];
  return _pfNumerarios.filter(n => n.id !== f.id && n.status !== 'cancelada' && n.uso && n.uso.disponivel > 0.009
    && (n.empresa_id && f.empresa_id ? n.empresa_id === f.empresa_id : String(n.empresa_nome || '').trim().toLowerCase() === String(f.empresa_nome || '').trim().toLowerCase()));
}
// Previsto do extrato: quanto das faturas em aberto de cada despachante vai
// ser abatido de numerário (o disponível + o que ainda falta pagar do
// numerário) — pra não contar a saída duas vezes.
function _pfAbaterPrevisto(){
  const out = {};
  const credito = {};
  const chave = x => x.empresa_id || String(x.empresa_nome || '').trim().toLowerCase();
  _pfNumerarios.forEach(n => {
    if(n.status === 'cancelada' || !n.uso) return;
    const k = chave(n);
    credito[k] = (credito[k] || 0) + Math.max(0, n.uso.disponivel) + Math.max(0, n.uso.a_pagar || 0);
  });
  _pfFaturas.filter(f => f.tipo === 'pagar' && f.status === 'aberta' && !FaturasCore.ehNumerario(f) && (f.moeda || 'BRL') === 'BRL')
    .sort((a, b) => String(a.vencimento || '9999') < String(b.vencimento || '9999') ? -1 : 1)
    .forEach(f => {
      const k = chave(f);
      if(!(credito[k] > 0.009)) return;
      const v = Math.min(credito[k], FaturasCore.saldoFatura(f));
      if(v > 0.009){ out[f.id] = Math.round(v * 100) / 100; credito[k] -= v; }
    });
  return out;
}

// Depois de uma ação (baixa, edição, conferência...): recarrega a aba (se o
// processo estiver aberto) e o selo da lista.
function pfRecarregar(){
  _pfCarregadoEm = 0;
  const pane = document.getElementById('pane-faturas');
  if(_editando && _editando.id && pane){
    if(pane.classList.contains('active')) renderFaturasProcesso(_editando, { recarregar: true });
    else _pfProcessoId = null;
  }
  carregarResumoFaturas(true);
}

function _pfSitPill(f, hoje){
  const s = FaturasCore.situacao(f, hoje);
  if(f.status === 'paga') return `<span class="pf-pill pf-ok">${f.tipo === 'receber' ? 'Recebida' : 'Paga'} ${_ftData(f.pago_em)}</span>`;
  if(f.status === 'cancelada') return '<span class="pf-pill pf-ne">Cancelada</span>';
  const parcial = _pfN(f.valor_pago) > 0 ? ` <span class="cr-muted" style="font-size:10.5px;white-space:nowrap;">${f.tipo === 'receber' ? 'recebida' : 'paga'} em parte</span>` : '';
  if(s === 'vencida') return `<span class="pf-pill pf-er">Vencida</span>${parcial}`;
  if(s === 'hoje') return `<span class="pf-pill pf-av">Vence hoje</span>${parcial}`;
  if(s === 'semana') return `<span class="pf-pill pf-av">Vence na semana</span>${parcial}`;
  if(s === 'sem_vencimento') return `<span class="pf-pill pf-ne">Sem vencimento</span>${parcial}`;
  return `<span class="pf-pill pf-in">Em aberto</span>${parcial}`;
}
// Numerário pago: quanto ainda dá pra abater. Acerto com numerário do mesmo
// despachante disponível: aviso pra abater.
function _pfSeloNumerario(f){
  if(FaturasCore.ehNumerario(f)){
    const u = _pfUsoNumerario(f.id);
    if(!u || !(u.pago > 0)) return '';
    if(u.disponivel > 0.009) return `<span class="pf-pill pf-av" title="Pago ao despachante e ainda não abatido em acerto">disponível ${_pfR(u.disponivel)}</span>`;
    return '<span class="cr-muted" style="font-size:10.5px;">todo abatido</span>';
  }
  const ns = _pfNumerariosParaFatura(f);
  if(!ns.length) return '';
  const tot = ns.reduce((s2, n) => s2 + n.uso.disponivel, 0);
  return `<span class="pf-pill pf-av" title="Abra a fatura e use Abater do numerário">numerário ${_pfR(tot)} a abater</span>`;
}
function _pfEtapaPill(f){
  const et = FaturasCore.etapaFatura(f);
  const n = FaturasCore.contagemConferencia(f.conferencia), div = n.total - n.aceitas;
  // tudo o que sobrou foi contestado: amarelo, "aguardando o fornecedor"
  const divergente = div && n.contestadas === div ? ['pf-av', `${div} contestada${div === 1 ? '' : 's'}`] : ['pf-er', `${div} diferença${div === 1 ? '' : 's'}`];
  const mapa = {
    prevista: ['pf-ne', 'Sem documento'], recebida: ['pf-in', 'Recebida · conferir'], conferida: ['pf-ok', 'Conferida'],
    divergente, aprovada: ['pf-ok', 'Aprovada'], paga: ['pf-ok', 'Paga'], numerario: ['pf-in', 'Numerário · pagar'],
    a_receber: ['pf-in', 'A receber'], parcial: ['pf-av', 'Recebida em parte'], cancelada: ['pf-ne', 'Cancelada'],
  };
  const [c, t] = mapa[et] || ['pf-ne', et];
  return `<span class="pf-pill ${c}">${t}</span>`;
}
// Totais do processo em R$ (parte deste processo de cada fatura)
function _pfTotais(p, pendentes, semFat, cambio){
  const t = { pagar_aberto: 0, pago: 0, receber_aberto: 0, recebido: 0, sem_cambio: 0, vencidas: 0 };
  const hoje = _ftHoje();
  _pfFaturas.forEach(f => {
    if(f.status === 'cancelada') return;
    const parte = FaturasCore.parteDoProcesso(f, p.id).fracao;
    if(!(parte > 0)) return;
    const fx = FaturasCore.fatorBRL(f, cambio);
    if(!fx && f.moeda !== 'BRL') t.sem_cambio++;
    const pags = FaturasCore.pagamentosValidos(f);
    let pagoBrl = pags.reduce((s, pg) => s + (pg.forma === 'compensacao' ? 0 : FaturasCore.caixaBrlPagamento(pg, f, cambio)), 0);
    if(f.status === 'paga' && !pags.length) pagoBrl = _pfN(f.valor_pago != null ? f.valor_pago : f.valor) * fx;
    const aberto = FaturasCore.saldoFatura(f) * fx;
    if(f.tipo === 'pagar'){ t.pago += pagoBrl * parte; t.pagar_aberto += aberto * parte; }
    else { t.recebido += pagoBrl * parte; t.receber_aberto += aberto * parte; }
    if(f.status === 'aberta' && FaturasCore.situacao(f, hoje) === 'vencida') t.vencidas++;
  });
  pendentes.forEach(x => { t.receber_aberto += Math.max(0, _pfN(x.valor) - _pfN(x.ja_recebido)); t.recebido += _pfN(x.ja_recebido); });
  const lancados = semFat.pagar.filter(l => !l.estimado);
  t.sem_fatura_qtd = lancados.length;
  t.sem_fatura_valor = lancados.reduce((s, l) => s + l.valor, 0);
  t.sem_fatura_estimados = semFat.pagar.length - lancados.length;
  Object.keys(t).forEach(k => { if(typeof t[k] === 'number' && !/qtd|sem_cambio|vencidas|estimados/.test(k)) t[k] = Math.round(t[k] * 100) / 100; });
  return t;
}

function _pfHtml(p){
  const hoje = _ftHoje();
  const cambio = _pfCambio();
  const snap = _pfSnapshot(p);
  const pendentes = _pfReceberPendentes(snap);
  const semFat = _pfSemFatura(snap);
  const t = _pfTotais(p, pendentes, semFat, cambio);
  const fin = _pfPodeFinanceiro();
  const vivas = _pfFaturas.filter(f => f.status !== 'cancelada');
  const pagar = vivas.filter(f => f.tipo === 'pagar'), receber = vivas.filter(f => f.tipo === 'receber');
  const canceladas = _pfFaturas.length - vivas.length;

  const cards = `<div class="pf-cards">
    <div class="pf-card"><div class="pf-card-l">A pagar (em aberto)</div><div class="pf-card-v">${_pfR(t.pagar_aberto)}</div><div class="pf-card-s">${pagar.filter(f => f.status === 'aberta').length} fatura(s)${t.vencidas ? ` · <span class="pf-neg">${t.vencidas} vencida(s)</span>` : ''}</div></div>
    <div class="pf-card"><div class="pf-card-l">Pago</div><div class="pf-card-v">${_pfR(t.pago)}</div><div class="pf-card-s">baixas registradas</div></div>
    <div class="pf-card"><div class="pf-card-l">A receber do cliente</div><div class="pf-card-v">${_pfR(t.receber_aberto)}</div><div class="pf-card-s">${receber.filter(f => f.status === 'aberta').length} fatura(s)${pendentes.length ? ` + ${pendentes.length} sem fatura` : ''}</div></div>
    <div class="pf-card"><div class="pf-card-l">Recebido</div><div class="pf-card-v">${_pfR(t.recebido)}</div><div class="pf-card-s">do cliente</div></div>
    <div class="pf-card"><div class="pf-card-l">Custos sem fatura</div><div class="pf-card-v" style="${t.sem_fatura_qtd ? 'color:var(--warn);' : ''}">${t.sem_fatura_qtd} taxa${t.sem_fatura_qtd === 1 ? '' : 's'}</div><div class="pf-card-s">${_pfR(t.sem_fatura_valor)} lançados nos Custos Reais${t.sem_fatura_estimados ? ` · + ${t.sem_fatura_estimados} só estimada${t.sem_fatura_estimados === 1 ? '' : 's'} (cotação)` : ''}</div></div>
  </div>${t.sem_cambio ? `<div class="pf-dica" style="color:var(--warn);">⚠ ${t.sem_cambio} fatura(s) em moeda estrangeira sem câmbio — ficaram fora dos totais em R$. Abra e informe o câmbio.</div>` : ''}`;

  const acoes = `<div class="pf-acoes" style="margin:0 0 12px;">
    <button type="button" class="btn btn-primary" data-arraste data-arraste-aceita=".pdf,image/*" onclick="pfLerFaturaRecebida()" title="Envie a fatura do agente, a nota do despachante, a fatura do terminal ou um boleto (PDF ou imagem): a IA lê, confere com o sistema e você confirma antes de salvar">📥 Registrar fatura recebida (PDF)</button>
    ${semFat.pagar.some(l => l.para) || semFat.receber.some(l => l.de) ? `<button type="button" class="btn btn-outline" onclick="crGerarFaturas()" title="Agrupa as taxas dos Custos Reais por empresa + documento e cria as faturas">🧾 Gerar faturas dos custos</button>` : ''}
    ${pendentes.length ? `<button type="button" class="btn btn-outline" onclick="pfGerarReceber()" title="Cria as faturas a receber do cliente (adiantamentos de câmbio e parcelas da NF de venda) que ainda não existem">↘ Gerar a receber (${pendentes.length})</button>` : ''}
    <button type="button" class="btn btn-outline" onclick="pfNovoNumerario()" title="Adiantamento que o despachante pede antes do desembaraço — depois é abatido no acerto (faturamento) dele">💵 Numerário do despachante</button>
    <button type="button" class="btn btn-outline" onclick="pfRecarregar()" title="Busca de novo as faturas deste processo">↻ Atualizar</button>
    ${fin ? `<a class="btn btn-outline" href="/faturas?busca=${encodeURIComponent(p.referencia || '')}" target="_blank" rel="noopener" title="Tela Faturas (todas as faturas da empresa)">↗ Tela Faturas</a>` : ''}
  </div>`;

  return `<div class="form-section">
    <div class="form-section-title">💳 Faturas do processo</div>
    <div class="pf-dica">Cada fatura junta as taxas cobradas num documento (agente de carga, despachante, terminal, cliente). A conferência compara com os Custos Reais; a situação mostra o que está pago e o que está em aberto. ${fin ? '' : 'Baixa de pagamento e aprovação são do Financeiro / gerente.'}</div>
    ${cards}${acoes}
    ${_pfSecFaturas(p, vivas, canceladas, snap, cambio, hoje)}
    ${_pfSecReceber(p, receber, pendentes, cambio, hoje)}
    ${_pfSecSemFatura(semFat)}
    ${_pfSecExtrato(p, snap, pendentes, semFat, cambio, hoje)}
  </div>`;
}

// ── Seção: faturas do processo ─────────────────────────────────────────────
function _pfSecFaturas(p, vivas, canceladas, snap, cambio, hoje){
  const ordem = f => (f.status === 'aberta' ? '0' : f.status === 'paga' ? '1' : '2') + (f.vencimento || '9999');
  const lista = vivas.slice().sort((a, b) => ordem(a) < ordem(b) ? -1 : 1);
  // Tabela de largura fixa (4 colunas): cabe no painel do processo mesmo
  // estreito, e o detalhe que abre embaixo da linha usa a largura toda.
  const linhas = lista.map(f => {
    const parte = FaturasCore.parteDoProcesso(f, p.id);
    const aberta = _pfAberta === f.id;
    const multi = parte.outros.length ? `<div class="cr-muted" style="font-size:10.5px;">parte deste processo · fatura também de ${_pfE(parte.outros.join(', '))}</div>` : '';
    const saldo = FaturasCore.saldoFatura(f) * parte.fracao;
    const pago = f.status === 'aberta' && _pfN(f.valor_pago) > 0;
    return `<tr class="pf-linha${aberta ? ' aberta' : ''}" onclick="pfAbrirFatura('${f.id}')" title="${aberta ? 'Fechar o detalhe' : 'Ver as taxas, os pagamentos e a conferência'}">
      <td>${FaturasCore.ehNumerario(f) ? '<span style="color:var(--err);font-weight:700;">↗</span> Numerário' : FaturasCore.ehDevolucaoNumerario(f) ? '<span style="color:var(--ok);font-weight:700;">↙</span> Devolução' : f.tipo === 'pagar' ? '<span style="color:var(--err);font-weight:700;">↗</span> Pagar' : '<span style="color:var(--ok);font-weight:700;">↙</span> Receber'}<div class="cr-muted" style="font-size:10.5px;font-family:'JetBrains Mono',monospace;">${_pfE(f.numero || '')}</div></td>
      <td style="overflow-wrap:anywhere;"><strong>${_pfE(f.empresa_nome)}</strong>${f.documento ? `<div class="cr-muted" style="font-size:11px;">doc ${_pfE(f.documento)}</div>` : ''}${multi}</td>
      <td class="n">${_ftSimb(f.moeda)} ${_ftFmt(parte.valor)}${parte.fracao < 1 ? `<div class="cr-muted" style="font-size:10.5px;">de ${_ftFmt(f.valor)}</div>` : ''}${pago ? `<div style="font-size:10.5px;color:var(--warn);">saldo ${_ftFmt(saldo)}</div>` : ''}</td>
      <td><div style="display:flex;flex-direction:column;align-items:flex-start;gap:3px;">${_pfSitPill(f, hoje)}${_pfEtapaPill(f)}${_pfSeloNumerario(f)}${f.status === 'aberta' && f.vencimento ? `<span class="cr-muted" style="font-size:10.5px;">vence ${_ftData(f.vencimento)}</span>` : ''}</div></td>
    </tr>${aberta ? `<tr class="pf-det"><td colspan="4">${_pfDetalhe(p, f, snap, cambio, parte)}</td></tr>` : ''}`;
  }).join('');
  const vazio = `<div class="pf-dica">Nenhuma fatura neste processo ainda. Quando chegar a cobrança do agente, do despachante ou do terminal, use <b>📥 Registrar fatura recebida</b>: a IA lê o PDF e confere com os Custos Reais.</div>`;
  return `<details class="pf-sec" open><summary><span>Faturas (${vivas.length})</span><span class="cr-muted" style="font-weight:400;font-size:11.5px;">${canceladas ? canceladas + ' cancelada(s) não aparecem' : 'clique numa fatura para ver as taxas'}</span></summary>
    <div class="pf-sec-corpo">${vivas.length ? `<div class="pf-rolar"><table class="pf-tab" style="table-layout:fixed;"><colgroup><col style="width:76px;"><col><col style="width:116px;"><col style="width:142px;"></colgroup><thead><tr><th>Tipo</th><th>Pessoa · documento</th><th class="n">Valor</th><th>Situação · etapa</th></tr></thead><tbody>${linhas}</tbody></table></div>` : vazio}</div>
  </details>`;
}
function pfAbrirFatura(id){
  _pfAberta = _pfAberta === id ? null : id;
  pfRedesenhar();
}
function pfRedesenhar(){
  const box = document.getElementById('pane-faturas-conteudo');
  if(!box || !_editando) return;
  try{ box.innerHTML = _pfHtml(_editando); }
  catch(e){ console.error('aba Faturas:', e); box.innerHTML = `<div class="empty">Erro ao montar a aba Faturas: ${_pfE(e.message)}</div>`; }
}

function _pfDetalhe(p, f, snap, cambio, parte){
  const fin = _pfPodeFinanceiro();
  const fx = FaturasCore.fatorBRL(f, cambio);
  const fxTxt = f.moeda === 'BRL' ? '1' : (fx ? fx.toFixed(4).replace('.', ',') : '—');
  // taxas: fatura × sistema (Custos Reais deste processo) × cotado (cotação vinculada)
  const itens = (f.itens || []).filter(Boolean);
  const cotados = _pfCotados(snap);
  const temCotado = itens.some(it => String(it.processo_id) === String(p.id) && it.taxa && cotados[String(it.taxa).replace(/_cobrado$/, '')] != null);
  let somaFat = 0, somaSis = 0, temSis = false;
  const linhasItens = itens.map(it => {
    const deste = String(it.processo_id) === String(p.id);
    const fat = fx ? _pfN(it.valor) * fx : null;
    if(!deste) return `<tr style="opacity:.6;"><td>${_pfE(it.label || it.taxa || '')}</td><td class="n">${_ftFmt(it.valor)}</td><td class="n esconder-cel">${fxTxt}</td><td class="n">${fat != null ? _ftFmt(fat) : '—'}</td><td colspan="${temCotado ? 3 : 2}" class="cr-muted">outro processo (${_pfE(it.referencia || '')})</td></tr>`;
    const cot = it.taxa ? cotados[String(it.taxa).replace(/_cobrado$/, '')] : null;
    const cotHtml = temCotado ? `<td class="n">${cot != null ? `<span title="Valor da cotação vinculada (Calculador)">${_ftFmt(cot)}</span>` : '<span class="cr-muted">—</span>'}</td>` : '';
    let sis = it.taxa ? _pfValorSistema(snap, it.taxa) : null;
    if(sis == null && f.tipo === 'receber' && it.taxa && !/_cobrado$/.test(it.taxa)) sis = _pfValorSistema(snap, it.taxa + '_cobrado');
    if(fat != null) somaFat += fat;
    if(sis != null){ somaSis += sis; temSis = true; }
    let difHtml = '<span class="cr-muted">—</span>';
    if(fat != null && sis != null){
      const dif = Math.round((fat - sis) * 100) / 100, tol = Math.max(1, Math.abs(sis) * 0.005);
      difHtml = Math.abs(dif) <= tol ? '<span class="pf-pos">✓ bate</span>' : `<span class="pf-neg" title="fatura − sistema">${dif > 0 ? '+' : ''}${_ftFmt(dif)}</span>`;
    } else if(fat != null && sis == null) difHtml = '<span class="pf-pill pf-av" title="Esta taxa não está lançada nos Custos Reais">não lançada</span>';
    return `<tr><td>${_pfE(it.label || it.taxa || 'taxa')}</td><td class="n">${_ftFmt(it.valor)}</td><td class="n esconder-cel">${fxTxt}</td><td class="n">${fat != null ? _ftFmt(fat) : '—'}</td><td class="n">${sis != null ? _ftFmt(sis) : '<span class="cr-muted">—</span>'}</td>${cotHtml}<td class="n">${difHtml}</td></tr>`;
  }).join('');
  const difTot = Math.round((somaFat - somaSis) * 100) / 100;
  const tabItens = itens.length ? `<div style="overflow:auto;"><table class="pf-tab pf-compacta" style="background:var(--card);border:1px solid var(--border);border-radius:8px;">
      <thead><tr><th>Taxa</th><th class="n">Valor ${_pfE(_ftSimb(f.moeda))}</th><th class="n esconder-cel">Fator</th><th class="n">Em R$</th><th class="n" title="Lançado na aba Custos Reais">No sistema</th>${temCotado ? '<th class="n" title="Cotação vinculada (Calculador)">Cotado</th>' : ''}<th class="n" title="Fatura − sistema">Diferença</th></tr></thead>
      <tbody>${linhasItens}</tbody>
      <tfoot><tr><td style="font-weight:600;">Total deste processo</td><td class="n" style="font-weight:600;">${_ftFmt(parte.valor)}</td><td class="esconder-cel"></td><td class="n" style="font-weight:600;">${fx ? _ftFmt(somaFat) : '—'}</td><td class="n">${temSis ? _ftFmt(somaSis) : '—'}</td>${temCotado ? '<td></td>' : ''}<td class="n" style="font-weight:600;">${temSis && fx ? (Math.abs(difTot) < 0.01 ? '<span class="pf-pos">✓</span>' : `<span class="pf-neg">${difTot > 0 ? '+' : ''}${_ftFmt(difTot)}</span>`) : ''}</td></tr></tfoot>
    </table></div>` : '<div class="pf-dica">Fatura sem taxas detalhadas (ex.: a receber de adiantamento ou de venda).</div>';

  // etapas (a pagar)
  const passos = f.tipo === 'pagar' && f.status !== 'cancelada' ? `<div class="pf-passos">${FaturasCore.passosFatura(f).map(ps => {
    const det = ps.id === 'recebida' ? (ps.estado === 'feito' ? 'documento anexado' : ps.estado === 'pulado' ? 'sem documento anexado' : 'anexe a fatura')
      : ps.id === 'conferida' ? (f.conferencia ? (ps.divergencias
          ? (ps.contestadas === ps.divergencias ? `${ps.contestadas} contestada${ps.contestadas === 1 ? '' : 's'} · aguardando o fornecedor` : `${ps.divergencias} diferença${ps.divergencias === 1 ? '' : 's'}${ps.contestadas ? ` (${ps.contestadas} contestada${ps.contestadas === 1 ? '' : 's'})` : ''} · ${_ftData((f.conferencia.em || '').slice(0, 10))}`)
          : `ok${ps.aceitas ? ` (${ps.aceitas} aceita${ps.aceitas === 1 ? '' : 's'})` : ''} · ${_ftData((f.conferencia.em || '').slice(0, 10))}`) : (ps.estado === 'pulado' ? 'não conferida' : 'confira com o sistema'))
      : ps.id === 'aprovada' ? (f.aprovacao ? `${_pfE(f.aprovacao.nome || f.aprovacao.por || '')} · ${_ftData((f.aprovacao.em || '').slice(0, 10))}` : (ps.estado === 'pulado' ? 'não aprovada' : 'aguarda gerente'))
      : (f.status === 'paga' ? `em ${_ftData(f.pago_em)}` : (_pfN(f.valor_pago) > 0 ? `parcial: ${_ftSimb(f.moeda)} ${_ftFmt(f.valor_pago)}` : `vence ${_ftData(f.vencimento)}`));
    const ico = ps.estado === 'feito' ? '✓' : ps.estado === 'alerta' ? '⚠' : ps.estado === 'pulado' ? '–' : '○';
    return `<div class="pf-passo ${ps.estado}" title="${_pfE(ps.dica)}"><b>${ico} ${ps.label}</b><span>${ps.quem} · ${det}</span></div>`;
  }).join('')}</div>` : '';

  // conferência guardada — cada diferença com Aceitar / Contestar (fase 2);
  // numerário não se confere (é adiantamento): mostra o uso dele
  const confHtml = FaturasCore.ehNumerario(f) ? _pfNumerarioHtml(f, fin) : _pfConferenciaHtml(f, fin) + _pfAbaterHtml(f, fin);

  // baixas e documentos
  const FORMA = Object.fromEntries(typeof _FT_FORMAS !== 'undefined' ? _FT_FORMAS : []);
  const pags = (f.pagamentos || []);
  const pagsHtml = pags.length ? `<table class="pf-tab" style="margin-top:4px;"><thead><tr><th>Data</th><th>Forma</th><th class="n">Valor</th><th class="n">Em R$</th><th>Comprovante</th></tr></thead><tbody>${pags.map(pg => `<tr style="${pg.estornado ? 'opacity:.5;text-decoration:line-through;' : ''}"><td>${_ftData(pg.data)}</td><td>${_pfE(FORMA[pg.forma] || pg.forma || '')}${pg.estornado ? ' <span class="cr-muted">(estornado)</span>' : ''}</td><td class="n">${_ftSimb(f.moeda)} ${_ftFmt(pg.valor)}</td><td class="n">${pg.forma === 'compensacao' ? '<span class="cr-muted" title="Encontro de contas: não movimenta o caixa">compensação</span>' : _ftFmt(FaturasCore.caixaBrlPagamento(pg, f, cambio))}</td><td>${pg.comprovante ? `<a class="cr-link" onclick="event.stopPropagation();ftAbrirArquivo('${f.id}','${_pfE(pg.comprovante.path)}')">📎 ${_pfE(pg.comprovante.nome || 'abrir')}</a>` : '<span class="cr-muted">—</span>'}</td></tr>`).join('')}</tbody></table>`
    : `<div class="cr-muted" style="font-size:11.5px;">${f.status === 'paga' ? `Baixada em ${_ftData(f.pago_em)} (antes do registro de pagamentos).` : 'Nenhum pagamento registrado.'}</div>`;
  const anexos = (f.anexos || []).filter(a => a.tipo !== 'comprovante');
  const anexosHtml = anexos.length ? anexos.map(a => `<a class="cr-link" style="margin-right:10px;" onclick="event.stopPropagation();ftAbrirArquivo('${f.id}','${_pfE(a.path)}')">📄 ${_pfE(a.nome || 'arquivo')}${a.tipo === 'fatura' ? ' (fatura)' : ''}</a>`).join('') : '<span class="cr-muted">nenhum</span>';

  const aberta = f.status === 'aberta';
  const acoes = `<div class="pf-acoes">
    ${aberta && f.tipo === 'pagar' && !FaturasCore.ehNumerario(f) ? `<button type="button" class="btn btn-outline" onclick="event.stopPropagation();pfConferir('${f.id}')" title="Compara esta fatura com os Custos Reais, o cotado e as outras faturas, e guarda o resultado">🔍 ${f.conferencia ? 'Conferir de novo' : 'Conferir com o sistema'}</button>` : ''}
    ${aberta ? `<button type="button" class="btn btn-outline" data-arraste data-arraste-aceita=".pdf,image/*" onclick="event.stopPropagation();pfAnexar('${f.id}')" title="Anexa o PDF da fatura, boleto ou nota">📎 Anexar documento</button>` : ''}
    ${aberta && fin ? `<button type="button" class="btn btn-primary" onclick="event.stopPropagation();pfBaixa('${f.id}')" title="Registrar pagamento (total ou parcial) com comprovante">💰 ${f.tipo === 'receber' ? 'Registrar recebimento' : 'Dar baixa'}</button>` : ''}
    ${!aberta && fin && pags.length ? `<button type="button" class="btn btn-outline" onclick="event.stopPropagation();pfBaixa('${f.id}')">📎 Pagamentos</button>` : ''}
    ${aberta && f.tipo === 'pagar' && _pfSouGerente() ? `<button type="button" class="btn btn-outline" onclick="event.stopPropagation();ftAprovar('${f.id}', ${f.aprovacao ? 'true' : 'false'})">${f.aprovacao ? 'Desfazer aprovação' : '✔ Aprovar pagamento'}</button>` : ''}
    ${aberta ? `<button type="button" class="btn btn-outline" onclick="event.stopPropagation();ftEditar('${f.id}')">✏️ Editar</button>` : ''}
    ${fin && itens.some(it => String(it.processo_id) === String(p.id) && it.taxa) && f.status !== 'cancelada' ? `<button type="button" class="btn btn-outline" onclick="event.stopPropagation();ftAplicarCustosReais('${f.id}')" title="Grava os valores das taxas desta fatura na aba Custos Reais (não mexe em processo fechado nem em taxa por container)">↻ Usar os valores da fatura nos Custos Reais</button>` : ''}
  </div>`;

  return `<div onclick="event.stopPropagation()">
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px;font-size:12px;">
      <div><b>${_pfE(f.empresa_nome)}</b>${f.documento ? ' · doc ' + _pfE(f.documento) : ''}${f.emissao ? ' · emissão ' + _ftData(f.emissao) : ''} · vence ${_ftData(f.vencimento)}${f.moeda !== 'BRL' ? ` · câmbio ${fxTxt}${f.cambio ? '' : ' (do dia)'}` : ''}</div>
      <div style="font-family:'JetBrains Mono',monospace;">total ${_ftSimb(f.moeda)} ${_ftFmt(f.valor)} · pago ${_ftSimb(f.moeda)} ${_ftFmt(f.valor_pago || 0)} · <b style="color:${FaturasCore.saldoFatura(f) > 0 ? 'var(--err)' : 'var(--ok)'};">saldo ${_ftSimb(f.moeda)} ${_ftFmt(FaturasCore.saldoFatura(f))}</b></div>
    </div>
    ${passos}${tabItens}${confHtml}
    <div style="margin-top:10px;font-size:12px;"><b>Pagamentos</b>${pagsHtml}</div>
    <div style="margin-top:8px;font-size:12px;"><b>Documentos</b> · ${anexosHtml}</div>
    ${f.obs ? `<div class="pf-dica" style="margin-top:6px;">Obs.: ${_pfE(f.obs)}</div>` : ''}
    ${acoes}
  </div>`;
}

// ── Conferência guardada: diferenças com Aceitar / Contestar (fase 2) ─────
// Diferença = erro, ou aviso de valor/duplicidade/soma/empresa/taxa já
// faturada (FaturasCore.ehDiferenca). Aceita deixa de contar; contestada
// continua contando até o fornecedor corrigir. Avisos que não mudam o que
// pagar (câmbio, datas, cotado) aparecem embaixo, só informativos.
const _PF_ICO = { erro: '⛔', aviso: '⚠️', info: 'ℹ️', ok: '✅' }, _PF_ORD = { erro: 1, aviso: 2, info: 3, ok: 4 }; // erro primeiro (0 seria falso no || 9)
function _pfDifsConferencia(conf){
  const naoOk = ((conf && conf.checks) || []).filter(c => c && c.nivel !== 'ok');
  const ord = (a, b) => (_PF_ORD[a.nivel] || 9) - (_PF_ORD[b.nivel] || 9);
  return { difs: naoOk.filter(c => FaturasCore.ehDiferenca(c)).sort(ord), outros: naoOk.filter(c => !FaturasCore.ehDiferenca(c)).sort(ord) };
}
function _pfConferenciaHtml(f, fin){
  const conf = f.conferencia;
  if(!conf) return f.tipo === 'pagar' ? '<div class="pf-dica" style="margin-top:8px;">Ainda não conferida com o sistema.</div>' : '';
  const n = FaturasCore.contagemConferencia(conf);
  const { difs, outros } = _pfDifsConferencia(conf);
  const pode = f.status !== 'cancelada';
  const fid = _pfE(f.id);
  const quem = d => `${_pfE(d.nome || d.por || '')}${d.em ? ' · ' + _ftData(String(d.em).slice(0, 10)) : ''}${d.motivo ? ' — ' + _pfE(d.motivo) : ''}`;
  const linha = c => {
    const k = _pfE(FaturasCore.chaveCheck(c));
    const d = FaturasCore.decisaoCheck(conf, c);
    let acoes = '';
    if(!d) acoes = pode ? `<button type="button" class="pf-mini" onclick="pfDecidir('${fid}','${k}','aceita')" title="A fatura está certa ou a diferença foi combinada — deixa de contar como diferença">✓ Aceitar</button><button type="button" class="pf-mini" onclick="pfDecidir('${fid}','${k}','contestada')" title="Cobrar o fornecedor: monta o texto pra mandar e marca como contestada">✉ Contestar</button>` : '';
    else if(d.acao === 'aceita') acoes = `<span class="pf-pill pf-ok">aceita</span><span class="pf-dec">${quem(d)}</span>${pode ? `<a class="cr-link" onclick="pfDecidir('${fid}','${k}','')">desfazer</a>` : ''}`;
    else acoes = `<span class="pf-pill pf-av">contestada</span><span class="pf-dec">${quem(d)} · aguardando o fornecedor</span>${pode ? `<a class="cr-link" onclick="pfDecidir('${fid}','${k}','aceita')">aceitar</a><a class="cr-link" onclick="pfDecidir('${fid}','${k}','')">desfazer</a>` : ''}`;
    return `<div class="pf-dif ${d ? d.acao : 'aberta'}"><div class="pf-dif-msg">${_PF_ICO[c.nivel] || ''} ${_pfE(c.msg)}</div><div class="pf-dif-acoes">${acoes}</div></div>`;
  };
  const resumo = !n.total ? '<span class="pf-pos">sem diferença</span>'
    : [n.abertas ? `<span class="pf-neg">${n.abertas} sem decisão</span>` : '', n.contestadas ? `<span style="color:var(--warn);">${n.contestadas} contestada${n.contestadas === 1 ? '' : 's'}</span>` : '', n.aceitas ? `<span class="pf-pos">${n.aceitas} aceita${n.aceitas === 1 ? '' : 's'}</span>` : ''].filter(Boolean).join(' · ');
  const todas = pode && n.abertas > 1 ? `<button type="button" class="pf-mini" style="margin-left:6px;" onclick="pfContestarTodas('${fid}')" title="Um texto só com todas as diferenças sem decisão">✉ Contestar as ${n.abertas}</button>` : '';
  const aceitouValor = fin && difs.some(c => c.tipo === 'valor' && (FaturasCore.decisaoCheck(conf, c) || {}).acao === 'aceita');
  return `<div style="margin-top:8px;font-size:11.5px;"><b>Conferência</b> de ${_ftData((conf.em || '').slice(0, 10))}${conf.nome || conf.por ? ' por ' + _pfE(conf.nome || conf.por) : ''}: ${resumo}${todas}
    ${difs.length ? `<div class="pf-difs">${difs.slice(0, 15).map(linha).join('')}</div>` : ''}
    ${outros.length ? `<div style="margin-top:4px;">${outros.slice(0, 6).map(c => `<div class="cr-muted">${_PF_ICO[c.nivel] || ''} ${_pfE(c.msg)}</div>`).join('')}</div>` : ''}
    ${!difs.length && !outros.length ? '<div class="cr-muted">Todas as checagens bateram.</div>' : ''}
    ${aceitouValor ? '<div class="pf-dica" style="margin-top:6px;">Aceitou diferença de valor porque a fatura está certa? Use <b>↻ Usar os valores da fatura nos Custos Reais</b> — assim o custo real fica igual ao cobrado.</div>' : ''}
  </div>`;
}
function _pfAcharCheck(f, chave){
  return ((f && f.conferencia && f.conferencia.checks) || []).find(c => FaturasCore.ehDiferenca(c) && FaturasCore.chaveCheck(c) === chave) || null;
}
async function _pfGravarDecisao(fid, chave, acao, motivo){
  const r = await fetch('/api/faturas/' + encodeURIComponent(fid) + '/conferencia/decisao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chave, acao, motivo: motivo || '' }) });
  const d = await r.json().catch(() => ({}));
  if(!d.ok) throw new Error(d.erro || ('erro ' + r.status));
  // atualiza a fatura nas duas listas (aba do processo e tela Faturas)
  [...((typeof _ftLista !== 'undefined' && _ftLista) || []), ...(_pfFaturas || [])].forEach(x => { if(x && x.id === fid) x.conferencia = d.conferencia; });
  return d.conferencia;
}
function _pfAcharFatura(fid){
  return (_pfFaturas || []).find(x => x && x.id === fid) || _ftAcharFatura(fid);
}
function _pfAposDecisao(){
  pfRedesenhar();
  if(typeof carregarResumoFaturas === 'function') carregarResumoFaturas(true);
}
// Aceitar (pede o motivo), contestar (monta o texto pro fornecedor) ou
// desfazer (acao vazia) uma diferença.
function pfDecidir(fid, chave, acao){
  const f = _pfAcharFatura(fid);
  const c = _pfAcharCheck(f, chave);
  if(!f || !c){ showToast('Essa diferença não está mais na conferência — confira de novo.', 'warn'); return; }
  if(!acao){
    _pfGravarDecisao(fid, chave, '', '').then(() => { showToast('Decisão desfeita.', 'ok'); _pfAposDecisao(); }).catch(e => showToast('Não gravou: ' + e.message, 'err'));
    return;
  }
  if(acao === 'aceita') return _pfModalAceite(f, [c]);
  return _pfModalContestar(f, [c]);
}
function pfContestarTodas(fid){
  const f = _pfAcharFatura(fid);
  if(!f || !f.conferencia) return;
  const abertas = _pfDifsConferencia(f.conferencia).difs.filter(c => !FaturasCore.decisaoCheck(f.conferencia, c));
  if(!abertas.length){ showToast('Nenhuma diferença sem decisão.', 'ok'); return; }
  _pfModalContestar(f, abertas);
}
const _PF_MOTIVOS_ACEITE = ['A fatura está certa — vou corrigir os Custos Reais', 'Diferença combinada com o fornecedor', 'Diferença de câmbio / arredondamento', 'Taxa extra autorizada', 'Cobrança parcial — o restante vem em outra fatura'];
function _pfModalAceite(f, checks){
  window._pfDecisaoAtual = { fid: f.id, chaves: checks.map(c => FaturasCore.chaveCheck(c)), acao: 'aceita' };
  const ov = _ftOverlay();
  ov.innerHTML = `<div class="ft-modal-bg" onclick="if(event.target===this) ftFecharModal()"><div class="ft-modal" style="max-width:520px;">
    <div class="ft-modal-head"><span>✓ Aceitar diferença</span><button class="btn btn-outline" onclick="ftFecharModal()">✕</button></div>
    <div class="ft-modal-body">
      <div style="font-size:12px;margin-bottom:10px;">${checks.map(c => `<div>${_PF_ICO[c.nivel] || ''} ${_pfE(c.msg)}</div>`).join('')}</div>
      <label class="form-label" for="pf_dec_motivo" style="display:block;margin-bottom:4px;">Motivo do aceite (fica registrado com seu nome)</label>
      <textarea id="pf_dec_motivo" class="form-input" rows="2" maxlength="300" style="width:100%;resize:vertical;" placeholder="Ex.: diferença combinada com o agente"></textarea>
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;">${_PF_MOTIVOS_ACEITE.map(m => `<button type="button" class="pf-mini" onclick="document.getElementById('pf_dec_motivo').value=this.textContent;document.getElementById('pf_dec_motivo').focus()">${_pfE(m)}</button>`).join('')}</div>
      ${checks.some(c => c.tipo === 'valor') ? '<div class="pf-dica" style="margin-top:10px;">Se a fatura está certa, depois use <b>↻ Usar os valores da fatura nos Custos Reais</b> pra o sistema ficar igual ao cobrado.</div>' : ''}
    </div>
    <div class="ft-modal-foot"><button class="btn btn-outline" onclick="ftFecharModal()">Cancelar</button><button class="btn btn-primary" id="pf_dec_ok" onclick="pfConfirmarDecisao()">✓ Aceitar</button></div>
  </div></div>`;
  setTimeout(() => { const t = document.getElementById('pf_dec_motivo'); if(t) t.focus(); }, 30);
}
function _pfModalContestar(f, checks){
  window._pfDecisaoAtual = { fid: f.id, chaves: checks.map(c => FaturasCore.chaveCheck(c)), acao: 'contestada' };
  const ref = (_editando && _editando.referencia) || [...new Set((f.itens || []).map(it => it && it.referencia).filter(Boolean))].join(', ');
  const texto = FaturasCore.textoContestacao(f, checks, ref);
  const ov = _ftOverlay();
  ov.innerHTML = `<div class="ft-modal-bg" onclick="if(event.target===this) ftFecharModal()"><div class="ft-modal" style="max-width:620px;">
    <div class="ft-modal-head"><span>✉ Contestar com ${_pfE(f.empresa_nome || 'o fornecedor')}</span><button class="btn btn-outline" onclick="ftFecharModal()">✕</button></div>
    <div class="ft-modal-body">
      <div class="cr-muted" style="font-size:11.5px;margin-bottom:6px;">Texto pronto pra mandar por e-mail ou WhatsApp — ajuste se quiser e copie. O ImpakOS não envia nada sozinho.</div>
      <textarea id="pf_dec_texto" class="form-input" rows="${Math.min(14, 7 + checks.length)}" style="width:100%;resize:vertical;font-size:12px;">${_pfE(texto)}</textarea>
      <label class="form-label" for="pf_dec_motivo" style="display:block;margin:10px 0 4px;">Anotação pra equipe (opcional)</label>
      <input id="pf_dec_motivo" class="form-input" maxlength="300" style="width:100%;" placeholder="Ex.: mandei e-mail pro comercial do agente">
    </div>
    <div class="ft-modal-foot"><button class="btn btn-outline" onclick="ftFecharModal()">Cancelar</button><button class="btn btn-outline" onclick="pfCopiarContestacao(this)">📋 Copiar texto</button><button class="btn btn-primary" id="pf_dec_ok" onclick="pfConfirmarDecisao()">Marcar como contestada${checks.length > 1 ? ` (${checks.length})` : ''}</button></div>
  </div></div>`;
}
function pfCopiarContestacao(btn){
  const t = (document.getElementById('pf_dec_texto') || {}).value || '';
  const ok = () => { const o = btn.textContent; btn.textContent = '✓ Copiado'; setTimeout(() => { btn.textContent = o; }, 1800); };
  if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok).catch(() => { const ta = document.getElementById('pf_dec_texto'); ta.select(); try{ document.execCommand('copy'); ok(); }catch(e){ showToast('Não consegui copiar — selecione e copie.', 'warn'); } });
  else { const ta = document.getElementById('pf_dec_texto'); ta.select(); try{ document.execCommand('copy'); ok(); }catch(e){ showToast('Não consegui copiar — selecione e copie.', 'warn'); } }
}
async function pfConfirmarDecisao(){
  const dec = window._pfDecisaoAtual;
  if(!dec) return;
  const motivo = ((document.getElementById('pf_dec_motivo') || {}).value || '').trim();
  if(dec.acao === 'aceita' && !motivo){ showToast('Diga o motivo do aceite.', 'warn'); const t = document.getElementById('pf_dec_motivo'); if(t) t.focus(); return; }
  const btn = document.getElementById('pf_dec_ok');
  if(btn){ if(btn.disabled) return; btn.disabled = true; btn.textContent = 'Gravando…'; }
  let feitas = 0;
  try{
    for(const k of dec.chaves){ await _pfGravarDecisao(dec.fid, k, dec.acao, motivo); feitas++; }
  }catch(e){
    showToast('Não gravou' + (feitas ? ` (${feitas} de ${dec.chaves.length} gravadas)` : '') + ': ' + e.message, 'err');
    if(btn){ btn.disabled = false; btn.textContent = 'Tentar de novo'; }
    if(feitas) _pfAposDecisao();
    return;
  }
  window._pfDecisaoAtual = null;
  ftFecharModal();
  showToast(dec.acao === 'aceita' ? 'Diferença aceita.' : (feitas > 1 ? `${feitas} diferenças contestadas.` : 'Diferença contestada — aguardando o fornecedor.'), 'ok');
  _pfAposDecisao();
}

// ── Numerário do despachante (fase 2) ──────────────────────────────────────
function _pfNumerarioHtml(f, fin){
  const u = _pfUsoNumerario(f.id) || FaturasCore.usoNumerario(f, _pfFaturas);
  const usos = (u.usos || []).map(x => `<div>• abatido ${_pfR(x.valor)} na fatura ${_pfE(x.numero || '')}${x.documento ? ' (' + _pfE(x.documento) + ')' : ''}${x.data ? ' em ' + _ftData(x.data) : ''}</div>`).join('');
  const devs = (u.devolucoes || []).map(x => `<div>• devolução de ${_pfR(x.valor)} — a receber ${_pfE(x.numero || '')} (${x.status === 'paga' ? 'recebida' : 'em aberto'})</div>`).join('');
  const pode = fin && f.status !== 'cancelada' && u.disponivel > 0.009;
  return `<div class="pf-numerario">
    <div><b>💵 Numerário (adiantamento ao despachante)</b> — não é custo do processo: o custo é o acerto (faturamento) do despachante, que abate este valor.</div>
    <div class="pf-num-linha"><span>Pago <b>${_pfR(u.pago)}</b></span><span>Abatido em acertos <b>${_pfR(u.usado)}</b></span>${u.devolvido ? `<span>Devolução <b>${_pfR(u.devolvido)}</b></span>` : ''}<span>Disponível <b>${_pfR(u.disponivel)}</b></span>${u.a_pagar > 0 ? `<span class="pf-neg">Falta pagar ${_pfR(u.a_pagar)}</span>` : ''}</div>
    ${usos || devs ? `<div class="cr-muted" style="margin-top:4px;">${usos}${devs}</div>` : ''}
    ${u.pago > 0 && !(u.usos || []).length ? '<div class="pf-dica" style="margin:4px 0 0;">Quando chegar o acerto do despachante, registre a fatura dele (📥 Registrar fatura recebida) e use <b>💵 Abater</b> nela — o que já foi pago aqui não sai de novo.</div>' : ''}
    ${pode ? `<div class="pf-acoes"><button type="button" class="btn btn-outline" onclick="event.stopPropagation();pfDevolucaoNumerario('${_pfE(f.id)}')" title="O acerto saiu menor que o numerário: gera a fatura a receber do despachante com a sobra">↩ Gerar devolução a receber (${_pfR(u.disponivel)})</button></div>` : ''}
  </div>`;
}
function _pfAbaterHtml(f, fin){
  const ns = _pfNumerariosParaFatura(f);
  if(!ns.length) return '';
  const saldo = FaturasCore.saldoFatura(f);
  const ref = _editando && _editando.referencia;
  return `<div class="pf-numerario">
    <div><b>💵 Numerário deste despachante disponível</b> — o adiantamento já pago abate esta fatura (sem sair dinheiro de novo).</div>
    ${ns.map(n => { const v = Math.min(saldo, n.uso.disponivel); return `<div class="pf-num-linha"><span>Numerário ${_pfE(n.numero || '')}${n.documento ? ' · ' + _pfE(n.documento) : ''}${n.origem && n.origem.referencia && n.origem.referencia !== ref ? ' · do processo ' + _pfE(n.origem.referencia) : ''}: disponível <b>${_pfR(n.uso.disponivel)}</b></span>${fin ? `<button type="button" class="pf-mini" onclick="event.stopPropagation();pfAbaterNumerario('${_pfE(f.id)}','${_pfE(n.id)}')">💵 Abater ${_pfR(v)}</button>` : ''}</div>`; }).join('')}
    ${fin ? '' : '<div class="pf-dica" style="margin:4px 0 0;">O abatimento é feito pelo Financeiro.</div>'}
  </div>`;
}
function _pfHojeIso(){ return typeof _ftHoje === 'function' ? _ftHoje() : new Date().toISOString().slice(0, 10); }
// Novo numerário: fatura a pagar ao despachante, ligada ao processo
function pfNovoNumerario(){
  if(!_editando || !_editando.id){ showToast('Salve o processo antes.', 'warn'); return; }
  const desp = ((document.getElementById('f_despachante') || {}).value || _editando.despachante || '').trim();
  const ov = _ftOverlay();
  ov.innerHTML = `<div class="ft-modal-bg" onclick="if(event.target===this) ftFecharModal()"><div class="ft-modal" style="max-width:560px;">
    <div class="ft-modal-head"><span>💵 Numerário do despachante · ${_pfE(_editando.referencia || '')}</span><button class="btn btn-outline" onclick="ftFecharModal()">✕</button></div>
    <div class="ft-modal-body">
      <div class="cr-muted" style="font-size:11.5px;margin-bottom:10px;">O adiantamento que o despachante pede antes do desembaraço. Não é custo: quando chegar o acerto (faturamento) dele, registre a fatura e use <b>💵 Abater</b> — o que já foi pago aqui é descontado e não sai de novo. Se sobrar, vira devolução a receber.</div>
      <div class="ft-cand-campos">
        <label style="flex:2;position:relative;">Despachante <input class="form-input" id="pf_nm_empresa" value="${_pfE(desp)}" autocomplete="off" oninput="autocompletarContato(this,'DESPACHANTE','pf_nm_dd')"><div id="pf_nm_dd" class="cr-dd" style="display:none;"></div></label>
        <label>Nº da solicitação <input class="form-input" id="pf_nm_doc" placeholder="opcional"></label>
      </div>
      <div class="ft-cand-campos">
        <label>Valor (R$) <input class="form-input" id="pf_nm_valor" inputmode="decimal" placeholder="0,00"></label>
        <label>Vencimento <input class="form-input" type="date" id="pf_nm_venc" value="${_pfHojeIso()}"></label>
      </div>
      <label class="cr-muted" style="display:block;margin-top:8px;">Observação <input class="form-input" id="pf_nm_obs" style="width:100%;box-sizing:border-box;margin-top:4px;" placeholder="ex.: impostos + armazenagem estimados"></label>
    </div>
    <div class="ft-modal-foot"><button class="btn btn-outline" onclick="ftFecharModal()">Cancelar</button><button class="btn btn-primary" id="pf_nm_ok" onclick="pfCriarNumerario()">Criar numerário</button></div>
  </div></div>`;
  setTimeout(() => { const el = document.getElementById(desp ? 'pf_nm_valor' : 'pf_nm_empresa'); if(el) el.focus(); }, 30);
}
async function pfCriarNumerario(){
  const p = _editando; if(!p || !p.id) return;
  const empresa = (document.getElementById('pf_nm_empresa').value || '').trim();
  const valor = typeof parseValorMoeda === 'function' ? parseValorMoeda(document.getElementById('pf_nm_valor').value) : parseFloat(String(document.getElementById('pf_nm_valor').value).replace(/\./g, '').replace(',', '.'));
  if(!empresa){ showToast('Informe o despachante.', 'warn'); return; }
  if(!(valor > 0)){ showToast('Informe o valor do numerário.', 'warn'); return; }
  const btn = document.getElementById('pf_nm_ok'); if(btn){ if(btn.disabled) return; btn.disabled = true; btn.textContent = 'Criando…'; }
  const despCampo = ((document.getElementById('f_despachante') || {}).value || p.despachante || '').trim();
  const body = {
    tipo: 'pagar', empresa_nome: empresa, empresa_id: p.despachante_id && despCampo && despCampo.toLowerCase() === empresa.toLowerCase() ? p.despachante_id : null,
    moeda: 'BRL', cambio: 1, valor, vencimento: document.getElementById('pf_nm_venc').value || null,
    documento: (document.getElementById('pf_nm_doc').value || '').trim() || null, obs: (document.getElementById('pf_nm_obs').value || '').trim() || null,
    origem: { tipo: 'numerario', processo_id: p.id, referencia: p.referencia || null },
    itens: [{ processo_id: p.id, referencia: p.referencia || null, taxa: null, label: 'Numerário (adiantamento ao despachante)', valor }],
  };
  try{
    const d = await (await fetch('/api/faturas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if(!d.ok) throw new Error(d.erro || 'erro');
    ftFecharModal();
    showToast('Numerário criado. Dê a baixa quando pagar.', 'ok');
    const nova = d.faturas && d.faturas[0];
    if(nova) _pfAberta = nova.id;
    pfRecarregar();
  }catch(e){ showToast('Não criou: ' + e.message, 'err'); if(btn){ btn.disabled = false; btn.textContent = 'Criar numerário'; } }
}
function pfAbaterNumerario(fid, nid){
  const f = _pfAcharFatura(fid), n = _pfNumerarios.find(x => x.id === nid);
  if(!f || !n || !n.uso){ showToast('Numerário não encontrado — atualize a aba.', 'warn'); return; }
  const v = Math.min(FaturasCore.saldoFatura(f), n.uso.disponivel);
  window._pfAbaterAtual = { fid, nid };
  const ov = _ftOverlay();
  ov.innerHTML = `<div class="ft-modal-bg" onclick="if(event.target===this) ftFecharModal()"><div class="ft-modal" style="max-width:500px;">
    <div class="ft-modal-head"><span>💵 Abater do numerário</span><button class="btn btn-outline" onclick="ftFecharModal()">✕</button></div>
    <div class="ft-modal-body">
      <div style="font-size:12px;margin-bottom:10px;">Fatura <b>${_pfE(f.numero || '')}</b>${f.documento ? ' · doc ' + _pfE(f.documento) : ''} de <b>${_pfE(f.empresa_nome || '')}</b> — saldo ${_pfR(FaturasCore.saldoFatura(f))}.<br>Numerário <b>${_pfE(n.numero || '')}</b>${n.documento ? ' · ' + _pfE(n.documento) : ''} — disponível ${_pfR(n.uso.disponivel)}.</div>
      <div class="ft-cand-campos">
        <label>Valor a abater (R$) <input class="form-input" id="pf_ab_valor" inputmode="decimal" value="${_ftFmt(v)}"></label>
        <label>Data <input class="form-input" type="date" id="pf_ab_data" value="${_pfHojeIso()}"></label>
      </div>
      <div class="cr-muted" style="font-size:11.5px;margin-top:8px;">Entra como baixa "compensação" na fatura (não é saída de caixa — o dinheiro saiu quando o numerário foi pago). ${FaturasCore.saldoFatura(f) - v > 0.009 ? `Depois sobra ${_pfR(FaturasCore.saldoFatura(f) - v)} pra pagar.` : ''}</div>
    </div>
    <div class="ft-modal-foot"><button class="btn btn-outline" onclick="ftFecharModal()">Cancelar</button><button class="btn btn-primary" id="pf_ab_ok" onclick="pfConfirmarAbatimento()">Abater</button></div>
  </div></div>`;
}
async function pfConfirmarAbatimento(){
  const a = window._pfAbaterAtual; if(!a) return;
  const btn = document.getElementById('pf_ab_ok'); if(btn){ if(btn.disabled) return; btn.disabled = true; btn.textContent = 'Abatendo…'; }
  const valor = typeof parseValorMoeda === 'function' ? parseValorMoeda(document.getElementById('pf_ab_valor').value) : document.getElementById('pf_ab_valor').value;
  try{
    const r = await fetch('/api/faturas/' + encodeURIComponent(a.fid) + '/abater-numerario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ numerario_id: a.nid, valor, data: document.getElementById('pf_ab_data').value || null }) });
    const d = await r.json().catch(() => ({}));
    if(!d.ok) throw new Error(d.erro || ('erro ' + r.status));
    window._pfAbaterAtual = null;
    ftFecharModal();
    showToast(d.saldo > 0.009 ? `Abatido. Falta pagar ${_pfR(d.saldo)}.` : 'Abatido — fatura quitada com o numerário.', 'ok');
    pfRecarregar();
  }catch(e){ showToast('Não abateu: ' + e.message, 'err'); if(btn){ btn.disabled = false; btn.textContent = 'Abater'; } }
}
function pfDevolucaoNumerario(nid){
  const n = _pfAcharFatura(nid);
  const u = _pfUsoNumerario(nid);
  if(!n || !u){ showToast('Numerário não encontrado — atualize a aba.', 'warn'); return; }
  const ov = _ftOverlay();
  ov.innerHTML = `<div class="ft-modal-bg" onclick="if(event.target===this) ftFecharModal()"><div class="ft-modal" style="max-width:480px;">
    <div class="ft-modal-head"><span>↩ Devolução do numerário</span><button class="btn btn-outline" onclick="ftFecharModal()">✕</button></div>
    <div class="ft-modal-body">
      <div style="font-size:12px;margin-bottom:10px;">Sobrou <b>${_pfR(u.disponivel)}</b> do numerário ${_pfE(n.numero || '')} de <b>${_pfE(n.empresa_nome || '')}</b>. Gera uma fatura a receber do despachante — dê a baixa nela quando o dinheiro voltar.</div>
      <div class="ft-cand-campos">
        <label>Valor (R$) <input class="form-input" id="pf_dv_valor" inputmode="decimal" value="${_ftFmt(u.disponivel)}"></label>
        <label>Vencimento <input class="form-input" type="date" id="pf_dv_venc" value="${_pfHojeIso()}"></label>
      </div>
      <div class="cr-muted" style="font-size:11.5px;margin-top:8px;">Se o despachante vai deixar de crédito pro próximo processo, não gere a devolução: o saldo continua disponível e aparece pra abater no próximo acerto dele.</div>
    </div>
    <div class="ft-modal-foot"><button class="btn btn-outline" onclick="ftFecharModal()">Cancelar</button><button class="btn btn-primary" id="pf_dv_ok" onclick="pfConfirmarDevolucao('${_pfE(nid)}')">Gerar a receber</button></div>
  </div></div>`;
}
async function pfConfirmarDevolucao(nid){
  const btn = document.getElementById('pf_dv_ok'); if(btn){ if(btn.disabled) return; btn.disabled = true; btn.textContent = 'Gerando…'; }
  const valor = typeof parseValorMoeda === 'function' ? parseValorMoeda(document.getElementById('pf_dv_valor').value) : document.getElementById('pf_dv_valor').value;
  try{
    const r = await fetch('/api/faturas/' + encodeURIComponent(nid) + '/devolucao-numerario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valor, vencimento: document.getElementById('pf_dv_venc').value || null }) });
    const d = await r.json().catch(() => ({}));
    if(!d.ok) throw new Error(d.erro || ('erro ' + r.status));
    ftFecharModal();
    showToast('Devolução a receber criada.', 'ok');
    pfRecarregar();
  }catch(e){ showToast('Não gerou: ' + e.message, 'err'); if(btn){ btn.disabled = false; btn.textContent = 'Gerar a receber'; } }
}

// ── Seção: a receber do cliente ────────────────────────────────────────────
function _pfSecReceber(p, receber, pendentes, cambio, hoje){
  const linhasFat = receber.map(f => {
    const parte = FaturasCore.parteDoProcesso(f, p.id);
    const orig = f.origem ? (f.origem.tipo === 'venda' ? 'Venda' + (f.origem.de > 1 ? ` · parcela ${f.origem.parcela}/${f.origem.de}` : '') : 'Adiantamento de câmbio') : 'Cobrança';
    const rec = _pfN(f.valor_pago) * parte.fracao;
    const txOp = f.origem && _pfN(f.origem.taxa_operadora) > 0 ? _pfN(f.origem.taxa_operadora) * parte.fracao : 0;
    return `<tr class="pf-linha" onclick="pfAbrirFatura('${f.id}');document.getElementById('pane-faturas-conteudo').scrollIntoView({block:'start'})" title="Abrir a fatura lá em cima"><td style="overflow-wrap:anywhere;">${orig}<div class="cr-muted" style="font-size:10.5px;">${_pfE(f.empresa_nome)}${f.documento ? ' · ' + _pfE(f.documento) : ''}</div></td><td>${_ftData(f.vencimento)}</td><td class="n">${_ftSimb(f.moeda)} ${_ftFmt(parte.valor)}${txOp > 0 && f.status === 'aberta' ? `<div class="cr-muted" style="font-size:10.5px;" title="A operadora paga já descontada a taxa">líquido ${_ftFmt(parte.valor - txOp)}</div>` : ''}${rec > 0 ? `<div class="pf-pos" style="font-size:10.5px;">recebido ${_ftFmt(rec)}</div>` : ''}</td><td>${_pfSitPill(f, hoje)}</td></tr>`;
  }).join('');
  const linhasPend = pendentes.map(x => {
    const orig = x.tipo_receber === 'venda' ? 'Venda' + (x.origem.de > 1 ? ` · parcela ${x.origem.parcela}/${x.origem.de}` : '') : 'Adiantamento de câmbio';
    const venc = x.vencimento && x.vencimento < hoje ? `<span class="pf-neg">${_ftData(x.vencimento)}</span>` : _ftData(x.vencimento);
    const abat = x.tipo_receber === 'venda' && (x.adiantamento_abatido > 0 || x.juros > 0) && !(x.origem.parcela > 1)
      ? `<div class="cr-muted" style="font-size:10.5px;">NF ${_ftFmt(x.valor_nf)}${x.juros > 0 ? ' + juros ' + _ftFmt(x.juros) : ''}${x.adiantamento_abatido > 0 ? ' − adiantamentos ' + _ftFmt(x.adiantamento_abatido) : ''} = ${_ftFmt(x.total_venda)}</div>` : '';
    const incerto = x.prazo_incerto ? `<div style="font-size:10.5px;color:var(--warn);">⚠ não entendi o prazo "${_pfE(x.prazo)}" — ficou na data da NF; ajuste ao gerar</div>` : '';
    const opHtml = x.operadora ? `<div class="cr-muted" style="font-size:10.5px;">cliente ${_pfE(x.cliente || '')} · taxa ${(x.operadora.taxa_pct * 100).toFixed(2).replace('.', ',')}% (R$ ${_ftFmt(x.operadora.taxa_valor)}) · líquido R$ ${_ftFmt(x.operadora.liquido)}</div>` : '';
    return `<tr><td style="overflow-wrap:anywhere;">${orig}<div class="cr-muted" style="font-size:10.5px;">${_pfE(x.empresa_nome || '—')} · ${_pfE(String(x.documento || '').replace(/ · parcela \d+\/\d+$/, '').replace(/ · (cartão REDE|Trademaster) \dx$/, ''))}${x.prazo && x.tipo_receber === 'venda' ? ' · ' + _pfE(x.prazo) : ''}</div>${opHtml}${abat}${incerto}</td><td>${venc}</td><td class="n">R$ ${_ftFmt(x.valor)}${x.ja_recebido > 0 ? `<div class="pf-pos" style="font-size:10.5px;">recebido ${_ftFmt(x.ja_recebido)}</div>` : ''}</td><td><span class="pf-pill pf-ne" title="Ainda não virou fatura a receber">sem fatura</span></td></tr>`;
  }).join('');
  const temVenda = receber.some(f => f.origem && f.origem.tipo === 'venda') || pendentes.some(x => x.tipo_receber === 'venda');
  const prevCot = !temVenda ? _pfPrevistoCotacao(_pfSnapshot(p)) : null;
  const prevCotHtml = prevCot ? `<div class="pf-dica" style="background:var(--info-bg);border:1px solid var(--border);border-radius:8px;padding:6px 10px;color:var(--text);">📐 <b>Previsto na cotação (Calculador):</b> faturamento ${_pfR(prevCot.faturamento)}${prevCot.prazo ? ' · prazo ' + _pfE(prevCot.prazo) : ''}${prevCot.juros ? ' · juros no boleto ' + _pfR(prevCot.juros) : ''}. Só informação — vira a receber quando a NF de venda for lançada na aba Vendas${FaturasCore.clienteAdiantaCambio(p) ? ' (já descontado o que o cliente adiantar de câmbio)' : ''}.</div>` : '';
  // venda no cartão/Trademaster: a taxa da operadora tem de estar nos Custos Reais
  const snapR = _pfSnapshot(p);
  const faltaTaxa = {};
  pendentes.filter(x => x.operadora).forEach(x => { faltaTaxa[x.operadora.taxa_real] = (faltaTaxa[x.operadora.taxa_real] || 0) + x.operadora.taxa_valor; });
  receber.filter(f => f.origem && f.origem.operadora && _pfN(f.origem.taxa_operadora) > 0).forEach(f => { const k = f.origem.operadora === 'cartao' ? 'taxa_cartao' : 'trademaster'; faltaTaxa[k] = (faltaTaxa[k] || 0) + _pfN(f.origem.taxa_operadora); });
  const dicaTaxa = Object.entries(faltaTaxa).filter(([k]) => !(_pfValorSistema(snapR, k) > 0)).map(([k, v]) => `Lance a taxa da operadora (≈ R$ ${_ftFmt(v)}) em <b>Custos Reais › ${k === 'taxa_cartao' ? 'Taxa do cartão (REDE)' : 'Trademaster'}</b> — ela entra no custo do processo.`).join(' ');
  const regra = FaturasCore.clienteAdiantaCambio(p)
    ? 'Encomenda / conta e ordem: o cliente adianta cada câmbio, e a NF de venda sai com o valor total — o adiantamento é descontado dela.'
    : 'Importação própria: a IMPAK paga o câmbio; o cliente paga a NF de venda (à vista ou nas parcelas do prazo).';
  const total = receber.length + pendentes.length;
  return `<details class="pf-sec" ${total || prevCot ? 'open' : ''}><summary><span>A receber do cliente (${total})</span><span class="cr-muted" style="font-weight:400;font-size:11.5px;">${pendentes.length ? pendentes.length + ' ainda sem fatura' : ''}</span></summary>
    <div class="pf-sec-corpo"><div class="pf-dica">${regra}</div>${prevCotHtml}${dicaTaxa ? `<div class="pf-dica" style="color:var(--warn);">💳 ${dicaTaxa}</div>` : ''}
    ${total ? `<div class="pf-rolar"><table class="pf-tab" style="table-layout:fixed;"><colgroup><col><col style="width:78px;"><col style="width:116px;"><col style="width:134px;"></colgroup><thead><tr><th>Origem · cliente</th><th>Vence</th><th class="n">Valor</th><th>Situação</th></tr></thead><tbody>${linhasFat}${linhasPend}</tbody></table></div>
      ${pendentes.length ? `<div class="pf-acoes"><button type="button" class="btn btn-outline" onclick="pfGerarReceber()">↘ Gerar as ${pendentes.length} fatura(s) a receber</button></div>` : ''}`
      : '<div class="pf-dica">Nada a receber por enquanto (sem câmbio fechado com adiantamento do cliente e sem NF de venda lançada na aba Vendas).</div>'}
    </div></details>`;
}

// ── Seção: custos sem fatura ───────────────────────────────────────────────
function _pfSecSemFatura(semFat){
  const n = semFat.pagar.length + semFat.receber.length;
  const linhas = semFat.pagar.map(l => `<tr><td style="overflow-wrap:anywhere;">${_pfE(l.label)}<div class="cr-muted" style="font-size:10.5px;">${_pfE(l.grupo || '')}</div></td><td style="overflow-wrap:anywhere;">${l.para ? _pfE(l.para) : '<span style="color:var(--warn);">falta "Pagamos para"</span>'}${l.doc ? `<div class="cr-muted" style="font-size:10.5px;">doc ${_pfE(l.doc)}</div>` : ''}</td><td class="n">${_ftFmt(l.valor)}</td><td>${l.pago_em ? `<span class="pf-pill pf-ok">pago ${_ftData(l.pago_em)}</span>` : (l.estimado ? '<span class="pf-pill pf-in" title="Valor que veio da cotação (Calculador) e ninguém conferiu ainda — bolinha azul nos Custos Reais">estimado (cotação)</span>' : '<span class="pf-pill pf-ne">sem fatura</span>')}</td></tr>`).join('')
    + semFat.receber.map(l => `<tr><td style="overflow-wrap:anywhere;">${_pfE(l.label)} <span class="pf-pill pf-in">cobrado à parte</span></td><td style="overflow-wrap:anywhere;">${l.de ? _pfE(l.de) : '<span style="color:var(--warn);">falta "Receber de"</span>'}${l.nf ? `<div class="cr-muted" style="font-size:10.5px;">NF ${_pfE(l.nf)}</div>` : ''}</td><td class="n">${_ftFmt(l.valor)}</td><td><span class="pf-pill pf-ne">sem fatura</span></td></tr>`).join('');
  const total = semFat.pagar.filter(l => !l.estimado).reduce((s, l) => s + l.valor, 0);
  const est = semFat.pagar.filter(l => l.estimado);
  return `<details class="pf-sec" ${n ? 'open' : ''}><summary><span>Custos lançados sem fatura (${n})</span><span class="cr-muted" style="font-weight:400;font-size:11.5px;">${n ? 'R$ ' + _ftFmt(total) + ' lançados' + (est.length ? ` · R$ ${_ftFmt(est.reduce((s, l) => s + l.valor, 0))} estimados pela cotação` : '') : 'tudo faturado'}</span></summary>
    <div class="pf-sec-corpo">${n ? `<div class="pf-dica">Taxas com valor nos Custos Reais que não estão em nenhuma fatura. Para virar fatura: preencha <b>Pagamos para</b> (e o documento) na aba Custos Reais e use <b>🧾 Gerar faturas dos custos</b> — ou registre a fatura recebida em PDF, que liga as taxas sozinha.</div>
      <div class="pf-rolar"><table class="pf-tab" style="table-layout:fixed;"><colgroup><col><col><col style="width:96px;"><col style="width:134px;"></colgroup><thead><tr><th>Taxa</th><th>Pagar para / receber de</th><th class="n">R$</th><th></th></tr></thead><tbody>${linhas}</tbody></table></div>
      <div class="pf-acoes"><button type="button" class="btn btn-outline" onclick="trocarAba('custosreais')">Abrir Custos Reais</button>${semFat.pagar.some(l => l.para) || semFat.receber.some(l => l.de) ? '<button type="button" class="btn btn-outline" onclick="crGerarFaturas()">🧾 Gerar faturas dos custos</button>' : ''}</div>`
      : '<div class="pf-dica">Todas as taxas lançadas nos Custos Reais estão em alguma fatura.</div>'}</div></details>`;
}

// ── Seção: extrato do processo ─────────────────────────────────────────────
function _pfOutrosExtrato(snap, pendentes, semFat){
  const outros = _pfCambiosFornecedor(snap);
  pendentes.forEach(x => {
    const desc = (x.tipo_receber === 'venda' ? 'A receber · ' : 'Adiantamento do cliente · ') + (x.documento || '');
    if(x.ja_recebido > 0) outros.push({ data: x.recebido_em, descricao: desc + ' (recebido, sem fatura)', valor: x.ja_recebido, sentido: 'entrada', realizado: true, grupo: 'receber' });
    const falta = Math.round(((x.operadora ? x.operadora.liquido : x.valor) - (x.ja_recebido || 0)) * 100) / 100;
    if(falta > 0) outros.push({ data: x.vencimento, descricao: desc, valor: falta, sentido: 'entrada', realizado: false, grupo: 'receber', vencida: !!(x.vencimento && x.vencimento < _ftHoje()) });
  });
  semFat.pagar.forEach(l => outros.push({ data: l.pago_em || null, descricao: (l.estimado ? 'Custo estimado na cotação · ' : 'Custo sem fatura · ') + l.label + (l.para ? ' · ' + l.para : ''), valor: l.valor, sentido: 'saida', realizado: !!l.pago_em, grupo: 'custo' }));
  semFat.receber.forEach(l => outros.push({ data: null, descricao: 'Cobrança à parte sem fatura · ' + l.label + (l.de ? ' · ' + l.de : ''), valor: l.valor, sentido: 'entrada', realizado: false, grupo: 'custo' }));
  return outros;
}
function _pfSecExtrato(p, snap, pendentes, semFat, cambio, hoje){
  const ex = FaturasCore.extratoProcesso({ processo_id: p.id, faturas: _pfFaturas, outros: _pfOutrosExtrato(snap, pendentes, semFat), abater: _pfAbaterPrevisto() }, hoje, cambio);
  const linhas = ex.linhas.filter(l => _pfVerPrevisto || l.realizado);
  // com os previstos escondidos, o saldo acumulado é só do realizado
  let acum = 0;
  const html = linhas.map(l => {
    const sinal = l.sentido === 'entrada' ? 1 : -1;
    acum = Math.round((acum + sinal * l.valor) * 100) / 100;
    const saldo = _pfVerPrevisto ? l.saldo : acum;
    const tag = l.realizado ? '' : (l.vencida ? ' <span class="pf-pill pf-er">vencido</span>' : ' <span class="pf-pill pf-ne">previsto</span>');
    return `<tr class="${l.realizado ? '' : 'pf-prev'}"><td>${_ftData(l.data)}</td><td>${_pfE(l.descricao)}${tag}${l.compensacao && l.valor_compensado ? ` <span class="cr-muted">(R$ ${_ftFmt(l.valor_compensado)})</span>` : ''}</td><td class="n pf-pos">${l.sentido === 'entrada' && l.valor ? _ftFmt(l.valor) : ''}</td><td class="n pf-neg">${l.sentido === 'saida' && l.valor ? _ftFmt(l.valor) : ''}</td><td class="n ${saldo < 0 ? 'pf-neg' : ''}">${saldo < 0 ? '−' : ''}${_ftFmt(Math.abs(saldo))}</td></tr>`;
  }).join('');
  const sd = ex.sem_data;
  const t = ex.totais;
  const semDataHtml = sd.length ? `<details style="margin-top:8px;"><summary class="cr-link" style="cursor:pointer;font-size:12px;">Sem data (${sd.length}): entra R$ ${_ftFmt(t.sem_data.entradas)} · sai R$ ${_ftFmt(t.sem_data.saidas)}</summary>
      <table class="pf-tab" style="margin-top:4px;"><tbody>${sd.map(l => `<tr class="pf-prev"><td>${_pfE(l.descricao)}</td><td class="n pf-pos">${l.sentido === 'entrada' ? _ftFmt(l.valor) : ''}</td><td class="n pf-neg">${l.sentido === 'saida' ? _ftFmt(l.valor) : ''}</td></tr>`).join('')}</tbody></table></details>` : '';
  const sinal = v => (v < 0 ? '−R$ ' : 'R$ ') + _ftFmt(Math.abs(v));
  return `<details class="pf-sec" open><summary><span>Extrato do processo</span><span class="cr-muted" style="font-weight:400;font-size:11.5px;">realizado ${sinal(t.realizado.saldo)}</span></summary>
    <div class="pf-sec-corpo">
      <div class="pf-dica">O dinheiro do processo por data, como um extrato de banco: câmbio pago ao fornecedor, faturas pagas e recebidas, adiantamentos e parcelas do cliente. Em cinza o que ainda está previsto. Saldo negativo = a IMPAK está com dinheiro investido no processo.
        <label style="margin-left:8px;white-space:nowrap;"><input type="checkbox" ${_pfVerPrevisto ? 'checked' : ''} onchange="_pfVerPrevisto=this.checked;pfRedesenhar()"> mostrar previstos</label></div>
      ${linhas.length ? `<div class="pf-rolar"><table class="pf-tab" style="table-layout:fixed;"><colgroup><col style="width:74px;"><col><col style="width:88px;"><col style="width:88px;"><col style="width:96px;"></colgroup><thead><tr><th>Data</th><th>Lançamento</th><th class="n">Entrada</th><th class="n">Saída</th><th class="n">Saldo</th></tr></thead><tbody>${html}</tbody></table></div>` : '<div class="pf-dica">Ainda não há movimento com data neste processo.</div>'}
      ${semDataHtml}
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12.5px;">
        <span>Realizado até hoje <b class="${t.realizado.saldo < 0 ? 'pf-neg' : ''}">${sinal(t.realizado.saldo)}</b> <span class="cr-muted">(entrou ${_ftFmt(t.realizado.entradas)} · saiu ${_ftFmt(t.realizado.saidas)})</span></span>
        <span>Com o previsto <b class="${t.saldo_com_previsto < 0 ? 'pf-neg' : ''}">${sinal(t.saldo_com_previsto)}</b></span>
        ${sd.length ? `<span>Com tudo (inclui sem data) <b class="${t.saldo_final < 0 ? 'pf-neg' : ''}">${sinal(t.saldo_final)}</b></span>` : ''}
      </div>
    </div></details>`;
}

// ── Ações ──────────────────────────────────────────────────────────────────
// Fatura recebida em PDF: a mesma leitura da tela Faturas (IA), já ligada a
// este processo quando o documento não cita outro. Ao salvar, a conferência
// fica gravada na fatura.
function pfLerFaturaRecebida(){
  if(!_editando || !_editando.id) return;
  window._ftProcessoContexto = { id: _editando.id, referencia: _editando.referencia };
  if(typeof ftLerDocumento === 'function') ftLerDocumento();
}
async function pfConferir(id){
  showToast('Conferindo a fatura com o sistema…', 'ok');
  const r = await _ftRegistrarConferencia(id);
  if(r && r.ok){
    const n = r.conferencia ? r.conferencia.divergencias : 0;
    showToast(n ? `Conferida: ${n} diferença${n === 1 ? '' : 's'} — veja na fatura.` : 'Conferida: tudo bate com o sistema.', n ? 'warn' : 'ok');
  }
  pfRecarregar();
}
function pfAnexar(id){
  _ftEscolherArquivo(async arq => {
    try{ await _ftEnviarAnexo(id, arq, 'fatura'); showToast('Documento anexado à fatura.', 'ok'); pfRecarregar(); }
    catch(e){ showToast('Não anexou: ' + e.message, 'err'); }
  });
}
function pfBaixa(id){
  if(typeof ftBaixa === 'function') ftBaixa(id);
}
// A receber deste processo que ainda não virou fatura: mesma tela (e mesma
// gravação) do "Gerar a receber" da tela Faturas, só com este processo.
function pfGerarReceber(){
  if(!_editando) return;
  const lista = _pfReceberPendentes(_pfSnapshot(_editando));
  if(!lista.length){ showToast('Nada a gerar — o a receber deste processo já está em faturas.', 'ok'); return; }
  window._ftRecPend = lista;
  const ov = _ftOverlay();
  ov.innerHTML = `<div class="ft-modal-bg" onclick="if(event.target===this) ftFecharModal()"><div class="ft-modal" style="max-width:920px;">
    <div class="ft-modal-head"><span>↘ A receber de ${_pfE(_editando.referencia || '')}</span><button class="btn btn-outline" onclick="ftFecharModal()">✕</button></div>
    <div class="ft-modal-body">
      <div class="cr-muted" style="margin-bottom:8px;">${FaturasCore.clienteAdiantaCambio(_editando) ? 'Adiantamentos de câmbio (US$ × câmbio fechado) e a NF de venda com o adiantamento descontado, uma fatura por parcela do prazo.' : 'NF de venda, uma fatura por parcela do prazo (importação própria: câmbio não é a receber do cliente).'} Ajuste valor e vencimento se o cliente paga diferente. A baixa da fatura atualiza o "recebido" no processo.</div>
      <div style="max-height:420px;overflow:auto;"><table class="ft-itens" style="width:100%;"><thead><tr><th></th><th>Origem</th><th>Cliente</th><th>Venc.</th><th style="text-align:right;">Valor R$</th><th>Já recebido</th></tr></thead><tbody>
        ${lista.map((x, i) => `<tr><td><input type="checkbox" class="ft-rp-ck" data-i="${i}" checked></td>
          <td>${_pfE(x.documento)}${x.tipo_receber === 'venda' && x.adiantamento_abatido > 0 ? `<div class="cr-muted" style="font-size:10.5px;">já descontado o adiantamento de R$ ${_ftFmt(x.adiantamento_abatido)}</div>` : ''}${x.prazo_incerto ? '<div style="font-size:10.5px;color:var(--warn);">⚠ prazo não reconhecido — confira o vencimento</div>' : ''}</td><td>${_pfE(x.empresa_nome || '—')}</td>
          <td><input class="form-input ft-rp-venc" data-i="${i}" type="date" value="${_pfE(x.vencimento || '')}" style="padding:3px 6px;font-size:11px;"></td>
          <td style="text-align:right;"><input class="form-input ft-rp-val" data-i="${i}" value="${_ftFmt(x.valor)}" style="width:110px;text-align:right;padding:3px 6px;" inputmode="decimal"></td>
          <td style="font-size:11px;">${x.ja_recebido > 0 ? `R$ ${_ftFmt(x.ja_recebido)}${x.recebido_em ? ' em ' + _ftData(x.recebido_em) : ''}` : '—'}</td></tr>`).join('')}
      </tbody></table></div>
    </div>
    <div class="ft-modal-foot"><button class="btn btn-outline" onclick="ftFecharModal()">Fechar</button><button class="btn btn-primary" onclick="ftCriarReceber()">Criar faturas marcadas</button></div>
  </div></div>`;
}

// ── Selo na lista de processos ─────────────────────────────────────────────
let _faturasResumoPromise = null;
async function carregarResumoFaturas(fresh){
  // mudou alguma fatura: a Agenda (tarefas de fatura) relê na próxima vez
  if(fresh && typeof _agInvalidarFaturas === 'function') _agInvalidarFaturas();
  if(typeof FaturasCore === 'undefined') return;
  if(_faturasResumoPromise && !fresh) return _faturasResumoPromise;
  _faturasResumoPromise = (async () => {
    try{
      const d = await (await fetch('/api/faturas/resumo-processos' + (fresh ? '?fresh=1' : ''))).json();
      if(!d || !d.ok) return;
      _faturasResumo = d.resumo || {};
      const tb = document.getElementById('table-body');
      if(tb && tb.offsetParent && typeof render === 'function') render();
    }catch(e){ /* sem selo, sem problema */ }
  })();
  return _faturasResumoPromise;
}
function seloFaturasHtml(p){
  if(!p || typeof FaturasCore === 'undefined') return '';
  const s = FaturasCore.seloProcesso(_faturasResumo[p.id]);
  if(!s) return '';
  const cor = s.nivel === 'erro' ? 'background:var(--err-bg);border-color:rgba(220,38,38,.35);color:var(--err);'
    : s.nivel === 'aviso' ? 'background:var(--warn-bg);border-color:rgba(180,83,9,.35);color:var(--warn);'
    : 'background:var(--ok-bg);border-color:rgba(21,128,61,.35);color:var(--ok);';
  return `<span title="Faturas — ${_pfE(s.titulo)}" style="font-size:9px;font-weight:700;border:1px solid;border-radius:4px;padding:1px 6px;margin-left:4px;${cor}">🧾 ${_pfE(s.texto)}</span>`;
}
// Uma vez depois que a tela carregou (só onde a lista de processos aparece)
setTimeout(() => { const tb = document.getElementById('table-body'); if(tb && tb.offsetParent) carregarResumoFaturas(); }, 2500);
