// controle-nf-import.js
//
// Importar dados da NF de Saída direto pra uma linha de Venda (aba Vendas):
// XML da NFe é parseado localmente no navegador (sem IA, sem ida ao
// servidor — o XML já é estruturado e oficial); PDF/imagem (DANFE
// escaneado, por ex.) reaproveita a mesma IA de extração usada em
// extrairComIA() (controle-import-ia.js), só que com um prompt focado em NF
// de Saída e escrevendo o resultado na venda certa (_vendas[vi]) em vez dos
// campos de topo do processo.
//
// Parte do controle_v2.html, extraído do <script> único original pra
// facilitar manutenção. Carregado via <script src> junto com os outros
// módulos (ver controle_v2.html) — não é um ES module, então todo
// estado (let/const de topo) e funções aqui continuam visíveis pros
// outros arquivos, exatamente como estavam quando tudo era um só
// <script>. controle-core.js precisa carregar ANTES dos demais (é
// quem declara o estado global: _processos, _user, FASES etc.).

async function importarNFVenda(vi, input){
  const file = input.files[0];
  if(!file) return;
  input.value = '';
  const processoIdOrigem = _editando ? _editando.id : null;

  const isXml = /\.xml$/i.test(file.name) || file.type.includes('xml');
  showToast(isXml ? 'Lendo XML da NFe...' : 'Analisando documento com IA...', 'info');

  try{
    const dados = isXml ? await parseNFeXml(file) : await extrairNFComIA(file);
    if(!dados){ showToast('Não foi possível extrair dados desse arquivo.', 'err'); return; }
    if(!_editando || _editando.id !== processoIdOrigem){
      showToast('Processo foi trocado antes da análise terminar — dados da NF descartados para evitar mistura entre processos. Reimporte no processo correto.', 'err');
      return;
    }
    // Data lida pela IA conferida antes de ir para a venda (ver conferirDataNFLida).
    if(!isXml && dados.tipo !== 'ENTRADA'){
      const avisoData = conferirDataNFLida(dados, 'nf_saida_data');
      if(avisoData) showToast(avisoData, 'warn', 15000);
    }
    // A aba Vendas só faz sentido pra NF de SAÍDA (nota emitida pro cliente
    // final) — se o documento anexado for lido como ENTRADA (nota de compra
    // da mercadoria importada), avisa em vez de aplicar campos vazios sem
    // explicação (cliente só vem preenchido quando tipo=SAIDA, ver prompt
    // em extrairNFComIA).
    // Retorno (simbólico) da remessa do armazém — CFOP 5907/1907/5906/1906
    // (Jean, 25/09/2026). Fica registrado na venda como retorno e não mexe
    // em estoque, venda nem faturamento. Vem antes do teste de ENTRADA porque
    // o retorno chega com a IMPAK como destinatária.
    if(ehCfopRetornoRemessa(dados.cfop)){
      const dupR = nfSaidaJaCadastrada(dados.nf_numero, vi);
      if(dupR){ showToast(`A NF ${dados.nf_numero} já está cadastrada (${dupR}) — nada foi alterado.`, 'err', 12000); return; }
      aplicarDadosNFNaVenda(vi, dados);
      showToast(`↩️ NF ${dados.nf_numero||''} é RETORNO da remessa (CFOP ${dados.cfop}) — registrada só para controle, não mexe em estoque nem em venda.`, 'info', 12000);
      return;
    }
    if(dados.tipo === 'ENTRADA'){
      showToast('Esse documento parece ser uma NF de ENTRADA (compra), não de Saída — nada foi preenchido. Confira o arquivo anexado.', 'err', 12000);
      return;
    }
    // IA retornou um objeto válido mas sem nenhum dado aproveitável (PDF
    // ilegível, DANFE com layout fora do padrão, etc.) — sem essa checagem
    // o toast de sucesso aparecia mesmo sem preencher nada, escondendo o
    // problema (relatado por Emanuelly 03/09/2026 no processo
    // KS260507SMBZIMP: nenhum campo veio, mas nao ficou claro que falhou).
    const vazio = !dados.cliente && !dados.nf_numero && !dados.nf_valor && (!dados.itens || !dados.itens.length);
    if(vazio){
      showToast('Não consegui ler os dados desse documento (nenhum campo reconhecido). Tente novamente ou preencha manualmente.', 'err', 12000);
      return;
    }
    // Anti-duplicidade: a mesma NF já cadastrada em outra venda ou no processo.
    // Em outra venda: não duplica, mas completa o que faltar nela (20/10/2026).
    const dup = nfSaidaJaCadastrada(dados.nf_numero, vi);
    if(dup){
      const viDup = vendaComNF(dados.nf_numero, vi);
      const c = viDup >= 0 ? completarVendaComNF(viDup, dados) : { preenchidos: [], divergencias: [] };
      const atencao = c.divergencias.length ? ' ATENÇÃO: ' + c.divergencias.join('; ') + '.' : '';
      if(c.preenchidos.length){
        renderVendas();
        showToast(`A NF ${dados.nf_numero} já estava na Venda ${viDup + 1} — completei lá o que faltava: ${c.preenchidos.join(', ')}.${atencao} Confira e salve.`, 'ok', 15000);
      } else showToast(`A NF ${dados.nf_numero} já está cadastrada (${dup}) — nada foi alterado.${atencao}`, 'err', 12000);
      return;
    }
    const avisoFiltro = aplicarFiltroProcessoNaNF(dados);
    aplicarDadosNFNaVenda(vi, dados);
    if(avisoFiltro){ showToast('✓ ' + avisoFiltro + ' Confira e salve.', 'ok', 15000); return; }
    if(ehCfopRemessaEstoque(dados.cfop)) showToast('NF com CFOP 5905 = remessa para o estoque: fica registrada, mas NÃO conta como venda.', 'info', 10000);
    const itensMsg = dados.itens.length ? `${dados.itens.length} ite${dados.itens.length===1?'m':'ns'} preenchido${dados.itens.length===1?'':'s'}` : 'sem itens de produto reconhecidos (confira a lista manualmente)';
    showToast(`✓ NF importada: ${itensMsg}` + (dados.itens.length > 1 ? ' — se algum item for de outro processo, remova-o aqui (este processo fica com a soma dos itens dele).' : ''), dados.itens.length ? 'ok' : 'warn', 12000);
  }catch(e){
    showToast('Erro ao importar NF: '+e.message, 'err', 12000);
  }
}


