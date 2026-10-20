/**
 * TESTES AUTOMATIZADOS — Aprovar Cotação → Criar Processo (LAB)
 * ════════════════════════════════════════════════════════════════
 * Roda com: node testes_aprovacao.js
 *
 * Testa a função pura mapearCotacaoParaProcesso() (mapeamento_cotacao_processo.js),
 * que traduz os dados salvos de uma cotação do Calculador para um objeto de
 * processo pronto para o Controle. É pura (sem banco, sem servidor) — só
 * lógica de mapeamento de campos.
 */

const { mapearCotacaoParaProcesso, mapearProcessoParaCotacao, gerarReferenciaSugerida, extrairEstimativa, gerarRealJsonInicial } = require('./mapeamento_cotacao_processo.js');

let totalTestes = 0, totalFalhas = 0;
function teste(nome, fn) {
  totalTestes++;
  try { fn(); console.log(`  ✓ ${nome}`); }
  catch (e) { totalFalhas++; console.log(`  ✗ ${nome}\n      ${e.message}`); }
}
function iguais(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(msg || `esperado ${JSON.stringify(b)}, recebido ${JSON.stringify(a)}`);
  }
}
function verdadeiro(a, msg) {
  if (!a) throw new Error(msg || `esperado valor verdadeiro, recebido "${a}"`);
}

// ── Caso 1: cotação simples, feita do zero no Calculador (sem mix do TyreDesk) ──
console.log('\n📋 Cotação simples (sem TyreDesk) — caso base');
{
  const dados = {
    campos: {
      produto: 'PCR', origem: 'CHINA', fob_usd: '27812.96', frete_usd: '1000',
      cambio_usd: '5.1695', qtde_containers: '1', tipo_importacao: 'PROPRIA',
    },
    toggles: { dump: 'NAO' },
    mix: null,
  };
  const p = mapearCotacaoParaProcesso(dados, 'Cliente Teste', { agora: new Date('2026-07-15') });

  teste('gera referência não vazia', () => {
    verdadeiro(p.referencia && p.referencia.length > 3);
  });
  teste('finalidade PROPRIA vira IMPORTACAO_DIRETA', () => {
    iguais(p.finalidade, 'IMPORTACAO_DIRETA');
  });
  teste('fornecedor fica vazio (sem mix)', () => {
    iguais(p.fornecedor, '');
  });
  teste('registra origem em obs quando não tem fornecedor', () => {
    verdadeiro(p.obs.includes('CHINA'));
  });
  teste('pi_valor_usd = fob_usd', () => {
    iguais(p.pi_valor_usd, 27812.96);
  });
  teste('pi_incoterm default FOB', () => {
    iguais(p.pi_incoterm, 'FOB');
  });
  teste('pi_pagamento VISTA quando não tem parcelas', () => {
    iguais(p.pi_pagamento, 'VISTA');
  });
  teste('valor_frete = frete_usd, moeda USD', () => {
    iguais(p.valor_frete, 1000);
    iguais(p.moeda_frete, 'USD');
  });
  teste('fase default PI', () => {
    iguais(p.fase, 'PI');
  });
  teste('1 container gerado a partir de qtde_containers', () => {
    iguais(p.containers_json.length, 1);
    iguais(p.containers_json[0].tipo, '40HC');
  });
  teste('produto derivado do tipo (PCR) sem mix', () => {
    verdadeiro(p.produtos_json[0].descricao.includes('PCR') || p.produtos_json[0].descricao.includes('Automóvel'));
  });
}

// ── Caso 2: cotação com mix do TyreDesk (tem fornecedor + itens reais) ──
console.log('\n📋 Cotação com mix do TyreDesk — fornecedor e itens reais');
{
  const dados = {
    campos: { produto: 'TBR', origem: 'CHINA', fob_usd: '50000', frete_usd: '2000', qtde_containers: '2' },
    toggles: {},
    mix: {
      forn: 'EUDEMON',
      fob_total: 50000,
      containers: 2,
      itens: [
        { medida: '295/80R22.5', qtd: 100, preco: 250 },
        { medida: '11R22.5', qtd: 50, preco: 200 },
      ],
    },
  };
  const p = mapearCotacaoParaProcesso(dados, 'Transportadora XYZ', { agora: new Date('2026-07-15') });

  teste('fornecedor vem do mix.forn', () => {
    iguais(p.fornecedor, 'EUDEMON');
  });
  teste('não duplica origem em obs quando já tem fornecedor', () => {
    iguais(p.obs, '');
  });
  teste('produtos_json reflete os itens do mix (2 itens)', () => {
    iguais(p.produtos_json.length, 2);
    iguais(p.produtos_json[0].descricao, '295/80R22.5');
    iguais(p.produtos_json[0].quantidade, 100);
  });
  teste('2 containers gerados', () => {
    iguais(p.containers_json.length, 2);
  });
}

