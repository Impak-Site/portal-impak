// controle-faturas.js — Faturas (contas a pagar / a receber), 14/10/2026.
//
// Duas partes:
//  1. "Gerar faturas" na aba Custos Reais do processo: agrupa as linhas da
//     grade por empresa + documento (faturas-core.js) e cria as faturas.
//  2. Tela /faturas (Financeiro): lista, filtros, totais, marcar paga,
//     reabrir, cancelar. Mesmo padrão de tela exclusiva da Agenda.
// Regras puras em faturas-core.js (testes_faturas.js).

const _ftFiltro = { tipo: '', status: 'aberta', busca: '', de: '', ate: '', conta: '' };
let _ftLista = [];
let _ftSel = new Set(); // faturas marcadas pra baixa em lote
let _crFaturas = {};   // fatura_id → fatura (do processo aberto) pra badge na grade

function _ftHoje(){ return new Date().toISOString().slice(0, 10); }
function _ftFmt(v){ return (parseFloat(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function _ftSimb(m){ return m === 'USD' ? 'US$' : m === 'EUR' ? '€' : 'R$'; }
function _ftData(s){ if(!s) return '—'; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? `${m[3]}/${m[2]}/${m[1]}` : s; }
function _ftOverlay(){
  let el = document.getElementById('faturas-overlay');
  if(!el){ el = document.createElement('div'); el.id = 'faturas-overlay'; document.body.appendChild(el); }
  return el;
}
function ftFecharModal(){ const el = document.getElementById('faturas-overlay'); if(el) el.innerHTML = ''; }
document.addEventListener('keydown', e => { if(e.key === 'Escape'){ const el = document.getElementById('faturas-overlay'); if(el && el.innerHTML.trim()){ ftFecharModal(); e.stopImmediatePropagation(); } } }, true);

// ── 1. Gerar faturas a partir da aba Custos Reais ──────────────────────
// Monta as linhas candidatas lendo o formulário atual (não o salvo), pra
// pegar o que a pessoa acabou de digitar. Pagar = linhas com valor pago e
// "Pagamos para"; Receber = linhas cobradas à parte com "Receber de".
function crLinhasParaFaturas(){
  if(!_editando) return [];
  const obj = coletarCustosReaisDoForm();
  const meta = obj._meta || {};
  const snapshot = { ..._editando, real_json: obj };
  const linhas = [];
  custosReaisItensFlat().forEach(item => {
    const m = meta[item.id] || {};
    const pago = valorMoedaInicial(obj[item.id], item);
    if(m.para && pago && pago.valor !== '' && parseFloat(pago.valor) > 0 && !(obj[item.id] && obj[item.id].porContainer)){
      linhas.push({ taxa: item.id, label: item.label, lado: 'pagar', empresa: m.para, empresa_id: m.para_id || null, documento: m.doc || '', valor: parseFloat(pago.valor), moeda: pago.moeda || 'BRL', processo_id: _editando.id, referencia: _editando.referencia, pago_em: m.pago_em || null, ja_faturada: !!m.fatura_id });
    } else if(m.para && obj[item.id] && obj[item.id].porContainer){
      const n = normalizarValorRealItem(obj[item.id], item, snapshot);
      if(n && n.totalBrl > 0) linhas.push({ taxa: item.id, label: item.label, lado: 'pagar', empresa: m.para, empresa_id: m.para_id || null, documento: m.doc || '', valor: n.totalBrl, moeda: 'BRL', processo_id: _editando.id, referencia: _editando.referencia, pago_em: m.pago_em || null, ja_faturada: !!m.fatura_id });
    }
    const cob = valorMoedaInicial(obj[item.id + '_cobrado'], item);
    if(!item.apenasPago && m.de && cob && cob.valor !== '' && parseFloat(cob.valor) > 0){
      linhas.push({ taxa: item.id + '_cobrado', label: item.label, lado: 'receber', empresa: m.de, empresa_id: m.de_id || null, documento: m.nf || '', valor: parseFloat(cob.valor), moeda: cob.moeda || 'BRL', processo_id: _editando.id, referencia: _editando.referencia, ja_faturada: !!((meta[item.id + '_cobrado'] || {}).fatura_id) });
    }
  });
  return linhas;
}

function crGerarFaturas(){
  if(!_editando) return;
  if(typeof FaturasCore === 'undefined'){ showToast('faturas-core.js não carregou — atualize a página.', 'err'); return; }
  const todas = crLinhasParaFaturas();
  const linhas = todas.filter(l => !l.ja_faturada);
  const { faturas, semEmpresa } = FaturasCore.agruparLinhasEmFaturas(linhas);
  const jaFaturadas = todas.length - linhas.length;
  const ov = _ftOverlay();
  const lista = faturas.map((f, i) => `
    <div class="ft-cand" id="ft_cand_${i}">
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
        <input type="checkbox" id="ft_ck_${i}" checked>
        <span class="ft-tag ${f.tipo}">${f.tipo === 'pagar' ? 'A PAGAR' : 'A RECEBER'}</span>
        <strong style="flex:1;">${esc(f.empresa_nome)}</strong>
        <span style="font-family:'JetBrains Mono',monospace;">${_ftSimb(f.moeda)} ${_ftFmt(f.valor)}</span>
      </label>
      <div class="ft-cand-campos">
        <label>Documento <input class="form-input" id="ft_doc_${i}" value="${esc(f.documento || '')}" placeholder="nº fatura / DARF / NF"></label>
        <label>Vencimento <input class="form-input" type="date" id="ft_venc_${i}" value="${esc(f.vencimento || '')}"></label>
        <label>Pago em <input class="form-input" type="date" id="ft_pago_${i}" value="${esc(f.pago_em || '')}" title="Preencha só se já foi pago — a fatura nasce como paga"></label>
      </div>
      <div class="cr-muted" style="margin-top:4px;">${f.itens.map(it => `${esc(it.label)} ${_ftSimb(it.moeda)} ${_ftFmt(it.valor)}`).join(' · ')}</div>
    </div>`).join('');
  ov.innerHTML = `<div class="ft-modal-bg" onclick="if(event.target===this) ftFecharModal()">
    <div class="ft-modal">
      <div class="ft-modal-head"><span>Gerar faturas — ${esc(_editando.referencia || '')}</span><button class="btn btn-outline" onclick="ftFecharModal()">✕</button></div>
      <div class="ft-modal-body">
        ${faturas.length ? `<div class="cr-muted" style="margin-bottom:10px;">Agrupei por empresa + documento + moeda. Desmarque o que não deve virar fatura agora; documento e vencimento podem ser ajustados depois na tela Faturas.</div>${lista}`
          : `<div class="cr-muted">Nenhuma linha pronta pra virar fatura. Preencha <strong>Pagamos para</strong> (e o valor) nas taxas pagas, ou <strong>Receber de</strong> nas cobradas à parte.</div>`}
        ${semEmpresa.length ? `<div class="cr-muted" style="margin-top:10px;">Sem empresa (não entram): ${semEmpresa.map(l => esc(l.label)).join(', ')}.</div>` : ''}
        ${jaFaturadas ? `<div class="cr-muted" style="margin-top:6px;">${jaFaturadas} linha${jaFaturadas === 1 ? '' : 's'} já ${jaFaturadas === 1 ? 'está' : 'estão'} em fatura — não entram de novo.</div>` : ''}
      </div>
      <div class="ft-modal-foot">
        <button class="btn btn-outline" onclick="ftFecharModal()">Cancelar</button>
        ${faturas.length ? `<button class="btn btn-primary" id="ft_btn_gerar" onclick="crConfirmarGerarFaturas()">Gerar ${faturas.length} fatura${faturas.length === 1 ? '' : 's'}</button>` : ''}
      </div>
    </div></div>`;
  window._ftCandidatas = faturas;
}

async function crConfirmarGerarFaturas(){
  const cands = window._ftCandidatas || [];
  const enviar = [];
  cands.forEach((f, i) => {
    const ck = document.getElementById('ft_ck_' + i);
    if(!ck || !ck.checked) return;
    const cx = (typeof cambioParaTotais === 'function') ? cambioParaTotais() : {};
    enviar.push({ ...f, cambio: f.moeda === 'BRL' ? 1 : (parseFloat(cx[f.moeda]) || null), documento: (document.getElementById('ft_doc_' + i) || {}).value || null, vencimento: (document.getElementById('ft_venc_' + i) || {}).value || null, pago_em: (document.getElementById('ft_pago_' + i) || {}).value || null });
  });
  if(!enviar.length){ showToast('Nenhuma fatura marcada.', 'warn'); return; }
  const btn = document.getElementById('ft_btn_gerar'); if(btn){ btn.disabled = true; btn.textContent = 'Gerando…'; }
  try{
    // garante que o descritivo (pra quem/documento) está salvo antes — a
    // fatura aponta pras linhas pelo id da taxa
    if(typeof salvarCustosReaisTab === 'function') await salvarCustosReaisTab();
    const r = await fetch('/api/faturas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ faturas: enviar }) });
    const d = await r.json();
    if(!d.ok){ showToast(d.semTabela ? 'Tabela de faturas ainda não existe no banco (migration 0050).' : (d.erro || 'Erro ao gerar faturas'), 'err'); if(btn){ btn.disabled = false; btn.textContent = 'Gerar'; } return; }
    showToast(`${d.faturas.length} fatura${d.faturas.length === 1 ? '' : 's'} gerada${d.faturas.length === 1 ? '' : 's'}.`, 'ok');
    ftFecharModal();
    // o servidor gravou fatura_id em real_json._meta — recarrega o processo aberto
    if(_editando && _editando.id){
      try{ const rp = await fetch('/api/controle/v2/processo/' + encodeURIComponent(_editando.id)); const dp = await rp.json(); const p = dp.processo || dp; if(p && p.real_json){ _editando.real_json = p.real_json; const i = (_processos || []).findIndex(x => x.id === p.id); if(i >= 0) _processos[i].real_json = p.real_json; } }catch(e){}
      await crCarregarFaturas(_editando.id);
      if(typeof crRerender === 'function') crRerender();
    }
  }catch(e){ showToast('Erro de rede ao gerar faturas', 'err'); if(btn){ btn.disabled = false; btn.textContent = 'Gerar'; } }
}

// Faturas do processo aberto (pra badge "fatura aberta/paga" na grade).
async function crCarregarFaturas(processoId){
  _crFaturas = {};
  if(typeof _crFaturasCarregadasPara !== 'undefined') _crFaturasCarregadasPara[processoId] = true;
  if(!processoId) return;
  try{
    const r = await fetch('/api/faturas?processo_id=' + encodeURIComponent(processoId));
    const d = await r.json();
    if(d.ok) (d.faturas || []).forEach(f => { _crFaturas[f.id] = f; });
  }catch(e){}
  if(typeof atualizarTotalCustosReais === 'function') atualizarTotalCustosReais();
}
function crBadgeFatura(faturaId){
  const f = faturaId && _crFaturas[faturaId];
  if(!f) return faturaId ? '<span class="ft-badge" title="Fatura vinculada">fatura</span>' : '';
  const cls = f.status === 'paga' ? 'paga' : f.status === 'cancelada' ? 'cancelada' : (f.vencimento && f.vencimento < _ftHoje() ? 'vencida' : 'aberta');
  const txt = f.status === 'paga' ? `paga ${_ftData(f.pago_em)}` : f.status === 'cancelada' ? 'fatura cancelada' : (f.vencimento ? `vence ${_ftData(f.vencimento)}` : 'fatura aberta');
  return `<a class="ft-badge ${cls}" href="/faturas?busca=${encodeURIComponent(f.documento || f.empresa_nome || '')}" target="_blank" title="${esc(f.empresa_nome)}${f.documento ? ' · ' + esc(f.documento) : ''} · ${_ftSimb(f.moeda)} ${_ftFmt(f.valor)}">${txt}</a>`;
}

// ── 2. Tela /faturas ───────────────────────────────────────────────────
function ativarTelaFaturasExclusiva(){
  document.title = 'ImpakOS - Controle financeiro';
  const titulo = document.querySelector('.topbar-title'); if(titulo) titulo.textContent = 'Controle financeiro';
  ['stats-grid','filtro-financeiro-ativo','filtro-data-bar','fase-filter'].forEach(id => { const e = document.getElementById(id); if(e) e.style.display = 'none'; });
  const toolbar = document.querySelector('.toolbar'); if(toolbar) toolbar.style.display = 'none';
  const sidebar = document.querySelector('.sidebar'); if(sidebar) sidebar.style.display = 'none';
  const tw = document.querySelector('.table-wrap'); if(tw) tw.style.display = 'none';
  const pag = document.getElementById('paginacao'); if(pag) pag.style.display = 'none';
  const d = document.getElementById('dash-faturas'); if(d) d.style.display = 'block';
  const busca = new URLSearchParams(location.search).get('busca'); if(busca) _ftFiltro.busca = busca;
  if(busca) _ftFiltro.status = '';
  renderDashFaturas();
}

async function _ftCarregar(){
  const q = new URLSearchParams();
  if(_ftFiltro.tipo) q.set('tipo', _ftFiltro.tipo);
  if(_ftFiltro.status) q.set('status', _ftFiltro.status);
  if(_ftFiltro.de) q.set('de', _ftFiltro.de);
  if(_ftFiltro.ate) q.set('ate', _ftFiltro.ate);
  if(_ftFiltro.busca) q.set('empresa', _ftFiltro.busca);
  const r = await fetch('/api/faturas?' + q.toString());
  const d = await r.json();
  if(!d.ok) throw new Error(d.semTabela ? 'Tabela de faturas ainda não existe (migration 0050).' : (d.erro || 'erro'));
  return d.faturas || [];
}

async function renderDashFaturas(){
  const el = document.getElementById('dash-faturas-content');
  if(!el) return;
  if(typeof finCadastros === 'function') await finCadastros();
  if(typeof _finAba !== 'undefined' && _finAba !== 'faturas') return renderFinAba(el);
  el.innerHTML = (typeof finTabsHtml === 'function' ? finTabsHtml() : '') + '<div class="cr-muted">Carregando…</div>';
  try{ _ftLista = await _ftCarregar(); }catch(e){ el.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const semClass = _ftLista.filter(f => f.status !== 'cancelada' && FinCore.precisaClassificar(f)).length;
  if(_ftFiltro.conta === '_sem') _ftLista = _ftLista.filter(f => FinCore.precisaClassificar(f));
  else if(_ftFiltro.conta) _ftLista = _ftLista.filter(f => f.conta_id === _ftFiltro.conta);
  const hoje = _ftHoje();
  const cambio = (typeof cambioParaTotais === 'function') ? cambioParaTotais() : {};
  // Resumo sempre sobre TODAS as não canceladas (independe do filtro de status)
  let base = _ftLista;
  if(_ftFiltro.status){ try{ const t = _ftFiltro; _ftFiltro.status = ''; base = await _ftCarregar(); _ftFiltro.status = t.status; }catch(e){ base = _ftLista; } }
  const r = FaturasCore.resumoFaturas(base, hoje, cambio);
  const card = (l, v, cor, sub) => `<div class="ft-card" style="border-left:4px solid ${cor};"><div class="ft-card-l">${l}</div><div class="ft-card-v">R$ ${_ftFmt(v)}</div>${sub ? `<div class="cr-muted">${sub}</div>` : ''}</div>`;
  const cards = `<div class="ft-cards">
    ${card('A pagar em aberto', r.pagar_aberto, 'var(--ac)', r.pagar_vencido ? `<span style="color:var(--err);font-weight:600;">R$ ${_ftFmt(r.pagar_vencido)} vencido</span>` : 'nada vencido')}
    ${card('A receber em aberto', r.receber_aberto, 'var(--ok)', r.receber_vencido ? `<span style="color:var(--err);font-weight:600;">R$ ${_ftFmt(r.receber_vencido)} vencido</span>` : 'nada vencido')}
    ${card('Pago no mês', r.pago_mes, 'var(--muted)', hoje.slice(0, 7).split('-').reverse().join('/'))}
    ${card('Recebido no mês', r.recebido_mes, 'var(--muted)', hoje.slice(0, 7).split('-').reverse().join('/'))}
  </div>${r.sem_cambio ? `<div style="background:#fffaeb;border:1px solid #fedf89;border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:12.5px;color:#8a5a00;">⚠ ${r.sem_cambio} fatura${r.sem_cambio === 1 ? '' : 's'} em moeda estrangeira sem câmbio (nem da fatura, nem a cotação do dia) — ${r.sem_cambio === 1 ? 'ficou' : 'ficaram'} fora dos totais em R$. Abra a fatura e informe o câmbio.</div>` : ''}`;
  const filtros = `<div class="ft-filtros">
    <select class="form-input" onchange="_ftFiltro.tipo=this.value;renderDashFaturas()"><option value="">Pagar + receber</option><option value="pagar" ${_ftFiltro.tipo === 'pagar' ? 'selected' : ''}>A pagar</option><option value="receber" ${_ftFiltro.tipo === 'receber' ? 'selected' : ''}>A receber</option></select>
    <select class="form-input" onchange="_ftFiltro.status=this.value;renderDashFaturas()"><option value="aberta" ${_ftFiltro.status === 'aberta' ? 'selected' : ''}>Abertas</option><option value="paga" ${_ftFiltro.status === 'paga' ? 'selected' : ''}>Pagas</option><option value="cancelada" ${_ftFiltro.status === 'cancelada' ? 'selected' : ''}>Canceladas</option><option value="" ${_ftFiltro.status === '' ? 'selected' : ''}>Todas</option></select>
    <input class="form-input" placeholder="empresa ou documento" value="${esc(_ftFiltro.busca)}" onchange="_ftFiltro.busca=this.value.trim();renderDashFaturas()">
    <label class="cr-muted">venc. de <input class="form-input" type="date" value="${esc(_ftFiltro.de)}" onchange="_ftFiltro.de=this.value;renderDashFaturas()"></label>
    <label class="cr-muted">até <input class="form-input" type="date" value="${esc(_ftFiltro.ate)}" onchange="_ftFiltro.ate=this.value;renderDashFaturas()"></label>
    <select class="form-input" style="max-width:230px;" onchange="_ftFiltro.conta=this.value;renderDashFaturas()" title="Classificação"><option value="">Todas as classificações</option><option value="_sem" ${_ftFiltro.conta === '_sem' ? 'selected' : ''}>⚠ Sem classificação</option>${(_fin && _fin.contas || []).filter(c => c.ativo !== false).map(c => `<option value="${c.id}" ${_ftFiltro.conta === c.id ? 'selected' : ''}>${esc(c.codigo + ' ' + c.nome)}</option>`).join('')}</select>
    <button class="btn btn-primary" onclick="ftLerDocumento()" title="Envie a fatura, boleto, nota ou DARF em PDF/imagem — a IA preenche os campos pra você conferir">🧾 Ler fatura (PDF) com IA</button>
    <button class="btn btn-outline" onclick="ftComprovanteSolto()" title="Envie o comprovante (PIX, TED, boleto pago, câmbio) — a IA acha a(s) fatura(s) e prepara a baixa">📎 Baixa por comprovante</button>
    <button class="btn btn-outline" id="ft_btn_lote" onclick="ftBaixaLote()" title="Marque as faturas na lista e dê baixa de todas com um único pagamento" ${_ftSel.size ? '' : 'disabled'}>💰 Baixa em lote${_ftSel.size ? ' (' + _ftSel.size + ')' : ''}</button>
    <button class="btn btn-outline" onclick="ftConciliarExtrato()" title="Importe o extrato do banco (OFX ou CSV) e dê baixa casando cada lançamento com a fatura">🏦 Conciliar extrato</button>
    <button class="btn btn-outline" onclick="ftReceberPendentes()" title="Gera faturas a receber das parcelas de câmbio fechadas e das vendas (NF) dos processos, sem digitar e sem duplicar">↘ Gerar a receber</button>
    <button class="btn btn-outline" onclick="ftExportarExcel()" title="Planilha com as faturas e todos os pagamentos (pra conferência / lançamento em outro sistema)">⬇ Excel</button>
    <button class="btn btn-outline" onclick="ftNovaManual()" title="Conta a pagar ou a receber digitada à mão (aluguel, folha, imposto, sistemas… ou qualquer fatura)">+ Novo lançamento</button>
  </div>`;
  const sit = { vencida: ['Vencida', 'var(--err)'], hoje: ['Vence hoje', 'var(--warn,#b45309)'], semana: ['Esta semana', 'var(--warn,#b45309)'], a_vencer: ['A vencer', 'var(--muted)'], sem_vencimento: ['Sem vencimento', 'var(--muted)'], paga: ['Paga', 'var(--ok)'], cancelada: ['Cancelada', 'var(--dim)'] };
  const linhas = _ftLista.map(f => {
    const s = FaturasCore.situacao(f, hoje);
    const refs = [...new Set((f.itens || []).map(it => it.referencia).filter(Boolean))];
    const fator = f.moeda === 'BRL' ? 1 : (parseFloat(f.cambio) || parseFloat(cambio[f.moeda]) || 0);
    const itensHtml = (f.itens || []).length ? `<table class="ft-itens"><thead><tr><th>Processo</th><th>Taxa</th><th>Moeda</th><th style="text-align:right;">Valor</th><th style="text-align:right;">Fator</th><th style="text-align:right;">Em R$</th></tr></thead><tbody>${f.itens.map(it => `<tr><td>${esc(it.referencia || '—')}</td><td>${esc(it.label || it.taxa || '')}</td><td>${esc(it.moeda || f.moeda)}</td><td style="text-align:right;">${_ftFmt(it.valor)}</td><td style="text-align:right;">${fator ? fator.toFixed(4).replace('.', ',') : '—'}</td><td style="text-align:right;">${fator ? _ftFmt((parseFloat(it.valor) || 0) * fator) : '—'}</td></tr>`).join('')}</tbody></table>` : '<div class="cr-muted">Sem itens (fatura avulsa).</div>';
    return `<tr class="ft-row" onclick="ftToggleItens('${f.id}', event)">
      <td>${f.status === 'aberta' ? `<input type="checkbox" ${_ftSel.has(f.id) ? 'checked' : ''} onclick="event.stopPropagation();ftSelecionar('${f.id}', this.checked)" title="Selecionar pra baixa em lote">` : ''}</td>
      <td><span class="ft-tag ${f.tipo}">${f.tipo === 'pagar' ? 'PAGAR' : 'RECEBER'}</span><div class="cr-muted" style="font-family:'JetBrains Mono',monospace;">${esc(f.numero || '')}</div></td>
      <td><strong>${esc(f.empresa_nome)}</strong>${f.empresa_id ? ' <span class="cr-vinc" style="position:static;" title="Vinculada ao cadastro">●</span>' : ''}<div class="cr-muted">${(f.itens || []).length} ${(f.itens || []).length === 1 ? 'taxa' : 'taxas'} · ref. ${_ftData(f.emissao || (f.created_at || '').slice(0, 10))}${f.conta_id && _fin ? (c => c ? ` · <span style="background:#eef2ff;color:#3538cd;border-radius:6px;padding:0 6px;">${esc(c.nome)}</span>` : '')(_fin.contas.find(c => c.id === f.conta_id)) : (FinCore.precisaClassificar(f) && f.status !== 'cancelada' ? ' · <span style="color:#b54708;">⚠ sem classificação</span>' : '')}${f.moeda !== 'BRL' && fator ? ` · câmbio ${fator.toFixed(4).replace('.', ',')}` : ''}</div></td>
      <td>${esc(f.documento || '—')}</td>
      <td>${refs.map(r => `<a href="/controle/${encodeURIComponent(r)}" target="_blank">${esc(r)}</a>`).join(', ') || '—'}</td>
      <td>${_ftData(f.vencimento)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;white-space:nowrap;">${_ftSimb(f.moeda)} ${_ftFmt(f.valor)}</td>
      <td><span style="color:${sit[s][1]};font-weight:600;">${sit[s][0]}</span>${f.status === 'paga' ? `<div class="cr-muted">${_ftData(f.pago_em)}${f.valor_pago != null && Math.abs(f.valor_pago - f.valor) >= 0.01 ? ` · ${_ftSimb(f.moeda)} ${_ftFmt(f.valor_pago)}` : ''}</div>` : (f.status === 'aberta' && parseFloat(f.valor_pago) > 0 ? `<div style="font-size:11px;color:#8a5a00;font-weight:600;">Parcial · pago ${_ftSimb(f.moeda)} ${_ftFmt(f.valor_pago)} · saldo ${_ftFmt(FaturasCore.saldoFatura(f))}</div>` : '')}${_ftQtdArq(f) ? `<div class="cr-muted" title="Anexos e comprovantes">📎 ${_ftQtdArq(f)}</div>` : ''}${f.tipo === 'pagar' && f.status === 'aberta' ? (f.aprovacao ? `<div style="font-size:10.5px;color:var(--ok);" title="Aprovado por ${esc(f.aprovacao.nome || f.aprovacao.por || '')}">✔ aprovado</div>` : '<div style="font-size:10.5px;color:#8a5a00;">⏳ aguardando aprovação</div>') : ''}${f.origem ? `<div class="cr-muted" style="font-size:10.5px;">${f.origem.tipo === 'recorrencia' ? '🔁 recorrente' : '↘ ' + (f.origem.tipo === 'venda' ? 'venda' : 'câmbio') + ' ' + esc(f.origem.referencia || '')}</div>` : ''}</td>
      <td style="white-space:nowrap;">
        ${f.status === 'aberta' ? `<button class="btn btn-primary" style="padding:4px 10px;font-size:11px;" onclick="ftBaixa('${f.id}')" title="Registrar pagamento (total ou parcial) com comprovante">💰 Dar baixa</button> <button class="btn btn-outline" style="padding:4px 8px;font-size:11px;" onclick="ftEditar('${f.id}')">Editar</button> <button class="btn btn-outline" style="padding:4px 8px;font-size:11px;" onclick="ftCancelar('${f.id}')" title="Cancela (não apaga)">Cancelar</button>` : ''}
        ${f.status === 'paga' ? `<button class="btn btn-outline" style="padding:4px 8px;font-size:11px;" onclick="ftBaixa('${f.id}')" title="Ver pagamentos e comprovantes">📎 Pagamentos</button> <button class="btn btn-outline" style="padding:4px 8px;font-size:11px;" onclick="ftAcao('${f.id}','reabrir')">Reabrir</button>` : ''}
      </td></tr>
      <tr class="ft-itens-row" id="ft_itens_${f.id}" style="display:none;"><td colspan="9">${itensHtml}</td></tr>`;
  }).join('');
  // Rodapé = soma do "Em R$" de cada linha (câmbio da própria fatura; sem ele,
  // o do dia). Fatura em US$/€ sem câmbio fica FORA e é contada à parte —
  // antes entrava multiplicada por 1 quando a cotação não carregava.
  const _ftVisiveis = _ftLista.filter(f => f.status !== 'cancelada');
  const semCambioLista = _ftVisiveis.filter(f => !FaturasCore.fatorBRL(f, cambio)).length;
  const total = _ftVisiveis.reduce((s, f) => s + (parseFloat(f.valor) || 0) * FaturasCore.fatorBRL(f, cambio), 0);
  const avisoClass = semClass && _ftFiltro.conta !== '_sem' ? `<div style="background:#fffaeb;border:1px solid #fedf89;border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:12.5px;color:#8a5a00;">⚠ ${semClass} despesa${semClass === 1 ? '' : 's'} sem classificação (aparece${semClass === 1 ? '' : 'm'} como "despesas gerais" no DRE). <a class="cr-link" onclick="_ftFiltro.conta='_sem';renderDashFaturas()">Ver e classificar</a></div>` : '';
  el.innerHTML = (typeof finTabsHtml === 'function' ? finTabsHtml() : '') + cards + avisoClass + filtros + `<div class="ft-tabela-wrap"><table class="ft-tabela">
    <thead><tr><th style="width:22px;"></th><th>Tipo</th><th>Empresa · itens</th><th>Documento</th><th>Processo</th><th>Vencimento</th><th style="text-align:right;">Valor</th><th>Situação</th><th></th></tr></thead>
    <tbody>${linhas || `<tr><td colspan="9" class="cr-muted" style="padding:16px;">Nenhuma fatura com esses filtros.</td></tr>`}</tbody>
    <tfoot><tr><td colspan="6" style="text-align:right;">${_ftLista.length} fatura${_ftLista.length === 1 ? '' : 's'} · total em R$${semCambioLista ? ` <span style="color:#8a5a00;font-weight:600;">(${semCambioLista} sem câmbio, fora do total)</span>` : ''}</td><td style="text-align:right;font-family:'JetBrains Mono',monospace;">R$ ${_ftFmt(total)}</td><td colspan="2"></td></tr></tfoot>
  </table></div>`;
}

function ftToggleItens(id, ev){
  if(ev && ev.target && ev.target.closest('button, a')) return;
  const tr = document.getElementById('ft_itens_' + id);
  if(tr) tr.style.display = tr.style.display === 'none' ? 'table-row' : 'none';
}
function ftMarcarPaga(id){
  const f = _ftLista.find(x => x.id === id); if(!f) return;
  const ov = _ftOverlay();
  ov.innerHTML = `<div class="ft-modal-bg" onclick="if(event.target===this) ftFecharModal()"><div class="ft-modal" style="max-width:420px;">
    <div class="ft-modal-head"><span>Marcar como paga</span><button class="btn btn-outline" onclick="ftFecharModal()">✕</button></div>
    <div class="ft-modal-body">
      <div style="margin-bottom:10px;"><strong>${esc(f.empresa_nome)}</strong>${f.documento ? ' · ' + esc(f.documento) : ''}<br><span class="cr-muted">${_ftSimb(f.moeda)} ${_ftFmt(f.valor)} · venc. ${_ftData(f.vencimento)}</span></div>
      <div class="ft-cand-campos">
        <label>Pago em <input class="form-input" type="date" id="ft_pg_data" value="${_ftHoje()}"></label>
        <label>Valor pago <input class="form-input" id="ft_pg_valor" value="${_ftFmt(f.valor)}" inputmode="decimal"></label>
      </div>
    </div>
    <div class="ft-modal-foot"><button class="btn btn-outline" onclick="ftFecharModal()">Cancelar</button><button class="btn btn-primary" onclick="ftAcao('${f.id}','pagar',{pago_em:document.getElementById('ft_pg_data').value, valor_pago: parseValorMoeda(document.getElementById('ft_pg_valor').value)})">Confirmar</button></div>
  </div></div>`;
}
// ── Baixas, comprovantes e anexos ──────────────────────────────────────
let _ftArquivoIA = null;      // PDF da fatura lida pela IA (anexado ao salvar)
let _ftBaixaArquivo = null;   // comprovante escolhido no modal de baixa
const _FT_FORMAS = [['pix','PIX'],['ted','TED/DOC'],['boleto','Boleto'],['cambio','Câmbio'],['cartao','Cartão'],['compensacao','Compensação/encontro de contas'],['dinheiro','Dinheiro'],['outro','Outro']];
function _ftQtdArq(f){ return (f.anexos || []).length + (f.pagamentos || []).filter(p => p.comprovante && !(f.anexos || []).some(a => a.path === p.comprovante.path)).length; }
function _ftB64(arq){ return new Promise((ok, err) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.onerror = err; fr.readAsDataURL(arq); }); }
function _ftTipoArq(arq){ return arq.type || (arq.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : ''); }
function _ftEscolherArquivo(cb){
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.pdf,image/*'; inp.style.display = 'none';
  inp.onchange = () => { const a = inp.files && inp.files[0]; inp.remove(); if(a){ if(a.size > 15 * 1024 * 1024){ showToast('"' + a.name + '" tem ' + (a.size/1048576).toFixed(1).replace('.', ',') + ' MB — o limite é 15 MB por arquivo. Comprima o PDF ou divida em partes e envie de novo.', 'err'); return; } cb(a); } };
  document.body.appendChild(inp); inp.click();
}
async function _ftEnviarAnexo(faturaId, arq, tipo){
  const r = await fetch('/api/faturas/' + encodeURIComponent(faturaId) + '/anexo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ arquivo_base64: await _ftB64(arq), nome_arquivo: arq.name, media_type: _ftTipoArq(arq), tipo }) });
  const d = await r.json(); if(!d.ok) throw new Error(d.erro || 'erro'); return d.fatura;
}
async function ftAbrirArquivo(faturaId, path){
  try{
    const d = await (await fetch('/api/faturas/' + encodeURIComponent(faturaId) + '/arquivo?path=' + encodeURIComponent(path))).json();
    if(!d.ok){ showToast(d.erro || 'Não consegui abrir.', 'err'); return; }
    window.open(d.url, '_blank', 'noopener');
  }catch(e){ showToast('Erro de rede', 'err'); }
}

// Modal da baixa: histórico de pagamentos + anexos + nova baixa
function ftBaixa(id, pre){
  const f = _ftLista.find(x => x.id === id); if(!f) return;
  pre = pre || {};
  _ftBaixaArquivo = pre.arquivo || null;
  const saldo = FaturasCore.saldoFatura(f);
  const FORMA = Object.fromEntries(_FT_FORMAS);
  const pags = (f.pagamentos || []);
  const pagsHtml = pags.length ? `<table class="ft-itens" style="width:100%;"><thead><tr><th>Data</th><th>Forma</th><th style="text-align:right;">Valor</th><th>Detalhe</th><th>Comprovante</th><th></th></tr></thead><tbody>${pags.map(p => `<tr style="${p.estornado ? 'opacity:.5;text-decoration:line-through;' : ''}">
      <td>${_ftData(p.data)}</td><td>${esc(FORMA[p.forma] || p.forma || '')}${p.identificador ? `<div class="cr-muted" style="font-size:10px;">${esc(p.identificador)}</div>` : ''}${p.lote_id ? '<div class="cr-muted" style="font-size:10px;">lote</div>' : ''}</td>
      <td style="text-align:right;">${_ftSimb(f.moeda)} ${_ftFmt(p.valor)}</td>
      <td style="font-size:10.5px;">${_ftDetalhePag(p, f)}</td>
      <td>${p.comprovante ? `<a class="cr-link" onclick="ftAbrirArquivo('${f.id}','${esc(p.comprovante.path)}')">📎 ${esc(p.comprovante.nome || 'abrir')}</a>` : '<span class="cr-muted">—</span>'}</td>
      <td>${p.estornado ? `<span class="cr-muted" title="${esc((p.estornado.motivo || '') + ' · ' + (p.estornado.por || ''))}">estornado</span>` : `<a class="cr-link" onclick="ftEstornar('${f.id}','${p.id}')">estornar</a>`}</td></tr>`).join('')}</tbody></table>`
    : (f.status === 'paga' ? `<div class="cr-muted">Baixada em ${_ftData(f.pago_em)} (antes do registro de pagamentos).</div>` : '<div class="cr-muted">Nenhum pagamento ainda.</div>');
  const anexos = (f.anexos || []).filter(a => a.tipo !== 'comprovante');
  const anexosHtml = anexos.map(a => `<a class="cr-link" style="margin-right:10px;" onclick="ftAbrirArquivo('${f.id}','${esc(a.path)}')">📄 ${esc(a.nome || 'arquivo')}${a.tipo === 'fatura' ? ' (fatura)' : ''}</a>`).join('');
  const ov = _ftOverlay();
  ov.innerHTML = `<div class="ft-modal-bg" onclick="if(event.target===this) ftFecharModal()"><div class="ft-modal" style="max-width:640px;">
    <div class="ft-modal-head"><span>${f.status === 'aberta' ? '💰 Dar baixa' : '📎 Pagamentos'} — ${esc(f.numero || '')}</span><button class="btn btn-outline" onclick="ftFecharModal()">✕</button></div>
    <div class="ft-modal-body">
      <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:10px;">
        <div><strong>${esc(f.empresa_nome)}</strong>${f.documento ? ' · doc ' + esc(f.documento) : ''}<div class="cr-muted">venc. ${_ftData(f.vencimento)}</div></div>
        <div style="text-align:right;font-family:'JetBrains Mono',monospace;font-size:12px;">Total ${_ftSimb(f.moeda)} ${_ftFmt(f.valor)}<br>Pago ${_ftSimb(f.moeda)} ${_ftFmt(f.valor_pago || 0)}<br><b style="color:${saldo > 0 ? 'var(--err)' : 'var(--ok)'};">Saldo ${_ftSimb(f.moeda)} ${_ftFmt(saldo)}</b></div>
      </div>
      <div style="font-weight:600;font-size:12px;margin:6px 0 4px;">Pagamentos</div>
      ${pagsHtml}
      <div style="font-weight:600;font-size:12px;margin:12px 0 4px;">Documentos anexados</div>
      <div>${anexosHtml || '<span class="cr-muted">nenhum</span>'} <a class="cr-link" onclick="ftAnexarDoc('${f.id}')">+ anexar documento</a></div>
      ${f.tipo === 'pagar' ? `<div style="margin-top:10px;font-size:12px;">${f.aprovacao ? `✔ Pagamento aprovado por <b>${esc(f.aprovacao.nome || f.aprovacao.por || '')}</b> em ${_ftData((f.aprovacao.em || '').slice(0, 10))}` : '⏳ Pagamento ainda não aprovado'}${_ftSouGerente() && f.status === 'aberta' ? ` · <a class="cr-link" onclick="ftAprovar('${f.id}', ${f.aprovacao ? 'true' : 'false'})">${f.aprovacao ? 'desfazer aprovação' : '✔ aprovar pagamento'}</a>` : ''}</div>` : ''}
      ${(f.itens || []).some(it => it.processo_id && it.taxa) ? `<div style="margin-top:6px;font-size:12px;"><a class="cr-link" onclick="ftAplicarCustosReais('${f.id}')" title="Grava os valores das taxas desta fatura na aba Custos Reais dos processos (não mexe em processo fechado nem em taxa lançada por container)">↻ Atualizar Custos Reais dos processos com os valores desta fatura</a></div>` : ''}
      ${f.status === 'aberta' ? `
      <div style="border-top:1px solid var(--border);margin-top:12px;padding-top:10px;">
        <div style="font-weight:600;font-size:12px;margin-bottom:6px;">Nova baixa</div>
        <div id="ft_bx_ia" style="margin-bottom:8px;">${pre.aviso ? pre.aviso : ''}</div>
        <div class="ft-cand-campos">
          <label>Pago em <input class="form-input" type="date" id="ft_bx_data" value="${esc(pre.data || _ftHoje())}"></label>
          <label>Valor pago (${f.moeda}) <input class="form-input" id="ft_bx_valor" value="${_ftFmt(pre.valor != null ? pre.valor : saldo)}" inputmode="decimal" oninput="ftBxResumo()"></label>
          <label>Conta bancária <select class="form-input" id="ft_bx_banco">${typeof finOpcoesBancos === 'function' ? finOpcoesBancos('', f.moeda) : ''}</select></label>
          <label>Forma <select class="form-input" id="ft_bx_forma">${_FT_FORMAS.map(([v, l]) => `<option value="${v}" ${(pre.forma || 'pix') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        ${f.moeda !== 'BRL' ? `<div class="ft-cand-campos">
          <label>Câmbio efetivo (R$/${f.moeda}) <input class="form-input" id="ft_bx_cx" value="${pre.cambio_efetivo ? String(pre.cambio_efetivo).replace('.', ',') : ''}" placeholder="${f.cambio ? String(f.cambio).replace('.', ',') + ' (previsto)' : ''}" inputmode="decimal" oninput="ftBxCalcBrl('cx')"></label>
          <label>Valor pago em R$ <input class="form-input" id="ft_bx_brl" value="${pre.pago_brl ? _ftFmt(pre.pago_brl) : ''}" inputmode="decimal" oninput="ftBxCalcBrl('brl')"></label>
          <label class="cr-muted" style="align-self:flex-end;" id="ft_bx_var"></label>
        </div>` : ''}
        <details style="margin-top:6px;" ${pre.juros || pre.desconto || pre.retencoes ? 'open' : ''}><summary class="cr-link" style="cursor:pointer;font-size:12px;">➕ Juros/multa, desconto e retenções de impostos</summary>
          <div class="ft-cand-campos" style="margin-top:6px;">
            <label>Juros/multa pagos <input class="form-input" id="ft_bx_juros" inputmode="decimal" placeholder="0,00" oninput="ftBxResumo()"></label>
            <label>Desconto obtido <input class="form-input" id="ft_bx_desc" inputmode="decimal" placeholder="0,00" oninput="ftBxResumo()"></label>
          </div>
          <div class="cr-muted" style="font-size:11px;margin:6px 0 2px;">Impostos retidos na fonte (abatem o saldo; a empresa recebe o líquido):</div>
          <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;">${FaturasCore.RETENCOES.map(k => `<label style="font-size:11px;">${k === 'outros' ? 'Outros' : k.toUpperCase()}<input class="form-input ft-bx-ret" data-k="${k}" inputmode="decimal" placeholder="0,00" style="padding:4px 6px;" oninput="ftBxResumo()"></label>`).join('')}</div>
          ${f.tipo === 'pagar' ? `<label style="display:flex;gap:6px;align-items:center;font-size:11.5px;margin-top:6px;"><input type="checkbox" id="ft_bx_darf" checked> Lançar IRRF/PIS/COFINS/CSLL retidos como fatura a pagar (DARF, vence dia 20 do mês seguinte)</label>` : ''}
        </details>
        <div id="ft_bx_resumo" class="cr-muted" style="font-size:11.5px;margin-top:6px;"></div>
        <div class="ft-cand-campos">
          <label style="flex:2;">ID / autenticação do comprovante <input class="form-input" id="ft_bx_ident" value="${esc(pre.identificador || '')}" placeholder="opcional — evita usar o mesmo comprovante 2 vezes"></label>
        </div>
        <label class="cr-muted" style="display:block;margin-top:6px;">Observação <input class="form-input" id="ft_bx_obs" style="width:100%;box-sizing:border-box;margin-top:4px;" value="${esc(pre.obs || '')}"></label>
        <div style="margin-top:8px;display:flex;align-items:center;gap:10px;">
          <button class="btn btn-outline" onclick="ftEscolherComprovante('${f.id}')">📎 ${_ftBaixaArquivo ? 'Trocar comprovante' : 'Anexar comprovante (a IA lê)'}</button>
          <span id="ft_bx_arq" class="cr-muted">${_ftBaixaArquivo ? esc(_ftBaixaArquivo.name) : 'opcional — dá pra dar baixa manual sem anexo e anexar depois'}</span>
        </div>
      </div>` : ''}
    </div>
    <div class="ft-modal-foot"><button class="btn btn-outline" onclick="ftFecharModal()">Fechar</button>${f.status === 'aberta' ? `<button class="btn btn-primary" onclick="ftRegistrarBaixa('${f.id}')">Registrar baixa</button>` : ''}</div>
  </div></div>`;
  if(f.status === 'aberta'){ window._ftBxFat = f; ftBxCalcBrl(pre.pago_brl ? 'brl' : 'cx'); ftBxResumo(); }
}
function ftEscolherComprovante(id){
  _ftEscolherArquivo(async arq => {
    _ftBaixaArquivo = arq;
    const sp = document.getElementById('ft_bx_arq'); if(sp) sp.textContent = arq.name;
    const box = document.getElementById('ft_bx_ia'); if(box) box.innerHTML = '<span class="cr-muted">🧾 Lendo o comprovante com a IA…</span>';
    const r = await _ftLerComprovante(arq, id);
    if(!r){ if(box) box.innerHTML = '<span class="cr-muted">Não consegui ler — preencha os campos e registre assim mesmo (o arquivo vai junto).</span>'; return; }
    const f = _ftLista.find(x => x.id === id);
    const x = r.dados || {};
    if(x.data_pagamento) document.getElementById('ft_bx_data').value = x.data_pagamento;
    if(parseFloat(x.valor) > 0) document.getElementById('ft_bx_valor').value = _ftFmt(x.valor);
    if(x.tipo && _FT_FORMAS.some(([v]) => v === x.tipo)) document.getElementById('ft_bx_forma').value = x.tipo;
    if(x.identificador) document.getElementById('ft_bx_ident').value = x.identificador;
    if(box) box.innerHTML = _ftAvisosComprovante(x, f);
  });
}
async function _ftLerComprovante(arq, faturaId){
  try{
    const r = await fetch('/api/faturas/ler-comprovante', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ arquivo_base64: await _ftB64(arq), media_type: _ftTipoArq(arq), fatura_id: faturaId || undefined }) });
    const d = await r.json(); if(!d.ok){ showToast(d.erro || 'Não consegui ler o comprovante.', 'warn'); return null; }
    return d;
  }catch(e){ return null; }
}
// Confere o comprovante lido com a fatura (valor x saldo, favorecido x empresa, uso repetido)
function _ftAvisosComprovante(x, f){
  const av = [];
  const ok = [];
  if(f){
    const saldo = FaturasCore.saldoFatura(f);
    const v = parseFloat(x.valor) || 0;
    if(x.moeda && x.moeda !== f.moeda) av.push(`⚠️ Comprovante em ${esc(x.moeda)}, fatura em ${esc(f.moeda)} — confira o valor.`);
    if(v > 0 && Math.abs(v - saldo) <= 0.01) ok.push('✅ Valor igual ao saldo — quita a fatura.');
    else if(v > 0 && v < saldo) av.push(`⚠️ Valor menor que o saldo (${_ftSimb(f.moeda)} ${_ftFmt(saldo)}) — fica como pagamento parcial.`);
    else if(v > saldo) av.push(`⚠️ Valor maior que o saldo (${_ftSimb(f.moeda)} ${_ftFmt(saldo)}) — juros/multa? Confira.`);
    const nomeFav = x.favorecido_cadastro || x.favorecido || '';
    if(x.empresa_id && f.empresa_id && x.empresa_id === f.empresa_id) ok.push('✅ Favorecido é a empresa da fatura.');
    else if(nomeFav) av.push(`⚠️ Favorecido no comprovante: <b>${esc(nomeFav)}</b> — confira se é ${esc(f.empresa_nome)}.`);
  }
  if(x.ja_usado_em) av.push(`⛔ Esse comprovante já foi usado na fatura ${esc(x.ja_usado_em)}.`);
  if(x.observacao) av.push('ℹ️ ' + esc(x.observacao));
  const cor = x.ja_usado_em ? '#fef3f2' : av.length ? '#fffaeb' : '#ecfdf3';
  return `<div style="background:${cor};border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:11.5px;">${['<b>Comprovante lido pela IA</b>' + (x.banco ? ' · ' + esc(x.banco) : '')].concat(av, ok).join('<br>')}</div>`;
}
async function ftRegistrarBaixa(id, confirmarRepetido){
  const fat = _ftLista.find(x => x.id === id) || {};
  if(!confirmarRepetido && fat.tipo === 'pagar' && !fat.aprovacao && !confirm('Este pagamento ainda não foi aprovado por um gerente. Registrar a baixa mesmo assim?')) return;
  const body = { data: document.getElementById('ft_bx_data').value, valor: parseValorMoeda(document.getElementById('ft_bx_valor').value), forma: document.getElementById('ft_bx_forma').value, identificador: document.getElementById('ft_bx_ident').value.trim(), obs: document.getElementById('ft_bx_obs').value.trim(), confirmar_repetido: !!confirmarRepetido, ..._ftBxExtras() };
  if(_ftBaixaArquivo){ body.arquivo_base64 = await _ftB64(_ftBaixaArquivo); body.nome_arquivo = _ftBaixaArquivo.name; body.media_type = _ftTipoArq(_ftBaixaArquivo); }
  try{
    const r = await fetch('/api/faturas/' + encodeURIComponent(id) + '/baixa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if(!d.ok){
      if(d.repetido && confirm(d.erro + '\n\nRegistrar mesmo assim?')) return ftRegistrarBaixa(id, true);
      if(!d.repetido) showToast(d.erro || 'Erro na baixa', 'err');
      // Fatura mudou no meio (outra baixa/estorno/pessoa): recarrega pra conferir.
      if(d.conflito){ ftFecharModal(); renderDashFaturas(); }
      return;
    }
    _ftBaixaArquivo = null;
    ftFecharModal();
    showToast((d.fatura.status === 'paga' ? 'Baixa registrada — fatura quitada.' : `Baixa parcial registrada — saldo ${_ftSimb(d.fatura.moeda)} ${_ftFmt(d.saldo)}.`) + (d.darf ? ` DARF das retenções lançado (${d.darf.numero}, vence ${_ftData(d.darf.vencimento)}).` : '') + (d.aviso ? ' ' + d.aviso : ''), 'ok');
    renderDashFaturas();
  }catch(e){ showToast('Erro de rede', 'err'); }
}
async function ftEstornar(faturaId, pagamentoId){
  const motivo = prompt('Motivo do estorno (o pagamento fica no histórico, riscado):');
  if(motivo === null) return;
  try{
    const d = await (await fetch('/api/faturas/' + encodeURIComponent(faturaId) + '/estornar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pagamento_id: pagamentoId, motivo }) })).json();
    if(!d.ok){ showToast(d.erro || 'Erro', 'err'); return; }
    const i = _ftLista.findIndex(x => x.id === faturaId); if(i >= 0) _ftLista[i] = d.fatura;
    showToast('Pagamento estornado.', 'ok'); ftBaixa(faturaId); renderDashFaturas();
  }catch(e){ showToast('Erro de rede', 'err'); }
}
function ftAnexarDoc(faturaId){
  _ftEscolherArquivo(async arq => {
    try{
      const nova = await _ftEnviarAnexo(faturaId, arq, 'outro');
      const i = _ftLista.findIndex(x => x.id === faturaId); if(i >= 0) _ftLista[i] = nova;
      showToast('Documento anexado.', 'ok'); ftBaixa(faturaId);
    }catch(e){ showToast('Não anexou: ' + e.message, 'err'); }
  });
}
// Comprovante "solto": a IA lê e sugere qual fatura ele paga
function ftComprovanteSolto(){
  _ftEscolherArquivo(async arq => {
    const ov = _ftOverlay();
    ov.innerHTML = `<div class="ft-modal-bg"><div class="ft-modal" style="max-width:420px;"><div class="ft-modal-body" style="text-align:center;padding:28px;">📎 Lendo <b>${esc(arq.name)}</b> e procurando a fatura…</div></div></div>`;
    const r = await _ftLerComprovante(arq, null);
    if(!r){ ftFecharModal(); return; }
    const x = r.dados || {};
    const sug = r.sugestoes || [];
    const resumo = `<div style="margin-bottom:10px;"><b>${_ftSimb(x.moeda || 'BRL')} ${_ftFmt(x.valor || 0)}</b> em ${_ftData(x.data_pagamento)} para <b>${esc(x.favorecido_cadastro || x.favorecido || '?')}</b>${x.banco ? ' · ' + esc(x.banco) : ''}${x.ja_usado_em ? `<div style="color:var(--err);font-weight:600;">⛔ Já usado na fatura ${esc(x.ja_usado_em)}</div>` : ''}</div>`;
    window._ftCompSolto = { arq, x };
    ov.innerHTML = `<div class="ft-modal-bg" onclick="if(event.target===this) ftFecharModal()"><div class="ft-modal" style="max-width:600px;">
      <div class="ft-modal-head"><span>📎 Comprovante — qual fatura ele paga?</span><button class="btn btn-outline" onclick="ftFecharModal()">✕</button></div>
      <div class="ft-modal-body">${resumo}
        ${sug.length ? `<table class="ft-itens" style="width:100%;"><thead><tr><th>Fatura</th><th>Empresa</th><th>Venc.</th><th style="text-align:right;">Saldo</th><th>Por quê</th><th></th></tr></thead><tbody>${sug.map(s => `<tr>
          <td>${esc(s.numero || '')}<div class="cr-muted">${esc(s.documento || '')}</div></td><td>${esc(s.empresa_nome)}</td><td>${_ftData(s.vencimento)}</td>
          <td style="text-align:right;">${_ftSimb(s.moeda)} ${_ftFmt(s.saldo)}</td><td class="cr-muted" style="font-size:10.5px;">${esc(s.motivos.join(', '))}</td>
          <td style="white-space:nowrap;"><input type="checkbox" class="ft_cs_ck" data-id="${s.id}" title="Marcar pra lote"> <button class="btn btn-primary" style="padding:3px 10px;font-size:11px;" onclick="ftUsarComprovanteEm('${s.id}')">Usar</button></td></tr>`).join('')}</tbody></table>
          <div class="cr-muted" style="font-size:11px;margin-top:6px;">Um pagamento cobrindo várias faturas? Marque-as e use <a class="cr-link" onclick="ftLoteDoComprovante()">💰 baixa em lote nas marcadas</a>.</div>`
          : '<div class="cr-muted">Não achei uma fatura em aberto compatível (valor/empresa). Procure a fatura na lista e use "💰 Dar baixa" → "Anexar comprovante".</div>'}
      </div>
      <div class="ft-modal-foot"><button class="btn btn-outline" onclick="ftFecharModal()">Fechar</button></div>
    </div></div>`;
  });
}
async function ftUsarComprovanteEm(faturaId){
  const c = window._ftCompSolto || {}; const x = c.x || {};
  if(!_ftLista.find(f => f.id === faturaId)){ _ftFiltro.status = ''; _ftLista = await _ftCarregar(); }
  const f = _ftLista.find(y => y.id === faturaId);
  ftBaixa(faturaId, { arquivo: c.arq, data: x.data_pagamento, valor: parseFloat(x.valor) > 0 ? parseFloat(x.valor) : undefined, forma: _FT_FORMAS.some(([v]) => v === x.tipo) ? x.tipo : 'pix', identificador: x.identificador, aviso: _ftAvisosComprovante(x, f) });
}
// ── Fase 3: câmbio/juros/retenções na baixa, lote, aprovação, Custos Reais,
//    extrato bancário, a receber dos processos, exportação ─────────────
function _ftSouGerente(){ return !!(typeof _user !== 'undefined' && _user && _user.role === 'gerente'); }
function _ftNum(id){ const el = document.getElementById(id); return el ? (parseValorMoeda(el.value) || 0) : 0; }
function _ftDetalhePag(p, f){
  const partes = [];
  if(parseFloat(p.juros) > 0) partes.push('juros ' + _ftFmt(p.juros));
  if(parseFloat(p.desconto) > 0) partes.push('desc. ' + _ftFmt(p.desconto));
  const ret = FaturasCore.RETENCOES.filter(k => p.retencoes && parseFloat(p.retencoes[k]) > 0).map(k => k.toUpperCase() + ' ' + _ftFmt(p.retencoes[k]));
  if(ret.length) partes.push('ret.: ' + ret.join(', '));
  if(f.moeda !== 'BRL' && parseFloat(p.pago_brl) > 0){
    const v = FaturasCore.variacaoCambial(p, f);
    partes.push(`R$ ${_ftFmt(p.pago_brl)} @ ${String(p.cambio_efetivo || '').replace('.', ',')}` + (v ? ` <span style="color:${v > 0 ? 'var(--err)' : 'var(--ok)'};">(var. ${v > 0 ? '+' : ''}${_ftFmt(v)})</span>` : ''));
  }
  return partes.join(' · ') || '<span class="cr-muted">—</span>';
}
function ftBxCalcBrl(origem){
  const f = window._ftBxFat; if(!f || f.moeda === 'BRL') return;
  const cxEl = document.getElementById('ft_bx_cx'), brlEl = document.getElementById('ft_bx_brl'), vEl = document.getElementById('ft_bx_var');
  if(!cxEl || !brlEl) return;
  const valor = _ftNum('ft_bx_valor') + _ftNum('ft_bx_juros');
  const cx = parseFloat(String(cxEl.value || '').replace(',', '.')) || 0;
  if(origem === 'cx' && cx > 0 && valor > 0) brlEl.value = _ftFmt(valor * cx);
  if(origem === 'brl'){ const brl = _ftNum('ft_bx_brl'); if(brl > 0 && valor > 0) cxEl.value = (brl / valor).toFixed(4).replace('.', ','); }
  const brl = _ftNum('ft_bx_brl'), prev = parseFloat(f.cambio) || 0;
  if(vEl){
    if(brl > 0 && prev > 0){ const v = brl - _ftNum('ft_bx_valor') * prev; vEl.innerHTML = `Variação cambial: <b style="color:${v > 0 ? 'var(--err)' : 'var(--ok)'};">${v > 0 ? '+' : ''}R$ ${_ftFmt(v)}</b> (previsto ${String(prev).replace('.', ',')})`; }
    else vEl.innerHTML = '';
  }
}
function _ftBxExtras(){
  const retencoes = {};
  document.querySelectorAll('.ft-bx-ret').forEach(el => { const v = parseValorMoeda(el.value) || 0; if(v > 0) retencoes[el.dataset.k] = v; });
  const o = { juros: _ftNum('ft_bx_juros'), desconto: _ftNum('ft_bx_desc'), retencoes, banco_id: (document.getElementById('ft_bx_banco') || {}).value || null };
  const cx = document.getElementById('ft_bx_cx'); if(cx && cx.value) o.cambio_efetivo = cx.value;
  const brl = document.getElementById('ft_bx_brl'); if(brl && brl.value) o.pago_brl = brl.value;
  const darf = document.getElementById('ft_bx_darf'); o.gerar_darf = !!(darf && darf.checked);
  return o;
}
function ftBxResumo(){
  const f = window._ftBxFat; const el = document.getElementById('ft_bx_resumo'); if(!f || !el) return;
  const x = _ftBxExtras();
  const ret = Object.values(x.retencoes).reduce((s, v) => s + v, 0);
  const valor = _ftNum('ft_bx_valor');
  const abate = valor + x.desconto + ret, saldo = FaturasCore.saldoFatura(f);
  const fica = Math.round((saldo - abate) * 100) / 100;
  el.innerHTML = `Abate do saldo: <b>${_ftSimb(f.moeda)} ${_ftFmt(abate)}</b>${x.juros ? ` · juros/multa (custo extra): ${_ftFmt(x.juros)}` : ''} · ${fica > 0.01 ? `fica em aberto <b style="color:#8a5a00;">${_ftFmt(fica)}</b>` : fica < -0.01 ? `<b style="color:var(--err);">passa do saldo em ${_ftFmt(-fica)}</b>` : '<b style="color:var(--ok);">quita a fatura</b>'}`;
  ftBxCalcBrl('cx');
}
function ftSelecionar(id, marcado){
  if(marcado) _ftSel.add(id); else _ftSel.delete(id);
  const b = document.getElementById('ft_btn_lote');
  if(b){ b.disabled = !_ftSel.size; b.textContent = '💰 Baixa em lote' + (_ftSel.size ? ` (${_ftSel.size})` : ''); }
}
async function ftAprovar(id, desfazer){
  try{
    const d = await (await fetch('/api/faturas/' + encodeURIComponent(id) + '/aprovacao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ desfazer: !!desfazer }) })).json();
    if(!d.ok){ showToast(d.erro || 'Erro', 'err'); return; }
    const i = _ftLista.findIndex(x => x.id === id); if(i >= 0) _ftLista[i] = d.fatura;
    showToast(desfazer ? 'Aprovação desfeita.' : 'Pagamento aprovado.', 'ok'); ftBaixa(id); renderDashFaturas();
  }catch(e){ showToast('Erro de rede', 'err'); }
}
async function ftAplicarCustosReais(id){
  const f = _ftLista.find(x => x.id === id); if(!f) return;
  const refs = [...new Set((f.itens || []).map(it => it.referencia).filter(Boolean))].join(', ');
  if(!confirm(`Gravar os valores das ${(f.itens || []).length} taxa(s) desta fatura na aba Custos Reais de ${refs || 'processo'}?\n\nIsso muda o custo real (e o lucro apurado) desses processos. Processos fechados e taxas lançadas por container não são alterados.`)) return;
  try{
    const d = await (await fetch('/api/faturas/' + encodeURIComponent(id) + '/aplicar-custos-reais', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    if(!d.ok){ showToast(d.erro || 'Erro', 'err'); return; }
    const fmtM = o => Object.entries(o || {}).map(([m, v]) => _ftSimb(m) + ' ' + _ftFmt(v)).join(' + ') || 'vazio';
    const linhas = (d.feitos || []).map(x => `• ${x.ref} · ${x.taxa}: ${fmtM(x.antes)} → ${fmtM(x.depois)}`).concat((d.pulados || []).map(x => `• (não alterado) ${x.ref}${x.taxa ? ' · ' + x.taxa : ''}: ${x.motivo}`));
    alert((d.feitos || []).length ? `Custos Reais atualizados:\n\n${linhas.join('\n')}` : `Nada a alterar — os valores já batem.${linhas.length ? '\n\n' + linhas.join('\n') : ''}`);
  }catch(e){ showToast('Erro de rede', 'err'); }
}

// Baixa em lote (1 pagamento → várias faturas)
let _ftLoteArquivo = null;
function ftBaixaLote(ids, pre){
  ids = ids || [..._ftSel];
  const fats = ids.map(id => _ftLista.find(x => x.id === id)).filter(f => f && f.status === 'aberta');
  if(!fats.length){ showToast('Marque as faturas abertas na lista.', 'warn'); return; }
  const moedas = [...new Set(fats.map(f => f.moeda))];
  if(moedas.length > 1){ showToast('O lote precisa ser de faturas na mesma moeda.', 'warn'); return; }
  pre = pre || {};
  _ftLoteArquivo = pre.arquivo || null;
  const total = pre.valor || fats.reduce((s, f) => s + FaturasCore.saldoFatura(f), 0);
  const dist = FaturasCore.distribuirLote(total, fats);
  const ov = _ftOverlay();
  ov.innerHTML = `<div class="ft-modal-bg" onclick="if(event.target===this) ftFecharModal()"><div class="ft-modal" style="max-width:680px;">
    <div class="ft-modal-head"><span>💰 Baixa em lote — ${fats.length} fatura${fats.length > 1 ? 's' : ''}</span><button class="btn btn-outline" onclick="ftFecharModal()">✕</button></div>
    <div class="ft-modal-body">
      ${pre.aviso || ''}
      <div class="ft-cand-campos">
        <label>Pago em <input class="form-input" type="date" id="ft_lt_data" value="${esc(pre.data || _ftHoje())}"></label>
        <label>Valor total pago (${moedas[0]}) <input class="form-input" id="ft_lt_total" value="${_ftFmt(total)}" inputmode="decimal" oninput="ftLoteRedistribuir()"></label>
        <label>Conta bancária <select class="form-input" id="ft_lt_banco">${typeof finOpcoesBancos === 'function' ? finOpcoesBancos('', moedas[0]) : ''}</select></label>
        <label>Forma <select class="form-input" id="ft_lt_forma">${_FT_FORMAS.map(([v, l]) => `<option value="${v}" ${(pre.forma || 'pix') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <div class="ft-cand-campos"><label style="flex:2;">ID / autenticação do comprovante <input class="form-input" id="ft_lt_ident" value="${esc(pre.identificador || '')}"></label></div>
      <table class="ft-itens" style="width:100%;margin-top:8px;"><thead><tr><th>Fatura</th><th>Empresa</th><th style="text-align:right;">Saldo</th><th style="text-align:right;">Abater</th></tr></thead><tbody>
        ${fats.map((f, i) => `<tr><td>${esc(f.numero || '')}<div class="cr-muted">${esc(f.documento || '')}</div></td><td>${esc(f.empresa_nome)}</td><td style="text-align:right;">${_ftFmt(FaturasCore.saldoFatura(f))}</td>
          <td style="text-align:right;"><input class="form-input ft-lt-v" data-id="${f.id}" value="${_ftFmt(dist[i] ? dist[i].valor : 0)}" style="width:110px;text-align:right;padding:3px 6px;" inputmode="decimal" oninput="ftLoteConferir()"></td></tr>`).join('')}
      </tbody></table>
      <div id="ft_lt_conf" class="cr-muted" style="font-size:11.5px;margin-top:6px;"></div>
      <div style="margin-top:8px;display:flex;align-items:center;gap:10px;">
        <button class="btn btn-outline" onclick="_ftEscolherArquivo(a => { _ftLoteArquivo = a; document.getElementById('ft_lt_arq').textContent = a.name; })">📎 Anexar comprovante</button>
        <span id="ft_lt_arq" class="cr-muted">${_ftLoteArquivo ? esc(_ftLoteArquivo.name) : 'opcional — o mesmo comprovante fica em todas as faturas do lote'}</span>
      </div>
      <label class="cr-muted" style="display:block;margin-top:6px;">Observação <input class="form-input" id="ft_lt_obs" style="width:100%;box-sizing:border-box;margin-top:4px;"></label>
    </div>
    <div class="ft-modal-foot"><button class="btn btn-outline" onclick="ftFecharModal()">Cancelar</button><button class="btn btn-primary" onclick="ftRegistrarLote()">Registrar baixa do lote</button></div>
  </div></div>`;
  window._ftLoteFats = fats;
  ftLoteConferir();
}
function ftLoteRedistribuir(){
  const fats = window._ftLoteFats || [];
  const dist = FaturasCore.distribuirLote(_ftNum('ft_lt_total'), fats);
  document.querySelectorAll('.ft-lt-v').forEach((el, i) => { el.value = _ftFmt(dist[i] ? dist[i].valor : 0); });
  ftLoteConferir();
}
function ftLoteConferir(){
  const tot = _ftNum('ft_lt_total');
  const soma = [...document.querySelectorAll('.ft-lt-v')].reduce((s, el) => s + (parseValorMoeda(el.value) || 0), 0);
  const el = document.getElementById('ft_lt_conf'); if(!el) return;
  const dif = Math.round((tot - soma) * 100) / 100;
  el.innerHTML = Math.abs(dif) < 0.01 ? `✅ Distribuição bate com o total (${_ftFmt(tot)}).` : `<span style="color:var(--err);">⚠️ Distribuído ${_ftFmt(soma)} × total ${_ftFmt(tot)} (diferença ${_ftFmt(dif)}).</span>`;
}
async function ftRegistrarLote(confirmarRepetido){
  const itens = [...document.querySelectorAll('.ft-lt-v')].map(el => ({ fatura_id: el.dataset.id, valor: parseValorMoeda(el.value) || 0 })).filter(i => i.valor > 0);
  const tot = _ftNum('ft_lt_total'), soma = itens.reduce((s, i) => s + i.valor, 0);
  if(!confirmarRepetido && Math.abs(tot - soma) > 0.01 && !confirm(`A soma distribuída (${_ftFmt(soma)}) é diferente do total pago (${_ftFmt(tot)}). Registrar assim mesmo?`)) return;
  const naoAprov = (window._ftLoteFats || []).filter(f => f.tipo === 'pagar' && !f.aprovacao);
  if(!confirmarRepetido && naoAprov.length && !confirm(`${naoAprov.length} fatura(s) do lote ainda não foram aprovadas por um gerente. Registrar mesmo assim?`)) return;
  const body = { banco_id: (document.getElementById('ft_lt_banco') || {}).value || null, data: document.getElementById('ft_lt_data').value, forma: document.getElementById('ft_lt_forma').value, identificador: document.getElementById('ft_lt_ident').value.trim(), obs: document.getElementById('ft_lt_obs').value.trim(), itens, confirmar_repetido: !!confirmarRepetido };
  if(_ftLoteArquivo){ body.arquivo_base64 = await _ftB64(_ftLoteArquivo); body.nome_arquivo = _ftLoteArquivo.name; body.media_type = _ftTipoArq(_ftLoteArquivo); }
  try{
    const d = await (await fetch('/api/faturas/baixa-lote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if(!d.ok){ if(d.repetido && confirm(d.erro + '\n\nRegistrar mesmo assim?')) return ftRegistrarLote(true); if(!d.repetido) showToast(d.erro || 'Erro no lote', 'err'); return; }
    _ftSel.clear(); _ftLoteArquivo = null; ftFecharModal();
    const quitadas = d.faturas.filter(x => x.status === 'paga').length;
    showToast(`Lote registrado em ${d.faturas.length} fatura(s) — ${quitadas} quitada(s).`, 'ok'); renderDashFaturas();
  }catch(e){ showToast('Erro de rede', 'err'); }
}
async function ftLoteDoComprovante(){
  const ids = [...document.querySelectorAll('.ft_cs_ck:checked')].map(el => el.dataset.id);
  if(ids.length < 2){ showToast('Marque 2 ou mais faturas.', 'warn'); return; }
  const c = window._ftCompSolto || {}; const x = c.x || {};
  if(ids.some(id => !_ftLista.find(f => f.id === id))){ _ftFiltro.status = ''; _ftLista = await _ftCarregar(); }
  ftBaixaLote(ids, { arquivo: c.arq, data: x.data_pagamento, valor: parseFloat(x.valor) > 0 ? parseFloat(x.valor) : undefined, forma: _FT_FORMAS.some(([v]) => v === x.tipo) ? x.tipo : 'pix', identificador: x.identificador });
}

// Conciliação com extrato bancário (OFX ou CSV)
function ftConciliarExtrato(){
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.ofx,.csv,.txt'; inp.style.display = 'none';
  inp.onchange = async () => {
    const arq = inp.files && inp.files[0]; inp.remove(); if(!arq) return;
    let txt = await arq.text();
    // OFX de banco brasileiro costuma vir em latin-1
    if(/�/.test(txt)){ try{ txt = new TextDecoder('iso-8859-1').decode(await arq.arrayBuffer()); }catch(e){} }
    const trans = /<STMTTRN>/i.test(txt) ? FaturasCore.parseOFX(txt) : FaturasCore.parseExtratoCSV(txt);
    if(!trans.length){ showToast('Não reconheci lançamentos nesse arquivo (use OFX ou CSV com colunas Data/Histórico/Valor).', 'err'); return; }
    let abertas = [];
    try{ const d = await (await fetch('/api/faturas?status=aberta')).json(); abertas = d.faturas || []; }catch(e){}
    const conc = FaturasCore.conciliarExtrato(trans, abertas);
    let usados = {};
    try{ const d = await (await fetch('/api/faturas/identificadores-usados', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: conc.map(c => c.chave) }) })).json(); usados = d.usados || {}; }catch(e){}
    window._ftConc = { conc, abertas, usados, nome: arq.name };
    _ftRenderConciliacao();
  };
  document.body.appendChild(inp); inp.click();
}
function _ftRenderConciliacao(){
  const { conc, usados, nome } = window._ftConc;
  const comMatch = conc.filter(c => c.candidatos.length && !usados[c.chave]).length;
  const ov = _ftOverlay();
  ov.innerHTML = `<div class="ft-modal-bg" onclick="if(event.target===this) ftFecharModal()"><div class="ft-modal" style="max-width:900px;">
    <div class="ft-modal-head"><span>🏦 Conciliação — ${esc(nome)}</span><button class="btn btn-outline" onclick="ftFecharModal()">✕</button></div>
    <div class="ft-modal-body">
      <div style="margin-bottom:8px;font-size:12px;">Extrato da conta: <select class="form-input" id="ft_cc_banco" style="display:inline-block;width:auto;padding:3px 6px;">${typeof finOpcoesBancos === 'function' ? finOpcoesBancos('', 'BRL') : ''}</select></div>
      <div class="cr-muted" style="margin-bottom:8px;">${conc.length} lançamento(s) · ${comMatch} com fatura compatível (mesmo valor, em R$). Débitos casam com faturas a pagar; créditos com faturas a receber. Confira e marque o que dar baixa — lançamento já usado não aparece pra marcar de novo.</div>
      <div style="max-height:420px;overflow:auto;"><table class="ft-itens" style="width:100%;"><thead><tr><th></th><th>Data</th><th>Lançamento</th><th style="text-align:right;">Valor</th><th>Fatura</th></tr></thead><tbody>
      ${conc.map((c, i) => {
        const usado = usados[c.chave];
        const opts = c.candidatos.map(k => `<option value="${k.id}" ${k.id === c.sugerida ? 'selected' : ''}>${esc((k.numero || '') + ' · ' + k.empresa_nome + ' · venc. ' + _ftData(k.vencimento) + ' (' + k.motivos.join(', ') + ')')}</option>`).join('');
        return `<tr style="${usado ? 'opacity:.5;' : ''}"><td>${usado ? '' : `<input type="checkbox" class="ft-cc-ck" data-i="${i}" ${c.sugerida ? 'checked' : ''} ${c.candidatos.length ? '' : 'disabled'}>`}</td>
          <td style="white-space:nowrap;">${_ftData(c.data)}</td><td>${esc(c.descricao || '')}${c.doc ? ` <span class="cr-muted">doc ${esc(c.doc)}</span>` : ''}</td>
          <td style="text-align:right;white-space:nowrap;color:${c.tipo === 'debito' ? 'var(--err)' : 'var(--ok)'};">${c.tipo === 'debito' ? '−' : '+'} ${_ftFmt(c.valor)}</td>
          <td>${usado ? `<span class="cr-muted">já baixado (${esc(usado)})</span>` : c.candidatos.length ? `<select class="form-input ft-cc-sel" data-i="${i}" style="padding:3px 6px;font-size:11px;max-width:330px;"><option value="">— não dar baixa —</option>${opts}</select>` : '<span class="cr-muted">nenhuma fatura com esse valor</span>'}</td></tr>`;
      }).join('')}
      </tbody></table></div>
    </div>
    <div class="ft-modal-foot"><button class="btn btn-outline" onclick="ftFecharModal()">Fechar</button><button class="btn btn-primary" onclick="ftBaixarConciliacao()">Dar baixa nas marcadas</button></div>
  </div></div>`;
}
async function ftBaixarConciliacao(){
  const { conc, abertas } = window._ftConc;
  const sel = [...document.querySelectorAll('.ft-cc-ck:checked')].map(el => +el.dataset.i).map(i => ({ c: conc[i], fid: (document.querySelector(`.ft-cc-sel[data-i="${i}"]`) || {}).value })).filter(x => x.fid);
  if(!sel.length){ showToast('Nada marcado.', 'warn'); return; }
  const dupl = sel.map(x => x.fid).filter((id, i, a) => a.indexOf(id) !== i);
  if(dupl.length && !confirm('A mesma fatura foi escolhida pra mais de um lançamento (pagamento parcial em várias vezes?). Continuar?')) return;
  if(!confirm(`Dar baixa em ${sel.length} fatura(s) com as datas e valores do extrato?`)) return;
  let ok = 0; const erros = [];
  const bancoExt = (document.getElementById('ft_cc_banco') || {}).value || null;
  for(const { c, fid } of sel){
    const f = abertas.find(x => x.id === fid);
    const forma = /pix/i.test(c.descricao) ? 'pix' : /ted|doc|transf/i.test(c.descricao) ? 'ted' : /boleto|pagto|titulo|título/i.test(c.descricao) ? 'boleto' : 'outro';
    try{
      const d = await (await fetch('/api/faturas/' + encodeURIComponent(fid) + '/baixa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: c.data, valor: c.valor, forma, banco_id: bancoExt, identificador: c.chave, obs: 'Extrato: ' + (c.descricao || '').slice(0, 200) }) })).json();
      if(d.ok) ok++; else erros.push(`${f ? f.numero : fid}: ${d.erro}`);
    }catch(e){ erros.push(`${f ? f.numero : fid}: erro de rede`); }
  }
  ftFecharModal(); renderDashFaturas();
  showToast(`${ok} baixa(s) registrada(s) pelo extrato.` + (erros.length ? ` ${erros.length} com problema.` : ''), erros.length ? 'warn' : 'ok');
  if(erros.length) alert('Não registradas:\n\n' + erros.join('\n'));
}

// A receber gerado das parcelas de câmbio e vendas dos processos
async function ftReceberPendentes(){
  const ov = _ftOverlay();
  ov.innerHTML = `<div class="ft-modal-bg"><div class="ft-modal" style="max-width:420px;"><div class="ft-modal-body" style="text-align:center;padding:28px;">↘ Procurando parcelas e vendas sem fatura a receber…</div></div></div>`;
  let lista = [];
  try{ const d = await (await fetch('/api/faturas/receber-pendentes')).json(); if(!d.ok) throw new Error(d.erro); lista = d.pendentes || []; }catch(e){ ftFecharModal(); showToast('Erro: ' + e.message, 'err'); return; }
  window._ftRecPend = lista;
  ov.innerHTML = `<div class="ft-modal-bg" onclick="if(event.target===this) ftFecharModal()"><div class="ft-modal" style="max-width:920px;">
    <div class="ft-modal-head"><span>↘ Gerar faturas a receber dos processos</span><button class="btn btn-outline" onclick="ftFecharModal()">✕</button></div>
    <div class="ft-modal-body">
      <div class="cr-muted" style="margin-bottom:8px;">Parcelas de câmbio <b>fechadas</b> (valor = US$ × câmbio fechado) e vendas com NF de saída que ainda não têm fatura a receber. Depois de criada, a baixa da fatura atualiza o "valor recebido" no processo — o controle do recebimento passa a ser só aqui. Ajuste o valor se o cliente paga diferente.</div>
      ${lista.length ? `<div style="max-height:420px;overflow:auto;"><table class="ft-itens" style="width:100%;"><thead><tr><th></th><th>Processo</th><th>Origem</th><th>Cliente</th><th>Venc.</th><th style="text-align:right;">Valor R$</th><th>Já recebido</th></tr></thead><tbody>
        ${lista.map((x, i) => `<tr><td><input type="checkbox" class="ft-rp-ck" data-i="${i}"></td><td>${esc(x.origem.referencia || '')}</td>
          <td>${x.origem.tipo === 'venda' ? 'Venda ' + esc(x.documento) + (x.prazo ? ` <span class="cr-muted">(${esc(x.prazo)})</span>` : '') : esc(x.documento)}</td><td>${esc(x.empresa_nome || '—')}</td>
          <td><input class="form-input ft-rp-venc" data-i="${i}" type="date" value="${esc(x.vencimento || '')}" style="padding:3px 6px;font-size:11px;"></td>
          <td style="text-align:right;"><input class="form-input ft-rp-val" data-i="${i}" value="${_ftFmt(x.valor)}" style="width:110px;text-align:right;padding:3px 6px;" inputmode="decimal"></td>
          <td style="font-size:11px;">${x.ja_recebido > 0 ? `R$ ${_ftFmt(x.ja_recebido)}${x.recebido_em ? ' em ' + _ftData(x.recebido_em) : ''} <span class="cr-muted">(vira baixa)</span>` : '—'}</td></tr>`).join('')}
      </tbody></table></div>
      <div style="margin-top:6px;"><a class="cr-link" onclick="document.querySelectorAll('.ft-rp-ck').forEach(c => c.checked = true)">marcar todas</a></div>` : '<div class="cr-muted">Nada pendente — todas as parcelas fechadas e vendas com NF já têm fatura a receber.</div>'}
    </div>
    <div class="ft-modal-foot"><button class="btn btn-outline" onclick="ftFecharModal()">Fechar</button>${lista.length ? '<button class="btn btn-primary" onclick="ftCriarReceber()">Criar faturas marcadas</button>' : ''}</div>
  </div></div>`;
}
async function ftCriarReceber(){
  const lista = window._ftRecPend || [];
  const marcados = [...document.querySelectorAll('.ft-rp-ck:checked')].map(el => +el.dataset.i);
  if(!marcados.length){ showToast('Nada marcado.', 'warn'); return; }
  const corpo = marcados.map(i => { const x = lista[i]; return { tipo: 'receber', empresa_nome: x.empresa_nome || 'Cliente', documento: x.documento, moeda: 'BRL', cambio: 1, valor: parseValorMoeda(document.querySelector(`.ft-rp-val[data-i="${i}"]`).value), vencimento: document.querySelector(`.ft-rp-venc[data-i="${i}"]`).value || null, origem: x.origem, itens: [], obs: x.origem.tipo === 'venda' ? 'Gerada da venda (aba Vendas)' : 'Gerada da parcela de câmbio (reembolso do cliente)' }; });
  try{
    const d = await (await fetch('/api/faturas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })).json();
    if(!d.ok){ showToast(d.erro || 'Erro', 'err'); return; }
    // o que já estava marcado como recebido no processo vira a 1ª baixa
    let baixas = 0;
    for(let k = 0; k < marcados.length; k++){
      const x = lista[marcados[k]], fat = d.faturas[k];
      if(fat && x.ja_recebido > 0){
        const r = await (await fetch('/api/faturas/' + encodeURIComponent(fat.id) + '/baixa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: x.recebido_em || _ftHoje(), valor: Math.min(x.ja_recebido, fat.valor), forma: 'outro', obs: 'Recebimento já registrado no processo antes da fatura' }) })).json();
        if(r.ok) baixas++;
      }
    }
    ftFecharModal(); showToast(`${d.faturas.length} fatura(s) a receber criada(s)` + (baixas ? `, ${baixas} já com o recebido lançado` : '') + '.', 'ok'); renderDashFaturas();
  }catch(e){ showToast('Erro de rede', 'err'); }
}

// Exportação Excel (faturas + pagamentos) — pra conferência ou lançar em outro sistema
async function ftExportarExcel(){
  if(typeof ExcelJS === 'undefined'){ showToast('Biblioteca de Excel não carregada.', 'err'); return; }
  let lista = _ftLista;
  try{ const d = await (await fetch('/api/faturas')).json(); if(d.ok) lista = d.faturas; }catch(e){}
  const wb = new ExcelJS.Workbook();
  const s1 = wb.addWorksheet('Faturas');
  s1.columns = [['Nº', 12], ['Tipo', 9], ['Empresa', 34], ['Documento', 18], ['Processos', 22], ['Emissão', 11], ['Vencimento', 11], ['Moeda', 7], ['Valor', 14], ['Câmbio', 9], ['Pago/abatido', 14], ['Saldo', 14], ['Situação', 12], ['Aprovado por', 16], ['Origem', 18], ['Obs', 40]].map(([h, w]) => ({ header: h, width: w }));
  lista.forEach(f => s1.addRow([f.numero, f.tipo === 'pagar' ? 'Pagar' : 'Receber', f.empresa_nome, f.documento, [...new Set((f.itens || []).map(i => i.referencia).filter(Boolean))].join(', '), f.emissao, f.vencimento, f.moeda, +f.valor || 0, f.cambio ? +f.cambio : null, f.valor_pago != null ? +f.valor_pago : null, FaturasCore.saldoFatura(f), f.status, f.aprovacao ? (f.aprovacao.nome || f.aprovacao.por) : '', f.origem ? `${f.origem.tipo} ${f.origem.referencia || ''}` : '', f.obs]));
  const s2 = wb.addWorksheet('Pagamentos');
  s2.columns = [['Fatura', 12], ['Empresa', 30], ['Data', 11], ['Forma', 10], ['Moeda', 7], ['Valor', 13], ['Juros', 10], ['Desconto', 10], ['IRRF', 9], ['PIS', 9], ['COFINS', 9], ['CSLL', 9], ['ISS', 9], ['INSS', 9], ['Outros ret.', 10], ['Câmbio efetivo', 11], ['Pago R$', 13], ['Variação cambial', 13], ['Identificador', 30], ['Lote', 10], ['Estornado', 10], ['Obs', 40]].map(([h, w]) => ({ header: h, width: w }));
  lista.forEach(f => (f.pagamentos || []).forEach(p => { const r = p.retencoes || {}; s2.addRow([f.numero, f.empresa_nome, p.data, p.forma, f.moeda, +p.valor || 0, +p.juros || 0, +p.desconto || 0, +r.irrf || 0, +r.pis || 0, +r.cofins || 0, +r.csll || 0, +r.iss || 0, +r.inss || 0, +r.outros || 0, p.cambio_efetivo ? +p.cambio_efetivo : null, p.pago_brl ? +p.pago_brl : null, FaturasCore.variacaoCambial(p, f) || null, p.identificador, p.lote_id ? p.lote_id.slice(0, 8) : '', p.estornado ? 'sim' : '', p.obs]); }));
  [s1, s2].forEach(s => { s.getRow(1).font = { bold: true }; s.views = [{ state: 'frozen', ySplit: 1 }]; s.eachRow((row, n) => { if(n > 1) row.eachCell(c => { if(typeof c.value === 'number') c.numFmt = '#,##0.00'; }); }); });
  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = `faturas-${_ftHoje()}.xlsx`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function ftCancelar(id){
  const motivo = prompt('Motivo do cancelamento (opcional):');
  if(motivo === null) return;
  ftAcao(id, 'cancelar', { motivo });
}
async function ftAcao(id, acao, body){
  try{
    const r = await fetch('/api/faturas/' + encodeURIComponent(id) + '/' + acao, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const d = await r.json();
    if(!d.ok){ showToast(d.erro || 'Erro', 'err'); return; }
    ftFecharModal();
    showToast(acao === 'pagar' ? 'Fatura marcada como paga.' : acao === 'reabrir' ? 'Fatura reaberta.' : 'Fatura cancelada.', 'ok');
    renderDashFaturas();
  }catch(e){ showToast('Erro de rede', 'err'); }
}
// Editar (documento, vencimento, valor, obs) ou criar uma fatura avulsa
// (sem processo — ex.: mensalidade de sistema, honorário fixo).
function ftNovaManual(){ ftEditar(null); }

// Itens editáveis do modal (taxa + processo + valor) — usados na fatura
// avulsa e na lida pela IA. Fatura já existente mostra os itens como estão.
let _ftItensEdit = [];
function _ftOpcoesTaxa(sel){
  const lista = (typeof custosReaisItensFlat === 'function') ? custosReaisItensFlat() : [];
  return `<option value="">— taxa —</option>` + lista.map(it => `<option value="${it.id}" ${it.id === sel ? 'selected' : ''}>${esc(it.label)}</option>`).join('');
}
function _ftItensHtml(){
  if(!_ftItensEdit.length) return `<div class="cr-muted">Sem itens. <a class="cr-link" onclick="ftItemAdd()">+ adicionar taxa</a></div>`;
  return `<table class="ft-itens" style="width:100%;"><thead><tr><th>Descrição no documento</th><th>Taxa</th><th>Processo</th><th style="text-align:right;">Valor</th><th></th></tr></thead><tbody>${_ftItensEdit.map((it, i) => `<tr>
      <td>${esc(it.descricao || it.label || '')}</td>
      <td><select class="form-input" style="padding:3px 6px;font-size:11px;" onchange="_ftItensEdit[${i}].taxa=this.value">${_ftOpcoesTaxa(it.taxa)}</select></td>
      <td><input class="form-input" style="padding:3px 6px;font-size:11px;width:120px;" value="${esc(it.referencia || '')}" placeholder="UD26-…" onchange="_ftItensEdit[${i}].referencia=this.value.trim()"></td>
      <td style="text-align:right;"><input class="form-input" style="padding:3px 6px;font-size:11px;width:100px;text-align:right;" value="${_ftFmt(it.valor)}" onchange="_ftItensEdit[${i}].valor=parseValorMoeda(this.value)||0;ftSomarItens()"></td>
      <td><a class="cr-link" onclick="_ftItensEdit.splice(${i},1);document.getElementById('ft_e_itens').innerHTML=_ftItensHtml();ftSomarItens()">✕</a></td></tr>`).join('')}</tbody></table>
    <a class="cr-link" onclick="ftItemAdd()">+ adicionar taxa</a>`;
}
function ftItemAdd(){
  const ref = _ftItensEdit.length ? _ftItensEdit[_ftItensEdit.length - 1].referencia : '';
  _ftItensEdit.push({ descricao: '', taxa: '', referencia: ref || '', valor: 0 });
  document.getElementById('ft_e_itens').innerHTML = _ftItensHtml();
}
function ftSomarItens(){
  const s = _ftItensEdit.reduce((a, it) => a + (parseFloat(it.valor) || 0), 0);
  const el = document.getElementById('ft_e_valor'); if(el && s > 0) el.value = _ftFmt(s);
}

// pre = dados vindos da IA (ou outro pré-preenchimento) pra fatura nova
function ftEditar(id, pre){
  const f = id ? _ftLista.find(x => x.id === id) : Object.assign({ tipo: 'pagar', empresa_nome: '', documento: '', moeda: 'BRL', valor: '', vencimento: '', emissao: '', obs: '', itens: [] }, pre || {});
  if(!f) return;
  _ftItensEdit = id ? [] : (f.itens || []).map(it => ({ ...it }));
  const ov = _ftOverlay();
  ov.innerHTML = `<div class="ft-modal-bg" onclick="if(event.target===this) ftFecharModal()"><div class="ft-modal" style="max-width:${id ? 560 : 820}px;">
    <div class="ft-modal-head"><span>${id ? 'Editar fatura' : (pre && pre._ia ? '🧾 Fatura lida pela IA — confira antes de salvar' : 'Fatura avulsa')}</span><button class="btn btn-outline" onclick="ftFecharModal()">✕</button></div>
    <div class="ft-modal-body">
      ${pre && pre._aviso ? `<div class="cr-muted" style="background:#fff7e6;border:1px solid #f5d79e;border-radius:8px;padding:8px 10px;margin-bottom:10px;color:#7a5200;">${pre._aviso}</div>` : ''}
      <div id="ft_e_conf" style="margin-bottom:10px;max-height:190px;overflow:auto;">${(id || (pre && pre._ia)) ? '' : `<a class="cr-link" onclick="ftConferir(null)">🔍 Conferir com o sistema (Custos Reais, cotado, duplicidade)</a>`}</div>
      <div class="ft-cand-campos">
        <label>Tipo <select class="form-input" id="ft_e_tipo"><option value="pagar" ${f.tipo === 'pagar' ? 'selected' : ''}>A pagar</option><option value="receber" ${f.tipo === 'receber' ? 'selected' : ''}>A receber</option></select></label>
        <label style="flex:2;position:relative;">Empresa ${f.empresa_id ? '<span class="cr-vinc" style="position:static;" title="Vinculada ao cadastro">●</span>' : ''}<input class="form-input" id="ft_e_empresa" value="${esc(f.empresa_nome)}" autocomplete="off" oninput="autocompletarContato(this,'','ft_dd_empresa')" onchange="ftSugerirConta()"><div id="ft_dd_empresa" class="cr-dd" style="display:none;"></div></label>
      </div>
      <div class="ft-cand-campos">
        <label>Documento <input class="form-input" id="ft_e_doc" value="${esc(f.documento || '')}" onchange="ftSugerirConta()"></label>
        <label>Emissão <input class="form-input" type="date" id="ft_e_emissao" value="${esc(f.emissao || '')}"></label>
        <label>Vencimento <input class="form-input" type="date" id="ft_e_venc" value="${esc(f.vencimento || '')}"></label>
      </div>
      <div class="ft-cand-campos">
        <label>Moeda <select class="form-input" id="ft_e_moeda">${['BRL','USD','EUR'].map(m => `<option ${f.moeda === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label>Valor total <input class="form-input" id="ft_e_valor" value="${f.valor !== '' && f.valor != null ? _ftFmt(f.valor) : ''}" inputmode="decimal"></label>
        <label>Câmbio (se USD/EUR) <input class="form-input" id="ft_e_cambio" value="${f.cambio && f.moeda !== 'BRL' ? String(f.cambio).replace('.', ',') : ''}" placeholder="${(typeof cambioDoDia === 'function' && cambioDoDia(f.moeda && f.moeda !== 'BRL' ? f.moeda : 'USD')) ? cambioDoDia(f.moeda && f.moeda !== 'BRL' ? f.moeda : 'USD').toFixed(4).replace('.', ',') : 'câmbio da fatura'}" inputmode="decimal"></label>
      </div>
      <div class="ft-cand-campos">
        <label style="flex:2;">Classificação <span class="cr-muted">(aluguel, folha, imposto… — obrigatória em despesa sem processo)</span> <select class="form-input" id="ft_e_conta" onchange="this.dataset.manual='1';document.getElementById('ft_e_conta_dica').textContent=''">${typeof finOpcoesContas === 'function' ? finOpcoesContas(f.conta_id || '', f.tipo) : ''}</select><span id="ft_e_conta_dica" class="cr-muted" style="font-size:11px;"></span></label>
        <label>Centro de custo <select class="form-input" id="ft_e_centro">${typeof finOpcoesCentros === 'function' ? finOpcoesCentros(f.centro_custo_id || '') : ''}</select></label>
      </div>
      ${id ? (f.origem && f.origem.tipo === 'recorrencia' ? `<div class="cr-muted" style="margin-top:6px;">🔁 Gerada pela recorrência <b>${esc(f.origem.referencia || '')}</b> — para mudar os próximos meses, edite na aba <a class="cr-link" onclick="ftFecharModal();finIrAba('recorrentes')">Recorrentes</a>.</div>` : '') : `<div class="ft-cand-campos" style="align-items:flex-end;">
        <label title="A fatura se repete sozinha: o sistema gera cada mês com antecedência (aluguel, folha, sistemas, impostos fixos…)">Recorrência <select class="form-input" id="ft_e_rec" onchange="document.getElementById('ft_e_rec_extra').style.display=this.value?'flex':'none'"><option value="">não se repete</option>${Object.entries(FinCore.FREQUENCIAS).map(([k, [, l]]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <span id="ft_e_rec_extra" style="display:none;gap:8px;flex:3;align-items:flex-end;">
          <label>Até <span class="cr-muted">(vazio = sem fim)</span> <input class="form-input" type="date" id="ft_e_rec_fim"></label>
          <label style="flex-direction:row;align-items:center;gap:6px;" title="Ex.: energia, telefone — gera com este valor como estimativa e avisa para conferir"><input type="checkbox" id="ft_e_rec_var"> valor varia todo mês</label>
        </span>
      </div>`}
      <label class="cr-muted" style="display:block;margin-top:8px;">Observação <input class="form-input" id="ft_e_obs" style="width:100%;box-sizing:border-box;margin-top:4px;" value="${esc(f.obs || '')}" onchange="ftSugerirConta()"></label>
      ${id ? ((f.itens || []).length ? `<div class="cr-muted" style="margin-top:8px;">Itens: ${f.itens.map(it => `${esc(it.referencia || '')} ${esc(it.label)} ${_ftSimb(it.moeda)} ${_ftFmt(it.valor)}`).join(' · ')}</div>` : '')
        : `<div style="margin-top:12px;"><div class="cr-muted" style="font-weight:600;margin-bottom:4px;">Taxas desta fatura (processo + taxa ligam a fatura à aba Custos Reais)</div><div id="ft_e_itens">${_ftItensHtml()}</div></div>`}
    </div>
    <div class="ft-modal-foot"><button class="btn btn-outline" onclick="ftConferir(${id ? `'${id}'` : 'null'})">🔍 Conferir</button><button class="btn btn-outline" onclick="ftFecharModal()">Cancelar</button><button class="btn btn-primary" onclick="ftSalvarEdicao(${id ? `'${id}'` : 'null'})">Salvar</button></div>
  </div></div>`;
  // fatura lida pela IA ou já existente: confere sozinho ao abrir
  if(id || (pre && pre._ia)) ftConferir(id || null);
  if(!id) ftSugerirConta();
}
// Sugere a classificação pelo texto (empresa, documento, observação) enquanto
// o usuário não escolheu uma — ele sempre pode trocar.
function ftSugerirConta(){
  const sel = document.getElementById('ft_e_conta');
  if(!sel || sel.dataset.manual === '1' || (sel.value && sel.dataset.sugerida !== sel.value) || typeof FinCore === 'undefined' || !_fin) return;
  const txt = ['ft_e_empresa', 'ft_e_doc', 'ft_e_obs'].map(i => (document.getElementById(i) || {}).value || '').join(' ');
  const cod = FinCore.sugerirConta(txt);
  const c = cod && _fin.contas.find(x => x.codigo === cod && x.ativo !== false);
  const dica = document.getElementById('ft_e_conta_dica');
  if(c){ sel.value = c.id; sel.dataset.sugerida = c.id; if(dica) dica.textContent = '✨ sugerida pelo texto — confira'; }
}
// Monta o corpo da fatura a partir do modal (usado no Salvar e na Conferência).
function _ftCorpoModal(id){
  const f = id ? _ftLista.find(x => x.id === id) : {};
  const moeda = document.getElementById('ft_e_moeda').value;
  const cx = parseFloat((document.getElementById('ft_e_cambio').value || '').replace(',', '.'));
  const body = { ...f, id: id || undefined, tipo: document.getElementById('ft_e_tipo').value, empresa_nome: document.getElementById('ft_e_empresa').value.trim(), documento: document.getElementById('ft_e_doc').value.trim(), moeda, valor: parseValorMoeda(document.getElementById('ft_e_valor').value), emissao: document.getElementById('ft_e_emissao').value || null, vencimento: document.getElementById('ft_e_venc').value || null, obs: document.getElementById('ft_e_obs').value.trim(), conta_id: (document.getElementById('ft_e_conta') || {}).value || null, centro_custo_id: (document.getElementById('ft_e_centro') || {}).value || null };
  body.cambio = moeda === 'BRL' ? 1 : (cx > 0 ? cx : ((typeof cambioDoDia === 'function' && cambioDoDia(moeda)) || null));
  if(id && f && f.empresa_nome !== body.empresa_nome) body.empresa_id = null;
  const semProc = [];
  if(!id){
    // itens: referência → processo_id (precisa existir no Controle)
    const procs = (typeof _processos !== 'undefined' && _processos) || [];
    body.itens = _ftItensEdit.filter(it => (parseFloat(it.valor) || 0) > 0).map(it => {
      const p = it.referencia ? procs.find(x => (x.referencia || '').toLowerCase() === it.referencia.toLowerCase()) : null;
      if(it.referencia && !p) semProc.push(it.referencia);
      const cfg = (typeof custosReaisItensFlat === 'function') ? custosReaisItensFlat().find(x => x.id === it.taxa) : null;
      return { processo_id: p ? p.id : null, referencia: p ? p.referencia : (it.referencia || null), taxa: it.taxa || null, label: cfg ? cfg.label : (it.descricao || it.label || 'Taxa'), valor: parseFloat(it.valor) || 0 };
    });
  }
  return { body, semProc };
}

// ── Conferência (cross-check) com o sistema ────────────────────────────
// Compara a fatura com os Custos Reais dos processos, o cotado, outras
// faturas (duplicidade / taxa já faturada) e o "pagar para" do processo.
let _ftUltConf = null;
async function ftConferir(id){
  const box = document.getElementById('ft_e_conf');
  if(!box) return null;
  const { body } = _ftCorpoModal(id);
  box.innerHTML = '<div class="cr-muted">🔍 Conferindo com o sistema…</div>';
  const labels = {};
  if(typeof custosReaisItensFlat === 'function') custosReaisItensFlat().forEach(it => { labels[it.id] = it.label; });
  try{
    const r = await fetch('/api/faturas/conferir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fatura: body, labels, cambio: (typeof cambioParaTotais === 'function') ? cambioParaTotais() : {} }) });
    const d = await r.json();
    if(!d.ok){ box.innerHTML = `<div class="cr-muted">Não consegui conferir: ${esc(d.erro || 'erro')}</div>`; return null; }
    _ftUltConf = d;
    box.innerHTML = _ftConfHtml(d, id);
    return d;
  }catch(e){ box.innerHTML = '<div class="cr-muted">Não consegui conferir (erro de rede).</div>'; return null; }
}
function _ftConfHtml(d, id){
  const ORD = { erro: 0, aviso: 1, info: 2, ok: 3 };
  const ICO = { erro: '⛔', aviso: '⚠️', info: 'ℹ️', ok: '✅' };
  const COR = { erro: '#b42318', aviso: '#8a5a00', info: '#475467', ok: '#067647' };
  const lista = (d.checks || []).slice().sort((a, b) => ORD[a.nivel] - ORD[b.nivel]);
  const r = d.resumo || {};
  const titulo = r.erro ? `⛔ ${r.erro} problema${r.erro > 1 ? 's' : ''}` + (r.aviso ? ` · ⚠️ ${r.aviso} aviso${r.aviso > 1 ? 's' : ''}` : '')
    : r.aviso ? `⚠️ ${r.aviso} ponto${r.aviso > 1 ? 's' : ''} pra conferir` : '✅ Tudo bate com o sistema';
  const fundo = r.erro ? '#fef3f2' : r.aviso ? '#fffaeb' : '#ecfdf3';
  const borda = r.erro ? '#fecdca' : r.aviso ? '#fedf89' : '#abefc6';
  return `<div style="background:${fundo};border:1px solid ${borda};border-radius:8px;padding:8px 10px;">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px;">
      <b style="font-size:12px;">Conferência com o sistema — ${titulo}</b>
      <a class="cr-link" onclick="ftConferir(${id ? `'${id}'` : 'null'})">conferir de novo</a>
    </div>
    ${lista.map(c => `<div style="font-size:11.5px;color:${COR[c.nivel]};padding:2px 0;">${ICO[c.nivel]} ${esc(c.msg)}</div>`).join('')}
  </div>`;
}

async function ftSalvarEdicao(id){
  const { body, semProc } = _ftCorpoModal(id);
  if(semProc.length && !confirm(`Processo não encontrado: ${[...new Set(semProc)].join(', ')}. Salvar mesmo assim (sem vínculo com o processo)?`)) return;
  // confere de novo antes de gravar (o usuário pode ter mudado valores)
  const conf = await ftConferir(id);
  if(conf && conf.resumo && conf.resumo.erro){
    const erros = conf.checks.filter(c => c.nivel === 'erro').map(c => '• ' + c.msg).join('\n');
    if(!confirm(`A conferência encontrou problema(s):\n\n${erros}\n\nSalvar a fatura mesmo assim?`)) return;
  }
  if(!id && FinCore.precisaClassificar(body)){ showToast('Escolha a classificação da despesa (aluguel, folha, imposto, sistemas…).', 'warn'); const el = document.getElementById('ft_e_conta'); if(el){ el.focus(); el.style.outline = '2px solid var(--err)'; } return; }
  try{
    const freq = !id ? ((document.getElementById('ft_e_rec') || {}).value || '') : '';
    let d;
    if(freq){
      // recorrência: o servidor guarda a regra e já gera a(s) fatura(s) do horizonte
      if(!body.vencimento){ showToast('Informe o 1º vencimento da despesa recorrente.', 'warn'); return; }
      if((body.itens || []).length){ showToast('Despesa recorrente não leva taxas de processo — tire as taxas ou deixe sem recorrência.', 'warn'); return; }
      if(!body.conta_id){ showToast('Escolha a classificação para a recorrência.', 'warn'); return; }
      const rec = { descricao: body.documento || body.empresa_nome, tipo: body.tipo, empresa_nome: body.empresa_nome, empresa_id: body.empresa_id || null, moeda: body.moeda, valor: body.valor, conta_id: body.conta_id, centro_custo_id: body.centro_custo_id, frequencia: freq, inicio: body.vencimento, fim: document.getElementById('ft_e_rec_fim').value || null, valor_variavel: document.getElementById('ft_e_rec_var').checked, obs: body.obs };
      const r = await fetch('/api/fin/recorrencias', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rec) });
      d = await r.json();
      if(!d.ok){ showToast(d.semTabela ? 'Recorrência ainda não ativada no banco (migration 0054).' : (d.erro || 'Erro ao salvar'), 'err'); return; }
      d.faturas = d.geradas || [];
      showToast(`Recorrência criada — ${d.faturas.length} fatura${d.faturas.length === 1 ? '' : 's'} gerada${d.faturas.length === 1 ? '' : 's'}; as próximas saem sozinhas.`, 'ok');
    } else {
      const r = await fetch('/api/faturas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      d = await r.json();
    }
    if(!d.ok){ showToast(d.erro || 'Erro ao salvar', 'err'); return; }
    // fatura lida pela IA: o PDF original fica anexado à fatura
    if(!id && _ftArquivoIA && d.faturas && d.faturas[0]){
      const arq = _ftArquivoIA; _ftArquivoIA = null;
      try{ await _ftEnviarAnexo(d.faturas[0].id, arq, 'fatura'); }catch(e){ showToast('Fatura salva, mas o PDF não foi anexado: ' + e.message, 'warn'); }
    }
    ftFecharModal(); if(!freq) showToast('Fatura salva' + (d.faturas && d.faturas[0] && d.faturas[0].numero ? ' — nº ' + d.faturas[0].numero : '') + '.', 'ok'); renderDashFaturas();
  }catch(e){ showToast('Erro de rede', 'err'); }
}

// ── Ler fatura/boleto/DARF com IA ──────────────────────────────────────
function ftLerDocumento(){
  let inp = document.getElementById('ft_ia_input');
  if(!inp){
    inp = document.createElement('input'); inp.type = 'file'; inp.id = 'ft_ia_input'; inp.accept = '.pdf,image/*'; inp.style.display = 'none';
    inp.onchange = () => { const arq = inp.files && inp.files[0]; inp.value = ''; if(arq) ftEnviarDocumento(arq); };
    document.body.appendChild(inp);
  }
  inp.click();
}
async function ftEnviarDocumento(arq){
  if(arq.size > 15 * 1024 * 1024){ showToast('"' + arq.name + '" tem ' + (arq.size/1048576).toFixed(1).replace('.', ',') + ' MB — o limite é 15 MB por arquivo. Comprima o PDF ou divida em partes e envie de novo.', 'err'); return; }
  const ov = _ftOverlay();
  ov.innerHTML = `<div class="ft-modal-bg"><div class="ft-modal" style="max-width:420px;"><div class="ft-modal-body" style="text-align:center;padding:28px;">🧾 Lendo <b>${esc(arq.name)}</b> com a IA…<div class="cr-muted" style="margin-top:6px;">Leva uns 10 a 30 segundos.</div></div></div></div>`;
  try{
    const b64 = await new Promise((ok, err) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.onerror = err; fr.readAsDataURL(arq); });
    const r = await fetch('/api/faturas/ler-documento', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ arquivo_base64: b64, media_type: arq.type || (arq.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '') }) });
    const d = await r.json();
    if(!d.ok){ ftFecharModal(); showToast(d.erro || 'Não consegui ler o documento.', 'err'); return; }
    _ftArquivoIA = arq;
    ftEditar(null, ftMontarDaIA(d.dados, arq.name));
  }catch(e){ ftFecharModal(); showToast('Erro ao enviar o arquivo.', 'err'); }
}
// Converte a resposta da IA no formato do modal: empresa, documento,
// datas, moeda/valor e itens já com taxa e processo sugeridos.
function ftMontarDaIA(x, nomeArq){
  x = x || {};
  const procs = (typeof _processos !== 'undefined' && _processos) || [];
  const proc = FaturasCore.acharProcesso(x.pistas_processo || [], procs);
  const moeda = ['BRL','USD','EUR'].includes(x.moeda) ? x.moeda : 'BRL';
  const itens = (x.itens || []).filter(it => it && parseFloat(it.valor) > 0).map(it => ({
    descricao: it.descricao || '', taxa: FaturasCore.taxaPorDescricao(it.descricao) || '', referencia: proc ? proc.referencia : '', valor: parseFloat(it.valor) || 0,
  }));
  const avisos = [];
  if(!proc && (x.pistas_processo || []).length) avisos.push(`Não achei o processo pelas pistas do documento (${esc((x.pistas_processo || []).slice(0, 3).join(', '))}) — informe a referência nas taxas.`);
  if(proc) avisos.push(`Processo identificado: <b>${esc(proc.referencia)}</b>.`);
  if(!x.empresa_id) avisos.push('Empresa não encontrada no Cadastro — confira o nome ou cadastre.');
  const semTaxa = itens.filter(i => !i.taxa).length;
  if(semTaxa) avisos.push(`${semTaxa} linha${semTaxa === 1 ? '' : 's'} sem taxa reconhecida — escolha na lista.`);
  if(x.observacao) avisos.push('Obs. da IA: ' + esc(x.observacao));
  const tipo = /impak/i.test(x.emitente || '') ? 'receber' : 'pagar';
  return {
    _ia: true, _aviso: avisos.join('<br>'),
    tipo, empresa_nome: (tipo === 'receber' ? x.destinatario : (x.emitente_cadastro || x.emitente)) || '', empresa_id: tipo === 'pagar' ? (x.empresa_id || null) : null,
    documento: x.documento || '', emissao: x.emissao || '', vencimento: x.vencimento || '', moeda,
    valor: parseFloat(x.valor_total) || itens.reduce((s, i) => s + i.valor, 0) || '',
    obs: [x.linha_digitavel ? 'Linha digitável: ' + x.linha_digitavel : '', 'Lido de ' + (nomeArq || 'arquivo')].filter(Boolean).join(' · '),
    itens,
  };
}