// ── Itens da NF por processo (16/10/2026, Bianca) ──────────────────────
// A NF de saída pode juntar mercadoria de mais de um processo; agora cada
// item traz a referência na descrição (campo "Descrição para Impressão" do
// Conexos, ex.: "PNEU ... UD26-124"). Ao importar, fica só o que é do
// processo aberto. Se nenhum item citar a referência, mantém tudo (NF antiga).
function _refNorm(r){ return String(r||'').toUpperCase().replace(/^IMPAK[-_\s]*/,'').replace(/[^A-Z0-9]/g,''); }
function _refsNoTexto(txt){
  return (String(txt||'').toUpperCase().match(/[A-Z0-9][A-Z0-9\-_.\/]*[A-Z0-9]/g) || [])
    .map(t => _refNorm(t)).filter(t => t.length >= 5 && /[A-Z]/.test(t) && /\d/.test(t));
}
function filtrarItensNFDoProcesso(itens, referencia){
  const lista = Array.isArray(itens) ? itens : [];
  const ref = _refNorm(referencia);
  if(!ref || lista.length === 0) return { itens: lista, filtrou: false, fora: [] };
  const doProc = lista.filter(it => _refsNoTexto(it.descricao).includes(ref));
  if(!doProc.length) return { itens: lista, filtrou: false, fora: [] };
  const fora = lista.filter(it => !doProc.includes(it));
  return { itens: doProc, filtrou: fora.length > 0, fora };
}
function _somaItensNF(itens){
  return Math.round((itens||[]).reduce((s,it)=>s+(parseFloat(it.valor_total)||0),0)*100)/100;
}
// Aplica o filtro no objeto lido da NF; devolve texto do aviso ('' se nada mudou).
function aplicarFiltroProcessoNaNF(dados){
  const referencia = (document.getElementById('f_referencia')||{}).value || (_editando && _editando.referencia) || '';
  const r = filtrarItensNFDoProcesso(dados.itens, referencia);
  if(!r.filtrou) return '';
  dados.itens = r.itens;
  const soma = _somaItensNF(r.itens);
  dados.nf_valor_total_documento = dados.nf_valor;
  if(soma > 0) dados.nf_valor = soma;
  // Só cita como "outro processo" o que for referência de processo existente.
  const conhecidas = new Map((typeof _processos !== 'undefined' ? _processos : []).map(p => [_refNorm(p.referencia), p.referencia]));
  const outras = [...new Set(r.fora.flatMap(it => _refsNoTexto(it.descricao)).filter(x => conhecidas.has(x) && x !== _refNorm(referencia)).map(x => conhecidas.get(x)))].slice(0, 4);
  return `NF com itens de mais de um processo: ficaram só os ${r.itens.length} ite${r.itens.length===1?'m':'ns'} de ${referencia}` +
    (soma > 0 ? ` (R$ ${exibirMoeda(soma)} de R$ ${exibirMoeda(dados.nf_valor_total_documento)} da nota)` : '') +
    `; ${r.fora.length} ite${r.fora.length===1?'m ficou':'ns ficaram'} de fora` + (outras.length ? ` (${outras.join(', ')})` : '') + '.';
}

// Nº de NF já cadastrado em alguma venda (exceto a venda "ignorarVi") ou nos
// campos de NF de Saída do processo. Retorna onde está, ou '' se não achou.
function _normNumNF(n){ return String(n||'').replace(/\D/g,'').replace(/^0+/,''); }
function nfSaidaJaCadastrada(numero, ignorarVi){
  const alvo = _normNumNF(numero);
  if(!alvo) return '';
  const vs = (typeof _vendas !== 'undefined' && Array.isArray(_vendas)) ? _vendas : [];
  for(let i=0;i<vs.length;i++){
    if(i === ignorarVi) continue;
    if(_normNumNF(vs[i].nf_saida_numero) === alvo) return vendaEhRemessa(vs[i]) ? 'como remessa p/ estoque na aba Vendas' : `na Venda ${i+1}`;
  }
  if(ignorarVi !== 'processo' && _normNumNF(document.getElementById('f_nf_saida_numero')?.value) === alvo) return 'na NF de Saída do processo (aba Documentos)';
  return '';
}

// Índice da venda com esse nº de NF (-1 se nenhuma).
function vendaComNF(numero, ignorarVi){
  const alvo = _normNumNF(numero);
  const vs = (typeof _vendas !== 'undefined' && Array.isArray(_vendas)) ? _vendas : [];
  if(!alvo) return -1;
  return vs.findIndex((v, i) => i !== ignorarVi && _normNumNF(v.nf_saida_numero) === alvo);
}

