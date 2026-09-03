// controle-campos.js
//
// Portos padronizados, containers/produtos multi-item, vendas multi-cliente
// (rateio de custo), confirmação de câmbio, máscara monetária, esc() e
// colarData() — campos e helpers usados no formulário do processo.
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

// Dias de armazenagem grátis (1º período) no porto por código de destino —
// depois desse prazo a partir da Presença de Carga (chegada física da carga
// no terminal, não a atracação do navio), o porto passa a cobrar armazenagem
// adicional. Pedido da Emanuelly (03/09/2026): Navegantes = 5 dias, Itapoá =
// 4 dias. Itajaí ainda não tem prazo confirmado com o time — usando 5 dias
// (mesmo de Navegantes) até alguém confirmar o valor real do terminal.
const PORTO_ARMAZENAGEM_FREE_DIAS = { NVT: 5, IOA: 4, ITJ: 5 };
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
  if(APELIDOS[va]) return APELIDOS[va];
  if(PORTOS_DESTINO.some(p=>p.codigo===va)) return va;
  // Fallback por substring — cobre variações tipo "NAVEGANTES, BRAZIL" ou
  // "PORTO DE ITAJAÍ" que vêm de extração por IA (BL) e não batem exato
  // com nenhum apelido acima.
  const apelidoPorSubstring = Object.keys(APELIDOS).find(chave => va.includes(chave));
  return apelidoPorSubstring ? APELIDOS[apelidoPorSubstring] : valor;
}