// ── Caso 3: FOB parcelado (N parcelas — item e) ──
console.log('\n📋 FOB parcelado em N parcelas (item e)');
{
  const dados = {
    campos: { produto: 'PCR', fob_usd: '30000', frete_usd: '1200', tipo_importacao: 'ENCOMENDA' },
    toggles: {},
    mix: null,
    parcelas: [
      { label: 'Inicial', valor_usd: '9000', data: '2026-08-01' },
      { label: 'Pré-embarque', valor_usd: '12000', data: '2026-08-20' },
      { label: 'Final', valor_usd: '9000', data: '2026-09-05' },
      { label: '', valor_usd: '', data: '' }, // linha em branco não deve virar parcela válida
    ],
  };
  const p = mapearCotacaoParaProcesso(dados, 'Cliente ABC');

  teste('pi_pagamento = PARCELADO quando tem parcelas com valor', () => {
    iguais(p.pi_pagamento, 'PARCELADO');
  });
  teste('pi_parcelas_json tem só as 3 parcelas válidas (ignora linha em branco)', () => {
    const parcelas = JSON.parse(p.pi_parcelas_json);
    iguais(parcelas.length, 3);
    iguais(parcelas[0].label, 'Inicial');
    iguais(parcelas[0].valor_usd, '9000');
    iguais(parcelas[0].data_vencimento, '2026-08-01');
  });
  teste('parcela migrada não traz câmbio_fechado nem recebido_cliente preenchidos', () => {
    const parcelas = JSON.parse(p.pi_parcelas_json);
    iguais(parcelas[0].cambio_fechado, '');
    iguais(parcelas[0].valor_recebido_cliente, '');
  });
  teste('finalidade ENCOMENDA mapeada direto', () => {
    iguais(p.finalidade, 'ENCOMENDA');
  });
}
teste('sem parcelas (array vazio ou ausente) → pi_pagamento VISTA e pi_parcelas_json null', () => {
  const p1 = mapearCotacaoParaProcesso({ campos: {}, toggles: {}, mix: null, parcelas: [] }, 'Cliente');
  iguais(p1.pi_pagamento, 'VISTA');
  iguais(p1.pi_parcelas_json, null);
  const p2 = mapearCotacaoParaProcesso({ campos: {}, toggles: {}, mix: null }, 'Cliente');
  iguais(p2.pi_pagamento, 'VISTA');
  iguais(p2.pi_parcelas_json, null);
});

// ── Caso 4: tipo_importacao sem correspondente em finalidade ──
console.log('\n📋 tipo_importacao sem equivalente direto (IMPLEMENTOS/TRANSPORTADORA)');
{
  const dados = { campos: { produto: 'OTR', fob_usd: '10000', tipo_importacao: 'IMPLEMENTOS' }, toggles: {}, mix: null };
  const p = mapearCotacaoParaProcesso(dados, 'Cliente Implementos');

  teste('finalidade fica vazia', () => {
    iguais(p.finalidade, '');
  });
  teste('tipo original registrado em obs', () => {
    verdadeiro(p.obs.includes('IMPLEMENTOS'));
  });
}

// ── Caso 5: referência sugerida é determinística por cliente+data (mesmo cliente/data → mesmas iniciais) ──
console.log('\n📋 gerarReferenciaSugerida()');
teste('usa iniciais do cliente (várias palavras) + data UTC, formato legível', () => {
  const ref = gerarReferenciaSugerida('Transportadora Rio Verde', new Date('2026-07-15T00:00:00Z'));
  verdadeiro(/^TRV260715-[A-Z0-9]{3}$/.test(ref), `formato inesperado: ${ref}`);
});
teste('cliente de uma palavra só usa o próprio nome, não uma letra só', () => {
  const ref = gerarReferenciaSugerida('Impak', new Date('2026-07-15T00:00:00Z'));
  verdadeiro(ref.startsWith('IMPA260715-'), `esperado prefixo IMPA260715-, recebido ${ref}`);
});
teste('cliente vazio não quebra (usa fallback PROC)', () => {
  const ref = gerarReferenciaSugerida('', new Date('2026-07-15T00:00:00Z'));
  verdadeiro(ref.startsWith('PROC260715-'), `esperado prefixo PROC260715-, recebido ${ref}`);
});

// ── Caso 6: campos numéricos ausentes/vazios não quebram (viram null, não NaN/erro) ──
console.log('\n📋 Robustez — campos ausentes não devem lançar exceção');
teste('cotação praticamente vazia não lança erro', () => {
  const p = mapearCotacaoParaProcesso({ campos: {}, toggles: {}, mix: null }, '');
  verdadeiro(p.pi_valor_usd === null);
  verdadeiro(p.containers_json.length === 1, 'default de 1 container quando qtde_containers ausente');
});
teste('dadosCotacao undefined não lança erro', () => {
  const p = mapearCotacaoParaProcesso(undefined, 'Cliente');
  verdadeiro(p.referencia && p.referencia.length > 0);
});