// NF já cadastrada numa venda, mas incompleta (UD26-047, 20/10/2026: a venda
// tinha nº/data/CFOP e não tinha VALOR — ler a NF de novo dizia "já
// cadastrada, nada foi alterado" e o Fechamento seguia sem receita). Completa
// só o que está vazio na venda (valor, data, CFOP, cliente, itens/valor dos
// itens); o que já está lançado e diverge da NF vira aviso, nunca é trocado.
function completarVendaComNF(vi, dados){
  const v = (typeof _vendas !== 'undefined' && _vendas) ? _vendas[vi] : null;
  const out = { preenchidos: [], divergencias: [] };
  if(!v || !dados) return out;
  const vazio = x => x == null || String(x).trim() === '';
  const fmt = n => 'R$ ' + exibirMoeda(n);
  const valorNF = parseFloat(dados.nf_valor) || 0;
  const valorVenda = parseFloat(v.nf_saida_valor) || 0;
  if(valorNF > 0 && !(valorVenda > 0)){ v.nf_saida_valor = Math.round(valorNF * 100) / 100; out.preenchidos.push('valor ' + fmt(valorNF)); }
  else if(valorNF > 0 && Math.abs(valorVenda - valorNF) > 0.05) out.divergencias.push(`valor na venda ${fmt(valorVenda)} e na NF ${fmt(valorNF)} (mantive o da venda)`);
  if(dados.nf_data && vazio(v.nf_saida_data)){ v.nf_saida_data = dados.nf_data; out.preenchidos.push('data'); }
  if(dados.cfop && vazio(v.nf_saida_cfop)){ v.nf_saida_cfop = dados.cfop; out.preenchidos.push('CFOP ' + dados.cfop); }
  if(dados.cliente && vazio(v.cliente)){ v.cliente = dados.cliente; out.preenchidos.push('cliente'); }
  const itensNF = Array.isArray(dados.itens) ? dados.itens.filter(it => it && (it.descricao || it.quantidade)) : [];
  const itensVenda = Array.isArray(v.itens) ? v.itens : [];
  const semItens = !itensVenda.some(it => it && (!vazio(it.descricao) || parseFloat(it.quantidade) > 0));
  if(itensNF.length && semItens){
    v.itens = itensNF.map(it => ({ descricao: it.descricao || '', quantidade: it.quantidade != null ? String(it.quantidade) : '', valor_total: it.valor_total || '', valor_unit: it.valor_unit || '' }));
    out.preenchidos.push(`${itensNF.length} ite${itensNF.length === 1 ? 'm' : 'ns'}`);
  } else if(itensNF.length){
    // Itens já lançados sem valor: pega o valor do item da NF de mesma
    // quantidade (e, havendo mais de um, o de descrição parecida).
    const usados = new Set();
    const palavras = s => new Set(String(s || '').toUpperCase().split(/[^A-Z0-9/.]+/).filter(p => p.length >= 3));
    let n = 0;
    itensVenda.forEach(it => {
      if(!it || !vazio(it.valor_total)) return;
      const q = parseFloat(it.quantidade) || 0;
      const cands = itensNF.map((x, i) => ({ x, i })).filter(c => !usados.has(c.i) && (parseFloat(c.x.quantidade) || 0) === q && !vazio(c.x.valor_total));
      if(!cands.length) return;
      const pv = palavras(it.descricao);
      const nota = c => [...palavras(c.x.descricao)].filter(p => pv.has(p)).length;
      const melhor = cands.length === 1 ? cands[0] : cands.sort((a, b) => nota(b) - nota(a))[0];
      if(cands.length > 1 && !nota(melhor)) return;
      usados.add(melhor.i);
      it.valor_total = melhor.x.valor_total;
      if(vazio(it.valor_unit) && melhor.x.valor_unit) it.valor_unit = melhor.x.valor_unit;
      n++;
    });
    if(n) out.preenchidos.push(`valor de ${n} ite${n === 1 ? 'm' : 'ns'}`);
  }
  if(dados.cliente && !vazio(v.cliente)){
    const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const a = norm(dados.cliente), b = norm(v.cliente);
    if(a && b && !a.includes(b) && !b.includes(a)) out.divergencias.push(`cliente na venda "${v.cliente}" e na NF "${dados.cliente}"`);
  }
  return out;
}

