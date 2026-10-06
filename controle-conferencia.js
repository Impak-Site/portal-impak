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
// Cache dos arquivos da ULTIMA conferencia rodada neste processo (so em
// memoria, dura enquanto a aba do navegador ficar aberta nesta sessao) --
// pedido Emanuelly 16/09/2026: "a ideia era pra nao rodar a mesma
// documentacao mais vezes". Como e rarissimo uma conferencia ja sair com
// 0 pendencias na hora (quase sempre tem alguma divergencia esperada,
// tipo NCM de 4 digitos no BL ou porto divergente no Sales Contract, que
// ela aceita uma a uma), o preenchimento automatico nao pode depender so
// do momento em que rodarConferencia() termina -- precisa tambem disparar
// depois, quando a ULTIMA pendencia for aceita via confirmarMotivoConferencia(),
// sem pedir pra subir os documentos de novo.
let _confArquivosUltimaAnalise = [];

// Documentos da conferência anterior (06/10/2026, pedido Ayslan): cada
// conferência guarda os documentos usados nos Arquivos do processo
// (docsArquivos na análise). A próxima já começa com eles — quem recebe um
// documento novo envia só ele. Documento novo do mesmo tipo substitui o
// anterior (BL, Draft BL e BL Original contam como o mesmo tipo).
let _confAnteriores = [];   // [{arquivo_id, nome, type, mime, tamanho, excluidoManual, substituido}]
let _confDocsUsados = [];   // o que vai pra docsArquivos da análise nova
function _confGrupoTipo(t){ return (t==='bl'||t==='bl_draft'||t==='bl_original') ? 'bl' : t; }
function _confAtualizarSubstituicoes(){
  const gruposNovos = new Set(Object.values(_confArquivos).map(f=>_confGrupoTipo(f.type)).filter(g=>g!=='outros'));
  _confAnteriores.forEach(a => { a.substituido = gruposNovos.has(_confGrupoTipo(a.type)); });
}
function _confAnterioresEfetivos(){ return _confAnteriores.filter(a => !a.substituido && !a.excluidoManual); }

// ── Leitura só do documento novo (pedido Ayslan 06/10/2026) ──────────
// "Sempre que colocarmos documentos novos, para conferir com algo que já
// tinha no sistema, a leitura por IA deve ler somente o documento novo."
// Cada conferência guarda os dados que a IA extraiu de cada documento
// (dadosDocs, por arquivo_id). Na conferência seguinte, se todos os
// documentos anteriores já têm esses dados, a IA recebe SÓ os documentos
// novos + os dados dos anteriores em texto, e compara o novo contra eles.
// As divergências antigas entre documentos que não mudaram continuam (não
// são recalculadas). "Reler todos" força a conferência completa.
function _confGruposDoLabel(label){
  const s = String(label||'').toUpperCase();
  const g = new Set();
  if(/\bHBL\b|\bMBL\b|\bBL\b|DRAFT|BILL OF LADING/.test(s)) g.add('bl');
  if(/\bCE\b|MERCANTE/.test(s)) g.add('ce');
  if(/\bPL\b|PACKING/.test(s)) g.add('packing');
  if(/\bPI\b|PROFORMA/.test(s)) g.add('proforma');
  if(/\bCI\b|COMMERCIAL INVOICE|\bINVOICE\b/.test(s)) g.add('invoice');
  return g;
}
function _confModoIncremental(analise){
  const efetivos = _confAnterioresEfetivos();
  const dados = (analise && analise.dadosDocs) || {};
  const forcar = !!document.getElementById('conf-reler-tudo')?.checked;
  return !forcar && Object.keys(_confArquivos).length > 0 && efetivos.length > 0 && efetivos.every(a => dados[a.arquivo_id]);
}
// Divergências da conferência anterior que continuam valendo: as que não
// envolvem nenhum tipo de documento que saiu ou foi substituído agora.
function _confDivergenciasQueContinuam(analiseAnterior, gruposFora){
  const out = [];
  ((analiseAnterior && analiseAnterior.grupos) || []).forEach(g => {
    const campos = (g.campos||[]).filter(c => {
      if(!ConferenciaChave.ehPendenciaConferencia(c)) return false;
      const envolvidos = new Set([..._confGruposDoLabel(c.doc1_label), ..._confGruposDoLabel(c.doc2_label)]);
      for(const x of envolvidos) if(gruposFora.has(x)) return false;
      return true;
    });
    if(campos.length) out.push({ titulo: g.titulo, campos });
  });
  return out;
}

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
  _confAnteriores = ((analise && analise.docsArquivos) || []).filter(d => d && d.arquivo_id)
    .map(d => ({ ...d, excluidoManual:false, substituido:false }));
  wrap.innerHTML = `
    <div class="form-section">
      <div class="form-section-title">📤 Documentos para conferência</div>
      <div style="font-size:11px;color:var(--dim);margin-bottom:10px;">Suba CI, PL, BL (ou Draft), CE Mercante etc. — a IA compara todos entre si e aponta divergências, campos ausentes e alertas. Recebeu um documento novo depois? Envie só ele: os documentos da última conferência entram junto automaticamente (o novo substitui o anterior do mesmo tipo).</div>
      <div id="conf-dropzone" style="border:2px dashed var(--border);border-radius:8px;padding:18px;text-align:center;cursor:pointer;margin-bottom:10px;" onclick="document.getElementById('conf-file-input').click()">
        <input type="file" id="conf-file-input" accept=".pdf,.jpg,.jpeg,.png" multiple style="display:none" onchange="_confAddFiles(this.files)">
        <div style="color:var(--muted);font-size:13px;">📎 Clique ou arraste os documentos aqui</div>
      </div>
      <div id="conf-chips" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;"></div>
      <div id="conf-modo" style="font-size:11px;color:var(--muted);margin-bottom:8px;"></div>
      <button class="btn btn-primary" id="conf-btn-analisar" onclick="rodarConferencia()" disabled>🔍 Rodar Conferência</button>
      <div id="conf-loading" style="display:none;margin-top:10px;font-size:12px;color:var(--muted);">⏳ Analisando documentos... pode levar até 2 minutos. Não feche esta tela.</div>
    </div>
    <div id="conf-resultado">${analise ? _confRenderResultado(p, analise) : '<div style="font-size:12px;color:var(--dim);">Nenhuma conferência feita ainda neste processo.</div>'}</div>
  `;
  _confSetupDropzone();
  _confRenderChips();
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
  _confAtualizarSubstituicoes();
  _confRenderChips();
}

