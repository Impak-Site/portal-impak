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
// vs Navegantes-SC...). Destino usa os MESMOS códigos do Calculador
// (armazenagem por porto) — mantém os dois sistemas 100% consistentes.
//
// Desde 01/10/2026 (cadastros fase 1b) estas listas vêm do banco
// (cadastros_listas, editável em /cadastros → Listas) via GET /api/listas —
// ver carregarListas()/aplicarListas() no fim desta seção. O que está aqui
// é só o PADRÃO embutido (listas-padrao.js, mesmo arquivo que o servidor
// usa), usado até a resposta chegar ou se ela falhar. As constantes são
// atualizadas "no lugar" (mesmo array/objeto), então todo código que já
// referencia PORTOS_DESTINO/PORTOS_ORIGEM/PORTO_ARMAZENAGEM_FREE_DIAS/
// PORTO_PAIS/BANCOS_CAMBIO continua funcionando sem mudar nada.
const _LISTAS_INICIAIS = (typeof ListasPadrao !== 'undefined') ? ListasPadrao.listasPadrao() : { porto_destino: [], porto_origem: [], banco_cambio: [] };
const PORTOS_DESTINO = [];          // [{codigo, nome, sinonimos}]
// Dias de armazenagem grátis (1º período) no porto por código de destino —
// depois desse prazo a partir da Presença de Carga (chegada física da carga
// no terminal, não a atracação do navio), o porto passa a cobrar armazenagem
// adicional. Pedido da Emanuelly (03/09/2026): Navegantes = 5 dias, Itapoá =
// 4 dias; Itajaí e Imbituba provisórios (5) até confirmar com o terminal.
// Agora editável em /cadastros → Listas → Portos de destino.
const PORTO_ARMAZENAGEM_FREE_DIAS = {};
// Origem varia mais (várias cidades/países), então fica uma lista das mais
// usadas + "Outro" pra digitar livre quando aparecer uma nova.
const PORTOS_ORIGEM = [];           // ['SHANGHAI', 'NINGBO', ...] (códigos)
// Mapa porto de origem → país — usado no Dashboard Financeiro pra mostrar de
// qual país cada pagamento é (reusa o porto de origem do processo).
const PORTO_PAIS = {};
// Contas da própria Impak usadas pra fechar câmbio (pedido Ayslan, 17/09/2026).
// Agência/conta/PIX ficam só no banco (aba Listas), não no código.
const BANCOS_CAMBIO = [];           // [{nome, codigo, codigo_banco, agencia, conta, pix}]
let _listasOrigem = 'padrao';       // 'padrao' | 'banco' — de onde vieram as listas atuais
let _listasCompletas = _LISTAS_INICIAIS; // objeto cru de /api/listas (usado pela aba Listas)

function aplicarListas(listas){
  if(!listas) return;
  _listasCompletas = listas;
  if(Array.isArray(listas.porto_destino) && listas.porto_destino.length){
    PORTOS_DESTINO.length = 0;
    Object.keys(PORTO_ARMAZENAGEM_FREE_DIAS).forEach(k=>{ delete PORTO_ARMAZENAGEM_FREE_DIAS[k]; });
    listas.porto_destino.filter(p=>p.ativo!==false).forEach(p=>{
      PORTOS_DESTINO.push({ codigo:p.codigo, nome:p.nome, sinonimos:(p.sinonimos||[]).slice() });
      const d = p.dados && p.dados.dias_gratis;
      if(d!==undefined && d!==null && d!=='' && !isNaN(parseInt(d,10))) PORTO_ARMAZENAGEM_FREE_DIAS[p.codigo] = parseInt(d,10);
    });
  }
  if(Array.isArray(listas.porto_origem) && listas.porto_origem.length){
    PORTOS_ORIGEM.length = 0;
    Object.keys(PORTO_PAIS).forEach(k=>{ delete PORTO_PAIS[k]; });
    listas.porto_origem.filter(p=>p.ativo!==false).forEach(p=>{
      PORTOS_ORIGEM.push(p.codigo);
      if(p.dados && p.dados.pais) PORTO_PAIS[p.codigo] = p.dados.pais;
    });
  }
  if(Array.isArray(listas.banco_cambio) && listas.banco_cambio.length){
    BANCOS_CAMBIO.length = 0;
    listas.banco_cambio.filter(b=>b.ativo!==false).forEach(b=>{
      BANCOS_CAMBIO.push(Object.assign({ nome:b.nome, codigo:b.codigo }, b.dados||{}));
    });
  }
}
aplicarListas(_LISTAS_INICIAIS);

// Busca as listas do banco (GET /api/listas). Chamado no boot (controle-core.js)
// em paralelo com /api/me; se falhar, fica o padrão embutido.
async function carregarListas(){
  try{
    const r = await fetch('/api/listas');
    const d = await r.json();
    if(d && d.ok && d.listas){ aplicarListas(d.listas); _listasOrigem = d.origem || 'banco'; }
  }catch(e){ /* mantém o padrão embutido */ }
  return _listasCompletas;
}

// Sinônimo → código, montado a partir das listas (normalização no front).
function _apelidosPortoDestino(){
  const m = {};
  PORTOS_DESTINO.forEach(p=>{
    (p.sinonimos||[]).forEach(s=>{ m[String(s).trim().toUpperCase()] = p.codigo; });
    m[String(p.nome).trim().toUpperCase()] = p.codigo;
  });
  // Apelidos históricos (continuam valendo mesmo se alguém apagar o sinônimo da lista)
  Object.assign(m, { 'NAVEGANTES':'NVT', 'ITAJAI':'ITJ', 'ITAJAÍ':'ITJ', 'ITAPOA':'IOA', 'ITAPOÁ':'IOA', 'PORTONAVE':'NVT', 'IMBITUBA':'BRIBB' });
  return m;
}
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
  const APELIDOS = _apelidosPortoDestino();
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
  const APELIDOS = _apelidosPortoDestino();
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

// Pedido da Emanuelly (21/09/2026): o campo de digitar "Outro" aparecia
// embaixo do dropdown (os dois visíveis juntos), crescendo a altura só
// daquele campo e desalinhando a grade do formulário. Agora troca um pelo
// outro no mesmo lugar -- esconde o select e mostra o input na hora de
// escolher "Outro"; voltarPortoLista() (botão "↺ lista" dentro do campo)
// faz o caminho inverso sem precisar apagar o texto digitado na mão.
function togglePortoOutro(tipo){
  const sel = document.getElementById('f_porto_'+tipo);
  const outro = document.getElementById('f_porto_'+tipo+'_outro');
  const voltar = document.getElementById('f_porto_'+tipo+'_voltar');
  if(!sel || !outro) return;
  const usarOutro = sel.value === 'OUTRO';
  sel.style.display = usarOutro ? 'none' : '';
  outro.style.display = usarOutro ? 'block' : 'none';
  if(voltar) voltar.style.display = usarOutro ? 'inline-block' : 'none';
  if(usarOutro) outro.focus();
}
function voltarPortoLista(tipo){
  const sel = document.getElementById('f_porto_'+tipo);
  const outro = document.getElementById('f_porto_'+tipo+'_outro');
  const voltar = document.getElementById('f_porto_'+tipo+'_voltar');
  if(!sel || !outro) return;
  outro.value = '';
  outro.style.display = 'none';
  if(voltar) voltar.style.display = 'none';
  sel.style.display = '';
  sel.value = '';
  sel.focus();
}