// Versão pra exibição (relatórios/exports pro cliente): sempre devolve o
// nome completo do porto (ex: "Itajaí"), nunca o código nem a grafia crua
// que veio do documento — pedido da Emanuelly (03/09/2026): o follow-up/
// export "p/ Cliente" estava saindo com ITJ/NVT/IOA misturado com nomes
// completos e "N/I", dependendo de como cada processo foi cadastrado.
function formatarPortoDestino(valor){
  if(!valor || !String(valor).trim()) return 'N/I';
  const codigo = normalizarPortoDestino(valor);
  const match = PORTOS_DESTINO.find(p => p.codigo === codigo);
  return match ? match.nome : valor;
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
  if(window._salvandoProcesso) return;
  const ref = document.getElementById('f_referencia')?.value?.trim();
  if(!ref){ showToast('Informe a Referência','err'); return; }

  // Validação das parcelas do pagamento "Parcelado" — mesma ideia da
  // validação de vendas logo abaixo: barrar ANTES de gravar, não deixar
  // parcela sem valor virar um "USD 0,00" silencioso no Financeiro.
  if(document.getElementById('f_pi_pagamento')?.value === 'PARCELADO'){
    sincronizarParcelasLegado();
    const parcelasValidas = _parcelas.filter(pc => parseFloat(pc.valor_usd) > 0);
    if(!parcelasValidas.length){
      showToast('Preencha o Valor USD de ao menos uma parcela para salvar — so o Cambio Fechado nao e suficiente, o Valor USD tambem precisa estar preenchido (ou troque a Forma de Pagamento)','err');
      return;
    }
  }

  // Validação das vendas multi-cliente ANTES de gravar qualquer coisa — sem
  // isso, cliente em branco, item sem quantidade ou sobrevenda (vender mais
  // unidades do que o processo tem) só apareceriam quebrados depois, na aba
  // Fechamento, sem nenhum aviso claro de por que o número está errado.
  if(_vendas.length){
    for(let vi=0; vi<_vendas.length; vi++){
      const v = _vendas[vi];
      if(!v.cliente || !v.cliente.trim()){
        showToast(`Venda ${vi+1}: informe o cliente antes de salvar (ou remova a venda, se não for usar esta aba)`,'err');
        return;
      }
      const itensValidos = (v.itens||[]).filter(it => it.descricao && it.descricao.trim() && parseFloat(it.quantidade) > 0);
      if(!itensValidos.length){
        showToast(`Venda ${vi+1} (${v.cliente}): informe ao menos um item com descrição e quantidade maior que zero`,'err');
        return;
      }
    }
    const totalQtdProc = totalQuantidadeProdutos({..._editando, produtos_json: JSON.stringify(_produtos)});
    const qtdAlocadaVendas = _vendas.reduce((s,v)=> s + (v.itens||[]).reduce((s2,it)=> s2 + (parseFloat(it.quantidade)||0), 0), 0);
    if(totalQtdProc > 0 && qtdAlocadaVendas > totalQtdProc){
      showToast(`As vendas somam ${qtdAlocadaVendas} unidades, mas o processo só tem ${totalQtdProc} — corrija a quantidade de alguma venda antes de salvar (sobrevenda)`,'err');
      return;
    }
  }

  const antigo = {...(_editando||{})};
  const campos = [
    'referencia','finalidade','fornecedor','brand','qtd_containers_prevista','cliente','produto','obs',
    'pi_numero','pi_data','pi_valor_usd','pi_incoterm','pi_pagamento','pi_pago',
    'pi_entrada_pct','pi_prazo_dias','pi_data_entrada','pi_data_saldo',
    'previsao_prontidao','data_prontidao',
    'booking_numero','armador','agente','navio','viagem','valor_frete','moeda_frete','porto_origem','porto_destino',
    'etd','eta','free_time','data_embarque','hbl','mbl','consignatario','notify','container','tipo_container',
    'peso_bruto','volumes','data_chegada','data_presenca','demurrage_vencimento','armazenagem_vencimento',
    'data_registro_di','numero_di','canal','data_parametrizacao','data_liberacao',
    'ci_numero','ci_data','ci_valor_usd',
    'ce_master','ce_house','ce_data_embarque','pendencia_revisao',
    'data_agendamento','data_carregamento','transportadora','placa',
    'horario_retirada','agendamento_cancelado','motivo_cancelamento',
    'nf_entrada_numero','nf_entrada_data','nf_entrada_valor',
    'nf_saida_numero','nf_saida_data','nf_saida_valor','nf_saida_cfop',
    'data_devolucao_vazio','demurrage_valor','armazem',
    'ric_status','depot','data_envio_termo','data_pagamento_lavagem','data_pagamento_demurrage',
    'despachante','pi_cambio','pi_cambio_fechado','pi_cambio_entrada','pi_cambio_saldo','containers_json','produtos_json','vendas_json','pi_parcelas_json',
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
      else if(campo==='pi_pago'||campo==='agendamento_cancelado') val = val==='true';
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

  // Salvar vendas multi-cliente (rateio de custo) e auditar mudança —
  // mesmo padrão de containers_json/produtos_json acima. Vazio (nenhuma
  // venda cadastrada) grava "[]", que calcularVendasResumo/parseVendas em
  // controle-core.js tratam como "processo sem split" — 100% retrocompatível.
  sincronizarVendasLegado();
  const novasVendasJson = JSON.stringify(_vendas);
  if(String(antigo.vendas_json||'')!==novasVendasJson){
    log.push({
      campo:'vendas_json', valor_antes: antigo.vendas_json||'', valor_depois: novasVendasJson,
      usuario: _user.usuario, created_at: new Date().toISOString()
    });
  }
  if(String(original.vendas_json||'')!==novasVendasJson) patchFields.push('vendas_json');
  proc.vendas_json = novasVendasJson;

  // Salvar parcelas do pagamento "Parcelado" e auditar mudança — mesmo
  // padrão de containers_json/vendas_json acima. Só grava de verdade quando
  // a forma de pagamento atual É "Parcelado": trocar pra Vista/Prazo/
  // Entrada+Saldo não deve sobrescrever/apagar parcelas antigas com o
  // conteúdo (possivelmente desatualizado) de _parcelas em memória.
  if(document.getElementById('f_pi_pagamento')?.value === 'PARCELADO'){
    sincronizarParcelasLegado();
    const novasParcelasJson = JSON.stringify(_parcelas);
    if(String(antigo.pi_parcelas_json||'')!==novasParcelasJson){
      log.push({
        campo:'pi_parcelas_json', valor_antes: antigo.pi_parcelas_json||'', valor_depois: novasParcelasJson,
        usuario: _user.usuario, created_at: new Date().toISOString()
      });
    }
    if(String(original.pi_parcelas_json||'')!==novasParcelasJson) patchFields.push('pi_parcelas_json');
    proc.pi_parcelas_json = novasParcelasJson;
  }

  // Alerta de campos-chave nao preenchidos de fases anteriores (pedido Emanuelly, 27/08/2026)
    document.querySelectorAll('.campo-faltando').forEach(el => el.classList.remove('campo-faltando'));
    const faseFaltantes = camposFaseFaltantes(proc);
    if (faseFaltantes.length) {
          faseFaltantes.forEach(f => f.ids.forEach(id => {
                  const el = document.getElementById(id);
                  if (el) el.classList.add('campo-faltando');
          }));
          showToast('⚠️ Campos em branco: ' + faseFaltantes.map(f => f.label).join(' · '), 'warn');
    }
  
    proc.log = log;
  _editando = proc;

  window._salvandoProcesso = true;
  const btnsSalvar = document.querySelectorAll('.btn-primary[onclick="coletarESalvar()"]');
  btnsSalvar.forEach(b=>b.disabled = true);
  salvarProcesso(proc, patchFields).then(ok=>{
    window._salvandoProcesso = false;
    btnsSalvar.forEach(b=>b.disabled = false);
    if(ok) fecharModal();
  }).catch(()=>{
    window._salvandoProcesso = false;
    btnsSalvar.forEach(b=>b.disabled = false);
  });
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
// VENDAS MULTI-CLIENTE (rateio de custo por processo)
// ════════════════════════════════════════════════════════════════
// Um processo (de QUALQUER finalidade — Direto, Encomenda ou Conta e Ordem)
// pode ser vendido pra mais de um cliente — ex.: meio contêiner pra um
// cliente, meio pra outro. Cada venda tem seu próprio cliente, NF Saída
// (número/data/valor) e a quantidade que levou de cada item; controle-core.js
// (calcularRateioVenda/calcularVendasResumo) usa essa quantidade pra ratear
// os custos reais do processo (aba Custos Reais) proporcionalmente entre as
// vendas. Custos que NÃO devem ser rateados — ex.: um frete rodoviário extra
// que só existiu porque um cliente específico pediu entrega em outra cidade
// — entram em "custos_diretos" de cada venda, somados por fora do rateio.
//
// Sem nenhuma venda cadastrada (aba vazia, vendas_json="[]"), o processo
// continua funcionando exatamente como antes: 1 cliente, 1 NF Saída, sem
// rateio nenhum — esta aba é 100% opcional.
let _vendas = []; // [{cliente, itens:[{descricao,quantidade}], nf_saida_numero, nf_saida_data, nf_saida_valor, custos_diretos:[{label,valor}], obs}]

function vendaVazia(){
  return { cliente:'', itens:[{descricao:'', quantidade:''}], nf_saida_numero:'', nf_saida_data:'', nf_saida_valor:'', custos_diretos:[], obs:'' };
}

function renderVendas(){
  const wrap = document.getElementById('vendas-list');
  if(!wrap) return;
  if(!_vendas.length){
    wrap.innerHTML = '<div class="empty"><div class="empty-icon">🧾</div><div class="empty-text">Nenhuma venda cadastrada — se este processo tem um único cliente/NF Saída, não precisa usar esta aba (use o campo Cliente em Identificação e NF Saída em Documentos, normalmente).</div></div>';
    sincronizarVendasLegado();
    renderResumoVendas();
    return;
  }
  wrap.innerHTML = _vendas.map((v,vi)=>{
    const itensHtml = (v.itens||[]).map((it,ii)=>`
      <div style="display:grid;grid-template-columns:1fr 110px 32px;gap:6px;align-items:center;margin-bottom:6px;">
        ${campoDescricaoItemVenda(vi, ii, it)}
        <input class="form-input" type="number" placeholder="Qtde" value="${it.quantidade!=null?it.quantidade:''}"
          oninput="_vendas[${vi}].itens[${ii}].quantidade=this.value;sincronizarVendasLegado();renderResumoVendas()">
        ${(v.itens.length>1) ? `<button type="button" onclick="removerItemVenda(${vi},${ii})" style="background:none;border:none;color:var(--err);cursor:pointer;font-size:16px;padding:0;">✕</button>` : '<div></div>'}
      </div>`).join('');
    const custosHtml = (v.custos_diretos||[]).map((c,ci)=>`
      <div style="display:grid;grid-template-columns:1fr 130px 32px;gap:6px;align-items:center;margin-bottom:6px;">
        <input class="form-input" placeholder="Descrição do custo direto (ex: Frete extra)" value="${esc(c.label||'')}"
          oninput="_vendas[${vi}].custos_diretos[${ci}].label=this.value;sincronizarVendasLegado()">
        <input class="form-input" type="number" step="0.01" placeholder="R$" value="${c.valor!=null?c.valor:''}"
          oninput="_vendas[${vi}].custos_diretos[${ci}].valor=this.value;sincronizarVendasLegado();renderResumoVendas()">
        <button type="button" onclick="removerCustoDiretoVenda(${vi},${ci})" style="background:none;border:none;color:var(--err);cursor:pointer;font-size:16px;padding:0;">✕</button>
      </div>`).join('') || '<div style="font-size:11px;color:var(--dim);margin-bottom:6px;">Nenhum custo direto nesta venda.</div>';
    return `<div style="border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:14px;background:var(--bg);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;">Venda ${vi+1}</div>
        <div style="display:flex;gap:14px;align-items:center;">
          <button type="button" onclick="document.getElementById('nf-import-${vi}').click()" style="background:none;border:none;color:var(--ac);cursor:pointer;font-size:12px;font-weight:600;">📎 Importar NF (XML ou PDF)</button>
          <input type="file" id="nf-import-${vi}" accept=".xml,application/pdf,image/*" style="display:none" onchange="importarNFVenda(${vi},this)">
          <button type="button" onclick="removerVenda(${vi})" style="background:none;border:none;color:var(--err);cursor:pointer;font-size:12px;font-weight:600;">🗑 Remover venda</button>
        </div>
      </div>
      <div class="form-grid" style="margin-bottom:10px;">
        <div class="form-group full" style="position:relative;"><label class="form-label">Cliente</label>
          <input class="form-input" value="${esc(v.cliente||'')}" autocomplete="off" id="venda-cliente-${vi}"
            oninput="_vendas[${vi}].cliente=this.value;sincronizarVendasLegado();autocompletarContato(this,'CLIENTE','venda-cliente-dropdown-${vi}',function(nome){_vendas[${vi}].cliente=nome;sincronizarVendasLegado();renderResumoVendas();})" placeholder="Digite razão social, CNPJ ou cidade...">
          <div id="venda-cliente-dropdown-${vi}" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.1);z-index:500;max-height:220px;overflow-y:auto;"></div>
        </div>
        <div class="form-group"><label class="form-label">Nº NF Saída</label>
          <input class="form-input" value="${esc(v.nf_saida_numero||'')}" oninput="_vendas[${vi}].nf_saida_numero=this.value;sincronizarVendasLegado()"></div>
        <div class="form-group"><label class="form-label">Data NF Saída</label>
          <input class="form-input" type="date" onpaste="colarData(event,this)" value="${esc(v.nf_saida_data||'')}" oninput="_vendas[${vi}].nf_saida_data=this.value;sincronizarVendasLegado()"></div>
        <div class="form-group"><label class="form-label">Valor NF Saída (R$)</label>
          <input class="form-input" type="number" step="0.01" value="${v.nf_saida_valor!=null?v.nf_saida_valor:''}" oninput="_vendas[${vi}].nf_saida_valor=this.value;sincronizarVendasLegado();renderResumoVendas()"></div>
      </div>
      <label class="form-label">Itens vendidos (quantidade alocada a este cliente)</label>
      <div style="margin-bottom:6px;">${itensHtml}</div>
      <button type="button" onclick="adicionarItemVenda(${vi})" style="background:var(--bg);border:1px dashed var(--border);border-radius:6px;padding:5px 12px;font-size:11px;color:var(--ac);cursor:pointer;font-weight:600;margin-bottom:14px;">+ Item</button>
      <label class="form-label">Custos diretos desta venda (não rateados — ex.: frete extra só deste cliente)</label>
      <div style="margin-bottom:6px;">${custosHtml}</div>
      <button type="button" onclick="adicionarCustoDiretoVenda(${vi})" style="background:var(--bg);border:1px dashed var(--border);border-radius:6px;padding:5px 12px;font-size:11px;color:var(--ac);cursor:pointer;font-weight:600;">+ Custo direto</button>
    </div>`;
  }).join('');
  sincronizarVendasLegado();
  renderResumoVendas();
}

function adicionarVenda(){
  _vendas.push(vendaVazia());
  renderVendas();
}

function removerVenda(vi){
  const v = _vendas[vi] || {};
  // Só pede confirmação se a venda já tem algo digitado — uma venda recém
  // adicionada e ainda vazia (clique errado em "+ Adicionar Venda") pode
  // sumir direto, sem incomodar o usuário com um confirm() desnecessário.
  const temDados = !!(
    (v.cliente && v.cliente.trim()) ||
    (v.nf_saida_numero && v.nf_saida_numero.trim()) ||
    (v.nf_saida_valor !== '' && v.nf_saida_valor != null) ||
    (v.itens||[]).some(it => (it.descricao && it.descricao.trim()) || (it.quantidade !== '' && it.quantidade != null)) ||
    (v.custos_diretos||[]).length
  );
  if(temDados && !confirm(`Remover a venda ${vi+1}${v.cliente?' ('+v.cliente+')':''}? Os dados digitados nela serão perdidos (isso só é gravado de verdade quando você clicar em Salvar).`)) return;
  _vendas.splice(vi,1);
  renderVendas();
}

function produtosDoMixVenda(){
  if(!_editando || !_editando.produtos_json) return [];
  try{
    const arr = JSON.parse(_editando.produtos_json);
    if(!Array.isArray(arr)) return [];
    const seen = {}; const out = [];
    arr.forEach(function(it){
      if(!it || !it.descricao) return;
      const k = String(it.descricao).trim().toUpperCase().replace(/\s+/g,' ');
      if(!k || seen[k]) return;
      seen[k] = true;
      out.push(it.descricao);
    });
    return out;
  }catch(e){ return []; }
}

function campoDescricaoItemVenda(vi, ii, it){
  const produtos = produtosDoMixVenda();
  const norm = function(s){ return String(s||'').trim().toUpperCase().replace(/\s+/g,' '); };
  const normAtual = norm(it.descricao);
  const existeNoMix = produtos.some(function(p){ return norm(p) === normAtual; });
  const manual = it._manual || (!!it.descricao && !existeNoMix) || !produtos.length;
  if(manual){
    return '<div style="display:flex;gap:4px;align-items:center;">'
      + '<input class="form-input" placeholder="Descri\u00e7\u00e3o do item vendido" value="' + esc(it.descricao||'') + '"'
      + ' oninput="_vendas[' + vi + '].itens[' + ii + '].descricao=this.value;sincronizarVendasLegado()" style="flex:1;">'
      + (produtos.length ? ('<button type="button" title="Escolher da lista de produtos" onclick="_vendas[' + vi + '].itens[' + ii + ']._manual=false;renderVendas()" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:14px;padding:0 4px;">\uD83D\uDCCB</button>') : '')
      + '</div>';
  }
  const options = produtos.map(function(p){
    return '<option value="' + esc(p) + '"' + (norm(p)===normAtual ? ' selected' : '') + '>' + esc(p) + '</option>';
  }).join('');
  return '<select class="form-input" style="flex:1;" onchange="if(this.value===\'__outro__\'){_vendas[' + vi + '].itens[' + ii + ']._manual=true;_vendas[' + vi + '].itens[' + ii + '].descricao=\'\';}else{_vendas[' + vi + '].itens[' + ii + '].descricao=this.value;}sincronizarVendasLegado();renderVendas()">'
    + '<option value="">Selecione um produto...</option>'
    + options
    + '<option value="__outro__">Outro (digitar manualmente)</option>'
    + '</select>';
}
function adicionarItemVenda(vi){
  _vendas[vi].itens.push({descricao:'', quantidade:''});
  renderVendas();
}

function removerItemVenda(vi,ii){
  _vendas[vi].itens.splice(ii,1);
  if(!_vendas[vi].itens.length) _vendas[vi].itens = [{descricao:'', quantidade:''}];
  renderVendas();
}

function adicionarCustoDiretoVenda(vi){
  if(!_vendas[vi].custos_diretos) _vendas[vi].custos_diretos = [];
  _vendas[vi].custos_diretos.push({label:'', valor:''});
  renderVendas();
}

function removerCustoDiretoVenda(vi,ci){
  _vendas[vi].custos_diretos.splice(ci,1);
  renderVendas();
}

function sincronizarVendasLegado(){
  const input = document.getElementById('f_vendas_json');
  if(input) input.value = JSON.stringify(_vendas);
}

// Resumo ao vivo (sem precisar salvar) de rateio/lucro por venda — mesmo
// padrão de atualizarTotalCustosReais() em controle-modal.js: recalcula a
// cada tecla usando _editando + o que está digitado AGORA nos campos da aba
// Custos Reais (não obriga salvar aquela aba primeiro só pra ver o resumo
// aqui). Cálculo de verdade em calcularVendasResumo (controle-core.js).
function renderResumoVendas(){
  const wrap = document.getElementById('vendas-resumo');
  if(!wrap || !_editando) return;
  if(!_vendas.length){ wrap.innerHTML = ''; return; }
  const r2 = v => v==null ? '—' : 'R$ ' + v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const cambio = typeof coletarCambioCustosReaisDoForm === 'function' ? coletarCambioCustosReaisDoForm() : _editando.real_cambio;
  const realJson = typeof coletarCustosReaisDoForm === 'function' ? coletarCustosReaisDoForm() : (_editando.real_json||{});
  const snapshot = { ..._editando, real_json: realJson, real_cambio: cambio, vendas_json: JSON.stringify(_vendas) };
  const resumo = calcularVendasResumo(snapshot);
  if(!resumo){ wrap.innerHTML = ''; return; }
  const linhasHtml = resumo.linhas.map((l,i)=>`
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;">
      <span style="color:var(--muted);">${esc(l.venda.cliente||('Venda '+(i+1)+' — sem cliente'))} — ${l.qtdVenda||0} un. (${(l.fracao*100).toFixed(1)}% do processo)</span>
      <strong style="color:${l.lucro==null?'var(--muted)':l.lucro>=0?'var(--ok)':'var(--err)'}">${l.temNf?r2(l.lucro):'aguardando NF'}</strong>
    </div>`).join('');
  const saldo = resumo.saldoNaoAlocado;
  const alertaSaldo = Math.abs(saldo) > 0.001
    ? `<div style="margin-top:8px;font-size:11px;color:${saldo>0?'#f39c12':'var(--err)'};">⚠ ${saldo>0 ? `Ainda faltam ${saldo} un. sem venda alocada (de ${resumo.totalQtd} do processo).` : `Alocado ${Math.abs(saldo)} un. a mais do que o processo tem (${resumo.totalQtd}).`}${(saldo>0 && resumo.itensFaltantes && resumo.itensFaltantes.length) ? `<ul style="margin:6px 0 0 18px;padding:0;">${resumo.itensFaltantes.map(it => `<li>${esc(it.descricao)}: ${it.quantidade}</li>`).join('')}</ul>` : ''}</div>`
    : '';
  wrap.innerHTML = `<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-top:6px;">
    <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:6px;">Resumo por venda (rateio automático dos Custos Reais + custos diretos)</div>
    ${linhasHtml}
    ${resumo.todasComNf ? `<div style="display:flex;justify-content:space-between;padding-top:8px;margin-top:4px;border-top:1px solid var(--border);font-weight:700;font-size:12px;"><span>Lucro total do processo (soma das vendas)</span><span style="color:${resumo.lucroTotal>=0?'var(--ok)':'var(--err)'}">${r2(resumo.lucroTotal)}</span></div>` : '<div style="font-size:11px;color:var(--dim);margin-top:6px;">Preencha a NF Saída de cada venda pra ver o lucro total.</div>'}
    ${alertaSaldo}
  </div>`;
}

// ════════════════════════════════════════════════════════════════
// PARCELAS DO PAGAMENTO "PARCELADO" (N câmbios por processo)
// ════════════════════════════════════════════════════════════════
// Substitui "Entrada + Saldo" (fixo em 2 parcelas por %) pra pedidos que têm
// mais de 2 câmbios — ex.: um na confirmação do pedido, outro no embarque,
// outro na chegada. Cada parcela tem valor FIXO em USD (não %, ver decisão
// no commit) + etapa/rótulo livre + vencimento + câmbio fechado (null =
// ainda não paga). Mesmo padrão de _containers/_produtos/_vendas acima:
// estado numa variável global porque as linhas são adicionadas/removidas
// dinamicamente com um botão "+".
let _parcelas = []; // [{label, valor_usd, data_vencimento, cambio_fechado, valor_recebido_cliente, data_recebimento}]

// Etapas fixas — antes era texto livre, mas na prática só existem estes 4
// momentos de câmbio no fluxo de importação. Fixar evita rótulos
// inconsistentes (ex: "Pré embarque" vs "Pre-embarque" vs "Embarque").
const PARCELA_ETAPAS = ['Inicial', 'Pré-embarque', 'Final', 'Ajuste de câmbio'];

function parcelaVazia(){ return { label:'', valor_usd:'', data_vencimento:'', cambio_fechado:'', valor_recebido_cliente:'', data_recebimento:'' }; }

function renderParcelas(){
  const wrap = document.getElementById('parcelas-list');
  if(!wrap) return;
  if(!_parcelas.length) _parcelas = [parcelaVazia(), parcelaVazia()];
  wrap.innerHTML = _parcelas.map((pc,i)=>`
    <div style="border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:6px;">
      <div style="display:grid;grid-template-columns:1.3fr 1fr 1fr 1fr 32px;gap:6px;align-items:center;margin-bottom:6px;">
        <select class="form-input" onchange="_parcelas[${i}].label=this.value;sincronizarParcelasLegado()">
          <option value="">Etapa...</option>
          ${PARCELA_ETAPAS.map(et=>`<option value="${esc(et)}" ${pc.label===et?'selected':''}>${esc(et)}</option>`).join('')}
        </select>
        <input class="form-input" type="number" step="0.01" placeholder="Valor USD" value="${pc.valor_usd!=null?pc.valor_usd:''}"
          oninput="_parcelas[${i}].valor_usd=this.value;sincronizarParcelasLegado();renderPagamentoInfoLive()">
        <input class="form-input" type="date" onpaste="colarData(event,this)" value="${esc(pc.data_vencimento||'')}"
          oninput="_parcelas[${i}].data_vencimento=this.value;sincronizarParcelasLegado()">
        <input class="form-input" type="number" step="0.0001" placeholder="Câmbio fechado" value="${pc.cambio_fechado!=null?pc.cambio_fechado:''}"
          oninput="_parcelas[${i}].cambio_fechado=this.value;sincronizarParcelasLegado();renderPagamentoInfoLive()">
        ${_parcelas.length>1
          ? `<button type="button" onclick="removerParcela(${i})" style="background:none;border:none;color:var(--err);cursor:pointer;font-size:16px;padding:0;">✕</button>`
          : '<div></div>'}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 32px;gap:6px;align-items:center;">
        <input class="form-input" type="number" step="0.01" placeholder="Valor recebido do cliente (USD)" value="${pc.valor_recebido_cliente!=null?pc.valor_recebido_cliente:''}"
          oninput="_parcelas[${i}].valor_recebido_cliente=this.value;sincronizarParcelasLegado()">
        <input class="form-input" type="date" onpaste="colarData(event,this)" value="${esc(pc.data_recebimento||'')}" title="Data do recebimento do cliente"
          oninput="_parcelas[${i}].data_recebimento=this.value;sincronizarParcelasLegado()">
        <div></div>
      </div>
    </div>
  `).join('');
  sincronizarParcelasLegado();
}

function adicionarParcela(){
  _parcelas.push(parcelaVazia());
  renderParcelas();
  renderPagamentoInfoLive();
}

function removerParcela(i){
  _parcelas.splice(i,1);
  if(!_parcelas.length) _parcelas = [parcelaVazia()];
  renderParcelas();
  renderPagamentoInfoLive();
}

function sincronizarParcelasLegado(){
  const input = document.getElementById('f_pi_parcelas_json');
  if(input) input.value = JSON.stringify(_parcelas);
}

// ════════════════════════════════════════════════════════════════
// RELATÓRIO COM FILTROS
// ════════════════════════════════════════════════════════════════
function esc(v){ return v ? String(v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }

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
  // Se a Forma de Pagamento atual e "Parcelado", mostra um botao por
  // parcela (pelo rotulo da Etapa) em vez das opcoes fixas de
  // Unico/Entrada/Saldo -- o usuario escolhe explicitamente a qual
  // parcela esse comprovante se refere (pedido direto da Emanuelly,
  // que queria escolher a etapa igual escolhe a NF na aba Vendas).
  const formaPagamento = document.getElementById('f_pi_pagamento')?.value;
  const boxParcelas = document.getElementById('cambio-modal-parcelas');
  const boxLegado = document.getElementById('cambio-modal-botoes-legado');
  if(formaPagamento==='PARCELADO' && boxParcelas && boxLegado){
    boxLegado.style.display = 'none';
    boxParcelas.style.display = 'flex';
    if(!_parcelas.length){
      boxParcelas.innerHTML = '<p style="font-size:12px;color:var(--muted);">Nenhuma parcela cadastrada ainda — adicione uma parcela na aba Financeiro antes de confirmar este comprovante.</p>';
    } else {
      boxParcelas.innerHTML = _parcelas.map((p,i)=>{
        const label = p.label || ('Parcela ' + (i+1));
        const jaTemCambio = p.cambio_fechado ? (' (câmbio atual: ' + p.cambio_fechado + ')') : '';
        return '<button class="btn btn-outline" onclick="confirmarCambioParcela(' + i + ')">' + esc(label) + jaTemCambio + '</button>';
      }).join('');
    }
  } else if(boxParcelas && boxLegado){
    boxParcelas.style.display = 'none';
    boxLegado.style.display = 'flex';
  }
  document.getElementById('modal-cambio-bg')?.classList.add('open');
}

// Aplica o cambio confirmado do comprovante numa parcela especifica,
// escolhida explicitamente pelo usuario no modal (em vez de tentar
// adivinhar qual parcela esta pendente).
function confirmarCambioParcela(idx){
  if(!_cambioPendente){ fecharModalCambio(); return; }
  const taxa = parseFloat(_cambioPendente.taxa_cambio) || 0;
  if(!taxa){ showToast('Taxa de câmbio inválida no comprovante','err'); fecharModalCambio(); return; }
  if(!_parcelas[idx]){ fecharModalCambio(); return; }
  _parcelas[idx].cambio_fechado = taxa.toFixed(4);
  // Preenche Valor USD e Data também a partir do comprovante — sem isso só a
  // taxa de câmbio era gravada e o usuário tinha que digitar o resto na mão
  // de novo (reclamação da Emanuelly: "só salva o câmbio"). Só preenche se o
  // campo ainda estiver vazio, pra nunca sobrescrever o que o usuário já digitou.
  const valorPagoP = parseFloat(_cambioPendente.valor_pago) || 0;
  if(!_parcelas[idx].valor_usd && valorPagoP && taxa){
    _parcelas[idx].valor_usd = (valorPagoP/taxa).toFixed(2);
  }
  if(!_parcelas[idx].data_vencimento && _cambioPendente.data_pagamento){
    _parcelas[idx].data_vencimento = _cambioPendente.data_pagamento;
  }
  renderParcelas();
  renderPagamentoInfoLive();
  const label = _parcelas[idx].label || ('Parcela ' + (idx+1));
  showToast('✓ Câmbio (' + taxa.toLocaleString('pt-BR',{minimumFractionDigits:4}) + ') aplicado em "' + label + '"','ok');
  fecharModalCambio();
}

function fecharModalCambio(){
  document.getElementById('modal-cambio-bg')?.classList.remove('open');
  _cambioPendente = null;
}

// Aplica um câmbio confirmado (de comprovante) numa parcela do fluxo
// "Parcelado" em vez de forçar a Forma de Pagamento pra "Entrada + Saldo
// (legado)". Usa a primeira parcela que ainda não tem Câmbio Fechado
// preenchido; se todas já estiverem completas, cria uma parcela nova pra
// não sobrescrever um câmbio que o usuário já tinha confirmado antes.
// Só mexe em cambio_fechado — os campos de "Valor recebido do cliente" são
// de outro fluxo (repasse do cliente) e não têm relação com o câmbio pago
// ao fornecedor.
function aplicarCambioNaParcelaPendente(taxa){
  let idx = _parcelas.findIndex(pc => !pc.cambio_fechado);
  if(idx===-1){
    adicionarParcela(); // já chama renderParcelas()+renderPagamentoInfoLive()
    idx = _parcelas.length - 1;
  }
  _parcelas[idx].cambio_fechado = taxa.toFixed(4);
  // Mesma correção do confirmarCambioParcela: também preenche Valor USD e
  // Data do comprovante quando ainda estiverem vazios (não sobrescreve o
  // que o usuário já preencheu).
  const valorPagoP2 = parseFloat(_cambioPendente?.valor_pago) || 0;
  if(!_parcelas[idx].valor_usd && valorPagoP2 && taxa){
    _parcelas[idx].valor_usd = (valorPagoP2/taxa).toFixed(2);
  }
  if(!_parcelas[idx].data_vencimento && _cambioPendente?.data_pagamento){
    _parcelas[idx].data_vencimento = _cambioPendente.data_pagamento;
  }
  renderParcelas();
  renderPagamentoInfoLive();
  return idx;
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
  } else if(tipo==='entrada' || tipo==='saldo'){
    const selPagamento = document.getElementById('f_pi_pagamento');
    if(selPagamento && selPagamento.value==='PARCELADO'){
      const idx = aplicarCambioNaParcelaPendente(taxa);
      showToast(`✓ Câmbio (${taxa.toLocaleString('pt-BR',{minimumFractionDigits:4})}) aplicado na Parcela ${idx+1}`,'ok');
      fecharModalCambio();
      return;
    }
    if(selPagamento && selPagamento.value!=='ENTRADA_SALDO'){ selPagamento.value = 'ENTRADA_SALDO'; renderPagamentoCampos(); }
    if(tipo==='entrada'){
      const el = document.getElementById('f_pi_cambio_entrada');
      if(el){ el.value = taxa.toFixed(4); }
      const elData = document.getElementById('f_pi_data_entrada');
      if(elData) elData.value = dataPagamento;
    } else {
      const el = document.getElementById('f_pi_cambio_saldo');
      if(el){ el.value = taxa.toFixed(4); }
      const elData = document.getElementById('f_pi_data_saldo');
      if(elData) elData.value = dataPagamento;
      const elPago = document.getElementById('f_pi_pago');
      if(elPago) elPago.value = 'true';
    }
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


// === Devolucao de vazio por container (extensao da lista de containers) ===
(function(){
  if (typeof renderMultiContainers === 'function') {
    var _origRenderMultiContainers = renderMultiContainers;
    renderMultiContainers = function(){
      _origRenderMultiContainers();
      renderDevolucoesPorContainer();
    };
  }
})();

function renderDevolucoesPorContainer(){
  var box = document.getElementById('container-devolucoes-list');
  if(!box) return;
  if(!_containers || !_containers.length){ box.innerHTML=''; return; }
  box.innerHTML = '<label class="form-label" style="margin-top:10px;display:block;">Devolu\u00e7\u00e3o de Vazio (por container)</label>' +
    _containers.map(function(c,i){
      var num = (c.numero||'').trim();
      var label = num ? num : ('Container ' + (i+1));
      return '<div style="display:grid;grid-template-columns:1fr 160px;gap:6px;align-items:center;margin-bottom:6px;">' +
        '<span style="font-size:12px;color:var(--dim);">' + escContainerLocal(label) + '</span>' +
        '<input class="form-input" type="date" value="' + escContainerLocal(c.devolucao||'') + '" ' +
        'oninput="_containers[' + i + '].devolucao=this.value">' +
        '</div>';
    }).join('');
}

function escContainerLocal(s){
  return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