// ── Caso 7: extrairEstimativa() — o que vira "estimativa_json" no processo ──
console.log('\n📋 extrairEstimativa() — estimado gravado no processo ao aprovar');
teste('resumo sem status/processo_id (cotação nunca teve status) mantém os números', () => {
  const est = extrairEstimativa({ custo_total: 1000, faturamento: 1500, lucro_bruto: 500, pct_lucro: 0.04 });
  iguais(est, { custo_total: 1000, faturamento: 1500, lucro_bruto: 500, pct_lucro: 0.04 });
});
teste('remove status/processo_id/processo_referencia/aprovado_por/datas do ciclo de vida', () => {
  const est = extrairEstimativa({
    custo_total: 1000, faturamento: 1500,
    status: 'aprovada', processo_id: 'abc-123', processo_referencia: 'UD26-001',
    data_aprovacao: '2026-07-16T00:00:00Z', aprovado_por: 'narcelio',
  });
  iguais(est, { custo_total: 1000, faturamento: 1500 });
});
teste('remove motivo_perda/data_rejeicao/rejeitado_por (caso tenha sido rejeitada antes)', () => {
  const est = extrairEstimativa({
    custo_total: 1000, motivo_perda: 'preço', data_rejeicao: '2026-07-01T00:00:00Z', rejeitado_por: 'narcelio',
  });
  iguais(est, { custo_total: 1000 });
});
teste('mantém os dois cenários (com_st/sem_st) intactos', () => {
  const cenarios = {
    com_st: { faturamento_total: 363898.12, comissao_china: 5558.43, valor_impak: 358339.69 },
    sem_st: { faturamento_total: 301024.92, comissao_china: 5558.43, valor_impak: 295466.49 },
  };
  const est = extrairEstimativa({ custo_total: 239039.83, cenarios, status: 'aprovada' });
  iguais(est.cenarios, cenarios);
});
teste('resumo null/undefined retorna null (cotação nunca foi calculada)', () => {
  iguais(extrairEstimativa(null), null);
  iguais(extrairEstimativa(undefined), null);
});
teste('resumo só com campos de status (sem nenhum número) retorna null', () => {
  const est = extrairEstimativa({ status: 'aprovada', processo_id: 'abc' });
  iguais(est, null);
});