function _confRenderChips(){
  const box = document.getElementById('conf-chips');
  if(!box) return;
  const nomes = Object.keys(_confArquivos);
  const anteriores = _confAnteriores.map((a, i) => {
    const fora = a.substituido || a.excluidoManual;
    return `<div style="display:flex;align-items:center;gap:8px;background:${fora?'transparent':'#f0f7ff'};border:1px dashed var(--border);border-radius:6px;padding:6px 10px;font-size:12px;${fora?'opacity:.55;':''}">
      <span title="Documento da conferência anterior">📁</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${fora?'text-decoration:line-through;':''}">${esc(a.nome)}</span>
      <span style="font-size:11px;color:var(--muted);">${esc(CONF_DOC_PT[a.type]||a.type||'')}${a.substituido?' · substituído pelo novo':(a.excluidoManual?' · fora desta conferência':' · da conferência anterior')}</span>
      ${a.substituido ? '' : `<button class="btn btn-sm" style="background:none;" onclick="_confAnteriores[${i}].excluidoManual=!_confAnteriores[${i}].excluidoManual; _confRenderChips();">${a.excluidoManual?'Incluir':'×'}</button>`}
    </div>`;
  }).join('');
  box.innerHTML = anteriores + nomes.map(nome=>{
    const item = _confArquivos[nome];
    return `<div style="display:flex;align-items:center;gap:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:12px;">
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(nome)}</span>
      <select class="form-input" style="width:auto;padding:2px 6px;font-size:11px;" onchange="_confArquivos[${jsArg(nome)}].type=this.value; _confAtualizarSubstituicoes(); _confRenderChips();">
        ${Object.entries(CONF_DOC_PT).map(([k,label])=>`<option value="${k}" ${item.type===k?'selected':''}>${esc(label)}</option>`).join('')}
      </select>
      <button class="btn btn-sm" style="color:var(--err);border-color:var(--err);background:none;" onclick="delete _confArquivos[${jsArg(nome)}]; _confAtualizarSubstituicoes(); _confRenderChips();">×</button>
    </div>`;
  }).join('');
  const btn = document.getElementById('conf-btn-analisar');
  if(btn) btn.disabled = (nomes.length + _confAnterioresEfetivos().length) < 2; // precisa de pelo menos 2 docs pra ter o que cruzar
  const modo = document.getElementById('conf-modo');
  if(modo){
    const an = (typeof _editando !== 'undefined' && _editando) ? _confLerAnalise(_editando) : null;
    const efetivos = _confAnterioresEfetivos();
    const marcado = !!document.getElementById('conf-reler-tudo')?.checked;
    if(!efetivos.length || !nomes.length){ modo.innerHTML = ''; }
    else {
      const temDados = efetivos.every(a => an && an.dadosDocs && an.dadosDocs[a.arquivo_id]);
      modo.innerHTML = (temDados
        ? (marcado ? '🔁 A IA vai reler todos os documentos.' : '⚡ A IA vai ler só o(s) documento(s) novo(s) e comparar com os dados dos documentos já conferidos.')
        : 'ℹ️ Desta vez a IA relê todos os documentos (a conferência anterior foi feita antes desta melhoria). Das próximas vezes, só os novos.')
        + (temDados ? ` <label style="margin-left:8px;cursor:pointer;"><input type="checkbox" id="conf-reler-tudo" ${marcado?'checked':''} onchange="_confRenderChips()"> Reler todos (conferência completa)</label>` : '');
    }
  }
}

