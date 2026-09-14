// controle-conferencia.js
//
// Aba "Conferência" dentro do painel do processo (Controle de Embarques).
//
// Pedido Ayslan (14/09/2026): unificar a tela de Conferência — hoje
// separada em processos.html, com login e armazenamento próprios — pra
// dentro do Controle, começando por esta aba. O fluxo é o mesmo que já
// existia lá (subir CI/PL/BL/CE etc., a IA compara os documentos entre si
// e aponta divergência/ausência/alerta por campo), só que agora:
//   - reaproveita o job assíncrono /api/analisar + /api/analisar/job/:id
//     que já é genérico (auth('conferencia','controle') já contemplava os
//     dois módulos antes mesmo desta mudança);
//   - o RESULTADO fica salvo no próprio processo do Controle
//     (controle_processos.conferencia_json — ver migration 0031), não
//     numa tabela separada. Isso mata o "universo paralelo" que existia
//     entre Conferência e Controle: antes só alguns campos extraídos
//     eram empurrados de um pro outro (sincronizarComControle, em
//     processos.html); agora é o mesmo processo, ponto.
//
// O PROMPT abaixo é copiado literalmente do runAnalysis() de
// processos.html — é fruto de dezenas de ajustes de regra de negócio
// (ver tasks #272, #273, #278, #287, #288, #328 etc no histórico) e NÃO
// deve ser reescrito/paLuguido por paráfrase, só estendido com cuidado.
//
// Fase 1 desta unificação (ver conversa 14/09/2026): só a aba dentro do
// processo. A tela de fila (/conferencia, listando pendências sem precisar
// abrir processo por processo) fica pra uma fase seguinte.

const CONF_DOC_LBL = {invoice:'COMMERCIAL INVOICE (CI)',packing:'PACKING LIST (PL)',bl:'BILL OF LADING (BL)',bl_draft:'DRAFT BL',bl_original:'BL ORIGINAL',proforma:'PROFORMA INVOICE (PI)',ce:'CE MERCANTE',outros:'OUTRO DOCUMENTO'};
const CONF_DOC_PT  = {invoice:'Commercial Invoice (CI)',packing:'Packing List (PL)',bl:'Bill of Lading (BL)',bl_draft:'Draft BL',bl_original:'BL Original',proforma:'Proforma Invoice (PI)',ce:'CE Mercante',outros:'Outro Documento'};

let _confArquivos = {}; // { nomeArquivo: {file, type} }

function _confGuessType(name){
  const n = name.toLowerCase();
  if(n.includes('draft')) return 'bl_draft';
  if(n.includes('bl') || n.includes('bill')) return 'bl';
  if(n.includes('pack') || n.includes('pl')) return 'packing';
  if(n.includes('ce ') || n.includes('mercante') || n.includes('_ce') || n.startsWith('ce')) return 'ce';
  if(n.includes('pi') || n.includes('proforma')) return 'proforma';
  if(n.includes('ci') || n.includes('invoice')) return 'invoice';
  return 'outros';
}

function _confLerAnalise(p){
  if(!p || !p.conferencia_json) return null;
  try{ return JSON.parse(p.conferencia_json); }catch(e){ return null; }
}