// ── Caso 8: gerarRealJsonInicial() — Custos Reais preenchidos direto na aprovação ──
console.log('\n📋 gerarRealJsonInicial() — real_json gravado no processo ao aprovar');
teste('custosCotados null/undefined retorna null (processo abre em branco, igual hoje)', () => {
  iguais(gerarRealJsonInicial(null), null);
  iguais(gerarRealJsonInicial(undefined), null);
});
teste('popula itens simples (não porContainer) com {valor, moeda} — em Cobrado, não Pago', () => {
  const custosCotados = {
    containers: 1,
    compra: { fob: 27812.96, frete: 1000, seguro_usd: 50, taxa_ce: 30 },
    impostos: { ii: 5000, ipi: 200, pis: 100, cofins: 300, icms: 1200, ibs: 10, cbs: 5 },
    comissoes: { br: 800, china: 500, boss: 200 },
  };
  const rj = gerarRealJsonInicial(custosCotados);
  // FIX (a pedido do usuário): a cotação é o que vai ser COBRADO do cliente
  // (a proposta), não o que a Impak pagou de fato — então itens com
  // Cobrado/Pago (Compra e Frete, Comissões, Taxas) vão pro sufixo
  // "_cobrado". "Pago" fica em branco até alguém lançar o valor real.
  iguais(rj.fob_cobrado, { valor: 27812.96, moeda: 'BRL' });
  iguais(rj.frete_cobrado, { valor: 1000, moeda: 'BRL' });
  iguais(rj.seguro_cobrado, { valor: 50, moeda: 'BRL' });
  iguais(rj.taxa_ce_cobrado, { valor: 30, moeda: 'BRL' });
  iguais(rj.comissao_br_cobrado, { valor: 800, moeda: 'BRL' });
  verdadeiro(rj.fob === undefined, 'fob (Pago) não deveria vir preenchido pela cotação');
  // Impostos (apenasPago:true) continuam indo pro campo comum — não têm
  // conceito de "cobrado do cliente".
  iguais(rj.ii, { valor: 5000, moeda: 'BRL' });
  verdadeiro(rj.ii_cobrado === undefined, 'imposto não tem campo _cobrado');
});
teste('multiplica itens porContainer pela quantidade de containers da cotação', () => {
  const custosCotados = {
    containers: 3,
    taxas_fixas: { siscomex: 200, capatazia: 150, armazenagem: 900 },
    taxas_usd: { handling: 80 },
  };
  const rj = gerarRealJsonInicial(custosCotados);
  // capatazia e handling são porContainer:true → valor unitário × 3 containers
  // FIX: handling (e as demais Taxas em USD/destino) agora chegam em BRL
  // (convertidas pelo câmbio de abertura+2% no Calculador), não mais USD puro.
  // Siscomex (14/10/2026) virou valor único por processo — não multiplica.
  iguais(rj.capatazia_cobrado, { valor: 450, moeda: 'BRL' });
  iguais(rj.siscomex_cobrado, { valor: 200, moeda: 'BRL' });
  iguais(rj.handling_cobrado, { valor: 240, moeda: 'BRL' });
  // armazenagem é porContainer:false → não multiplica
  iguais(rj.armazenagem_cobrado, { valor: 900, moeda: 'BRL' });
});
teste('sem containers informado, assume 1 (não quebra nem zera)', () => {
  const rj = gerarRealJsonInicial({ taxas_fixas: { siscomex: 200 } });
  iguais(rj.siscomex_cobrado, { valor: 200, moeda: 'BRL' });
});
teste('ignora itens ausentes/zerados sem gerar chave (undefined ≠ 0)', () => {
  const rj = gerarRealJsonInicial({ containers: 1, compra: { fob: 1000 } });
  verdadeiro(rj.fob_cobrado !== undefined);
  verdadeiro(rj.frete_cobrado === undefined, 'frete não informado não deveria aparecer no real_json');
});
teste('custosCotados sem nenhum campo populado retorna null', () => {
  iguais(gerarRealJsonInicial({ containers: 2 }), null);
});
teste('custos_diversos (nível raiz, não dentro de taxas_fixas) é mapeado', () => {
  const rj = gerarRealJsonInicial({ containers: 1, custos_diversos: 450 });
  iguais(rj.custos_diversos_cobrado, { valor: 450, moeda: 'BRL' });
});
teste('resultado é diretamente compatível com o formato {valor,moeda} de real_json (ver teste_custos_reais.js)', () => {
  const rj = gerarRealJsonInicial({ containers: 2, compra: { fob: 100 }, taxas_fixas: { siscomex: 50 } });
  verdadeiro(typeof rj.fob_cobrado.valor === 'number' && typeof rj.fob_cobrado.moeda === 'string');
  verdadeiro(typeof rj.siscomex_cobrado.valor === 'number' && typeof rj.siscomex_cobrado.moeda === 'string');
});
teste('antidumping (impostos.antidumping) é mapeado quando a cotação teve o toggle dump=SIM', () => {
  const rj = gerarRealJsonInicial({ containers: 1, impostos: { ii: 5000, antidumping: 320.5 } });
  iguais(rj.antidumping, { valor: 320.5, moeda: 'BRL' });
});
teste('sem antidumping na cotação (toggle NAO, DUMP=0), vem zerado — não quebra, só sem impacto no total', () => {
  const rj = gerarRealJsonInicial({ containers: 1, impostos: { ii: 5000, antidumping: 0 } });
  iguais(rj.antidumping, { valor: 0, moeda: 'BRL' });
});
teste('seguro_venda (nível raiz, distinto do Seguro Compra) é mapeado', () => {
  const rj = gerarRealJsonInicial({ containers: 1, compra: { seguro_usd: 50 }, seguro_venda: 890.5 });
  // FIX: seguro (compra) agora chega do Calculador já em BRL, ver testes acima.
  iguais(rj.seguro_cobrado, { valor: 50, moeda: 'BRL' });
  iguais(rj.seguro_venda_cobrado, { valor: 890.5, moeda: 'BRL' });
});