// Notas de saída da aba Fechamento da planilha (planilha-import.js →
// resumo.notas) → venda da aba Vendas, ou NF de Saída do processo (aba
// Documentos) quando o processo não usa a aba Vendas. Mesma regra de
// completarVendaComNF: só preenche o que está vazio. Nota sem número (a
// planilha calcula o valor e ninguém digitou o nº) casa com a única venda
// de verdade do processo. Devolve { preenchidos, avisos } para a tela.
function aplicarNotasDaPlanilha(notas){
  const out = { preenchidos: [], avisos: [] };
  const lista = (Array.isArray(notas) ? notas : []).filter(n => n && parseFloat(n.valor) > 0);
  if(!lista.length) return out;
  const fmt = n => 'R$ ' + exibirMoeda(n);
  const iso = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? s : '';
  const r2 = x => Math.round((parseFloat(x) || 0) * 100) / 100;
  const vendas = (typeof _vendas !== 'undefined' && Array.isArray(_vendas)) ? _vendas : [];
  const ehVenda = v => !(typeof vendaEhRemessa === 'function' && vendaEhRemessa(v)) && !(typeof vendaEhRetorno === 'function' && vendaEhRetorno(v)) && !(typeof ehCfopBaixa === 'function' && ehCfopBaixa(v.nf_saida_cfop));
  if(vendas.length){
    const reais = vendas.map((v, i) => i).filter(i => ehVenda(vendas[i]));
    const usadas = new Set();
    let mudou = false;
    lista.forEach(n => {
      const num = _normNumNF(n.numero);
      let vi = num ? vendas.findIndex((v, i) => !usadas.has(i) && _normNumNF(v.nf_saida_numero) === num) : -1;
      if(vi < 0 && lista.length === 1 && reais.length === 1 && !usadas.has(reais[0]) && (!num || !_normNumNF(vendas[reais[0]].nf_saida_numero))) vi = reais[0];
      const rotNota = `Nota de ${fmt(n.valor)}${n.numero ? ' (NF ' + n.numero + ')' : ''} da planilha`;
      if(vi < 0){ out.avisos.push(`${rotNota} não foi lançada: não achei a venda dela na aba Vendas — lance a NF lá (ou leia o XML/PDF da nota).`); return; }
      usadas.add(vi);
      const v = vendas[vi];
      const rot = `Venda ${vi + 1}${v.nf_saida_numero ? ' (NF ' + v.nf_saida_numero + ')' : ''}`;
      const atual = parseFloat(v.nf_saida_valor) || 0;
      if(!(atual > 0)){ v.nf_saida_valor = r2(n.valor); out.preenchidos.push(`${rot}: valor ${fmt(n.valor)}`); mudou = true; }
      else if(Math.abs(atual - n.valor) > 1) out.avisos.push(`${rot}: a venda tem ${fmt(atual)} e a planilha ${fmt(n.valor)} — mantive o valor da venda; confira.`);
      if(!_normNumNF(v.nf_saida_numero) && num){ v.nf_saida_numero = String(n.numero); out.preenchidos.push(`${rot}: nº ${n.numero}`); mudou = true; }
      if(!v.nf_saida_data && iso(n.data)){ v.nf_saida_data = n.data; out.preenchidos.push(`${rot}: data`); mudou = true; }
    });
    if(mudou){
      if(typeof _painelDirty !== 'undefined') _painelDirty = true;
      if(typeof renderVendas === 'function') renderVendas();
      if(typeof sincronizarVendasLegado === 'function') sincronizarVendasLegado();
    }
    return out;
  }
  // Sem aba Vendas: NF de Saída do processo (aba Documentos).
  if(lista.length > 1){
    out.avisos.push(`A planilha tem ${lista.length} notas de saída (${lista.map(n => (n.numero ? 'NF ' + n.numero + ' ' : '') + fmt(n.valor)).join(', ')}) — com mais de uma nota, lance cada uma na aba Vendas (ou leia o XML/PDF de cada uma).`);
    return out;
  }
  const n = lista[0];
  const elNum = document.getElementById('f_nf_saida_numero'), elValor = document.getElementById('f_nf_saida_valor'), elData = document.getElementById('f_nf_saida_data');
  if(!elValor) return out;
  const cfop = (document.getElementById('f_nf_saida_cfop') || {}).value || '';
  if(typeof ehCfopRemessaEstoque === 'function' && ehCfopRemessaEstoque(cfop)){
    out.avisos.push(`A NF de Saída do processo é de remessa (CFOP ${cfop}); a nota de ${fmt(n.valor)} da planilha é a venda — lance-a na aba Vendas (ou leia o XML/PDF da nota).`);
    return out;
  }
  const numAtual = _normNumNF(elNum && elNum.value);
  if(numAtual && n.numero && numAtual !== _normNumNF(n.numero)){
    out.avisos.push(`A NF de Saída do processo é a ${elNum.value} e a planilha traz a NF ${n.numero} — não mexi; confira.`);
    return out;
  }
  const valorAtual = parseFloat(typeof parseValorMoeda === 'function' ? parseValorMoeda(elValor.value) : elValor.value) || 0;
  if(!(valorAtual > 0)){ elValor.value = exibirMoeda(r2(n.valor)); out.preenchidos.push(`NF de Saída: valor ${fmt(n.valor)}`); }
  else if(Math.abs(valorAtual - n.valor) > 1) out.avisos.push(`NF de Saída: o processo tem ${fmt(valorAtual)} e a planilha ${fmt(n.valor)} — mantive o do processo; confira.`);
  if(elNum && !elNum.value && n.numero){ elNum.value = n.numero; out.preenchidos.push(`NF de Saída: nº ${n.numero}`); }
  if(elData && !elData.value && iso(n.data)){ elData.value = n.data; out.preenchidos.push('NF de Saída: data'); }
  if(out.preenchidos.length){
    if(typeof _painelDirty !== 'undefined') _painelDirty = true;
    if(typeof atualizarFaseEmTempoReal === 'function') atualizarFaseEmTempoReal();
  }
  return out;
}

// ── XML da NFe (parse 100% local, sem chamar servidor) ──────────────────
async function parseNFeXml(file){
  const texto = await file.text();
  const doc = new DOMParser().parseFromString(texto, 'application/xml');
  if(doc.querySelector('parsererror')) throw new Error('XML inválido ou corrompido');

  const txt = tag => {
    const el = doc.getElementsByTagName(tag)[0];
    return el ? el.textContent.trim() : '';
  };
  // dest = destinatário da NF = o cliente que comprou
  const destEl = doc.getElementsByTagName('dest')[0];
  const txtDest = tag => {
    if(!destEl) return '';
    const el = destEl.getElementsByTagName(tag)[0];
    return el ? el.textContent.trim() : '';
  };

  const cliente = txtDest('xNome');
  const nfNumero = txt('nNF');
  const dhEmi = txt('dhEmi') || txt('dEmi'); // dEmi = layout antigo (NF-e 3.10)
  const nfData = dhEmi ? dhEmi.slice(0,10) : '';
  const totalEl = doc.getElementsByTagName('ICMSTot')[0];
  const nfValor = totalEl ? parseFloat((totalEl.getElementsByTagName('vNF')[0]||{}).textContent || '0') : 0;

  const itens = Array.from(doc.getElementsByTagName('det')).map(det=>{
    const prod = det.getElementsByTagName('prod')[0];
    if(!prod) return null;
    const xProd = (prod.getElementsByTagName('xProd')[0]||{}).textContent || '';
    const qCom  = (prod.getElementsByTagName('qCom')[0]||{}).textContent || '';
    const cfopItem = (prod.getElementsByTagName('CFOP')[0]||{}).textContent || '';
    // Valor do item NA NF = mesma composição do vNF, só que do item:
    // vProd − vDesc + vFrete + vSeg + vOutro + vIPI + vICMSST + vFCPST + vII.
    // A soma dos itens bate com o total da NF (diferença de centavos).
    const num = tag => { const el = det.getElementsByTagName(tag)[0]; return el ? (parseFloat(el.textContent) || 0) : 0; };
    const vItem = num('vProd') - num('vDesc') + num('vFrete') + num('vSeg') + num('vOutro') + num('vIPI') + num('vICMSST') + num('vFCPST') + num('vII');
    const qtd = qCom ? parseFloat(qCom) : 0;
    const valorTotal = Math.round(vItem * 100) / 100;
    return { descricao: xProd.trim(), quantidade: qCom ? String(qtd) : '', cfop: cfopItem.trim(),
      valor_total: vItem ? String(valorTotal) : '', valor_unit: (vItem && qtd > 0) ? String(Math.round(valorTotal / qtd * 10000) / 10000) : '' };
  }).filter(Boolean);
  const cfop = (itens.find(it=>it.cfop)||{}).cfop || '';
  // tpNF: 0 = entrada, 1 = saída (padrao NFe) — mais confiavel que tentar inferir por outros campos
  const tpNF = txt('tpNF');
  const tipo = tpNF === '0' ? 'ENTRADA' : 'SAIDA';

  if(!cliente && !nfNumero && !itens.length) throw new Error('Não achei os campos esperados de uma NFe nesse XML');

  return { tipo, cliente, nf_numero: nfNumero, nf_data: nfData, nf_valor: nfValor||0, cfop, itens };
}

