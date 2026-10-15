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
    <button class="btn btn-primary" onclick="ftLerDocumento()" title="Envie a fatura, boleto, nota ou DARF em PDF/imagem — a IA preenche os campos pra você conferir">🧾 Ler fatura (PDF) com IA</button>
    <button class="btn btn-outline" onclick="ftComprovanteSolto()" title="Envie o comprovante (PIX, TED, boleto pago, câmbio) — a IA acha a fatura e prepara a baixa">📎 Baixa por comprovante</button>
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
      <td><span style="color:${sit[s][1]};font-weight:600;">${sit[s][0]}</span>${f.status === 'paga' ? `<div class="cr-muted">${_ftData(f.pago_em)}${f.valor_pago != null && Math.abs(f.valor_pago - f.valor) >= 0.01 ? ` · ${_ftSimb(f.moeda)} ${_ftFmt(f.valor_pago)}` : ''}</div>` : (f.status === 'aberta' && parseFloat(f.valor_pago) > 0 ? `<div style="font-size:11px;color:#8a5a00;font-weight:600;">Parcial · pago ${_ftSimb(f.moeda)} ${_ftFmt(f.valor_pago)} · saldo ${_ftFmt(FaturasCore.saldoFatura(f))}</div>` : '')}${_ftQtdArq(f) ? `<div class="cr-muted" title="Anexos e comprovantes">📎 ${_ftQtdArq(f)}</div>` : ''}</td>
      <td style="white-space:nowrap;">
        ${f.status === 'aberta' ? `<button class="btn btn-primary" style="padding:4px 10px;font-size:11px;" onclick="ftBaixa('${f.id}')" title="Registrar pagamento (total ou parcial) com comprovante">💰 Dar baixa</button> <button class="btn btn-outline" style="padding:4px 8px;font-size:11px;" onclick="ftEditar('${f.id}')">Editar</button> <button class="btn btn-outline" style="padding:4px 8px;font-size:11px;" onclick="ftCancelar('${f.id}')" title="Cancela (não apaga)">Cancelar</button>` : ''}
        ${f.status === 'paga' ? `<button class="btn btn-outline" style="padding:4px 8px;font-size:11px;" onclick="ftBaixa('${f.id}')" title="Ver pagamentos e comprovantes">📎 Pagamentos</button> <button class="btn btn-outline" style="padding:4px 8px;font-size:11px;" onclick="ftAcao('${f.id}','reabrir')">Reabrir</button>` : ''}
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
// ── Baixas, comprovantes e anexos ──────────────────────────────────────
let _ftArquivoIA = null;      // PDF da fatura lida pela IA (anexado ao salvar)
let _ftBaixaArquivo = null;   // comprovante escolhido no modal de baixa
const _FT_FORMAS = [['pix','PIX'],['ted','TED/DOC'],['boleto','Boleto'],['cambio','Câmbio'],['cartao','Cartão'],['compensacao','Compensação/encontro de contas'],['dinheiro','Dinheiro'],['outro','Outro']];
function _ftQtdArq(f){ return (f.anexos || []).length + (f.pagamentos || []).filter(p => p.comprovante && !(f.anexos || []).some(a => a.path === p.comprovante.path)).length; }
function _ftB64(arq){ return new Promise((ok, err) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.onerror = err; fr.readAsDataURL(arq); }); }
function _ftTipoArq(arq){ return arq.type || (arq.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : ''); }
function _ftEscolherArquivo(cb){
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.pdf,image/*'; inp.style.display = 'none';
  inp.onchange = () => { const a = inp.files && inp.files[0]; inp.remove(); if(a){ if(a.size > 15 * 1024 * 1024){ showToast('Arquivo grande demais (máx. 15 MB).', 'err'); return; } cb(a); } };
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
  const pagsHtml = pags.length ? `<table class="ft-itens" style="width:100%;"><thead><tr><th>Data</th><th>Forma</th><th style="text-align:right;">Valor</th><th>Comprovante</th><th></th></tr></thead><tbody>${pags.map(p => `<tr style="${p.estornado ? 'opacity:.5;text-decoration:line-through;' : ''}">
      <td>${_ftData(p.data)}</td><td>${esc(FORMA[p.forma] || p.forma || '')}${p.identificador ? `<div class="cr-muted" style="font-size:10px;">${esc(p.identificador)}</div>` : ''}</td>
      <td style="text-align:right;">${_ftSimb(f.moeda)} ${_ftFmt(p.valor)}</td>
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
      ${f.status === 'aberta' ? `
      <div style="border-top:1px solid var(--border);margin-top:12px;padding-top:10px;">
        <div style="font-weight:600;font-size:12px;margin-bottom:6px;">Nova baixa</div>
        <div id="ft_bx_ia" style="margin-bottom:8px;">${pre.aviso ? pre.aviso : ''}</div>
        <div class="ft-cand-campos">
          <label>Pago em <input class="form-input" type="date" id="ft_bx_data" value="${esc(pre.data || _ftHoje())}"></label>
          <label>Valor (${f.moeda}) <input class="form-input" id="ft_bx_valor" value="${_ftFmt(pre.valor != null ? pre.valor : saldo)}" inputmode="decimal"></label>
          <label>Forma <select class="form-input" id="ft_bx_forma">${_FT_FORMAS.map(([v, l]) => `<option value="${v}" ${(pre.forma || 'pix') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
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
  const body = { data: document.getElementById('ft_bx_data').value, valor: parseValorMoeda(document.getElementById('ft_bx_valor').value), forma: document.getElementById('ft_bx_forma').value, identificador: document.getElementById('ft_bx_ident').value.trim(), obs: document.getElementById('ft_bx_obs').value.trim(), confirmar_repetido: !!confirmarRepetido };
  if(_ftBaixaArquivo){ body.arquivo_base64 = await _ftB64(_ftBaixaArquivo); body.nome_arquivo = _ftBaixaArquivo.name; body.media_type = _ftTipoArq(_ftBaixaArquivo); }
  try{
    const r = await fetch('/api/faturas/' + encodeURIComponent(id) + '/baixa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if(!d.ok){
      if(d.repetido && confirm(d.erro + '\n\nRegistrar mesmo assim?')) return ftRegistrarBaixa(id, true);
      if(!d.repetido) showToast(d.erro || 'Erro na baixa', 'err');
      return;
    }
    _ftBaixaArquivo = null;
    ftFecharModal();
    showToast(d.fatura.status === 'paga' ? 'Baixa registrada — fatura quitada.' : `Baixa parcial registrada — saldo ${_ftSimb(d.fatura.moeda)} ${_ftFmt(d.saldo)}.` + (d.aviso ? ' ' + d.aviso : ''), 'ok');
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
          <td><button class="btn btn-primary" style="padding:3px 10px;font-size:11px;" onclick="ftUsarComprovanteEm('${s.id}')">Usar</button></td></tr>`).join('')}</tbody></table>`
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
        <label style="flex:2;position:relative;">Empresa ${f.empresa_id ? '<span class="cr-vinc" style="position:static;" title="Vinculada ao cadastro">●</span>' : ''}<input class="form-input" id="ft_e_empresa" value="${esc(f.empresa_nome)}" autocomplete="off" oninput="autocompletarContato(this,'','ft_dd_empresa')"><div id="ft_dd_empresa" class="cr-dd" style="display:none;"></div></label>
      </div>
      <div class="ft-cand-campos">
        <label>Documento <input class="form-input" id="ft_e_doc" value="${esc(f.documento || '')}"></label>
        <label>Emissão <input class="form-input" type="date" id="ft_e_emissao" value="${esc(f.emissao || '')}"></label>
        <label>Vencimento <input class="form-input" type="date" id="ft_e_venc" value="${esc(f.vencimento || '')}"></label>
      </div>
      <div class="ft-cand-campos">
        <label>Moeda <select class="form-input" id="ft_e_moeda">${['BRL','USD','EUR'].map(m => `<option ${f.moeda === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label>Valor total <input class="form-input" id="ft_e_valor" value="${f.valor !== '' && f.valor != null ? _ftFmt(f.valor) : ''}" inputmode="decimal"></label>
        <label>Câmbio (se USD/EUR) <input class="form-input" id="ft_e_cambio" value="${f.cambio && f.moeda !== 'BRL' ? String(f.cambio).replace('.', ',') : ''}" placeholder="${(typeof _cambio !== 'undefined' && _cambio.USD) ? _cambio.USD.toFixed(4).replace('.', ',') : ''}" inputmode="decimal"></label>
      </div>
      <label class="cr-muted" style="display:block;margin-top:8px;">Observação <input class="form-input" id="ft_e_obs" style="width:100%;box-sizing:border-box;margin-top:4px;" value="${esc(f.obs || '')}"></label>
      ${id ? ((f.itens || []).length ? `<div class="cr-muted" style="margin-top:8px;">Itens: ${f.itens.map(it => `${esc(it.referencia || '')} ${esc(it.label)} ${_ftSimb(it.moeda)} ${_ftFmt(it.valor)}`).join(' · ')}</div>` : '')
        : `<div style="margin-top:12px;"><div class="cr-muted" style="font-weight:600;margin-bottom:4px;">Taxas desta fatura (processo + taxa ligam a fatura à aba Custos Reais)</div><div id="ft_e_itens">${_ftItensHtml()}</div></div>`}
    </div>
    <div class="ft-modal-foot"><button class="btn btn-outline" onclick="ftConferir(${id ? `'${id}'` : 'null'})">🔍 Conferir</button><button class="btn btn-outline" onclick="ftFecharModal()">Cancelar</button><button class="btn btn-primary" onclick="ftSalvarEdicao(${id ? `'${id}'` : 'null'})">Salvar</button></div>
  </div></div>`;
  // fatura lida pela IA ou já existente: confere sozinho ao abrir
  if(id || (pre && pre._ia)) ftConferir(id || null);
}
// Monta o corpo da fatura a partir do modal (usado no Salvar e na Conferência).
function _ftCorpoModal(id){
  const f = id ? _ftLista.find(x => x.id === id) : {};
  const moeda = document.getElementById('ft_e_moeda').value;
  const cx = parseFloat((document.getElementById('ft_e_cambio').value || '').replace(',', '.'));
  const body = { ...f, id: id || undefined, tipo: document.getElementById('ft_e_tipo').value, empresa_nome: document.getElementById('ft_e_empresa').value.trim(), documento: document.getElementById('ft_e_doc').value.trim(), moeda, valor: parseValorMoeda(document.getElementById('ft_e_valor').value), emissao: document.getElementById('ft_e_emissao').value || null, vencimento: document.getElementById('ft_e_venc').value || null, obs: document.getElementById('ft_e_obs').value.trim() };
  body.cambio = moeda === 'BRL' ? 1 : (cx > 0 ? cx : ((typeof _cambio !== 'undefined' && _cambio[moeda]) || null));
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
    const r = await fetch('/api/faturas/conferir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fatura: body, labels, cambio: (typeof _cambio !== 'undefined') ? _cambio : {} }) });
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
  try{
    const r = await fetch('/api/faturas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if(!d.ok){ showToast(d.erro || 'Erro ao salvar', 'err'); return; }
    // fatura lida pela IA: o PDF original fica anexado à fatura
    if(!id && _ftArquivoIA && d.faturas && d.faturas[0]){
      const arq = _ftArquivoIA; _ftArquivoIA = null;
      try{ await _ftEnviarAnexo(d.faturas[0].id, arq, 'fatura'); }catch(e){ showToast('Fatura salva, mas o PDF não foi anexado: ' + e.message, 'warn'); }
    }
    ftFecharModal(); showToast('Fatura salva' + (d.faturas && d.faturas[0] && d.faturas[0].numero ? ' — nº ' + d.faturas[0].numero : '') + '.', 'ok'); renderDashFaturas();
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
  if(arq.size > 15 * 1024 * 1024){ showToast('Arquivo grande demais (máx. 15 MB).', 'err'); return; }
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