// ── Caso 9: mapearProcessoParaCotacao() — vínculo reverso (item e) ──
console.log('\n📋 mapearProcessoParaCotacao() — prefill do Calculador a partir de um processo do Controle');
teste('mapeia campos básicos (cliente, câmbio, FOB, frete, containers, tipo de importação)', () => {
  const proc = {
    cliente: 'Cliente X', pi_cambio: 5.2, pi_valor_usd: 20000, valor_frete: 1500, moeda_frete: 'USD',
    containers_json: [{ numero: '', tipo: '40HC', lacre: '' }, { numero: '', tipo: '40HC', lacre: '' }],
    finalidade: 'ENCOMENDA', pi_pagamento: 'VISTA',
  };
  const dados = mapearProcessoParaCotacao(proc);
  iguais(dados.campos.cliente, 'Cliente X');
  iguais(dados.campos.cambio_usd, 5.2);
  iguais(dados.campos.fob_usd, 20000);
  iguais(dados.campos.frete_usd, 1500);
  iguais(dados.campos.qtde_containers, 2);
  iguais(dados.campos.tipo_importacao, 'ENCOMENDA');
});
teste('frete em moeda diferente de USD não é migrado (Calculador só tem frete em USD)', () => {
  const proc = { valor_frete: 1500, moeda_frete: 'EUR' };
  const dados = mapearProcessoParaCotacao(proc);
  verdadeiro(dados.campos.frete_usd === undefined);
});
teste('parcelas migradas quando pi_pagamento=PARCELADO (inclusive câmbio fechado e recebimento do cliente, desde que o Calculador ganhou esses campos)', () => {
  const proc = {
    pi_pagamento: 'PARCELADO',
    pi_parcelas_json: JSON.stringify([
      { label: 'Inicial', valor_usd: 8000, data_vencimento: '2026-03-01', cambio_fechado: 5.15, valor_recebido_cliente: 8000, data_recebimento: '2026-03-02' },
      { label: '', valor_usd: null, data_vencimento: '' },
    ]),
  };
  const dados = mapearProcessoParaCotacao(proc);
  iguais(dados.parcelas.length, 1, 'linha sem valor nem câmbio não deve virar parcela');
  iguais(dados.parcelas[0], {
    label: 'Inicial', valor_usd: 8000, data_vencimento: '2026-03-01',
    cambio_fechado: 5.15, valor_recebido_cliente: 8000, data_recebimento: '2026-03-02',
  });
});
teste('sem PARCELADO, parcelas vem vazio mesmo se pi_parcelas_json tiver lixo de outra forma de pagamento', () => {
  const proc = { pi_pagamento: 'ENTRADA_SALDO', pi_parcelas_json: null };
  const dados = mapearProcessoParaCotacao(proc);
  iguais(dados.parcelas, []);
});
teste('processo vazio/mínimo não lança erro', () => {
  const dados = mapearProcessoParaCotacao({});
  iguais(dados.campos, {});
  iguais(dados.parcelas, []);
});
teste('mix sempre null (não reconstrói mix a partir do processo — usuário revisa manualmente)', () => {
  const dados = mapearProcessoParaCotacao({ produtos_json: [{ descricao: 'x', quantidade: 10 }] });
  iguais(dados.mix, null);
});

// ── RESUMO ───────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log('\n📋 Passo 4 — prazo e juros no boleto da cotação viram venda no processo');
teste('com prazo + juros no boleto no resumo, o processo nasce com 1 venda a prazo (juros fora da NF)', () => {
  const dados = { campos: { produto: 'PCR', fob_usd: '1000', cambio_usd: '5', qtde_containers: '1', prazo_boleto: '30/60/90dd' }, toggles: { parcelado: 'SIM', jb: 'SIM' },
    mix: { itens: [{ medida: '175/70R13', qtd: 100 }] } };
  const p = mapearCotacaoParaProcesso(dados, 'Cliente Teste', { resumo: { juros_boleto: 12345.678, prazo_texto: '30/60/90dd' } });
  const vendas = JSON.parse(p.vendas_json);
  iguais(vendas.length, 1);
  iguais(vendas[0].forma_pagamento, 'prazo');
  iguais(vendas[0].prazo_texto, '30/60/90dd');
  iguais(vendas[0].juros_valor, '12345.68');
  iguais(vendas[0].juros_fora_nf, true);
  verdadeiro(/Pagamento cotado: parcelado 30\/60\/90dd/.test(p.obs), 'obs deveria citar o prazo: ' + p.obs);
});
teste('sem prazo nem juros, o processo continua sem venda (fluxo antigo)', () => {
  const dados = { campos: { produto: 'PCR', fob_usd: '1000', cambio_usd: '5', qtde_containers: '1' }, toggles: {} };
  const p = mapearCotacaoParaProcesso(dados, 'Cliente Teste', { resumo: {} });
  verdadeiro(p.vendas_json === undefined);
});

// ── REGRA ÚNICA DO VÍNCULO COTAÇÃO ↔ PROCESSO (lib/vinculo-cotacao.js) ──
// Valores fictícios (repositório público).
const Vinculo = require('./lib/vinculo-cotacao.js');
console.log('\n📋 Vínculo cotação ↔ processo — regra única nos dois sentidos');
const AGORA_V = '2026-10-20T12:00:00.000Z';
const estV = (custo, fat) => ({ tipo: 'TBR', uf: 'SC', custo_total: custo, faturamento: fat, lucro_bruto: fat - custo, pct_lucro: (fat - custo) / fat * 100,
  custos_cotados_json: { cambio: 5, containers: 2, compra: { fob: 1000 }, taxas_fixas: { capatazia: 100 } } });
const cotV = (id, extra) => Object.assign({ id, cliente: 'Cliente Exemplo', ativo: true, updated_at: '2026-10-01T00:00:00Z', dados: { comissionados: ['vend-a'] }, resumo: estV(1000, 1500) }, extra || {});
const procV = extra => Object.assign({ id: 'proc-1', referencia: 'REF-TESTE-1', cliente: 'Cliente Exemplo', cotacao_id: null, estimativa_json: null, real_json: null,
  comissoes_json: { selecionados: ['VEND-B'], pagamentos: [{ chave: 'x', data: '2026-10-01', valor: 1 }] }, fechado: false, cancelado: false }, extra || {});

