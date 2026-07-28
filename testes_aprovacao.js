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

const { mapearCotacaoParaProcesso, gerarReferenciaSugerida, extrairEstimativa, gerarRealJsonInicial } = require('./mapeamento_cotacao_processo.js');

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
    toggles: { fobpar: 'NAO', dump: 'NAO' },
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
  teste('pi_pagamento VISTA quando fobpar=NAO', () => {
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
    toggles: { fobpar: 'NAO' },
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

// ── Caso 3: FOB parcelado (entrada + saldo) ──
console.log('\n📋 FOB parcelado (toggle fobpar=SIM)');
{
  const dados = {
    campos: {
      produto: 'PCR', fob_usd: '30000', frete_usd: '1200',
      pct_fob_entrada: '30', cambio_fob_entrada: '5.10', cambio_fob_saldo: '5.25',
      tipo_importacao: 'ENCOMENDA',
    },
    toggles: { fobpar: 'SIM' },
    mix: null,
  };
  const p = mapearCotacaoParaProcesso(dados, 'Cliente ABC');

  teste('pi_pagamento = ENTRADA_SALDO', () => {
    iguais(p.pi_pagamento, 'ENTRADA_SALDO');
  });
  teste('pi_entrada_pct/cambio_entrada/cambio_saldo preenchidos', () => {
    iguais(p.pi_entrada_pct, 30);
    iguais(p.pi_cambio_entrada, 5.10);
    iguais(p.pi_cambio_saldo, 5.25);
  });
  teste('finalidade ENCOMENDA mapeada direto', () => {
    iguais(p.finalidade, 'ENCOMENDA');
  });
}

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
teste('popula itens simples (não porContainer) com {valor, moeda}', () => {
  const custosCotados = {
    containers: 1,
    compra: { fob: 27812.96, frete: 1000, seguro_usd: 50, taxa_ce: 30 },
    impostos: { ii: 5000, ipi: 200, pis: 100, cofins: 300, icms: 1200, ibs: 10, cbs: 5 },
    comissoes: { br: 800, china: 500, boss: 200 },
  };
  const rj = gerarRealJsonInicial(custosCotados);
  iguais(rj.fob, { valor: 27812.96, moeda: 'USD' });
  iguais(rj.frete, { valor: 1000, moeda: 'USD' });
  iguais(rj.seguro, { valor: 50, moeda: 'USD' });
  iguais(rj.taxa_ce, { valor: 30, moeda: 'USD' });
  iguais(rj.ii, { valor: 5000, moeda: 'BRL' });
  iguais(rj.comissao_br, { valor: 800, moeda: 'BRL' });
});
teste('multiplica itens porContainer pela quantidade de containers da cotação', () => {
  const custosCotados = {
    containers: 3,
    taxas_fixas: { siscomex: 200, marinha: 150, armazenagem: 900 },
    taxas_usd: { handling: 80 },
  };
  const rj = gerarRealJsonInicial(custosCotados);
  // siscomex e handling são porContainer:true → valor unitário × 3 containers
  iguais(rj.siscomex, { valor: 600, moeda: 'BRL' });
  iguais(rj.handling, { valor: 240, moeda: 'USD' });
  // armazenagem é porContainer:false → não multiplica
  iguais(rj.armazenagem, { valor: 900, moeda: 'BRL' });
});
teste('sem containers informado, assume 1 (não quebra nem zera)', () => {
  const rj = gerarRealJsonInicial({ taxas_fixas: { siscomex: 200 } });
  iguais(rj.siscomex, { valor: 200, moeda: 'BRL' });
});
teste('ignora itens ausentes/zerados sem gerar chave (undefined ≠ 0)', () => {
  const rj = gerarRealJsonInicial({ containers: 1, compra: { fob: 1000 } });
  verdadeiro(rj.fob !== undefined);
  verdadeiro(rj.frete === undefined, 'frete não informado não deveria aparecer no real_json');
});
teste('custosCotados sem nenhum campo populado retorna null', () => {
  iguais(gerarRealJsonInicial({ containers: 2 }), null);
});
teste('custos_diversos (nível raiz, não dentro de taxas_fixas) é mapeado', () => {
  const rj = gerarRealJsonInicial({ containers: 1, custos_diversos: 450 });
  iguais(rj.custos_diversos, { valor: 450, moeda: 'BRL' });
});
teste('resultado é diretamente compatível com o formato {valor,moeda} de real_json (ver teste_custos_reais.js)', () => {
  const rj = gerarRealJsonInicial({ containers: 2, compra: { fob: 100 }, taxas_fixas: { siscomex: 50 } });
  verdadeiro(typeof rj.fob.valor === 'number' && typeof rj.fob.moeda === 'string');
  verdadeiro(typeof rj.siscomex.valor === 'number' && typeof rj.siscomex.moeda === 'string');
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
  iguais(rj.seguro, { valor: 50, moeda: 'USD' });
  iguais(rj.seguro_venda, { valor: 890.5, moeda: 'BRL' });
});

// ── RESUMO ───────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Total: ${totalTestes} testes, ${totalTestes - totalFalhas} passaram, ${totalFalhas} falharam`);
if (totalFalhas > 0) {
  console.log('\n⚠️  NÃO FAÇA DEPLOY com testes falhando sem entender o motivo.');
  process.exit(1);
} else {
  console.log('✓ Tudo certo para deploy (do ponto de vista destas regras testadas).');
}