function _confB64ParaFile(b64, nome, mime){
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], nome, { type: mime || 'application/pdf' });
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
    // Itens desta rodada: documentos da conferência anterior que continuam
    // valendo (baixados dos Arquivos do processo) + os enviados agora (que
    // são guardados nos Arquivos pra próxima conferência).
    const analisePre = _confLerAnalise(p);
    const incremental = _confModoIncremental(analisePre);
    const anterioresMeta = _confAnterioresEfetivos().map(a => ({ arquivo_id:a.arquivo_id, nome:a.nome, type:a.type, mime:a.mime||'application/pdf', tamanho:a.tamanho||null }));
    const itens = [];
    for(const a of (incremental ? [] : _confAnterioresEfetivos())){
      const r = await fetch('/api/controle/v2/arquivo/' + encodeURIComponent(a.arquivo_id) + '/conteudo');
      const d = await r.json().catch(()=>({}));
      if(!r.ok || !d.ok) throw new Error('Não consegui abrir "' + a.nome + '" da conferência anterior' + (d.erro ? ': ' + d.erro : '') + '. Envie esse documento de novo.');
      itens.push({ nome:a.nome, type:a.type, mime:d.tipo || a.mime, b64:d.base64, meta:{ arquivo_id:a.arquivo_id, nome:a.nome, type:a.type, mime:d.tipo || a.mime, tamanho:a.tamanho||null } });
    }
    for(const [name,{file,type}] of Object.entries(_confArquivos)){
      const b64 = await _confToB64(file);
      let meta = null;
      if(file.size <= 15*1024*1024 && ['application/pdf','image/jpeg','image/jpg','image/png'].includes(file.type)){
        try{
          const rg = await fetch('/api/controle/v2/arquivos', { method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ processo_id:p.id, nome:name, tipo:file.type, base64:b64 }) });
          const dg = await rg.json().catch(()=>({}));
          if(rg.ok && dg.ok && dg.id) meta = { arquivo_id:dg.id, nome:name, type, mime:file.type, tamanho:file.size };
        }catch(e){ console.warn('conferência: não guardou nos Arquivos', name, e); }
      }
      if(!meta) showToast('"' + name + '" não foi guardado nos Arquivos — na próxima conferência envie de novo.', 'warn');
      itens.push({ nome:name, type, mime:file.type, b64, file, meta });
    }

    const content = [];
    for(const it of itens){
      const isPdf = it.mime === 'application/pdf';
      content.push(isPdf
        ? {type:'document', source:{type:'base64', media_type:'application/pdf', data:it.b64}}
        : {type:'image', source:{type:'base64', media_type:it.mime, data:it.b64}});
      content.push({type:'text', text:`[DOCUMENTO ACIMA: ${CONF_DOC_LBL[it.type]||CONF_DOC_LBL.outros} — arquivo: ${it.nome}]`});
    }
    _confDocsUsados = incremental
      ? [...anterioresMeta, ...itens.map(it => it.meta).filter(Boolean)]
      : itens.map(it => it.meta).filter(Boolean);

    const docList = [...new Set(itens.map(it=>CONF_DOC_LBL[it.type]||CONF_DOC_LBL.outros))].join(', ');

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

    // Extensões ao prompt (06/10/2026): (a) dados extraídos de cada documento
    // enviado, guardados pra próxima conferência ler só o documento novo;
    // (b) no modo incremental, os dados dos documentos já conferidos.
    let extra = ' DADOS POR DOCUMENTO: inclua tambem no JSON o campo "dados_por_documento": [{"arquivo":"<nome do arquivo>","tipo":"CI|PL|BL|PI|CE|...","dados":{"exportador":"","importador":"","encomendante":"","fabricante":"","descricao_itens":"","quantidade":"","volumes":"","valor_unitario":"","valor_total":"","moeda":"","incoterm":"","forma_pagamento":"","dados_bancarios":"","porto_origem":"","porto_destino":"","pais_origem":"","peso_bruto":"","peso_liquido":"","ncm":"","containers":"","lacres":"","navio":"","data_embarque":"","frete":"","prepaid_collect":"","free_time":""}}] — um item para CADA documento enviado nesta mensagem (anexo), com os valores exatamente como aparecem no documento (vazio se nao houver). ';
    if(incremental){
      const dadosAnt = analisePre.dadosDocs || {};
      const anteriores = anterioresMeta.map(a => ({ documento: CONF_DOC_LBL[a.type]||a.type, arquivo: a.nome, dados: (dadosAnt[a.arquivo_id]||{}).dados || dadosAnt[a.arquivo_id] }));
      extra += 'MODO INCREMENTAL: os documentos ANEXADOS nesta mensagem sao NOVOS. Os outros documentos do processo ja foram conferidos entre si antes e NAO estao anexados — estao descritos abaixo apenas pelos dados extraidos deles. Compare SOMENTE os documentos novos contra os dados desses documentos ja conferidos (e os novos entre si, se houver mais de um). NAO compare os documentos ja conferidos entre si (isso ja foi feito). Use o nome real de cada documento nos labels (CI, PL, BL, PI, CE). Documentos ja conferidos: ' + JSON.stringify(anteriores) + ' ';
    }
    content.push({type:'text', text:prompt + extra});

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

    // Guardado no cache de sessão (fora da função) ANTES de _confArquivos
    // ser limpo no final, pra poder reler os mesmos documentos mais tarde
    // sem pedir upload de novo — seja agora (se já sair sem pendência) ou
    // quando a ÚLTIMA pendência for aceita (ver _confTentarPreencherAutomatico
    // e seu uso em confirmarMotivoConferencia).
    // Preenchimento automático lê só o que ainda não foi lido (no modo
    // incremental, só os documentos novos — os anteriores já foram lidos).
    _confArquivosUltimaAnalise = itens.map(it => ({ file: it.file || _confB64ParaFile(it.b64, it.nome, it.mime), arquivo_id: it.meta && it.meta.arquivo_id }));

    const analiseAnterior = _confLerAnalise(p);
    // Dados por documento: os anteriores que continuam + os desta leitura.
    const dadosDocs = {};
    if(incremental) anterioresMeta.forEach(a => { const d = (analiseAnterior.dadosDocs||{})[a.arquivo_id]; if(d) dadosDocs[a.arquivo_id] = d; });
    (result.dados_por_documento || []).forEach(dd => {
      const nome = String(dd && dd.arquivo || '').trim().toLowerCase();
      const it = itens.find(x => x.meta && String(x.nome).trim().toLowerCase() === nome) || null;
      if(it && it.meta) dadosDocs[it.meta.arquivo_id] = { tipo: dd.tipo || '', dados: dd.dados || {} };
    });
    // Modo incremental: divergências antigas entre documentos que não mudaram
    // continuam; as que envolvem documento novo/substituído/retirado saem
    // (os novos foram conferidos agora).
    let gruposFinal = result.grupos, resumoFinal = result.resumo, alertasFinal = result.alertas || [];
    if(incremental){
      const gruposFora = new Set([
        ...Object.values(_confArquivos).map(f => _confGrupoTipo(f.type)),
        ..._confAnteriores.filter(a => a.substituido || a.excluidoManual).map(a => _confGrupoTipo(a.type)),
      ]);
      const continuam = _confDivergenciasQueContinuam(analiseAnterior, gruposFora);
      gruposFinal = (result.grupos || []).map(g => ({ titulo: g.titulo, campos: [...(g.campos||[])] }));
      continuam.forEach(g => {
        const alvo = gruposFinal.find(x => String(x.titulo||'').toLowerCase() === String(g.titulo||'').toLowerCase());
        const chaves = new Set((alvo ? alvo.campos : []).map(c => ConferenciaChave.chaveDivergencia(c)));
        const novos = g.campos.filter(c => !chaves.has(ConferenciaChave.chaveDivergencia(c)));
        if(alvo) alvo.campos.push(...novos); else gruposFinal.push({ titulo: g.titulo, campos: novos });
      });
      alertasFinal = [...new Set([...(analiseAnterior.alertas||[]), ...alertasFinal].map(a => typeof a === 'string' ? a : (a.descricao||a.mensagem||'')))].filter(Boolean);
      resumoFinal = { ...(result.resumo||{}), campos_ok: ((analiseAnterior.resumo||{}).campos_ok||0) + ((result.resumo||{}).campos_ok||0) };
    }
    const novaAnalise = {
      data: new Date().toLocaleString('pt-BR'),
      docs: (incremental ? [...anterioresMeta.map(a => CONF_DOC_PT[a.type]||a.nome), ...itens.map(it=>(CONF_DOC_PT[it.type]||it.nome)+' (novo)')] : itens.map(it=>CONF_DOC_PT[it.type]||it.nome)).join(', '),
      analisadoPor: (_user && (_user.displayName||_user.usuario)) || '',
      resumo: resumoFinal,
      grupos: gruposFinal,
      alertas: alertasFinal,
      dadosDocs,
      modo: incremental ? 'incremental' : 'completa',
      // Documentos que o preenchimento automático já leu (não relê).
      docsExtraidos: ((analiseAnterior && analiseAnterior.docsExtraidos) || []).filter(id => _confDocsUsados.some(d => d.arquivo_id === id)),
      // Aceites de conferências anteriores passam SÓ quando a divergência é
      // exatamente a mesma (campo + documentos + valores) — 06/10/2026.
      divResolvedMap: ConferenciaChave.migrarAceites(analiseAnterior),
      chaveVersao: 2,
      // Documentos usados nesta conferência (guardados nos Arquivos do
      // processo) — a próxima conferência já começa com eles.
      docsArquivos: _confDocsUsados,
      // Histórico de análises anteriores deste processo (task #644, pedido
      // Ayslan 14/09/2026 — "pegou o histórico do sistema antigo de
      // análise?"): cada vez que uma NOVA análise roda por cima de uma já
      // existente, a análise que está saindo de cena vira uma entrada aqui
      // em vez de ser simplesmente descartada (era o que acontecia antes —
      // só a última análise sobrevivia). Guarda só um resumo enxuto (não os
      // grupos/campos completos, que ficariam pesados) — o objetivo é dar
      // contexto de "quando foi conferido antes e o que deu", não reabrir
      // uma análise antiga campo a campo. Limitado às últimas 15 pra não
      // crescer sem limite.
      analisesAnteriores: (analiseAnterior && analiseAnterior.data) ? [
        {
          data: analiseAnterior.data,
          docs: analiseAnterior.docs,
          analisadoPor: analiseAnterior.analisadoPor || '',
          resumo: analiseAnterior.resumo || {},
        },
        ...(analiseAnterior.analisesAnteriores||[]),
      ].slice(0, 15) : (analiseAnterior && analiseAnterior.analisesAnteriores) || [],
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
    _confAnteriores = (novaAnalise.docsArquivos||[]).map(d => ({ ...d, excluidoManual:false, substituido:false }));
    _confRenderChips();
    atualizarBadgeConferencia(p);

    // Só sai já sem pendência de cara em casos raros (quase sempre sobra
    // alguma divergência esperada pra aceitar uma a uma) — o caso comum é
    // tratado em confirmarMotivoConferencia(), que chama esta mesma função
    // de novo a cada aceite, até zerar as pendências.
    await _confTentarPreencherAutomatico(p, novaAnalise);
  }catch(err){
    showToast('Erro: '+err.message, 'err');
    console.error(err);
  }
  if(btn) btn.disabled = (Object.keys(_confArquivos).length + _confAnterioresEfetivos().length) < 2;
  if(loading) loading.style.display = 'none';
}

