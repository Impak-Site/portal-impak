// controle-campos.js
//
// Portos padronizados, containers/produtos multi-item, confirmação de câmbio, máscara monetária, esc() e colarData() — campos e helpers usados no formulário do processo.
//
// Parte do controle_v2.html, extraído do <script> único original pra
// facilitar manutenção. Carregado via <script src> junto com os outros
// módulos (ver controle_v2.html) — não é um ES module, então todo
// estado (let/const de topo) e funções aqui continuam visíveis pros
// outros arquivos, exatamente como estavam quando tudo era um só
// <script>. controle-core.js precisa carregar ANTES dos demais (é
// quem declara o estado global: _processos, _user, FASES etc.).
//
// ── PORTOS PADRONIZADOS ──────────────────────────────────────────
// Objetivo: acabar com grafias diferentes pro mesmo porto (NAVEGANTES vs NVT
// vs Navegantes-SC...). Destino usa os MESMOS 3 códigos do Calculador
// (armazenagem por porto) — mantém os dois sistemas 100% consistentes.
const PORTOS_DESTINO = [
  { codigo:'ITJ', nome:'Itajaí' },
  { codigo:'IOA', nome:'Itapoá' },
  { codigo:'NVT', nome:'Navegantes' },
];
// Origem varia mais (várias cidades/países), então fica uma lista das mais
// usadas + "Outro" pra digitar livre quando aparecer uma nova.
// Lista ampliada cobrindo os principais polos de fabricação de pneus na Ásia
// (China, Vietnã, Camboja, Tailândia, Indonésia, Índia, Coreia do Sul, Malásia).
const PORTOS_ORIGEM = [
  // China
  'SHANGHAI','NINGBO','QINGDAO','TIANJIN','XIAMEN','SHENZHEN','GUANGZHOU','NANSHA','YANTIAN','DALIAN','LIANYUNGANG',
  // Vietnã
  'HO CHI MINH','HAI PHONG',
  // Camboja
  'SIHANOUKVILLE','PHNOM PENH',
  // Tailândia
  'LAEM CHABANG','BANGKOK',
  // Indonésia
  'JAKARTA','SURABAYA',
  // Índia
  'CHENNAI','NHAVA SHEVA','MUNDRA',
  // Coreia do Sul
  'BUSAN',
  // Malásia
  'PORT KLANG',
];

// Mesmo agrupamento por país da lista PORTOS_ORIGEM acima, só que como mapa
// direto porto→país — usado no Dashboard Financeiro pra mostrar de qual
// país cada pagamento é, sem precisar de um campo novo no cadastro (reusa
// o porto de origem que já é preenchido em todo processo).
const PORTO_PAIS = {
  'SHANGHAI':'China','NINGBO':'China','QINGDAO':'China','TIANJIN':'China','XIAMEN':'China',
  'SHENZHEN':'China','GUANGZHOU':'China','NANSHA':'China','YANTIAN':'China','DALIAN':'China','LIANYUNGANG':'China',
  'HO CHI MINH':'Vietnã','HAI PHONG':'Vietnã',
  'SIHANOUKVILLE':'Camboja','PHNOM PENH':'Camboja',
  'LAEM CHABANG':'Tailândia','BANGKOK':'Tailândia',
  'JAKARTA':'Indonésia','SURABAYA':'Indonésia',
  'CHENNAI':'Índia','NHAVA SHEVA':'Índia','MUNDRA':'Índia',
  'BUSAN':'Coreia do Sul',
  'PORT KLANG':'Malásia',
};
// País do processo a partir do porto de origem já cadastrado — se for um
// porto fora da lista (ou "Outro" com texto livre), mostra "—" em vez de
// arriscar um palpite errado.
function paisDoProcesso(proc){
  const porto = (proc.porto_origem||'').trim().toUpperCase();
  return PORTO_PAIS[porto] || '—';
}

