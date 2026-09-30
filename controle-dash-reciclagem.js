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
  const ncms = parseNcmsDetalhe(p.di_ncms).ncms;
  if(ncms.length){
    return ncms.some(_recEhNcmPneu) ? 'ok' : 'fora';
  }
  const txt = (p.produto||'') + ' ' + (p.produtos_json||'');
  return /\d{3}\s*\/\s*\d{2}\s*Z?R\s*\d{2}|PNEU|TYRE|TIRE/i.test(txt) ? 'presumido' : 'desconhecido';
}
function _recEhNcmPneu(n){ return /^401[12]/.test(String(n||'').replace(/\D/g,'')); }
const REC_NCM_A_CONFIRMAR = 'NCM a confirmar';
// Quebra de qtd/peso por NCM (só NCMs de pneu 4011/4012) — pedido Emanuelly
// 28/09/2026. Vem do di_ncms ("4011.80.90: 48 un, 2227.68 kg; ..."), lido da
// DI/DUIMP pela IA ou digitado em "Separar por NCM". Com 1 NCM só, o processo
// inteiro é dele. Com 2+ NCMs sem a quebra → null (precisa separar).
function _recPorNcm(p, qtd, peso){
  const info = parseNcmsDetalhe(p.di_ncms);
  const pneus = info.ncms.filter(_recEhNcmPneu);
  if(info.detalhe){
    const out = {};
    pneus.forEach(n => { out[n] = { qtd: info.detalhe[n].qtd, peso: info.detalhe[n].peso }; });
    return { porNcm: out, naoPneu: info.ncms.filter(n => !_recEhNcmPneu(n)) };
  }
  if(!info.ncms.length) return { porNcm: { [REC_NCM_A_CONFIRMAR]: { qtd, peso } }, naoPneu: [] };
  if(info.ncms.length === 1) return { porNcm: { [info.ncms[0]]: { qtd, peso } }, naoPneu: [] };
  return { porNcm: null, naoPneu: info.ncms.filter(n => !_recEhNcmPneu(n)) };
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
    if(typeof ehAcompanhamento==='function' && ehAcompanhamento(p)) return; // reciclagem é de quem importa (Emanuelly 29/09)
    const t = _recTrimestreDe(p.data_registro_di);
    if(!t || t.ano !== ano || t.tri !== tri) return;
    const st = _recStatusNcm(p);
    if(st === 'fora') return;
    const peso = _recPeso(p), qtd = _recQtd(p);
    const { porNcm, naoPneu } = _recPorNcm(p, qtd, peso);
    // Peso que entra na reciclagem = só a parte de pneu (4011/4012) quando há
    // quebra por NCM; sem quebra, o peso total da DI (como antes).
    const pesoPneu = porNcm && Object.values(porNcm).every(v => v.peso != null) ? Object.values(porNcm).reduce((a,v)=>a+v.peso,0) : peso;
    const linha = { p, id:p.id, referencia:p.referencia, cliente:_recResponsavel(p), clienteProc:(p.cliente||'').trim(), finalidade:p.finalidade||'', dataDi:p.data_registro_di,
      numeroDi:p.numero_di||'', peso, qtd, ncms:p.di_ncms||'', ncmStatus:st, porNcm, naoPneu, pesoPneu };
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
  const fmtQ = v => (+v).toLocaleString('pt-BR',{maximumFractionDigits:3});
  const totPeso = visiveis.reduce((s,l)=>s+(l.peso||0),0);
  const totRec = visiveis.reduce((s,l)=>s+(l.pesoPneu||0),0)*REC_PCT;
  const semPeso = visiveis.filter(l=>l.peso==null).length;
  const semQuebra = visiveis.filter(l=>!l.porNcm);
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
    const tRec = ls.reduce((s,l)=>s+(l.pesoPneu||0),0)*REC_PCT;
    const ncmsGrupo = _recNcmsDoGrupo(ls);
    const key = encodeURIComponent(cliente);
    const celNcm = l => !l.porNcm
      ? `<td colspan="${ncmsGrupo.length*2}" style="padding:6px 8px;text-align:center;background:#fffbeb;"><a href="#" onclick="_recEditarNcms(${jsArg(l.id)});return false;" style="color:#92400e;font-weight:700;">⚠ separar qtd/peso por NCM</a></td>`
      : ncmsGrupo.map(n => { const v = l.porNcm[n]; return `<td style="padding:6px 8px;text-align:right;border-left:1px solid var(--border);">${v&&v.qtd!=null?fmtQ(v.qtd):'—'}</td><td style="padding:6px 8px;text-align:right;">${v&&v.peso!=null?fmtKg(v.peso):'—'}</td>`; }).join('');
    const linhasHtml = ls.map(l=>`<tr style="border-top:1px solid var(--border);">
      <td style="padding:6px 8px;"><a href="#" onclick="abrirProcesso(${jsArg(l.id)});return false;" style="color:var(--ac);font-weight:700;font-family:'DM Mono',monospace;">${esc(l.referencia)}</a>
        ${l.ncmStatus==='presumido'?' <span title="NCM ainda não lido da DI/DUIMP — considerado pneu (4011) pela descrição do produto" style="background:#fef3c7;color:#92400e;font-size:10px;font-weight:700;padding:1px 5px;border-radius:4px;">NCM a confirmar</span>':''}</td>
      <td style="padding:6px 8px;">${fmtD(l.dataDi)}</td>
      <td style="padding:6px 8px;font-family:'DM Mono',monospace;">${esc(l.numeroDi||'—')}</td>
      <td style="padding:6px 8px;text-align:right;${l.peso==null?'color:var(--err);font-weight:700;':''}">${l.peso==null?'falta peso':fmtKg(l.peso)}</td>
      <td style="padding:6px 8px;text-align:right;">${l.qtd==null?'—':l.qtd}</td>
      <td style="padding:6px 8px;text-align:right;font-weight:700;">${l.pesoPneu==null?'—':fmtKg(l.pesoPneu*REC_PCT)}${l.naoPneu&&l.naoPneu.length?` <span title="NCM(s) que não são pneu, fora da reciclagem: ${esc(l.naoPneu.join(', '))}" style="font-size:10px;color:var(--muted);">(só pneu)</span>`:''}</td>
      ${celNcm(l)}
      <td style="padding:6px 4px;text-align:center;"><a href="#" title="Editar qtd/peso por NCM" onclick="_recEditarNcms(${jsArg(l.id)});return false;" style="text-decoration:none;">✏️</a></td>
    </tr>`).join('');
    const campo = (lbl,id,val,tipo)=>`<label style="font-size:11px;color:var(--muted);display:flex;flex-direction:column;gap:3px;">${lbl}<input id="${id}" type="${tipo||'date'}" value="${esc(val||'')}" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;"></label>`;
    const idb = _recIdb(cliente);
    return `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;margin-bottom:14px;overflow:hidden;">
      <div style="padding:10px 16px;background:var(--bg);display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;border-bottom:1px solid var(--border);">
        <div><div style="font-weight:800;font-size:14px;">${esc(cliente)}</div><div style="font-size:11px;color:var(--muted);">CNPJ: ${cnpj?esc(_recFmtCnpj(cnpj)):'<span style="color:var(--err);">não está no Cadastro — digite abaixo e salve</span>'} · ${ls.length} processo(s) · ${tQtd} pneus · ${fmtKg(tPeso)} kg · <b>a reciclar ${fmtKg(tRec)} kg</b></div></div>
        <div style="display:flex;gap:8px;align-items:center;">
          <span style="background:${st.fundo};color:${st.cor};font-weight:800;font-size:11px;padding:3px 10px;border-radius:20px;">${st.txt}</span>
          <button type="button" onclick="exportarReciclagemExcel(decodeURIComponent('${key}'))" style="font-size:12px;font-weight:700;padding:6px 12px;border:1px solid var(--border);border-radius:7px;background:#fff;cursor:pointer;">⬇️ Excel p/ cliente</button>
        </div>
      </div>
      <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="color:var(--muted);font-size:10px;text-transform:uppercase;">
          <th colspan="6"></th>${ncmsGrupo.map(n=>`<th colspan="2" style="padding:6px 8px;text-align:center;border-left:1px solid var(--border);background:#f3e8ff;color:#6b21a8;">NCM ${esc(n)}</th>`).join('')}<th></th></tr>
          <tr style="text-align:left;color:var(--muted);font-size:10px;text-transform:uppercase;">
          <th style="padding:6px 8px;">Referência</th><th style="padding:6px 8px;">Data Registro DI/DUIMP</th><th style="padding:6px 8px;">Nº DI/DUIMP</th>
          <th style="padding:6px 8px;text-align:right;">Peso total DI (kg)</th><th style="padding:6px 8px;text-align:right;">Qtd</th><th style="padding:6px 8px;text-align:right;">Peso a reciclar (70%)</th>
          ${ncmsGrupo.map(()=>`<th style="padding:6px 8px;text-align:right;border-left:1px solid var(--border);">Qtd</th><th style="padding:6px 8px;text-align:right;">Peso</th>`).join('')}<th></th></tr></thead>
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
      ${kpi('Peso total DI (kg)', fmtKg(totPeso))}${kpi('A reciclar (kg)', fmtKg(totRec),'#15803d')}
      ${kpi('A enviar', stCount.pendente,'#b45309')}${kpi('Enviadas', stCount.enviado,'#7c3aed')}${kpi('Realizadas', stCount.realizado,'#1d4ed8')}${kpi('Pagas', stCount.pago,'#15803d')}
    </div>
    ${(semPeso||presumidos||aConferir.length||semQuebra.length)?`<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 16px;margin-bottom:14px;font-size:12px;color:#78350f;">
      <b>⚠️ Dados a completar antes de enviar:</b>
      ${semPeso?`<div>• ${semPeso} processo(s) sem o peso total da DI/DUIMP — abra o processo e leia a DI/DUIMP na Extração com IA (ou digite na aba Documentos).</div>`:''}
      ${semQuebra.length?`<div>• ${semQuebra.length} processo(s) com mais de um NCM sem a quantidade/peso de cada NCM: ${semQuebra.map(l=>`<a href="#" onclick="_recEditarNcms(${jsArg(l.id)});return false;" style="color:#92400e;font-weight:700;">${esc(l.referencia)}</a>`).join(', ')} — clique para separar (ou leia a DI/DUIMP de novo na Extração com IA).</div>`:''}
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
  const ncms = _recNcmsDoGrupo(ls);
  const nCols = 7 + ncms.length*2; // B..G fixas + 2 por NCM
  const colL = c => { let s=''; while(c>0){ const m=(c-1)%26; s=String.fromCharCode(65+m)+s; c=Math.floor((c-1)/26); } return s; };
  const ultCol = colL(nCols+1);
  const wb = new ExcelJS.Workbook(); wb.creator='IMPAK';
  const ws = wb.addWorksheet(`${_recTri} TRIMESTRE DE ${_recAno}`);
  ws.columns = [{width:3},{width:16},{width:17},{width:21},{width:14},{width:9},{width:16}].concat(ncms.flatMap(()=>[{width:10},{width:14}]));
  const F = (b,sz)=>({ name:'Calibri', size:sz||11, bold:!!b });
  const borda = { top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'} };
  const cinza = { type:'pattern', pattern:'solid', fgColor:{argb:'FFD9E1F2'} };
  const verde = { type:'pattern', pattern:'solid', fgColor:{argb:'FFE2EFDA'} };
  const lilas = { type:'pattern', pattern:'solid', fgColor:{argb:'FFE4CCEA'} };
  const amarelo = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFFF2CC'} };
  ws.mergeCells(`B2:${ultCol}2`); ws.getCell('B2').value = `RELAÇÃO RECICLAGEM ${_recTri} TRIMESTRE DE ${_recAno}`;
  ws.getCell('B2').font = F(true,13); ws.getCell('B2').fill = cinza;
  ws.mergeCells(`B3:${ultCol}3`); ws.getCell('B3').value = `CNPJ: ${cnpj ? _recFmtCnpj(cnpj) : '—'} - ${cliente}`;
  ws.getCell('B3').font = F(false,12);
  ws.mergeCells('E4:F4'); ws.getCell('E4').value = 'TOTAL DI';
  ws.getCell('G4').value = 'RECICLAR';
  ['E4','G4'].forEach(a=>{ ws.getCell(a).font=F(true,10); ws.getCell(a).fill = a==='G4'?verde:cinza; });
  ncms.forEach((n,i)=>{
    const c1 = 8+i*2; ws.mergeCells(4,c1,4,c1+1);
    const c = ws.getCell(4,c1); c.value = n === REC_NCM_A_CONFIRMAR ? n : 'NCM ' + n; c.font = F(true,10); c.fill = lilas;
  });
  ['Referência','Data Registro DI','Número DI / Duimp','Peso Total DI','QTD','Peso a reciclar'].concat(ncms.flatMap(()=>['QTD','Peso'])).forEach((h,i)=>{
    const c = ws.getCell(5, i+2); c.value = h; c.font = F(true,10); c.fill = i===5?verde:(i>=6?lilas:cinza);
  });
  let r = 6;
  const pend = [];
  ls.forEach(l=>{
    ws.getCell(r,2).value = l.referencia;
    ws.getCell(r,3).value = l.dataDi ? new Date(l.dataDi+'T12:00:00') : null; ws.getCell(r,3).numFmt = 'dd/mm/yyyy';
    ws.getCell(r,4).value = l.numeroDi || '';
    ws.getCell(r,5).value = l.peso; ws.getCell(r,5).numFmt = '#,##0.00';
    ws.getCell(r,6).value = l.qtd;
    if(l.porNcm){
      ncms.forEach((n,i)=>{
        const v = l.porNcm[n]; const c1 = 8+i*2;
        if(v){ ws.getCell(r,c1).value = v.qtd; ws.getCell(r,c1+1).value = v.peso; }
        ws.getCell(r,c1+1).numFmt = '#,##0.00';
      });
      // Reciclar = 70% da soma dos pesos por NCM de pneu (= peso total quando é tudo pneu)
      const somaPesos = ncms.map((n,i)=>colL(9+i*2)+r).join('+');
      ws.getCell(r,7).value = { formula: ncms.length ? `(${somaPesos})*70%` : `E${r}*70%` };
    } else {
      ws.getCell(r,7).value = { formula:`E${r}*70%` };
      for(let c=8;c<=nCols+1;c++) ws.getCell(r,c).fill = amarelo;
      pend.push(l.referencia);
    }
    ws.getCell(r,7).numFmt = '#,##0.00';
    r++;
  });
  const ult = r-1;
  ws.getCell(r,2).value = 'TOTAL';
  for(let c=5;c<=nCols+1;c++){
    const L = colL(c);
    ws.getCell(r,c).value = { formula:`SUM(${L}6:${L}${ult})` };
    if(c!==6 && !(c>=8 && (c-8)%2===0)) ws.getCell(r,c).numFmt='#,##0.00';
  }
  for(let c=2;c<=nCols+1;c++){ ws.getCell(r,c).font = F(true,11); ws.getCell(r,c).fill = cinza; }
  for(let rr=2; rr<=r; rr++) for(let c=2;c<=nCols+1;c++){ const cell = ws.getCell(rr,c); cell.border = borda; cell.alignment = { horizontal:'center', vertical:'middle' }; if(!cell.font || !cell.font.name) cell.font = F(false,11); }
  if(pend.length){ ws.getCell(r+3,2).value = 'Sem quantidade/peso por NCM (em amarelo): ' + pend.join(', '); ws.getCell(r+3,2).font = { name:'Calibri', size:9, bold:true, color:{argb:'FF92400E'} }; }
  ws.getCell(r+2,2).value = 'Peso a reciclar = 70% do peso líquido dos itens de pneu (NCM 4011 / 4012) da DI/DUIMP, separado por NCM.';
  ws.getCell(r+2,2).font = { name:'Calibri', size:9, italic:true, color:{argb:'FF64748B'} };
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const a = document.createElement('a'); a.href = url;
  a.download = `RECICLAGEM ${cliente.replace(/[\\/:*?"<>|]/g,'').slice(0,40)} ${_recTri}T${_recAno}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url), 2000);
  showToast('Planilha de reciclagem gerada','ok');
}


// NCMs (de pneu) presentes num grupo de linhas, na ordem 4011.10 → 4012.
function _recNcmsDoGrupo(ls){
  const set = new Set();
  ls.forEach(l => { if(l.porNcm) Object.keys(l.porNcm).forEach(n => set.add(n)); else parseNcmsDetalhe(l.ncms).ncms.filter(_recEhNcmPneu).forEach(n => set.add(n)); });
  return [...set].sort((a,b) => (a===REC_NCM_A_CONFIRMAR) - (b===REC_NCM_A_CONFIRMAR) || a.localeCompare(b));
}

// Editor "Separar por NCM": qtd e peso líquido de cada NCM do processo.
// Grava no di_ncms (permitido mesmo em processo fechado — dado da reciclagem).
function _recEditarNcms(id){
  const p = (_processos||[]).find(x => String(x.id) === String(id)); if(!p) return;
  const info = parseNcmsDetalhe(p.di_ncms);
  let ncms = info.ncms.length ? info.ncms : ['4011.20.90'];
  let bg = document.getElementById('modal-rec-ncm-bg');
  if(!bg){ bg = document.createElement('div'); bg.id = 'modal-rec-ncm-bg'; bg.className = 'modal-bg'; document.body.appendChild(bg); }
  const val = (n,k) => info.detalhe && info.detalhe[n] ? String(info.detalhe[n][k]).replace('.',',') : (ncms.length===1 ? String((k==='qtd'?_recQtd(p):_recPeso(p))??'').replace('.',',') : '');
  const linha = (n,i) => `<div class="rec-ncm-linha" style="display:flex;gap:8px;margin-bottom:6px;">
      <input class="form-input rn-ncm" value="${esc(n)}" placeholder="4011.20.90" style="flex:1.2;">
      <input class="form-input rn-qtd" value="${esc(val(n,'qtd'))}" placeholder="qtd" inputmode="decimal" style="flex:1;">
      <input class="form-input rn-peso" value="${esc(val(n,'peso'))}" placeholder="peso líquido kg" inputmode="decimal" style="flex:1.2;">
    </div>`;
  bg.innerHTML = `<div class="modal" style="max-width:520px;">
    <div class="modal-title">Separar por NCM — ${esc(p.referencia||'')}</div>
    <div style="font-size:12px;color:var(--muted);margin:6px 0 10px;">Quantidade (unidade estatística) e peso líquido (kg) de cada NCM, conforme os itens da DI/DUIMP ${esc(p.numero_di||'')}. Peso total da DI: <b>${_recPeso(p)!=null?_recPeso(p).toLocaleString('pt-BR',{minimumFractionDigits:2}):'—'} kg</b> · Qtd: <b>${_recQtd(p)??'—'}</b></div>
    <div style="display:flex;gap:8px;font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;"><span style="flex:1.2;">NCM</span><span style="flex:1;">Qtd</span><span style="flex:1.2;">Peso (kg)</span></div>
    <div id="rec-ncm-linhas">${ncms.map(linha).join('')}</div>
    <button type="button" class="btn btn-outline" style="font-size:11px;padding:4px 10px;" onclick="document.getElementById('rec-ncm-linhas').insertAdjacentHTML('beforeend', ${esc(JSON.stringify(linha('',0)))})">+ NCM</button>
    <div id="rec-ncm-soma" style="font-size:11px;color:var(--muted);margin-top:8px;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
      <button class="btn btn-outline" type="button" onclick="document.getElementById('modal-rec-ncm-bg').classList.remove('open')">Cancelar</button>
      <button class="btn" type="button" onclick="_recSalvarNcms(${jsArg(p.id)})">Salvar</button>
    </div></div>`;
  bg.classList.add('open');
}
async function _recSalvarNcms(id){
  const p = (_processos||[]).find(x => String(x.id) === String(id)); if(!p) return;
  const itens = [...document.querySelectorAll('#rec-ncm-linhas .rec-ncm-linha')].map(d => ({
    ncm: d.querySelector('.rn-ncm').value, quantidade: d.querySelector('.rn-qtd').value, peso_liquido: d.querySelector('.rn-peso').value,
  })).filter(it => String(it.ncm).replace(/\D/g,'').length >= 8);
  if(!itens.length){ showToast('Informe pelo menos um NCM','err'); return; }
  const txt = formatarNcmsDetalhe(itens);
  if(!/un,/.test(txt)){ showToast('Preencha qtd e peso de todos os NCMs','err'); return; }
  const somaPeso = itens.reduce((a,it)=>a+(_numFlex(it.peso_liquido)||0),0), pesoDi = _recPeso(p);
  if(pesoDi && Math.abs(somaPeso - pesoDi) > 1 && !confirm(`A soma dos pesos (${somaPeso.toLocaleString('pt-BR',{minimumFractionDigits:2})} kg) é diferente do peso total da DI (${pesoDi.toLocaleString('pt-BR',{minimumFractionDigits:2})} kg). Salvar mesmo assim?`)) return;
  try{
    const r = await fetch('/api/controle/v2/processo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({processo:{id:p.id, di_ncms:txt}})});
    const d = await r.json().catch(()=>({}));
    if(!r.ok || d.erro) throw new Error(d.erro || ('HTTP '+r.status));
    p.di_ncms = txt;
    document.getElementById('modal-rec-ncm-bg')?.classList.remove('open');
    showToast('NCMs separados ✓','ok');
    renderDashReciclagem();
  }catch(e){ showToast('Não foi possível salvar: '+e.message,'err'); }
}