// ── Render do resultado (resumo + lista de divergências/alertas/ausências) ──
// Lista de divergências/ausências/alertas-com-campo de uma análise, na
// mesma ordem/critério usado no resumo visual (_confRenderResultado) —
// extraído pra função própria porque rodarConferencia() também precisa
// saber se sobrou alguma pendência (ver _confAutoPreencherSemPendencia).
// Mapa key -> aceite já resolvendo o legado por posição (ver conferencia-chave.js).
function _confMapaAceites(analise){
  const mapa = {};
  _confListarDivergencias(analise).forEach(d => {
    const a = ConferenciaChave.aceiteDe(analise, d, d.gi, d.ci);
    if(a) mapa[d.key] = a;
  });
  return mapa;
}

function _confListarDivergencias(analise){
  const divs = [];
  (analise.grupos||[]).forEach((grupo, gi)=>{
    (grupo.campos||[]).forEach((c, ci)=>{
      if(c.status==='DIVERGENCIA' || c.status==='AUSENTE' || (c.status==='ALERTA' && c.campo)){
        // key = conteúdo da divergência (06/10/2026, conferencia-chave.js);
        // gi/ci ficam só pra ler aceites antigos gravados pela posição.
        divs.push({ ...c, grupo: grupo.titulo, key: ConferenciaChave.chaveDivergencia(c), gi, ci });
      }
    });
  });
  return divs;
}