// Normaliza grafias antigas/variadas do porto de destino pro código padrão
// (ITJ/IOA/NVT) — usado no import de planilha e na extração por IA, pra já
// chegar limpo na base em vez de precisar corrigir manualmente depois.
function normalizarPortoDestino(valor){
  if(!valor) return valor;
  const va = valor.trim().toUpperCase();
  const APELIDOS = { 'NAVEGANTES':'NVT', 'ITAJAI':'ITJ', 'ITAJAÍ':'ITJ', 'ITAPOA':'IOA', 'ITAPOÁ':'IOA', 'PORTONAVE':'NVT' };
  return APELIDOS[va] || (PORTOS_DESTINO.some(p=>p.codigo===va) ? va : valor);
}

function gerarOptionsPortoDestino(valorAtual){
  const va = (valorAtual||'').trim().toUpperCase();
  const APELIDOS = { 'NAVEGANTES':'NVT', 'ITAJAI':'ITJ', 'ITAJAÍ':'ITJ', 'ITAPOA':'IOA', 'ITAPOÁ':'IOA' };
  const codigoResolvido = APELIDOS[va] || va;
  const match = PORTOS_DESTINO.find(p => p.codigo === codigoResolvido);
  let html = '<option value="">— selecionar —</option>';
  html += PORTOS_DESTINO.map(p => `<option value="${p.codigo}" ${match&&match.codigo===p.codigo?'selected':''}>${p.nome} (${p.codigo})</option>`).join('');
  if(valorAtual && !match){
    // Valor antigo que não bate com nenhum dos 3 — mantém visível pra não
    // sumir a informação, mas sinaliza que precisa escolher o correto.
    html += `<option value="${esc(valorAtual)}" selected>⚠ "${esc(valorAtual)}" (valor antigo — selecione o porto correto)</option>`;
  }
  return html;
}

function gerarOptionsPortoOrigem(valorAtual){
  const va = (valorAtual||'').trim().toUpperCase();
  const match = PORTOS_ORIGEM.includes(va);
  let html = '<option value="">— selecionar —</option>';
  html += PORTOS_ORIGEM.map(p => `<option value="${p}" ${va===p?'selected':''}>${p}</option>`).join('');
  html += `<option value="OUTRO" ${(valorAtual && !match)?'selected':''}>Outro (digitar)</option>`;
  return html;
}

function togglePortoOutro(tipo){
  const sel = document.getElementById('f_porto_'+tipo);
  const outro = document.getElementById('f_porto_'+tipo+'_outro');
  if(!sel || !outro) return;
  outro.style.display = sel.value === 'OUTRO' ? 'block' : 'none';
}

