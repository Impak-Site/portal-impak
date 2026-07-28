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
const ITENS_CUSTOS_REAIS = [
  // Compra e Frete (USD)
  { id: 'fob',     unidade: 'USD', porContainer: false, get: c => c?.compra?.fob },
  { id: 'frete',   unidade: 'USD', porContainer: false, get: c => c?.compra?.frete },
  { id: 'seguro',  unidade: 'USD', porContainer: false, get: c => c?.compra?.seguro_usd },
  { id: 'taxa_ce', unidade: 'USD', porContainer: false, get: c => c?.compra?.taxa_ce },
  // Impostos de Importação (BRL, apenasPago)
  { id: 'ii',      unidade: 'BRL', porContainer: false, get: c => c?.impostos?.ii },
  { id: 'ipi',     unidade: 'BRL', porContainer: false, get: c => c?.impostos?.ipi },
  { id: 'pis',     unidade: 'BRL', porContainer: false, get: c => c?.impostos?.pis },
  { id: 'cofins',  unidade: 'BRL', porContainer: false, get: c => c?.impostos?.cofins },
  { id: 'icms',    unidade: 'BRL', porContainer: false, get: c => c?.impostos?.icms },
  { id: 'ibs',     unidade: 'BRL', porContainer: false, get: c => c?.impostos?.ibs },
  { id: 'cbs',     unidade: 'BRL', porContainer: false, get: c => c?.impostos?.cbs },
  { id: 'antidumping', unidade: 'BRL', porContainer: false, get: c => c?.impostos?.antidumping },
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
  // Taxas Operacionais — em USD, porContainer:true
  { id: 'handling',         unidade: 'USD', porContainer: true, get: c => c?.taxas_usd?.handling },
  { id: 'additional_costs', unidade: 'USD', porContainer: true, get: c => c?.taxas_usd?.additional_costs },
  { id: 'import_logistics', unidade: 'USD', porContainer: true, get: c => c?.taxas_usd?.import_logistics },
  { id: 'trs',               unidade: 'USD', porContainer: true, get: c => c?.taxas_usd?.trs },
  { id: 'tsc',               unidade: 'USD', porContainer: true, get: c => c?.taxas_usd?.tsc },
  { id: 'drop_off',          unidade: 'USD', porContainer: true, get: c => c?.taxas_usd?.drop_off },
  { id: 'isps',              unidade: 'USD', porContainer: true, get: c => c?.taxas_usd?.isps },
  { id: 'iof',               unidade: 'USD', porContainer: true, get: c => c?.taxas_usd?.iof },
  { id: 'desconsolidacao',   unidade: 'USD', porContainer: true, get: c => c?.taxas_usd?.desconsolidacao },
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
 * grava direto no processo no momento da aprovação, então a aba Custos Reais
 * já abre com os valores da cotação como "Pago".
 *
 * Cada item populado vira `real_json[item.id] = { valor, moeda: item.unidade }`.
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
    realJson[item.id] = { valor: Math.round(valor * 100) / 100, moeda: item.unidade };
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

  // ── Pagamento (FOB à vista x FOB parcelado) ──────────────────
  let pi_pagamento = 'VISTA';
  let pi_entrada_pct = null, pi_cambio_entrada = null, pi_cambio_saldo = null;
  if (toggles.fobpar === 'SIM') {
    pi_pagamento = 'ENTRADA_SALDO';
    pi_entrada_pct = numOuNull(d.pct_fob_entrada);
    pi_cambio_entrada = numOuNull(d.cambio_fob_entrada);
    pi_cambio_saldo = numOuNull(d.cambio_fob_saldo);
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
    pi_entrada_pct,
    pi_cambio_entrada,
    pi_cambio_saldo,
    pi_cambio: numOuNull(d.cambio_usd),
    valor_frete: numOuNull(d.frete_usd),
    moeda_frete: 'USD',
    fase: 'PI',
    obs: observacoes.join(' · '),
  };

  return processo;
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
  gerarReferenciaSugerida,
  extrairEstimativa,
  gerarRealJsonInicial,
  NCM_POR_TIPO,
};