// Preenchimento automático do processo quando a conferência não deixou
// NENHUMA pendência (nem divergência sem aceitar, nem ausência) — pedido
// Emanuelly 16/09/2026: "coloco os documentos - aparece as pendencias -
// aceito essas que ta tudo bem ou coloco novos documentos para cumprir -
// quando estiverem todas aceitas ou sem pendencia o sistema começa a
// preencher". Chamada tanto ao final de rodarConferencia() (pro raro caso
// de já sair com 0 pendências) quanto ao final de confirmarMotivoConferencia()
// (o caso comum: ela aceita as divergências uma a uma até zerar). Reaproveita
// os arquivos da última conferência guardados em _confArquivosUltimaAnalise
// (ver comentário lá) — "a ideia era pra não rodar a mesma documentação mais
// vezes". Um flag na própria análise (_autoPreenchido) evita rodar de novo
// se ela reabrir a aba ou aceitar/desfazer outra coisa depois.
async function _confTentarPreencherAutomatico(p, analise){
  if(analise._autoPreenchido) return;
  const _aceites = _confMapaAceites(analise);
  const pendentes = _confListarDivergencias(analise).filter(d => !_aceites[d.key]);
  if(pendentes.length !== 0) return;
  if(typeof processarFilaIA !== 'function') return;
  // Só os documentos que ainda não foram lidos pela extração (06/10/2026).
  const jaLidos = new Set(analise.docsExtraidos || []);
  const aLer = _confArquivosUltimaAnalise.filter(x => x && x.file && !(x.arquivo_id && jaLidos.has(x.arquivo_id)));
  if(!aLer.length) return;
  showToast('Nenhuma pendência — lendo ' + (aLer.length === 1 ? 'o documento novo' : 'os ' + aLer.length + ' documentos novos') + ' pra preencher o processo automaticamente...', 'ok');
  try{
    await processarFilaIA(aLer.map(x => x.file));
    analise.docsExtraidos = [...jaLidos, ...aLer.map(x => x.arquivo_id).filter(Boolean)];
    // fecharAoSalvar:false -- ver comentário em coletarESalvar() (controle-campos.js):
    // isso roda sozinho depois da última divergência aceita, sem o usuário clicar
    // em Salvar, então não deve fechar o painel do processo.
    if(typeof coletarESalvar === 'function') coletarESalvar({fecharAoSalvar:false});
    analise._autoPreenchido = true;
    // Persiste o flag junto da análise, pra não repetir a extração se ela
    // reabrir o processo mais tarde e mexer em algum aceite de novo.
    await _confSalvarResolvedMap(p, analise);
  }catch(e){
    console.error('Preenchimento automático pós-conferência falhou:', e);
    showToast('Sem pendências, mas o preenchimento automático falhou — confira/preencha manualmente as outras abas.', 'warn');
  }
}

