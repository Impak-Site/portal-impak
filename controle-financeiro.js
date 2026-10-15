// controle-financeiro.js — financeiro da empresa dentro da tela /faturas
// (14/10/2026): abas Bancos (saldos + transferências), DRE gerencial, Plano
// de contas / centros de custo, Importar do Conexos e Arquivo p/ contador.
// Regras de cálculo em fin-core.js (testadas em testes_fin.js).

let _finAba = 'faturas';
let _fin = null; // {contas, centros, bancos, grupos}
let _finFiltro = { de: '', ate: '', regime: 'caixa', centro: '' };

async function finCadastros(forcar){
  if(_fin && !forcar) return _fin;
  try{
    const d = await (await fetch('/api/fin/cadastros')).json();
    _fin = d.ok ? d : { contas: [], centros: [], bancos: [], grupos: (typeof FinCore !== 'undefined' ? FinCore.GRUPOS : []), erro: d.erro, semTabela: d.semTabela };
  }catch(e){ _fin = { contas: [], centros: [], bancos: [], grupos: [], erro: 'rede' }; }
  return _fin;
}
async function _finFaturasTodas(){
  const d = await (await fetch('/api/faturas')).json();
  return d.ok ? (d.faturas || []) : [];
}
function _finMoeda(v, m){ return (m === 'USD' ? 'US$ ' : m === 'EUR' ? '€ ' : 'R$ ') + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function _finUltimoDiaMes(iso){ const d = new Date(iso.slice(0, 7) + '-01T12:00:00'); d.setMonth(d.getMonth() + 1); d.setDate(0); return d.toISOString().slice(0, 10); }

function finTabsHtml(){
  const abas = [['faturas', '🧾 Faturas'], ['bancos', '🏦 Bancos e saldos'], ['dre', '📊 DRE da empresa'], ['plano', '🗂 Plano de contas'], ['importar', '⬆ Importar do Conexos'], ['contador', '📤 Arquivo p/ contador']];
  return `<div class="fin-tabs" style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px;border-bottom:1px solid var(--border);">${abas.map(([id, l]) => `<button class="btn ${_finAba === id ? 'btn-primary' : 'btn-outline'}" style="border-radius:8px 8px 0 0;padding:6px 12px;font-size:12px;" onclick="finIrAba('${id}')">${l}</button>`).join('')}</div>`;
}
function finIrAba(id){ _finAba = id; renderDashFaturas(); }
// chamado por renderDashFaturas quando a aba não é "faturas"
async function renderFinAba(el){
  el.innerHTML = finTabsHtml() + '<div class="cr-muted">Carregando…</div>';
  const fin = await finCadastros();
  if(fin.semTabela){ el.innerHTML = finTabsHtml() + '<div class="empty">Tabelas do financeiro ainda não criadas (migration 0053).</div>'; return; }
  let html = '';
  try{
    if(_finAba === 'bancos') html = await _finHtmlBancos();
    else if(_finAba === 'dre') html = await _finHtmlDre();
    else if(_finAba === 'plano') html = _finHtmlPlano();
    else if(_finAba === 'importar') html = _finHtmlImportar();
    else if(_finAba === 'contador') html = _finHtmlContador();
  }catch(e){ html = `<div class="empty">Erro: ${esc(e.message)}</div>`; }
  el.innerHTML = finTabsHtml() + html;
  if(_finAba === 'contador') finContadorPrevia();
}

// ── Seletores reutilizados no modal da fatura / baixa ──────────────
function finOpcoesContas(sel, tipo){
  const fin = _fin || { contas: [] };
  const grupos = (fin.grupos && fin.grupos.length ? fin.grupos : FinCore.GRUPOS);
  return `<option value="">— automático (pela taxa / tipo) —</option>` + grupos.map(([g, label]) => {
    const cs = fin.contas.filter(c => c.grupo === g && (c.ativo !== false || c.id === sel));
    return cs.length ? `<optgroup label="${esc(label)}">${cs.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.codigo + ' ' + c.nome)}</option>`).join('')}</optgroup>` : '';
  }).join('');
}
function finOpcoesCentros(sel){ const fin = _fin || { centros: [] }; return `<option value="">— sem centro de custo —</option>` + fin.centros.filter(c => c.ativo !== false || c.id === sel).map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc((c.codigo ? c.codigo + ' ' : '') + c.nome)}</option>`).join(''); }
function finOpcoesBancos(sel, moeda){
  const fin = _fin || { bancos: [] };
  const ativos = fin.bancos.filter(b => b.ativo !== false || b.id === sel);
  const padrao = sel || ((ativos.find(b => b.moeda === (moeda || 'BRL')) || ativos[0] || {}).id);
  return `<option value="">— conta não informada —</option>` + ativos.map(b => `<option value="${b.id}" ${b.id === padrao ? 'selected' : ''}>${esc(b.nome)}${b.moeda !== 'BRL' ? ' (' + b.moeda + ')' : ''}</option>`).join('');
}

