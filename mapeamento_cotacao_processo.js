/**
 * MAPEAMENTO: Cotação do Calculador → Processo do Controle
 * ════════════════════════════════════════════════════════════════
 * Função pura (sem I/O, sem banco) que traduz os dados de uma cotação
 * salva (`calculador_cotacoes.dados`, no formato que `coletarEstadoFormulario()`
 * gera em calculador.html) para um objeto de processo pronto para ser
 * inserido em `controle_processos`.
 *
 * Fica isolada num arquivo próprio (em vez de dentro de server.js) pra dar
 * pra testar sem precisar subir o servidor Express — ver testes_aprovacao.js.
 *
 * IMPORTANTE: isso só preenche o que dá pra inferir com segurança da
 * cotação. Muita coisa do processo (booking, portos específicos, datas de
 * embarque, número da PI, etc.) não existe na cotação e fica em branco de
 * propósito — o usuário completa depois de aprovado, dentro do Controle.
 */

const NCM_POR_TIPO = {
  TBR: 40112090,
  PCR: 40111000,
  AGR: 40117090,
  OTR: 40118090,
};

const LABEL_TIPO = {
  TBR: 'Pneu Caminhão (TBR)',
  PCR: 'Pneu Automóvel (PCR)',
  AGR: 'Pneu Agrícola (AGR)',
  OTR: 'Pneu Outros/Máquina (OTR)',
};

const FINALIDADE_POR_TIPO_IMPORTACAO = {
  PROPRIA: 'IMPORTACAO_DIRETA',
  ENCOMENDA: 'ENCOMENDA',
  // IMPLEMENTOS e TRANSPORTADORA não têm equivalente direto em `finalidade`
  // — fica sem valor e a observação registra o tipo original.
};

