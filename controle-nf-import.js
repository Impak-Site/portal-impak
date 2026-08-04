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
    return { descricao: xProd.trim(), quantidade: qCom ? String(parseFloat(qCom)) : '' };
  }).filter(Boolean);

  if(!cliente && !nfNumero && !itens.length) throw new Error('Não achei os campos esperados de uma NFe nesse XML');

  return { cliente, nf_numero: nfNumero, nf_data: nfData, nf_valor: nfValor||0, itens };
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

  const prompt = `Extraia os dados desta Nota Fiscal de Saída (DANFE) e retorne SOMENTE JSON:
{
  "cliente": "",       // razão social do DESTINATÁRIO da nota (quem comprou)
  "nf_numero": "",      // número da nota fiscal
  "nf_data": "YYYY-MM-DD", // data de emissão
  "nf_valor": 0,        // valor total da nota em R$
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
        cliente: extracted.cliente||'',
        nf_numero: extracted.nf_numero||'',
        nf_data: extracted.nf_data||'',
        nf_valor: parseFloat(extracted.nf_valor)||0,
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
