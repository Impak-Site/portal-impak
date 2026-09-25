// controle-averbacao.js — Planilha mensal de Averbação de Seguro (importação)
//
// Pedido (25/09/2026): gerar a "PLANILHA DE AVERBAÇÃO IMPORTAÇÃO" no mesmo
// layout da planilha usada hoje (colunas A..AE), um processo por linha.
// Regras:
//  - Mês de competência = mês do Registro da DI/DUIMP (data_registro_di).
//  - BENEFICIÁRIO: Importação Própria (Direto) → IMPAK; Encomenda / Conta e
//    Ordem → o que estiver no campo Cliente.
//  - DESCRIÇÃO DAS MERCADORIAS: "PNEU" quando o NCM da DI é 4011/4012; senão
//    em branco (preenchimento manual).
//  - FRETE: valor/moeda do frete do processo (mesmo valor da DUIMP).
//  - OBSERVAÇÕES: número da DUIMP.  IMPORTADOR: sempre IMPAK.
//  - VALOR DESPESAS = 10% de (mercadoria + frete); LUCROS ESPERADOS = 10% de
//    (mercadoria + frete + despesas); IS total = soma; PRÊMIO = IS × taxa
//    (0,04%) — tudo como fórmula, igual à planilha.

const AVB_IMPAK_NOME = 'IMPAK COMERCIAL E IMPORTADORA LTDA';
const AVB_IMPAK_CNPJ = '16.554.796/0001-64';
const AVB_TAXA = 0.0004;
const AVB_MESES = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];

function _avbEhPneu(p){
  const n = String(p.di_ncms || '').replace(/\D/g, ' ');
  if (/N[ÃA]O\s*(É|E)?\s*PNEU/i.test(String(p.di_ncms || ''))) return false;
  return /(^|\s)401[12]/.test(n);
}
function _avbBeneficiario(p){
  if (p.finalidade === 'IMPORTACAO_DIRETA') return AVB_IMPAK_NOME;
  return (p.cliente || '').trim();
}
function _avbCidadeDestino(p){
  const cod = (typeof normalizarPortoDestino === 'function') ? normalizarPortoDestino(p.porto_destino || '') : (p.porto_destino || '');
  const achado = (typeof PORTOS_DESTINO !== 'undefined') ? PORTOS_DESTINO.find(x => x.codigo === cod) : null;
  return (achado ? achado.nome : (p.porto_destino || '')).toUpperCase();
}
function _avbPaisOrigem(p){
  const pais = (typeof paisDoProcesso === 'function') ? paisDoProcesso(p) : '';
  return pais && pais !== '—' ? pais.toUpperCase() : '';
}
function _avbNum(v){ const n = parseFloat(v); return isFinite(n) ? n : null; }
function _avbData(s){ if(!s) return null; const [a,m,d] = String(s).slice(0,10).split('-').map(Number); return (a&&m&&d) ? new Date(a, m-1, d) : null; }

// Cache dos processos completos por mês (a lista da tela é enxuta).
const _avbCache = {};
async function carregarAverbacao(anoMes, forcar){
  if (_avbCache[anoMes] && !forcar) return _avbCache[anoMes];
  const candidatos = (_processos || []).filter(p => p && !p.cancelado && String(p.data_registro_di || '').slice(0,7) === anoMes);
  const procs = [];
  await Promise.all(candidatos.map(async c => {
    try { const r = await fetch('/api/controle/v2/processo/' + c.id); const j = await r.json(); procs.push(j.processo || j); }
    catch(e) { procs.push(c); }
  }));
  procs.sort((a,b) => String(a.data_registro_di).localeCompare(String(b.data_registro_di)) || String(a.referencia).localeCompare(String(b.referencia)));
  const linhas = procs.map(p => {
    const fob = _avbNum(p.ci_valor_usd) ?? _avbNum(p.pi_valor_usd);
    const frete = _avbNum(p.valor_frete);
    const moedaFrete = (p.moeda_frete || 'USD').toUpperCase();
    const benef = _avbBeneficiario(p);
    const falta = [];
    if (fob == null) falta.push('valor CI');
    if (frete == null) falta.push('frete');
    if (!benef) falta.push('beneficiário (Cliente)');
    if (!p.numero_di) falta.push('nº DUIMP');
    if (moedaFrete !== 'USD' && frete != null) falta.push('frete em ' + moedaFrete);
    const paisOrig = _avbPaisOrigem(p);
    if (!paisOrig) falta.push('país de origem');
    const base = (fob||0) + (moedaFrete === 'USD' ? (frete||0) : 0);
    const desp = base * 0.10, lucro = (base + desp) * 0.10, is = base + desp + lucro;
    return { p, id:p.id, referencia:p.referencia||'', benef, descricao:_avbEhPneu(p)?'PNEU':'', paisOrig,
      cidadeOrig:(p.porto_origem||'').toUpperCase(), cidadeDest:_avbCidadeDestino(p),
      embarque:(p.data_embarque || p.ce_data_embarque || p.etd || ''), incoterm:(p.pi_incoterm||'FOB').toUpperCase(),
      navio:(p.navio||'').toUpperCase(), fob, frete, moedaFrete, desp, lucro, is, premio: is*AVB_TAXA,
      duimp:p.numero_di||'', falta };
  });
  _avbCache[anoMes] = linhas;
  return linhas;
}