// ── Render da aba (chamado de renderModal, junto das outras abas) ──
function renderConferencia(p){
  const wrap = document.getElementById('pane-conferencia-conteudo');
  if(!wrap) return;
  if(!p.id){
    wrap.innerHTML = '<div class="empty"><div class="empty-icon">🔍</div><div class="empty-text">Salve o processo para poder conferir os documentos aqui.</div></div>';
    return;
  }
  _confArquivos = {};
  const analise = _confLerAnalise(p);
  wrap.innerHTML = `
    <div class="form-section">
      <div class="form-section-title">📤 Documentos para conferência</div>
      <div style="font-size:11px;color:var(--dim);margin-bottom:10px;">Suba CI, PL, BL (ou Draft), CE Mercante etc. — a IA compara todos entre si e aponta divergências, campos ausentes e alertas. Pode enviar de novo depois pra atualizar (ex: depois de receber o BL original).</div>
      <div id="conf-dropzone" style="border:2px dashed var(--border);border-radius:8px;padding:18px;text-align:center;cursor:pointer;margin-bottom:10px;" onclick="document.getElementById('conf-file-input').click()">
        <input type="file" id="conf-file-input" accept=".pdf,.jpg,.jpeg,.png" multiple style="display:none" onchange="_confAddFiles(this.files)">
        <div style="color:var(--muted);font-size:13px;">📎 Clique ou arraste os documentos aqui</div>
      </div>
      <div id="conf-chips" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;"></div>
      <button class="btn btn-primary" id="conf-btn-analisar" onclick="rodarConferencia()" disabled>🔍 Rodar Conferência</button>
      <div id="conf-loading" style="display:none;margin-top:10px;font-size:12px;color:var(--muted);">⏳ Analisando documentos... pode levar até 2 minutos. Não feche esta tela.</div>
    </div>
    <div id="conf-resultado">${analise ? _confRenderResultado(p, analise) : '<div style="font-size:12px;color:var(--dim);">Nenhuma conferência feita ainda neste processo.</div>'}</div>
  `;
  _confSetupDropzone();
}

function _confSetupDropzone(){
  const dz = document.getElementById('conf-dropzone');
  if(!dz) return;
  dz.addEventListener('dragover', e=>{ e.preventDefault(); dz.style.borderColor='var(--ac)'; });
  dz.addEventListener('dragleave', e=>{ dz.style.borderColor='var(--border)'; });
  dz.addEventListener('drop', e=>{
    e.preventDefault(); dz.style.borderColor='var(--border)';
    if(e.dataTransfer && e.dataTransfer.files) _confAddFiles(e.dataTransfer.files);
  });
}

function _confAddFiles(list){
  for(const f of list) _confArquivos[f.name] = { file:f, type:_confGuessType(f.name) };
  _confRenderChips();
}

function _confRenderChips(){
  const box = document.getElementById('conf-chips');
  if(!box) return;
  const nomes = Object.keys(_confArquivos);
  box.innerHTML = nomes.map(nome=>{
    const item = _confArquivos[nome];
    return `<div style="display:flex;align-items:center;gap:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:12px;">
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(nome)}</span>
      <select class="form-input" style="width:auto;padding:2px 6px;font-size:11px;" onchange="_confArquivos['${esc(nome).replace(/'/g,"\\'")}'].type=this.value">
        ${Object.entries(CONF_DOC_PT).map(([k,label])=>`<option value="${k}" ${item.type===k?'selected':''}>${esc(label)}</option>`).join('')}
      </select>
      <button class="btn btn-sm" style="color:var(--err);border-color:var(--err);background:none;" onclick="delete _confArquivos['${esc(nome).replace(/'/g,"\\'")}']; _confRenderChips();">×</button>
    </div>`;
  }).join('');
  const btn = document.getElementById('conf-btn-analisar');
  if(btn) btn.disabled = nomes.length < 2; // precisa de pelo menos 2 docs pra ter o que cruzar
}