// Mapeia cada item de CUSTOS_REAIS_CONFIG (controle-core.js) pro caminho
// correspondente dentro de `custos_cotados_json` (o formato salvo pelo
// Calculador em `resumo.custos_cotados_json`, ver calculador.html). Não dá
// pra reaproveitar CUSTOS_REAIS_CONFIG diretamente aqui porque esse arquivo
// roda em Node (sem os globais de browser que controle-core.js espera) —
// então mantemos essa cópia enxuta, só com o que é preciso pra gerar o
// `real_json` inicial no momento da aprovação. Ver CUSTOS_REAIS_CONFIG em
// controle-core.js pra a lista "oficial" (mesmos ids/unidades/porContainer).
// FIX (a pedido do usuário): FOB/Frete/Seguro/Taxa C.E. e as Taxas em USD
// (destino) eram unidade:'USD' aqui — mas o Calculador (resumoParaLista() em
// calculador.html) já converte esses itens pro câmbio certo de cada um antes
// de gravar em custos_cotados_json (câmbio ponderado pelas parcelas pro FOB,
// câmbio de abertura+2% pro Frete/Seguro/Taxas em USD, câmbio único da
// simulação pra Taxa C.E.) — então aqui é só BRL puro agora, sem conversão.
const ITENS_CUSTOS_REAIS = [
  // Compra e Frete (BRL — já convertidas pelo câmbio de cada item no Calculador)
  { id: 'fob',     unidade: 'BRL', porContainer: false, get: c => c?.compra?.fob },
  { id: 'frete',   unidade: 'BRL', porContainer: false, get: c => c?.compra?.frete },
  { id: 'seguro',  unidade: 'BRL', porContainer: false, get: c => c?.compra?.seguro_usd },
  { id: 'taxa_ce', unidade: 'BRL', porContainer: false, get: c => c?.compra?.taxa_ce },
  // Impostos de Importacao (BRL, apenasPago - sem "cobrado do cliente",
  // ver gerarRealJsonInicial abaixo: estes continuam indo pro campo comum,
  // nao pro sufixo _cobrado, porque nao existe esse conceito pra imposto).
  { id: 'ii',      unidade: 'BRL', porContainer: false, apenasPago: true, get: c => c?.impostos?.ii },
  { id: 'ipi',     unidade: 'BRL', porContainer: false, apenasPago: true, get: c => c?.impostos?.ipi },
  { id: 'pis',     unidade: 'BRL', porContainer: false, apenasPago: true, get: c => c?.impostos?.pis },
  { id: 'cofins',  unidade: 'BRL', porContainer: false, apenasPago: true, get: c => c?.impostos?.cofins },
  { id: 'icms',    unidade: 'BRL', porContainer: false, apenasPago: true, get: c => c?.impostos?.icms },
  { id: 'ibs',     unidade: 'BRL', porContainer: false, apenasPago: true, get: c => c?.impostos?.ibs },
  { id: 'cbs',     unidade: 'BRL', porContainer: false, apenasPago: true, get: c => c?.impostos?.cbs },
  { id: 'antidumping', unidade: 'BRL', porContainer: false, apenasPago: true, get: c => c?.impostos?.antidumping },
  // Comissões (BRL)
  { id: 'comissao_br',    unidade: 'BRL', porContainer: false, get: c => c?.comissoes?.br },
  { id: 'comissao_china', unidade: 'BRL', porContainer: false, get: c => c?.comissoes?.china },
  { id: 'comissao_boss',  unidade: 'BRL', porContainer: false, get: c => c?.comissoes?.boss },
  // Taxas Operacionais — fixas em BRL, porContainer:true
  { id: 'siscomex',      unidade: 'BRL', porContainer: true,  get: c => c?.taxas_fixas?.siscomex },
  { id: 'marinha',       unidade: 'BRL', porContainer: true,  get: c => c?.taxas_fixas?.marinha },
  { id: 'emissao_li',    unidade: 'BRL', porContainer: true,  get: c => c?.taxas_fixas?.emissao_li },
  { id: 'baixa_patio',   unidade: 'BRL', porContainer: true,  get: c => c?.taxas_fixas?.baixa_patio },
  { id: 'capatazia',     unidade: 'BRL', porContainer: true,  get: c => c?.taxas_fixas?.capatazia },
  { id: 'liberacao_bl',  unidade: 'BRL', porContainer: true,  get: c => c?.taxas_fixas?.liberacao_bl },
  { id: 'despachante',   unidade: 'BRL', porContainer: true,  get: c => c?.taxas_fixas?.despachante },
  { id: 'sda',           unidade: 'BRL', porContainer: true,  get: c => c?.taxas_fixas?.sda },
  { id: 'lavacao',       unidade: 'BRL', porContainer: true,  get: c => c?.taxas_fixas?.lavacao },
  { id: 'administrativo', unidade: 'BRL', porContainer: true, get: c => c?.taxas_fixas?.administrativo },
  { id: 'agente',        unidade: 'BRL', porContainer: true,  get: c => c?.taxas_fixas?.agente },
  // Taxas Operacionais — fixas em BRL, porContainer:false
  { id: 'armazenagem',    unidade: 'BRL', porContainer: false, get: c => c?.taxas_fixas?.armazenagem },
  { id: 'custos_diversos', unidade: 'BRL', porContainer: false, get: c => c?.custos_diversos },
  { id: 'seguro_venda',    unidade: 'BRL', porContainer: false, get: c => c?.seguro_venda },
  // Taxas Operacionais — em BRL (já convertidas pelo câmbio de abertura+2% no Calculador), porContainer:true
  { id: 'handling',         unidade: 'BRL', porContainer: true, get: c => c?.taxas_usd?.handling },
  { id: 'additional_costs', unidade: 'BRL', porContainer: true, get: c => c?.taxas_usd?.additional_costs },
  { id: 'import_logistics', unidade: 'BRL', porContainer: true, get: c => c?.taxas_usd?.import_logistics },
  { id: 'trs',               unidade: 'BRL', porContainer: true, get: c => c?.taxas_usd?.trs },
  { id: 'tsc',               unidade: 'BRL', porContainer: true, get: c => c?.taxas_usd?.tsc },
  { id: 'drop_off',          unidade: 'BRL', porContainer: true, get: c => c?.taxas_usd?.drop_off },
  { id: 'isps',              unidade: 'BRL', porContainer: true, get: c => c?.taxas_usd?.isps },
  { id: 'iof',               unidade: 'BRL', porContainer: true, get: c => c?.taxas_usd?.iof },
  { id: 'desconsolidacao',   unidade: 'BRL', porContainer: true, get: c => c?.taxas_usd?.desconsolidacao },
];

function numOuNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Gera o `real_json` inicial de um processo a partir do `custos_cotados_json`
 * salvo na cotação aprovada (mesma estrutura que calculador.html grava em
 * `resumo.custos_cotados_json` — ver comentário lá, "pra virar o ponto de
 * partida ('Cotado') quando o processo em Controle abrir a aba Custos
 * Reais"). Antes disso só era usado como sugestão passiva de UI (preenchia
 * o placeholder "Cotado: ..." mas exigia alguém abrir a aba e salvar); agora
 * grava direto no processo no momento da aprovação.
 *
 * IMPORTANTE (fix a pedido do usuario): os valores da cotacao sao o que vai
 * ser CHARGED ao cliente (a proposta), nao o que a Impak efetivamente pagou
 * a fornecedor/agente - entao cada item populado vira
 * `real_json[item.id + '_cobrado'] = { valor, moeda: item.unidade }`, nao
 * `real_json[item.id]`. O campo "Pago" fica em branco ate alguem lancar o
 * valor real pago, com base nos comprovantes (aba Custos Reais). Excecao:
 * itens `apenasPago:true` (Impostos de Importacao - ver
 * CUSTOS_REAIS_CONFIG/ITENS_CUSTOS_REAIS) nao tem o conceito de "cobrado do
 * cliente" (sao so um valor a pagar pro governo), entao continuam indo pro
 * campo comum `real_json[item.id]`, igual sempre foi.
 *
 * Itens `porContainer:true` têm o valor unitário multiplicado pela
 * quantidade de containers da cotação (mesma lógica de
 * `calcularCustoCotadoItem` em controle-core.js).
 *
 * Retorna `null` se não houver `custosCotados` ou nenhum item populado —
 * nesse caso o processo fica sem `real_json` (aba abre em branco, igual
 * hoje pra processos criados direto no Controle).
 */
function gerarRealJsonInicial(custosCotados) {
  if (!custosCotados) return null;
  const containers = numOuNull(custosCotados.containers) || 1;
  const realJson = {};
  let algumItem = false;
  for (const item of ITENS_CUSTOS_REAIS) {
    const base = numOuNull(item.get(custosCotados));
    if (base === null) continue;
    const valor = item.porContainer ? base * containers : base;
    const chave = item.apenasPago ? item.id : (item.id + '_cobrado');
    realJson[chave] = { valor: Math.round(valor * 100) / 100, moeda: item.unidade };
    algumItem = true;
  }
  return algumItem ? realJson : null;
}