// ── Data da NF lida pela IA, conferida com o processo (18/10/2026) ──────
// A IA às vezes lê a data brasileira como americana (03/04 → 04/03). Se a
// data lida é impossível (NF de entrada antes do registro da DI, NF no
// futuro...) e a versão com dia e mês trocados fecha, usa a trocada; se
// nenhuma fecha, não preenche a data. Devolve o aviso para a tela ('' se a
// data estava certa). Só para PDF/imagem — o XML traz a data exata.
function conferirDataNFLida(dados, campo){
  // Aviso de quando o texto impresso corrigiu a data (ver dataNFPeloTexto).
  const avisoTexto = (dados && dados.aviso_data_texto) || '';
  const juntar = a => [avisoTexto, a].filter(Boolean).join(' ');
  if(!dados || !dados.nf_data || typeof ValidacaoDatas === 'undefined' || !ValidacaoDatas.conferirDatasLidas) return avisoTexto;
  try{
    const estado = {};
    ['data_registro_di','data_liberacao','data_chegada','data_carregamento','nf_entrada_data','nf_saida_data'].forEach(k => {
      const el = document.getElementById('f_'+k); if(el && el.value) estado[k] = el.value;
    });
    const r = ValidacaoDatas.conferirDatasLidas({ [campo]: dados.nf_data }, estado, { semTroca: dados.nf_data_confirmada ? [campo] : [] });
    if(r.trocadas.length){ dados.nf_data = r.trocadas[0].usada; return juntar(r.trocadas[0].aviso); }
    if(r.descartadas.length){ dados.nf_data = ''; return juntar(r.descartadas[0].aviso); }
  }catch(e){ console.warn('conferência da data da NF:', e); }
  return avisoTexto;
}

// A data de emissão como está impressa no DANFE (dia/mês/ano) confere a
// conversão feita pela IA: se ela inverteu dia e mês, vale a do texto.
// confirmada = o texto não deixa dúvida (dia acima de 12) — a conferência
// acima não troca mais essa data.
function dataNFPeloTexto(lida, texto){
  const out = { data: lida || '', confirmada: false, aviso: '' };
  if(typeof ValidacaoDatas === 'undefined' || !ValidacaoDatas.lerDataTexto || typeof texto !== 'string') return out;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(lida || '').trim());
  if(!m) return out;
  const impresso = texto.trim().slice(0, 40);
  const t = ValidacaoDatas.lerDataTexto(impresso, { diaPrimeiro: true });
  if(!t || !t.data) return out;
  const br = s => s.slice(8,10) + '/' + s.slice(5,7) + '/' + s.slice(0,4);
  if(t.data === m[0]){ out.data = m[0]; out.confirmada = !t.ambigua; return out; }
  if(t.data === ValidacaoDatas.trocarDiaMes(m[0])){
    out.data = t.data; out.confirmada = !t.ambigua;
    out.aviso = `Data da NF: a nota traz "${impresso}" — usei ${br(t.data)}, não ${br(m[0])}. Confira.`;
  }
  return out;
}