// ── Bancos e saldos ─────────────────────────────────────────────────
async function _finHtmlBancos(){
  const [fats, trd] = await Promise.all([_finFaturasTodas(), fetch('/api/fin/transferencias').then(r => r.json()).catch(() => ({}))]);
  const transf = (trd && trd.transferencias) || [];
  window._finTransf = transf;
  const s = FinCore.saldosBancarios(_fin.bancos.filter(b => b.ativo !== false), fats, transf, (typeof _cambio !== 'undefined') ? _cambio : {});
  const totalBRL = s.contas.filter(c => c.moeda === 'BRL').reduce((t, c) => t + c.saldo, 0);
  const cards = s.contas.map(c => {
    const b = _fin.bancos.find(x => x.id === c.id) || {};
    return `<div class="ft-card" style="border-left:4px solid var(--ac);min-width:220px;">
      <div class="ft-card-l">${esc(c.nome)}${b.banco ? ' · ' + esc(b.banco) : ''}</div>
      <div class="ft-card-v" style="color:${c.saldo < 0 ? 'var(--err)' : 'inherit'};">${_finMoeda(c.saldo, c.moeda)}</div>
      <div class="cr-muted" style="font-size:11px;">inicial ${_finMoeda(c.inicial, c.moeda)}${c.desde ? ' em ' + _ftData(c.desde) : ''} · +${_finMoeda(c.entradas, c.moeda)} · −${_finMoeda(c.saidas, c.moeda)}${c.transf ? ' · transf. ' + _finMoeda(c.transf, c.moeda) : ''}</div>
      <a class="cr-link" style="font-size:11px;" onclick="finEditarBanco('${c.id}')">editar</a>
    </div>`;
  }).join('');
  const trHtml = transf.length ? `<table class="ft-itens" style="width:100%;"><thead><tr><th>Data</th><th>De</th><th>Para</th><th style="text-align:right;">Valor</th><th>Obs</th><th></th></tr></thead><tbody>${transf.slice(0, 100).map(t => {
      const de = _fin.bancos.find(b => b.id === t.de_banco_id) || {}, pa = _fin.bancos.find(b => b.id === t.para_banco_id) || {};
      return `<tr style="${t.estornado ? 'opacity:.5;text-decoration:line-through;' : ''}"><td>${_ftData(t.data)}</td><td>${esc(de.nome || '?')}</td><td>${esc(pa.nome || '?')}</td><td style="text-align:right;">${_finMoeda(t.valor, de.moeda)}</td><td>${esc(t.obs || '')}</td><td>${t.estornado ? 'estornada' : `<a class="cr-link" onclick="finEstornarTransf('${t.id}')">estornar</a>`}</td></tr>`;
    }).join('')}</tbody></table>` : '<div class="cr-muted">Nenhuma transferência.</div>';
  return `<div class="ft-filtros"><button class="btn btn-primary" onclick="finEditarBanco()">+ Conta bancária</button><button class="btn btn-outline" onclick="finNovaTransferencia()" ${_fin.bancos.filter(b => b.ativo !== false).length < 2 ? 'disabled title="Cadastre ao menos 2 contas"' : ''}>⇄ Transferência entre contas</button></div>
    ${s.contas.length ? `<div class="ft-cards" style="flex-wrap:wrap;">${cards}</div><div style="margin:6px 0 14px;font-size:13px;">Total em contas R$: <b>${_finMoeda(totalBRL)}</b></div>` : '<div class="empty">Nenhuma conta bancária cadastrada ainda. Cadastre as contas (com saldo inicial numa data) e informe a conta em cada baixa — o saldo passa a ser calculado sozinho.</div>'}
    ${s.semBanco.qtd ? `<div class="cr-muted" style="background:#fffaeb;border:1px solid #fedf89;border-radius:8px;padding:8px 10px;margin-bottom:12px;">⚠️ ${s.semBanco.qtd} baixa(s) sem conta bancária informada (entradas ${_finMoeda(s.semBanco.entradas)} · saídas ${_finMoeda(s.semBanco.saidas)}) — não entram em nenhum saldo.</div>` : ''}
    <div style="font-weight:600;font-size:13px;margin:10px 0 6px;">Transferências entre contas</div>${trHtml}`;
}
function finEditarBanco(id){
  const b = id ? _fin.bancos.find(x => x.id === id) : { moeda: 'BRL', ativo: true };
  const ov = _ftOverlay();
  ov.innerHTML = `<div class="ft-modal-bg" onclick="if(event.target===this) ftFecharModal()"><div class="ft-modal" style="max-width:520px;">
    <div class="ft-modal-head"><span>${id ? 'Editar conta bancária' : 'Nova conta bancária'}</span><button class="btn btn-outline" onclick="ftFecharModal()">✕</button></div>
    <div class="ft-modal-body">
      <div class="ft-cand-campos"><label style="flex:2;">Nome (apelido) <input class="form-input" id="fb_nome" value="${esc(b.nome || '')}" placeholder="ex.: Itaú movimento"></label><label>Moeda <select class="form-input" id="fb_moeda">${['BRL', 'USD', 'EUR'].map(m => `<option ${b.moeda === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label></div>
      <div class="ft-cand-campos"><label>Banco <input class="form-input" id="fb_banco" value="${esc(b.banco || '')}"></label><label>Agência <input class="form-input" id="fb_ag" value="${esc(b.agencia || '')}"></label><label>Conta <input class="form-input" id="fb_conta" value="${esc(b.conta || '')}"></label></div>
      <div class="ft-cand-campos"><label>Saldo inicial <input class="form-input" id="fb_saldo" value="${b.saldo_inicial != null ? _ftFmt(b.saldo_inicial) : ''}" inputmode="decimal"></label><label>Na data <input class="form-input" type="date" id="fb_saldo_em" value="${esc(b.saldo_inicial_em || '')}"></label><label>Conta contábil <input class="form-input" id="fb_cc" value="${esc(b.conta_contabil || '')}" placeholder="do contador (opcional)"></label></div>
      <div class="cr-muted" style="font-size:11px;margin-top:6px;">O saldo inicial deve ser o saldo do extrato no fim do dia anterior à data informada. Baixas antes dessa data não entram no saldo.</div>
      ${id ? `<label style="display:flex;gap:6px;align-items:center;margin-top:8px;font-size:12px;"><input type="checkbox" id="fb_ativo" ${b.ativo !== false ? 'checked' : ''}> Conta ativa (desmarque para desativar — o histórico continua)</label>` : ''}
    </div>
    <div class="ft-modal-foot"><button class="btn btn-outline" onclick="ftFecharModal()">Cancelar</button><button class="btn btn-primary" onclick="finSalvarBanco(${id ? `'${id}'` : 'null'})">Salvar</button></div>
  </div></div>`;
}
async function finSalvarBanco(id){
  const v = x => document.getElementById(x).value;
  const body = { id: id || undefined, nome: v('fb_nome'), moeda: v('fb_moeda'), banco: v('fb_banco'), agencia: v('fb_ag'), conta: v('fb_conta'), saldo_inicial: v('fb_saldo'), saldo_inicial_em: v('fb_saldo_em'), conta_contabil: v('fb_cc'), ativo: id ? document.getElementById('fb_ativo').checked : true };
  const d = await (await fetch('/api/fin/bancos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  if(!d.ok){ showToast(d.erro || 'Erro', 'err'); return; }
  ftFecharModal(); await finCadastros(true); showToast('Conta salva.', 'ok'); renderDashFaturas();
}
function finNovaTransferencia(){
  const ov = _ftOverlay();
  ov.innerHTML = `<div class="ft-modal-bg" onclick="if(event.target===this) ftFecharModal()"><div class="ft-modal" style="max-width:520px;">
    <div class="ft-modal-head"><span>⇄ Transferência entre contas</span><button class="btn btn-outline" onclick="ftFecharModal()">✕</button></div>
    <div class="ft-modal-body">
      <div class="ft-cand-campos"><label>De <select class="form-input" id="ftr_de">${finOpcoesBancos('', 'BRL')}</select></label><label>Para <select class="form-input" id="ftr_para">${finOpcoesBancos('', 'BRL')}</select></label></div>
      <div class="ft-cand-campos"><label>Data <input class="form-input" type="date" id="ftr_data" value="${_ftHoje()}"></label><label>Valor <input class="form-input" id="ftr_valor" inputmode="decimal"></label><label>Valor creditado (se outra moeda) <input class="form-input" id="ftr_vd" inputmode="decimal"></label></div>
      <label class="cr-muted" style="display:block;margin-top:6px;">Observação <input class="form-input" id="ftr_obs" style="width:100%;box-sizing:border-box;margin-top:4px;"></label>
    </div>
    <div class="ft-modal-foot"><button class="btn btn-outline" onclick="ftFecharModal()">Cancelar</button><button class="btn btn-primary" onclick="finSalvarTransf()">Registrar</button></div>
  </div></div>`;
}
async function finSalvarTransf(){
  const v = x => document.getElementById(x).value;
  const d = await (await fetch('/api/fin/transferencias', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ de_banco_id: v('ftr_de'), para_banco_id: v('ftr_para'), data: v('ftr_data'), valor: v('ftr_valor'), valor_destino: v('ftr_vd'), obs: v('ftr_obs') }) })).json();
  if(!d.ok){ showToast(d.erro || 'Erro', 'err'); return; }
  ftFecharModal(); showToast('Transferência registrada.', 'ok'); renderDashFaturas();
}
async function finEstornarTransf(id){
  const motivo = prompt('Motivo do estorno (a transferência fica no histórico, riscada):'); if(motivo === null) return;
  const d = await (await fetch('/api/fin/transferencias/' + encodeURIComponent(id) + '/estornar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motivo }) })).json();
  if(!d.ok){ showToast(d.erro || 'Erro', 'err'); return; }
  showToast('Transferência estornada.', 'ok'); renderDashFaturas();
}

// ── DRE da empresa ──────────────────────────────────────────────────
async function _finHtmlDre(){
  if(!_finFiltro.de){ const h = _ftHoje(); _finFiltro.de = h.slice(0, 8) + '01'; _finFiltro.ate = _finUltimoDiaMes(h); }
  let fats = await _finFaturasTodas();
  if(_finFiltro.centro) fats = fats.filter(f => f.centro_custo_id === _finFiltro.centro);
  const d = FinCore.dreEmpresa(fats, _fin.contas, { de: _finFiltro.de, ate: _finFiltro.ate, regime: _finFiltro.regime, cambio: (typeof _cambio !== 'undefined') ? _cambio : {} });
  window._finDreAtual = d;
  const linhaTot = (l, v, forte) => `<tr style="background:var(--bg);${forte ? 'font-weight:800;' : 'font-weight:700;'}"><td>${l}</td><td style="text-align:right;color:${v < 0 ? 'var(--err)' : 'inherit'};">${_finMoeda(v)}</td></tr>`;
  const bloco = id => { const g = d.grupos.find(x => x.id === id); if(!g) return ''; return `<tr style="font-weight:600;"><td>${esc(g.label)}</td><td style="text-align:right;">${_finMoeda(g.total)}</td></tr>` + g.contas.map(c => `<tr><td style="padding-left:22px;" class="cr-muted">${esc(c.codigo)} ${esc(c.nome)}</td><td style="text-align:right;" class="cr-muted">${_finMoeda(c.valor)}</td></tr>`).join(''); };
  const neutra = d.grupos.find(g => g.id === 'neutra');
  return `<div class="ft-filtros">
      <label class="cr-muted">de <input class="form-input" type="date" value="${esc(_finFiltro.de)}" onchange="_finFiltro.de=this.value;renderDashFaturas()"></label>
      <label class="cr-muted">até <input class="form-input" type="date" value="${esc(_finFiltro.ate)}" onchange="_finFiltro.ate=this.value;renderDashFaturas()"></label>
      <select class="form-input" onchange="_finFiltro.regime=this.value;renderDashFaturas()"><option value="caixa" ${_finFiltro.regime === 'caixa' ? 'selected' : ''}>Regime de caixa (pelo pagamento)</option><option value="competencia" ${_finFiltro.regime === 'competencia' ? 'selected' : ''}>Competência (pela emissão)</option></select>
      <select class="form-input" onchange="_finFiltro.centro=this.value;renderDashFaturas()">${finOpcoesCentros(_finFiltro.centro).replace('— sem centro de custo —', 'Todos os centros de custo')}</select>
      <button class="btn btn-outline" onclick="finExportarDre()">⬇ Excel</button>
    </div>
    <div class="cr-muted" style="font-size:11px;margin-bottom:8px;">DRE gerencial montado pelas faturas. Fatura sem conta escolhida é classificada pela taxa do processo (FOB, frete, impostos, despesas portuárias, comissões) ou, se a receber, como venda/reembolso. Não substitui o DRE contábil do contador.</div>
    <table class="ft-itens" style="width:100%;max-width:760px;font-size:12.5px;"><tbody>
      ${bloco('receita_bruta')}${bloco('deducoes')}${linhaTot('= Receita líquida', d.receitaLiquida)}
      ${bloco('custo')}${linhaTot('= Lucro bruto', d.lucroBruto)}
      ${bloco('despesa_operacional')}${linhaTot('= Resultado operacional', d.resultadoOperacional)}
      ${bloco('receita_financeira')}${bloco('despesa_financeira')}${linhaTot('= Resultado antes de IR/CSLL', d.resultadoAntesIR)}
      ${bloco('impostos_lucro')}${linhaTot('= Resultado líquido', d.resultadoLiquido, true)}
    </tbody></table>
    ${neutra && neutra.contas.length ? `<div class="cr-muted" style="margin-top:10px;font-size:11.5px;">Fora do DRE (repasses, empréstimos, distribuição): ${neutra.contas.map(c => esc(c.nome) + ' ' + _finMoeda(c.valor)).join(' · ')}</div>` : ''}`;
}
async function finExportarDre(){
  const d = window._finDreAtual; if(!d || typeof ExcelJS === 'undefined') return;
  const wb = new ExcelJS.Workbook(); const s = wb.addWorksheet('DRE');
  s.columns = [{ header: `DRE ${d.regime === 'caixa' ? '(caixa)' : '(competência)'} ${d.de} a ${d.ate}`, width: 60 }, { header: 'R$', width: 18 }];
  const add = (l, v, b) => { const r = s.addRow([l, v]); if(b) r.font = { bold: true }; r.getCell(2).numFmt = '#,##0.00'; };
  const grupo = id => { const g = d.grupos.find(x => x.id === id); if(!g) return; add(g.label, g.total, true); g.contas.forEach(c => add('   ' + c.codigo + ' ' + c.nome, c.valor)); };
  grupo('receita_bruta'); grupo('deducoes'); add('= Receita líquida', d.receitaLiquida, true); grupo('custo'); add('= Lucro bruto', d.lucroBruto, true);
  grupo('despesa_operacional'); add('= Resultado operacional', d.resultadoOperacional, true); grupo('receita_financeira'); grupo('despesa_financeira');
  add('= Resultado antes de IR/CSLL', d.resultadoAntesIR, true); grupo('impostos_lucro'); add('= Resultado líquido', d.resultadoLiquido, true);
  s.getRow(1).font = { bold: true };
  _finBaixar(await wb.xlsx.writeBuffer(), `dre-${d.de}-${d.ate}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
function _finBaixar(conteudo, nome, tipo){ const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([conteudo], { type: tipo })); a.download = nome; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

// ── Plano de contas e centros de custo ──────────────────────────────
function _finHtmlPlano(){
  const grupos = _fin.grupos && _fin.grupos.length ? _fin.grupos : FinCore.GRUPOS;
  const linhas = _fin.contas.map(c => `<tr style="${c.ativo === false ? 'opacity:.5;' : ''}"><td style="font-family:'JetBrains Mono',monospace;">${esc(c.codigo)}</td><td>${esc(c.nome)}</td><td class="cr-muted">${esc((grupos.find(g => g[0] === c.grupo) || [, c.grupo])[1])}</td><td class="cr-muted">${esc(c.conta_contabil || '—')}</td><td>${c.ativo === false ? 'inativa' : ''}</td><td><a class="cr-link" onclick="finEditarConta('${c.id}')">editar</a></td></tr>`).join('');
  const centros = _fin.centros.map(c => `<tr style="${c.ativo === false ? 'opacity:.5;' : ''}"><td>${esc(c.codigo || '')}</td><td>${esc(c.nome)}</td><td>${c.ativo === false ? 'inativo' : ''}</td><td><a class="cr-link" onclick="finEditarCentro('${c.id}')">editar</a></td></tr>`).join('');
  return `<div style="display:grid;grid-template-columns:2fr 1fr;gap:18px;align-items:start;">
    <div><div class="ft-filtros"><b style="font-size:13px;">Plano de contas (gerencial)</b><button class="btn btn-primary" onclick="finEditarConta()">+ Conta</button></div>
      <div class="cr-muted" style="font-size:11px;margin-bottom:6px;">O grupo decide a linha do DRE. "Conta contábil" é o código do plano do contador — usado no arquivo de lançamentos.</div>
      <table class="ft-itens" style="width:100%;"><thead><tr><th>Código</th><th>Conta</th><th>Grupo no DRE</th><th>Conta contábil</th><th></th><th></th></tr></thead><tbody>${linhas}</tbody></table></div>
    <div><div class="ft-filtros"><b style="font-size:13px;">Centros de custo</b><button class="btn btn-primary" onclick="finEditarCentro()">+ Centro</button></div>
      <div class="cr-muted" style="font-size:11px;margin-bottom:6px;">Ex.: Administrativo, Comercial, Operações, Filial SC.</div>
      ${centros ? `<table class="ft-itens" style="width:100%;"><thead><tr><th>Cód.</th><th>Nome</th><th></th><th></th></tr></thead><tbody>${centros}</tbody></table>` : '<div class="cr-muted">Nenhum centro de custo.</div>'}</div>
  </div>`;
}
function finEditarConta(id){
  const c = id ? _fin.contas.find(x => x.id === id) : { grupo: 'despesa_operacional', ativo: true };
  const grupos = _fin.grupos && _fin.grupos.length ? _fin.grupos : FinCore.GRUPOS;
  const ov = _ftOverlay();
  ov.innerHTML = `<div class="ft-modal-bg" onclick="if(event.target===this) ftFecharModal()"><div class="ft-modal" style="max-width:520px;">
    <div class="ft-modal-head"><span>${id ? 'Editar conta' : 'Nova conta'}</span><button class="btn btn-outline" onclick="ftFecharModal()">✕</button></div>
    <div class="ft-modal-body">
      <div class="ft-cand-campos"><label>Código <input class="form-input" id="fc_cod" value="${esc(c.codigo || '')}" placeholder="5.1.10"></label><label style="flex:2;">Nome <input class="form-input" id="fc_nome" value="${esc(c.nome || '')}"></label></div>
      <div class="ft-cand-campos"><label style="flex:2;">Grupo no DRE <select class="form-input" id="fc_grupo">${grupos.map(([g, l]) => `<option value="${g}" ${c.grupo === g ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label><label>Conta contábil <input class="form-input" id="fc_cc" value="${esc(c.conta_contabil || '')}"></label></div>
      ${id ? `<label style="display:flex;gap:6px;align-items:center;margin-top:8px;font-size:12px;"><input type="checkbox" id="fc_ativo" ${c.ativo !== false ? 'checked' : ''}> Conta ativa</label>` : ''}
    </div>
    <div class="ft-modal-foot"><button class="btn btn-outline" onclick="ftFecharModal()">Cancelar</button><button class="btn btn-primary" onclick="finSalvarConta(${id ? `'${id}'` : 'null'})">Salvar</button></div>
  </div></div>`;
}
async function finSalvarConta(id){
  const v = x => document.getElementById(x).value;
  const d = await (await fetch('/api/fin/contas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id || undefined, codigo: v('fc_cod'), nome: v('fc_nome'), grupo: v('fc_grupo'), conta_contabil: v('fc_cc'), ativo: id ? document.getElementById('fc_ativo').checked : true }) })).json();
  if(!d.ok){ showToast(d.erro || 'Erro', 'err'); return; }
  ftFecharModal(); await finCadastros(true); showToast('Conta salva.', 'ok'); renderDashFaturas();
}
function finEditarCentro(id){
  const c = id ? _fin.centros.find(x => x.id === id) : { ativo: true };
  const ov = _ftOverlay();
  ov.innerHTML = `<div class="ft-modal-bg" onclick="if(event.target===this) ftFecharModal()"><div class="ft-modal" style="max-width:420px;">
    <div class="ft-modal-head"><span>${id ? 'Editar centro de custo' : 'Novo centro de custo'}</span><button class="btn btn-outline" onclick="ftFecharModal()">✕</button></div>
    <div class="ft-modal-body"><div class="ft-cand-campos"><label>Código <input class="form-input" id="fcc_cod" value="${esc(c.codigo || '')}"></label><label style="flex:2;">Nome <input class="form-input" id="fcc_nome" value="${esc(c.nome || '')}"></label></div>
      ${id ? `<label style="display:flex;gap:6px;align-items:center;margin-top:8px;font-size:12px;"><input type="checkbox" id="fcc_ativo" ${c.ativo !== false ? 'checked' : ''}> Ativo</label>` : ''}</div>
    <div class="ft-modal-foot"><button class="btn btn-outline" onclick="ftFecharModal()">Cancelar</button><button class="btn btn-primary" onclick="finSalvarCentro(${id ? `'${id}'` : 'null'})">Salvar</button></div>
  </div></div>`;
}
async function finSalvarCentro(id){
  const v = x => document.getElementById(x).value;
  const d = await (await fetch('/api/fin/centros', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id || undefined, codigo: v('fcc_cod'), nome: v('fcc_nome'), ativo: id ? document.getElementById('fcc_ativo').checked : true }) })).json();
  if(!d.ok){ showToast(d.erro || 'Erro', 'err'); return; }
  ftFecharModal(); await finCadastros(true); showToast('Centro salvo.', 'ok'); renderDashFaturas();
}

// ── Importar títulos em aberto do Conexos ──────────────────────────
let _finImp = null; // {cab, linhas, mapa, nome}
const _FIN_CAMPOS_IMP = [['tipo', 'Tipo (pagar/receber)'], ['empresa', 'Pessoa / empresa *'], ['cnpj', 'CNPJ/CPF'], ['documento', 'Nº documento'], ['emissao', 'Emissão'], ['vencimento', 'Vencimento'], ['valor', 'Valor original *'], ['saldo', 'Saldo em aberto'], ['moeda', 'Moeda'], ['obs', 'Histórico / obs.'], ['id', 'ID / código no Conexos'], ['conta', 'Conta / plano'], ['centro', 'Centro de custo']];
function _finHtmlImportar(){
  if(!_finImp) return `<div style="max-width:760px;">
    <div style="font-size:13px;margin-bottom:8px;"><b>Trazer os títulos em aberto do Conexos</b></div>
    <ol class="cr-muted" style="font-size:12px;line-height:1.7;">
      <li>No Conexos, exporte a lista de <b>contas a pagar</b> e/ou <b>a receber em aberto</b> para Excel (.xlsx) ou CSV.</li>
      <li>Envie o arquivo aqui. O sistema reconhece as colunas (pessoa, documento, vencimento, valor, saldo…); você confere e ajusta.</li>
      <li>Nada é gravado até você clicar em "Importar". Títulos já importados antes são pulados (não duplica).</li>
      <li>Se o título já estava parcialmente pago no Conexos, a parte paga vira uma baixa "Pago no Conexos antes da migração".</li>
    </ol>
    <button class="btn btn-primary" onclick="finEscolherPlanilha()">⬆ Escolher planilha do Conexos</button>
  </div>`;
  const { cab, linhas, mapa } = _finImp;
  const sel = campo => `<select class="form-input fin-map" data-c="${campo}" style="padding:3px 6px;font-size:11px;" onchange="finImpMapa()"><option value="">—</option>${cab.map((h, i) => `<option value="${i}" ${mapa[campo] === i ? 'selected' : ''}>${esc(h || 'coluna ' + (i + 1))}</option>`).join('')}</select>`;
  const prev = _finImpProcessar();
  return `<div class="ft-filtros"><b style="font-size:13px;">${esc(_finImp.nome)}</b> <span class="cr-muted">${linhas.length} linha(s)</span> <a class="cr-link" onclick="_finImp=null;renderDashFaturas()">trocar arquivo</a></div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px 12px;font-size:11.5px;margin-bottom:10px;">${_FIN_CAMPOS_IMP.map(([c, l]) => `<label>${l}<br>${sel(c)}</label>`).join('')}
      <label>Tipo quando a coluna não disser<br><select class="form-input" id="fin_imp_tipo" style="padding:3px 6px;font-size:11px;" onchange="finImpMapa()"><option value="">— exigir coluna —</option><option value="pagar" ${_finImp.tipoPadrao === 'pagar' ? 'selected' : ''}>A pagar</option><option value="receber" ${_finImp.tipoPadrao === 'receber' ? 'selected' : ''}>A receber</option></select></label>
      <label>Data das baixas "pago no Conexos"<br><input class="form-input" type="date" id="fin_imp_data" value="${esc(_finImp.dataMig || _ftHoje())}" style="padding:3px 6px;font-size:11px;" onchange="_finImp.dataMig=this.value"></label></div>
    <div style="margin-bottom:8px;font-size:12.5px;">✅ <b>${prev.ok.length}</b> prontos para importar (a pagar ${_finMoeda(prev.totPagar)} · a receber ${_finMoeda(prev.totReceber)}) · ⏭ ${prev.quitados} já quitados · ⚠️ ${prev.erros.length} com problema</div>
    <div style="max-height:340px;overflow:auto;"><table class="ft-itens" style="width:100%;font-size:11.5px;"><thead><tr><th>#</th><th>Tipo</th><th>Empresa</th><th>Documento</th><th>Venc.</th><th style="text-align:right;">Valor</th><th style="text-align:right;">Saldo</th><th>Conta</th><th>Situação</th></tr></thead><tbody>
      ${prev.todas.slice(0, 300).map(r => `<tr style="${r.ok ? '' : 'opacity:.6;'}"><td>${r.linha}</td><td>${r.ok ? (r.fatura.tipo === 'pagar' ? 'Pagar' : 'Receber') : ''}</td><td>${esc(r.ok ? r.fatura.empresa_nome : (r.bruto || ''))}</td><td>${r.ok ? esc(r.fatura.documento || '') : ''}</td><td>${r.ok ? _ftData(r.fatura.vencimento) : ''}</td><td style="text-align:right;">${r.ok ? _finMoeda(r.fatura.valor, r.fatura.moeda) : ''}</td><td style="text-align:right;">${r.ok ? _finMoeda(r.saldo, r.fatura.moeda) : ''}</td><td class="cr-muted">${r.ok ? esc(r.contaNome || '') : ''}</td><td>${r.ok ? '✅' : '⚠️ ' + esc(r.erro)}</td></tr>`).join('')}
    </tbody></table></div>
    <div style="margin-top:10px;"><button class="btn btn-primary" onclick="finImportarConfirmar()" ${prev.ok.length ? '' : 'disabled'}>Importar ${prev.ok.length} título(s)</button></div>`;
}
function finEscolherPlanilha(){
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.csv,.txt'; inp.style.display = 'none';
  inp.onchange = async () => {
    const arq = inp.files && inp.files[0]; inp.remove(); if(!arq) return;
    try{
      let grade = [];
      if(/\.xlsx$/i.test(arq.name)){
        const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await arq.arrayBuffer());
        const ws = wb.worksheets[0];
        const cel = v => v == null ? '' : (v instanceof Date ? v : typeof v === 'object' ? (v.result != null ? v.result : v.text != null ? v.text : v.richText ? v.richText.map(t => t.text).join('') : '') : v);
        ws.eachRow({ includeEmpty: false }, row => { const arr = []; row.eachCell({ includeEmpty: true }, (c, i) => { arr[i - 1] = cel(c.value); }); grade.push(arr); });
      } else {
        let txt = await arq.text(); if(/�/.test(txt)) txt = new TextDecoder('iso-8859-1').decode(await arq.arrayBuffer());
        const ls = txt.replace(/\r/g, '').split('\n').filter(l => l.trim());
        const sep = (ls[0].match(/;/g) || []).length >= (ls[0].match(/,/g) || []).length ? ';' : ',';
        grade = ls.map(l => l.split(sep).map(c => c.replace(/^"|"$/g, '').trim()));
      }
      // linha de cabeçalho = a que mais casa com as pistas, entre as 15 primeiras
      let melhor = 0, idx = 0;
      grade.slice(0, 15).forEach((r, i) => { const n = Object.keys(FinCore.adivinharColunas((r || []).map(x => String(x || '')))).length; if(n > melhor){ melhor = n; idx = i; } });
      const cab = (grade[idx] || []).map(x => String(x || '').trim());
      const linhas = grade.slice(idx + 1).filter(r => r && r.some(x => String(x == null ? '' : x).trim() !== ''));
      _finImp = { nome: arq.name, cab, linhas, mapa: FinCore.adivinharColunas(cab), tipoPadrao: /receb/i.test(arq.name) ? 'receber' : /pag/i.test(arq.name) ? 'pagar' : '', dataMig: _ftHoje(), linhaCab: idx };
      renderDashFaturas();
    }catch(e){ showToast('Não consegui ler o arquivo: ' + e.message, 'err'); }
  };
  document.body.appendChild(inp); inp.click();
}
function finImpMapa(){
  const mapa = {};
  document.querySelectorAll('.fin-map').forEach(s => { if(s.value !== '') mapa[s.dataset.c] = +s.value; });
  _finImp.mapa = mapa; _finImp.tipoPadrao = document.getElementById('fin_imp_tipo').value;
  renderDashFaturas();
}
function _finImpProcessar(){
  const { linhas, mapa, tipoPadrao, linhaCab } = _finImp;
  const todas = [], ok = [], erros = []; let quitados = 0, totPagar = 0, totReceber = 0;
  const contaPorTexto = t => { if(!t) return null; const s = String(t).trim().toLowerCase(); return _fin.contas.find(c => c.codigo.toLowerCase() === s || c.nome.toLowerCase() === s || (c.conta_contabil || '').toLowerCase() === s) || null; };
  const centroPorTexto = t => { if(!t) return null; const s = String(t).trim().toLowerCase(); return _fin.centros.find(c => (c.codigo || '').toLowerCase() === s || c.nome.toLowerCase() === s) || null; };
  linhas.forEach((cols, i) => {
    const r = FinCore.linhaParaFatura(cols, mapa, { tipoPadrao: tipoPadrao || null });
    r.linha = (linhaCab || 0) + i + 2;
    if(!r.ok){ if(r.quitado) quitados++; else erros.push(r); r.bruto = cols.filter(Boolean).slice(0, 3).join(' · '); todas.push(r); return; }
    const conta = contaPorTexto(r.fatura.externo.conta); if(conta){ r.fatura.conta_id = conta.id; r.contaNome = conta.codigo + ' ' + conta.nome; } else if(r.fatura.externo.conta) r.contaNome = '(sem correspondência: ' + r.fatura.externo.conta + ')';
    const centro = centroPorTexto(r.fatura.externo.centro); if(centro) r.fatura.centro_custo_id = centro.id;
    r.fatura.externo.chave = FinCore.chaveImportacao(r.fatura);
    if(r.fatura.tipo === 'pagar') totPagar += r.saldo; else totReceber += r.saldo;
    ok.push(r); todas.push(r);
  });
  return { todas, ok, erros, quitados, totPagar, totReceber };
}
async function finImportarConfirmar(){
  const prev = _finImpProcessar();
  if(!confirm(`Importar ${prev.ok.length} título(s) em aberto do Conexos?\n\nA pagar: ${_finMoeda(prev.totPagar)}\nA receber: ${_finMoeda(prev.totReceber)}\n\nTítulos já importados antes serão pulados.`)) return;
  const dataMig = (document.getElementById('fin_imp_data') || {}).value || _ftHoje();
  let criadas = 0, pulados = 0; const erros = [];
  for(let i = 0; i < prev.ok.length; i += 200){
    const lote = prev.ok.slice(i, i + 200).map(r => ({ linha: r.linha, fatura: r.fatura, jaPago: r.jaPago }));
    try{
      const d = await (await fetch('/api/faturas/importar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ linhas: lote, data_migracao: dataMig }) })).json();
      if(!d.ok){ erros.push(d.erro || 'erro'); break; }
      criadas += d.criadas; pulados += (d.pulados || []).length; (d.erros || []).forEach(e => erros.push(`linha ${e.linha}: ${e.erro}`));
    }catch(e){ erros.push('erro de rede'); break; }
  }
  alert(`Importação concluída.\n\nCriadas: ${criadas}\nJá existiam (puladas): ${pulados}${erros.length ? '\n\nProblemas:\n' + erros.slice(0, 20).join('\n') : ''}`);
  _finImp = null; _finAba = 'faturas'; renderDashFaturas();
}

// ── Arquivo para o contador ─────────────────────────────────────────
function _finHtmlContador(){
  if(!_finFiltro.de){ const h = _ftHoje(); _finFiltro.de = h.slice(0, 8) + '01'; _finFiltro.ate = _finUltimoDiaMes(h); }
  return `<div class="ft-filtros">
      <label class="cr-muted">de <input class="form-input" type="date" id="fin_ct_de" value="${esc(_finFiltro.de)}" onchange="_finFiltro.de=this.value;finContadorPrevia()"></label>
      <label class="cr-muted">até <input class="form-input" type="date" id="fin_ct_ate" value="${esc(_finFiltro.ate)}" onchange="_finFiltro.ate=this.value;finContadorPrevia()"></label>
      <button class="btn btn-primary" onclick="finContadorBaixar('csv')">⬇ CSV (;)</button><button class="btn btn-outline" onclick="finContadorBaixar('xlsx')">⬇ Excel</button>
    </div>
    <div class="cr-muted" style="font-size:11.5px;margin-bottom:8px;max-width:820px;">Lançamentos de partidas dobradas de todo pagamento e recebimento do período (débito, crédito, valor, histórico). Contas: usa a "conta contábil" cadastrada no Plano de contas e em cada conta bancária; sem ela, sai o código gerencial. É um modelo genérico — mostre ao contador; se o sistema dele exigir um layout específico (Domínio, Alterdata, etc.), ajustamos o arquivo.</div>
    <div id="fin_ct_prev" class="cr-muted">Calculando…</div>`;
}
async function finContadorPrevia(){
  const el = document.getElementById('fin_ct_prev'); if(!el) return;
  const fats = await _finFaturasTodas();
  const l = FinCore.lancamentosContabeis(fats, _fin.contas, _fin.bancos, { de: _finFiltro.de, ate: _finFiltro.ate });
  window._finLanc = l;
  const tot = l.reduce((s, x) => s + x.valor, 0);
  const semConta = l.filter(x => /^[0-9]\.[0-9]\.[0-9]{2}$/.test(x.debito) || /^[0-9]\.[0-9]\.[0-9]{2}$/.test(x.credito) || /não informado/.test(x.debito + x.credito)).length;
  el.innerHTML = `<div style="margin-bottom:6px;font-size:12.5px;"><b>${l.length}</b> lançamento(s) · total ${_finMoeda(tot)}${semConta ? ` · <span style="color:#8a5a00;">${semConta} com conta gerencial/banco não informado (cadastre a conta contábil)</span>` : ''}</div>
    <div style="max-height:380px;overflow:auto;"><table class="ft-itens" style="width:100%;font-size:11.5px;"><thead><tr><th>Data</th><th>Débito</th><th>Crédito</th><th style="text-align:right;">Valor</th><th>Histórico</th></tr></thead><tbody>${l.slice(0, 300).map(x => `<tr><td>${_ftData(x.data)}</td><td>${esc(x.debito)}</td><td>${esc(x.credito)}</td><td style="text-align:right;">${_finMoeda(x.valor)}</td><td>${esc(x.historico)}</td></tr>`).join('')}</tbody></table></div>`;
}
async function finContadorBaixar(fmt){
  const l = window._finLanc || []; if(!l.length){ showToast('Nada no período.', 'warn'); return; }
  const cab = ['Data', 'Débito', 'Crédito', 'Valor', 'Histórico', 'Documento', 'Participante', 'Fatura'];
  const nome = `lancamentos-${_finFiltro.de}-${_finFiltro.ate}`;
  if(fmt === 'csv'){
    const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
    const linhas = [cab.join(';')].concat(l.map(x => [x.data.split('-').reverse().join('/'), x.debito, x.credito, x.valor.toFixed(2).replace('.', ','), x.historico, x.documento, x.participante, x.fatura].map(q).join(';')));
    _finBaixar('﻿' + linhas.join('\r\n'), nome + '.csv', 'text/csv;charset=utf-8');
    return;
  }
  const wb = new ExcelJS.Workbook(); const s = wb.addWorksheet('Lançamentos');
  s.columns = cab.map((h, i) => ({ header: h, width: [11, 22, 22, 14, 60, 18, 30, 12][i] }));
  l.forEach(x => { const r = s.addRow([x.data.split('-').reverse().join('/'), x.debito, x.credito, x.valor, x.historico, x.documento, x.participante, x.fatura]); r.getCell(4).numFmt = '#,##0.00'; });
  s.getRow(1).font = { bold: true };
  _finBaixar(await wb.xlsx.writeBuffer(), nome + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
