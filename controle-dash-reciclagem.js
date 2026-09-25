// ════════════════════════════════════════════════════════════════
// RECICLAGEM (25/09/2026) — pedido do Ayslan.
// Relação TRIMESTRAL por CLIENTE dos processos com NCM 4011/4012 (pneus),
// pelo trimestre da Data de Registro da DI/DUIMP. Peso a reciclar = 70% do
// peso total da DI/DUIMP. Exporta no modelo "RELAÇÃO RECICLAGEM" que vai pro
// cliente e acompanha cada relação: enviada ao cliente → reciclagem
// realizada → paga (tabela reciclagem_lotes, migration 0039).
// Dados de cada processo: numero_di, data_registro_di, di_peso_liquido e
// di_ncms (lidos da DI/DUIMP pela Extração com IA) + quantidade (Produtos).
// ════════════════════════════════════════════════════════════════
const REC_PCT = 0.70;
let _recAno = null, _recTri = null, _recCliente = '';
let _recLotes = null, _recLotesErro = '', _recContatos = null;

function _recTrimestreDe(dataStr){
  if(!dataStr || !/^\d{4}-\d{2}/.test(dataStr)) return null;
  const ano = +dataStr.slice(0,4), mes = +dataStr.slice(5,7);
  return { ano, tri: Math.floor((mes-1)/3)+1 };
}
function _recNorm(s){ return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/[^A-Z0-9 ]/g,' ').replace(/\s+/g,' ').trim(); }
function _recQtd(p){
  try{ const a = JSON.parse(p.produtos_json||'[]'); if(Array.isArray(a) && a.length) return a.reduce((s,x)=>s+(parseFloat(x&&x.quantidade)||0),0); }catch(e){}
  return null;
}
// ok = NCM lido e é 4011/4012 · presumido = NCM não lido, mas o produto é pneu
// fora = NCM lido e não é 4011/4012 · desconhecido = sem NCM e sem cara de pneu
function _recStatusNcm(p){
  // Marcação manual "NÃO É PNEU" no campo de NCMs da DI → fora da reciclagem.
  if(/N[ÃA]O\s*(É|E)?\s*PNEU/i.test(String(p.di_ncms||''))) return 'fora';
  const n = String(p.di_ncms||'').replace(/\D/g,' ');
  if(n.trim()){
    return /(^|\s)401[12]/.test(n) ? 'ok' : 'fora';
  }
  const txt = (p.produto||'') + ' ' + (p.produtos_json||'');
  return /\d{3}\s*\/\s*\d{2}\s*Z?R\s*\d{2}|PNEU|TYRE|TIRE/i.test(txt) ? 'presumido' : 'desconhecido';
}
function _recIdb(cliente){ let h=0; for(const ch of String(cliente)) h=(h*31+ch.charCodeAt(0))|0; return 'rec-'+(h>>>0).toString(36); }
function _recPeso(p){ const v = parseFloat(p.di_peso_liquido); return isFinite(v) && v > 0 ? v : null; }

// Responsável pela reciclagem (regra definida pela Emanuelly, 25/09/2026):
//  - Importação Própria (Direto) → a própria IMPAK
//  - Encomenda / Conta e Ordem  → o que estiver no campo Cliente do processo
const REC_NOME_IMPAK = 'IMPAK COMERCIAL E IMPORTADORA LTDA';
function _recResponsavel(p){
  if (p && p.finalidade === 'IMPORTACAO_DIRETA') return REC_NOME_IMPAK;
  return (p && p.cliente || 'Sem cliente').trim();
}