async function _confToB64(file){
  return new Promise((resolve,reject)=>{
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function rodarConferencia(){
  const p = _editando;
  if(!p || !p.id) return;
  const btn = document.getElementById('conf-btn-analisar');
  const loading = document.getElementById('conf-loading');
  if(btn) btn.disabled = true;
  if(loading) loading.style.display = '';

  try{
    const content = [];
    for(const [name,{file,type}] of Object.entries(_confArquivos)){
      const b64 = await _confToB64(file);
      const isPdf = file.type === 'application/pdf';
      content.push(isPdf
        ? {type:'document', source:{type:'base64', media_type:'application/pdf', data:b64}}
        : {type:'image', source:{type:'base64', media_type:file.type, data:b64}});
      content.push({type:'text', text:`[DOCUMENTO ACIMA: ${CONF_DOC_LBL[type]} — arquivo: ${name}]`});
    }

    const docList = [...new Set(Object.values(_confArquivos).map(f=>CONF_DOC_LBL[f.type]))].join(', ');

    // ── PROMPT — copiado literalmente de runAnalysis() em processos.html (ver comentário no topo do arquivo) ──
    const prompt = 'JSON ONLY. No markdown. Especialista em conferencia documental importacao pneus Brasil. '
      + 'Docs: '+docList+'. '
      + 'IDENTIFICACAO AUTOMATICA: Ao analisar cada documento identifique seu tipo real (PI/CI/PL/BL/CE/DI/MAPA/LPCO/NF) pelo conteudo, nao pelo nome do arquivo. Inclua no resumo o campo "docs_identificados": ["CI","PL","BL"] com os tipos detectados. '
      + 'Schema: {"resumo":{"campos_ok":0,"divergencias":0,"alertas":0,"docs_identificados":[]},"grupos":[{"titulo":"","campos":[{"campo":"","doc1_label":"","doc1_valor":"","doc2_label":"","doc2_valor":"","status":"OK","observacao":null,"confianca":100,"severidade":"INFORMATIVA","motivo_sugerido":"","email_fornecedor":""}]}],"alertas":[""]}. '
      + 'CAMPO severidade: Para cada DIVERGENCIA classifique: '
      + '"BLOQUEANTE" = impede registro da DI ou liberacao aduaneira (ex: valor diferente entre CI e PI, INCOTERM ausente, NCM incorreto, exportador diferente, dados bancarios divergentes, peso com diferenca >2%, quantidade diferente). '
      + '"INFORMATIVA" = nao impede liberacao mas deve ser documentada (ex: endereco abreviado, data com formato diferente, referencia de container ausente em um doc, diferenca de peso <2%). '
      + 'CAMPO motivo_sugerido: Sugira um motivo curto para aceitar esta divergencia (ex: "Diferenca de arredondamento dentro da tolerancia comercial", "Abreviacao do endereco - dado correto", "Padrao do fornecedor ROVELO"). '
      + 'CAMPO email_fornecedor: Para divergencias BLOQUEANTES, escreva em ingles o texto para solicitar correcao ao fornecedor (ex: "Please send an amended CI with the correct gross weight: PL states 18,720 kg while CI states 18,500 kg."). Para INFORMATIVAS deixe vazio. '
      + 'CAMPO confianca (0-100): 100=certeza absoluta, 80-99=alta, 50-79=media (verificar), 0-49=baixa (rever manualmente). Campos com confianca<70 devem ter status ALERTA. '
      + 'REGRA GERAL: Mostrar APENAS erros. Usar nome real do doc (CI,PL,BL,PI,CE). Nunca "Documento 1". '
      + 'PASSO 1 - CAMPOS OBRIGATORIOS: '
      + 'CI/PI: exportador(nome+end), importador(nome+end), encomendante(se houver), forma+moeda pagamento, porto origem, porto destino, descricao itens, marca+ref volumes, qtd+especie volumes, valores unit+total, peso bruto+liquido, INCOTERM(obrigatorio na CI - se ausente=DIVERGENCIA, valores aceitos: FOB/CIF/CFR/EXW/DDP/DAP/FCA), pais origem+aquisicao+procedencia, dados bancarios(nome banco+conta+swift/routing). SE incoterm!=FOB: frete internacional obrigatorio. '
      + 'REGRA FORMA DE PAGAMENTO E DADOS BANCARIOS: Ambos obrigatorios na CI. Se a CI NAO mencionar forma de pagamento (ex: T/T, L/C, adiantamento) gerar ALERTA com campo="Forma de Pagamento" doc1_label=CI valor="Nao mencionado na CI". Se a CI NAO mencionar dados bancarios (banco/conta/swift) gerar ALERTA separado com campo="Dados Bancarios" doc1_label=CI valor="Nao mencionado na CI". Isso vale mesmo se nenhum outro documento tiver essa informacao (nao e so cruzamento, e exigencia da propria CI). IMPORTANTE: antes de concluir que a forma de pagamento esta ausente, releia TODO o texto da CI (inclusive rodape, observacoes e texto proximo a assinatura), procurando rotulos alternativos como TERM OF PAYMENT, PAYMENT TERM(S), PAYMENT CONDITION, CONDITION OF PAYMENT, alem de T/T, L/C, adiantamento. '
      + 'REGRA CI INCONSISTENCIA INTERNA: Se a CI mencionar portos diferentes em campos distintos (ex: "FOB QINGDAO" no item de produto mas "FOB NAVEGANTES" no total), isso e DIVERGENCIA BLOQUEANTE de inconsistencia interna na propria CI — gerar alerta com campo="Porto FOB" doc1_label=CI doc2_label=CI. '
      + 'REGRA CI x PI (QUANDO AMBAS PRESENTES): A CI e o documento DEFINITIVO e sobressai a PI em todos os campos. A PI e o documento DRAFT/PROFORMA. Comparar CI x PI APENAS nos seguintes campos: (1) descricao da mercadoria, (2) valor unitario e total, (3) quantidade. Qualquer diferenca nesses 3 campos entre CI e PI = DIVERGENCIA BLOQUEANTE com doc1_label=CI doc2_label=PI. Diferencas em outros campos (endereco, data, referencia) entre CI e PI = NAO gerar divergencia, pois CI e definitiva. Para cruzamento com BL, CE e PL, usar SEMPRE os valores da CI, nunca os da PI. '
      + 'PL: importador, encomendante(se buyer preenchido na PI/CI), porto origem+destino, descricao itens, qtd+especie, pesos unit+totais, peso bruto+liquido, produto(deve conter TIRE/TYRE/PNEU/RADIAL senao DIVERGENCIA), pais origem+aquisicao, marca+numeracao volumes. Container/BL/lacre=OPCIONAL. '
      + 'REGRA FABRICANTE NA PL: O Packing List DEVE conter o nome completo E o endereco completo do fabricante/manufacturer dos pneus. IMPORTANTE: o fabricante pode ser diferente do exportador/shipper. Se a marca dos pneus (ex: TIANFU, ROVELO, EUDEMON) for diferente do nome do exportador/shipper no cabecalho da PL, verificar se ha um campo separado identificando o fabricante real com nome e endereco. Se o fabricante real dos pneus nao estiver identificado com nome e endereco na PL = DIVERGENCIA BLOQUEANTE (apenas o exportador no cabecalho nao e suficiente). Se o endereco do fabricante estiver ausente ou incompleto (apenas cidade ou pais sem rua/numero) = DIVERGENCIA INFORMATIVA. Endereco completo exige pelo menos: rua/avenida + cidade + pais. '
      + 'BL: shipper, notify, consignee, porto origem+destino, peso, qtd, NCM(verificar se tem 8 digitos — se NCM tiver menos de 8 digitos = DIVERGENCIA INFORMATIVA "NCM incompleto no BL"), descricao, free time, valor frete, prepaid/collect, container+lacre(se constar PI/CI/PL - ao comparar lacre IGNORAR espacos, quebras de linha e hifens - tratar EMCCWW0805 e EMCCWW-0805 como identicos), wooden(WOODEN/WOOD/PALLET/NOT APPLICABLE obrigatorio senao DIVERGENCIA). '
      + 'REGRA PORTO DE DESTINO: Comparar nome do porto de destino/descarga da CI e PL com o Porto de Descarga (Port of Discharge) e Place of Delivery do BL. Se os NOMES forem diferentes (ex: NAVEGANTES na CI/PL vs ITAPOA no BL) = DIVERGENCIA BLOQUEANTE com campo="Porto de Destino" doc1_label=BL doc2_label=CI/PL, MESMO que os portos sejam fisicamente proximos ou pertencam a mesma regiao portuaria — NUNCA classificar automaticamente como equivalente/normal, isso deve ser sempre sinalizado para confirmacao humana pois afeta o registro da DI. '
      + 'CE: cruzar navio/embarque pelo campo Transbordo/Baldeacao(se vazio usar manifesto). Numero CE nao cruzar. IMPORTANTE: campo "Condicao de pagamento" ou "Situacao pagamento" do CE Mercante com valor "Suspenso" ou "Suspensao" ou "Sem cobertura cambial" eh NORMAL para importacoes brasileiras - NAO gerar alerta ou divergencia para esse campo. '
      + 'REGRA FRETE E TAXAS NO CE MERCANTE: Comparar o valor do frete internacional (Ocean Freight/Freight) e as taxas/despesas (Local Charges, THC, etc) informados no BL ou HBL Draft com os valores registrados no CE Mercante (campos de Frete e Taxas/Despesas). Se os valores do frete ou das taxas forem diferentes entre o BL/HBL e o CE Mercante = DIVERGENCIA BLOQUEANTE com campo="Frete/Taxas — BL x CE Mercante" doc1_label=BL doc2_label=CE Mercante, indicando os dois valores encontrados. Se o CE Mercante nao informar frete ou taxas = ALERTA com campo="Frete/Taxas ausentes no CE Mercante". '
      + 'PASSO 2 - CRUZAMENTO: Comparar todos campos entre todos docs. Campo presente num doc e ausente em outro=DIVERGENCIA. Dados bancarios identicos em todos. Para cruzamentos envolvendo CI e PI simultaneamente, usar CI como referencia. '
      + 'REGRA COMPRADOR FINAL (BUYER)/ENCOMENDANTE: Buyer diferente do importador e normal (triangulacao comercial). IMPORTANTE: antes de concluir que a CI nao identifica o comprador final, releia TODO o texto da CI (inclusive rodape, observacoes, area proxima a assinatura/carimbo e blocos separados do cabecalho principal), procurando rotulos alternativos como BUYER, BUYER NAME AND ADDRESS, FINAL BUYER, ENCOMENDANTE, SOLD TO — o campo pode estar formatado como bloco proprio, nao necessariamente ao lado de exportador/importador. So gerar DIVERGENCIA BLOQUEANTE com campo="Buyer/Encomendante ausente na CI" doc1_label=CI valor="Nao identifica o comprador final" doc2_label=PL(ou PI) valor=<nome do buyer encontrado> se, apos essa releitura completa do texto, o nome+endereco do buyer realmente nao aparecer em nenhum lugar da CI. '
      + 'Grupos: Identificacao|Importador|Comprador Final(buyer!=importador=normal)|Exportador|Mercadoria|Valores|Pesos|Logistica|CE Mercante|Pais Origem. '
      + 'PASSO 3 - EUDEMON: Se marca EUDEMON verificar codigo em CI/PI/PL: 3301000094ab=275/80R22.5 UD188 149/146L 18PR|3302001532eu=275/80R22.5 UF195 149/146L 18PR|3302002217=295/80R22.5 UD188 154/149L 18PR|3302002218=295/80R22.5 UF195 154/149M 18PR|3302002429=295/80R22.5 UD223 154/149K 18PR|3302001815ab=235/75R17.5 UD188 143/141L 18PR|3302001861ab=215/75R17.5 UD188 135/133L 16PR|3302001609ab=215/75R17.5 UF195 135/133L 16PR|3302001608ab=235/75R17.5 UF195 143/141L 18PR. '
      + 'REGRA PESO: Para pneus sem embalagem o peso liquido=bruto e aceitavel ter apenas um campo de peso. EXCECAO: fabricante NAKANKG exige peso bruto E liquido separados — se NAKANKG e peso liquido ausente = DIVERGENCIA. Se fabricante NAO for NAKANKG e peso tiver apenas um valor (G.W/N.W ou similar) = OK, nao alertar. '
      + 'REGRAS ESPECIAIS: FOB+Collect=OK, FOB+Prepaid=ALERTA. CIF/CFR+Prepaid=OK, CIF/CFR+Collect=ALERTA. Consignatario BL/CE=importador(normal). CNPJ importador!=CNPJ buyer=normal. Transbordo=navio pode diferir. Numeros: 17.548,00=17548. Datas: 2026-03-23=23/03/2026. Data CE comparar APENAS com on board date BL. '
      + 'REGRAS POR FORNECEDOR: ROVELO/SAILUN: peso liquido=bruto aceitavel. TRACMAX/WINDFORCE: modelo pode vir como codigo alfanumerico, nao alertar. DELMAX: volumes podem usar caixas em vez de pallets, aceitavel. '
      + 'REGRA CAMPO alertas (MUITO IMPORTANTE): o array "alertas" do schema e SOMENTE para observacoes gerais sem um campo/documento especifico a comparar (ex: recomendacao de revisar manualmente, lembrete de procedimento). QUALQUER divergencia, ausencia ou alerta que se refira a um campo especifico (ex: Porto de Destino, Forma de Pagamento, Dados Bancarios, Fabricante na PL, Frete/Taxas) DEVE OBRIGATORIAMENTE ser um item dentro de grupos[].campos[] (com campo, doc1_label, doc2_label, status=DIVERGENCIA/AUSENTE/ALERTA e severidade=BLOQUEANTE/INFORMATIVA), NUNCA como uma string solta em "alertas". Isso vale mesmo quando o texto da regra abaixo usa a palavra "alerta" — sempre gerar como item estruturado em grupos, nunca como texto solto. ';

    content.push({type:'text', text:prompt});

    const bodyStr = JSON.stringify({ content });
    const sizeMB = (bodyStr.length / 1024 / 1024).toFixed(1);
    if(parseFloat(sizeMB) > 80) throw new Error(`Documentos muito grandes (${sizeMB} MB). Use no máximo 4-5 PDFs por análise.`);

    const startResp = await fetch('/api/analisar', { method:'POST', headers:{'Content-Type':'application/json'}, body: bodyStr });
    if(!startResp.ok){
      let errMsg = 'Erro ' + startResp.status;
      try{ const e = await startResp.json(); errMsg = e.erro || errMsg; }catch(e){}
      throw new Error(errMsg);
    }
    const start = await startResp.json();
    if(!start.ok || !start.jobId) throw new Error(start.erro || 'Erro ao iniciar análise');

    const t0 = Date.now();
    let job;
    while(true){
      await new Promise(r=>setTimeout(r, 2500));
      const elapsed = Math.round((Date.now()-t0)/1000);
      if(loading) loading.textContent = `⏳ Analisando... até 2 minutos com vários documentos. Não feche esta tela. (${elapsed}s)`;
      if(elapsed > 200) throw new Error('Análise demorou demais. Tente novamente com menos documentos.');
      const pollResp = await fetch('/api/analisar/job/'+start.jobId);
      if(!pollResp.ok) continue;
      const poll = await pollResp.json();
      if(!poll.ok) continue;
      if(poll.status === 'processando') continue;
      job = poll;
      break;
    }
    if(job.status === 'erro') throw new Error(job.erro || 'Erro desconhecido na análise');

    const raw = (job.resultado.content||[]).map(i=>i.text||'').join('');
    let result;
    try{
      let clean = raw.replace(/```json/gi,'').replace(/```/gi,'').trim();
      const fb = clean.indexOf('{'); if(fb>0) clean = clean.substring(fb);
      const lb = clean.lastIndexOf('}'); if(lb>=0) clean = clean.substring(0, lb+1);
      result = JSON.parse(clean);
    }catch(e1){
      const m = raw.match(/\{[\s\S]*\}/);
      if(!m) throw new Error('A IA não retornou JSON.');
      result = JSON.parse(m[0]);
    }
    if(!result.grupos) throw new Error('Resposta incompleta. Tente novamente.');

    const analiseAnterior = _confLerAnalise(p);
    const novaAnalise = {
      data: new Date().toLocaleString('pt-BR'),
      docs: Object.values(_confArquivos).map(f=>CONF_DOC_PT[f.type]||f.file.name).join(', '),
      analisadoPor: (_user && (_user.displayName||_user.usuario)) || '',
      resumo: result.resumo,
      grupos: result.grupos,
      alertas: result.alertas||[],
      divResolvedMap: (analiseAnterior && analiseAnterior.divResolvedMap) || {}, // preserva aceites de análises anteriores
    };

    p.conferencia_json = JSON.stringify(novaAnalise);
    const r = await fetch('/api/controle/v2/processo', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ processo: { id:p.id, conferencia_json: p.conferencia_json } })
    });
    const d = await r.json();
    if(!d.ok) throw new Error(d.erro || 'Erro ao salvar a conferência');

    showToast('✓ Conferência concluída', 'ok');
    document.getElementById('conf-resultado').innerHTML = _confRenderResultado(p, novaAnalise);
    _confArquivos = {};
    _confRenderChips();
    atualizarBadgeConferencia(p);
  }catch(err){
    showToast('Erro: '+err.message, 'err');
    console.error(err);
  }
  if(btn) btn.disabled = Object.keys(_confArquivos).length < 2;
  if(loading) loading.style.display = 'none';
}

