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

function numOuNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

module.exports = { mapearCotacaoParaProcesso, gerarReferenciaSugerida, extrairEstimativa, NCM_POR_TIPO };