// Gera uma referência sugerida e legível a partir do nome do cliente + data.
// Não é garantidamente única (o backend do Controle não valida unicidade de
// referência hoje — ver investigação), mas serve como ponto de partida bom
// o bastante pro usuário ajustar se quiser, em vez de começar em branco.
//
// Usa getters UTC (não locais) pra data ser determinística independente do
// fuso horário de quem roda (sandbox de teste x servidor Railway) — evita
// a referência "pular" de dia dependendo de onde o código executa.
function gerarReferenciaSugerida(cliente, agora) {
  const dt = agora || new Date();
  const nomeLimpo = (cliente || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
  const palavras = nomeLimpo ? nomeLimpo.split(/\s+/) : [];
  let prefixo;
  if (palavras.length > 1) {
    // Nome com várias palavras: iniciais de cada uma (ex: "Transportadora Rio Verde" → "TRV")
    prefixo = palavras.map(p => p[0]).join('').slice(0, 4);
  } else if (palavras.length === 1) {
    // Nome de uma palavra só: usa o próprio nome (ex: "Impak" → "IMPA"), não uma letra só
    prefixo = palavras[0].slice(0, 4);
  } else {
    // Sem cliente algum: fallback fixo
    prefixo = 'PROC';
  }
  const yy = String(dt.getUTCFullYear()).slice(-2);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  const sufixo = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `${prefixo}${yy}${mm}${dd}-${sufixo}`;
}

/**
 * @param {object} dadosCotacao - objeto `dados` da cotação (campos + mix + toggles)
 * @param {string} cliente - nome do cliente (campo top-level da cotação)
 * @param {object} [opts]
 * @param {Date}   [opts.agora] - injeção de data pra teste determinístico
 * @returns {object} processo pronto pra `upsert` em controle_processos (sem id/referencia definitivos)
 */
function mapearCotacaoParaProcesso(dadosCotacao, cliente, opts = {}) {
  const d = (dadosCotacao && dadosCotacao.campos) || {};
  const toggles = (dadosCotacao && dadosCotacao.toggles) || {};
  const mix = (dadosCotacao && dadosCotacao.mix) || null;
  const agora = opts.agora || new Date();

  const observacoes = [];

  // ── Produtos ──────────────────────────────────────────────
  let produtosJson;
  if (mix && Array.isArray(mix.itens) && mix.itens.length) {
    produtosJson = mix.itens.map(it => ({
      descricao: it.medida || '',
      quantidade: numOuNull(it.qtd),
    }));
  } else {
    produtosJson = [{
      descricao: LABEL_TIPO[d.produto] || d.produto || '',
      quantidade: null,
    }];
  }

  // ── Fornecedor (só existe se a cotação veio do TyreDesk) ─────
  const fornecedor = (mix && mix.forn) ? mix.forn : '';
  if (!fornecedor && d.origem && d.origem !== 'DIVERSOS') {
    observacoes.push(`Origem: ${d.origem}`);
  }

  // ── Pagamento (à vista x parcelado) ──────────────────────────
  // Parcelas (item e) ficam em dadosCotacao.parcelas — sibling de `campos`,
  // não dentro dele, porque é uma lista (mesmo padrão de `mix`). MESMO
  // formato do Controle (ver PARCELA_ETAPAS/parcelaVazia em
  // controle-campos.js) — desde que o Calculador ganhou Câmbio Fechado e
  // Valor Recebido do Cliente como campos próprios (não mais só
  // label/valor_usd/data), migra 1:1 sem perder nada.
  const parcelasCotacao = (dadosCotacao && Array.isArray(dadosCotacao.parcelas)) ? dadosCotacao.parcelas : [];
  const parcelasValidas = parcelasCotacao.filter(p => numOuNull(p.valor_usd) !== null || numOuNull(p.cambio_fechado) !== null);
  let pi_pagamento = 'VISTA';
  let pi_parcelas_json = null;
  if (parcelasValidas.length) {
    pi_pagamento = 'PARCELADO';
    pi_parcelas_json = JSON.stringify(parcelasValidas.map(p => ({
      label: p.label || '',
      valor_usd: p.valor_usd || '',
      data_vencimento: p.data_vencimento || p.data || '',
      cambio_fechado: p.cambio_fechado || '',
      valor_recebido_cliente: p.valor_recebido_cliente || '',
      data_recebimento: p.data_recebimento || '',
    })));
  }

  // ── Finalidade ────────────────────────────────────────────
  const finalidade = FINALIDADE_POR_TIPO_IMPORTACAO[d.tipo_importacao] || '';
  if (d.tipo_importacao && !finalidade) {
    observacoes.push(`Tipo de importação (Calculador): ${d.tipo_importacao}`);
  }

  // ── Antidumping ───────────────────────────────────────────
  if (toggles.dump === 'SIM' && numOuNull(d.dump_valor)) {
    observacoes.push(`Antidumping estimado na cotação: US$ ${d.dump_valor}`);
  }

  // ── Containers ────────────────────────────────────────────
  const qtdeContainers = numOuNull(d.qtde_containers) || 1;
  const containersJson = Array.from({ length: qtdeContainers }, () => ({
    numero: '', tipo: '40HC', lacre: '',
  }));

  const processo = {
    referencia: gerarReferenciaSugerida(cliente, agora),
    finalidade,
    fornecedor,
    cliente: cliente || '',
    produto: produtosJson[0] ? produtosJson[0].descricao : '',
    produtos_json: produtosJson,
    containers_json: containersJson,
    pi_valor_usd: numOuNull(d.fob_usd),
    pi_incoterm: 'FOB',
    pi_pagamento,
    pi_parcelas_json,
    pi_cambio: numOuNull(d.cambio_usd),
    valor_frete: numOuNull(d.frete_usd),
    moeda_frete: 'USD',
    fase: 'PI',
    obs: observacoes.join(' · '),
  };

  return processo;
}

// Inverso de FINALIDADE_POR_TIPO_IMPORTACAO — só as chaves que têm ida e volta.
const TIPO_IMPORTACAO_POR_FINALIDADE = Object.fromEntries(
  Object.entries(FINALIDADE_POR_TIPO_IMPORTACAO).map(([k, v]) => [v, k])
);

/**
 * MAPEAMENTO REVERSO: Processo do Controle → Cotação do Calculador
 * ════════════════════════════════════════════════════════════════
 * Usado pelo botão "Vincular ao Calculador" (aba Custos Reais, item e) —
 * quando um processo começou direto no Controle (sem passar pelo Calculador)
 * e o usuário quer gerar uma cotação a partir dele, pra ter a estimativa/
 * fechamento registrados. Abre o wizard do Calculador já pré-preenchido
 * (`aplicarEstadoFormulario`) pra revisão — o usuário confere e completa o
 * que não dá pra inferir com segurança (Taxa C.E., classificação NCM/UF,
 * comissões, taxas operacionais etc.) antes de salvar.
 *
 * Só mapeia o que existe de forma inequívoca no processo — o resto fica em
 * branco de propósito, igual ao mapeamento direto faz com o processo.
 *
 * @param {object} processo - linha de controle_processos
 * @returns {object} `dados` no formato de coletarEstadoFormulario() (campos/toggles/mix/parcelas)
 */
function mapearProcessoParaCotacao(processo) {
  const p = processo || {};
  const campos = {};

  if (p.cliente) campos.cliente = p.cliente;
  if (numOuNull(p.pi_cambio) !== null) campos.cambio_usd = p.pi_cambio;
  if (numOuNull(p.pi_valor_usd) !== null) campos.fob_usd = p.pi_valor_usd;
  // Frete só é confiável migrar se já estiver em USD (o Calculador não tem
  // campo de moeda pro frete — é sempre USD lá).
  if ((p.moeda_frete || 'USD') === 'USD' && numOuNull(p.valor_frete) !== null) {
    campos.frete_usd = p.valor_frete;
  }

  let containers = [];
  try { containers = Array.isArray(p.containers_json) ? p.containers_json : JSON.parse(p.containers_json || '[]'); } catch (e) { containers = []; }
  if (containers.length) campos.qtde_containers = containers.length;

  if (p.finalidade && TIPO_IMPORTACAO_POR_FINALIDADE[p.finalidade]) {
    campos.tipo_importacao = TIPO_IMPORTACAO_POR_FINALIDADE[p.finalidade];
  }

  // Parcelas — só migra se o processo já usa a forma de pagamento "PARCELADO"
  // (pi_parcelas_json). Desde que o Calculador ganhou os mesmos campos do
  // Controle (Câmbio Fechado, Valor Recebido do Cliente, Data Recebimento),
  // migra tudo — inclusive esses, que antes ficavam pra trás de propósito.
  let parcelas = [];
  if (p.pi_pagamento === 'PARCELADO') {
    let parcelasProcesso = [];
    try { parcelasProcesso = Array.isArray(p.pi_parcelas_json) ? p.pi_parcelas_json : JSON.parse(p.pi_parcelas_json || '[]'); } catch (e) { parcelasProcesso = []; }
    parcelas = parcelasProcesso
      .filter(pc => numOuNull(pc.valor_usd) !== null || numOuNull(pc.cambio_fechado) !== null)
      .map(pc => ({
        label: pc.label || '',
        valor_usd: pc.valor_usd || '',
        data_vencimento: pc.data_vencimento || '',
        cambio_fechado: pc.cambio_fechado || '',
        valor_recebido_cliente: pc.valor_recebido_cliente || '',
        data_recebimento: pc.data_recebimento || '',
      }));
  }

  return { campos, toggles: {}, togglesInner: {}, mix: null, splitST: {}, checkboxes: {}, parcelas };
}

/**
 * Extrai só os números "cotados" (custo/faturamento/lucro estimados, dos dois
 * cenários) do resumo salvo na cotação, descartando os campos de ciclo de vida
 * da cotação em si (status, processo_id, aprovado_por etc.) — esses ficam só
 * na cotação, não fazem sentido dentro do processo. Usado por
 * POST /api/calculador/cotacoes/:id/aprovar pra preencher `estimativa_json`
 * no processo recém-criado, e comparar depois com o resultado real (ver
 * seção Fechamento em controle_v2.html).
 *
 * Retorna null se não sobrar nenhum número (cotação nunca foi calculada).
 */
function extrairEstimativa(resumo) {
  if (!resumo) return null;
  const {
    status, processo_id, processo_referencia, data_aprovacao, aprovado_por,
    motivo_perda, data_rejeicao, rejeitado_por,
    ...estimativa
  } = resumo;
  return Object.keys(estimativa).length ? estimativa : null;
}

module.exports = {
  mapearCotacaoParaProcesso,
  mapearProcessoParaCotacao,
  gerarReferenciaSugerida,
  extrairEstimativa,
  gerarRealJsonInicial,
  NCM_POR_TIPO,
};