// ── Render do resultado (resumo + lista de divergências/alertas/ausências) ──
function _confRenderResultado(p, analise){
  const resumo = analise.resumo || {};
  const divs = [];
  (analise.grupos||[]).forEach((grupo, gi)=>{
    (grupo.campos||[]).forEach((c, ci)=>{
      if(c.status==='DIVERGENCIA' || c.status==='AUSENTE' || (c.status==='ALERTA' && c.campo)){
        divs.push({ ...c, grupo: grupo.titulo, key: gi+'-'+ci });
      }
    });
  });
  const resolvedMap = analise.divResolvedMap || {};
  const pendentes = divs.filter(d=>!resolvedMap[d.key]);
  const resolvidas = divs.filter(d=>resolvedMap[d.key]);

  const corSeveridade = d => d.severidade==='BLOQUEANTE' ? 'var(--err)' : (d.status==='ALERTA' ? 'var(--warn)' : 'var(--warn)');

  const linhaDiv = d => `
    <div style="border:1px solid ${resolvedMap[d.key]?'var(--border)':corSeveridade(d)};border-radius:8px;padding:10px 12px;margin-bottom:8px;${resolvedMap[d.key]?'opacity:.55;':''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
        <div style="flex:1;">
          <div style="font-size:11px;color:var(--muted);margin-bottom:2px;">${esc(d.grupo)} ${d.severidade==='BLOQUEANTE'?'<span style="color:var(--err);font-weight:700;">● BLOQUEANTE</span>':''}</div>
          <div style="font-weight:600;font-size:13px;">${esc(d.campo||'')}</div>
          ${d.doc1_label||d.doc1_valor?`<div style="font-size:12px;color:var(--text);margin-top:4px;">${esc(d.doc1_label||'')}: ${esc(d.doc1_valor||'—')}</div>`:''}
          ${d.doc2_label||d.doc2_valor?`<div style="font-size:12px;color:var(--text);">${esc(d.doc2_label||'')}: ${esc(d.doc2_valor||'—')}</div>`:''}
          ${d.observacao?`<div style="font-size:11px;color:var(--muted);margin-top:4px;">${esc(d.observacao)}</div>`:''}
          ${resolvedMap[d.key]?`<div style="font-size:11px;color:var(--ok);margin-top:6px;">✓ Aceito por ${esc(resolvedMap[d.key].por||'')} em ${esc(resolvedMap[d.key].time||'')} — ${esc(resolvedMap[d.key].motivo||'')}</div>`:''}
        </div>
        <div style="flex-shrink:0;">
          ${resolvedMap[d.key]
            ? `<button class="btn btn-sm btn-outline" onclick="desfazerAceiteConferencia('${d.key}')">Desfazer</button>`
            : `<button class="btn btn-sm btn-primary" onclick="aceitarDivergenciaConferencia('${d.key}', ${JSON.stringify(d.motivo_sugerido||'').replace(/"/g,'&quot;')})">Aceitar</button>`
          }
        </div>
      </div>
    </div>`;

  return `
    <div class="form-section">
      <div style="display:flex;gap:14px;margin-bottom:14px;flex-wrap:wrap;">
        <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 16px;">
          <div style="font-size:20px;font-weight:700;">${resumo.campos_ok||0}</div>
          <div style="font-size:11px;color:var(--muted);">OK</div>
        </div>
        <div style="background:rgba(220,38,38,.06);border:1px solid var(--err);border-radius:8px;padding:10px 16px;">
          <div style="font-size:20px;font-weight:700;color:var(--err);">${pendentes.length}</div>
          <div style="font-size:11px;color:var(--muted);">pendentes</div>
        </div>
        <div style="background:rgba(22,163,74,.06);border:1px solid var(--ok);border-radius:8px;padding:10px 16px;">
          <div style="font-size:20px;font-weight:700;color:var(--ok);">${resolvidas.length}</div>
          <div style="font-size:11px;color:var(--muted);">aceitas</div>
        </div>
      </div>
      <div style="font-size:11px;color:var(--dim);margin-bottom:10px;">Última conferência: ${esc(analise.data||'')} ${analise.analisadoPor?'por '+esc(analise.analisadoPor):''} — docs: ${esc(analise.docs||'')}</div>
      ${!divs.length ? '<div style="padding:16px;text-align:center;color:var(--ok);font-size:13px;">✓ Nenhuma divergência encontrada.</div>' : ''}
      ${pendentes.map(linhaDiv).join('')}
      ${resolvidas.length ? `<div style="font-size:11px;font-weight:700;color:var(--muted);margin:14px 0 6px;">ACEITAS</div>${resolvidas.map(linhaDiv).join('')}` : ''}
      ${(analise.alertas||[]).length ? `<div class="form-section-title" style="margin-top:16px;">⚠ Observações gerais</div><ul style="font-size:12px;color:var(--text);">${analise.alertas.map(a=>`<li>${esc(typeof a==='string'?a:(a.descricao||a.mensagem||''))}</li>`).join('')}</ul>` : ''}
    </div>`;
}

async function _confSalvarResolvedMap(p, analise){
  p.conferencia_json = JSON.stringify(analise);
  const r = await fetch('/api/controle/v2/processo', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ processo: { id:p.id, conferencia_json: p.conferencia_json } })
  });
  const d = await r.json();
  if(!d.ok) showToast('Erro ao salvar: '+(d.erro||'?'), 'err');
  return d.ok;
}

async function aceitarDivergenciaConferencia(key, motivoSugerido){
  const p = _editando;
  const analise = _confLerAnalise(p);
  if(!analise) return;
  const motivo = prompt('Motivo do aceite:', motivoSugerido||'') ;
  if(motivo === null) return; // cancelou
  analise.divResolvedMap = analise.divResolvedMap || {};
  analise.divResolvedMap[key] = { motivo: motivo||'Aceito sem motivo informado', por:(_user && (_user.displayName||_user.usuario)) || '', time:new Date().toLocaleString('pt-BR') };
  const ok = await _confSalvarResolvedMap(p, analise);
  if(ok){
    showToast('✓ Divergência aceita', 'ok');
    document.getElementById('conf-resultado').innerHTML = _confRenderResultado(p, analise);
    atualizarBadgeConferencia(p);
  }
}

async function desfazerAceiteConferencia(key){
  const p = _editando;
  const analise = _confLerAnalise(p);
  if(!analise || !analise.divResolvedMap) return;
  delete analise.divResolvedMap[key];
  const ok = await _confSalvarResolvedMap(p, analise);
  if(ok){
    showToast('Aceite desfeito', 'warn');
    document.getElementById('conf-resultado').innerHTML = _confRenderResultado(p, analise);
    atualizarBadgeConferencia(p);
  }
}

// Bolinha vermelha na aba (mesmo padrão do tab-alert de Identificação) quando
// há divergência BLOQUEANTE pendente — dá pra ver sem precisar clicar na aba.
function atualizarBadgeConferencia(p){
  const tab = document.getElementById('tab-conferencia');
  if(!tab) return;
  tab.querySelector('.tab-alert')?.remove();
  const analise = _confLerAnalise(p);
  if(!analise) return;
  const resolvedMap = analise.divResolvedMap || {};
  const temPendenteBloqueante = (analise.grupos||[]).some((g,gi)=>(g.campos||[]).some((c,ci)=>
    (c.status==='DIVERGENCIA'||c.status==='AUSENTE') && c.severidade==='BLOQUEANTE' && !resolvedMap[gi+'-'+ci]
  ));
  if(temPendenteBloqueante) tab.insertAdjacentHTML('beforeend', '<span class="tab-alert"></span>');
}
