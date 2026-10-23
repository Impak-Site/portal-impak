// conferencia-fechamento.js — Conferência de fechamento do processo (22/10/2026).
//
// Por quê (pedido do Ayslan, com a planilha do Financeiro "CHECK-LIST
// FECHAMENTO IMPORTAÇÃO"): no fechamento da importação o Financeiro confere
// se os ADIANTAMENTOS pagos (numerário do despachante, numerário de frete do
// agente de carga, seguro) cobrem exatamente os CUSTOS do processo (impostos
// da DI, AFRMM, armazenagem, frete da DI + diferença de frete, seguro) —
// "Débitos − Créditos = 0" — e calcula a variação cambial entre a taxa da DI
// e o câmbio fechado. Depois lança as notas no Conexos (Adiantamento de
// Títulos Diversos).
//
// Não é tela nova: entra como uma seção da aba "🧾 Faturas" do processo
// (controle-faturas-processo.js). Usa o que já existe:
//   • Débitos  = Custos Reais do processo (real_json), por grupo;
//   • Créditos = faturas do processo pagas (numerário do despachante,
//     faturas do agente, seguro…), só o dinheiro que saiu (compensação não
//     conta duas vezes) + retenções (IR/PIS/COFINS/CSLL retidos);
//   • Câmbio   = Taxa da DI × câmbio fechado das parcelas.
// Nada é gravado: é uma conta em cima do que já está salvo.
//
// UMD: navegador (<script src="/conferencia-fechamento.js">,
// window.ConferenciaFechamento) e Node (require). Testes em testes_faturas.js.
(function () {
  'use strict';

  const num = v => { const n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : 0; };
  const r2 = v => Math.round(num(v) * 100) / 100;
  const TOLERANCIA = 1; // R$ 1,00 — diferença de centavos (arredondamento do despachante)

  // Quem cobra cada taxa (padrão). Igual à planilha do Financeiro:
  // despachante = numerário (impostos da DI + AFRMM + armazenagem…);
  // agente = numerário de frete (frete da DI + taxas locais do agente);
  // seguro; outros = demais fornecedores (lavação, terminal…).
  const GRUPOS = [
    { id: 'despachante', label: 'Despachante (numerário)',
      taxas: ['ii', 'ipi', 'pis', 'cofins', 'siscomex', 'marinha', 'icms', 'antidumping', 'armazenagem', 'emissao_li', 'despachante', 'sda'],
      pacote: 'adiantamento_porto' },
    { id: 'agente', label: 'Agente de carga (frete)',
      taxas: ['frete', 'taxa_ce', 'capatazia', 'iof', 'agente', 'isps', 'drop_off', 'liberacao_bl', 'desconsolidacao', 'handling', 'additional_costs', 'import_logistics', 'trs', 'tsc'],
      pacote: 'agente_frete' },
    { id: 'seguro', label: 'Seguro', taxas: ['seguro'] },
    { id: 'outros', label: 'Outros fornecedores', taxas: ['lavacao', 'baixa_patio', 'administrativo', 'custos_diversos'] },
  ];
  // Fora da conta: IBS/CBS em 2026 são só destaque na DUIMP (não pagos).
  const INFORMATIVOS = ['ibs', 'cbs'];
  // Reembolsos do agente que não vêm na NF de serviço dele (planilha: "Frete
  // Royal — o que não tem NF e não está na DUIMP"): capatazia/THC e IOF.
  const AGENTE_SEM_NF = ['capatazia', 'iof'];
  // Nota complementar de importação (código 69 no Conexos)
  const NF_IMPORTACAO = ['ii', 'ipi', 'pis', 'cofins', 'siscomex', 'marinha', 'antidumping'];

  function grupoDaTaxa(taxa) {
    const t = String(taxa || '').replace(/_cobrado$/, '');
    for (const g of GRUPOS) if (g.taxas.includes(t) || g.pacote === t) return g.id;
    return null;
  }

  // Débitos por grupo a partir dos custos (id → valor em R$).
  function debitosPorGrupo(custos, labels) {
    custos = custos || {};
    labels = labels || {};
    const out = {};
    GRUPOS.forEach(g => {
      const itens = g.taxas.filter(t => num(custos[t]) !== 0).map(t => ({ taxa: t, label: labels[t] || t, valor: r2(custos[t]) }));
      // Pacote (modo "pacote" do Fechamento) só quando as taxas soltas do grupo estão vazias
      if (!itens.length && g.pacote && num(custos[g.pacote]) !== 0) itens.push({ taxa: g.pacote, label: labels[g.pacote] || g.pacote, valor: r2(custos[g.pacote]), pacote: true });
      out[g.id] = { itens, total: r2(itens.reduce((s, i) => s + i.valor, 0)) };
    });
    return out;
  }

  // Créditos (adiantamentos pagos) por grupo a partir das faturas do processo.
  // F = FaturasCore (faturas-core.js). Conta só o dinheiro que saiu (baixa por
  // compensação não, senão o numerário conta duas vezes) + retenções.
  function creditosDasFaturas(faturas, pid, cambio, F) {
    const out = { despachante: [], agente: [], seguro: [], outros: [] };
    if (!F) return out;
    (faturas || []).forEach(f => {
      if (!f || f.status === 'cancelada') return;
      const parte = F.parteDoProcesso(f, pid).fracao;
      if (!(parte > 0)) return;
      const pags = F.pagamentosValidos ? F.pagamentosValidos(f) : (Array.isArray(f.pagamentos) ? f.pagamentos : []);
      let caixa = pags.reduce((s, pg) => s + (pg.forma === 'compensacao' ? 0 : F.caixaBrlPagamento(pg, f, cambio) + ((f.moeda || 'BRL') === 'BRL' ? num(pg.retencoes) : 0)), 0);
      if (f.status === 'paga' && !pags.length) caixa = num(f.valor_pago != null ? f.valor_pago : f.valor) * F.fatorBRL(f, cambio);
      caixa = r2(caixa * parte);
      if (!caixa) return;
      const desc = [f.numero, f.empresa_nome, f.documento ? 'doc ' + f.documento : ''].filter(Boolean).join(' · ');
      const ehNum = F.ehNumerario && F.ehNumerario(f);
      const ehDev = F.ehDevolucaoNumerario && F.ehDevolucaoNumerario(f);
      if (ehNum) { out.despachante.push({ descricao: 'Numerário ' + desc, valor: caixa, fatura_id: f.id }); return; }
      if (ehDev) { out.despachante.push({ descricao: 'Devolução de numerário ' + desc, valor: -caixa, fatura_id: f.id }); return; }
      if (f.tipo !== 'pagar') return; // a receber do cliente não é adiantamento de custo
      // Divide o pago pelos grupos das taxas da fatura (deste processo)
      const itens = (Array.isArray(f.itens) ? f.itens : []).filter(it => it && (it.processo_id == null || String(it.processo_id) === String(pid)));
      const soma = itens.reduce((s, it) => s + Math.abs(num(it.valor)), 0);
      if (!itens.length || !(soma > 0)) { out.outros.push({ descricao: desc, valor: caixa, fatura_id: f.id }); return; }
      const porGrupo = {};
      itens.forEach(it => { const g = grupoDaTaxa(it.taxa) || 'outros'; porGrupo[g] = (porGrupo[g] || 0) + Math.abs(num(it.valor)); });
      const gs = Object.keys(porGrupo);
      let resto = caixa;
      gs.forEach((g, i) => {
        const v = i === gs.length - 1 ? r2(resto) : r2(caixa * porGrupo[g] / soma);
        resto -= v;
        out[g].push({ descricao: desc + (gs.length > 1 ? ' (parte)' : ''), valor: v, fatura_id: f.id });
      });
    });
    return out;
  }

  // Monta a conferência.
  //   dados = {
  //     custos: { taxa: valorBRL },           // Custos Reais (R$)
  //     labels: { taxa: 'rótulo' },
  //     creditos: { grupo: [{descricao, valor}] },   // creditosDasFaturas
  //     manuais: { grupo: valor },            // valor digitado (ex.: do Conexos) — substitui o do grupo
  //     processo: { di_taxa_cambio, valor_frete, moeda_frete, pi_valor_usd, ci_valor_usd },
  //     cambiosFechados: [{ usd, taxa, data, rotulo }],
  //   }
  function montarConferencia(dados) {
    dados = dados || {};
    const custos = dados.custos || {};
    const p = dados.processo || {};
    const deb = debitosPorGrupo(custos, dados.labels);
    const cred = dados.creditos || {};
    const manuais = dados.manuais || {};
    const pendencias = [];

    const grupos = GRUPOS.map(g => {
      const d = deb[g.id];
      const lista = Array.isArray(cred[g.id]) ? cred[g.id] : [];
      const manual = manuais[g.id] != null && manuais[g.id] !== '' && isFinite(parseFloat(manuais[g.id])) ? r2(manuais[g.id]) : null;
      const creditoFaturas = r2(lista.reduce((s, c) => s + num(c.valor), 0));
      const credito = manual != null ? manual : creditoFaturas;
      const temCredito = manual != null || lista.length > 0;
      return { id: g.id, label: g.label, debitos: d.itens, debito: d.total, creditos: lista, credito_faturas: creditoFaturas, manual, credito,
        tem_credito: temCredito, diferenca: temCredito ? r2(credito - d.total) : null };
    }).filter(g => g.debito !== 0 || g.tem_credito);

    const totalDeb = r2(grupos.reduce((s, g) => s + g.debito, 0));
    const totalCred = r2(grupos.reduce((s, g) => s + (g.tem_credito ? g.credito : 0), 0));
    const semCredito = grupos.filter(g => !g.tem_credito && g.debito > 0);
    const dif = r2(totalCred - totalDeb);

    // Frete: o da DI (US$ × taxa da DI) e a variação cambial do frete
    const taxaDi = num(p.di_taxa_cambio);
    const freteUsd = String(p.moeda_frete || 'USD').toUpperCase() === 'USD' ? num(p.valor_frete) : 0;
    const freteReal = num(custos.frete);
    const freteDi = taxaDi > 0 && freteUsd > 0 ? r2(freteUsd * taxaDi) : null;
    const variacaoFrete = freteDi != null && freteReal ? r2(freteReal - freteDi) : null;

    // Composição das notas (como o Financeiro lança)
    const v = t => r2(custos[t]);
    const agenteItens = deb.agente.itens;
    const agenteSemNf = agenteItens.filter(i => AGENTE_SEM_NF.includes(i.taxa));
    const agenteNf = agenteItens.filter(i => i.taxa !== 'frete' && !AGENTE_SEM_NF.includes(i.taxa));
    const nfImportacao = NF_IMPORTACAO.filter(t => v(t)).map(t => ({ taxa: t, valor: v(t) }));
    if (freteDi != null) nfImportacao.push({ taxa: 'frete_di', valor: freteDi });
    else if (freteReal) nfImportacao.push({ taxa: 'frete', valor: r2(freteReal) });
    if (v('seguro')) nfImportacao.push({ taxa: 'seguro', valor: v('seguro') });
    const agregaCusto = [];
    if (v('icms')) agregaCusto.push({ taxa: 'icms', valor: v('icms') });
    if (v('emissao_li')) agregaCusto.push({ taxa: 'emissao_li', valor: v('emissao_li') });
    agenteSemNf.forEach(i => agregaCusto.push({ taxa: i.taxa, valor: i.valor }));
    if (variacaoFrete) agregaCusto.push({ taxa: 'variacao_frete', valor: variacaoFrete });
    const notasFornecedores = [];
    if (v('armazenagem')) notasFornecedores.push({ taxa: 'armazenagem', valor: v('armazenagem') });
    const nfAgente = r2(agenteNf.reduce((s, i) => s + i.valor, 0));
    if (nfAgente) notasFornecedores.push({ taxa: 'nf_agente', valor: nfAgente, itens: agenteNf });
    deb.outros.itens.forEach(i => notasFornecedores.push({ taxa: i.taxa, valor: i.valor }));
    ['despachante', 'sda'].forEach(t => { if (v(t)) notasFornecedores.push({ taxa: t, valor: v(t) }); });
    const soma = arr => r2(arr.reduce((s, x) => s + num(x.valor), 0));
    const notas = {
      nf_importacao: nfImportacao, total_nf_importacao: soma(nfImportacao),
      agrega_custo: agregaCusto, total_agrega_custo: soma(agregaCusto),
      fornecedores: notasFornecedores, total_fornecedores: soma(notasFornecedores),
    };
    notas.total = r2(notas.total_nf_importacao + notas.total_agrega_custo + notas.total_fornecedores);

    // Câmbio da mercadoria: DI × fechado
    const usdMerc = num(p.ci_valor_usd) || num(p.pi_valor_usd);
    const fech = (dados.cambiosFechados || []).filter(c => c && num(c.usd) > 0);
    const fechados = fech.filter(c => num(c.taxa) > 0).map(c => ({ ...c, usd: r2(c.usd), taxa: num(c.taxa), brl: r2(num(c.usd) * num(c.taxa)) }));
    const usdFechado = r2(fechados.reduce((s, c) => s + c.usd, 0));
    const brlFechado = r2(fechados.reduce((s, c) => s + c.brl, 0));
    const cambio = {
      usd: r2(usdMerc), taxa_di: taxaDi || null, brl_di: taxaDi > 0 && usdMerc > 0 ? r2(usdMerc * taxaDi) : null,
      fechados, usd_fechado: usdFechado, brl_fechado: brlFechado,
      taxa_media: usdFechado > 0 ? Math.round(brlFechado / usdFechado * 10000) / 10000 : null,
      falta_fechar_usd: r2(Math.max(0, usdMerc - usdFechado)),
    };
    // variação = o que a DI considerou − o que foi pago; positiva = ganho
    cambio.variacao = cambio.brl_di != null && fechados.length && cambio.falta_fechar_usd < 0.01 ? r2(cambio.brl_di - brlFechado) : null;

    // Pendências
    if (!taxaDi) pendencias.push('Falta a taxa do dólar da DI/DUIMP (aba Documentos).');
    if (!usdMerc) pendencias.push('Falta o valor da mercadoria em US$ (PI/CI).');
    if (usdMerc && !fechados.length) pendencias.push('Nenhum câmbio fechado com taxa no processo.');
    else if (cambio.falta_fechar_usd >= 0.01) pendencias.push(`Câmbio ainda não fechado de US$ ${cambio.falta_fechar_usd.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`);
    if (freteReal && freteDi == null) pendencias.push('Frete sem valor em US$ ou sem taxa da DI — não dá para separar o frete da DI da variação.');
    semCredito.forEach(g => pendencias.push(`${g.label}: nenhum adiantamento pago lançado (registre a fatura/numerário ou informe o valor do Conexos).`));
    grupos.forEach(g => { if (g.tem_credito && Math.abs(g.diferenca) > TOLERANCIA) pendencias.push(`${g.label}: créditos ${g.diferenca > 0 ? 'maiores' : 'menores'} que os débitos em R$ ${Math.abs(g.diferenca).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`); });

    const informativos = INFORMATIVOS.filter(t => num(custos[t])).map(t => ({ taxa: t, valor: r2(custos[t]) }));

    let status = 'ok';
    if (semCredito.length) status = 'sem_creditos';
    else if (grupos.some(g => g.tem_credito && Math.abs(g.diferenca) > TOLERANCIA) || Math.abs(dif) > TOLERANCIA) status = 'diferenca';

    return {
      grupos, total_debitos: totalDeb, total_creditos: totalCred, diferenca: dif, status,
      frete: { usd: freteUsd || null, frete_di: freteDi, frete_real: freteReal ? r2(freteReal) : null, variacao: variacaoFrete },
      notas, cambio, pendencias, informativos, tolerancia: TOLERANCIA,
    };
  }

  const api = { GRUPOS, INFORMATIVOS, AGENTE_SEM_NF, NF_IMPORTACAO, TOLERANCIA, grupoDaTaxa, debitosPorGrupo, creditosDasFaturas, montarConferencia };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ConferenciaFechamento = api;
})();