teste('vincular grava os DOIS lados: processo.cotacao_id + estimativa; cotação aprovada com processo e referência', () => {
  const r = Vinculo.planoVincular({ cot: cotV('cot-1', { resumo: { ...estV(1000, 1500), status: 'rejeitada', motivo_perda: 'preço' } }), proc: procV(), outras: [], usuario: 'teste', agora: AGORA_V });
  verdadeiro(!r.erro, r.erro);
  iguais(r.patchProcesso.cotacao_id, 'cot-1');
  iguais(r.patchProcesso.estimativa_json.custo_total, 1000);
  verdadeiro(r.patchProcesso.estimativa_json.status === undefined && r.patchProcesso.estimativa_json.motivo_perda === undefined, 'ciclo de vida não vai pra estimativa');
  iguais(r.resumoCotacao.status, 'aprovada');
  iguais(r.resumoCotacao.processo_id, 'proc-1');
  iguais(r.resumoCotacao.processo_referencia, 'REF-TESTE-1');
  verdadeiro(r.resumoCotacao.motivo_perda === undefined, 'vincular limpa o motivo de perda');
  iguais(r.patchProcesso.real_json.capatazia_cobrado.valor, 200); // por container × 2
  iguais(r.patchProcesso.comissoes_json.selecionados, ['VEND-B', 'VEND-A']);
  iguais(r.patchProcesso.comissoes_json.pagamentos.length, 1);
  verdadeiro(r.log.some(l => l.campo === 'Cotação vinculada'), 'registra no Histórico do processo');
});
teste('vincular não mexe em Custos Reais já lançados', () => {
  const r = Vinculo.planoVincular({ cot: cotV('cot-1'), proc: procV({ real_json: { fob: { valor: 5000, moeda: 'BRL' } } }), outras: [], agora: AGORA_V });
  verdadeiro(r.patchProcesso.real_json === undefined);
});
teste('processo com outra cotação: recusa (409 com conflito) e só troca com substituir — a antiga volta a Rascunho', () => {
  const antiga = cotV('cot-velha', { resumo: { ...estV(900, 1400), status: 'aprovada', processo_id: 'proc-1', processo_referencia: 'REF-TESTE-1' } });
  const sem = Vinculo.planoVincular({ cot: cotV('cot-1'), proc: procV({ cotacao_id: 'cot-velha' }), outras: [antiga], agora: AGORA_V });
  iguais(sem.status, 409);
  iguais(sem.conflito.cotacao_id, 'cot-velha');
  const com = Vinculo.planoVincular({ cot: cotV('cot-1'), proc: procV({ cotacao_id: 'cot-velha' }), outras: [antiga], substituir: true, agora: AGORA_V });
  verdadeiro(!com.erro, com.erro);
  iguais(com.desvincular.length, 1);
  iguais(com.desvincular[0].id, 'cot-velha');
  verdadeiro(!com.desvincular[0].resumo.status && !com.desvincular[0].resumo.processo_id, 'antiga sem status/processo = Rascunho');
  iguais(com.desvincular[0].resumo.desvinculado_de, 'REF-TESTE-1');
});
teste('vincular recusa processo fechado/cancelado, cotação excluída, cotação de outro processo e cotação sem números', () => {
  iguais(Vinculo.planoVincular({ cot: cotV('c'), proc: procV({ fechado: true }) }).status, 409);
  iguais(Vinculo.planoVincular({ cot: cotV('c'), proc: procV({ cancelado: true }) }).status, 409);
  iguais(Vinculo.planoVincular({ cot: cotV('c', { ativo: false }), proc: procV() }).status, 409);
  iguais(Vinculo.planoVincular({ cot: cotV('c', { resumo: { ...estV(1, 2), processo_id: 'proc-outro', processo_referencia: 'REF-OUTRO' } }), proc: procV() }).status, 409);
  iguais(Vinculo.planoVincular({ cot: cotV('c', { resumo: { status: 'rascunho' } }), proc: procV() }).status, 400);
});
teste('desvincular tira dos dois lados: processo sem cotacao_id/estimativa, cotação Rascunho com a nota de onde saiu', () => {
  const cot = cotV('cot-1', { resumo: { ...estV(1000, 1500), status: 'aprovada', processo_id: 'proc-1', processo_referencia: 'REF-TESTE-1' } });
  const r = Vinculo.planoDesvincular({ cot, proc: procV({ cotacao_id: 'cot-1', estimativa_json: estV(1000, 1500) }), usuario: 'teste', agora: AGORA_V, motivo: 'teste' });
  iguais(r.patchProcesso.cotacao_id, null);
  iguais(r.patchProcesso.estimativa_json, null);
  verdadeiro(!r.resumoCotacao.status && !r.resumoCotacao.processo_id);
  iguais(r.resumoCotacao.desvinculado_de, 'REF-TESTE-1');
  verdadeiro(r.log.length >= 1);
  const fechado = Vinculo.planoDesvincular({ cot, proc: procV({ cotacao_id: 'cot-1', fechado: true }) });
  iguais(fechado.status, 409);
});
teste('desvincular uma cotação "a mais" (o processo é de outra) não apaga a estimativa do processo', () => {
  const cot = cotV('cot-2', { resumo: { ...estV(700, 800), status: 'aprovada', processo_id: 'proc-1' } });
  const r = Vinculo.planoDesvincular({ cot, proc: procV({ cotacao_id: 'cot-1', estimativa_json: estV(1000, 1500) }) });
  iguais(r.patchProcesso, null);
  verdadeiro(!r.resumoCotacao.processo_id);
});
teste('salvar de novo a cotação vinculada atualiza a estimativa do processo (com Histórico); fechado → só leitura', () => {
  const cotNova = cotV('cot-1', { resumo: { ...estV(1100, 1600), status: 'aprovada', processo_id: 'proc-1', processo_referencia: 'REF-ANTIGA' } });
  const r = Vinculo.planoResalvar({ cotNova, proc: procV({ cotacao_id: 'cot-1', estimativa_json: estV(1000, 1500), comissoes_json: { selecionados: ['VEND-A'] } }), agora: AGORA_V });
  iguais(r.patchProcesso.estimativa_json.custo_total, 1100);
  verdadeiro(r.patchProcesso.cotacao_id === undefined && r.patchProcesso.real_json === undefined, 'resalvar não mexe em Custos Reais');
  iguais(r.resumoCotacao.processo_referencia, 'REF-TESTE-1', 'referência atualizada');
  verdadeiro(r.log.length === 1 && /Estimativa/.test(r.log[0].campo));
  const igual = Vinculo.planoResalvar({ cotNova: cotV('cot-1', { resumo: { ...estV(1000, 1500), status: 'aprovada', processo_id: 'proc-1' } }), proc: procV({ cotacao_id: 'cot-1', estimativa_json: { ...estV(1000, 1500) }, comissoes_json: { selecionados: ['VEND-A'] } }), agora: AGORA_V });
  iguais(igual.patchProcesso, null, 'nada mudou → não toca no processo (não gera edição simultânea à toa)');
  iguais(Vinculo.planoResalvar({ cotNova, proc: procV({ cotacao_id: 'cot-1', fechado: true }) }).status, 409);
  const sumiu = Vinculo.planoResalvar({ cotNova, proc: null, agora: AGORA_V });
  verdadeiro(sumiu.desvinculada && !sumiu.resumoCotacao.processo_id, 'processo excluído → cotação volta a Rascunho');
});
teste('aprovar de novo uma cotação já aprovada no mesmo processo mantém a data de aprovação original', () => {
  const r = Vinculo.resumoVinculado({ status: 'aprovada', processo_id: 'proc-1', data_aprovacao: '2026-01-01T00:00:00Z', aprovado_por: 'quem-aprovou' }, procV(), { usuario: 'outro', agora: AGORA_V });
  iguais(r.data_aprovacao, '2026-01-01T00:00:00Z');
  iguais(r.aprovado_por, 'quem-aprovou');
});
teste('conferência: completa o lado do processo, desvincula a cotação "a mais", aponta processo excluído e acerta a referência', () => {
  const cots = [
    cotV('c-a', { cliente: 'NÃO', updated_at: '2026-08-02', resumo: { ...estV(1000, 1500), status: 'aprovada', processo_id: 'proc-1', processo_referencia: 'REF-TESTE-1' } }),
    cotV('c-b', { cliente: 'NÃO', updated_at: '2026-08-01', resumo: { ...estV(1000, 1500), status: 'aprovada', processo_id: 'proc-1', processo_referencia: 'REF-TESTE-1' } }),
    cotV('c-c', { updated_at: '2026-08-03', resumo: { ...estV(900, 1200), status: 'aprovada', processo_id: 'proc-1' } }),
    cotV('c-d', { resumo: { ...estV(450, 650), status: 'aprovada', processo_id: 'proc-sumiu', processo_referencia: 'REF-SUMIU' } }),
    cotV('c-e', { resumo: { ...estV(500, 600), status: 'aprovada', processo_id: 'proc-2', processo_referencia: 'REF-VELHA' } }),
  ];
  const procs = [procV({ estimativa_json: estV(1000, 1500), cliente: 'Cliente Exemplo A' }), procV({ id: 'proc-2', referencia: 'REF-TESTE-2', cotacao_id: 'c-e', estimativa_json: estV(500, 600) })];
  const d = Vinculo.diagnosticarVinculos(cots, procs, { usuario: 'teste', agora: AGORA_V, excluirCopias: true });
  const acProc = d.acoes.find(a => a.alvo === 'processo' && a.id === 'proc-1');
  iguais(acProc.patch.cotacao_id, 'c-a', 'a principal é a que bate com a estimativa (a mais recente)');
  const ac = id => d.acoes.find(a => a.alvo === 'cotacao' && a.id === id);
  iguais(ac('c-a').cliente, 'Cliente Exemplo A', 'cliente "NÃO" vira o cliente do processo');
  verdadeiro(!ac('c-c').resumo.processo_id, 'a cotação a mais volta a Rascunho');
  verdadeiro(ac('c-b').ativo === false, 'cópia idêntica solta é excluída (reversível)');
  verdadeiro(ac('c-c').ativo !== false, 'cotação diferente não é excluída, só desvinculada');
  verdadeiro(!ac('c-d').resumo.processo_id && /não existe/.test(ac('c-d').resumo.desvinculado_motivo), 'processo excluído → desvincula');
  iguais(ac('c-e').resumo.processo_referencia, 'REF-TESTE-2', 'referência atualizada');
  iguais(d.porCotacao['c-a'].estado, 'ok');
  iguais(d.porCotacao['c-c'].estado, 'duplicada');
  iguais(d.porCotacao['c-d'].estado, 'processo_inexistente');
});
teste('conferência: várias cotações e nenhuma com a estimativa do processo → fica para olhar à mão (nada automático)', () => {
  const cots = [cotV('c-1', { resumo: { ...estV(1, 2), status: 'aprovada', processo_id: 'proc-1' } }), cotV('c-2', { resumo: { ...estV(3, 4), status: 'aprovada', processo_id: 'proc-1' } })];
  const d = Vinculo.diagnosticarVinculos(cots, [procV({ estimativa_json: estV(1000, 1500) })], {});
  iguais(d.acoes.length, 0);
  verdadeiro(d.problemas.some(p => !p.automatico && p.tipo === 'varias_sem_estimativa_igual'));
});
teste('conferência: uma cotação só com estimativa diferente → vincula e avisa (mantém a estimativa do processo)', () => {
  const d = Vinculo.diagnosticarVinculos([cotV('c-1', { resumo: { ...estV(900, 1400), status: 'aprovada', processo_id: 'proc-1', processo_referencia: 'REF-TESTE-1' } })],
    [procV({ estimativa_json: estV(1000, 1500) })], {});
  const acProc = d.acoes.find(a => a.alvo === 'processo');
  iguais(acProc.patch.cotacao_id, 'c-1');
  verdadeiro(acProc.patch.estimativa_json === undefined, 'não sobrescreve a estimativa do processo');
  iguais(d.porCotacao['c-1'].estado, 'estimativa_diferente');
});
teste('conferência: processo fechado só ganha o cotacao_id (estimativa não muda)', () => {
  const d = Vinculo.diagnosticarVinculos([cotV('c-1', { resumo: { ...estV(1000, 1500), status: 'aprovada', processo_id: 'proc-1', processo_referencia: 'REF-TESTE-1' } })],
    [procV({ fechado: true, estimativa_json: null })], {});
  const acProc = d.acoes.find(a => a.alvo === 'processo');
  iguais(acProc.patch.cotacao_id, 'c-1');
  verdadeiro(acProc.patch.estimativa_json === undefined);
});
teste('conferência: tudo certo → zero problemas', () => {
  const d = Vinculo.diagnosticarVinculos([cotV('c-1', { resumo: { ...estV(1000, 1500), status: 'aprovada', processo_id: 'proc-1', processo_referencia: 'REF-TESTE-1' } }), cotV('c-2')],
    [procV({ cotacao_id: 'c-1', estimativa_json: estV(1000, 1500) })], {});
  iguais(d.problemas.length, 0);
  iguais(d.acoes.length, 0);
  iguais(d.porCotacao['c-2'].estado, 'sem_vinculo');
});
teste('extrairEstimativa ignora todos os campos de ciclo de vida (criado/excluída/desvinculada)', () => {
  const e = extrairEstimativa({ custo_total: 1, status: 'aprovada', criado_por: 'x', excluida_motivo: 'y', desvinculado_de: 'z', restaurada_em: 'w' });
  iguais(Object.keys(e), ['custo_total']);
});

console.log(`Total: ${totalTestes} testes, ${totalTestes - totalFalhas} passaram, ${totalFalhas} falharam`);
if (totalFalhas > 0) {
  console.log('\n⚠️  NÃO FAÇA DEPLOY com testes falhando sem entender o motivo.');
  process.exit(1);
} else {
  console.log('✓ Tudo certo para deploy (do ponto de vista destas regras testadas).');
}
