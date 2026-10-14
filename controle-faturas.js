// controle-faturas.js — Faturas (contas a pagar / a receber), 14/10/2026.
//
// Duas partes:
//  1. "Gerar faturas" na aba Custos Reais do processo: agrupa as linhas da
//     grade por empresa + documento (faturas-core.js) e cria as faturas.
//  2. Tela /faturas (Financeiro): lista, filtros, totais, marcar paga,
//     reabrir, cancelar. Mesmo padrão de tela exclusiva da Agenda.
// Regras puras em faturas-core.js (testes_faturas.js).

const _ftFiltro = { tipo: '', status: 'aberta', busca: '', de: '', ate: '' };
let _ftLista = [];
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
    const cx = (typeof _cambio !== 'undefined' && _cambio) ? _cambio : {};
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
  document.title = 'ImpakOS - Faturas';
  const titulo = document.querySelector('.topbar-title'); if(titulo) titulo.textContent = 'Faturas';
  ['stats-grid','filtro-financeiro-ativo','filtro-data-bar','fase-filter'].forEach(id => { const e = document.getElementById(id); if(e) e.style.display = 'none'; });
  const toolbar = document.querySelector('.toolbar'); if(toolbar) toolbar.style.display = 'none';
  const sidebar = document.querySelector('.sidebar'); if(sidebar) sidebar.style.display = 'none';
  const tw = document.querySelector('.table-wrap'); if(tw) tw.style.display = 'none';
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
  el.innerHTML = '<div class="cr-muted">Carregando…</div>';
  try{ _ftLista = await _ftCarregar(); }catch(e){ el.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const hoje = _ftHoje();
  const cambio = (typeof _cambio !== 'undefined') ? _cambio : {};
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
  </div>`;
  const filtros = `<div class="ft-filtros">
    <select class="form-input" onchange="_ftFiltro.tipo=this.value;renderDashFaturas()"><option value="">Pagar + receber</option><option value="pagar" ${_ftFiltro.tipo === 'pagar' ? 'selected' : ''}>A pagar</option><option value="receber" ${_ftFiltro.tipo === 'receber' ? 'selected' : ''}>A receber</option></select>
    <select class="form-input" onchange="_ftFiltro.status=this.value;renderDashFaturas()"><option value="aberta" ${_ftFiltro.status === 'aberta' ? 'selected' : ''}>Abertas</option><option value="paga" ${_ftFiltro.status === 'paga' ? 'selected' : ''}>Pagas</option><option value="cancelada" ${_ftFiltro.status === 'cancelada' ? 'selected' : ''}>Canceladas</option><option value="" ${_ftFiltro.status === '' ? 'selected' : ''}>Todas</option></select>
    <input class="form-input" placeholder="empresa ou documento" value="${esc(_ftFiltro.busca)}" onchange="_ftFiltro.busca=this.value.trim();renderDashFaturas()">
    <label class="cr-muted">venc. de <input class="form-input" type="date" value="${esc(_ftFiltro.de)}" onchange="_ftFiltro.de=this.value;renderDashFaturas()"></label>
    <label class="cr-muted">até <input class="form-input" type="date" value="${esc(_ftFiltro.ate)}" onchange="_ftFiltro.ate=this.value;renderDashFaturas()"></label>
    <button class="btn btn-outline" onclick="ftNovaManual()">+ Fatura avulsa</button>
  </div>`;
  const sit = { vencida: ['Vencida', 'var(--err)'], hoje: ['Vence hoje', 'var(--warn,#b45309)'], semana: ['Esta semana', 'var(--warn,#b45309)'], a_vencer: ['A vencer', 'var(--muted)'], sem_vencimento: ['Sem vencimento', 'var(--muted)'], paga: ['Paga', 'var(--ok)'], cancelada: ['Cancelada', 'var(--dim)'] };
  const linhas = _ftLista.map(f => {
    const s = FaturasCore.situacao(f, hoje);
    const refs = [...new Set((f.itens || []).map(it => it.referencia).filter(Boolean))];
    const fator = f.moeda === 'BRL' ? 1 : (parseFloat(f.cambio) || parseFloat(cambio[f.moeda]) || 0);
    const itensHtml = (f.itens || []).length ? `<table class="ft-itens"><thead><tr><th>Processo</th><th>Taxa</th><th>Moeda</th><th style="text-align:right;">Valor</th><th style="text-align:right;">Fator</th><th style="text-align:right;">Em R$</th></tr></thead><tbody>${f.itens.map(it => `<tr><td>${esc(it.referencia || '—')}</td><td>${esc(it.label || it.taxa || '')}</td><td>${esc(it.moeda || f.moeda)}</td><td style="text-align:right;">${_ftFmt(it.valor)}</td><td style="text-align:right;">${fator ? fator.toFixed(4).replace('.', ',') : '—'}</td><td style="text-align:right;">${fator ? _ftFmt((parseFloat(it.valor) || 0) * fator) : '—'}</td></tr>`).join('')}</tbody></table>` : '<div class="cr-muted">Sem itens (fatura avulsa).</div>';
    return `<tr class="ft-row" onclick="ftToggleItens('${f.id}', event)">
      <td><span class="ft-tag ${f.tipo}">${f.tipo === 'pagar' ? 'PAGAR' : 'RECEBER'}</span><div class="cr-muted" style="font-family:'JetBrains Mono',monospace;">${esc(f.numero || '')}</div></td>
      <td><strong>${esc(f.empresa_nome)}</strong>${f.empresa_id ? ' <span class="cr-vinc" style="position:static;" title="Vinculada ao cadastro">●</span>' : ''}<div class="cr-muted">${(f.itens || []).length} ${(f.itens || []).length === 1 ? 'taxa' : 'taxas'} · ref. ${_ftData(f.emissao || (f.created_at || '').slice(0, 10))}${f.moeda !== 'BRL' && fator ? ` · câmbio ${fator.toFixed(4).replace('.', ',')}` : ''}</div></td>
      <td>${esc(f.documento || '—')}</td>
      <td>${refs.map(r => `<a href="/controle/${encodeURIComponent(r)}" target="_blank">${esc(r)}</a>`).join(', ') || '—'}</td>
      <td>${_ftData(f.vencimento)}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',monospace;white-space:nowrap;">${_ftSimb(f.moeda)} ${_ftFmt(f.valor)}</td>
      <td><span style="color:${sit[s][1]};font-weight:600;">${sit[s][0]}</span>${f.status === 'paga' ? `<div class="cr-muted">${_ftData(f.pago_em)}${f.valor_pago != null && Math.abs(f.valor_pago - f.valor) >= 0.01 ? ` · ${_ftSimb(f.moeda)} ${_ftFmt(f.valor_pago)}` : ''}</div>` : ''}</td>
      <td style="white-space:nowrap;">
        ${f.status === 'aberta' ? `<button class="btn btn-primary" style="padding:4px 10px;font-size:11px;" onclick="ftMarcarPaga('${f.id}')">Marcar paga</button> <button class="btn btn-outline" style="padding:4px 8px;font-size:11px;" onclick="ftEditar('${f.id}')">Editar</button> <button class="btn btn-outline" style="padding:4px 8px;font-size:11px;" onclick="ftCancelar('${f.id}')" title="Cancela (não apaga)">Cancelar</button>` : ''}
        ${f.status === 'paga' ? `<button class="btn btn-outline" style="padding:4px 8px;font-size:11px;" onclick="ftAcao('${f.id}','reabrir')">Reabrir</button>` : ''}
      </td></tr>
      <tr class="ft-itens-row" id="ft_itens_${f.id}" style="display:none;"><td colspan="8">${itensHtml}</td></tr>`;
  }).join('');
  const total = _ftLista.filter(f => f.status !== 'cancelada').reduce((s, f) => s + (f.moeda === 'BRL' ? parseFloat(f.valor) || 0 : (parseFloat(f.valor) || 0) * (parseFloat(cambio[f.moeda]) || 0)), 0);
  el.innerHTML = cards + filtros + `<div class="ft-tabela-wrap"><table class="ft-tabela">
    <thead><tr><th>Tipo</th><th>Empresa · itens</th><th>Documento</th><th>Processo</th><th>Vencimento</th><th style="text-align:right;">Valor</th><th>Situação</th><th></th></tr></thead>
    <tbody>${linhas || `<tr><td colspan="8" class="cr-muted" style="padding:16px;">Nenhuma fatura com esses filtros.</td></tr>`}</tbody>
    <tfoot><tr><td colspan="5" style="text-align:right;">${_ftLista.length} fatura${_ftLista.length === 1 ? '' : 's'} · total em R$</td><td style="text-align:right;font-family:'JetBrains Mono',monospace;">R$ ${_ftFmt(total)}</td><td colspan="2"></td></tr></tfoot>
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
function ftEditar(id){
  const f = id ? _ftLista.find(x => x.id === id) : { tipo: 'pagar', empresa_nome: '', documento: '', moeda: 'BRL', valor: '', vencimento: '', obs: '', itens: [] };
  if(!f) return;
  const ov = _ftOverlay();
  ov.innerHTML = `<div class="ft-modal-bg" onclick="if(event.target===this) ftFecharModal()"><div class="ft-modal" style="max-width:560px;">
    <div class="ft-modal-head"><span>${id ? 'Editar fatura' : 'Fatura avulsa'}</span><button class="btn btn-outline" onclick="ftFecharModal()">✕</button></div>
    <div class="ft-modal-body">
      <div class="ft-cand-campos">
        <label>Tipo <select class="form-input" id="ft_e_tipo"><option value="pagar" ${f.tipo === 'pagar' ? 'selected' : ''}>A pagar</option><option value="receber" ${f.tipo === 'receber' ? 'selected' : ''}>A receber</option></select></label>
        <label style="flex:2;position:relative;">Empresa <input class="form-input" id="ft_e_empresa" value="${esc(f.empresa_nome)}" autocomplete="off" oninput="autocompletarContato(this,'','ft_dd_empresa')"><div id="ft_dd_empresa" class="cr-dd" style="display:none;"></div></label>
      </div>
      <div class="ft-cand-campos">
        <label>Documento <input class="form-input" id="ft_e_doc" value="${esc(f.documento || '')}"></label>
        <label>Moeda <select class="form-input" id="ft_e_moeda">${['BRL','USD','EUR'].map(m => `<option ${f.moeda === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label>Valor <input class="form-input" id="ft_e_valor" value="${f.valor !== '' ? _ftFmt(f.valor) : ''}" inputmode="decimal"></label>
        <label>Vencimento <input class="form-input" type="date" id="ft_e_venc" value="${esc(f.vencimento || '')}"></label>
      </div>
      <label class="cr-muted" style="display:block;margin-top:8px;">Observação <input class="form-input" id="ft_e_obs" value="${esc(f.obs || '')}"></label>
      ${(f.itens || []).length ? `<div class="cr-muted" style="margin-top:8px;">Itens: ${f.itens.map(it => `${esc(it.referencia || '')} ${esc(it.label)} ${_ftSimb(it.moeda)} ${_ftFmt(it.valor)}`).join(' · ')}</div>` : ''}
    </div>
    <div class="ft-modal-foot"><button class="btn btn-outline" onclick="ftFecharModal()">Cancelar</button><button class="btn btn-primary" onclick="ftSalvarEdicao(${id ? `'${id}'` : 'null'})">Salvar</button></div>
  </div></div>`;
}
async function ftSalvarEdicao(id){
  const f = id ? _ftLista.find(x => x.id === id) : {};
  const body = { ...f, id: id || undefined, tipo: document.getElementById('ft_e_tipo').value, empresa_nome: document.getElementById('ft_e_empresa').value.trim(), documento: document.getElementById('ft_e_doc').value.trim(), moeda: document.getElementById('ft_e_moeda').value, valor: parseValorMoeda(document.getElementById('ft_e_valor').value), vencimento: document.getElementById('ft_e_venc').value || null, obs: document.getElementById('ft_e_obs').value.trim() };
  if(id && f && f.empresa_nome !== body.empresa_nome) body.empresa_id = null;
  try{
    const r = await fetch('/api/faturas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if(!d.ok){ showToast(d.erro || 'Erro ao salvar', 'err'); return; }
    ftFecharModal(); showToast('Fatura salva.', 'ok'); renderDashFaturas();
  }catch(e){ showToast('Erro de rede', 'err'); }
}