async function exportarAverbacaoSeguro(anoMes){
  if (!/^\d{4}-\d{2}$/.test(anoMes || '')) { showToast('Escolha o mês', 'err'); return; }
  if (typeof ExcelJS === 'undefined') { showToast('Biblioteca de Excel ainda carregando, tente de novo', 'err'); return; }
  const [ano, mes] = anoMes.split('-').map(Number);
  const linhas = await carregarAverbacao(anoMes);
  if (!linhas.length) { showToast('Nenhum processo com DI/DUIMP registrada em ' + AVB_MESES[mes-1].toLowerCase() + '/' + ano, 'err'); return; }
  const procs = linhas.map(l => l.p);
  const wb = new ExcelJS.Workbook(); wb.creator = 'IMPAK';
  const ws = wb.addWorksheet(`${AVB_MESES[mes-1]} ${ano}`);
  const bold = { bold: true };
  ws.getCell('B1').value = 'NOME DO SEGURADO'; ws.getCell('C1').value = 'Impak Comercial Importadora Ltda';
  ws.getCell('B2').value = 'Nº DA APÓLICE';
  ws.getCell('B3').value = 'VIGÊNCIA DA APÓLICE';
  ws.getCell('B4').value = 'MÊS DE COMPETÊNCIA'; ws.getCell('C4').value = AVB_MESES[mes-1].charAt(0) + AVB_MESES[mes-1].slice(1).toLowerCase() + ' ' + ano;
  ['B1','B2','B3','B4'].forEach(k => ws.getCell(k).font = bold);

  const head = ['REF IMPAK','BENEFICIARIO','DESCRIÇÃO DAS MERCADORIAS','NOVA / USADA','EMBALAGEM','PAIS ORIGEM','CIDADE ORIGEM','PAIS DESTINO','CIDADE DESTINO','DATA DO EMBARQUE','INCOTERM','MODAL','NAVIO/ AERONAVE','MOEDA','VALOR FOB','MOEDA','VALOR FRETE','MOEDA','VALOR DESPESAS','MOEDA','VALOR LUCROS ESPERADOS','MOEDA','VALOR IMPOSTOS','MOEDA','VALOR CONTAINER','IMPORTÂNCIA SEGURADA TOTAL EM USD','TAXA','PREMIO EM DOLAR','OBSERVAÇÕES','IMPORTADOR','CNPJ IMPORTADOR'];
  const hr = ws.getRow(6);
  head.forEach((h,i) => { const c = hr.getCell(i+1); c.value = h; c.font = { bold:true, color:{argb:'FFFFFFFF'}, size:10 }; c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF0F1F3D'} }; c.alignment = { horizontal:'center', vertical:'middle', wrapText:true }; });
  hr.height = 34;

  const pend = [];
  let r = 7;
  linhas.forEach(l => {
    const p = l.p, fob = l.fob, frete = l.frete, moedaFrete = l.moedaFrete, benef = l.benef, falta = l.falta;
    if (falta.length) pend.push(p.referencia + ': ' + falta.join(', '));

    const row = ws.getRow(r);
    row.values = [
      p.referencia || '', benef, _avbEhPneu(p) ? 'PNEU' : '', 'NOVA', '',
      _avbPaisOrigem(p), (p.porto_origem || '').toUpperCase(), 'BRASIL', _avbCidadeDestino(p),
      _avbData(p.data_embarque || p.ce_data_embarque || p.etd), (p.pi_incoterm || 'FOB').toUpperCase(), 'MARITIMO', (p.navio || '').toUpperCase(),
      'USD', fob, moedaFrete, frete,
      'USD', { formula: `(O${r}+Q${r})*10%` },
      'USD', { formula: `(O${r}+Q${r}+S${r})*10%` },
      'USD', null, 'USD', null,
      { formula: `O${r}+Q${r}+S${r}+U${r}` }, AVB_TAXA, { formula: `Z${r}*AA${r}` },
      p.numero_di || '', AVB_IMPAK_NOME, AVB_IMPAK_CNPJ,
    ];
    row.getCell(10).numFmt = 'dd/mm/yyyy';
    [15,17,19,21,23,25,26,28].forEach(c => row.getCell(c).numFmt = '#,##0.00');
    row.getCell(27).numFmt = '0.00%';
    if (falta.length) row.getCell(1).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFFF3CD'} };
    r++;
  });
  // Totais
  const tr = ws.getRow(r);
  tr.getCell(1).value = 'TOTAL'; tr.font = bold;
  [['O',15],['Q',17],['S',19],['U',21],['Z',26],['AB',28]].forEach(([col,c]) => { tr.getCell(c).value = { formula: `SUM(${col}7:${col}${r-1})` }; tr.getCell(c).numFmt = '#,##0.00'; });

  const larg = [14,34,14,9,11,11,14,10,14,12,9,10,20,7,13,7,12,7,13,7,13,7,12,7,12,16,8,12,22,34,20];
  larg.forEach((w,i) => ws.getColumn(i+1).width = w);
  ws.views = [{ state:'frozen', ySplit:6, xSplit:1 }];

  // Memória de cálculo (igual ao quadro da planilha original)
  const m = r + 3;
  ws.getCell(`B${m}`).value = 'Embarques ao valor do custo, acrescido do respectivo frete, + 10% despesas, total + 10% de lucros esperados e impostos/tributos (II+IPI+ICMS+PIS+COFINS).';
  ws.getCell(`B${m}`).font = { italic:true, size:9, color:{argb:'FF555555'} };
  if (pend.length){
    ws.getCell(`B${m+2}`).value = 'CONFERIR (linhas em amarelo):'; ws.getCell(`B${m+2}`).font = bold;
    pend.forEach((t,i) => ws.getCell(`B${m+3+i}`).value = '• ' + t);
  }

  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = `AVERBACAO SEGURO IMPORTACAO ${AVB_MESES[mes-1]} ${ano}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  showToast(`✓ Averbação gerada: ${procs.length} processo(s)` + (pend.length ? ` · ${pend.length} para conferir (amarelo)` : ''), pend.length ? 'warn' : 'ok');
}


// ── Tela /averbacao (Operacional) ─────────────────────────────────────────
let _avbMes = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; })();
async function renderDashAverbacao(forcar){
  const el = document.getElementById('dash-averbacao-content'); if (!el) return;
  const [ano, mes] = _avbMes.split('-').map(Number);
  el.innerHTML = '<div style="padding:30px;text-align:center;color:var(--muted);">Carregando processos de ' + AVB_MESES[mes-1].toLowerCase() + '/' + ano + '...</div>';
  const linhas = await carregarAverbacao(_avbMes, forcar);
  const f2 = v => v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 });
  const fd = s => s ? String(s).slice(0,10).split('-').reverse().join('/') : '—';
  const tot = linhas.reduce((a,l) => ({ fob:a.fob+(l.fob||0), frete:a.frete+(l.moedaFrete==='USD'?(l.frete||0):0), is:a.is+l.is, premio:a.premio+l.premio }), { fob:0, frete:0, is:0, premio:0 });
  const pend = linhas.filter(l => l.falta.length);
  const kpi = (t,v,c) => `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px 14px;min-width:150px;"><div style="font-size:11px;color:var(--muted);">${t}</div><div style="font-size:18px;font-weight:800;color:${c||'var(--text)'};">${v}</div></div>`;
  const nImpak = linhas.filter(l => l.benef === AVB_IMPAK_NOME).length;
  el.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">
      <label style="font-size:12px;font-weight:700;">Mês de competência</label>
      <input type="month" value="${_avbMes}" onchange="_avbMes=this.value;renderDashAverbacao()" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;">
      <button type="button" onclick="renderDashAverbacao(true)" style="font-size:12px;padding:6px 10px;border:1px solid var(--border);border-radius:7px;background:#fff;cursor:pointer;">↻ Atualizar</button>
      <button type="button" onclick="exportarAverbacaoSeguro(_avbMes)" ${linhas.length?'':'disabled'} style="font-size:12px;font-weight:700;padding:7px 14px;border:none;border-radius:7px;background:var(--ok);color:#fff;cursor:pointer;">⬇️ Excel p/ seguradora</button>
      <span style="font-size:11px;color:var(--muted);">Processos com DI/DUIMP registrada no mês · Beneficiário: Importação Própria = IMPAK; Encomenda/Conta e Ordem = Cliente · IS = (CI + frete) +10% despesas +10% lucros · taxa 0,04%</span>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
      ${kpi('Processos', linhas.length)}${kpi('Beneficiário IMPAK', nImpak)}
      ${kpi('Valor CI (USD)', f2(tot.fob))}${kpi('Frete (USD)', f2(tot.frete))}
      ${kpi('Importância segurada (USD)', f2(tot.is))}${kpi('Prêmio (USD)', f2(tot.premio), '#15803d')}
    </div>
    ${pend.length ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 16px;margin-bottom:14px;font-size:12px;color:#78350f;"><b>${pend.length} processo(s) para conferir:</b> ${pend.map(l=>`<a href="#" onclick="abrirProcesso(${jsArg(l.id)});return false;" style="color:#92400e;font-weight:700;">${esc(l.referencia)}</a> (${esc(l.falta.join(', '))})`).join(' · ')}</div>` : ''}
    ${linhas.length ? `<div style="overflow-x:auto;background:#fff;border:1px solid var(--border);border-radius:10px;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="background:#0f1f3d;color:#fff;text-align:left;">
          ${['Ref.','Beneficiário','Descrição','Origem','Destino','Embarque','Navio','Valor CI','Frete','IS (USD)','Prêmio','DUIMP'].map(h=>`<th style="padding:7px 8px;white-space:nowrap;">${h}</th>`).join('')}
        </tr></thead>
        <tbody>${linhas.map(l => `<tr style="border-top:1px solid var(--border);${l.falta.length?'background:#fffbeb;':''}">
          <td style="padding:6px 8px;white-space:nowrap;"><a href="#" onclick="abrirProcesso(${jsArg(l.id)});return false;" style="font-weight:700;">${esc(l.referencia)}</a></td>
          <td style="padding:6px 8px;max-width:220px;">${esc(l.benef||'—')}</td>
          <td style="padding:6px 8px;">${l.descricao || '<span style="color:var(--muted);">manual</span>'}</td>
          <td style="padding:6px 8px;white-space:nowrap;">${esc([l.paisOrig,l.cidadeOrig].filter(Boolean).join(' · ')||'—')}</td>
          <td style="padding:6px 8px;">${esc(l.cidadeDest||'—')}</td>
          <td style="padding:6px 8px;">${fd(l.embarque)}</td>
          <td style="padding:6px 8px;white-space:nowrap;">${esc(l.navio||'—')}</td>
          <td style="padding:6px 8px;text-align:right;">${f2(l.fob)}</td>
          <td style="padding:6px 8px;text-align:right;">${l.moedaFrete!=='USD'&&l.frete!=null?esc(l.moedaFrete)+' ':''}${f2(l.frete)}</td>
          <td style="padding:6px 8px;text-align:right;font-weight:700;">${f2(l.is)}</td>
          <td style="padding:6px 8px;text-align:right;color:#15803d;font-weight:700;">${f2(l.premio)}</td>
          <td style="padding:6px 8px;white-space:nowrap;">${esc(l.duimp||'—')}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : `<div style="padding:30px;text-align:center;color:var(--muted);background:#fff;border:1px solid var(--border);border-radius:10px;">Nenhum processo com DI/DUIMP registrada em ${AVB_MESES[mes-1].toLowerCase()}/${ano}.</div>`}`;
}
