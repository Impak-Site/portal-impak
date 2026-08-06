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

  const isXml = /\.xml$/i.test(file.name) || file.type.includes('xml');
  showToast(isXml ? 'Lendo XML da NFe...' : 'Analisando documento com IA...', 'info');

  try{
    const dados = isXml ? await parseNFeXml(file) : await extrairNFComIA(file);
    if(!dados){ showToast('Não foi possível extrair dados desse arquivo.', 'err'); return; }
    aplicarDadosNFNaVenda(vi, dados);
    showToast(`✓ NF importada: ${dados.itens.length} ite${dados.itens.length===1?'m':'ns'} preenchido${dados.itens.length===1?'':'s'}`, 'ok');
  }catch(e){
    showToast('Erro ao importar NF: '+e.message, 'err');
  }
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
    return { descricao: xProd.trim(), quantidade: qCom ? String(parseFloat(qCom)) : '', cfop: cfopItem.trim() };
  }).filter(Boolean);
  const cfop = (itens.find(it=>it.cfop)||{}).cfop || '';
  // tpNF: 0 = entrada, 1 = saída (padrao NFe) — mais confiavel que tentar inferir por outros campos
  const tpNF = txt('tpNF');
  const tipo = tpNF === '0' ? 'ENTRADA' : 'SAIDA';

  if(!cliente && !nfNumero && !itens.length) throw new Error('Não achei os campos esperados de uma NFe nesse XML');

  return { tipo, cliente, nf_numero: nfNumero, nf_data: nfData, nf_valor: nfValor||0, cfop, itens };
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
  "nf_valor": 0,        // valor total da nota em R$
  "cfop": "",            // codigo CFOP (ex: 5405, 5117, 5905, 1101, 3101) do item principal da nota
  "itens": [{"descricao":"", "quantidade":0}]  // um item por linha de produto da nota
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
      const clean = raw.replace(/```json/gi,'').replace(/```/gi,'').trim();
      const extracted = JSON.parse(clean);
      return {
        tipo: (extracted.tipo||'').toUpperCase().includes('ENTRADA') ? 'ENTRADA' : 'SAIDA',
        cliente: extracted.cliente||'',
        nf_numero: extracted.nf_numero||'',
        nf_data: extracted.nf_data||'',
        nf_valor: parseFloat(extracted.nf_valor)||0,
        cfop: extracted.cfop||'',
        itens: Array.isArray(extracted.itens) ? extracted.itens.filter(it=>it&&(it.descricao||it.quantidade)).map(it=>({descricao:it.descricao||'', quantidade:it.quantidade!=null?String(it.quantidade):''})) : [],
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

  const status = document.getElementById('ia-nf-saida-status');
  const isXml = /\.xml$/i.test(file.name) || file.type.includes('xml');
  if(status) status.textContent = isXml ? 'Lendo XML da NFe...' : 'Analisando documento com IA...';

  try{
    const dados = isXml ? await parseNFeXml(file) : await extrairNFComIA(file);
    if(!dados){ if(status) status.textContent = 'Nao foi possivel extrair dados desse arquivo.'; return; }

    if(dados.tipo === 'ENTRADA'){
      if(status) status.textContent = 'Este documento parece ser uma NF de ENTRADA (No ' + (dados.nf_numero||'?') + '), nao de Saida. Nada foi preenchido aqui — use o campo NF Entrada (aba Faturamento) ou confira o arquivo anexado.';
      return;
    }

    const elNumChk = document.getElementById('f_nf_saida_numero');
    const elDataChk = document.getElementById('f_nf_saida_data');
    const elValorChk = document.getElementById('f_nf_saida_valor');
    const jaPreenchido = (elNumChk && elNumChk.value) || (elDataChk && elDataChk.value) || (elValorChk && elValorChk.value && elValorChk.value !== '0,00');
    if(jaPreenchido){
      const ok = window.confirm('Ja existe NF Saida preenchida nesse processo (No ' + (elNumChk ? elNumChk.value : '') + '). Sobrescrever com os dados extraidos da NF anexada?');
      if(!ok){ if(status) status.textContent = 'Importacao cancelada (dados existentes mantidos).'; return; }
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

    let msg = 'NF importada' + (dados.nf_numero ? (' - No ' + dados.nf_numero) : '');
    if(avisos.length) msg += ' | ATENCAO: ' + avisos.join('; ');
    if(status) status.textContent = msg;
  }catch(e){
    if(status) status.textContent = 'Erro ao importar NF: ' + e.message;
  }
}

function aplicarDadosNFSaidaNoProcesso(dados){
  const elNum = document.getElementById('f_nf_saida_numero');
  const elData = document.getElementById('f_nf_saida_data');
  const elValor = document.getElementById('f_nf_saida_valor');
  const elCfop = document.getElementById('f_nf_saida_cfop');
  if(elNum && dados.nf_numero) elNum.value = dados.nf_numero;
  if(elData && dados.nf_data) elData.value = dados.nf_data;
  if(elValor && dados.nf_valor) elValor.value = exibirMoeda(dados.nf_valor);
  if(elCfop && dados.cfop) elCfop.value = dados.cfop;
  if(typeof atualizarFaseEmTempoReal === 'function') atualizarFaseEmTempoReal();
}