function listarReciclagem(ano, tri){
  const linhas = [], aConferir = [];
  (_processos||[]).forEach(p=>{
    if(!p || p.cancelado) return;
    const t = _recTrimestreDe(p.data_registro_di);
    if(!t || t.ano !== ano || t.tri !== tri) return;
    const st = _recStatusNcm(p);
    if(st === 'fora') return;
    const linha = { p, id:p.id, referencia:p.referencia, cliente:_recResponsavel(p), clienteProc:(p.cliente||'').trim(), finalidade:p.finalidade||'', dataDi:p.data_registro_di,
      numeroDi:p.numero_di||'', peso:_recPeso(p), qtd:_recQtd(p), ncms:p.di_ncms||'', ncmStatus:st };
    if(st === 'desconhecido'){ aConferir.push(linha); return; }
    linhas.push(linha);
  });
  linhas.sort((a,b)=> a.cliente.localeCompare(b.cliente) || String(a.dataDi).localeCompare(String(b.dataDi)));
  return { linhas, aConferir };
}

async function _recCarregarLotes(){
  try{
    const d = await fetch('/api/reciclagem/lotes').then(r=>r.json());
    if(d.ok){ _recLotes = d.lotes||[]; _recLotesErro=''; }
    else { _recLotes = []; _recLotesErro = d.semTabela ? 'A tabela de acompanhamento ainda não foi criada no banco (migration 0039) — os status não serão salvos até rodar o SQL.' : (d.erro||'erro'); }
  }catch(e){ _recLotes = []; _recLotesErro = e.message; }
}
async function _recCarregarContatos(){
  try{
    const d = await fetch('/api/contatos?limit=1000').then(r=>r.json());
    _recContatos = Array.isArray(d) ? d : (d.contatos || d.data || []);
  }catch(e){ _recContatos = []; }
}
function _recCnpjCliente(nome){
  const alvo = _recNorm(nome);
  if(!alvo || !_recContatos) return '';
  const c = _recContatos.find(x => _recNorm(x.razao_social) === alvo)
    || _recContatos.find(x => { const r=_recNorm(x.razao_social); return r && (r.startsWith(alvo) || alvo.startsWith(r)); });
  return c ? (c.cnpj || c.documento || '') : '';
}
function _recFmtCnpj(c){ const d=String(c||'').replace(/\D/g,''); return d.length===14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5') : (c||''); }
function _recLote(cliente, ano, tri){ return (_recLotes||[]).find(l => l.cliente===cliente && +l.ano===ano && +l.trimestre===tri) || null; }
function _recStatusLote(l){
  if(!l) return { k:'pendente', txt:'A enviar', cor:'#b45309', fundo:'#fef3c7' };
  if(l.data_pagamento) return { k:'pago', txt:'Pago ✓', cor:'#15803d', fundo:'#dcfce7' };
  if(l.data_realizacao) return { k:'realizado', txt:'Realizada — aguardando pagamento', cor:'#1d4ed8', fundo:'#dbeafe' };
  if(l.data_envio) return { k:'enviado', txt:'Enviada ao cliente', cor:'#7c3aed', fundo:'#ede9fe' };
  return { k:'pendente', txt:'A enviar', cor:'#b45309', fundo:'#fef3c7' };
}

async function renderDashReciclagem(){
  const el = document.getElementById('dash-reciclagem-content');
  if(!el) return;
  if(_recAno == null){ const t = _recTrimestreDe(new Date().toISOString().slice(0,10)); _recAno = t.ano; _recTri = t.tri; }
  if(_recLotes == null || _recContatos == null){
    el.innerHTML = '<div style="padding:20px;color:var(--muted);">Carregando…</div>';
    await Promise.all([_recLotes==null?_recCarregarLotes():null, _recContatos==null?_recCarregarContatos():null]);
  }
  const { linhas, aConferir } = listarReciclagem(_recAno, _recTri);
  const clientes = [...new Set(linhas.map(l=>l.cliente))].sort((a,b)=>a.localeCompare(b));
  const visiveis = _recCliente ? linhas.filter(l=>l.cliente===_recCliente) : linhas;
  const grupos = {};
  visiveis.forEach(l=>{ (grupos[l.cliente] = grupos[l.cliente] || []).push(l); });
  const fmtKg = v => v==null ? '—' : v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtD = d => d ? new Date(d+'T00:00:00').toLocaleDateString('pt-BR') : '—';
  const totPeso = visiveis.reduce((s,l)=>s+(l.peso||0),0);
  const semPeso = visiveis.filter(l=>l.peso==null).length;
  const presumidos = visiveis.filter(l=>l.ncmStatus==='presumido').length;
  const stCount = { pendente:0, enviado:0, realizado:0, pago:0 };
  Object.keys(grupos).forEach(c=> stCount[_recStatusLote(_recLote(c,_recAno,_recTri)).k]++);

  const anos = [...new Set((_processos||[]).map(p=>_recTrimestreDe(p.data_registro_di)).filter(Boolean).map(t=>t.ano).concat([_recAno]))].sort((a,b)=>b-a);
  const kpi = (lbl,val,cor)=>`<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px 14px;flex:1;min-width:130px;"><div style="font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;">${lbl}</div><div style="font-size:20px;font-weight:800;color:${cor||'var(--text)'};">${val}</div></div>`;

  const cards = Object.keys(grupos).sort((a,b)=>a.localeCompare(b)).map(cliente=>{
    const ls = grupos[cliente];
    const lote = _recLote(cliente,_recAno,_recTri);
    const st = _recStatusLote(lote);
    const cnpj = (lote && lote.cliente_cnpj) || _recCnpjCliente(cliente);
    const tPeso = ls.reduce((s,l)=>s+(l.peso||0),0), tQtd = ls.reduce((s,l)=>s+(l.qtd||0),0);
    const key = encodeURIComponent(cliente);
    const linhasHtml = ls.map(l=>`<tr style="border-top:1px solid var(--border);">
      <td style="padding:6px 8px;"><a href="#" onclick="abrirProcesso(${jsArg(l.id)});return false;" style="color:var(--ac);font-weight:700;font-family:'DM Mono',monospace;">${esc(l.referencia)}</a>
        ${l.ncmStatus==='presumido'?' <span title="NCM ainda não lido da DI/DUIMP — considerado pneu (4011) pela descrição do produto" style="background:#fef3c7;color:#92400e;font-size:10px;font-weight:700;padding:1px 5px;border-radius:4px;">NCM a confirmar</span>':''}</td>
      <td style="padding:6px 8px;">${fmtD(l.dataDi)}</td>
      <td style="padding:6px 8px;font-family:'DM Mono',monospace;">${esc(l.numeroDi||'—')}</td>
      <td style="padding:6px 8px;">${esc(l.ncms||'—')}</td>
      <td style="padding:6px 8px;text-align:right;${l.peso==null?'color:var(--err);font-weight:700;':''}">${l.peso==null?'falta peso':fmtKg(l.peso)}</td>
      <td style="padding:6px 8px;text-align:right;">${l.qtd==null?'—':l.qtd}</td>
      <td style="padding:6px 8px;text-align:right;font-weight:700;">${l.peso==null?'—':fmtKg(l.peso*REC_PCT)}</td>
    </tr>`).join('');
    const campo = (lbl,id,val,tipo)=>`<label style="font-size:11px;color:var(--muted);display:flex;flex-direction:column;gap:3px;">${lbl}<input id="${id}" type="${tipo||'date'}" value="${esc(val||'')}" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;"></label>`;
    const idb = _recIdb(cliente);
    return `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;margin-bottom:14px;overflow:hidden;">
      <div style="padding:10px 16px;background:var(--bg);display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;border-bottom:1px solid var(--border);">
        <div><div style="font-weight:800;font-size:14px;">${esc(cliente)}</div><div style="font-size:11px;color:var(--muted);">CNPJ: ${cnpj?esc(_recFmtCnpj(cnpj)):'<span style="color:var(--err);">não está no Cadastro — digite abaixo e salve</span>'} · ${ls.length} processo(s) · ${tQtd} pneus · ${fmtKg(tPeso)} kg · <b>a reciclar ${fmtKg(tPeso*REC_PCT)} kg</b></div></div>
        <div style="display:flex;gap:8px;align-items:center;">
          <span style="background:${st.fundo};color:${st.cor};font-weight:800;font-size:11px;padding:3px 10px;border-radius:20px;">${st.txt}</span>
          <button type="button" onclick="exportarReciclagemExcel(decodeURIComponent('${key}'))" style="font-size:12px;font-weight:700;padding:6px 12px;border:1px solid var(--border);border-radius:7px;background:#fff;cursor:pointer;">⬇️ Excel p/ cliente</button>
        </div>
      </div>
      <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="text-align:left;color:var(--muted);font-size:10px;text-transform:uppercase;">
          <th style="padding:6px 8px;">Referência</th><th style="padding:6px 8px;">Data Registro DI/DUIMP</th><th style="padding:6px 8px;">Nº DI/DUIMP</th><th style="padding:6px 8px;">NCM</th>
          <th style="padding:6px 8px;text-align:right;">Peso total DI (kg)</th><th style="padding:6px 8px;text-align:right;">Qtd</th><th style="padding:6px 8px;text-align:right;">Peso a reciclar (70%)</th></tr></thead>
        <tbody>${linhasHtml}</tbody></table></div>
      <div style="padding:10px 16px;border-top:1px solid var(--border);display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;background:#fcfcfd;">
        ${campo('CNPJ do cliente', idb+'-cnpj', cnpj?_recFmtCnpj(cnpj):'', 'text')}
        ${campo('📤 Enviada ao cliente em', idb+'-env', lote&&lote.data_envio)}
        ${campo('♻️ Reciclagem realizada em', idb+'-real', lote&&lote.data_realizacao)}
        ${campo('💰 Paga pelo cliente em', idb+'-pag', lote&&lote.data_pagamento)}
        ${campo('Valor (R$)', idb+'-val', lote&&lote.valor!=null?String(lote.valor).replace('.',','):'', 'text')}
        <label style="font-size:11px;color:var(--muted);display:flex;flex-direction:column;gap:3px;flex:1;min-width:200px;">Observação / pendência<input id="${idb}-obs" type="text" value="${esc(lote&&lote.obs||'')}" placeholder="ex: aguardando certificado da recicladora" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;"></label>
        <button type="button" onclick="salvarLoteReciclagem(decodeURIComponent('${key}'),'${idb}')" style="font-size:12px;font-weight:700;padding:7px 14px;border:none;border-radius:7px;background:var(--ok);color:#fff;cursor:pointer;">Salvar status</button>
      </div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">
      <select onchange="_recAno=+this.value;renderDashReciclagem()" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;">${anos.map(a=>`<option ${a===_recAno?'selected':''}>${a}</option>`).join('')}</select>
      <select onchange="_recTri=+this.value;renderDashReciclagem()" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;">${[1,2,3,4].map(t=>`<option value="${t}" ${t===_recTri?'selected':''}>${t}º trimestre</option>`).join('')}</select>
      <select onchange="_recCliente=this.value;renderDashReciclagem()" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;max-width:260px;"><option value="">Todos os clientes</option>${clientes.map(c=>`<option value="${esc(c)}" ${c===_recCliente?'selected':''}>${esc(c)}</option>`).join('')}</select>
      <span style="font-size:11px;color:var(--muted);">NCM 4011/4012 · trimestre pela Data de Registro da DI/DUIMP · peso a reciclar = 70% do peso total da DI/DUIMP · responsável: Importação Própria = IMPAK; Encomenda/Conta e Ordem = Cliente do processo</span>
    </div>
    ${_recLotesErro?`<div style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:8px;padding:8px 12px;font-size:12px;margin-bottom:12px;">⚠️ ${esc(_recLotesErro)}</div>`:''}
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
      ${kpi('Processos', visiveis.length)}${kpi('Clientes', Object.keys(grupos).length)}
      ${kpi('Peso total DI (kg)', fmtKg(totPeso))}${kpi('A reciclar (kg)', fmtKg(totPeso*REC_PCT),'#15803d')}
      ${kpi('A enviar', stCount.pendente,'#b45309')}${kpi('Enviadas', stCount.enviado,'#7c3aed')}${kpi('Realizadas', stCount.realizado,'#1d4ed8')}${kpi('Pagas', stCount.pago,'#15803d')}
    </div>
    ${(semPeso||presumidos||aConferir.length)?`<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 16px;margin-bottom:14px;font-size:12px;color:#78350f;">
      <b>⚠️ Dados a completar antes de enviar:</b>
      ${semPeso?`<div>• ${semPeso} processo(s) sem o peso total da DI/DUIMP — abra o processo e leia a DI/DUIMP na Extração com IA (ou digite na aba Documentos).</div>`:''}
      ${presumidos?`<div>• ${presumidos} processo(s) com NCM ainda não lido — considerados pneu (4011) pela descrição; a leitura da DI/DUIMP confirma.</div>`:''}
      ${aConferir.length?`<div>• ${aConferir.length} processo(s) com DI/DUIMP no trimestre sem NCM e sem produto de pneu identificado: ${aConferir.map(l=>`<a href="#" onclick="abrirProcesso(${jsArg(l.id)});return false;" style="color:#92400e;font-weight:700;">${esc(l.referencia)}</a>`).join(', ')}</div>`:''}
    </div>`:''}
    ${cards || '<div style="padding:24px;text-align:center;color:var(--muted);background:#fff;border:1px solid var(--border);border-radius:10px;">Nenhum processo com NCM 4011/4012 e DI/DUIMP registrada neste trimestre.</div>'}`;
}

async function salvarLoteReciclagem(cliente, idb){
  const g = s => (document.getElementById(idb+'-'+s)?.value || '').trim();
  const { linhas } = listarReciclagem(_recAno, _recTri);
  const ls = linhas.filter(l=>l.cliente===cliente);
  const body = { cliente, ano:_recAno, trimestre:_recTri, cliente_cnpj: g('cnpj') || _recCnpjCliente(cliente) || null,
    data_envio:g('env'), data_realizacao:g('real'), data_pagamento:g('pag'), valor:g('val'), obs:g('obs'),
    processos: ls.map(l=>({ referencia:l.referencia, numero_di:l.numeroDi, peso:l.peso, qtd:l.qtd })) };
  try{
    const d = await fetch('/api/reciclagem/lote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
    if(!d.ok) throw new Error(d.erro||'erro');
    showToast('Status da reciclagem salvo','ok');
    await _recCarregarLotes(); renderDashReciclagem();
  }catch(e){ showToast('Não foi possível salvar: '+e.message,'err'); }
}

// Excel no MESMO layout do modelo "RELAÇÃO RECICLAGEM" (planilha da Paula/
// Emanuelly): título, CNPJ, Total DI (peso/qtd), Reciclar (70%) e NCM, com
// fórmulas (=E*70%) e totais — o cliente consegue conferir as contas.
async function exportarReciclagemExcel(cliente){
  if(typeof ExcelJS === 'undefined'){ showToast('Biblioteca de exportação ainda carregando, tente de novo','err'); return; }
  const { linhas } = listarReciclagem(_recAno, _recTri);
  const ls = linhas.filter(l=>l.cliente===cliente);
  if(!ls.length){ showToast('Nenhum processo deste cliente no trimestre','err'); return; }
  if(ls.some(l=>l.peso==null) && !confirm('Há processo(s) sem o peso da DI/DUIMP — a planilha sai com essas linhas em branco. Exportar mesmo assim?')) return;
  const lote = _recLote(cliente,_recAno,_recTri);
  const inpCnpj = document.getElementById(_recIdb(cliente)+'-cnpj');
  const cnpj = (inpCnpj && inpCnpj.value.trim()) || (lote && lote.cliente_cnpj) || _recCnpjCliente(cliente);
  const ncms = [...new Set(ls.flatMap(l=>String(l.ncms||'').split(/[,;]\s*/).filter(Boolean)))];
  const wb = new ExcelJS.Workbook(); wb.creator='IMPAK';
  const ws = wb.addWorksheet(`${_recTri} TRIMESTRE DE ${_recAno}`);
  ws.columns = [{width:3},{width:16},{width:17},{width:21},{width:14},{width:9},{width:16},{width:10},{width:14}];
  const F = (b,sz)=>({ name:'Calibri', size:sz||11, bold:!!b });
  const borda = { top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'} };
  const cinza = { type:'pattern', pattern:'solid', fgColor:{argb:'FFD9E1F2'} };
  const verde = { type:'pattern', pattern:'solid', fgColor:{argb:'FFE2EFDA'} };
  ws.mergeCells('B2:I2'); ws.getCell('B2').value = `RELAÇÃO RECICLAGEM ${_recTri} TRIMESTRE DE ${_recAno}`;
  ws.getCell('B2').font = F(true,13); ws.getCell('B2').fill = cinza;
  ws.mergeCells('B3:I3'); ws.getCell('B3').value = `CNPJ: ${cnpj ? _recFmtCnpj(cnpj) : '—'} - ${cliente}`;
  ws.getCell('B3').font = F(false,12);
  ws.mergeCells('E4:F4'); ws.getCell('E4').value = 'TOTAL DI';
  ws.getCell('G4').value = 'RECICLAR';
  ws.mergeCells('H4:I4'); ws.getCell('H4').value = 'NCM ' + (ncms.join(' / ') || '4011');
  ['E4','G4','H4'].forEach(a=>{ ws.getCell(a).font=F(true,10); ws.getCell(a).fill = a==='G4'?verde:cinza; });
  ['Referência','Data Registro DI','Número DI / Duimp','Peso Total DI','QTD','Peso a reciclar','QTD','Peso'].forEach((h,i)=>{
    const c = ws.getCell(5, i+2); c.value = h; c.font = F(true,10); c.fill = i===5?verde:cinza;
  });
  let r = 6;
  ls.forEach(l=>{
    ws.getCell(r,2).value = l.referencia;
    ws.getCell(r,3).value = l.dataDi ? new Date(l.dataDi+'T12:00:00') : null; ws.getCell(r,3).numFmt = 'dd/mm/yyyy';
    ws.getCell(r,4).value = l.numeroDi || '';
    ws.getCell(r,5).value = l.peso; ws.getCell(r,5).numFmt = '#,##0.00';
    ws.getCell(r,6).value = l.qtd;
    ws.getCell(r,7).value = { formula:`E${r}*70%` }; ws.getCell(r,7).numFmt = '#,##0.00';
    ws.getCell(r,8).value = { formula:`F${r}` };
    ws.getCell(r,9).value = { formula:`E${r}` }; ws.getCell(r,9).numFmt = '#,##0.00';
    r++;
  });
  const ult = r-1;
  ws.getCell(r,2).value = 'TOTAL';
  ws.getCell(r,5).value = { formula:`SUM(E6:E${ult})` }; ws.getCell(r,5).numFmt='#,##0.00';
  ws.getCell(r,6).value = { formula:`SUM(F6:F${ult})` };
  ws.getCell(r,7).value = { formula:`SUM(G6:G${ult})` }; ws.getCell(r,7).numFmt='#,##0.00';
  ws.getCell(r,8).value = { formula:`SUM(H6:H${ult})` };
  ws.getCell(r,9).value = { formula:`SUM(I6:I${ult})` }; ws.getCell(r,9).numFmt='#,##0.00';
  for(let c=2;c<=9;c++){ ws.getCell(r,c).font = F(true,11); ws.getCell(r,c).fill = cinza; }
  for(let rr=2; rr<=r; rr++) for(let c=2;c<=9;c++){ const cell = ws.getCell(rr,c); cell.border = borda; cell.alignment = { horizontal:'center', vertical:'middle' }; if(!cell.font || !cell.font.name) cell.font = F(false,11); }
  ws.getCell(r+2,2).value = 'Peso a reciclar = 70% do peso total da DI/DUIMP. NCMs: 4011 / 4012.';
  ws.getCell(r+2,2).font = { name:'Calibri', size:9, italic:true, color:{argb:'FF64748B'} };
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const a = document.createElement('a'); a.href = url;
  a.download = `RECICLAGEM ${cliente.replace(/[\\/:*?"<>|]/g,'').slice(0,40)} ${_recTri}T${_recAno}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url), 2000);
  showToast('Planilha de reciclagem gerada','ok');
}