// opts.fecharAoSalvar (default true) -- quando false, salva mas NÃO fecha o
// painel do processo. Usado pelo preenchimento automático pós-Conferência
// (controle-conferencia.js/_confTentarPreencherAutomatico), que roda em
// segundo plano sem o usuário clicar em Salvar -- fechar o painel sozinho
// nesse caso parecia bug pro usuário ("ele só fecha do nada", Emanuelly
// 16/09/2026). Desde 18/09/2026 (pedido do Ayslan: "quando apertamos o
// salvar, o processo fecha sozinho, pq?"), o botão "Salvar" TAMBÉM passou a
// chamar coletarESalvar({fecharAoSalvar:false}) -- grava e avisa por toast,
// mas mantém o painel aberto pra continuar editando outras abas do mesmo
// processo, em vez de fechar e voltar pra lista a cada clique.
function coletarESalvar(opts){
  const fecharAoSalvar = !(opts && opts.fecharAoSalvar === false);
  if(window._salvandoProcesso) return;
  const eraNovo = !(_editando && _editando.id);
  const ref = document.getElementById('f_referencia')?.value?.trim();
  if(!ref){ showToast('Informe a Referência','err'); return; }

  // Validação das parcelas do pagamento "Parcelado" — mesma ideia da
  // validação de vendas logo abaixo: barrar ANTES de gravar, não deixar
  // parcela sem valor virar um "USD 0,00" silencioso no Financeiro.
  if(document.getElementById('f_pi_pagamento')?.value === 'PARCELADO'){
    completarSaldoParcelas();
    sincronizarParcelasLegado();
    // Bloqueia só o caso perigoso: câmbio fechado SEM valor (viraria US$ 0
    // no Financeiro). Parcelas totalmente em branco podem ser salvas (ex.:
    // limpar tudo pra reler os comprovantes — Ayslan 29/09/2026); o aviso
    // "Parcelas somam X e a PI é Y" continua aparecendo.
    const cambioSemValor = _parcelas.map((pc,i)=>({pc,i})).filter(({pc}) => String(pc.cambio_fechado||'').trim() && !(parseFloat(pc.valor_usd) > 0));
    if(cambioSemValor.length){
      const nomes = cambioSemValor.map(({pc,i}) => '"' + (pc.label || ('Parcela ' + (i+1))) + '"').join(', ');
      showToast('A parcela ' + nomes + ' tem Câmbio Fechado mas está sem Valor USD. Preencha o valor ou apague o câmbio (ou use "Limpar parcelas").','err');
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
      if(ehCfopSemVenda(v.nf_saida_cfop)) continue; // remessa (5905) / retorno (5907) não é venda — não exige cliente/itens
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
    // Só vendas de verdade — a remessa p/ estoque (CFOP 5905) leva as mesmas
    // unidades que depois são vendidas; somar as duas seria duplicar.
    const qtdAlocadaVendas = _vendas.filter(v=>!ehCfopSemVenda(v.nf_saida_cfop)).reduce((s,v)=> s + (v.itens||[]).reduce((s2,it)=> s2 + (parseFloat(it.quantidade)||0), 0), 0);
    // Mesma NF cadastrada duas vezes = duplicidade.
    const numsNF = _vendas.map(v=>String(v.nf_saida_numero||'').replace(/\D/g,'').replace(/^0+/,'')).filter(Boolean);
    const dupNF = numsNF.find((n,i)=>numsNF.indexOf(n)!==i);
    if(dupNF){
      showToast(`A NF ${dupNF} está cadastrada em duas vendas — remova a duplicada antes de salvar`,'err');
      return;
    }
    if(totalQtdProc > 0 && qtdAlocadaVendas > totalQtdProc){
      showToast(`As vendas somam ${qtdAlocadaVendas} unidades, mas o processo só tem ${totalQtdProc} — corrija a quantidade de alguma venda antes de salvar (sobrevenda)`,'err');
      return;
    }
  }

  const antigo = {...(_editando||{})};
  const campos = [
    'referencia','finalidade','fornecedor','brand','conexos_id','qtd_containers_prevista','cliente','produto','obs',
    'pi_numero','pi_data','pi_valor_usd','pi_incoterm','pi_pagamento','pi_pago',
    'pi_entrada_pct','pi_prazo_dias','pi_data_entrada','pi_data_saldo',
    'pi_valor_recebido_cliente','pi_data_recebimento',
    'previsao_prontidao','data_prontidao',
    'booking_numero','armador','agente','navio','viagem','valor_frete','moeda_frete','porto_origem','porto_destino',
    'etd','eta','free_time','data_embarque','hbl','mbl','consignatario','notify','container','tipo_container',
    'aprovacao_hbl','solicitacao_li','docs_enviados_despachante',
    'semana_booking','etiquetas_manuais_json',
    'peso_bruto','volumes','data_chegada','data_presenca','demurrage_vencimento','armazenagem_vencimento',
    'data_registro_di','numero_di','di_peso_liquido','di_ncms','canal','data_parametrizacao','data_liberacao',
    'ci_numero','ci_data','ci_valor_usd',
    'ce_master','ce_house','ce_data_embarque','pendencia_revisao',
    'data_agendamento','data_carregamento','transportadora','placa',
    'horario_retirada','agendamento_cancelado','motivo_cancelamento',
    'nf_entrada_numero','nf_entrada_data','nf_entrada_valor',
    'nf_saida_numero','nf_saida_data','nf_saida_valor','nf_saida_cfop',
    'data_devolucao_vazio','demurrage_valor','armazem',
    'ric_status','depot','data_solicitacao_demurrage','data_isencao_demurrage','data_envio_termo','data_pagamento_lavagem','data_pagamento_demurrage',
    'despachante','pi_cambio','pi_cambio_fechado','pi_cambio_entrada','pi_cambio_saldo','pi_cambio_banco','pi_cambio_custo','pi_cambio_codigo_bacen','pi_venc_di','pi_duimp_numero','pi_duimp_protocolo','containers_json','produtos_json','vendas_json','pi_parcelas_json',
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
  const camposMoeda = ['pi_valor_usd','ci_valor_usd','demurrage_valor','nf_entrada_valor','nf_saida_valor','valor_frete','pi_cambio_custo','pi_valor_recebido_cliente','di_peso_liquido'];

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

  // Salvar Custos Reais (real_json/real_cambio) mesmo quando quem salvou foi
  // o botão Salvar GERAL, não o botão próprio da aba Custos Reais (bug
  // reportado pela Emanuelly, 18/09/2026 — ver comentário acima). Mesmo
  // padrão de containers_json/vendas_json: só entra no patch se mudou.
  if(typeof coletarCustosReaisDoForm === 'function'){
    const novoRealJson = coletarCustosReaisDoForm();
    const novoRealJsonStr = JSON.stringify(novoRealJson);
    const antigoRealJsonStr = JSON.stringify(antigo.real_json || {});
    if(antigoRealJsonStr !== novoRealJsonStr){
      log.push({
        campo:'real_json', valor_antes: antigoRealJsonStr, valor_depois: novoRealJsonStr,
        usuario: _user.usuario, created_at: new Date().toISOString()
      });
    }
    const originalRealJsonStr = JSON.stringify(original.real_json || {});
    if(originalRealJsonStr !== novoRealJsonStr) patchFields.push('real_json');
    proc.real_json = novoRealJson;

    const novoRealCambio = typeof coletarCambioCustosReaisDoForm === 'function' ? coletarCambioCustosReaisDoForm() : null;
    if(String(original.real_cambio||'') !== String(novoRealCambio||'')) patchFields.push('real_cambio');
    proc.real_cambio = novoRealCambio;
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
  const btnsSalvar = document.querySelectorAll('.btn-primary[onclick^="coletarESalvar("]');
  btnsSalvar.forEach(b=>b.disabled = true);
  salvarProcesso(proc, patchFields).then(ok=>{
    window._salvandoProcesso = false;
    btnsSalvar.forEach(b=>b.disabled = false);
    if(ok && fecharAoSalvar) fecharModal();
    else if(ok && eraNovo && _editando && _editando.id && typeof abrirProcesso === 'function'){
      // Processo NOVO salvo com o painel aberto (06/10/2026): as abas que
      // dependem do processo já existir (Conferência, Arquivos/GED,
      // Histórico) foram desenhadas quando ele ainda não tinha id e
      // continuavam dizendo "Salve o processo..." até recarregar a página.
      // Reabre o painel já como processo gravado, na mesma aba.
      const abaAtiva = (document.querySelector('.modal-tab.active')?.id || '').replace(/^tab-/, '');
      showToast('✓ Processo salvo', 'ok');
      abrirProcesso(_editando.id).then(() => { if(abaAtiva && typeof trocarAba === 'function') trocarAba(abaAtiva); }).catch(()=>{});
    }
    else if(ok){
      showToast('✓ Processo salvo', 'ok');
      // Painel continua aberto: atualiza o selo da fase e a linha do tempo
      // com o que acabou de ser gravado (antes ficavam como estavam ao abrir —
      // PVN2602-10, 05/10/2026: gravou como Finalizado mas o painel seguia
      // mostrando "Dev. Vazio").
      try{ if(typeof atualizarFaseEmTempoReal === 'function') atualizarFaseEmTempoReal(); }catch(e){}
    }
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
      <select class="form-input" onchange="_containers[${i}].tipo=this.value;sincronizarContainerLegado();atualizarFaseEmTempoReal()">
        <option value="20GP" ${c.tipo==='20GP'?'selected':''}>20GP</option>
        <option value="40GP" ${c.tipo==='40GP'?'selected':''}>40GP</option>
        <option value="40HC" ${(!c.tipo||c.tipo==='40HC')?'selected':''}>40HC</option>
        <option value="40NOR" ${c.tipo==='40NOR'?'selected':''}>40NOR</option>
        <option value="LCL" ${c.tipo==='LCL'?'selected':''} title="Carga consolidada: sem devolução de container (Emanuelly 05/10/2026)">LCL</option>
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
  _painelDirty = true; // ação via clique/JS não dispara 'input'/'change' nativo -- marca sujo manualmente (ver ESC em controle-core.js)
  _containers.push({numero:'', tipo:'40HC', lacre:''});
  renderMultiContainers();
}

function removerContainer(i){
  _painelDirty = true; // ação via clique/JS não dispara 'input'/'change' nativo -- marca sujo manualmente (ver ESC em controle-core.js)
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
  atualizarQtdContainersUI();
  renderDemurrageContainers();
}

// ════════════════════════════════════════════════════════════════
// DEMURRAGE POR CONTAINER (pedido da Emanuelly, 10/09/2026): quando o
// processo tem 2+ containers, a devolucao/RIC/depot/datas sao tratadas
// separadamente por container pela operacao. Com 1 container so, os
// campos legados do processo (f_ric_status, f_depot etc.) continuam
// sendo a fonte direta, sem duplicar UI. Com 2+, escondemos o bloco
// unico e mostramos um bloco por container; os valores digitados ali
// sao agregados de volta nos campos legados (sincronizarDemurrageAgregado)
// para que calcularFase/demurrageDias/dashboards continuem funcionando
// sem qualquer mudanca -- eles so enxergam os campos "achatados" do
// processo, nunca _containers diretamente.
// ── Carga LCL (pedido Emanuelly, 05/10/2026) ───────────────────────
// "Quando é LCL não precisamos das tratativas de devolução": o checkbox
// "Carga LCL" da aba Demurrage marca o tipo de todos os containers como
// 'LCL' (o tipo anterior fica guardado em tipo_antes_lcl pra voltar se
// desmarcar). Com LCL a aba esconde devolução/RIC/depot/lavagem/demurrage e
// a fase finaliza com a Data de Carregamento (ver ehLCL/calcularFase em
// controle-core.js).
function cargaEhLCLNaTela(){
  return Array.isArray(_containers) && _containers.length > 0 && _containers.every(c => String((c && c.tipo) || '').toUpperCase() === 'LCL');
}
function alternarLCL(marcado){
  _painelDirty = true; // ação via clique não dispara 'input' nos campos do formulário (ver ESC em controle-core.js)
  if(!Array.isArray(_containers) || !_containers.length) _containers = [{numero:'', tipo:'40HC', lacre:''}];
  if(marcado){
    _containers.forEach(c => { if(String(c.tipo||'').toUpperCase() !== 'LCL') c.tipo_antes_lcl = c.tipo || '40HC'; c.tipo = 'LCL'; });
  } else {
    _containers.forEach(c => { c.tipo = c.tipo_antes_lcl || '40HC'; delete c.tipo_antes_lcl; });
  }
  renderMultiContainers(); // sincroniza containers_json/tipo_container e redesenha a aba Demurrage
  try{ atualizarFaseEmTempoReal(); }catch(e){}
  if(typeof showToast === 'function') showToast(marcado
    ? '📦 Carga LCL: devolução de container, RIC, lavagem e demurrage não se aplicam. Finaliza com a Data de Carregamento. Salve para gravar.'
    : 'Carga LCL desmarcada: a devolução do container volta a ser controlada. Salve para gravar.', 'ok');
}
function aplicarVisualLCL(){
  const lcl = cargaEhLCLNaTela();
  const chk = document.getElementById('f_lcl');
  if(chk) chk.checked = lcl;
  ['demurrage-venc-wrap','demurrage-campos-single','demurrage-campos-multi','demur-info-wrap'].forEach(id => {
    const el = document.getElementById(id);
    if(el && lcl) el.style.display = 'none';
  });
  const nota = document.getElementById('lcl-nota');
  if(nota) nota.style.display = lcl ? '' : 'none';
  if(!lcl){
    const venc = document.getElementById('demurrage-venc-wrap'); if(venc) venc.style.display = '';
    const info = document.getElementById('demur-info-wrap'); if(info) info.style.display = '';
  }
  return lcl;
}

// Modo em que a aba Demurrage foi desenhada pela última vez neste painel:
// 'single' (1 container: campos únicos do processo), 'multi' (2+: um bloco
// por container) ou null (painel acabou de abrir — ver renderModal). Serve
// pra saber quando a tela TROCA de modo (05/10/2026, PVN2602-10): ao
// adicionar um 2º container o 1º herda os campos únicos (que são a fonte
// de verdade com 1 container) e, ao remover e voltar pra 1, os campos
// únicos voltam a mostrar os dados do container que ficou. Antes, com 2
// containers os campos únicos viravam o agregado (em branco quando algum
// container não tinha RIC/lavagem) e continuavam em branco depois de
// remover o 2º — o próximo Salvar apagava a Data Pagamento Lavagem e o
// processo voltava pra Devolução do Vazio.
let _demurModoAnterior = null;
function reiniciarModoDemurrage(){ _demurModoAnterior = null; }

// Campos de demurrage por container -> campo único do processo (aba Demurrage).
const MAPA_DEMUR_CONTAINER_UNICO = [
  ['demurrage_valor','f_demurrage_valor'], ['devolucao','f_data_devolucao_vazio'], ['ric_status','f_ric_status'],
  ['depot','f_depot'], ['data_solicitacao_demurrage','f_data_solicitacao_demurrage'],
  ['data_isencao_demurrage','f_data_isencao_demurrage'], ['data_envio_termo','f_data_envio_termo'],
  ['data_pagamento_lavagem','f_data_pagamento_lavagem'], ['data_pagamento_demurrage','f_data_pagamento_demurrage'],
];
function restaurarCamposUnicosDoContainer(c){
  if(!c) return;
  MAPA_DEMUR_CONTAINER_UNICO.forEach(([k, id]) => {
    const el = document.getElementById(id);
    if(!el) return;
    const v = c[k];
    el.value = (k === 'demurrage_valor' && typeof v === 'number') ? exibirMoeda(v) : (v == null ? '' : String(v));
  });
}

function renderDemurrageContainers(){
  const single = document.getElementById('demurrage-campos-single');
  const multi = document.getElementById('demurrage-campos-multi');
  if(!single || !multi) return; // aba Demurrage ainda nao foi renderizada nesta sessao do modal
  if(aplicarVisualLCL()) return; // carga LCL: sem campos de devolução/demurrage
  if(!_containers || _containers.length <= 1){
    // Voltou de 2+ pra 1 container: os campos únicos ainda mostram o
    // agregado — passam a mostrar os dados do container que ficou.
    if(_demurModoAnterior === 'multi' && _containers && _containers[0]) restaurarCamposUnicosDoContainer(_containers[0]);
    _demurModoAnterior = 'single';
    single.style.display = '';
    multi.style.display = 'none';
    multi.innerHTML = '';
    return;
  }
  // Primeira vez que o processo passa a ter 2+ containers: se o 1º
  // container ainda não tem NENHUM dado próprio de demurrage, herda os
  // valores que já estavam nos campos únicos do processo. Sem isso, um
  // processo que já tinha RIC/depot/datas preenchidos (de quando só
  // existia 1 container) perderia esses dados no próximo Salvar, porque
  // sincronizarDemurrageAgregado() sobrescreve os campos únicos com base
  // nos containers -- e o container novo começa vazio.
  const c0 = _containers[0];
  const CAMPOS_DEMUR_CONTAINER = ['demurrage_valor','devolucao','ric_status','depot','data_solicitacao_demurrage','data_isencao_demurrage','data_envio_termo','data_pagamento_lavagem','data_pagamento_demurrage'];
  // Também herda quando a tela estava com 1 container até agora: nesse modo
  // os campos únicos é que valem, e o que estiver guardado no 1º container
  // pode ser de uma vez anterior (desatualizado).
  if(_demurModoAnterior === 'single' || !CAMPOS_DEMUR_CONTAINER.some(k => c0[k])){
    c0.demurrage_valor = document.getElementById('f_demurrage_valor')?.value || '';
    c0.devolucao = document.getElementById('f_data_devolucao_vazio')?.value || '';
    c0.ric_status = document.getElementById('f_ric_status')?.value || '';
    c0.depot = document.getElementById('f_depot')?.value || '';
    c0.data_solicitacao_demurrage = document.getElementById('f_data_solicitacao_demurrage')?.value || '';
    c0.data_isencao_demurrage = document.getElementById('f_data_isencao_demurrage')?.value || '';
    c0.data_envio_termo = document.getElementById('f_data_envio_termo')?.value || '';
    c0.data_pagamento_lavagem = document.getElementById('f_data_pagamento_lavagem')?.value || '';
    c0.data_pagamento_demurrage = document.getElementById('f_data_pagamento_demurrage')?.value || '';
  }
  _demurModoAnterior = 'multi';
  single.style.display = 'none';
  multi.style.display = '';
  multi.innerHTML = _containers.map((c,i) => {
    const num = (c.numero||'').trim() || ('Container ' + (i+1));
    return `
      <div style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:10px;">
        <div style="font-weight:600;font-size:12px;color:var(--ac);margin-bottom:8px;">📦 ${escContainerLocal(num)}</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">Valor Demurrage (R$)</label>
            <input class="form-input" type="text" inputmode="decimal" value="${escContainerLocal(c.demurrage_valor||'')}" placeholder="0,00"
              oninput="formatarMoedaInput(this);_containers[${i}].demurrage_valor=this.value;sincronizarDemurrageAgregado()"></div>
          <div class="form-group"><label class="form-label">Data Devolução</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" value="${escContainerLocal(c.devolucao||'')}"
              onchange="_containers[${i}].devolucao=this.value;sincronizarDemurrageAgregado();atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">Status RIC</label>
            <select class="form-input" onchange="_containers[${i}].ric_status=this.value;sincronizarDemurrageAgregado();atualizarFaseEmTempoReal()">
              <option value="" ${!c.ric_status?'selected':''}>—</option>
              <option value="Isento" ${c.ric_status==='Isento'?'selected':''}>Isento</option>
              <option value="Parcial Isento" ${c.ric_status==='Parcial Isento'?'selected':''}>Parcial Isento</option>
              <option value="Termo" ${c.ric_status==='Termo'?'selected':''}>Termo</option>
            </select></div>
          <div class="form-group"><label class="form-label">Depot</label>
            <input class="form-input" value="${escContainerLocal(c.depot||'')}" placeholder="Depot de devolução"
              oninput="_containers[${i}].depot=this.value;sincronizarDemurrageAgregado()"></div>
          <div class="form-group"><label class="form-label">Data Solicitação</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" value="${escContainerLocal(c.data_solicitacao_demurrage||'')}"
              onchange="_containers[${i}].data_solicitacao_demurrage=this.value;sincronizarDemurrageAgregado()"></div>
          <div class="form-group"><label class="form-label">Data Isenção</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" value="${escContainerLocal(c.data_isencao_demurrage||'')}"
              onchange="_containers[${i}].data_isencao_demurrage=this.value;sincronizarDemurrageAgregado()"></div>
          <div class="form-group"><label class="form-label">Data de Envio do Termo</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" value="${escContainerLocal(c.data_envio_termo||'')}"
              onchange="_containers[${i}].data_envio_termo=this.value;sincronizarDemurrageAgregado()"></div>
          <div class="form-group"><label class="form-label">Data Pagamento Lavagem</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" value="${escContainerLocal(c.data_pagamento_lavagem||'')}"
              onchange="_containers[${i}].data_pagamento_lavagem=this.value;sincronizarDemurrageAgregado();atualizarFaseEmTempoReal()"></div>
          <div class="form-group"><label class="form-label">Data de Pagamento da Demurrage</label>
            <input class="form-input" type="date" onpaste="colarData(event,this)" value="${escContainerLocal(c.data_pagamento_demurrage||'')}"
              onchange="_containers[${i}].data_pagamento_demurrage=this.value;sincronizarDemurrageAgregado()"></div>
        </div>
      </div>
    `;
  }).join('');
  sincronizarDemurrageAgregado();
}

// Recalcula os campos legados (f_data_devolucao_vazio, f_ric_status etc.)
// a partir dos dados por container, só quando há 2+ containers (com 1 só,
// os campos legados já são preenchidos diretamente e não devem ser
// mexidos aqui).
//
// IMPORTANTE: "devolvido" (data_devolucao_vazio) e "resolvido pra
// Finalizado" (RIC isento ou lavagem paga) são coisas DIFERENTES. Antes
// (09/09/2026) os dois ficavam amarrados na mesma condição
// "todosResolvidos", então um processo com os 2 containers já devolvidos
// mas o RIC ainda em "Termo" (lavagem pendente de pagar) ficava com
// data_devolucao_vazio vazio -- e isso é o que calcula o card "Cálculo do
// Demurrage"/os alertas de vencimento (ver renderDemurInfo/demurrageDisplay
// em controle-core.js): o container já voltou fisicamente, o relógio do
// demurrage já parou, mas o sistema continuava mostrando "vence em Xd"
// como se ele ainda estivesse retido no porto. Bug relatado pelo Ayslan
// (processo OID2602-02, 10/09/2026).
// Corrigido: data_devolucao_vazio agora reflete só "todos os containers
// têm data de devolução" (todosDevolvidos) -- já RIC/lavagem continuam
// exigindo "todos resolvidos" separadamente, então a fase FINALIZADO (ver
// calcularFase() em controle-core.js, que checa
// data_devolucao_vazio && (ric_status==='Isento' || data_pagamento_lavagem))
// continua corretamente travada até a pendência de RIC/lavagem ser
// resolvida -- só o alerta de demurrage é que para de contar mais cedo,
// que é o comportamento certo.
function sincronizarDemurrageAgregado(){
  if(!_containers || _containers.length <= 1) return;
  const parseVal = s => { if(!s) return 0; const n = parseFloat(String(s).replace(/\./g,'').replace(',','.')); return isNaN(n) ? 0 : n; };
  const datasOrdenadas = arr => arr.filter(Boolean).slice().sort();
  const todosDevolvidos = _containers.every(c => c.devolucao);
  const todosResolvidos = _containers.every(c => c.devolucao && (c.ric_status === 'Isento' || c.data_pagamento_lavagem));

  const fDevol = document.getElementById('f_data_devolucao_vazio');
  const fRic = document.getElementById('f_ric_status');
  const fLavagem = document.getElementById('f_data_pagamento_lavagem');
  const fValor = document.getElementById('f_demurrage_valor');
  const fDepot = document.getElementById('f_depot');
  const fSolic = document.getElementById('f_data_solicitacao_demurrage');
  const fIsencao = document.getElementById('f_data_isencao_demurrage');
  const fEnvio = document.getElementById('f_data_envio_termo');
  const fPagDemur = document.getElementById('f_data_pagamento_demurrage');

  if(fDevol) fDevol.value = todosDevolvidos ? (datasOrdenadas(_containers.map(c=>c.devolucao)).pop() || '') : '';
  if(fRic) fRic.value = todosResolvidos ? (_containers.every(c=>c.ric_status==='Isento') ? 'Isento' : 'Termo') : '';
  if(fLavagem) fLavagem.value = todosResolvidos ? (datasOrdenadas(_containers.map(c=>c.data_pagamento_lavagem)).pop() || '') : '';
  const total = _containers.reduce((s,c)=>s+parseVal(c.demurrage_valor),0);
  if(fValor) fValor.value = total ? exibirMoeda(total) : '';
  if(fDepot) fDepot.value = [...new Set(_containers.map(c=>c.depot).filter(Boolean))].join(' / ');
  if(fSolic) fSolic.value = datasOrdenadas(_containers.map(c=>c.data_solicitacao_demurrage)).shift() || '';
  if(fIsencao) fIsencao.value = datasOrdenadas(_containers.map(c=>c.data_isencao_demurrage)).pop() || '';
  if(fEnvio) fEnvio.value = datasOrdenadas(_containers.map(c=>c.data_envio_termo)).pop() || '';
  if(fPagDemur) fPagDemur.value = datasOrdenadas(_containers.map(c=>c.data_pagamento_demurrage)).pop() || '';
}

// Campo único de Qtd. Containers (pedido do Ayslan, 10/09/2026): antes
// existiam dois números que podiam divergir — o "previsto" (aba
// Identificação) e a contagem real de containers (aba Documentos), e o
// sistema usava um ou outro sem avisar qual. Em vez de só sinalizar o
// conflito, agora o campo "previsto" trava e passa a REFLETIR
// automaticamente a contagem real assim que existe pelo menos 1 container
// cadastrado em Documentos — o valor exibido (e salvo, já que o input
// continua sendo o que vai pro banco em qtd_containers_prevista) fica
// sempre igual ao que os dashboards usam, eliminando a divergência na
// raiz. Antes de existir container real, o campo continua editável
// normalmente como estimativa (única forma de saber a quantidade antes
// do booking).
function atualizarQtdContainersUI(){
  const input = document.getElementById('f_qtd_containers_prevista');
  if(!input) return;
  const label = document.getElementById('label-qtd-containers');
  const hint = document.getElementById('hint-qtd-containers');
  const reais = (_containers||[]).filter(c => c && c.numero && c.numero.trim()).length;
  if(reais > 0){
    input.value = reais;
    input.disabled = true;
    input.style.background = '#f3f4f6';
    input.style.color = 'var(--dim)';
    if(label) label.textContent = 'Qtd. Containers';
    if(hint) hint.innerHTML = `<span title="Sincronizado automaticamente com os ${reais} container(s) real(is) da aba Documentos." style="cursor:help;">🔒 sincronizado</span>`;
  } else {
    input.disabled = false;
    input.style.background = '';
    input.style.color = '';
    if(label) label.textContent = 'Qtd. Containers (previsto)';
    if(hint) hint.innerHTML = '';
  }
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
  _painelDirty = true; // ação via clique/JS não dispara 'input'/'change' nativo -- marca sujo manualmente (ver ESC em controle-core.js)
  _produtos.push({descricao:'', quantidade:''});
  renderMultiProdutos();
}

function removerProdutoItem(i){
  _painelDirty = true; // ação via clique/JS não dispara 'input'/'change' nativo -- marca sujo manualmente (ver ESC em controle-core.js)
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
  return { cliente:'', itens:[{descricao:'', quantidade:''}], nf_saida_numero:'', nf_saida_data:'', nf_saida_valor:'', nf_saida_cfop:'', custos_diretos:[], obs:'', forma_pagamento:'avista', prazo_texto:'', juros_valor:'' };
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
        <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;">${ehCfopBaixa(v.nf_saida_cfop) ? '📌 Baixa sem NF' : vendaEhRemessa(v) ? '📦 Remessa p/ estoque' : vendaEhRetorno(v) ? '↩️ Retorno da remessa' : 'Venda '+(vi+1)}${ehCfopBaixa(v.nf_saida_cfop) ? ' <span style="text-transform:none;font-weight:600;color:#475569;background:#e2e8f0;border-radius:4px;padding:1px 6px;margin-left:6px;">CFOP BAIXA — sai do estoque, mas não é venda (display, uso interno, avaria)</span>' : ''}${vendaEhRemessa(v) ? ' <span style="text-transform:none;font-weight:600;color:#92400e;background:#fef3c7;border-radius:4px;padding:1px 6px;margin-left:6px;">CFOP 5905 — não conta como venda, a mercadoria continua no estoque</span>' : vendaEhRetorno(v) ? ' <span style="text-transform:none;font-weight:600;color:#475569;background:#e2e8f0;border-radius:4px;padding:1px 6px;margin-left:6px;">CFOP '+esc(v.nf_saida_cfop)+' — retorno simbólico: só registro, não mexe em estoque nem em venda</span>' : ''}</div>
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
        <div class="form-group"><label class="form-label">CFOP</label>
          <input class="form-input" value="${esc(v.nf_saida_cfop||'')}" placeholder="ex: 5102, 6102, 5905, BAIXA" onchange="_vendas[${vi}].nf_saida_cfop=this.value.trim();sincronizarVendasLegado();renderVendas()"></div>
        <div class="form-group"><label class="form-label">Data NF Saída</label>
          <input class="form-input" type="date" onpaste="colarData(event,this)" value="${esc(v.nf_saida_data||'')}" oninput="_vendas[${vi}].nf_saida_data=this.value;sincronizarVendasLegado()"></div>
        <div class="form-group"><label class="form-label">Valor NF Saída (R$)</label>
          <input class="form-input" type="number" step="0.01" value="${v.nf_saida_valor!=null?v.nf_saida_valor:''}" oninput="_vendas[${vi}].nf_saida_valor=this.value;sincronizarVendasLegado();renderResumoVendas()"></div>
        <div class="form-group"><label class="form-label">Forma de Pagamento</label>
          <select class="form-input" onchange="_vendas[${vi}].forma_pagamento=this.value;if(this.value!=='prazo')_vendas[${vi}].prazo_texto='';sincronizarVendasLegado();renderVendas();" onwheel="this.blur()">
            <option value="avista" ${(v.forma_pagamento||'avista')==='avista'?'selected':''}>À Vista</option>
            <option value="prazo" ${v.forma_pagamento==='prazo'?'selected':''}>Prazo / Parcelado</option>
          </select></div>
        ${v.forma_pagamento==='prazo' ? `<div class="form-group full"><label class="form-label">Prazo (campo livre — ex: "30 dias" ou "30/60/90 dias")</label>
          <input class="form-input" value="${esc(v.prazo_texto||'')}" oninput="_vendas[${vi}].prazo_texto=this.value;sincronizarVendasLegado()" placeholder="ex: 30/60/90 dias"></div>` : ''}
        <div class="form-group"><label class="form-label">Juros Cobrado do Cliente (R$ — se houver)</label>
          <input class="form-input" type="number" step="0.01" value="${v.juros_valor!=null?v.juros_valor:''}" oninput="_vendas[${vi}].juros_valor=this.value;sincronizarVendasLegado()" placeholder="0,00"></div>
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
  _painelDirty = true; // ação via clique/JS não dispara 'input'/'change' nativo -- marca sujo manualmente (ver ESC em controle-core.js)
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
  _painelDirty = true;
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
  _painelDirty = true; // ação via clique/JS não dispara 'input'/'change' nativo -- marca sujo manualmente (ver ESC em controle-core.js)
  _vendas[vi].itens.push({descricao:'', quantidade:''});
  renderVendas();
}

function removerItemVenda(vi,ii){
  _painelDirty = true; // ação via clique/JS não dispara 'input'/'change' nativo -- marca sujo manualmente (ver ESC em controle-core.js)
  _vendas[vi].itens.splice(ii,1);
  if(!_vendas[vi].itens.length) _vendas[vi].itens = [{descricao:'', quantidade:''}];
  renderVendas();
}

function adicionarCustoDiretoVenda(vi){
  _painelDirty = true; // ação via clique/JS não dispara 'input'/'change' nativo -- marca sujo manualmente (ver ESC em controle-core.js)
  if(!_vendas[vi].custos_diretos) _vendas[vi].custos_diretos = [];
  _vendas[vi].custos_diretos.push({label:'', valor:''});
  renderVendas();
}

function removerCustoDiretoVenda(vi,ci){
  _painelDirty = true; // ação via clique/JS não dispara 'input'/'change' nativo -- marca sujo manualmente (ver ESC em controle-core.js)
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
  // Volta a mostrar o lucro por venda (pedido Ayslan 08/09/2026 - tinha
  // sido tirado antes, mas o Ayslan quer ver de novo aqui). E' o lucro
  // "bruto" da venda (NF Saida da venda - custo rateado), sem contar Juros
  // Cobrado/Notas Boss (que so entram no Lucro Real completo da aba
  // Fechamento) - por isso o rotulo deixa claro que e' so um preview.
  const linhasHtml = resumo.linhas.map((l,i)=>`
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;">
      <span style="color:var(--muted);">${esc(l.venda.cliente||('Venda '+(i+1)+' — sem cliente'))} — ${l.qtdVenda||0} un. (${(l.fracao*100).toFixed(1)}% do processo)</span>
      <strong style="color:${l.lucro==null?'var(--muted)':l.lucro>=0?'var(--ok)':'var(--err)'}">${l.temNf?`${r2(l.lucro)}${l.pctLucro!=null?` (${(l.pctLucro*100).toFixed(1)}%)`:''}`:'aguardando NF'}</strong>
    </div>`).join('');
  const saldo = resumo.saldoNaoAlocado;
  const alertaSaldo = Math.abs(saldo) > 0.001
    ? `<div style="margin-top:8px;font-size:11px;color:${saldo>0?'#f39c12':'var(--err)'};">⚠ ${saldo>0 ? `Ainda faltam ${saldo} un. sem venda alocada (de ${resumo.totalQtd} do processo).` : `Alocado ${Math.abs(saldo)} un. a mais do que o processo tem (${resumo.totalQtd}).`}${(saldo>0 && resumo.itensFaltantes && resumo.itensFaltantes.length) ? `<ul style="margin:6px 0 0 18px;padding:0;">${resumo.itensFaltantes.map(it => `<li>${esc(it.descricao)}: ${it.quantidade}</li>`).join('')}</ul>` : ''}</div>`
    : '';
  const lucroTotal = resumo.linhas.every(l=>l.lucro!=null) ? resumo.linhas.reduce((s,l)=>s+l.lucro,0) : null;
  const linhaLucroTotal = lucroTotal!=null
    ? `<div style="display:flex;justify-content:space-between;padding:8px 0 0;margin-top:4px;border-top:1px solid var(--border);font-size:12px;font-weight:700;">
        <span style="color:var(--text);">Lucro total do processo (soma das vendas)</span>
        <strong style="color:${lucroTotal>=0?'var(--ok)':'var(--err)'};">${r2(lucroTotal)}</strong>
      </div>`
    : '';
  wrap.innerHTML = `<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-top:6px;">
    <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:6px;">Resumo por venda (lucro bruto — o Lucro Real completo, com Juros e Notas Boss, está na aba Fechamento)</div>
    ${linhasHtml}
    ${linhaLucroTotal}
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

// Contas bancárias da própria Impak usadas pra fechar câmbio — lista
// BANCOS_CAMBIO declarada no topo deste arquivo (vem de /api/listas →
// cadastros_listas, categoria banco_cambio; editável em /cadastros → Listas).
function datalistBancosCambioHtml(){
  return `<datalist id="lista-bancos-cambio">${BANCOS_CAMBIO.map(b=>`<option value="${esc(b.nome)}">`).join('')}</datalist>`;
}
// Normaliza o texto de banco extraído pela IA de um comprovante (ex:
// "Itaú Unibanco S.A.", "BANCO SANTANDER (BRASIL) S.A.") pro nome curto
// cadastrado (ex: "Itaú"), quando reconhece um dos bancos da lista. Se não
// reconhecer, devolve o texto original sem alterar (banco/corretora fora
// da lista continua podendo ser digitado livremente).
function normalizarBancoCambio(texto){
  if(!texto) return texto;
  const t = String(texto).toLowerCase();
  const achou = BANCOS_CAMBIO.find(b => t.includes(b.nome.toLowerCase()));
  return achou ? achou.nome : texto;
}

// Custo da Operação = Valor USD × Câmbio Fechado desta parcela (pedido do
// Ayslan, 17/09/2026 -- ver comentário acima). Só preenche se o campo
// ainda estiver vazio, pra nunca sobrescrever o que o usuário já digitou
// (mesmo padrão de "fill-if-empty" usado no resto do fluxo de câmbio).
// Preenche automaticamente o Valor USD da ÚNICA parcela que ainda está
// vazia com o saldo restante (Valor USD da PI - soma das parcelas já
// preenchidas). Só age quando sobra exatamente 1 parcela vazia (com 2+
// vazias não dá pra saber como dividir) e nunca sobrescreve um valor que
// o usuário já digitou -- mesmo padrão fill-if-empty do resto do fluxo.
// ── Base do Parcelado: CI quando existir, senão PI ─────────────────────
// Pedido da equipe (05/10/2026, processos 26DTPI0476-x): "o
// sistema está puxando o valor da PI e não atualiza quando incluímos uma
// CI". A CI é o que o fornecedor de fato cobra pelo que embarcou (pode ser
// menor ou maior que a PI), então o SALDO a pagar tem que fechar com ela.
// Sem CI ainda, vale a PI. A ENTRADA (adiantamento) continua sendo % da PI,
// porque é paga no pedido, antes de existir CI.
function baseTotalParcelas(){
  const ci = valorMoeda('f_ci_valor_usd');
  if(ci && ci > 0) return { valor: ci, origem: 'CI' };
  const pi = valorMoeda('f_pi_valor_usd');
  return { valor: pi || 0, origem: 'PI' };
}

// Recalcula a parcela do SALDO (a "Final" em aberto, ou a única parcela em
// aberto se não houver Final) = base − soma das demais parcelas. Parcela com
// câmbio fechado nunca é mexida. Devolve {idx, antes, depois, origem} quando
// mudou algo, ou null. Chamado quando a CI muda (digitada ou lida pela IA),
// quando o % de entrada muda e quando a PI muda com % definido.
function recalcularSaldoPelaBase(opts){
  opts = opts || {};
  if(document.getElementById('f_pi_pagamento')?.value !== 'PARCELADO') return null;
  if(!Array.isArray(_parcelas) || !_parcelas.length) return null;
  const base = baseTotalParcelas();
  if(!base.valor) return null;
  const num = v => parseFloat(String(v??'').replace(',','.')) || 0;
  const abertas = _parcelas.map((pc,i)=>i).filter(i => !String(_parcelas[i].cambio_fechado||'').trim());
  if(!abertas.length) return null;
  let alvo = abertas.find(i => _parcelas[i].label === 'Final');
  if(alvo == null){
    if(abertas.length !== 1) return null; // 2+ em aberto e nenhuma Final: não dá pra saber qual é o saldo
    alvo = abertas[0];
  }
  const somaOutras = _parcelas.reduce((s,pc,i)=> i===alvo ? s : s + num(pc.valor_usd), 0);
  const resto = +(base.valor - somaOutras).toFixed(2);
  if(!(resto > 0)) return null;
  const antes = num(_parcelas[alvo].valor_usd);
  if(Math.abs(antes - resto) < 0.01) return null;
  _parcelas[alvo].valor_usd = resto.toFixed(2);
  _parcelas[alvo].custo_operacao = '';
  delete _parcelas[alvo].valor_vazio_manual;
  if(!_parcelas[alvo].label) _parcelas[alvo].label = 'Final';
  if(!opts.silencioso && typeof showToast === 'function'){
    showToast(`Parcela "${_parcelas[alvo].label}" recalculada pela ${base.origem}: US$ ${fmtUsdBR(antes)} → US$ ${fmtUsdBR(resto)}`, 'ok');
  }
  return { idx: alvo, antes, depois: resto, origem: base.origem };
}

// % de entrada (adiantamento) do Parcelado — mesmo pedido de 05/10/2026: a
// PI e a CI dos processos 26DTPI0476-x dizem 20% de entrada e o sistema mostrava 30%. O 30%
// vinha do formato antigo "Entrada + Saldo", que mostrava 30 como padrão no
// campo % e gravava esse número mesmo sem ninguém digitar; na conversão para
// "Parcelado" a Inicial nasceu com 30%. Agora o % é explícito (campo
// f_pi_entrada_pct no bloco Parcelado, sem valor padrão) e a IA lê o % dos
// termos de pagamento da PI. Inicial (se ainda sem câmbio) = % × PI; o saldo
// (Final) fecha com a base (CI/PI).
function aplicarPctEntradaParcelas(opts){
  opts = opts || {};
  if(document.getElementById('f_pi_pagamento')?.value !== 'PARCELADO') return false;
  const pct = parseFloat(String(document.getElementById('f_pi_entrada_pct')?.value ?? '').replace(',','.'));
  if(!(pct > 0 && pct < 100)) return false;
  const pi = valorMoeda('f_pi_valor_usd');
  if(!pi){ if(!opts.silencioso && typeof showToast==='function') showToast('Preencha o Valor USD da PI para calcular a entrada','warn'); return false; }
  if(!Array.isArray(_parcelas) || !_parcelas.length) _parcelas = [{...parcelaVazia(), label:'Inicial'}, {...parcelaVazia(), label:'Final'}];
  let iIni = _parcelas.findIndex(pc => pc.label === 'Inicial');
  if(iIni < 0 && !_parcelas[0].label) { iIni = 0; _parcelas[0].label = 'Inicial'; }
  let mudou = false;
  const valorEntrada = +(pi * pct / 100).toFixed(2);
  if(iIni >= 0){
    const ini = _parcelas[iIni];
    const pago = !!String(ini.cambio_fechado||'').trim();
    if(!pago && Math.abs((parseFloat(ini.valor_usd)||0) - valorEntrada) >= 0.01){
      ini.valor_usd = valorEntrada.toFixed(2);
      ini.custo_operacao = '';
      delete ini.valor_vazio_manual;
      mudou = true;
    } else if(pago && Math.abs((parseFloat(ini.valor_usd)||0) - valorEntrada) >= 0.01 && !opts.silencioso && typeof showToast === 'function'){
      // Inicial já paga com outro valor: não mexe (o valor pago vem do
      // comprovante), só avisa pra conferir.
      showToast(`A parcela Inicial já tem câmbio fechado com US$ ${fmtUsdBR(ini.valor_usd)}; ${pct}% da PI daria US$ ${fmtUsdBR(valorEntrada)}. Confira o comprovante.`, 'warn');
    }
  }
  if(!_parcelas.some(pc => pc.label === 'Final')) _parcelas.push({...parcelaVazia(), label:'Final'});
  const saldo = recalcularSaldoPelaBase({ silencioso: true });
  if(typeof sincronizarParcelasLegado === 'function') sincronizarParcelasLegado();
  if(!opts.semRender){ try{ renderParcelas(); renderPagamentoInfoLive(); atualizarVencimentoSaldoPorETA(); }catch(e){} }
  if((mudou || saldo) && !opts.silencioso && typeof showToast === 'function'){
    const base = baseTotalParcelas();
    showToast(`Entrada de ${pct}% da PI aplicada${mudou ? ' (Inicial US$ ' + fmtUsdBR(valorEntrada) + ')' : ''}${saldo ? '; Final = ' + base.origem + ' − demais = US$ ' + fmtUsdBR(saldo.depois) : ''}${opts.origem ? ' — lido do documento' : ''}`, 'ok');
  }
  return mudou || !!saldo;
}

// Valor USD da PI mudou (digitado): com % de entrada definido, refaz a
// Inicial (em aberto) e o saldo; sem %, só completa parcela vazia (antigo).
function aoMudarValorPI(){
  if(document.getElementById('f_pi_pagamento')?.value === 'PARCELADO' && parseFloat(document.getElementById('f_pi_entrada_pct')?.value) > 0){
    aplicarPctEntradaParcelas({ silencioso: true });
    return;
  }
  calcularParcelaResidualAuto();
  try{ renderParcelas(); renderPagamentoInfoLive(); }catch(e){}
}

// Valor USD da CI mudou (digitado, lido pela IA ou aceito no pop-up de
// divergências): o saldo em aberto acompanha a CI.
function aoMudarValorCI(){
  const r = recalcularSaldoPelaBase();
  if(r){ if(typeof sincronizarParcelasLegado === 'function') sincronizarParcelasLegado(); try{ renderParcelas(); renderPagamentoInfoLive(); }catch(e){} }
  else { try{ renderPagamentoInfoLive(); }catch(e){} }
  return r;
}

function calcularParcelaResidualAuto(){
  const val = baseTotalParcelas().valor;
  if(!val || !_parcelas.length) return;
  const vazias = [];
  let somaPreenchidas = 0;
  _parcelas.forEach((pc,i)=>{
    const v = pc.valor_usd;
    if(v===''||v==null){ if(!pc.valor_vazio_manual) vazias.push(i); }
    else somaPreenchidas += parseFloat(v)||0;
  });
  if(vazias.length===1){
    const resto = val - somaPreenchidas;
    if(resto > 0) _parcelas[vazias[0]].valor_usd = resto.toFixed(2);
  }
}

// Trava (24/09/2026): 6 processos tinham a parcela do saldo vazia ou nem
// criada -- ~US$ 137 mil de câmbio sumiam do Controle Cambial. Ao salvar um
// Parcelado, o saldo que falta (PI - parcelas) vai pra parcela vazia em
// aberto (vira "Final" se estiver sem etapa) ou é criada uma parcela Final.
// Se mesmo assim a soma não bater com a PI, avisa (não bloqueia o save).
function completarSaldoParcelas(){
  // Base = CI quando houver, senão PI (05/10/2026 — ver baseTotalParcelas).
  const base = baseTotalParcelas();
  const val = base.valor;
  if(!val || !Array.isArray(_parcelas)) return;
  const num = v => parseFloat(String(v??'').replace(',','.')) || 0;
  let soma = _parcelas.reduce((a,pc)=>a+num(pc.valor_usd),0);
  const resto = +(val - soma).toFixed(2);
  // Parcela que o usuário APAGOU de propósito (valor_vazio_manual) não é
  // preenchida de novo sozinha — Ayslan 29/09/2026: "não consigo apagar o
  // valor e salvar". O aviso de soma diferente da PI continua aparecendo.
  const apagouManual = _parcelas.some(pc => pc.valor_vazio_manual && !num(pc.valor_usd));
  if(resto > 1 && !apagouManual){
    const vazias = _parcelas.map((pc,i)=>i).filter(i=>!num(_parcelas[i].valor_usd) && !_parcelas[i].cambio_fechado);
    if(vazias.length === 1){
      const i = vazias[0];
      _parcelas[i].valor_usd = resto.toFixed(2);
      if(!_parcelas[i].label) _parcelas[i].label = 'Final';
    } else if(!vazias.length && !_parcelas.some(pc=>pc.label==='Final' && !pc.cambio_fechado)){
      _parcelas.push({...parcelaVazia(), label:'Final', valor_usd: resto.toFixed(2)});
    }
    try{ atualizarVencimentoSaldoPorETA(); }catch(e){}
  }
  soma = _parcelas.reduce((a,pc)=>a+num(pc.valor_usd),0);
  if(Math.abs(soma - val) > 1 && typeof showToast === 'function'){
    showToast(`⚠️ Parcelas somam US$ ${soma.toFixed(2)} e a ${base.origem} é US$ ${val.toFixed(2)} (diferença US$ ${(val-soma).toFixed(2)}). Confira as parcelas.`, 'warn');
  }
}

function calcularCustoOperacaoAuto(i){
  if(!_parcelas[i] || _parcelas[i].custo_operacao) return;
  const v = parseFloat(_parcelas[i].valor_usd) || 0;
  const c = parseFloat(_parcelas[i].cambio_fechado) || 0;
  if(v && c) _parcelas[i].custo_operacao = (v*c).toFixed(2);
}

function parcelaVazia(){ return { label:'', valor_usd:'', data_vencimento:'', cambio_fechado:'', data_fechamento_cambio:'', banco:'', custo_operacao:'', valor_recebido_cliente:'', data_recebimento:'', codigo_bacen:'', tipo_cambio:'', swift_id:'', pagto_antecipado:true, venc_di:'', duimp_numero:'', duimp_protocolo:'' }; }

// Prazo de comprovação de DI/DUIMP ao banco em pagamentos antecipados de
// importação -- pedido do Ayslan (17/09/2026, resposta "Calcular automático
// (180 dias)"). dataBase é a data do câmbio fechado (data_vencimento da
// parcela, que já é preenchida com a data real do contrato via o fluxo de
// confirmação de comprovante). Retorna string ISO (yyyy-mm-dd) ou '' se
// sem data base.
function calcularVencimentoDI(dataBase){
  if(!dataBase) return '';
  const d = parseDataLocal(dataBase);
  if(!d || isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + 180);
  return d.toISOString().slice(0,10);
}

// Liga/desliga a exigência de DI/DUIMP numa parcela. Ao ligar, calcula
// automaticamente o prazo (180 dias a partir do câmbio fechado) SE ainda
// não tiver um preenchido -- nunca sobrescreve data já digitada à mão,
// mesmo padrão já usado nos campos auto-preenchidos pela confirmação de
// comprovante de câmbio (ver confirmarCambioParcela/aplicarCambioNaParcelaPendente).
// Rótulo fixo em cima de cada campo de parcela -- pedido do Ayslan
// (17/09/2026): "todos os campos que a gente preencheu nao tem o cabecalho
// pra saber o que é o que. pro exmeplo ta escrito 7533, isso é o que?".
// Antes só tinham placeholder, que some assim que o campo é preenchido.
function lblParcela(texto){
  return `<label style="display:block;font-size:9px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px;">${texto}</label>`;
}
function renderParcelas(){
  const wrap = document.getElementById('parcelas-list');
  if(!wrap) return;
  if(!document.getElementById('lista-bancos-cambio')){
    document.body.insertAdjacentHTML('beforeend', datalistBancosCambioHtml());
  }
  if(!_parcelas.length) _parcelas = [{...parcelaVazia(), label:'Inicial'}, {...parcelaVazia(), label:'Final'}];
  const secao = (conteudo, primeira) => `<div style="display:grid;gap:14px;align-items:end;${primeira?'':'margin-top:16px;padding-top:16px;border-top:1px solid var(--border);'}grid-template-columns:${conteudo.cols};">${conteudo.html}</div>`;
  wrap.innerHTML = _parcelas.map((pc,i)=>`
    <div style="border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:12px;background:#fff;">
      ${secao({cols:'1.3fr 1fr 1fr 1fr 32px', html:`
        <div>${lblParcela('Etapa')}<select class="form-input" onchange="_parcelas[${i}].label=this.value;sincronizarParcelasLegado();atualizarVencimentoSaldoPorETA()">
          <option value="">Etapa...</option>
          ${PARCELA_ETAPAS.map(et=>`<option value="${esc(et)}" ${pc.label===et?'selected':''}>${esc(et)}</option>`).join('')}
        </select></div>
        <div>${lblParcela('Valor USD')}<div class="moeda-wrap"><span class="moeda-prefix">USD</span><input class="form-input" type="text" inputmode="decimal" placeholder="0,00" value="${pc.valor_usd!=null&&pc.valor_usd!==''?exibirMoeda(pc.valor_usd):''}"
          oninput="formatarMoedaInput(this);_parcelas[${i}].valor_usd=parseValorMoeda(this.value);if(_parcelas[${i}].valor_usd===''||_parcelas[${i}].valor_usd==null){_parcelas[${i}].valor_vazio_manual=true}else{delete _parcelas[${i}].valor_vazio_manual};sincronizarParcelasLegado();renderPagamentoInfoLive()"
          onchange="calcularParcelaResidualAuto();calcularCustoOperacaoAuto(${i});renderParcelas();renderPagamentoInfoLive();atualizarVencimentoSaldoPorETA()"></div></div>
        <div>${lblParcela('Data Vencimento')}<input class="form-input" type="date" onpaste="colarData(event,this)" value="${esc(pc.data_vencimento||'')}"
          oninput="_parcelas[${i}].data_vencimento=this.value;sincronizarParcelasLegado()"></div>
        <div>${lblParcela('Câmbio Fechado')}<input class="form-input" type="number" step="0.0001" placeholder="5,0000" value="${pc.cambio_fechado!=null?pc.cambio_fechado:''}"
          oninput="_parcelas[${i}].cambio_fechado=this.value;sincronizarParcelasLegado();renderPagamentoInfoLive()"
          onchange="if(this.value&&!_parcelas[${i}].data_fechamento_cambio)_parcelas[${i}].data_fechamento_cambio=new Date().toISOString().slice(0,10);calcularCustoOperacaoAuto(${i});renderParcelas();renderPagamentoInfoLive();atualizarVencimentoSaldoPorETA()"></div>
        ${_parcelas.length>1
          ? `<button type="button" onclick="removerParcela(${i})" style="background:none;border:none;color:var(--err);cursor:pointer;font-size:16px;padding:0 0 9px;">✕</button>`
          : '<div></div>'}
      `}, true)}
      ${secao({cols:'1fr 1fr 1fr 32px', html:`
        <div>${lblParcela('Banco/Corretora')}<input class="form-input" list="lista-bancos-cambio" placeholder="Ex: Itaú, Santander..." value="${esc(pc.banco||'')}" title="Onde este câmbio foi fechado"
          oninput="_parcelas[${i}].banco=this.value;sincronizarParcelasLegado()"></div>
        <div>${lblParcela('Custo da Operação')}<div class="moeda-wrap"><span class="moeda-prefix">R$</span><input class="form-input" type="text" inputmode="decimal" placeholder="0,00" value="${pc.custo_operacao!=null&&pc.custo_operacao!==''?exibirMoeda(pc.custo_operacao):''}" title="Valor USD × Câmbio Fechado desta parcela, mais IOF/tarifas se o banco cobrar algo além (calculado automaticamente, mas pode editar)"
          oninput="formatarMoedaInput(this);_parcelas[${i}].custo_operacao=parseValorMoeda(this.value);sincronizarParcelasLegado()"></div></div>
        <div>${lblParcela('Data Fechamento Câmbio')}<input class="form-input" type="date" onpaste="colarData(event,this)" value="${esc(pc.data_fechamento_cambio||'')}" title="Data em que o câmbio foi efetivamente travado/pago (diferente da Data Vencimento, que é a previsão)"
          oninput="_parcelas[${i}].data_fechamento_cambio=this.value;sincronizarParcelasLegado()"></div>
        <div></div>
      `})}
      ${secao({cols:'1fr 1fr 1fr 32px', html:`
        <div>${lblParcela('Tipo de câmbio')}<select class="form-input" title="Normal = contrato com código BACEN. Futuro = só a mensagem SWIFT do banco (sem BACEN)"
          onchange="_parcelas[${i}].tipo_cambio=this.value;sincronizarParcelasLegado();renderParcelas()">
          <option value="" ${!pc.tipo_cambio?'selected':''}>—</option>
          <option value="NORMAL" ${pc.tipo_cambio==='NORMAL'?'selected':''}>Normal (BACEN)</option>
          <option value="FUTURO" ${pc.tipo_cambio==='FUTURO'?'selected':''}>Câmbio futuro (SWIFT)</option>
        </select></div>
        ${pc.tipo_cambio==='FUTURO'
          ? `<div>${lblParcela('Mensagem SWIFT')}<input class="form-input" placeholder="Ex: IF058503659905" value="${esc(pc.swift_id||'')}" title="Identificador da mensagem SWIFT do pagamento (câmbio futuro não tem código BACEN)"
          oninput="_parcelas[${i}].swift_id=this.value;sincronizarParcelasLegado()"></div>`
          : `<div>${lblParcela('Código BACEN')}<input class="form-input" placeholder="Nº do contrato de câmbio" value="${esc(pc.codigo_bacen||'')}" title="Nº do contrato de câmbio / referência do banco"
          oninput="_parcelas[${i}].codigo_bacen=this.value;sincronizarParcelasLegado()"></div>`}
        <div></div>
        <div></div>
      `})}
      ${secao({cols:'1fr 1fr 1fr 32px', html:`
        <div>${lblParcela('Venc. DI/DUIMP')}<input class="form-input" type="date" onpaste="colarData(event,this)" value="${esc(pc.venc_di||'')}" title="Prazo p/ comprovar DI/DUIMP ao banco (padrão: 180 dias do câmbio fechado)"
          oninput="_parcelas[${i}].venc_di=this.value;sincronizarParcelasLegado()"></div>
        <div>${lblParcela('Nº DUIMP')}<input class="form-input" placeholder="Nº DUIMP" value="${esc(pc.duimp_numero||'')}"
          oninput="_parcelas[${i}].duimp_numero=this.value;sincronizarParcelasLegado()"></div>
        <div>${lblParcela('Protocolo / Chave de Acesso')}<input class="form-input" placeholder="Protocolo / Chave de Acesso" value="${esc(pc.duimp_protocolo||'')}"
          oninput="_parcelas[${i}].duimp_protocolo=this.value;sincronizarParcelasLegado()"></div>
        <button type="button" title="Recalcular prazo (180 dias do câmbio fechado)" onclick="_parcelas[${i}].venc_di=calcularVencimentoDI(_parcelas[${i}].data_vencimento);sincronizarParcelasLegado();renderParcelas()"
          style="background:none;border:1px solid var(--border);border-radius:6px;color:var(--ac);cursor:pointer;font-size:13px;padding:0;height:36px;">↻</button>
      `})}
    </div>
    <div style="border:1px solid var(--border);border-radius:10px;padding:14px 18px;margin-bottom:18px;background:var(--bg);">
      ${secao({cols:'1fr 1fr 32px', html:`
        <div>${lblParcela('Valor Recebido do Cliente (R$)')}<div class="moeda-wrap"><span class="moeda-prefix">R$</span><input class="form-input" type="text" inputmode="decimal" placeholder="0,00" value="${pc.valor_recebido_cliente!=null&&pc.valor_recebido_cliente!==''?exibirMoeda(pc.valor_recebido_cliente):''}"
          oninput="formatarMoedaInput(this);_parcelas[${i}].valor_recebido_cliente=parseValorMoeda(this.value);sincronizarParcelasLegado()"></div></div>
        <div>${lblParcela('Data Recebimento')}<input class="form-input" type="date" onpaste="colarData(event,this)" value="${esc(pc.data_recebimento||'')}" title="Data do recebimento do cliente"
          oninput="_parcelas[${i}].data_recebimento=this.value;sincronizarParcelasLegado()"></div>
        <div></div>
      `}, true)}
    </div>
  `).join('');
  sincronizarParcelasLegado();
}
function adicionarParcela(){
  _painelDirty = true; // ação via clique/JS não dispara 'input'/'change' nativo -- marca sujo manualmente (ver ESC em controle-core.js)
  _parcelas.push(parcelaVazia());
  renderParcelas();
  renderPagamentoInfoLive();
}

// Zera todas as parcelas (pede confirmação). A parcela vazia que fica NÃO
// é preenchida de novo com o saldo automático (valor_vazio_manual).
function limparParcelas(){
  if(!confirm('Apagar TODAS as parcelas deste processo (valores, câmbios, datas, banco, BACEN/SWIFT, DUIMP)?\n\nSó vale depois de clicar em Salvar.')) return;
  _painelDirty = true;
  _parcelas = [{...parcelaVazia(), valor_vazio_manual: true}];
  sincronizarParcelasLegado();
  renderParcelas();
  renderPagamentoInfoLive();
  showToast('Parcelas limpas — clique em Salvar para gravar','info');
}

function removerParcela(i){
  _painelDirty = true; // ação via clique/JS não dispara 'input'/'change' nativo -- marca sujo manualmente (ver ESC em controle-core.js)
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
// Argumento de função JS dentro de atributo HTML (onclick="f(${jsArg(x)})").
// Relatório de segurança (item 4): o padrão antigo esc(x).replace(/'/g,"\\'")
// não protege — o navegador desfaz o escape HTML antes de rodar o JS.
// JSON.stringify gera um literal JS válido e o esc() protege o atributo.
function jsArg(v){ return esc(JSON.stringify(v==null ? '' : String(v))); }

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

// Taxa do câmbio pendente: a do documento ou, se não veio (câmbio futuro
// com anotação ilegível), a digitada no campo do modal.
function _taxaCambioPendente(){
  const doc = parseFloat(_cambioPendente && _cambioPendente.taxa_cambio) || 0;
  if(doc) return doc;
  const el = document.getElementById('cambio-modal-taxa-manual');
  const v = el ? parseFloat(String(el.value).replace(/\./g, el.value.includes(',') ? '' : '.').replace(',', '.')) : 0;
  if(v > 0 && _cambioPendente) _cambioPendente.taxa_cambio = v;
  return v > 0 ? v : 0;
}
// Grava tipo/SWIFT do comprovante na parcela (câmbio futuro não tem BACEN).
function _aplicarTipoCambioNaParcela(idx){
  if(!_cambioPendente || !_parcelas[idx]) return;
  const tipo = _cambioPendente.tipo_cambio || '';
  if(tipo && !_parcelas[idx].tipo_cambio) _parcelas[idx].tipo_cambio = tipo;
  if(_cambioPendente.swift_id && !_parcelas[idx].swift_id) _parcelas[idx].swift_id = _cambioPendente.swift_id;
}

// Identidade do comprovante (contrato BACEN ou mensagem SWIFT).
function _chaveComprovanteCambio(o){
  return String((o && (o.codigo_bacen || o.swift_id)) || '').trim().toUpperCase();
}
// Bug de 29/09/2026 (Ayslan: "às vezes ele puxa 2 lançamentos em 1 arquivo
// só"): o MESMO comprovante acabava gravado em duas parcelas do processo
// (ex.: BR-260714-015CN — o contrato 632806455 de 15/09 ficou na Inicial de
// julho E na Pré-embarque). Acontecia ao reler o comprovante e escolher outra
// parcela: a primeira continuava com taxa/BACEN/data do documento. Agora,
// antes de gravar, avisa e oferece MOVER (limpa o câmbio da parcela antiga).
// Retorna false se o usuário desistiu.
function _resolverComprovanteDuplicado(idx){
  const chave = _chaveComprovanteCambio(_cambioPendente);
  if(!chave) return true;
  const outras = _parcelas.map((p,i)=>({p,i})).filter(({p,i}) => i !== idx && p && _chaveComprovanteCambio(p) === chave);
  if(!outras.length) return true;
  const nomes = outras.map(({p,i}) => '"' + (p.label || ('Parcela ' + (i+1))) + '"' + (p.valor_usd ? ' (US$ ' + fmtUsdBR(p.valor_usd) + ')' : '')).join(', ');
  const destino = '"' + ((_parcelas[idx] && _parcelas[idx].label) || ('Parcela ' + (idx+1))) + '"';
  const mover = confirm(`Este comprovante (${chave}) já está lançado na parcela ${nomes}.\n\n`
    + `OK = MOVER para ${destino} (limpa taxa, BACEN/SWIFT, banco e datas do câmbio da parcela antiga)\n`
    + `Cancelar = não aplicar agora`);
  if(!mover) return false;
  outras.forEach(({i}) => _limparCambioDaParcela(i));
  return true;
}
function _limparCambioDaParcela(i){
  const p = _parcelas[i]; if(!p) return;
  p.cambio_fechado = ''; p.data_fechamento_cambio = ''; p.banco = ''; p.custo_operacao = '';
  p.codigo_bacen = ''; p.swift_id = ''; p.tipo_cambio = '';
}
function fmtUsdBR(v){ return (parseFloat(v)||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); }

function abrirModalConfirmarCambio(match, refAtual){
  _cambioPendente = match;
  const taxa = parseFloat(match.taxa_cambio) || 0;
  const futuro = match.tipo_cambio === 'FUTURO';
  const valorPago = parseFloat(match.valor_pago) || 0;
  const valorUsdRef = parseFloat(match.valor_usd_referencia) || 0;
  const valorUsdImplicito = valorUsdRef || (taxa ? (valorPago/taxa) : 0);
  const info = document.getElementById('cambio-modal-info');
  if(info){
    const custoExtra = parseFloat(match.custo_operacao) || 0;
    const custoTotal = valorUsdImplicito && taxa ? (valorUsdImplicito*taxa + custoExtra) : custoExtra;
    info.innerHTML = (futuro
        ? `<div style="background:#ede9fe;color:#5b21b6;font-weight:700;font-size:12px;padding:6px 10px;border-radius:6px;margin-bottom:8px;">🔮 Câmbio futuro — mensagem SWIFT${match.swift_id ? ' ' + esc(match.swift_id) : ''} (sem código BACEN)</div>`
        : '')
      + `<b>Referência:</b> ${esc(match.referencia||refAtual||'(não identificada no documento)')}<br>`
      + (taxa
        ? `<b>Taxa de câmbio:</b> R$ ${taxa.toLocaleString('pt-BR',{minimumFractionDigits:4})}${futuro ? ' <span style="color:var(--muted);font-size:11px;">(anotada no documento — confira)</span>' : ''}<br>`
        : `<div style="background:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:8px 10px;margin:4px 0 8px;"><b>Taxa de câmbio não encontrada no documento.</b> Digite a taxa fechada: <input id="cambio-modal-taxa-manual" class="form-input" inputmode="decimal" placeholder="ex: 5,0840" style="width:120px;display:inline-block;margin-left:6px;"></div>`)
      + (valorUsdRef ? `<b>Valor desta referência:</b> US$ ${valorUsdRef.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})} (≈ R$ ${(valorUsdRef*taxa).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})} nessa taxa)<br>`
        : valorPago ? `<b>Valor pago:</b> R$ ${valorPago.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})} (≈ US$ ${valorUsdImplicito.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})} nessa taxa)<br>` : '')
      + (match.banco ? `<b>Banco:</b> ${esc(match.banco)}<br>` : '')
      + (match.codigo_bacen ? `<b>Código BACEN:</b> ${esc(match.codigo_bacen)}<br>` : '')
      + (custoExtra ? `<b>Tarifa/IOF discriminado no comprovante:</b> R$ ${custoExtra.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}<br>` : '')
      + (custoTotal ? `<b>Custo total da operação (Valor USD × Câmbio${custoExtra?' + tarifas':''}):</b> R$ ${custoTotal.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}<br>` : '');
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
    // Parcelas existentes + "nova parcela" por etapa (Ayslan 29/09/2026: o
    // câmbio era de Pré-embarque, mas o processo só tinha a parcela Final
    // e o modal não deixava escolher). A nova parcela recebe o valor do
    // comprovante e a parcela em aberto restante é recalculada com o saldo.
    const existentes = _parcelas.map((p,i)=>{
      const label = p.label || ('Parcela ' + (i+1));
      const mesmoDoc = _chaveComprovanteCambio(p) && _chaveComprovanteCambio(p) === _chaveComprovanteCambio(match);
      const jaTemCambio = mesmoDoc ? ' ✓ (este comprovante já está aqui)'
        : (p.cambio_fechado ? (' (câmbio atual: ' + p.cambio_fechado + ')') : '');
      const valor = parseFloat(p.valor_usd) ? (' — US$ ' + parseFloat(p.valor_usd).toLocaleString('pt-BR',{minimumFractionDigits:2})) : '';
      // 06/10/2026 (26DTPI0476-3): a parcela estava com o valor de 30% e o
      // comprovante era de 20% — o botão mostrava só o valor antigo e parecia
      // que o sistema queria usar ele. Agora avisa a diferença no próprio botão.
      const vParc = parseFloat(p.valor_usd) || 0;
      const difere = valorUsdImplicito && vParc && Math.abs(vParc - valorUsdImplicito) >= 0.01 && !mesmoDoc;
      const avisoDif = difere
        ? '<span style="display:block;font-size:11px;font-weight:600;color:#b45309;margin-top:2px;">⚠️ no processo está US$ ' + vParc.toLocaleString('pt-BR',{minimumFractionDigits:2}) + ', o comprovante é US$ ' + valorUsdImplicito.toLocaleString('pt-BR',{minimumFractionDigits:2}) + ' — ao escolher, o sistema pergunta se corrige a parcela para o valor do comprovante e recalcula o saldo.</span>'
        : '';
      return '<button class="btn btn-outline" style="text-align:left;' + (difere ? 'border-color:#f59e0b;' : '') + '" onclick="confirmarCambioParcela(' + i + ')">' + esc(label) + valor + jaTemCambio + avisoDif + '</button>';
    }).join('');
    const novas = PARCELA_ETAPAS.map(et =>
      '<button class="btn btn-outline" style="font-size:12px;padding:6px 10px;" onclick="confirmarCambioNovaParcela(' + jsArg(et) + ')">+ ' + esc(et) + '</button>'
    ).join('');
    boxParcelas.innerHTML = (existentes ? '<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;">Parcela existente</div>' + existentes : '')
      + '<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-top:6px;">Ou criar nova parcela</div>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + novas + '</div>';
  } else if(boxParcelas && boxLegado){
    boxParcelas.style.display = 'none';
    boxLegado.style.display = 'flex';
  }
  document.getElementById('modal-cambio-bg')?.classList.add('open');
}

// Aplica o cambio confirmado do comprovante numa parcela especifica,
// escolhida explicitamente pelo usuario no modal (em vez de tentar
// adivinhar qual parcela esta pendente).
// Resolve o Valor USD de uma parcela a partir do comprovante confirmado.
// Se a parcela ainda estiver vazia, preenche direto (comportamento de
// sempre). Se já tiver um valor digitado que DIVERGE do valor real do
// comprovante, pergunta antes de sobrescrever -- em vez de silenciosamente
// manter o valor antigo (que pode estar errado, ex.: um % estimado que não
// bateu com o câmbio realmente fechado) ou perdê-lo sem avisar. Relato da
// Paula (22/09/2026): "posso fechar algum câmbio com valor errado e o
// sistema não vai identificar" + "o ideal é que ele leia o documento
// depois que eu coloco o câmbio, e recalcule o valor a pagar". Retorna
// true se o valor da parcela mudou (pra quem chamou saber se deve rodar
// o recálculo do residual das demais parcelas).
function resolverValorUsdParcela(idx, valorDoc){
  if(!valorDoc) return false;
  const atual = parseFloat(_parcelas[idx].valor_usd) || 0;
  if(!atual){
    _parcelas[idx].valor_usd = valorDoc.toFixed(2);
    delete _parcelas[idx].valor_vazio_manual;
    return 'preenchido';
  }
  if(Math.abs(atual - valorDoc) < 0.01) return false; // já bate, nada a fazer
  const label = _parcelas[idx].label || ('Parcela ' + (idx+1));
  const ok = confirm(
    '"' + label + '" já está com Valor USD ' + atual.toLocaleString('pt-BR',{minimumFractionDigits:2}) +
    ', mas este comprovante mostra USD ' + valorDoc.toLocaleString('pt-BR',{minimumFractionDigits:2}) + ' para essa referência.\n\n' +
    'Substituir pelo valor do comprovante e recalcular o saldo das demais parcelas?'
  );
  if(ok){
    _parcelas[idx].valor_usd = valorDoc.toFixed(2);
    _parcelas[idx].custo_operacao = ''; // força recalcular com o valor novo
    return 'corrigido';
  }
  return false;
}

// Depois de corrigir o Valor USD de uma parcela pelo comprovante, o saldo
// das outras precisa acompanhar. calcularParcelaResidualAuto() só mexe em
// parcela VAZIA -- mas no caso real da Paula a parcela Final já estava
// preenchida com o saldo calculado a partir do valor errado (ex.: 25.440 -
// 7.596 = 17.844) e ficava assim, sem bater com o total. Aqui: se sobrar
// exatamente UMA outra parcela ainda não paga (sem câmbio fechado), ela
// recebe o saldo (Valor da PI - soma das demais). Parcela já paga nunca é
// mexida; com 2+ em aberto não dá pra saber como dividir -> só preenche
// vazias (comportamento antigo) e o aviso "Parcelas somam X" continua
// aparecendo no resumo. O usuário já confirmou no confirm() anterior
// ("...e recalcular o saldo das demais parcelas?").
function ajustarSaldoAposCorrecao(idx){
  // Base = CI quando houver, senão PI (05/10/2026 — ver baseTotalParcelas).
  const total = baseTotalParcelas().valor;
  const abertas = _parcelas.map((pc,i)=>i).filter(i => i!==idx && !_parcelas[i].cambio_fechado);
  if(!total || abertas.length !== 1){ calcularParcelaResidualAuto(); return; }
  const alvo = abertas[0];
  const somaOutras = _parcelas.reduce((s,pc,i)=> i===alvo ? s : s + (parseFloat(pc.valor_usd)||0), 0);
  const resto = total - somaOutras;
  if(resto > 0){
    _parcelas[alvo].valor_usd = resto.toFixed(2);
    _parcelas[alvo].custo_operacao = ''; // recalculado a partir do novo valor
    delete _parcelas[alvo].valor_vazio_manual;
    if(typeof calcularCustoOperacaoAuto === 'function') calcularCustoOperacaoAuto(alvo);
  }
}

function confirmarCambioParcela(idx){
  if(!_cambioPendente){ fecharModalCambio(); return; }
  const taxa = _taxaCambioPendente();
  if(!taxa){ showToast('Informe a taxa de câmbio antes de confirmar','err'); return; }
  if(!_parcelas[idx]){ fecharModalCambio(); return; }
  if(!_resolverComprovanteDuplicado(idx)) return false;
  _painelDirty = true; // confirmar câmbio muda estado só via JS -- marca sujo manualmente (ver ESC em controle-core.js)
  _parcelas[idx].cambio_fechado = taxa.toFixed(4);
  // Preenche Valor USD e Data também a partir do comprovante — sem isso só a
  // taxa de câmbio era gravada e o usuário tinha que digitar o resto na mão
  // de novo (reclamação da Emanuelly: "só salva o câmbio"). Só preenche se o
  // campo ainda estiver vazio, pra nunca sobrescrever o que o usuário já digitou.
  const valorUsdRefP = parseFloat(_cambioPendente.valor_usd_referencia) || 0;
  const valorPagoP = parseFloat(_cambioPendente.valor_pago) || 0;
  const valorDocP = valorUsdRefP || (valorPagoP && taxa ? valorPagoP/taxa : 0);
  const valorMudouP = resolverValorUsdParcela(idx, valorDocP);
  if(!_parcelas[idx].data_vencimento && _cambioPendente.data_pagamento){
    _parcelas[idx].data_vencimento = _cambioPendente.data_pagamento;
  }
  if(!_parcelas[idx].data_fechamento_cambio){
    _parcelas[idx].data_fechamento_cambio = _cambioPendente.data_pagamento || new Date().toISOString().slice(0,10);
  }
  if(!_parcelas[idx].banco && _cambioPendente.banco){
    _parcelas[idx].banco = normalizarBancoCambio(_cambioPendente.banco);
  }
  if(!_parcelas[idx].codigo_bacen && _cambioPendente.codigo_bacen){
    _parcelas[idx].codigo_bacen = _cambioPendente.codigo_bacen;
  }
  _aplicarTipoCambioNaParcela(idx);
  if(!_parcelas[idx].custo_operacao){
    const custoExtra = parseFloat(_cambioPendente.custo_operacao) || 0;
    const valorUsdFinal = parseFloat(_parcelas[idx].valor_usd) || 0;
    if(valorUsdFinal && taxa){
      _parcelas[idx].custo_operacao = (valorUsdFinal*taxa + custoExtra).toFixed(2);
    } else if(custoExtra){
      _parcelas[idx].custo_operacao = custoExtra.toFixed(2);
    }
  }
  // Se o Valor USD desta parcela mudou (preenchido ou corrigido a partir
  // do comprovante), recalcula automaticamente o saldo das demais parcelas
  // que ainda não têm valor definido -- pedido direto da Paula: depois de
  // aplicar o câmbio real, o valor a pagar do resto deve se ajustar sozinho.
  if(valorMudouP==='corrigido') ajustarSaldoAposCorrecao(idx);
  else if(valorMudouP) calcularParcelaResidualAuto();
  // Inicial corrigida pelo comprovante: o "% Entrada (PI)" acompanha quando
  // o valor bate com um % inteiro da PI (ex.: 4.811,40 / 24.057 = 20%) —
  // senão o campo continuava 30% e contradizia a parcela (06/10/2026).
  if(valorMudouP==='corrigido' && _parcelas[idx].label === 'Inicial'){
    const inpPct = document.getElementById('f_pi_entrada_pct');
    const pi = typeof valorMoeda === 'function' ? (valorMoeda('f_pi_valor_usd') || 0) : 0;
    const pctReal = pi ? (parseFloat(_parcelas[idx].valor_usd) || 0) / pi * 100 : 0;
    if(inpPct && pctReal > 0 && pctReal < 100 && Math.abs(pctReal - Math.round(pctReal)) < 0.05 && String(inpPct.value) !== String(Math.round(pctReal))){
      inpPct.value = String(Math.round(pctReal));
      showToast('% Entrada (PI) ajustado para ' + Math.round(pctReal) + '% conforme o comprovante','ok');
    }
  }
  renderParcelas();
  renderPagamentoInfoLive();
  const label = _parcelas[idx].label || ('Parcela ' + (idx+1));
  showToast('✓ Câmbio (' + taxa.toLocaleString('pt-BR',{minimumFractionDigits:4}) + ') aplicado em "' + label + '"','ok');
  fecharModalCambio();
}

// Cria uma parcela nova (etapa escolhida no modal) com o valor/taxa do
// comprovante. A parcela em aberto que sobrar (ex.: Final) passa a ter o
// saldo = Valor da PI − demais parcelas (ajustarSaldoAposCorrecao).
function confirmarCambioNovaParcela(etapa){
  if(!_cambioPendente){ fecharModalCambio(); return; }
  if(!_taxaCambioPendente()){ showToast('Informe a taxa de câmbio antes de confirmar','err'); return; }
  const nova = {...parcelaVazia(), label: etapa};
  // Entra antes da Final pra manter a ordem natural das etapas.
  const idxFinal = _parcelas.findIndex(pc => pc.label === 'Final');
  const idx = (etapa !== 'Final' && etapa !== 'Ajuste de câmbio' && idxFinal >= 0) ? idxFinal : _parcelas.length;
  _parcelas.splice(idx, 0, nova);
  const valorUsdRef = parseFloat(_cambioPendente.valor_usd_referencia) || 0;
  const valorPago = parseFloat(_cambioPendente.valor_pago) || 0;
  const taxa = _taxaCambioPendente();
  const valorDoc = valorUsdRef || (valorPago && taxa ? valorPago/taxa : 0);
  if(valorDoc) _parcelas[idx].valor_usd = valorDoc.toFixed(2);
  // O saldo da parcela em aberto é refeito abaixo; aqui só aplica câmbio/datas/banco.
  const antes = _parcelas[idx].valor_usd;
  if(confirmarCambioParcela(idx) === false){ _parcelas.splice(idx, 1); renderParcelas(); renderPagamentoInfoLive(); return; }
  if(_parcelas[idx] && _parcelas[idx].valor_usd === antes) ajustarSaldoAposCorrecao(idx);
  renderParcelas();
  renderPagamentoInfoLive();
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
  _painelDirty = true; // confirmar câmbio muda estado só via JS -- marca sujo manualmente (ver ESC em controle-core.js)
  let idx = _parcelas.findIndex(pc => !pc.cambio_fechado);
  if(idx===-1){
    adicionarParcela(); // já chama renderParcelas()+renderPagamentoInfoLive()
    idx = _parcelas.length - 1;
  }
  if(!_resolverComprovanteDuplicado(idx)) return idx;
  _parcelas[idx].cambio_fechado = taxa.toFixed(4);
  // Mesma correção do confirmarCambioParcela: também preenche/corrige o
  // Valor USD e Data a partir do comprovante -- usa resolverValorUsdParcela
  // pra perguntar antes de sobrescrever um valor já digitado que divergir
  // do documento real (ver comentário da função).
  const valorUsdRefP2 = parseFloat(_cambioPendente?.valor_usd_referencia) || 0;
  const valorPagoP2 = parseFloat(_cambioPendente?.valor_pago) || 0;
  const valorDocP2 = valorUsdRefP2 || (valorPagoP2 && taxa ? valorPagoP2/taxa : 0);
  const valorMudouP2 = resolverValorUsdParcela(idx, valorDocP2);
  if(!_parcelas[idx].data_vencimento && _cambioPendente?.data_pagamento){
    _parcelas[idx].data_vencimento = _cambioPendente.data_pagamento;
  }
  if(!_parcelas[idx].data_fechamento_cambio){
    _parcelas[idx].data_fechamento_cambio = _cambioPendente?.data_pagamento || new Date().toISOString().slice(0,10);
  }
  if(!_parcelas[idx].banco && _cambioPendente?.banco){
    _parcelas[idx].banco = normalizarBancoCambio(_cambioPendente.banco);
  }
  if(!_parcelas[idx].codigo_bacen && _cambioPendente?.codigo_bacen){
    _parcelas[idx].codigo_bacen = _cambioPendente.codigo_bacen;
  }
  _aplicarTipoCambioNaParcela(idx);
  if(!_parcelas[idx].custo_operacao){
    const custoExtra2 = parseFloat(_cambioPendente?.custo_operacao) || 0;
    const valorUsdFinal2 = parseFloat(_parcelas[idx].valor_usd) || 0;
    if(valorUsdFinal2 && taxa){
      _parcelas[idx].custo_operacao = (valorUsdFinal2*taxa + custoExtra2).toFixed(2);
    } else if(custoExtra2){
      _parcelas[idx].custo_operacao = custoExtra2.toFixed(2);
    }
  }
  if(valorMudouP2==='corrigido') ajustarSaldoAposCorrecao(idx);
  else if(valorMudouP2) calcularParcelaResidualAuto();
  renderParcelas();
  renderPagamentoInfoLive();
  return idx;
}

function confirmarCambioComo(tipo){
  if(!_cambioPendente){ fecharModalCambio(); return; }
  const taxa = _taxaCambioPendente();
  if(!taxa){ showToast('Informe a taxa de câmbio antes de confirmar','err'); return; }

  _painelDirty = true; // confirmar câmbio muda estado só via JS -- marca sujo manualmente (ver ESC em controle-core.js)
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
    aplicarBancoCustoLegado();
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
    aplicarBancoCustoLegado();
    renderPagamentoInfoLive();
  }
  showToast(`✓ Câmbio (${taxa.toLocaleString('pt-BR',{minimumFractionDigits:4})}) aplicado como ${tipo==='unico'?'Pagamento Único':tipo==='entrada'?'Entrada':'Saldo'} — PI marcada de acordo`,'ok');
  fecharModalCambio();
}

// Banco/Custo da operação a nível de processo (Único/Entrada+Saldo legado
// -- ver comentário acima sobre Código BACEN não ter equivalente aqui).
// Só preenche se o campo ainda estiver vazio, mesmo padrão do resto do
// fluxo de confirmação de comprovante.
function aplicarBancoCustoLegado(){
  if(_cambioPendente?.banco){
    const elBanco = document.getElementById('f_pi_cambio_banco');
    if(elBanco && !elBanco.value) elBanco.value = normalizarBancoCambio(_cambioPendente.banco);
  }
  // Câmbio futuro (pagamento único/entrada+saldo): sem campo próprio no
  // processo — grava "SWIFT <id>" no Código BACEN, e o Controle Cambial
  // reconhece como câmbio futuro por esse prefixo (tipoCambioDe).
  const idOperacao = _cambioPendente?.codigo_bacen
    || (_cambioPendente?.tipo_cambio === 'FUTURO' ? ('SWIFT ' + (_cambioPendente.swift_id || '')).trim() : '');
  if(idOperacao){
    const elBacen = document.getElementById('f_pi_cambio_codigo_bacen');
    if(elBacen && !elBacen.value) elBacen.value = idOperacao;
  }
  const elCusto = document.getElementById('f_pi_cambio_custo');
  if(elCusto && !elCusto.value){
    const taxaL = parseFloat(_cambioPendente?.taxa_cambio) || 0;
    const valorUsdRefL = parseFloat(_cambioPendente?.valor_usd_referencia) || 0;
    const valorPagoL = parseFloat(_cambioPendente?.valor_pago) || 0;
    const valorUsdImplicitoL = valorUsdRefL || (taxaL ? (valorPagoL/taxaL) : 0);
    const custoExtraL = parseFloat(_cambioPendente?.custo_operacao) || 0;
    // Bug (Emanuelly 05/10/2026): gravava "12345.67" (ponto decimal do JS)
    // num campo com máscara pt-BR; ao salvar, valorMoeda() tirava o ponto
    // como se fosse milhar e o custo ficava 100x maior (R$ 1.234.567,00).
    // Agora preenche no formato da máscara (12.345,67). Valores fictícios.
    if(valorUsdImplicitoL && taxaL){
      elCusto.value = exibirMoeda(+(valorUsdImplicitoL*taxaL + custoExtraL).toFixed(2));
    } else if(custoExtraL){
      elCusto.value = exibirMoeda(+custoExtraL.toFixed(2));
    }
  }
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
  const n = parseValorMoeda(el.value);
  return n===''||n==null ? null : n;
}
// Mesmo parsing de valorMoeda(id), mas recebendo a string direto -- usado
// nos campos de Parcela, que são gerados num loop e não têm id fixo (não
// dá pra usar getElementById). Devolve '' (não null) em vazio/inválido pra
// bater com o que _parcelas[i].campo já guardava antes (era this.value de
// um <input type=\"number\">, que também vem '' quando vazio).
function parseValorMoeda(str){
  if(!str) return '';
  const s = String(str).trim();
  // Número com ponto decimal (ex.: "12345.67", vindo de código ou colado de
  // outro sistema) e sem vírgula: o ponto é decimal, não milhar — senão o
  // valor ficava 100x maior (bug do Custo da Operação, 05/10/2026). "1.234"
  // (3 dígitos depois do ponto) continua sendo milhar, como na máscara.
  if(!s.includes(',') && /^-?\d+\.\d{1,2}$/.test(s)){
    const n0 = parseFloat(s);
    return isNaN(n0) ? '' : n0;
  }
  const limpo = s.replace(/\./g,'').replace(',','.');
  const n = parseFloat(limpo);
  return isNaN(n) ? '' : n;
}
function exibirMoeda(v){
  if(v===null||v===undefined||v==='') return '';
  return parseFloat(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
}


function escContainerLocal(s){
  return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