function coletarESalvar(){
  const ref = document.getElementById('f_referencia')?.value?.trim();
  if(!ref){ showToast('Informe a Referência','err'); return; }

  const antigo = {...(_editando||{})};
  const campos = [
    'referencia','finalidade','fornecedor','cliente','produto','obs',
    'pi_numero','pi_data','pi_valor_usd','pi_incoterm','pi_pagamento','pi_pago',
    'pi_entrada_pct','pi_prazo_dias','pi_data_entrada','pi_data_saldo',
    'previsao_prontidao','data_prontidao',
    'booking_numero','armador','agente','navio','viagem','valor_frete','moeda_frete','porto_origem','porto_destino',
    'etd','eta','free_time','data_embarque','hbl','mbl','container','tipo_container',
    'peso_bruto','volumes','data_chegada','data_presenca','demurrage_vencimento',
    'data_registro_di','numero_di','canal','data_parametrizacao','data_liberacao',
    'ci_numero','ci_data','ci_valor_usd',
    'ce_master','ce_house','ce_data_embarque','pendencia_revisao',
    'data_agendamento','data_carregamento','transportadora','placa',
    'nf_entrada_numero','nf_entrada_data','nf_entrada_valor',
    'nf_saida_numero','nf_saida_data','nf_saida_valor',
    'data_devolucao_vazio','demurrage_valor','demurrage_pago',
    'despachante','pi_cambio','pi_cambio_fechado','pi_cambio_entrada','pi_cambio_saldo','containers_json','produtos_json',
  ];

  const proc = {..._editando};
  const log = proc.log || [];
  // Campos que de fato mudaram nesta sessão de edição (comparados contra o
  // snapshot capturado quando o modal abriu, não contra "antigo" acima — o
  // "antigo" é recapturado a cada clique em Salvar e já reflete qualquer
  // valor que a extração por IA tenha colocado em _editando ANTES do clique,
  // então usá-lo aqui faria campos preenchidos pela IA nunca entrarem no
  // patch. _editandoOriginal fica fixo desde a abertura do modal e pega
  // qualquer alteração real, seja por digitação ou por IA). Só esses campos
  // (+ os calculados abaixo) são enviados ao servidor — ver nota em
  // _editandoOriginal sobre por quê.
  const original = _editandoOriginal || {};
  const patchFields = [];

  // Campos monetários com máscara xx.xxx,xx (texto) — precisam de parsing próprio
  const camposMoeda = ['pi_valor_usd','ci_valor_usd','demurrage_valor','nf_entrada_valor','nf_saida_valor','valor_frete'];

  // Remover campo interno de controle
  delete proc._fasePrevista;

  campos.forEach(campo=>{
    const el = document.getElementById('f_'+campo);
    if(!el) return;
    let val;
    if(camposMoeda.includes(campo)) val = valorMoeda('f_'+campo);
    else{
      val = el.value?.trim();
      if(el.type==='number') val = val===''?null:parseFloat(val);
      else if(campo==='pi_pago'||campo==='demurrage_pago') val = val==='true';
      else if(val==='') val = null;
    }

    // Log de auditoria (porto_origem fica de fora aqui — tratado à parte
    // depois, porque o valor "OUTRO" do select não é o valor real digitado)
    const antes = antigo[campo];
    if(campo !== 'porto_origem' && String(antes||'')!==String(val||'')){
      log.push({
        campo, valor_antes: antes||'', valor_depois: val||'',
        usuario: _user.usuario,
        created_at: new Date().toISOString()
      });
    }
    if(String(original[campo]||'')!==String(val||'')) patchFields.push(campo);
    proc[campo] = val;
  });

  // Porto Origem "Outro" — usa o texto digitado no campo extra em vez do
  // literal "OUTRO" que o select devolveria.
  if(proc.porto_origem === 'OUTRO'){
    const outroVal = document.getElementById('f_porto_origem_outro')?.value?.trim();
    if(String(antigo.porto_origem||'') !== String(outroVal||'')){
      log.push({ campo:'porto_origem', valor_antes: antigo.porto_origem||'', valor_depois: outroVal||'', usuario: _user.usuario, created_at: new Date().toISOString() });
    }
    proc.porto_origem = outroVal || null;
  }
  if(String(original.porto_origem||'')!==String(proc.porto_origem||'')) patchFields.push('porto_origem');

  // Salvar multi-containers e auditar mudança
  sincronizarContainerLegado();
  const novosContainersJson = JSON.stringify(_containers);
  if(String(antigo.containers_json||'')!==novosContainersJson){
    log.push({
      campo:'containers_json', valor_antes: antigo.containers_json||'', valor_depois: novosContainersJson,
      usuario: _user.usuario, created_at: new Date().toISOString()
    });
  }
  if(String(original.containers_json||'')!==novosContainersJson) patchFields.push('containers_json','container','tipo_container');
  proc.containers_json = novosContainersJson;
  proc.container = _containers[0]?.numero||'';
  proc.tipo_container = _containers[0]?.tipo||'40HC';

  // Salvar multi-produtos e auditar mudança
  sincronizarProdutoLegado();
  const novosProdutosJson = JSON.stringify(_produtos);
  if(String(antigo.produtos_json||'')!==novosProdutosJson){
    log.push({
      campo:'produtos_json', valor_antes: antigo.produtos_json||'', valor_depois: novosProdutosJson,
      usuario: _user.usuario, created_at: new Date().toISOString()
    });
  }
  const novoProdutoTxt = document.getElementById('f_produto')?.value || '';
  if(String(original.produtos_json||'')!==novosProdutosJson || String(original.produto||'')!==novoProdutoTxt) patchFields.push('produtos_json','produto');
  proc.produtos_json = novosProdutosJson;
  proc.produto = novoProdutoTxt;

  proc.log = log;
  _editando = proc;

  salvarProcesso(proc, patchFields).then(ok=>{ if(ok) fecharModal(); });
}

// ════════════════════════════════════════════════════════════════
// UTILS
// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
// EXPORTAÇÃO EXCEL
// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
// MULTI-CONTAINERS
// ════════════════════════════════════════════════════════════════
let _containers = []; // [{numero, tipo, lacre}]