function _confRenderResultado(p, analise){
  const resumo = analise.resumo || {};
  const divs = _confListarDivergencias(analise);
  const resolvedMap = _confMapaAceites(analise);
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
        <div style="flex-shrink:0;display:flex;flex-direction:column;gap:6px;align-items:flex-end;">
          <button class="btn btn-sm btn-outline" onclick="copiarDivergenciaConferencia(this, '${d.key}')">📋 Copiar</button>
          ${resolvedMap[d.key]
            ? `<button class="btn btn-sm btn-outline" onclick="desfazerAceiteConferencia('${d.key}')">Desfazer</button>`
            : `<button class="btn btn-sm btn-primary" onclick="abrirModalMotivoConferencia('${d.key}')">Aceitar</button>`
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
      ${_confRenderHistoricoAnteriores(analise)}
    </div>`;
}

// Histórico de análises anteriores (task #644) — bloco recolhido por
// padrão, só a contagem de OK/pendentes/aceitas de cada rodada passada,
// pra não sobrecarregar a tela com o resultado completo de conferências
// que já foram substituídas por uma mais recente.
function _confRenderHistoricoAnteriores(analise){
  const lista = analise.analisesAnteriores || [];
  if(!lista.length) return '';
  const linha = a => {
    const r = a.resumo || {};
    return `<div style="border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-bottom:6px;font-size:12px;">
      <div style="color:var(--dim);">${esc(a.data||'')}${a.analisadoPor?' — por '+esc(a.analisadoPor):''}</div>
      <div style="color:var(--muted);margin-top:2px;">docs: ${esc(a.docs||'—')}</div>
      <div style="margin-top:4px;">${r.campos_ok!=null?`<span style="color:var(--ok);">${r.campos_ok} OK</span>`:''}</div>
    </div>`;
  };
  return `
    <details style="margin-top:16px;">
      <summary style="cursor:pointer;font-size:11px;font-weight:700;color:var(--muted);">📜 Histórico de análises anteriores (${lista.length})</summary>
      <div style="margin-top:8px;">${lista.map(linha).join('')}</div>
    </details>`;
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

// Reconstrói a lista de divergências (mesma lógica de filtro de _confRenderResultado)
// a partir da análise salva, pra achar uma divergência específica pela key
// (gi+'-'+ci) sem precisar repassar o objeto inteiro em cada onclick.
function _confBuscarDivergencia(analise, key){
  // 06/10/2026: a key agora é o conteúdo da divergência (conferencia-chave.js).
  // Esta busca ainda procurava pela posição antiga ("0-1") e não achava nada —
  // o botão Aceitar/Copiar não abria (relato Emanuelly, LADJ-IM-UNI-2605VTBR1).
  return _confListarDivergencias(analise).find(d => d.key === key || (d.gi+'-'+d.ci) === key) || null;
}

// ── Copiar texto de uma divergência (pedido Ayslan, 14/09/2026) — mesmo
// formato do copiarTexto()/processos.html, um clique copia pro clipboard
// com fallback pro método antigo (execCommand) se a API moderna falhar
// (ex: página não estar em foco).
function copiarDivergenciaConferencia(btn, key){
  const p = _editando;
  const analise = _confLerAnalise(p);
  if(!analise) return;
  const d = _confBuscarDivergencia(analise, key);
  if(!d) return;
  let texto = `${d.campo||''} (${d.grupo||''})\n`;
  if(d.doc1_label||d.doc1_valor) texto += `${d.doc1_label||''}: ${d.doc1_valor||'—'}\n`;
  if(d.doc2_label||d.doc2_valor) texto += `${d.doc2_label||''}: ${d.doc2_valor||'—'}\n`;
  if(d.observacao) texto += `Obs: ${d.observacao}\n`;
  if(d.severidade) texto += `Severidade: ${d.severidade}\n`;
  const feedback = () => {
    const orig = btn.textContent;
    btn.textContent = '✓ Copiado!';
    setTimeout(()=>{ btn.textContent = orig; }, 2000);
  };
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(texto).then(feedback).catch(()=>_confCopiarFallback(texto, feedback));
  } else {
    _confCopiarFallback(texto, feedback);
  }
}
function _confCopiarFallback(texto, feedback){
  const ta = document.createElement('textarea');
  ta.value = texto; document.body.appendChild(ta); ta.select();
  try{ document.execCommand('copy'); feedback(); }catch(e){ showToast('Não foi possível copiar', 'err'); }
  document.body.removeChild(ta);
}

// ── Modal de motivo (substitui o prompt() do navegador, pedido Ayslan
// 14/09/2026) — overlay simples criado/removido dinamicamente, mesmo
// espírito do dre-overlay em controle-modal.js.
function abrirModalMotivoConferencia(key){
  const p = _editando;
  const analise = _confLerAnalise(p);
  if(!analise) return;
  const d = _confBuscarDivergencia(analise, key);
  if(!d) return;
  document.getElementById('conf-motivo-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'conf-motivo-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
  overlay.onclick = e => { if(e.target === overlay) fecharModalMotivoConferencia(); };
  overlay.innerHTML = `
    <div style="background:var(--card,#fff);border-radius:12px;max-width:460px;width:92%;padding:20px;box-shadow:var(--shadow-lg);">
      <div style="font-family:'Syne',sans-serif;font-size:15px;font-weight:700;margin-bottom:4px;">Aceitar divergência</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:14px;">${esc(d.campo||'')} — ${esc(d.grupo||'')}</div>
      <label class="form-label" style="display:block;margin-bottom:6px;">Motivo do aceite</label>
      <textarea id="conf-motivo-texto" class="form-input" rows="3" style="width:100%;resize:vertical;" placeholder="Ex: diferença de arredondamento, padrão do fornecedor...">${esc(d.motivo_sugerido||'')}</textarea>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
        <button class="btn btn-outline" onclick="fecharModalMotivoConferencia()">Cancelar</button>
        <button class="btn btn-primary" onclick="confirmarMotivoConferencia('${key}')">✓ Aceitar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('conf-motivo-texto')?.focus();
  // Guarda o texto inicial pra saber, no ESC, se o usuário alterou o
  // motivo sem confirmar (pedido Ayslan 18/09/2026: avisar antes de
  // fechar se tiver algo pra salvar).
  _confMotivoInicial = document.getElementById('conf-motivo-texto')?.value || '';
}
function fecharModalMotivoConferencia(){
  document.getElementById('conf-motivo-overlay')?.remove();
}
let _confMotivoInicial = '';
document.addEventListener('keydown', function(e){
  if(e.key !== 'Escape') return;
  if(!document.getElementById('conf-motivo-overlay')) return;
  const textarea = document.getElementById('conf-motivo-texto');
  const mudou = textarea && textarea.value !== _confMotivoInicial;
  if(mudou){
    if(confirm('Você alterou o motivo do aceite e ainda não confirmou. Deseja descartar e fechar?')) fecharModalMotivoConferencia();
  } else {
    fecharModalMotivoConferencia();
  }
});
async function confirmarMotivoConferencia(key){
  const p = _editando;
  const analise = _confLerAnalise(p);
  if(!analise) return;
  const motivo = document.getElementById('conf-motivo-texto')?.value.trim() || 'Aceito sem motivo informado';
  fecharModalMotivoConferencia();
  analise.divResolvedMap = analise.divResolvedMap || {};
  analise.divResolvedMap[key] = { motivo, por:(_user && (_user.displayName||_user.usuario)) || '', time:new Date().toLocaleString('pt-BR') };
  const ok = await _confSalvarResolvedMap(p, analise);
  if(ok){
    showToast('✓ Divergência aceita', 'ok');
    document.getElementById('conf-resultado').innerHTML = _confRenderResultado(p, analise);
    atualizarBadgeConferencia(p);
    // Essa pode ter sido a ÚLTIMA pendência — tenta preencher automaticamente
    // (não faz nada se ainda sobrar alguma, ver _confTentarPreencherAutomatico).
    await _confTentarPreencherAutomatico(p, analise);
  }
}

async function desfazerAceiteConferencia(key){
  const p = _editando;
  const analise = _confLerAnalise(p);
  if(!analise || !analise.divResolvedMap) return;
  delete analise.divResolvedMap[key];
  // Análise antiga: o aceite pode estar gravado pela posição.
  const dLeg = _confListarDivergencias(analise).find(x => x.key === key);
  if(dLeg) delete analise.divResolvedMap[dLeg.gi+'-'+dLeg.ci];
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
  const temPendenteBloqueante = (analise.grupos||[]).some((g,gi)=>(g.campos||[]).some((c,ci)=>
    (c.status==='DIVERGENCIA'||c.status==='AUSENTE') && c.severidade==='BLOQUEANTE' && !ConferenciaChave.aceiteDe(analise, c, gi, ci)
  ));
  if(temPendenteBloqueante) tab.insertAdjacentHTML('beforeend', '<span class="tab-alert"></span>');
}