// ── PDF/imagem (DANFE) via IA — reaproveita /api/analisar ───────────────
async function extrairNFComIA(file){
  const base64 = await new Promise((res,rej)=>{
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  const isImg = file.type.startsWith('image/');

  const prompt = `Este documento deveria ser uma Nota Fiscal (DANFE) de SAÍDA (venda ao cliente final), mas confira com cuidado antes de extrair. Retorne SOMENTE JSON:
{
  "tipo": "",           // "SAIDA" se o campo NATUREZA DA OPERACAO contiver algo como VENDA/REMESSA (nota emitida para o cliente final); "ENTRADA" se contiver algo como COMPRA/NACIONALIZACAO/ENTRADA (nota de aquisicao da mercadoria importada). Use as pistas do proprio documento, nao suponha.
  "cliente": "",       // razão social do DESTINATÁRIO da nota (quem comprou) — so preencher se tipo=SAIDA
  "nf_numero": "",      // número da nota fiscal
  "nf_data": "YYYY-MM-DD", // data de emissão
  "nf_data_texto": "",  // a mesma data de emissão copiada EXATAMENTE como está impressa na nota (ex.: "05/10/2026"), sem converter
  "nf_valor": 0,        // valor total da nota em R$
  "cfop": "",            // codigo CFOP (ex: 5405, 5117, 5905, 1101, 3101) do item principal da nota
  "itens": [{"descricao":"", "quantidade":0, "valor_total":0}]  // um item por linha de produto da nota; "descricao" = descrição COMPLETA do item, copiada inteira (inclusive a referência do processo no fim, ex.: "... UF195 UD26-124"); valor_total = V. TOTAL do item + V. IPI do item (em R$)
}
Todo valor está em reais (R$), nunca em USD. Retorne apenas JSON válido, sem texto adicional.`;

  const content = [
    { type:'text', text: prompt },
    { type: isImg ? 'image':'document', source:{ type:'base64', media_type:file.type, data:base64 } }
  ];

  const resp = await fetch('/api/analisar', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({content}) });
  const d = await resp.json();
  if(!d.ok || !d.jobId) throw new Error(d.erro || 'Erro na IA');

  const inicio = Date.now();
  while(true){
    await new Promise(r=>setTimeout(r, 2500));
    const rJob = await fetch('/api/analisar/job/'+d.jobId);
    const dJob = await rJob.json();
    if(!dJob.ok) throw new Error(dJob.erro || 'Erro ao consultar análise');
    if(dJob.status === 'concluido'){
      const raw = (dJob.resultado.content||[]).map(c=>c.text||'').join('');
      let clean = raw.replace(/```json/gi,'').replace(/```/gi,'').trim();
      // Se ainda sobrou texto antes/depois do JSON (o modelo as vezes ignora
      // o "sem texto adicional" do prompt), isola o primeiro bloco {...}.
      const iniJson = clean.indexOf('{'), fimJson = clean.lastIndexOf('}');
      if(iniJson !== -1 && fimJson > iniJson) clean = clean.slice(iniJson, fimJson+1);
      let extracted;
      try{
        extracted = JSON.parse(clean);
      }catch(e){
        throw new Error('A IA não retornou um JSON válido pra esse documento (resposta: "'+raw.slice(0,120)+'..."). Tente novamente.');
      }
      const dataTexto = dataNFPeloTexto(extracted.nf_data, extracted.nf_data_texto);
      return {
        tipo: (extracted.tipo||'').toUpperCase().includes('ENTRADA') ? 'ENTRADA' : 'SAIDA',
        cliente: extracted.cliente||'',
        nf_numero: extracted.nf_numero||'',
        nf_data: dataTexto.data,
        nf_data_confirmada: dataTexto.confirmada,
        aviso_data_texto: dataTexto.aviso,
        nf_valor: parseFloat(extracted.nf_valor)||0,
        cfop: extracted.cfop||'',
        itens: Array.isArray(extracted.itens) ? extracted.itens.filter(it=>it&&(it.descricao||it.quantidade)).map(it=>{
          const q = parseFloat(it.quantidade) || 0, t = parseFloat(it.valor_total) || 0;
          return {descricao:it.descricao||'', quantidade:it.quantidade!=null?String(it.quantidade):'',
            valor_total: t ? String(Math.round(t*100)/100) : '', valor_unit: (t && q > 0) ? String(Math.round(t/q*10000)/10000) : ''};
        }) : [],
      };
    }
    if(dJob.status === 'erro') throw new Error(dJob.erro || 'Erro na IA');
    if(Date.now()-inicio > 180000) throw new Error('Análise demorou demais. Tente novamente.');
  }
}

// Escreve os dados extraídos (de qualquer uma das duas fontes acima) na
// venda "vi" — sobrescreve cliente/nº/data/valor e SUBSTITUI a lista de
// itens pela lista lida da NF (mais confiável que o que já estivesse ali,
// já que a NF é o documento oficial da venda).
function aplicarDadosNFNaVenda(vi, dados){
  const v = _vendas[vi];
  if(!v) return;
  if(dados.cliente) v.cliente = dados.cliente;
  if(dados.nf_numero) v.nf_saida_numero = dados.nf_numero;
  if(dados.nf_data) v.nf_saida_data = dados.nf_data;
  if(dados.nf_valor) v.nf_saida_valor = dados.nf_valor;
  if(dados.cfop) v.nf_saida_cfop = dados.cfop;
  if(dados.itens && dados.itens.length) v.itens = dados.itens;
  renderVendas();
}


// -- NF de Saida direto no processo (sem Venda) --
// Processos de cliente unico nao usam a aba Vendas (ver aviso na aba
// Vendas: 'se este processo tem um unico cliente/NF Saida, nao precisa
// usar esta aba'). Pra esses casos, este extrator reaproveita a mesma
// leitura (XML local ou IA) so que escreve direto nos campos de topo do
// processo (aba Documentos: f_nf_saida_numero/data/valor) em vez de numa
// linha de _vendas[].
async function importarNFSaidaProcesso(input){
  const file = input.files[0];
  if(!file) return;
  input.value = '';
  await importarNFSaidaProcessoArquivo(file);
}

// Núcleo real do import, separado de importarNFSaidaProcesso(input) pra poder
// ser chamado tanto pelo <input type=file> (onchange) quanto por
// arrastar-e-soltar (handleDropIA_NF, controle-import-ia.js) -- ambos
// convergem aqui, mesmo padrão já usado em processarFilaIA/extrairComIA na
// Extração com IA da aba Documentos (task #405).
async function importarNFSaidaProcessoArquivo(file, opts){
  if(!file) return null;
  opts = opts || {};
  // statusEl: a Extração com IA (aba Documentos) manda a NF de saída pra cá e
  // mostra o resultado no status dela (20/10/2026).
  const status = opts.statusEl || document.getElementById('ia-nf-saida-status');
  const isXml = /\.xml$/i.test(file.name) || file.type.includes('xml');
  if(status) status.textContent = isXml ? 'Lendo XML da NFe...' : 'Analisando documento com IA...';
  // Resultado para quem chamou: ok = algo foi lançado; destino = documentos |
  // vendas | entrada; camposLog = o que entra no Histórico da leitura.
  const res = { ok: false, destino: '', mensagem: '', camposLog: [] };
  const fim = (msg, extra) => { if(status) status.textContent = msg; res.mensagem = msg; Object.assign(res, extra || {}); return res; };
  const rotulo = c => (typeof LABELS_CAMPOS_IA !== 'undefined' && LABELS_CAMPOS_IA[c]) || c;

  try{
    const dados = isXml ? await parseNFeXml(file) : await extrairNFComIA(file);
    if(!dados) return fim('Nao foi possivel extrair dados desse arquivo.');

    // Retorno (simbólico) da remessa do armazém (CFOP 5907/6907/1907/2907/
    // 5906/6906/1906/2906 — Jean, 25/09/2026): não é NF de Entrada da
    // importação nem venda. Fica registrado na aba Vendas como retorno, só
    // para controle (não mexe em estoque, venda nem faturamento). Vem antes
    // do teste de ENTRADA porque o retorno chega com a IMPAK de destinatária.
    if(ehCfopRetornoRemessa(dados.cfop)){
      const numRet = _normNumNF(dados.nf_numero);
      const dupR = nfSaidaJaCadastrada(dados.nf_numero, 'processo');
      if(dupR || (numRet && _normNumNF(document.getElementById('f_nf_saida_numero')?.value) === numRet)) return fim(`A NF ${dados.nf_numero} já está cadastrada — nada foi alterado.`);
      if(typeof _vendas === 'undefined') return fim('Abra o processo para lançar a NF de retorno.');
      const r = vendaVazia();
      r.cliente = dados.cliente || '';
      r.nf_saida_numero = dados.nf_numero || ''; r.nf_saida_data = dados.nf_data || '';
      r.nf_saida_valor = dados.nf_valor || ''; r.nf_saida_cfop = dados.cfop || '';
      if(dados.itens && dados.itens.length) r.itens = dados.itens.map(it=>({descricao: it.descricao||'', quantidade: it.quantidade!=null?String(it.quantidade):'', valor_total: it.valor_total||'', valor_unit: it.valor_unit||''}));
      _vendas.push(r); _painelDirty = true;
      if(typeof renderVendas === 'function') renderVendas();
      if(typeof sincronizarVendasLegado === 'function') sincronizarVendasLegado();
      return fim(`↩️ NF ${dados.nf_numero||''} é RETORNO da remessa (CFOP ${dados.cfop}) — registrada na aba Vendas só para controle. Não mexe em estoque, venda nem na NF de Entrada. Confira e salve.`,
        { ok: true, destino: 'vendas', camposLog: [`Vendas: NF ${dados.nf_numero||''} (retorno, CFOP ${dados.cfop})`] });
    }

    if(dados.tipo === 'ENTRADA'){
      const elNumChk = document.getElementById('f_nf_entrada_numero');
      const elDataChk = document.getElementById('f_nf_entrada_data');
      const elValorChk = document.getElementById('f_nf_entrada_valor');
      const jaPreenchidoEnt = (elNumChk && elNumChk.value) || (elDataChk && elDataChk.value) || (elValorChk && elValorChk.value && elValorChk.value !== '0,00');
      const mesmaEnt = !!_normNumNF(dados.nf_numero) && _normNumNF(elNumChk && elNumChk.value) === _normNumNF(dados.nf_numero);
      if(jaPreenchidoEnt && !mesmaEnt){
        const okEnt = window.confirm('Ja existe NF Entrada preenchida nesse processo (No ' + (elNumChk ? elNumChk.value : '') + '). Sobrescrever com os dados extraidos da NF anexada?');
        if(!okEnt) return fim('Importacao cancelada (dados existentes mantidos).');
      }
      const avisoDataEnt = isXml ? '' : conferirDataNFLida(dados, 'nf_entrada_data');
      aplicarDadosNFEntradaNoProcesso(dados);
      if(avisoDataEnt) showToast(avisoDataEnt, 'warn', 15000);
      return fim('NF de Entrada importada' + (dados.nf_numero ? (' - No ' + dados.nf_numero) : '') + (avisoDataEnt ? ' | ATENÇÃO: ' + avisoDataEnt : ''),
        { ok: true, destino: 'entrada', camposLog: ['nf_entrada_numero','nf_entrada_data','nf_entrada_valor'].filter((c, i) => [dados.nf_numero, dados.nf_data, dados.nf_valor][i]).map(rotulo) });
    }

    // Data da NF de saída lida pela IA conferida antes de ir para o processo
    // ou para uma venda (ver conferirDataNFLida).
    const avisoDataSai = isXml ? '' : conferirDataNFLida(dados, 'nf_saida_data');
    if(avisoDataSai) showToast(avisoDataSai, 'warn', 15000);

    const elNumChk = document.getElementById('f_nf_saida_numero');
    const elDataChk = document.getElementById('f_nf_saida_data');
    const elValorChk = document.getElementById('f_nf_saida_valor');
    const avisoFiltro = aplicarFiltroProcessoNaNF(dados);

    // Anti-duplicidade: mesma NF já lançada numa venda — não duplica, mas
    // completa o que estiver faltando nela (valor, data, CFOP, itens).
    const dupVenda = nfSaidaJaCadastrada(dados.nf_numero, 'processo');
    if(dupVenda){
      const viDup = vendaComNF(dados.nf_numero);
      const c = viDup >= 0 ? completarVendaComNF(viDup, dados) : { preenchidos: [], divergencias: [] };
      const atencao = c.divergencias.length ? ' | ATENÇÃO: ' + c.divergencias.join('; ') : '';
      if(c.preenchidos.length){
        if(typeof _painelDirty !== 'undefined') _painelDirty = true;
        if(typeof renderVendas === 'function') renderVendas();
        if(typeof sincronizarVendasLegado === 'function') sincronizarVendasLegado();
        return fim(`A NF ${dados.nf_numero} já estava na Venda ${viDup + 1} — completei o que faltava: ${c.preenchidos.join(', ')}.${atencao} Confira e salve.`,
          { ok: true, destino: 'vendas', camposLog: [`Vendas: NF ${dados.nf_numero} completada (${c.preenchidos.join(', ')})`] });
      }
      return fim(`A NF ${dados.nf_numero} já está cadastrada (${dupVenda}) e completa — nada a alterar.${atencao}`);
    }

    // Regra CFOP (25/09/2026): se o processo já tem uma NF de Saída e a nova
    // é de OUTRO tipo (remessa 5905 x venda), as duas precisam ficar — a
    // nova vai para a aba Vendas em vez de apagar a anterior. Assim a
    // remessa p/ estoque e a venda posterior ficam registradas sem que a
    // mercadoria conte duas vezes (remessa nunca soma como venda).
    const cfopAtual = document.getElementById('f_nf_saida_cfop')?.value || '';
    const mesmaNF = !!_normNumNF(dados.nf_numero) && _normNumNF(elNumChk && elNumChk.value) === _normNumNF(dados.nf_numero);
    if(elNumChk && elNumChk.value && !mesmaNF && ehCfopRemessaEstoque(cfopAtual) !== ehCfopRemessaEstoque(dados.cfop) && typeof _vendas !== 'undefined'){
      const nova = vendaVazia();
      nova.cliente = dados.cliente || '';
      nova.nf_saida_numero = dados.nf_numero || '';
      nova.nf_saida_data = dados.nf_data || '';
      nova.nf_saida_valor = dados.nf_valor || '';
      nova.nf_saida_cfop = dados.cfop || '';
      if(dados.itens && dados.itens.length) nova.itens = dados.itens.map(it=>({descricao: it.descricao||'', quantidade: it.quantidade!=null?String(it.quantidade):'', valor_total: it.valor_total||'', valor_unit: it.valor_unit||''}));
      _vendas.push(nova);
      _painelDirty = true;
      if(typeof renderVendas === 'function') renderVendas();
      if(typeof sincronizarVendasLegado === 'function') sincronizarVendasLegado();
      const ehRemessaNova = ehCfopRemessaEstoque(dados.cfop);
      return fim(ehRemessaNova
        ? `NF ${dados.nf_numero} (CFOP ${dados.cfop}, remessa p/ estoque) registrada na aba Vendas — não conta como venda. A NF ${elNumChk.value} continua no processo.`
        : `NF ${dados.nf_numero} (venda${dados.cfop ? ', CFOP ' + dados.cfop : ''}) registrada na aba Vendas. A NF ${elNumChk.value} (remessa p/ estoque, CFOP ${cfopAtual}) continua registrada e não conta como venda. Confira e salve.`,
        { ok: true, destino: 'vendas', camposLog: [`Vendas: NF ${dados.nf_numero||''} (${ehRemessaNova ? 'remessa' : 'venda'}${dados.cfop ? ', CFOP ' + dados.cfop : ''})`] });
    }

    const jaPreenchido = !mesmaNF && ((elNumChk && elNumChk.value) || (elDataChk && elDataChk.value) || (elValorChk && elValorChk.value && elValorChk.value !== '0,00'));
    if(jaPreenchido){
      const ok = window.confirm('Ja existe NF Saida preenchida nesse processo (No ' + (elNumChk ? elNumChk.value : '') + '). Sobrescrever com os dados extraidos da NF anexada?');
      if(!ok) return fim('Importacao cancelada (dados existentes mantidos).');
    }

    aplicarDadosNFSaidaNoProcesso(dados);

    const avisos = [];
    const elCliente = document.getElementById('f_cliente');
    if(dados.cliente && elCliente && elCliente.value){
      const norm = s => (s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
      const a = norm(dados.cliente), b = norm(elCliente.value);
      if(a && b && !a.includes(b) && !b.includes(a)) avisos.push('cliente da NF ("' + dados.cliente + '") diverge do cadastrado ("' + elCliente.value + '")');
    }
    if(Array.isArray(dados.itens) && dados.itens.length && typeof _produtos !== 'undefined' && Array.isArray(_produtos)){
      const qtdNF = dados.itens.reduce((s,it)=>s+(parseFloat(it.quantidade)||0),0);
      const qtdProcesso = _produtos.reduce((s,it)=>s+(parseFloat(it.quantidade)||0),0);
      if(qtdNF>0 && qtdProcesso>0 && qtdNF !== qtdProcesso) avisos.push('quantidade da NF (' + qtdNF + ') diverge do processo (' + qtdProcesso + ')');
    }

    if(avisoDataSai) avisos.push(avisoDataSai);
    let msg = 'NF importada' + (dados.nf_numero ? (' - No ' + dados.nf_numero) : '') + (dados.cfop ? ' (CFOP ' + dados.cfop + ')' : '');
    if(avisoFiltro) msg += ' | ' + avisoFiltro;
    if(avisos.length) msg += ' | ATENCAO: ' + avisos.join('; ');
    return fim(msg, { ok: true, destino: 'documentos',
      camposLog: ['nf_saida_numero','nf_saida_data','nf_saida_valor','nf_saida_cfop'].filter((c, i) => [dados.nf_numero, dados.nf_data, dados.nf_valor, dados.cfop][i]).map(rotulo) });
  }catch(e){
    return fim('Erro ao importar NF: ' + e.message);
  }
}

function aplicarDadosNFEntradaNoProcesso(dados){
  const elNum = document.getElementById('f_nf_entrada_numero');
  const elData = document.getElementById('f_nf_entrada_data');
  const elValor = document.getElementById('f_nf_entrada_valor');
  if(elNum && dados.nf_numero) elNum.value = dados.nf_numero;
  if(elData && dados.nf_data) elData.value = dados.nf_data;
  if(elValor && dados.nf_valor) elValor.value = exibirMoeda(dados.nf_valor);
  if(typeof atualizarFaseEmTempoReal === 'function') atualizarFaseEmTempoReal();
}

function aplicarDadosNFSaidaNoProcesso(dados){
  const elNum = document.getElementById('f_nf_saida_numero');
  const elData = document.getElementById('f_nf_saida_data');
  const elValor = document.getElementById('f_nf_saida_valor');
  const elCfop = document.getElementById('f_nf_saida_cfop');
  const trocouNF = !!(elNum && dados.nf_numero && _normNumNF(elNum.value) && _normNumNF(elNum.value) !== _normNumNF(dados.nf_numero));
  if(elNum && dados.nf_numero) elNum.value = dados.nf_numero;
  if(elData && dados.nf_data) elData.value = dados.nf_data;
  if(elValor && dados.nf_valor) elValor.value = exibirMoeda(dados.nf_valor);
  // O CFOP é da nota: trocou a NF e a nova não trouxe CFOP → limpa (senão o
  // 5905 da remessa antiga ficava na venda nova e ela sumia do faturamento —
  // 20/10/2026).
  if(elCfop){ if(dados.cfop) elCfop.value = dados.cfop; else if(trocouNF) elCfop.value = ''; }
  if(typeof atualizarFaseEmTempoReal === 'function') atualizarFaseEmTempoReal();
}