function renderMultiContainers(){
  const lista = document.getElementById('multi-containers-list');
  if(!lista) return;
  if(!_containers.length) _containers = [{numero:'', tipo:'40HC', lacre:''}];
  lista.innerHTML = _containers.map((c,i)=>`
    <div style="display:grid;grid-template-columns:1fr 100px 1fr 32px;gap:6px;align-items:center;">
      <input class="form-input" placeholder="Nº Container (ex: MSCU1234567)" value="${c.numero||''}"
        oninput="_containers[${i}].numero=this.value;sincronizarContainerLegado()">
      <select class="form-input" onchange="_containers[${i}].tipo=this.value;sincronizarContainerLegado()">
        <option value="20GP" ${c.tipo==='20GP'?'selected':''}>20GP</option>
        <option value="40GP" ${c.tipo==='40GP'?'selected':''}>40GP</option>
        <option value="40HC" ${(!c.tipo||c.tipo==='40HC')?'selected':''}>40HC</option>
        <option value="40NOR" ${c.tipo==='40NOR'?'selected':''}>40NOR</option>
      </select>
      <input class="form-input" placeholder="Lacre (opcional)" value="${c.lacre||''}"
        oninput="_containers[${i}].lacre=this.value">
      ${_containers.length>1
        ? `<button type="button" onclick="removerContainer(${i})" style="background:none;border:none;color:var(--err);cursor:pointer;font-size:16px;padding:0;">✕</button>`
        : '<div></div>'}
    </div>
  `).join('');
  sincronizarContainerLegado();
}

function adicionarContainer(){
  _containers.push({numero:'', tipo:'40HC', lacre:''});
  renderMultiContainers();
}

function removerContainer(i){
  _containers.splice(i,1);
  if(!_containers.length) _containers = [{numero:'', tipo:'40HC', lacre:''}];
  renderMultiContainers();
}

function sincronizarContainerLegado(){
  // Manter campo legado f_container com o primeiro container para compatibilidade
  const input = document.getElementById('f_containers_json');
  if(input) input.value = JSON.stringify(_containers);
  const fc = document.getElementById('f_container');
  const ft = document.getElementById('f_tipo_container');
  if(fc && _containers[0]) fc.value = _containers[0].numero||'';
  if(ft && _containers[0]) ft.value = _containers[0].tipo||'40HC';
}

// ════════════════════════════════════════════════════════════════
// MULTI-PRODUTOS (descrição + quantidade, múltiplos itens)
// ════════════════════════════════════════════════════════════════
let _produtos = []; // [{descricao, quantidade}]

function renderMultiProdutos(){
  const lista = document.getElementById('multi-produtos-list');
  if(!lista) return;
  if(!_produtos.length) _produtos = [{descricao:'', quantidade:''}];
  lista.innerHTML = _produtos.map((it,i)=>`
    <div style="display:grid;grid-template-columns:1fr 110px 32px;gap:6px;align-items:center;">
      <input class="form-input" placeholder="Descrição (ex: PNEU TBR 295/80R22.5)" value="${esc(it.descricao||'')}"
        oninput="_produtos[${i}].descricao=this.value;sincronizarProdutoLegado()">
      <input class="form-input" type="number" placeholder="Qtde" value="${it.quantidade!=null?it.quantidade:''}"
        oninput="_produtos[${i}].quantidade=this.value;sincronizarProdutoLegado()">
      ${_produtos.length>1
        ? `<button type="button" onclick="removerProdutoItem(${i})" style="background:none;border:none;color:var(--err);cursor:pointer;font-size:16px;padding:0;">✕</button>`
        : '<div></div>'}
    </div>
  `).join('');
  sincronizarProdutoLegado();
}

function adicionarProdutoItem(){
  _produtos.push({descricao:'', quantidade:''});
  renderMultiProdutos();
}

function removerProdutoItem(i){
  _produtos.splice(i,1);
  if(!_produtos.length) _produtos = [{descricao:'', quantidade:''}];
  renderMultiProdutos();
}

function sincronizarProdutoLegado(){
  // Manter campo legado f_produto com resumo (1º item + "e mais N") para compatibilidade
  // com telas/relatórios que ainda leem o texto único.
  const input = document.getElementById('f_produtos_json');
  if(input) input.value = JSON.stringify(_produtos);
  const fp = document.getElementById('f_produto');
  if(fp){
    const validos = _produtos.filter(it=>it.descricao);
    fp.value = validos.length
      ? validos.map(it=>it.descricao + (it.quantidade?` (${it.quantidade})`:'')).join(' + ')
      : '';
  }
}

// ════════════════════════════════════════════════════════════════
// RELATÓRIO COM FILTROS
// ════════════════════════════════════════════════════════════════
function esc(v){ return v ? String(v).replace(/"/g,'&quot;').replace(/</g,'&lt;') : ''; }

// ── COLAR DATA (DD/MM/AAAA) EM CAMPOS type="date" ────────────────
function colarData(ev, el){
  const texto = ((ev.clipboardData || window.clipboardData)?.getData('text') || '').trim();
  if(!texto) return;
  let d, m, y;
  const comSeparador = texto.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if(comSeparador){
    d = comSeparador[1].padStart(2,'0');
    m = comSeparador[2].padStart(2,'0');
    y = comSeparador[3].length===2 ? ('20'+comSeparador[3]) : comSeparador[3];
  } else {
    const digits = texto.replace(/[^\d]/g,'');
    if(digits.length===8){ d=digits.slice(0,2); m=digits.slice(2,4); y=digits.slice(4,8); }
  }
  if(!d) return;
  const iso = `${y}-${m}-${d}`;
  const testeData = new Date(iso+'T00:00:00');
  if(isNaN(testeData.getTime()) || testeData.getDate()!==parseInt(d,10)){
    showToast('Data colada inválida — use o formato DD/MM/AAAA','err');
    ev.preventDefault();
    return;
  }
  ev.preventDefault();
  el.value = iso;
  el.dispatchEvent(new Event('input', {bubbles:true}));
  el.dispatchEvent(new Event('change', {bubbles:true}));
}

// ── COMPROVANTE DE CÂMBIO (confirmação manual Entrada/Saldo/Único) ──
let _cambioPendente = null;

function abrirModalConfirmarCambio(match, refAtual){
  _cambioPendente = match;
  const taxa = parseFloat(match.taxa_cambio) || 0;
  const valorPago = parseFloat(match.valor_pago) || 0;
  const valorUsdImplicito = taxa ? (valorPago/taxa) : 0;
  const info = document.getElementById('cambio-modal-info');
  if(info){
    info.innerHTML = `<b>Referência:</b> ${esc(match.referencia||refAtual||'(não identificada no documento)')}<br>`
      + `<b>Taxa de câmbio:</b> R$ ${taxa.toLocaleString('pt-BR',{minimumFractionDigits:4})}<br>`
      + (valorPago ? `<b>Valor pago:</b> R$ ${valorPago.toLocaleString('pt-BR',{minimumFractionDigits:2})} (≈ US$ ${valorUsdImplicito.toLocaleString('pt-BR',{minimumFractionDigits:2})} nessa taxa)<br>` : '');
  }
  document.getElementById('modal-cambio-bg')?.classList.add('open');
}

function fecharModalCambio(){
  document.getElementById('modal-cambio-bg')?.classList.remove('open');
  _cambioPendente = null;
}

function confirmarCambioComo(tipo){
  if(!_cambioPendente){ fecharModalCambio(); return; }
  const taxa = parseFloat(_cambioPendente.taxa_cambio) || 0;
  if(!taxa){ showToast('Taxa de câmbio inválida no comprovante','err'); fecharModalCambio(); return; }

  // Data em que o pagamento/câmbio foi efetivado — vem da extração da IA
  // (ver "data_pagamento" no comprovante) ou, se o documento não trouxer
  // essa data, usa hoje como aproximação razoável (o usuário pode corrigir
  // manualmente no campo de data depois).
  const dataPagamento = _cambioPendente.data_pagamento || new Date().toISOString().slice(0,10);

  // Confirmar um comprovante de câmbio aqui é a prova de que o pagamento
  // (total ou parcial) realmente aconteceu — por isso também atualiza
  // "PI Paga?" e a data de pagamento correspondente, além da taxa de câmbio
  // (antes só a taxa era preenchida e o "PI Paga?" nunca era tocado).
  if(tipo==='unico'){
    // Grava no campo "Câmbio Fechado" (separado de "Câmbio na PI", que é a
    // previsão feita lá atrás) — assim o Dashboard Financeiro consegue
    // comparar previsto x fechado e calcular a diferença cambial depois.
    // Antes isso sobrescrevia f_pi_cambio direto, o que apagava a previsão
    // original assim que o pagamento era confirmado.
    const el = document.getElementById('f_pi_cambio_fechado');
    if(el){ el.value = taxa.toFixed(4); el.dispatchEvent(new Event('change',{bubbles:true})); }

    const selPagamento = document.getElementById('f_pi_pagamento');
    if(selPagamento && !selPagamento.value){ selPagamento.value = 'VISTA'; renderPagamentoCampos(); }
    const formaAtual = selPagamento?.value;
    const idData = formaAtual==='PRAZO' ? 'f_pi_data_saldo' : 'f_pi_data_entrada';
    const elData = document.getElementById(idData);
    if(elData) elData.value = dataPagamento;
    const elPago = document.getElementById('f_pi_pago');
    if(elPago) elPago.value = 'true';
    renderPagamentoInfoLive();
  } else if(tipo==='entrada'){
    const selPagamento = document.getElementById('f_pi_pagamento');
    if(selPagamento && selPagamento.value!=='ENTRADA_SALDO'){ selPagamento.value = 'ENTRADA_SALDO'; renderPagamentoCampos(); }
    const el = document.getElementById('f_pi_cambio_entrada');
    if(el){ el.value = taxa.toFixed(4); }
    const elData = document.getElementById('f_pi_data_entrada');
    if(elData) elData.value = dataPagamento;
    // Entrada é só parcial — NÃO marca a PI inteira como paga, só o Saldo fecha.
    renderPagamentoInfoLive();
  } else if(tipo==='saldo'){
    const selPagamento = document.getElementById('f_pi_pagamento');
    if(selPagamento && selPagamento.value!=='ENTRADA_SALDO'){ selPagamento.value = 'ENTRADA_SALDO'; renderPagamentoCampos(); }
    const el = document.getElementById('f_pi_cambio_saldo');
    if(el){ el.value = taxa.toFixed(4); }
    const elData = document.getElementById('f_pi_data_saldo');
    if(elData) elData.value = dataPagamento;
    const elPago = document.getElementById('f_pi_pago');
    if(elPago) elPago.value = 'true';
    renderPagamentoInfoLive();
  }
  showToast(`✓ Câmbio (${taxa.toLocaleString('pt-BR',{minimumFractionDigits:4})}) aplicado como ${tipo==='unico'?'Pagamento Único':tipo==='entrada'?'Entrada':'Saldo'} — PI marcada de acordo`,'ok');
  fecharModalCambio();
}

// ── MÁSCARA NUMÉRICA xx.xxx,xx (campos monetários) ──────────────
// Usada em inputs type="text" que substituem os antigos type="number"
// para permitir exibir separador de milhar (o <input type="number"> nativo
// nunca aceita formatação). O valor numérico real é obtido com valorMoeda().
function formatarMoedaInput(el){
  let digits = (el.value||'').replace(/\D/g,'');
  if(!digits){ el.value=''; return; }
  digits = digits.replace(/^0+(?=\d)/,'');
  while(digits.length<3) digits = '0'+digits;
  const intPart = digits.slice(0,-2).replace(/^0+(?=\d)/,'') || '0';
  const centavos = digits.slice(-2);
  const milhares = intPart.replace(/\B(?=(\d{3})+(?!\d))/g,'.');
  el.value = milhares+','+centavos;
}
function valorMoeda(id){
  const el = document.getElementById(id);
  if(!el || !el.value) return null;
  const limpo = el.value.replace(/\./g,'').replace(',','.');
  const n = parseFloat(limpo);
  return isNaN(n) ? null : n;
}
function exibirMoeda(v){
  if(v===null||v===undefined||v==='') return '';
  return parseFloat(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
}

