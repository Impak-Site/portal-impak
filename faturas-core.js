// faturas-core.js — Faturas (contas a pagar / a receber), 14/10/2026.
//
// Uma fatura é um documento de uma empresa (fatura do armador, nota do
// despachante, DARF, boleto ao cliente...) que agrupa uma ou mais taxas de
// um ou mais processos. Nasce da aba Custos Reais ("Gerar faturas": as
// linhas com "Pagamos para" viram contas a PAGAR; as "cobradas à parte"
// com "Receber de" viram contas a RECEBER) e vive na tela /faturas, onde o
// Financeiro marca como paga, informa a data e acompanha vencimentos.
//
// Regras de negócio puras (sem DOM, sem banco) — usadas no navegador
// (controle-modal.js / controle-faturas.js) e no servidor (validação) e
// cobertas por testes_faturas.js.
//
// UMD: navegador (<script src="/faturas-core.js">) e Node.
(function () {
  const STATUS = ['aberta', 'paga', 'cancelada'];
  const TIPOS = ['pagar', 'receber'];
  const MOEDAS = ['BRL', 'USD', 'EUR'];

  const iso = d => {
    if (!d) return null;
    const s = String(d).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };
  const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : Math.round(n * 100) / 100; };
  const limpa = s => (s == null ? '' : String(s)).trim();
  const chave = s => limpa(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  // Agrupa as linhas da aba Custos Reais em faturas candidatas.
  // linha = { taxa, label, lado:'pagar'|'receber', empresa, empresa_id,
  //           documento, valor, moeda, processo_id, referencia, pago_em }
  // Mesma empresa + mesmo documento + mesma moeda + mesmo lado = uma fatura.
  // Linha sem empresa não vira fatura (não dá pra saber pra quem pagar).
  // Linha sem documento agrupa com as outras sem documento da mesma empresa.
  function agruparLinhasEmFaturas(linhas) {
    const grupos = new Map();
    const semEmpresa = [];
    (linhas || []).forEach(l => {
      if (!l) return;
      const valor = num(l.valor);
      if (!(valor > 0)) return;
      const empresa = limpa(l.empresa);
      if (!empresa) { semEmpresa.push(l); return; }
      const lado = l.lado === 'receber' ? 'receber' : 'pagar';
      const moeda = MOEDAS.includes(l.moeda) ? l.moeda : 'BRL';
      const doc = limpa(l.documento);
      const k = [lado, chave(empresa), chave(doc), moeda].join('|');
      if (!grupos.has(k)) grupos.set(k, { tipo: lado, empresa_nome: empresa, empresa_id: l.empresa_id || null, documento: doc || null, moeda, valor: 0, itens: [], vencimento: null, pago_em: null });
      const g = grupos.get(k);
      g.itens.push({ processo_id: l.processo_id || null, referencia: l.referencia || null, taxa: l.taxa, label: l.label || l.taxa, valor, moeda });
      g.valor = Math.round((g.valor + valor) * 100) / 100;
      if (!g.empresa_id && l.empresa_id) g.empresa_id = l.empresa_id;
      // já tem data de pagamento lançada na taxa → fatura nasce paga
      if (l.pago_em && iso(l.pago_em)) g.pago_em = g.pago_em || iso(l.pago_em);
      if (l.vencimento && iso(l.vencimento)) g.vencimento = g.vencimento || iso(l.vencimento);
    });
    return { faturas: [...grupos.values()], semEmpresa };
  }

  // Valida/normaliza o corpo de uma fatura vinda da tela. Devolve
  // { ok, erro, fatura }.
  function validarFatura(b) {
    b = b || {};
    const tipo = TIPOS.includes(b.tipo) ? b.tipo : null;
    if (!tipo) return { ok: false, erro: 'Tipo inválido (pagar/receber).' };
    const empresa_nome = limpa(b.empresa_nome);
    if (!empresa_nome) return { ok: false, erro: 'Informe a empresa (pra quem pagar / de quem receber).' };
    const moeda = MOEDAS.includes(b.moeda) ? b.moeda : 'BRL';
    const itens = Array.isArray(b.itens) ? b.itens.map(it => ({
      processo_id: it && it.processo_id ? String(it.processo_id).slice(0, 80) : null,
      referencia: it && it.referencia ? String(it.referencia).slice(0, 80) : null,
      taxa: it && it.taxa ? String(it.taxa).slice(0, 60) : null,
      label: it && it.label ? String(it.label).slice(0, 120) : null,
      valor: num(it && it.valor), moeda,
    })).filter(it => it.valor > 0 || it.taxa) : [];
    const somaItens = Math.round(itens.reduce((s, it) => s + it.valor, 0) * 100) / 100;
    const valor = b.valor != null && b.valor !== '' ? num(b.valor) : somaItens;
    if (!(valor > 0)) return { ok: false, erro: 'Valor da fatura deve ser maior que zero.' };
    const vencimento = iso(b.vencimento);
    const pago_em = iso(b.pago_em);
    let status = STATUS.includes(b.status) ? b.status : 'aberta';
    if (pago_em && status === 'aberta') status = 'paga';
    const cxRaw = typeof b.cambio === 'string' ? b.cambio.replace(',', '.') : b.cambio;
    const cambio = cxRaw != null && cxRaw !== '' && !isNaN(parseFloat(cxRaw)) && parseFloat(cxRaw) > 0 ? parseFloat(cxRaw) : (moeda === 'BRL' ? 1 : null);
    const fatura = {
      cambio, tipo, empresa_nome, empresa_id: b.empresa_id ? String(b.empresa_id).slice(0, 80) : null,
      documento: limpa(b.documento).slice(0, 120) || null, moeda, valor,
      valor_pago: status === 'paga' ? (b.valor_pago != null && b.valor_pago !== '' ? num(b.valor_pago) : valor) : null,
      emissao: iso(b.emissao), vencimento, pago_em, status,
      obs: limpa(b.obs).slice(0, 1000) || null, itens,
    };
    // classificação financeira (plano de contas / centro de custo) e origem externa (importação)
    if (b.conta_id) fatura.conta_id = String(b.conta_id).slice(0, 80);
    else if (b.conta_id === null || b.conta_id === '') fatura.conta_id = null;
    if (b.centro_custo_id) fatura.centro_custo_id = String(b.centro_custo_id).slice(0, 80);
    else if (b.centro_custo_id === null || b.centro_custo_id === '') fatura.centro_custo_id = null;
    if (b.externo && typeof b.externo === 'object') fatura.externo = { fonte: String(b.externo.fonte || '').slice(0, 30), id: b.externo.id ? String(b.externo.id).slice(0, 80) : null, chave: b.externo.chave ? String(b.externo.chave).slice(0, 300) : null, cnpj: b.externo.cnpj ? String(b.externo.cnpj).slice(0, 20) : null, conta: b.externo.conta ? String(b.externo.conta).slice(0, 80) : null, centro: b.externo.centro ? String(b.externo.centro).slice(0, 80) : null };
    // origem (a receber gerado de parcela de câmbio / venda do processo)
    if (b.origem && ['parcela_cambio', 'venda'].includes(b.origem.tipo) && b.origem.processo_id && Number.isInteger(+b.origem.idx)) {
      fatura.origem = { tipo: b.origem.tipo, processo_id: String(b.origem.processo_id).slice(0, 80), referencia: b.origem.referencia ? String(b.origem.referencia).slice(0, 80) : null, idx: +b.origem.idx };
      // venda em várias parcelas (boletos): qual parcela é esta (21/10/2026)
      const pn = +b.origem.parcela, pd = +b.origem.de;
      if (b.origem.tipo === 'venda' && Number.isInteger(pn) && Number.isInteger(pd) && pd > 1 && pn >= 1 && pn <= pd) { fatura.origem.parcela = pn; fatura.origem.de = pd; }
      // venda no cartão / Trademaster: quem paga é a operadora, com a taxa descontada
      if (b.origem.tipo === 'venda' && ehOperadora(b.origem.operadora)) {
        fatura.origem.operadora = b.origem.operadora;
        const tx = num(b.origem.taxa_operadora);
        if (tx > 0 && tx < valor) fatura.origem.taxa_operadora = tx;
      }
    }
    // numerário do despachante (adiantamento) e a devolução da sobra dele
    // (Faturas fase 2, 21/10/2026) — sempre em R$, ligados a um processo
    else if (b.origem && ['numerario', 'devolucao_numerario'].includes(b.origem.tipo) && b.origem.processo_id) {
      if (moeda !== 'BRL') return { ok: false, erro: 'Numerário é sempre em R$.' };
      if (b.origem.tipo === 'numerario' && tipo !== 'pagar') return { ok: false, erro: 'Numerário é uma conta a pagar (adiantamento ao despachante).' };
      if (b.origem.tipo === 'devolucao_numerario' && (tipo !== 'receber' || !b.origem.numerario_id)) return { ok: false, erro: 'Devolução de numerário é a receber e precisa do numerário de origem.' };
      fatura.origem = { tipo: b.origem.tipo, processo_id: String(b.origem.processo_id).slice(0, 80), referencia: b.origem.referencia ? String(b.origem.referencia).slice(0, 80) : null };
      if (b.origem.numerario_id) fatura.origem.numerario_id = String(b.origem.numerario_id).slice(0, 80);
    }
    return { ok: true, fatura };
  }

  // Nº sequencial NNNNNN/AA a partir do maior já usado no ano.
  function proximoNumero(ultimo, ano) {
    const aa = String(ano).slice(-2);
    let n = 0;
    const m = /^(\d+)\/(\d{2})$/.exec(ultimo || '');
    if (m && m[2] === aa) n = parseInt(m[1], 10);
    return String(n + 1).padStart(6, '0') + '/' + aa;
  }

  // Situação pra tela: vencida / vence hoje / a vencer / paga / cancelada.
  function situacao(f, hoje) {
    if (!f) return 'aberta';
    if (f.status === 'cancelada') return 'cancelada';
    if (f.status === 'paga') return 'paga';
    const v = iso(f.vencimento);
    if (!v) return 'sem_vencimento';
    if (v < hoje) return 'vencida';
    if (v === hoje) return 'hoje';
    const d = Math.round((new Date(v + 'T12:00:00') - new Date(hoje + 'T12:00:00')) / 86400000);
    return d <= 7 ? 'semana' : 'a_vencer';
  }

  // Totais pros cards da tela (em R$ usando o câmbio informado pra USD/EUR).
  // Câmbio pra levar a fatura a R$ nos totais: o da própria fatura; sem ele,
  // o do dia (que só vem quando a cotação carregou). Sem nenhum dos dois → 0
  // e quem soma conta como "sem câmbio" (fora do total, com aviso) — antes
  // entrava o câmbio "1" de quando a cotação não carregava (US$ virava R$).
  function fatorBRL(f, cambioAtual) {
    if (!f || f.moeda === 'BRL' || !f.moeda) return 1;
    return parseFloat(f.cambio) || parseFloat((cambioAtual || {})[f.moeda]) || 0;
  }
  function resumoFaturas(lista, hoje, cambio) {
    cambio = cambio || {};
    const brl = f => num(f.valor) * fatorBRL(f, cambio);
    const r = { pagar_aberto: 0, pagar_vencido: 0, receber_aberto: 0, receber_vencido: 0, pago_mes: 0, recebido_mes: 0, qtd_aberta: 0, qtd_vencida: 0, sem_cambio: 0 };
    const mes = (hoje || '').slice(0, 7);
    (lista || []).forEach(f => {
      if (!f || f.status === 'cancelada') return;
      const s = situacao(f, hoje);
      const fx = fatorBRL(f, cambio);
      const pags = pagamentosValidos(f);
      if (pags.length) pags.forEach(p => { if (ehMigracao(p) || ehCompensacao(p)) return; if ((iso(p.data) || '').slice(0, 7) === mes) { const c = caixaBrlPagamento(p, f, cambio); if (f.tipo === 'pagar') r.pago_mes += c; else r.recebido_mes += c; } });
      if (f.status === 'paga') {
        if (!pags.length && (iso(f.pago_em) || '').slice(0, 7) === mes) { if (!fx) r.sem_cambio++; if (f.tipo === 'pagar') r.pago_mes += brl(f); else r.recebido_mes += brl(f); }
        return;
      }
      if (!fx) r.sem_cambio++;
      const aberto = saldoFatura(f) * fx;
      r.qtd_aberta++;
      if (f.tipo === 'pagar') r.pagar_aberto += aberto; else r.receber_aberto += aberto;
      if (s === 'vencida') { r.qtd_vencida++; if (f.tipo === 'pagar') r.pagar_vencido += aberto; else r.receber_vencido += aberto; }
    });
    Object.keys(r).forEach(k => { r[k] = Math.round(r[k] * 100) / 100; });
    return r;
  }


  // ── IA: descrição da linha da fatura → taxa da aba Custos Reais ──────
  // Ordem importa (mais específico primeiro). Sem match → null (a pessoa
  // escolhe na tela). Regra com taxa null = "não é taxa / ambíguo": para a
  // busca ali mesmo, sem cair numa regra genérica mais abaixo.
  // 19/10/2026 (conferido com as notas de débito dos agentes de carga e os
  // faturamentos do despachante): "Deconsolidation Tax", "Additional Costs",
  // "Impostos (IR/PCC/ISS)" (vai na linha Agente Carga, igual à planilha de
  // Fechamento), "Terminal Security Charge" = TSC (é taxa diferente do
  // ISPS — as duas vêm na mesma fatura), licenças/LPCO, antidumping,
  // marjoração e os tributos do faturamento do despachante.
  const MAPA_TAXAS = [
    // retenção de imposto na fatura: sai do total a pagar, não é custo
    [/\bir\s*retido|\birrf\b|reten[cç][aã]o/i, null],
    [/impostos?\s*\(?\s*ir\b|\bir\s*\/\s*pcc|\bpcc\s*\/\s*iss/i, 'agente'],
    [/de(s)?consolida/i, 'desconsolidacao'],
    [/libera[cç][aã]o.*(bl|conhecimento)|\bbl release|\bb\/?l fee|release fee/i, 'liberacao_bl'],
    [/\bthc\b|capatazia|terminal handling/i, 'capatazia'],
    [/\btsc\b|terminal security|security charge/i, 'tsc'],
    [/\bisps\b/i, 'isps'],
    [/armazenagem|storage/i, 'armazenagem'],
    [/siscomex/i, 'siscomex'],
    [/afrmm|marinha mercante/i, 'marinha'],
    [/\bli\b|\bl\.\s?is?\b|\blpco\b|licen[cç]as? de importa|emiss[aã]o de l\.?i/i, 'emissao_li'],
    [/honor[aá]rio|despachante|despacho aduaneiro/i, 'despachante'],
    [/\bsda\b|sindicato/i, 'sda'],
    [/lava[cç][aã]o|limpeza.*container|cleaning/i, 'lavacao'],
    [/drop ?off|devolu[cç][aã]o.*vazio/i, 'drop_off'],
    [/\biof\b/i, 'iof'],
    [/handling|disbursement/i, 'handling'],
    // 22/10/2026 (aprovado pelo Ayslan, conferido com as notas de débito da
    // Royal e as planilhas): "Container Logistics Fee" (R$ fixo por
    // embarque) é a linha CRS; "Costs at Origin" (US$ 95) é a Additional
    // Costs do Calculador; "Bunker of Origin" (sobretaxa de combustível
    // cobrada junto do frete) é frete internacional. Antes da regra do
    // import logistics, senão "Container Logistics" cairia nela.
    [/container\s+logistics/i, 'trs'],
    [/\btrs\b|\bcrs\b|cost recovery/i, 'trs'],
    [/logistic fee|import logistics|equipment logistic/i, 'import_logistics'],
    [/additional cost|costs?\s+at\s+origin|origin\s+(costs?|charges?)/i, 'additional_costs'],
    [/\bbunker\b|\bbaf\b/i, 'frete'],
    [/baixa.*p[aá]tio|pátio/i, 'baixa_patio'],
    [/anti-?dumping/i, 'antidumping'],
    [/marjora[cç]/i, 'marjoracao'],
    [/seguro/i, 'seguro'],
    // frete rodoviário/terrestre não é o frete internacional: a pessoa escolhe
    [/frete\s+(rodovi|terrestre|interno\b|interna\b|nacional)|transporte\s+(rodovi|terrestre)|carreto/i, null],
    [/frete|ocean freight|sea freight|freight/i, 'frete'],
    [/agenciamento|agency fee|taxa do agente/i, 'agente'],
    [/reciclag|reciclanip/i, 'reciclagem'],
    // Tributos do faturamento do despachante. No fim da lista de propósito:
    // na fatura do terminal o "PIS/COFINS" aparece dentro da descrição de
    // outra taxa (armazenagem, handling), que casa antes.
    [/\bpis\b.*\bcofins\b|\bcofins\b.*\bpis\b/i, null],
    [/^\s*(i\.\s?i\.?|ii)(\s|$|[-–:(])|\bimp(osto|\.)?\s*(de\s+)?importa[cç][aã]o/i, 'ii'],
    [/\bipi\b/i, 'ipi'],
    [/\bpis\b/i, 'pis'],
    [/\bcofins\b/i, 'cofins'],
    [/\bicms\b/i, 'icms'],
  ];
  function taxaPorDescricao(desc) {
    const s = limpa(desc);
    if (!s) return null;
    for (const [re, id] of MAPA_TAXAS) if (re.test(s)) return id;
    return null;
  }

  // ── Custos Reais: documento de custo lido pela IA (19/10/2026) ──────
  // A aba Custos Reais lê a nota de débito do agente de carga, o
  // faturamento (acerto) do despachante e a fatura do terminal (POST
  // /api/faturas/ler-documento com modo 'custos'). A IA devolve cada
  // cobrança com o valor na moeda da linha e o valor em R$ impresso no
  // documento; aqui cada linha ganha a taxa da aba (MAPA_TAXAS) e um valor
  // em R$ — o impresso ou, sem ele, moeda × câmbio do documento (ou do
  // processo). Fica de fora o que não é custo: IR retido (sai do total a
  // pagar, mas a planilha lança o "Impostos (IR/PCC/ISS)" inteiro), totais,
  // adiantamento/saldo e a base do CIF que o despachante repete no topo.
  const TIPOS_DOC_CUSTO = {
    nota_debito_agente: 'Fatura do agente de carga',
    acerto_despachante: 'Faturamento do despachante',
    numerario: 'Numerário do despachante',
    fatura_terminal: 'Fatura do terminal / porto',
    nfse: 'Nota fiscal de serviço',
    darf: 'DARF / guia',
    boleto: 'Boleto',
    outro: 'Documento',
  };
  const RE_TOTAL_DOC = /^\s*(sub)?total\b|\btotal\s+(da|do|das|dos|por|geral|a\s+pagar|cif|despesas|a\s+favor)\b|adiantamento|\bsaldo\b|a\s+favor\s+d[aoe]\b|valor\s+do\s+servi[cç]o/i;
  const RE_IR_RETIDO = /\bir\s*retido|\birrf\b|reten[cç][aã]o/i;
  // topo do faturamento do despachante: só a base do CIF, não é cobrança dele
  const RE_BASE_CIF = /^\s*(valor\s+)?(mle|fob)\b|^\s*valor\s+(do\s+)?frete\b|\btaxa\s+(do\s+)?ce\b|\bce\s+prepaid|^\s*seguro\s*$|total\s+cif/i;

  // dados = resposta da IA; opts = { cambio:{USD,EUR} do processo, ids:[taxas
  // válidas da aba] }. Devolve as linhas que são custo (com taxa sugerida e
  // valor em R$), as que ficaram de fora (com o motivo) e a conferência
  // soma das linhas × total do documento.
  function linhasCustoDocumento(dados, opts) {
    const d = dados || {}, o = opts || {};
    const tipo = TIPOS_DOC_CUSTO[d.tipo_documento] ? d.tipo_documento : 'outro';
    const fx = v => { const n = parseFloat(v); return n > 0 && n < 100 ? n : null; };
    const cambio = { USD: fx(d.taxa_cambio_usd) || fx(o.cambio && o.cambio.USD), EUR: fx(o.cambio && o.cambio.EUR) };
    const ids = Array.isArray(o.ids) ? o.ids : null;
    let irRetido = Math.abs(num(d.ir_retido_brl));
    const linhas = [], fora = [];
    (Array.isArray(d.linhas) ? d.linhas : []).forEach((l, idx) => {
      if (!l || typeof l !== 'object') return;
      const descricao = limpa(l.descricao).replace(/\s+/g, ' ').slice(0, 200);
      const moeda = MOEDAS.includes(l.moeda) ? l.moeda : 'BRL';
      const valor = num(l.valor);
      const impresso = num(l.valor_brl);
      const brl = impresso || (moeda === 'BRL' ? valor : (cambio[moeda] ? num(valor * cambio[moeda]) : 0));
      if (!descricao && !valor && !brl) return;
      const fora_ = motivo => fora.push({ descricao, moeda, valor, valor_brl: brl || null, motivo });
      if (RE_IR_RETIDO.test(descricao)) {
        if (!irRetido) irRetido = Math.abs(brl || valor);
        fora_('IR retido na fonte — sai do total a pagar, não é custo');
        return;
      }
      if (RE_TOTAL_DOC.test(descricao)) { fora_('total, adiantamento ou saldo do documento'); return; }
      if ((tipo === 'acerto_despachante' || tipo === 'numerario') && RE_BASE_CIF.test(descricao)) { fora_('base de cálculo do CIF — não é cobrança do despachante'); return; }
      if (valor < 0 || brl < 0) { fora_('valor negativo (crédito ou desconto) — lance à mão, se for o caso'); return; }
      if (!(brl > 0) && !(valor > 0)) return;
      let taxa = taxaPorDescricao(descricao);
      // terminal/porto: pesagem, levante, handling de saída... tudo é a
      // armazenagem do processo (a planilha lança o total do terminal ali)
      if (tipo === 'fatura_terminal' && (!taxa || taxa === 'handling')) taxa = 'armazenagem';
      if (taxa && ids && !ids.includes(taxa)) taxa = null;
      linhas.push({ idx, descricao, moeda, valor: valor || brl, valor_brl: brl > 0 ? brl : null, convertido: !impresso && moeda !== 'BRL' && brl > 0, taxa, usar: !!taxa });
    });
    const somaBrl = num(linhas.reduce((s, l) => s + (l.valor_brl || 0), 0));
    const semBrl = linhas.filter(l => l.valor_brl == null).length;
    const total = num(d.total_brl);
    let confere = null, diferenca = null;
    if (total > 0 && !semBrl) {
      // o total a pagar pode vir já sem o IR retido (nota de débito do
      // agente) ou não: vale o que chegar mais perto da soma das linhas
      const difBruto = num(somaBrl - total - irRetido), difLiq = num(somaBrl - total);
      diferenca = Math.abs(difBruto) <= Math.abs(difLiq) ? difBruto : difLiq;
      confere = Math.abs(diferenca) < 0.05;
    }
    return {
      tipo, tipo_label: TIPOS_DOC_CUSTO[tipo], linhas, fora,
      soma_brl: somaBrl, total_brl: total || null, ir_retido_brl: irRetido || null, confere, diferenca, sem_brl: semBrl,
      cambio_usd: cambio.USD, adiantamento_brl: num(d.adiantamento_brl) || null, saldo_brl: Math.abs(num(d.saldo_brl)) || null,
      saldo_a_favor: ['importadora', 'emitente'].includes(d.saldo_a_favor) ? d.saldo_a_favor : null,
    };
  }

  // Plano de aplicação na grade: soma as linhas por taxa e decide, taxa a
  // taxa, o que fazer com o valor que já está lançado.
  //   atuais = { id: { valor (número, na moeda), moeda, origem, prefill } }
  //   opts   = { labels:{id:rótulo}, pacotes:[{id, nome, itens, valor}],
  //              origem: tipo do documento lido agora (ex. 'fatura do agente') }
  // Campo vazio (ou só com o cotado pré-preenchido) → preencher; igual
  // (diferença < R$ 0,05 — DUIMP × faturamento do despachante costumam
  // diferir 1 ou 2 centavos) → nada a fazer; diferente → manter o lançado
  // (a pessoa escolhe na tela: trocar, somar os dois ou manter), salvo
  // quando o lançado era o cotado ou veio do mesmo tipo de documento.
  function planoCustosDocumento(linhas, atuais, opts) {
    const o = opts || {}, at = atuais || {};
    const grupos = new Map();
    (linhas || []).forEach(l => {
      if (!l || !l.taxa || l.usar === false) return;
      const g = grupos.get(l.taxa) || { id: l.taxa, brl: 0, faltaBrl: false, moedas: new Set(), valorMoeda: 0, linhas: [] };
      if (l.valor_brl != null) g.brl = num(g.brl + l.valor_brl);
      else { g.faltaBrl = true; g.moedas.add(l.moeda || 'BRL'); g.valorMoeda = num(g.valorMoeda + (num(l.valor) || 0)); }
      g.linhas.push(l.descricao);
      grupos.set(l.taxa, g);
    });
    const itens = [];
    grupos.forEach(g => {
      let valor = g.brl, moeda = 'BRL', erro = null;
      if (g.faltaBrl) {
        if (g.brl === 0 && g.moedas.size === 1) { moeda = [...g.moedas][0]; valor = g.valorMoeda; }
        else erro = 'linhas em moedas diferentes sem o valor em R$ — informe o câmbio ou lance à mão';
      }
      const a = at[g.id] || {};
      const atual = (a.valor != null && a.valor !== '' && !a.prefill && !isNaN(parseFloat(a.valor))) ? num(a.valor) : null;
      const atualMoeda = a.moeda || 'BRL';
      let acao;
      if (erro) acao = 'ignorar';
      else if (atual == null || atual === 0) acao = 'preencher';
      else if (atualMoeda === moeda && Math.abs(atual - valor) < 0.05) acao = 'igual';
      // valor lançado diferente: só troca sozinho o que era estimativa (o
      // cotado) ou o mesmo tipo de documento lido de novo; o resto a pessoa
      // decide — o lançado pode somar mais de um documento (ex.: L.I. do
      // despachante + LPCO), e trocar apagaria a outra parte.
      else acao = (a.origem === 'cotado' || (o.origem && a.origem === o.origem)) ? 'substituir' : 'manter';
      itens.push({ id: g.id, label: (o.labels && o.labels[g.id]) || g.id, valor, moeda, linhas: g.linhas,
        atual, atual_moeda: atualMoeda, atual_origem: a.origem || null, acao, padrao: acao,
        diferenca: (atual == null || atualMoeda !== moeda) ? null : num(valor - atual),
        soma: (atual != null && atualMoeda === moeda) ? num(atual + valor) : null, erro });
    });
    const usados = new Set(itens.filter(i => i.acao !== 'ignorar').map(i => i.id));
    const pacotes = (o.pacotes || []).filter(pk => pk && num(pk.valor) > 0 && (pk.itens || []).some(id => usados.has(id)))
      .map(pk => ({ id: pk.id, nome: pk.nome, valor: num(pk.valor), itens: pk.itens.filter(id => usados.has(id)) }));
    return { itens, pacotes };
  }

  // Procura o processo citado no documento (referência IMPAK, HBL/MBL,
  // container). processos = [{id, referencia, hbl, mbl, container, containers_json}]
  // Referência com ou sem o prefixo "IMPAK-" é o mesmo processo (19/10/2026 —
  // mesma regra de referencia-processo.js): o documento pode citar
  // "ABC123-1" e o Controle ter "IMPAK-ABC123-1", ou o contrário.
  const semPrefixoImpak = s => limpa(s).replace(/^IMPAK[\s._/-]+/i, '');
  // A IA às vezes manda a pista com o rótulo junto ("Ref. Importador:
  // TST2601-1", "HBL QDOS000001"): além da pista inteira, vale cada pedaço
  // que tem número (os códigos), nunca as palavras soltas.
  const pedacosComNumero = s => limpa(s).split(/[\s:;,|]+/).filter(t => /\d/.test(t));
  function acharProcesso(pistas, processos) {
    const ps = [...new Set((pistas || []).flatMap(p => [p, semPrefixoImpak(p), ...pedacosComNumero(p), ...pedacosComNumero(p).map(semPrefixoImpak)])
      .map(p => chave(p).replace(/\s+/g, '')).filter(p => p.length >= 5))];
    if (!ps.length) return null;
    for (const p of (processos || [])) {
      const alvos = [p.referencia, semPrefixoImpak(p.referencia), p.hbl, p.mbl, p.container];
      try { (JSON.parse(p.containers_json || '[]') || []).forEach(c => c && alvos.push(c.numero)); } catch (e) { /* ignora */ }
      const ks = alvos.map(a => chave(a).replace(/\s+/g, '')).filter(a => a.length >= 5);
      if (ps.some(x => ks.includes(x))) return p;
    }
    return null;
  }

  // Faturas pro e-mail diário: abertas vencidas e as que vencem em até N dias.
  function faturasParaAlerta(lista, hoje, dias) {
    const n = dias == null ? 3 : dias;
    const lim = new Date(hoje + 'T12:00:00'); lim.setDate(lim.getDate() + n);
    const limIso = lim.toISOString().slice(0, 10);
    const abertas = (lista || []).filter(f => f && f.status === 'aberta' && iso(f.vencimento));
    const ord = (a, b) => a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : 0;
    return {
      vencidas: abertas.filter(f => f.vencimento < hoje).sort(ord),
      proximas: abertas.filter(f => f.vencimento >= hoje && f.vencimento <= limIso).sort(ord),
    };
  }

  // Fluxo de caixa: soma por mês (YYYY-MM) em R$.
  //   pagar_pago / receber_recebido → pelas faturas pagas no mês (pago_em)
  //   pagar_previsto / receber_previsto → abertas pelo vencimento; as já
  //     vencidas caem no mês corrente (precisam sair do caixa agora).
  function fluxoMensalFaturas(lista, mesesIso, hoje, cambioAtual) {
    const cx = cambioAtual || {};
    const mesHoje = (hoje || '').slice(0, 7);
    const brl = (f, v) => v * fatorBRL(f, cx);
    const out = {};
    (mesesIso || []).forEach(m => { out[m] = { pagar_pago: 0, pagar_previsto: 0, receber_recebido: 0, receber_previsto: 0, qtd: 0 }; });
    const semVenc = { pagar: 0, receber: 0, qtd: 0 };
    const semCambio = { qtd: 0 };
    (lista || []).forEach(f => {
      if (!f || f.status === 'cancelada') return;
      if (!fatorBRL(f, cx) && !(f.status === 'paga' && pagamentosValidos(f).length)) semCambio.qtd++;
      const pags = pagamentosValidos(f);
      // cada baixa entra no mês em que foi paga (parciais também)
      pags.forEach(p => {
        // compensação (encontro de contas, numerário abatido) não é caixa
        if (ehMigracao(p) || ehCompensacao(p)) return;
        const m = (iso(p.data) || '').slice(0, 7);
        if (!out[m]) return;
        const v = caixaBrlPagamento(p, f, cx);
        if (f.tipo === 'pagar') out[m].pagar_pago += v; else out[m].receber_recebido += v;
      });
      if (f.status === 'paga') {
        if (pags.length) { const m = (iso(f.pago_em) || '').slice(0, 7); if (out[m]) out[m].qtd++; return; }
        const m = (iso(f.pago_em) || '').slice(0, 7);
        if (!out[m]) return;
        const v = brl(f, num(f.valor_pago != null ? f.valor_pago : f.valor));
        if (f.tipo === 'pagar') out[m].pagar_pago += v; else out[m].receber_recebido += v;
        out[m].qtd++;
        return;
      }
      const venc = iso(f.vencimento);
      const v = brl(f, saldoFatura(f));
      if (!venc) { semVenc.qtd++; if (f.tipo === 'pagar') semVenc.pagar += v; else semVenc.receber += v; return; }
      let m = venc.slice(0, 7);
      if (m < mesHoje) m = mesHoje;
      if (!out[m]) return;
      if (f.tipo === 'pagar') out[m].pagar_previsto += v; else out[m].receber_previsto += v;
      out[m].qtd++;
    });
    const r2 = x => Math.round(x * 100) / 100;
    Object.values(out).forEach(o => { Object.keys(o).forEach(k => { if (k !== 'qtd') o[k] = r2(o[k]); }); });
    semVenc.pagar = r2(semVenc.pagar); semVenc.receber = r2(semVenc.receber);
    return { meses: out, semVencimento: semVenc, semCambio };
  }

  // ── Conferência (cross-check) da fatura com o que está no sistema ──────
  // Valor lançado na aba Custos Reais (real_json[taxa]) somado por moeda.
  // Aceita os 3 formatos que existem no banco: número solto (R$), {valor,
  // moeda} e {porContainer:{nome:{valor,moeda}}}.
  function valorRealPorMoeda(raw) {
    const out = {};
    const add = (m, v) => { const n = parseFloat(v); if (!isNaN(n) && n !== 0) out[m || 'BRL'] = (out[m || 'BRL'] || 0) + n; };
    if (raw == null || raw === '') return out;
    if (typeof raw === 'number' || typeof raw === 'string') { add('BRL', raw); return out; }
    if (raw.porContainer && typeof raw.porContainer === 'object') {
      Object.values(raw.porContainer).forEach(c => { if (c) add(c.moeda, c.valor); });
      return out;
    }
    add(raw.moeda, raw.valor);
    return out;
  }
  // Valor cotado (Calculador) da taxa, em R$ — estimativa_json.custos_cotados_json.
  const COTADO_GRUPOS = ['taxas_fixas', 'taxas_usd', 'impostos', 'compra', 'comissoes'];
  function valorCotado(cot, taxa) {
    if (!cot || !taxa) return null;
    if (taxa === 'seguro') return cot.compra && cot.compra.seguro_usd != null ? num(cot.compra.seguro_usd) : null;
    if (/^comissao_(br|china|boss)$/.test(taxa)) { const k = taxa.slice(9); return cot.comissoes && cot.comissoes[k] != null ? num(cot.comissoes[k]) : null; }
    for (const g of COTADO_GRUPOS) if (cot[g] && cot[g][taxa] != null && cot[g][taxa] !== '') return num(cot[g][taxa]);
    if (cot[taxa] != null && typeof cot[taxa] !== 'object') return num(cot[taxa]);
    return null;
  }
  const normDoc = s => String(s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/^\s*(N[ºO°.]?|NR\.?|NUM(ERO)?|FAT(URA)?|INV(OICE)?|NF(S?E)?|ND|NOTA( DE DEBITO)?|DOC(UMENTO)?)[\s:.#º°-]*/g, '')
    .replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
  const normNome = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\b(LTDA|S\/?A|EIRELI|ME|EPP|CO|LTD|LIMITED|INC)\b/g, '').replace(/[^A-Z0-9]/g, '');
  function mesmaEmpresa(aId, aNome, bId, bNome) {
    if (aId && bId) return String(aId) === String(bId);
    const x = normNome(aNome), y = normNome(bNome);
    return !!x && !!y && (x === y || (x.length >= 5 && y.length >= 5 && (x.includes(y) || y.includes(x))));
  }

  // fatura: {id?, tipo, empresa_id, empresa_nome, documento, moeda, cambio, valor, emissao, vencimento, itens:[{processo_id, referencia, taxa, label, valor}]}
  // processos: {id: {id, referencia, real_json, estimativa_json, fechado, cancelado}}
  // existentes: faturas já gravadas (pra achar duplicada e taxa já faturada)
  // opts: {hoje:'AAAA-MM-DD', cambio:{USD,EUR}, labels:{taxa:label}}
  // Retorna {resumo:{ok,aviso,erro}, checks:[{nivel:'ok'|'aviso'|'erro'|'info', tipo, item:idx|null, msg}]}
  // tipo (21/10/2026, aba Faturas do processo): o que a checagem olhou —
  // 'duplicidade', 'documento', 'soma', 'datas', 'processo', 'taxa',
  // 'taxa_faturada', 'empresa', 'valor', 'cambio', 'cotado'. É o que separa
  // diferença de verdade (valor, duplicidade...) de aviso que não muda o
  // que se paga (ex.: diferença pequena que é só câmbio) — ver
  // divergenciasConferencia.
  function conferirFatura(fatura, processos, existentes, opts) {
    const o = opts || {};
    const f = fatura || {};
    const checks = [];
    const push = (nivel, msg, item, tipo) => checks.push({ nivel, tipo: tipo || null, msg, item: item == null ? null : item });
    const fmt = (m, v) => (m === 'USD' ? 'US$ ' : m === 'EUR' ? '€ ' : 'R$ ') + (Math.round(v * 100) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const moeda = MOEDAS.includes(f.moeda) ? f.moeda : 'BRL';
    const cx = m => m === 'BRL' ? 1 : (m === moeda && parseFloat(f.cambio) > 0 ? parseFloat(f.cambio) : parseFloat((o.cambio || {})[m]) || 0);
    const emBRL = (m, v) => { const c = cx(m); return c ? v * c : null; };
    const lbl = t => (o.labels && o.labels[t]) || t;
    const procs = processos || {};
    const outras = (existentes || []).filter(x => x && x.status !== 'cancelada' && (!f.id || x.id !== f.id));

    // 1. Duplicidade: mesmo documento da mesma empresa já lançado
    const doc = normDoc(f.documento);
    if (doc) {
      const dup = outras.find(x => normDoc(x.documento) === doc && mesmaEmpresa(f.empresa_id, f.empresa_nome, x.empresa_id, x.empresa_nome));
      if (dup) push('erro', `Documento ${f.documento} dessa empresa já está lançado na fatura ${dup.numero || ''} (${dup.status === 'paga' ? 'paga' : 'em aberto'}). Pode ser cobrança em duplicidade.`, null, 'duplicidade');
      else push('ok', `Documento ${f.documento} ainda não foi lançado.`, null, 'duplicidade');
    } else push('aviso', 'Sem número de documento — não dá pra checar duplicidade.', null, 'documento');

    // 2. Soma das linhas x total
    const itens = Array.isArray(f.itens) ? f.itens : [];
    const soma = itens.reduce((s, it) => s + num(it && it.valor), 0);
    const total = num(f.valor);
    if (itens.length && total > 0) {
      if (Math.abs(soma - total) > 0.05) push('aviso', `Soma das taxas (${fmt(moeda, soma)}) não bate com o total do documento (${fmt(moeda, total)}) — diferença ${fmt(moeda, total - soma)}.`, null, 'soma');
      else push('ok', `Soma das taxas bate com o total (${fmt(moeda, total)}).`, null, 'soma');
    }

    // 3. Datas
    const venc = iso(f.vencimento), emi = iso(f.emissao);
    if (venc && emi && venc < emi) push('aviso', 'Vencimento antes da emissão — confira as datas.', null, 'datas');
    if (venc && o.hoje && venc < o.hoje) push('aviso', `Vencimento ${venc.split('-').reverse().join('/')} já passou.`, null, 'datas');

    // 4. Linha a linha contra o processo
    const vistos = new Set();
    const avisadoProc = new Set();
    itens.forEach((it, i) => {
      if (!it) return;
      const v = num(it.valor);
      const p = it.processo_id ? procs[it.processo_id] : null;
      const nomeLinha = `${it.referencia || 'sem processo'} · ${lbl(it.taxa) || it.label || it.descricao || 'taxa'}`;
      if (!p) { push('aviso', `${nomeLinha}: sem processo vinculado — não dá pra conferir com os Custos Reais.`, i, 'processo'); return; }
      if (!avisadoProc.has(p.id)) {
        avisadoProc.add(p.id);
        if (p.cancelado) push('erro', `${p.referencia}: processo está CANCELADO.`, i, 'processo');
        else if (p.fechado) push('aviso', `${p.referencia}: processo já está FECHADO — lançar custo agora muda o resultado apurado.`, i, 'processo');
      }
      if (!it.taxa) { push('aviso', `${nomeLinha}: escolha a taxa pra conferir.`, i, 'taxa'); return; }
      const chave = p.id + '|' + it.taxa;
      if (vistos.has(chave)) push('aviso', `${nomeLinha}: a mesma taxa aparece mais de uma vez nesta fatura.`, i, 'taxa');
      vistos.add(chave);
      const real = p.real_json || {};
      const meta = (real._meta && real._meta[it.taxa]) || {};
      // taxa já ligada a outra fatura
      if (meta.fatura_id && meta.fatura_id !== f.id) {
        const outra = (existentes || []).find(x => x.id === meta.fatura_id);
        if (!outra || outra.status !== 'cancelada') push('erro', `${nomeLinha}: essa taxa já está na fatura ${outra && outra.numero ? outra.numero : '(outra)'}${outra && outra.documento ? ' — doc ' + outra.documento : ''}.`, i, 'taxa_faturada');
      }
      // pagamos para
      if (f.tipo !== 'receber' && (meta.para || meta.para_id) && !mesmaEmpresa(f.empresa_id, f.empresa_nome, meta.para_id, meta.para))
        push('aviso', `${nomeLinha}: no processo está "pagar para ${meta.para || '?'}", mas a fatura é de ${f.empresa_nome || '?'}.`, i, 'empresa');
      if (f.tipo === 'receber' && (meta.de || meta.de_id) && !mesmaEmpresa(f.empresa_id, f.empresa_nome, meta.de_id, meta.de))
        push('aviso', `${nomeLinha}: no processo está "receber de ${meta.de || '?'}", mas a fatura é para ${f.empresa_nome || '?'}.`, i, 'empresa');
      // valor: lançado (Custos Reais) ou cotado (Calculador)
      const chaveValor = f.tipo === 'receber' ? it.taxa + '_cobrado' : it.taxa;
      const porMoeda = valorRealPorMoeda(real[chaveValor] != null ? real[chaveValor] : (f.tipo === 'receber' ? real[it.taxa] : null));
      const moedasReais = Object.keys(porMoeda);
      if (moedasReais.length) {
        let sist, sistTxt, fat = v;
        if (moedasReais.length === 1 && moedasReais[0] === moeda) { sist = porMoeda[moeda]; sistTxt = fmt(moeda, sist); }
        else {
          const brl = moedasReais.reduce((s, m) => { const b = emBRL(m, porMoeda[m]); return b == null || s == null ? null : s + b; }, 0);
          fat = emBRL(moeda, v);
          sist = brl; sistTxt = moedasReais.map(m => fmt(m, porMoeda[m])).join(' + ');
          if (sist == null || fat == null) { push('aviso', `${nomeLinha}: lançado ${sistTxt} em outra moeda e sem câmbio pra comparar.`, i, 'cambio'); return; }
        }
        const dif = fat - sist;
        const tol = Math.max(1, Math.abs(sist) * 0.005);
        if (Math.abs(dif) <= tol) push('ok', `${nomeLinha}: bate com o lançado no sistema (${sistTxt}).`, i, 'valor');
        else {
          const mesmaMoeda = moedasReais.length === 1 && moedasReais[0] === moeda;
          const difTxt = `${dif > 0 ? '+' : ''}${(Math.round(dif * 100) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}${mesmaMoeda ? '' : ' (em R$)'}`;
          // Fatura numa moeda e lançado em outra: diferença pequena (até 3%)
          // costuma ser só o câmbio usado de cada lado — avisa, mas não conta
          // como diferença de valor (21/10/2026, "menos alarme falso").
          if (!mesmaMoeda && Math.abs(dif) <= Math.abs(sist) * 0.03) push('aviso', `${nomeLinha}: fatura ${fmt(moeda, v)} × sistema ${sistTxt} — diferença ${difTxt}, pequena: deve ser só o câmbio${parseFloat(f.cambio) > 0 && moeda !== 'BRL' ? ' (fatura a ' + String(f.cambio).replace('.', ',') + ')' : ''}.`, i, 'cambio');
          else push(Math.abs(dif) > Math.abs(sist) * 0.05 ? 'erro' : 'aviso', `${nomeLinha}: fatura ${fmt(moeda, v)} × sistema ${sistTxt} — diferença ${difTxt}.`, i, 'valor');
        }
        return;
      }
      const cot = f.tipo === 'receber' ? null : valorCotado(p.estimativa_json && p.estimativa_json.custos_cotados_json, it.taxa);
      const fatBRL = emBRL(moeda, v);
      if (cot != null && cot > 0 && fatBRL != null) {
        const pct = (fatBRL - cot) / cot * 100;
        const txt = `${nomeLinha}: ainda sem valor lançado nos Custos Reais. Cotado ${fmt('BRL', cot)}, fatura ${fmt('BRL', fatBRL)} (${pct > 0 ? '+' : ''}${pct.toFixed(1).replace('.', ',')}%).`;
        if (pct > 10) push('aviso', txt + ' Acima do cotado.', i, 'cotado');
        else if (pct < -30) push('aviso', txt + ' Bem abaixo do cotado — confira se é cobrança parcial ou se falta algo.', i, 'cotado');
        else push('info', txt, i, 'cotado');
      } else push('info', `${nomeLinha}: ainda sem valor lançado nos Custos Reais e sem valor cotado pra comparar.`, i, 'cotado');
    });

    const resumo = { ok: 0, aviso: 0, erro: 0, info: 0 };
    checks.forEach(c => { resumo[c.nivel] = (resumo[c.nivel] || 0) + 1; });
    return { resumo, checks };
  }

  // ── Baixas (pagamentos parciais ou totais) ─────────────────────────────
  // f.pagamentos = [{id, data, valor, juros, desconto, retencoes:{irrf,pis,cofins,csll,iss,inss,outros},
  //                  cambio_efetivo, pago_brl, forma, identificador, lote_id, obs, comprovante, estornado?}]
  //  valor     = principal quitado em dinheiro (moeda da fatura)
  //  juros     = juros/multa pagos a mais (não abatem saldo; é custo extra)
  //  desconto  = abatimento sem dinheiro (abate saldo)
  //  retencoes = impostos retidos na fonte (abatem saldo; viram DARF/guia)
  //  Saldo abatido = valor + desconto + retenções. Estorno marca, não apaga.
  const RETENCOES = ['irrf', 'pis', 'cofins', 'csll', 'iss', 'inss', 'outros'];
  const somaRetencoes = p => RETENCOES.reduce((s, k) => s + num(p && p.retencoes && p.retencoes[k]), 0);
  const abatidoPagamento = p => Math.round((num(p.valor) + num(p.desconto) + somaRetencoes(p)) * 100) / 100;
  // baixa "pago no Conexos antes da migração": abate o saldo, mas não é caixa do período
  const ehMigracao = p => !!(p && (p.migracao || /antes da migra/i.test(p.obs || '')));
  const pagamentosValidos = f => (Array.isArray(f && f.pagamentos) ? f.pagamentos : []).filter(p => p && !p.estornado && (num(p.valor) > 0 || abatidoPagamento(p) > 0));
  // Saída de caixa em R$ de um pagamento (o que realmente saiu da conta)
  function caixaBrlPagamento(p, f, cambioAtual) {
    if (num(p.pago_brl) > 0) return num(p.pago_brl) + (f && f.moeda === 'BRL' ? num(p.juros) : 0);
    const moeda = (f && f.moeda) || 'BRL';
    const dinheiro = num(p.valor) + num(p.juros);
    if (moeda === 'BRL') return dinheiro;
    const cx = parseFloat(p.cambio_efetivo) || parseFloat(f && f.cambio) || parseFloat((cambioAtual || {})[moeda]) || 0;
    return Math.round(dinheiro * cx * 100) / 100;
  }
  // Baixa por compensação (encontro de contas, numerário abatido no acerto):
  // abate o saldo da fatura, mas não movimenta o caixa (o dinheiro já saiu
  // quando o numerário foi pago) — fica fora do fluxo, do "pago no mês" e
  // do saldo dos bancos (Faturas fase 2, 21/10/2026).
  const ehCompensacao = p => !!(p && p.forma === 'compensacao');
  const caixaEfetivoPagamento = (p, f, cambioAtual) => ehCompensacao(p) ? 0 : caixaBrlPagamento(p, f, cambioAtual);
  // Variação cambial da baixa: R$ efetivamente pago − R$ previsto (câmbio da fatura)
  function variacaoCambial(p, f) {
    if (!f || f.moeda === 'BRL') return 0;
    const prev = parseFloat(f.cambio) || 0;
    const real = num(p.pago_brl) > 0 ? num(p.pago_brl) : (parseFloat(p.cambio_efetivo) > 0 ? num(p.valor) * parseFloat(p.cambio_efetivo) : 0);
    if (!prev || !real) return 0;
    return Math.round((real - num(p.valor) * prev) * 100) / 100;
  }
  function aplicarPagamentos(f) {
    const lista = pagamentosValidos(f);
    const valor = num(f && f.valor);
    if (!lista.length) {
      // fatura antiga, baixada antes de existir a lista de pagamentos
      if (f && f.status === 'paga' && !(Array.isArray(f.pagamentos) && f.pagamentos.length)) {
        const vp = f.valor_pago != null ? num(f.valor_pago) : valor;
        return { valor_pago: vp, saldo: 0, status: 'paga', pago_em: iso(f.pago_em), qtd: 0, juros: 0, desconto: 0, retencoes: 0 };
      }
      return { valor_pago: null, saldo: valor, status: f && f.status === 'cancelada' ? 'cancelada' : 'aberta', pago_em: null, qtd: 0, juros: 0, desconto: 0, retencoes: 0 };
    }
    const r2 = x => Math.round(x * 100) / 100;
    const pago = r2(lista.reduce((s, p) => s + abatidoPagamento(p), 0));
    const saldo = r2(valor - pago);
    const quitada = saldo <= 0.01;
    const ultima = lista.map(p => iso(p.data)).filter(Boolean).sort().pop() || null;
    return { valor_pago: pago, saldo: quitada ? 0 : saldo, status: f.status === 'cancelada' ? 'cancelada' : (quitada ? 'paga' : 'aberta'), pago_em: quitada ? ultima : null, qtd: lista.length,
      juros: r2(lista.reduce((s, p) => s + num(p.juros), 0)), desconto: r2(lista.reduce((s, p) => s + num(p.desconto), 0)), retencoes: r2(lista.reduce((s, p) => s + somaRetencoes(p), 0)) };
  }
  function saldoFatura(f) {
    if (!f || f.status === 'cancelada' || f.status === 'paga') return 0;
    const vp = f.valor_pago != null ? num(f.valor_pago) : 0;
    return Math.max(0, Math.round((num(f.valor) - vp) * 100) / 100);
  }
  const numBR = v => { if (v == null || v === '') return 0; if (typeof v === 'number') return num(v); const s = String(v).trim(); return num(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s); };
  function validarPagamento(b, f) {
    b = b || {};
    if (!f) return { ok: false, erro: 'Fatura não encontrada.' };
    if (f.status === 'cancelada') return { ok: false, erro: 'Fatura cancelada — não dá pra dar baixa.' };
    if (f.status === 'paga') return { ok: false, erro: 'Fatura já está quitada.' };
    const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(b.data || '').trim());
    const data = br ? `${br[3]}-${br[2]}-${br[1]}` : iso(b.data);
    if (!data) return { ok: false, erro: 'Informe a data do pagamento.' };
    const valor = numBR(b.valor), juros = numBR(b.juros), desconto = numBR(b.desconto);
    const retencoes = {};
    RETENCOES.forEach(k => { const v = numBR(b.retencoes && b.retencoes[k]); if (v > 0) retencoes[k] = v; });
    if (valor < 0 || juros < 0 || desconto < 0) return { ok: false, erro: 'Valores não podem ser negativos.' };
    const p = { valor, juros, desconto, retencoes };
    const abat = abatidoPagamento(p);
    if (!(abat > 0)) return { ok: false, erro: 'Informe o valor pago (ou desconto/retenções).' };
    const saldo = saldoFatura(f);
    const avisos = [];
    if (abat - saldo > 0.01) avisos.push(`Abatimento maior que o saldo (${saldo.toFixed(2)}) — a diferença fica registrada como pago a mais.`);
    let cambio_efetivo = null, pago_brl = null;
    if (f.moeda && f.moeda !== 'BRL') {
      cambio_efetivo = parseFloat(String(b.cambio_efetivo || '').replace(',', '.')) > 0 ? parseFloat(String(b.cambio_efetivo).replace(',', '.')) : null;
      pago_brl = numBR(b.pago_brl) > 0 ? numBR(b.pago_brl) : (cambio_efetivo ? Math.round((valor + juros) * cambio_efetivo * 100) / 100 : null);
      if (!cambio_efetivo && pago_brl && (valor + juros) > 0) cambio_efetivo = Math.round(pago_brl / (valor + juros) * 1e6) / 1e6;
      // Sem câmbio na baixa E sem câmbio na fatura, o pagamento entraria como
      // R$ 0 no caixa, no DRE e no saldo do banco (revisão 17/10/2026).
      if (!pago_brl && !(parseFloat(f.cambio) > 0)) return { ok: false, erro: `Fatura em ${f.moeda} sem câmbio: use “💰 Dar baixa” e informe o câmbio efetivo (ou o valor pago em R$) — sem isso o pagamento entraria como R$ 0 no caixa.` };
      if (!pago_brl) avisos.push('Fatura em moeda estrangeira sem câmbio/valor em R$ — variação cambial não será apurada.');
    }
    const FORMAS = ['pix', 'ted', 'boleto', 'cambio', 'cartao', 'dinheiro', 'compensacao', 'outro'];
    return { ok: true, aviso: avisos.join(' ') || null, pagamento: {
      data, valor, juros: juros || 0, desconto: desconto || 0, retencoes, cambio_efetivo, pago_brl,
      forma: FORMAS.includes(b.forma) ? b.forma : 'outro',
      banco_id: b.banco_id ? String(b.banco_id).slice(0, 80) : null,
      identificador: limpa(b.identificador).slice(0, 120) || null,
      obs: limpa(b.obs).slice(0, 500) || null,
    } };
  }
  // DARF das retenções federais: vence no dia 20 do mês seguinte ao pagamento
  // (IRRF e PIS/COFINS/CSLL retidos). ISS/INSS ficam de fora (guia municipal/GPS).
  function darfRetencoes(p) {
    const fed = ['irrf', 'pis', 'cofins', 'csll'].reduce((s, k) => s + num(p.retencoes && p.retencoes[k]), 0);
    if (!(fed > 0) || !iso(p.data)) return null;
    const [y, m] = iso(p.data).split('-').map(Number);
    const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
    return { valor: Math.round(fed * 100) / 100, vencimento: `${ny}-${String(nm).padStart(2, '0')}-20` };
  }
  // Distribui um valor de lote entre faturas, na ordem, até o saldo de cada uma.
  function distribuirLote(valorTotal, faturas) {
    let resta = num(valorTotal);
    return (faturas || []).map(f => {
      const s = saldoFatura(f);
      const v = Math.min(s, Math.max(0, resta));
      resta = Math.round((resta - v) * 100) / 100;
      return { id: f.id, valor: Math.round(v * 100) / 100 };
    }).concat(resta > 0.01 ? [{ id: null, sobra: resta }] : []);
  }

  // Comprovante lido pela IA → faturas em aberto mais prováveis (valor do
  // saldo e nome/CNPJ do favorecido). Retorna em ordem de pontuação.
  function sugerirFaturasParaComprovante(comp, abertas) {
    comp = comp || {};
    const v = num(comp.valor);
    const cnpj = String(comp.cnpj_favorecido || '').replace(/\D/g, '');
    return (abertas || []).filter(f => f && f.status === 'aberta').map(f => {
      let pts = 0; const motivos = [];
      const saldo = saldoFatura(f);
      if (v > 0 && Math.abs(saldo - v) <= 0.01) { pts += 50; motivos.push('valor igual ao saldo'); }
      else if (v > 0 && Math.abs(num(f.valor) - v) <= 0.01) { pts += 40; motivos.push('valor igual ao total'); }
      else if (v > 0 && v < saldo) { pts += 10; motivos.push('pode ser pagamento parcial'); }
      if (comp.empresa_id && f.empresa_id && String(comp.empresa_id) === String(f.empresa_id)) { pts += 40; motivos.push('mesma empresa (cadastro)'); }
      else if (mesmaEmpresa(null, comp.favorecido, null, f.empresa_nome)) { pts += 35; motivos.push('mesma empresa'); }
      if (cnpj && f.empresa_cnpj && String(f.empresa_cnpj).replace(/\D/g, '') === cnpj) { pts += 40; motivos.push('mesmo CNPJ'); }
      const doc = normDoc(f.documento);
      if (doc && doc.length >= 3 && normDoc(comp.documento_pago || '').includes(doc)) { pts += 30; motivos.push('nº do documento no comprovante'); }
      return { id: f.id, numero: f.numero, empresa_nome: f.empresa_nome, documento: f.documento, saldo, moeda: f.moeda, vencimento: f.vencimento, pontos: pts, motivos };
    }).filter(x => x.pontos >= 30).sort((a, b) => b.pontos - a.pontos).slice(0, 5);
  }

  // ── Extrato bancário (OFX / CSV) e conciliação ─────────────────────────
  function _dataExtrato(s) {
    s = String(s || '').trim();
    let m = /^(\d{4})(\d{2})(\d{2})/.exec(s); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = /^(\d{2})\/(\d{2})\/(\d{2,4})/.exec(s); if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2]}-${m[1]}`;
    return null;
  }
  function parseOFX(txt) {
    const out = [];
    const blocos = String(txt || '').split(/<STMTTRN>/i).slice(1);
    const tag = (b, t) => { const m = new RegExp('<' + t + '>([^<\\r\\n]*)', 'i').exec(b); return m ? m[1].trim() : ''; };
    blocos.forEach(b => {
      const valor = parseFloat(tag(b, 'TRNAMT').replace(',', '.'));
      const data = _dataExtrato(tag(b, 'DTPOSTED'));
      if (isNaN(valor) || !data) return;
      const memo = [tag(b, 'NAME'), tag(b, 'MEMO')].filter(Boolean).join(' · ');
      out.push({ data, valor: Math.round(Math.abs(valor) * 100) / 100, tipo: valor < 0 ? 'debito' : 'credito', id: tag(b, 'FITID') || null, descricao: memo, doc: tag(b, 'CHECKNUM') || tag(b, 'REFNUM') || '' });
    });
    return out;
  }
  // CSV genérico de banco: acha colunas de data, descrição e valor (ou débito/crédito)
  function parseExtratoCSV(txt) {
    const linhas = String(txt || '').replace(/\r/g, '').split('\n').filter(l => l.trim());
    if (!linhas.length) return [];
    const sep = (linhas[0].match(/;/g) || []).length >= (linhas[0].match(/,/g) || []).length ? ';' : ',';
    const cols = l => l.split(sep).map(c => c.replace(/^"|"$/g, '').trim());
    let hi = linhas.findIndex(l => /data/i.test(l) && /(valor|d[eé]bito|cr[eé]dito)/i.test(l));
    const cab = hi >= 0 ? cols(linhas[hi]).map(c => c.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')) : [];
    const idx = re => cab.findIndex(c => re.test(c));
    const iData = hi >= 0 ? idx(/^data/) : 0, iDesc = hi >= 0 ? idx(/(hist|descr|lanc|memo)/) : 1;
    const iVal = hi >= 0 ? idx(/^valor/) : 2, iDeb = idx(/debito/), iCred = idx(/credito/), iDoc = idx(/(doc|documento)/);
    const out = [];
    linhas.slice(hi + 1).forEach(l => {
      const c = cols(l);
      const data = _dataExtrato(c[iData]);
      if (!data) return;
      let v = null;
      if (iVal >= 0 && c[iVal]) v = numBR(String(c[iVal]).replace(/[^\d,.\-]/g, '')) * (/-/.test(c[iVal]) || /\bD\b/.test(c[iVal]) ? -1 : 1);
      else if (iDeb >= 0 && c[iDeb]) v = -Math.abs(numBR(c[iDeb].replace(/[^\d,.]/g, '')));
      else if (iCred >= 0 && c[iCred]) v = Math.abs(numBR(c[iCred].replace(/[^\d,.]/g, '')));
      if (v == null || !v) return;
      if (iVal >= 0 && String(c[iVal]).trim().startsWith('-')) v = -Math.abs(v);
      out.push({ data, valor: Math.round(Math.abs(v) * 100) / 100, tipo: v < 0 ? 'debito' : 'credito', id: null, descricao: c[iDesc] || '', doc: iDoc >= 0 ? (c[iDoc] || '') : '' });
    });
    return out;
  }
  // Identificador estável de um lançamento do extrato (pra não baixar 2 vezes)
  function idLancamento(t) { return 'EXT:' + (t.id || [t.data, t.tipo, t.valor.toFixed(2), String(t.descricao || '').replace(/\s+/g, ' ').slice(0, 40)].join('|')); }
  // Para cada lançamento: faturas candidatas (débito→pagar, crédito→receber)
  function conciliarExtrato(transacoes, abertas) {
    return (transacoes || []).map(t => {
      const tipo = t.tipo === 'debito' ? 'pagar' : 'receber';
      const cand = (abertas || []).filter(f => f && f.status === 'aberta' && f.tipo === tipo && (f.moeda || 'BRL') === 'BRL').map(f => {
        const saldo = saldoFatura(f);
        let pts = 0; const motivos = [];
        if (Math.abs(saldo - t.valor) <= 0.01) { pts += 50; motivos.push('valor = saldo'); }
        else if (Math.abs(num(f.valor) - t.valor) <= 0.01) { pts += 40; motivos.push('valor = total'); }
        else return null;
        const venc = iso(f.vencimento);
        if (venc) { const d = Math.abs((new Date(t.data + 'T12:00:00') - new Date(venc + 'T12:00:00')) / 86400000); if (d <= 3) { pts += 25; motivos.push('perto do vencimento'); } else if (d <= 15) { pts += 10; motivos.push('vencimento próximo'); } }
        const desc = normNome(t.descricao);
        const emp = normNome(f.empresa_nome);
        if (emp.length >= 4 && desc.includes(emp.slice(0, Math.min(emp.length, 10)))) { pts += 30; motivos.push('nome no extrato'); }
        const doc = normDoc(f.documento);
        if (doc && doc.length >= 3 && (normDoc(t.descricao).includes(doc) || normDoc(t.doc).includes(doc))) { pts += 20; motivos.push('nº do documento'); }
        return { id: f.id, numero: f.numero, empresa_nome: f.empresa_nome, documento: f.documento, saldo, vencimento: f.vencimento, pontos: pts, motivos };
      }).filter(Boolean).sort((a, b) => b.pontos - a.pontos);
      return { ...t, chave: idLancamento(t), tipo_fatura: tipo, candidatos: cand.slice(0, 5), sugerida: cand.length && (cand.length === 1 || cand[0].pontos > cand[1].pontos) ? cand[0].id : null };
    });
  }

  // ── A receber gerado das parcelas de câmbio e das vendas (sem duplicar) ──
  // origem: {tipo:'parcela_cambio'|'venda', processo_id, referencia, idx,
  //          parcela?, de?} — parcela/de (21/10/2026) = n-ésimo boleto de uma
  // venda a prazo em várias parcelas (30/60/90 → 1/3, 2/3, 3/3). Venda de
  // uma parcela só continua sem "parcela" (a mesma chave de antes).
  function chaveOrigem(o) {
    if (!(o && o.tipo && o.processo_id != null && o.idx != null)) return null;
    return `${o.tipo}:${o.processo_id}:${o.idx}` + (o.parcela != null && o.parcela !== '' ? `:${o.parcela}` : '');
  }

  // Filtro "contém" do banco para as colunas jsonb que guardam uma LISTA de
  // objetos (faturas.itens, faturas.pagamentos). O supabase-js transforma um
  // array em lista do Postgres ("cs.{[object Object]}"), e o banco responde
  // "invalid input syntax for type json" — como o erro era ignorado, a busca
  // voltava sempre vazia (achado em 19/10/2026: o selo da fatura na grade de
  // Custos Reais, o aviso "taxa já faturada" e o aviso "comprovante já usado"
  // nunca apareciam). Mandando o JSON como texto o filtro vira
  // cs.[{...}] e o Postgres usa o operador jsonb @>.
  function filtroJsonbContem(obj) { return JSON.stringify([obj || {}]); }

  // ── Quem adianta o câmbio (Ayslan, 21/10/2026) ──────────────────────────
  // Importação própria (IMPORTACAO_DIRETA): a IMPAK fecha o câmbio com o
  // dinheiro dela — a parcela de câmbio NÃO é conta a receber do cliente.
  // Encomenda / conta e ordem (e processo sem finalidade, igual a
  // impakPagaCambio() do Controle): o cliente adianta o valor de cada câmbio.
  // Acompanhamento: a IMPAK não fatura nada.
  // A NF de venda sai com o valor TOTAL da operação e o que o cliente já
  // adiantou é descontado dela:
  //   a receber da venda = NF + juros cobrados − adiantamentos do cliente.
  function clienteAdiantaCambio(p) { return !!p && p.finalidade !== 'IMPORTACAO_DIRETA' && p.finalidade !== 'ACOMPANHAMENTO'; }
  // remessa / retorno de armazém: movimenta a mercadoria, não é venda
  const CFOP_SEM_VENDA = /^(5905|6905|5907|6907|5927|6927)$/;
  const jsonLista = v => { if (Array.isArray(v)) return v; if (typeof v === 'string' && v.trim()) { try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch (e) { return []; } } return []; };
  const somaDiasIso = (d, n) => { if (!d) return null; const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

  // Parcelas (boletos) de uma venda, a partir do prazo escrito na aba Vendas.
  // Jeitos que aparecem nos processos:
  //   "30/60/90", "30 / 60 / 90 DD", "27 / 52 / 77 / 102dd", "30, 60 e 90 dias"
  //   "3 boletos: 17/10, 17/11 e 17/12/2026" (datas; o ano vem da última)
  //   "28 DDL" (uma parcela); vazio ou à vista: uma parcela na data da NF.
  // Devolve [{n, de, vencimento, valor, incerto}] com os centavos fechando no
  // total (a última parcela leva a sobra). incerto = tinha texto de prazo,
  // mas não deu pra tirar dias nem datas dele (fica na data da NF).
  // ── Venda no cartão (REDE) / Trademaster (Faturas fase 2, 21/10/2026) ──
  // O cliente paga a NF no cartão (REDE) ou pela Trademaster, e quem paga a
  // IMPAK é a operadora, já descontada a taxa. Tabelas do Calculador (planilha
  // Rev96, aba DADOS): REDE = taxa (2,91% em 1x, 3,27% de 2x a 6x) + 1,8% a
  // cada 30 dias de prazo médio (antecipação); Trademaster = 2,65% (1x) a
  // 9,29% (6x). A fatura a receber fica no valor cheio da venda, contra a
  // operadora; a taxa entra como desconto na baixa (despesa financeira no
  // DRE) e vai pros Custos Reais (Trademaster / Taxa do cartão).
  const OPERADORAS = {
    cartao: { nome: 'REDE (cartão)', label: 'cartão REDE', taxa_real: 'taxa_cartao' },
    trademaster: { nome: 'Trademaster', label: 'Trademaster', taxa_real: 'trademaster' },
  };
  const CARTAO_REDE = [{ taxa: 0.0291, medio: 30 }, { taxa: 0.0327, medio: 45 }, { taxa: 0.0327, medio: 60 }, { taxa: 0.0327, medio: 75 }, { taxa: 0.0327, medio: 90 }, { taxa: 0.0327, medio: 105 }];
  const TRADEMASTER = [0.0265314523603434, 0.039797178540515, 0.0530629047206867, 0.0663286309008584, 0.0795943570810301, 0.0928600832612018];
  const ehOperadora = forma => Object.prototype.hasOwnProperty.call(OPERADORAS, forma || '');
  function taxaOperadoraPadrao(forma, parcelas) {
    const n = Math.min(6, Math.max(1, parseInt(parcelas, 10) || 1));
    if (forma === 'cartao') { const c = CARTAO_REDE[n - 1]; return c.taxa + 0.018 / 30 * c.medio; }
    if (forma === 'trademaster') return TRADEMASTER[n - 1];
    return 0;
  }
  // Operadora de uma venda (aba Vendas): taxa informada na venda (%) ou a da
  // tabela, valor da taxa, líquido e em quantos dias a operadora paga
  // (padrão 1 — antecipação, como a tabela do Calculador supõe).
  function operadoraDaVenda(v, total) {
    if (!v || !ehOperadora(v.forma_pagamento)) return null;
    const op = OPERADORAS[v.forma_pagamento];
    const parcelas = Math.min(6, Math.max(1, parseInt(v.cartao_parcelas, 10) || 1));
    const txt = String(v.taxa_operadora_pct == null ? '' : v.taxa_operadora_pct).trim().replace(',', '.');
    const informada = txt === '' ? NaN : parseFloat(txt);
    const pct = informada >= 0 && informada < 50 ? informada / 100 : taxaOperadoraPadrao(v.forma_pagamento, parcelas);
    const d = parseInt(v.dias_recebimento, 10);
    const tot = num(total);
    const taxa = num(tot * pct);
    return { forma: v.forma_pagamento, nome: op.nome, label: `${op.label} ${parcelas}x`, parcelas, taxa_pct: Math.round(pct * 1e6) / 1e6,
      taxa_valor: taxa, liquido: num(tot - taxa), dias: d >= 0 && d <= 400 ? d : 1, taxa_real: op.taxa_real, informada: !isNaN(informada) };
  }
  function parcelasDaVenda(v, total) {
    v = v || {};
    const base = iso(v.nf_saida_data);
    const tot = num(total);
    // cartão / Trademaster: a operadora paga tudo de uma vez (antecipado)
    if (ehOperadora(v.forma_pagamento)) {
      const op = operadoraDaVenda(v, tot);
      return [{ n: 1, de: 1, vencimento: base ? somaDiasIso(base, op.dias) : null, valor: tot, incerto: false }];
    }
    let vencs = [], pesos = null, incerto = false;
    if (v.forma_pagamento === 'parcelado' && Array.isArray(v.parcelas) && v.parcelas.length) {
      vencs = v.parcelas.map(pc => somaDiasIso(base, parseInt(pc && pc.dias, 10) || 0));
      pesos = v.parcelas.map(pc => parseFloat(pc && pc.percentual) || 0);
      if (!pesos.some(x => x > 0)) pesos = null;
    } else if (v.forma_pagamento === 'prazo') {
      const txt = String(v.prazo_texto || '');
      const achadas = [...txt.matchAll(/(^|[^\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/g)];
      // "17/10, 17/11" é data (dia/mês); "30/60/90" não (60 não é mês)
      const ehData = achadas.length > 0 && achadas.every(m => +m[2] >= 1 && +m[2] <= 31 && +m[3] >= 1 && +m[3] <= 12);
      if (ehData) {
        const lista = achadas.map(m => ({ d: +m[2], m: +m[3], a: m[4] ? +(m[4].length === 2 ? '20' + m[4] : m[4]) : null }));
        // ano que falta: vem da data seguinte (de trás pra frente)...
        for (let k = lista.length - 2; k >= 0; k--) {
          const it = lista[k], prox = lista[k + 1];
          if (it.a == null && prox.a != null) it.a = it.m > prox.m ? prox.a - 1 : prox.a;
        }
        // ...ou, sem nenhum ano escrito, do ano da NF (virando quando o mês volta)
        let ano = base ? +base.slice(0, 4) : new Date().getFullYear(), mesAnt = base ? +base.slice(5, 7) : null;
        lista.forEach(it => { if (it.a == null) { if (mesAnt != null && it.m < mesAnt) ano++; it.a = ano; } mesAnt = it.m; ano = it.a; });
        vencs = lista.map(it => {
          const s = `${it.a}-${String(it.m).padStart(2, '0')}-${String(it.d).padStart(2, '0')}`;
          const dt = new Date(s + 'T12:00:00');
          return !isNaN(dt) && dt.toISOString().slice(0, 10) === s ? s : null;
        }).filter(Boolean);
      } else {
        const resto = txt.replace(/^\s*\d+\s*(x|vezes|boletos?|duplicatas?|parcelas?)\b/i, ' ');
        const dias = (resto.match(/\d+/g) || []).map(Number).filter(n => n > 0 && n <= 720);
        vencs = dias.map(n => somaDiasIso(base, n));
      }
      if (!vencs.length && txt.trim()) incerto = true;
    }
    if (!vencs.length) vencs = [base];
    const n = vencs.length;
    const valores = [];
    let acum = 0;
    for (let k = 0; k < n; k++) {
      let vv;
      if (k === n - 1) vv = num(tot - acum);
      else if (pesos) { const somaP = pesos.reduce((s, x) => s + x, 0); vv = Math.floor(tot * (pesos[k] / somaP) * 100) / 100; }
      else vv = Math.floor(tot / n * 100) / 100;
      valores.push(vv); acum = num(acum + vv);
    }
    return vencs.map((d, k) => ({ n: k + 1, de: n, vencimento: d || null, valor: valores[k], incerto }));
  }

  // Câmbios do processo (o que a IMPAK remete ao fornecedor), em qualquer forma
  // de pagamento — mesma leitura de listarAdiantamentosCliente() do Controle:
  //   Parcelado (ou sem forma definida): uma por parcela de pi_parcelas_json (idx = posição)
  //   À Vista / A Prazo: um câmbio só (idx −1; A Prazo usa o valor da CI quando há)
  //   Entrada + Saldo: entrada (idx −2) e saldo (idx −3)
  // [{idx, label, usd, cambio (fechado; 0 = ainda aberto), vencimento, recebido, recebido_em}]
  function cambiosDoProcesso(p) {
    if (!p) return [];
    const nr = v => parseFloat(String(v == null ? '' : v).replace(',', '.')) || 0;
    const fp = p.pi_pagamento;
    if (fp === 'VISTA' || fp === 'PRAZO') {
      const ci = nr(p.ci_valor_usd);
      const usd = fp === 'PRAZO' && ci > 0 ? ci : nr(p.pi_valor_usd);
      return [{ idx: -1, label: fp === 'VISTA' ? 'À Vista' : 'A Prazo', usd: num(usd), cambio: nr(p.pi_cambio_fechado),
        vencimento: iso(fp === 'PRAZO' ? p.pi_data_saldo : p.pi_data_entrada), recebido: num(p.pi_valor_recebido_cliente), recebido_em: iso(p.pi_data_recebimento) }];
    }
    if (fp === 'ENTRADA_SALDO') {
      const total = nr(p.pi_valor_usd), pct = (nr(p.pi_entrada_pct) || 30) / 100;
      return [
        { idx: -2, label: 'Entrada', usd: num(total * pct), cambio: nr(p.pi_cambio_entrada), vencimento: iso(p.pi_data_entrada), recebido: 0, recebido_em: null },
        { idx: -3, label: 'Saldo', usd: num(total * (1 - pct)), cambio: nr(p.pi_cambio_saldo), vencimento: iso(p.pi_data_saldo), recebido: 0, recebido_em: null },
      ];
    }
    return jsonLista(p.pi_parcelas_json).map((pc, i) => pc ? { idx: i, label: pc.label || 'parcela ' + (i + 1), usd: numBR(pc.valor_usd), cambio: nr(pc.cambio_fechado),
      vencimento: iso(pc.data_fechamento_cambio) || iso(pc.data_vencimento) || null, recebido: num(pc.valor_recebido_cliente), recebido_em: iso(pc.data_recebimento) } : null).filter(Boolean);
  }

  // Candidatos a "fatura a receber" de um processo (o que ainda não tem fatura).
  // opts.valoresOrigem = { chaveOrigem: valor } das faturas a receber que já
  // existem — o adiantamento já faturado é descontado da NF pelo valor da
  // própria fatura (a pessoa pode ter ajustado o valor ao gerar).
  function receberDoProcesso(p, chavesExistentes, opts) {
    const o = opts || {};
    const ja = new Set(chavesExistentes || []);
    const valoresOrigem = o.valoresOrigem || {};
    const out = [];
    if (!p || p.cancelado || p.finalidade === 'ACOMPANHAMENTO') return out;
    let adiantado = 0;
    if (clienteAdiantaCambio(p)) cambiosDoProcesso(p).forEach(c => {
      if (!(c.usd > 0) || !c.cambio) return; // só câmbio fechado tem valor em R$ definido
      const origem = { tipo: 'parcela_cambio', processo_id: p.id, referencia: p.referencia, idx: c.idx };
      const k = chaveOrigem(origem);
      const valor = Math.round(c.usd * c.cambio * 100) / 100;
      adiantado = num(adiantado + (valoresOrigem[k] != null ? num(valoresOrigem[k]) : valor));
      if (ja.has(k)) return;
      out.push({ origem, tipo_receber: 'adiantamento', empresa_nome: p.cliente || '', documento: `${p.referencia} · câmbio ${c.label}`, valor, vencimento: c.vencimento,
        ja_recebido: c.recebido, recebido_em: c.recebido_em });
    });
    const vendas = jsonLista(p.vendas_json).map((v, i) => ({ v, i })).filter(x => x.v && !CFOP_SEM_VENDA.test(String(x.v.nf_saida_cfop || '').replace(/\D/g, '')) && numBR(x.v.nf_saida_valor) > 0);
    let restoAdiant = adiantado;
    vendas.forEach(({ v, i }) => {
      const valorNF = numBR(v.nf_saida_valor);
      // juros só somam quando a venda diz "Juros no boleto, fora da NF" (o que
      // a aprovação da cotação grava); sem isso eles já estão no valor da NF
      const juros = v.juros_fora_nf ? numBR(v.juros_valor) : 0;
      // o adiantamento é do encomendante: só abate a venda dele
      const doCliente = !v.cliente || !p.cliente || mesmaEmpresa(null, v.cliente, null, p.cliente);
      const abate = doCliente ? Math.min(restoAdiant, num(valorNF + juros)) : 0;
      restoAdiant = num(restoAdiant - abate);
      const total = num(valorNF + juros - abate);
      const origemBase = { tipo: 'venda', processo_id: p.id, referencia: p.referencia, idx: i };
      const kBase = chaveOrigem(origemBase);
      if (ja.has(kBase)) return; // a venda já tem uma fatura única
      if (!(total > 0.004)) return; // tudo coberto pelos adiantamentos
      const parcs = parcelasDaVenda(v, total);
      // já existe fatura de alguma parcela (outro jeito de parcelar): não gera a venda inteira
      if (parcs.length === 1 && [...ja].some(k => k && k.indexOf(kBase + ':') === 0)) return;
      let jaRec = num(v.recebido_valor);
      const docBase = v.nf_saida_numero ? 'NF ' + v.nf_saida_numero : `${p.referencia} · venda ${i + 1}`;
      const op = operadoraDaVenda(v, total);
      const prazo = op ? op.label : v.forma_pagamento === 'prazo' ? (v.prazo_texto || 'a prazo') : (v.forma_pagamento === 'parcelado' ? 'parcelado' : 'à vista');
      const origemDe = pc => {
        const o2 = pc.de > 1 ? { ...origemBase, parcela: pc.n, de: pc.de } : { ...origemBase };
        if (op) { o2.operadora = op.forma; o2.taxa_operadora = op.taxa_valor; }
        return o2;
      };
      // parcelas que já viraram fatura ficam com o valor delas; o que falta
      // da venda se divide entre as que ainda não têm fatura
      const feitas = parcs.filter(pc => ja.has(chaveOrigem(origemDe(pc))));
      if (feitas.length && feitas.length < parcs.length) {
        const somaFeitas = feitas.reduce((s, pc) => { const k = chaveOrigem(origemDe(pc)); return num(s + (valoresOrigem[k] != null ? num(valoresOrigem[k]) : pc.valor)); }, 0);
        const faltam = parcs.filter(pc => !feitas.includes(pc));
        const resto = Math.max(0, num(total - somaFeitas));
        let acum = 0;
        faltam.forEach((pc, k) => { pc.valor = k === faltam.length - 1 ? num(resto - acum) : Math.floor(resto / faltam.length * 100) / 100; acum = num(acum + pc.valor); });
      }
      parcs.forEach(pc => {
        const origem = origemDe(pc);
        const recebidoAqui = Math.min(jaRec, pc.valor); jaRec = num(jaRec - recebidoAqui);
        if (ja.has(chaveOrigem(origem))) return;
        if (!(pc.valor > 0.004)) return;
        out.push({ origem, tipo_receber: 'venda', empresa_nome: op ? op.nome : (v.cliente || p.cliente || ''), cliente: v.cliente || p.cliente || '', documento: docBase + (pc.de > 1 ? ` · parcela ${pc.n}/${pc.de}` : '') + (op ? ` · ${op.label}` : ''), valor: pc.valor, vencimento: pc.vencimento,
          prazo, prazo_incerto: !!pc.incerto, ja_recebido: recebidoAqui, recebido_em: recebidoAqui > 0 ? iso(v.recebido_em) : null,
          valor_nf: valorNF, juros, adiantamento_abatido: abate, total_venda: total, operadora: op });
      });
    });
    return out;
  }

  // ── Faturas dentro do processo (aba Faturas, 21/10/2026) ────────────────
  // Processos de uma fatura: os das taxas (itens) e o da origem (a receber
  // gerado de parcela de câmbio / venda, que não tem itens).
  function processosDaFatura(f) {
    const ids = new Set();
    (Array.isArray(f && f.itens) ? f.itens : []).forEach(it => { if (it && it.processo_id) ids.add(String(it.processo_id)); });
    if (f && f.origem && f.origem.processo_id) ids.add(String(f.origem.processo_id));
    return [...ids];
  }
  // Parte da fatura que é deste processo. Fatura de vários processos (a
  // mesma nota do despachante ou do agente cobrando 2 BLs) entra em cada um
  // só com as taxas dele: fracao = taxas deste processo / todas as taxas.
  function parteDoProcesso(f, pid) {
    if (!f || pid == null) return { fracao: 0, valor: 0, outros: [] };
    const total = num(f.valor);
    if (f.origem && String(f.origem.processo_id) === String(pid)) return { fracao: 1, valor: total, outros: [] };
    const itens = (Array.isArray(f.itens) ? f.itens : []).filter(Boolean);
    const deste = itens.filter(it => String(it.processo_id) === String(pid));
    if (!deste.length) return { fracao: 0, valor: 0, outros: [] };
    const somaTodos = itens.reduce((s, it) => s + num(it.valor), 0);
    const somaDeste = deste.reduce((s, it) => s + num(it.valor), 0);
    const fracao = somaTodos > 0 ? Math.min(1, somaDeste / somaTodos) : 1;
    const outros = [...new Set(itens.filter(it => it.processo_id && String(it.processo_id) !== String(pid)).map(it => it.referencia || String(it.processo_id)))];
    return { fracao, valor: num(total * fracao), outros };
  }

  // Etapas da fatura a pagar, cada uma com quem faz:
  //   Recebida (documento da cobrança anexado) → Conferida (bate com os Custos
  //   Reais) → Aprovada (gerente) → Paga (financeiro dá a baixa).
  const ETAPAS_PAGAR = [
    { id: 'recebida', label: 'Recebida', quem: 'Operacional', dica: 'documento da cobrança anexado' },
    { id: 'conferida', label: 'Conferida', quem: 'Operacional', dica: 'conferida com os Custos Reais' },
    { id: 'aprovada', label: 'Aprovada', quem: 'Gerente', dica: 'pagamento aprovado' },
    { id: 'paga', label: 'Paga', quem: 'Financeiro', dica: 'baixa registrada' },
  ];
  const temDocumentoAnexado = f => (Array.isArray(f && f.anexos) ? f.anexos : []).some(a => a && a.tipo !== 'comprovante');
  // Diferenças de verdade numa conferência salva: erro, ou aviso de valor,
  // duplicidade, soma, empresa ou taxa já faturada. Aviso de câmbio, de
  // cotado, de datas ou de processo fechado não conta (não muda o que pagar).
  const TIPOS_DIFERENCA = ['valor', 'duplicidade', 'soma', 'empresa', 'taxa_faturada'];
  const ehDiferenca = c => !!c && (c.nivel === 'erro' || (c.nivel === 'aviso' && TIPOS_DIFERENCA.includes(c.tipo)));
  // Decisão por diferença (fase 2, 21/10/2026). Cada diferença pode ser
  //   ACEITA     — a fatura está certa ou a diferença foi combinada: deixa de
  //                contar (com motivo, quem e quando);
  //   CONTESTADA — cobrada do fornecedor: continua contando até ele mandar a
  //                fatura corrigida (ou alguém aceitar).
  // A chave é o conteúdo da checagem (tipo + linha + texto): conferiu de novo
  // e a diferença mudou (outro valor) → a decisão antiga não vale mais.
  function chaveCheck(c) {
    if (!c) return '';
    const txt = String(c.msg || '');
    let h = 0;
    for (let i = 0; i < txt.length; i++) h = (Math.imul(h, 31) + txt.charCodeAt(i)) | 0;
    return `${c.tipo || '-'}|${c.item == null ? '-' : c.item}|${(h >>> 0).toString(36)}`;
  }
  const ACOES_DECISAO = ['aceita', 'contestada'];
  function decisaoCheck(conf, c) {
    const d = conf && conf.decisoes && typeof conf.decisoes === 'object' ? conf.decisoes[chaveCheck(c)] : null;
    return d && ACOES_DECISAO.includes(d.acao) ? d : null;
  }
  // Contagem das diferenças de uma conferência: total, aceitas, contestadas
  // e abertas (sem decisão). "Divergências" = total − aceitas.
  function contagemConferencia(conf) {
    const out = { total: 0, aceitas: 0, contestadas: 0, abertas: 0 };
    if (!conf || typeof conf !== 'object') return out;
    const checks = Array.isArray(conf.checks) ? conf.checks : [];
    if (!checks.length) { out.total = out.abertas = Math.round(num(conf.resumo && conf.resumo.erro)); return out; }
    checks.forEach(c => {
      if (!ehDiferenca(c)) return;
      out.total++;
      const d = decisaoCheck(conf, c);
      if (!d) out.abertas++;
      else if (d.acao === 'aceita') out.aceitas++;
      else out.contestadas++;
    });
    return out;
  }
  function divergenciasConferencia(conf) {
    const n = contagemConferencia(conf);
    return n.total - n.aceitas;
  }
  // Conferiu de novo: as decisões cuja diferença continua igual passam pra
  // conferência nova; as outras caem (a diferença mudou ou sumiu).
  function mesclarDecisoes(nova, antiga) {
    const dec = antiga && antiga.decisoes && typeof antiga.decisoes === 'object' ? antiga.decisoes : null;
    const out = {};
    if (!dec || !nova) return out;
    (Array.isArray(nova.checks) ? nova.checks : []).forEach(c => {
      if (!ehDiferenca(c)) return;
      const k = chaveCheck(c);
      if (dec[k] && ACOES_DECISAO.includes(dec[k].acao)) out[k] = dec[k];
    });
    return out;
  }
  // Grava (ou desfaz, com acao vazia) a decisão de uma diferença. Devolve a
  // conferência nova ou { erro }. Não muda as checagens — só as decisões.
  function decidirDiferenca(conf, chave, acao, motivo, quem) {
    if (!conf || typeof conf !== 'object' || !Array.isArray(conf.checks)) return { erro: 'Fatura ainda não conferida.' };
    const c = conf.checks.find(x => ehDiferenca(x) && chaveCheck(x) === chave);
    if (!c) return { erro: 'Essa diferença não está mais na conferência — confira de novo.' };
    const decisoes = { ...(conf.decisoes && typeof conf.decisoes === 'object' ? conf.decisoes : {}) };
    if (!acao) delete decisoes[chave];
    else {
      if (!ACOES_DECISAO.includes(acao)) return { erro: 'Ação inválida.' };
      const m = String(motivo || '').trim().slice(0, 300);
      if (acao === 'aceita' && !m) return { erro: 'Diga o motivo do aceite.' };
      const q = quem || {};
      decisoes[chave] = { acao, motivo: m || null, por: q.por || null, nome: q.nome || null, em: q.em || new Date().toISOString(), msg: String(c.msg || '').slice(0, 300) };
    }
    const nova = { ...conf, decisoes };
    nova.divergencias = divergenciasConferencia(nova);
    return { conferencia: nova };
  }
  // Texto pra mandar ao fornecedor contestando as diferenças (e-mail/WhatsApp).
  function textoContestacao(f, checks, ref) {
    f = f || {};
    const lista = (checks || []).filter(Boolean);
    const doc = f.documento ? `o documento ${f.documento}` : (f.numero ? `a fatura ${f.numero}` : 'a fatura');
    // "sistema" é o nosso controle — pro fornecedor, "esperado"
    const linhas = lista.map(c => '- ' + String(c.msg || '').replace(/\s+/g, ' ').replace(/ × sistema /g, ' × esperado ').replace(/lançado no sistema/g, 'esperado').trim());
    return [
      `Olá${f.empresa_nome ? ', ' + f.empresa_nome : ''}.`,
      '',
      `Conferimos ${doc}${ref ? ' do processo ' + ref : ''}${f.vencimento ? ' (vencimento ' + String(f.vencimento).slice(0, 10).split('-').reverse().join('/') + ')' : ''} com o que foi combinado e encontramos ${lista.length === 1 ? 'esta diferença' : 'estas diferenças'}:`,
      ...linhas,
      '',
      'Podem verificar e nos enviar a fatura corrigida (ou explicar a cobrança)?',
      'Obrigado.',
    ].join('\n');
  }
  // Etapa atual. A pagar: prevista (sem o documento ainda) → recebida →
  // conferida (ou divergente) → aprovada → paga. A receber: a_receber →
  // parcial → paga.
  function etapaFatura(f) {
    if (!f) return 'prevista';
    if (f.status === 'cancelada') return 'cancelada';
    if (f.status === 'paga') return 'paga';
    if (f.tipo === 'receber') return num(f.valor_pago) > 0 ? 'parcial' : 'a_receber';
    if (f.aprovacao) return 'aprovada';
    // numerário é adiantamento com valores estimados: não se confere taxa a
    // taxa (quem confere é o acerto do despachante)
    if (ehNumerario(f)) return 'numerario';
    if (f.conferencia) return divergenciasConferencia(f.conferencia) > 0 ? 'divergente' : 'conferida';
    return temDocumentoAnexado(f) ? 'recebida' : 'prevista';
  }
  // Os 4 passos pra tela: feito / atual / alerta (conferida com diferença) /
  // pulado (passo que não foi registrado, mas a fatura já passou dele) / pendente.
  function passosFatura(f) {
    f = f || {};
    const doc = temDocumentoAnexado(f), conf = f.conferencia, cont = contagemConferencia(conf), div = cont.total - cont.aceitas;
    const paga = f.status === 'paga', aprov = !!f.aprovacao, parcial = num(f.valor_pago) > 0;
    const numer = ehNumerario(f);
    return ETAPAS_PAGAR.map(e => {
      let estado = 'pendente';
      if (e.id === 'recebida') estado = doc ? 'feito' : (paga || aprov || conf || numer ? 'pulado' : 'atual');
      else if (e.id === 'conferida') estado = numer ? 'pulado' : conf ? (div ? 'alerta' : 'feito') : (paga || aprov ? 'pulado' : (doc ? 'atual' : 'pendente'));
      else if (e.id === 'aprovada') estado = aprov ? 'feito' : (paga ? 'pulado' : ((conf && !div) || numer ? 'atual' : 'pendente'));
      else if (e.id === 'paga') estado = paga ? 'feito' : (parcial || aprov ? 'atual' : 'pendente');
      const ehConf = e.id === 'conferida';
      return { ...e, estado, divergencias: ehConf ? div : 0, contestadas: ehConf ? cont.contestadas : 0, aceitas: ehConf ? cont.aceitas : 0 };
    });
  }

  // Resumo por processo pro selo da lista de processos: quantas faturas
  // abertas, vencidas, com diferença na conferência e pagas.
  function resumoPorProcesso(lista, hoje) {
    const out = {};
    (lista || []).forEach(f => {
      if (!f || f.status === 'cancelada') return;
      const sit = situacao(f, hoje), et = etapaFatura(f);
      processosDaFatura(f).forEach(pid => {
        const r = out[pid] || (out[pid] = { qtd: 0, abertas: 0, vencidas: 0, divergentes: 0, pagas: 0, pagar_abertas: 0, receber_abertas: 0 });
        r.qtd++;
        if (f.status === 'paga') r.pagas++;
        else {
          r.abertas++;
          if (f.tipo === 'pagar') r.pagar_abertas++; else r.receber_abertas++;
          if (sit === 'vencida') r.vencidas++;
          if (et === 'divergente') r.divergentes++;
        }
      });
    });
    return out;
  }
  // Selo: vermelho (vencida ou com diferença), amarelo (em aberto), verde
  // (tudo pago). Processo sem fatura não tem selo.
  function seloProcesso(r) {
    if (!r || !r.qtd) return null;
    const s = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);
    const titulo = `${s(r.qtd, 'fatura', 'faturas')}: ${s(r.pagar_abertas, 'a pagar em aberto', 'a pagar em aberto')}, ${s(r.receber_abertas, 'a receber em aberto', 'a receber em aberto')}, ${s(r.pagas, 'paga', 'pagas')}` + (r.vencidas ? `, ${s(r.vencidas, 'vencida', 'vencidas')}` : '') + (r.divergentes ? `, ${s(r.divergentes, 'com diferença na conferência', 'com diferença na conferência')}` : '');
    const partes = [];
    if (r.vencidas) partes.push(s(r.vencidas, 'vencida', 'vencidas'));
    if (r.divergentes) partes.push(s(r.divergentes, 'diferença', 'diferenças'));
    if (partes.length) return { nivel: 'erro', texto: partes.join(' · '), titulo };
    if (r.abertas) return { nivel: 'aviso', texto: s(r.abertas, 'em aberto', 'em aberto'), titulo };
    return { nivel: 'ok', texto: 'Tudo pago', titulo };
  }

  // ── Extrato do processo (21/10/2026) ─────────────────────────────────────
  // O dinheiro do processo em ordem de data, como um extrato de banco: o que
  // já entrou/saiu (realizado) e o que ainda vai entrar/sair (previsto), com
  // o saldo acumulado.
  //   input.faturas = as do processo: cada baixa é realizado (na data dela) e
  //     o saldo em aberto é previsto (no vencimento). Fatura de vários
  //     processos entra só com a parte deste (parteDoProcesso).
  //   input.outros = o que não é fatura e quem chama monta: câmbio do
  //     fornecedor, a receber que ainda não virou fatura, custos lançados
  //     sem fatura... [{data, descricao, valor (R$), sentido:'entrada'|'saida',
  //     realizado, grupo}].
  // Compensação (encontro de contas, ex.: acerto do despachante pago com o
  // numerário) não é caixa: aparece, mas não mexe no saldo. Linha sem data
  // vai para "sem data" (fora do saldo acumulado).
  function extratoProcesso(input, hoje, cambio) {
    const inp = input || {};
    const pid = inp.processo_id;
    const linhas = [], semData = [];
    const add = l => {
      if (!l || !(l.sentido === 'entrada' || l.sentido === 'saida')) return;
      l.valor = num(l.valor);
      if (!(l.valor > 0.004) && !l.compensacao) return;
      l.data = iso(l.data);
      (l.data ? linhas : semData).push(l);
    };
    (inp.faturas || []).forEach(f => {
      if (!f || f.status === 'cancelada') return;
      const parte = parteDoProcesso(f, pid);
      if (!(parte.fracao > 0)) return;
      const sentido = f.tipo === 'receber' ? 'entrada' : 'saida';
      const rotulo = ehNumerario(f) ? 'Numerário' : ehDevolucaoNumerario(f) ? 'Devolução de numerário' : (f.tipo === 'receber' ? 'Recebimento' : 'Pagamento');
      const desc = rotulo + ' · ' + (f.empresa_nome || '') + (f.documento ? ' · ' + f.documento : '');
      const pags = pagamentosValidos(f);
      pags.forEach(pg => {
        const comp = pg.forma === 'compensacao';
        const v = num(caixaBrlPagamento(pg, f, cambio) * parte.fracao);
        add({ data: pg.data, descricao: desc + (comp ? ' (compensação, sem movimento de caixa)' : ''), valor: comp ? 0 : v, valor_compensado: comp ? v : null, compensacao: comp, sentido, realizado: true, grupo: 'fatura', fatura_id: f.id });
      });
      if (f.status === 'paga' && !pags.length) {
        add({ data: f.pago_em, descricao: desc, valor: num(f.valor_pago != null ? f.valor_pago : f.valor) * fatorBRL(f, cambio) * parte.fracao, sentido, realizado: true, grupo: 'fatura', fatura_id: f.id });
      }
      if (f.status === 'aberta') {
        // parte do saldo que vai ser abatida de numerário já previsto (não é
        // caixa de novo): inp.abater = { fatura_id: valor }; a receber da
        // operadora (cartão/Trademaster) entra pelo líquido da taxa
        const taxaOp = f.tipo === 'receber' && f.origem ? Math.max(0, num(f.origem.taxa_operadora) - pags.reduce((s2, pg) => s2 + num(pg.desconto), 0)) : 0;
        const abat = Math.min(saldoFatura(f), num(inp.abater && inp.abater[f.id]) + taxaOp);
        const s = (saldoFatura(f) - abat) * fatorBRL(f, cambio) * parte.fracao;
        const venc = iso(f.vencimento);
        const obsAbat = taxaOp > 0 ? `, líquido da taxa da operadora de R$ ${taxaOp.toFixed(2).replace('.', ',')}` : (abat > 0 ? `, já sem os R$ ${abat.toFixed(2).replace('.', ',')} a abater do numerário` : '');
        add({ data: venc, descricao: desc + ` (em aberto${obsAbat})`, valor: s, sentido, realizado: false, vencida: !!(venc && hoje && venc < hoje), grupo: 'fatura', fatura_id: f.id, sem_cambio: !fatorBRL(f, cambio) });
      }
    });
    (inp.outros || []).forEach(l => add({ ...l, realizado: !!(l && l.realizado) }));
    linhas.sort((a, b) => a.data < b.data ? -1 : a.data > b.data ? 1 : (a.realizado === b.realizado ? 0 : (a.realizado ? -1 : 1)));
    const tot = { realizado: { entradas: 0, saidas: 0, saldo: 0 }, previsto: { entradas: 0, saidas: 0 }, sem_data: { entradas: 0, saidas: 0 }, saldo_com_previsto: 0, saldo_final: 0 };
    let saldo = 0;
    linhas.forEach(l => {
      const sinal = l.sentido === 'entrada' ? 1 : -1;
      saldo = num(saldo + sinal * l.valor);
      l.saldo = saldo;
      const g = l.realizado ? tot.realizado : tot.previsto;
      if (l.sentido === 'entrada') g.entradas = num(g.entradas + l.valor); else g.saidas = num(g.saidas + l.valor);
    });
    semData.forEach(l => { if (l.sentido === 'entrada') tot.sem_data.entradas = num(tot.sem_data.entradas + l.valor); else tot.sem_data.saidas = num(tot.sem_data.saidas + l.valor); });
    tot.realizado.saldo = num(tot.realizado.entradas - tot.realizado.saidas);
    tot.saldo_com_previsto = saldo;
    tot.saldo_final = num(saldo + tot.sem_data.entradas - tot.sem_data.saidas);
    return { linhas, sem_data: semData, totais: tot };
  }

  // ── Numerário do despachante (Faturas fase 2, 21/10/2026) ───────────────
  // O despachante pede um adiantamento (numerário) antes do desembaraço; a
  // IMPAK paga. Depois vem o acerto (faturamento) com os custos de verdade,
  // taxa por taxa. O acerto é quitado abatendo o numerário (baixa "compensação",
  // que não é caixa) e, se faltar, com dinheiro; se sobrar numerário, vira
  // devolução a receber do despachante (ou fica de crédito pro próximo
  // acerto dele). O numerário NÃO é custo (é adiantamento) — o custo é o
  // acerto; assim o caixa sai uma vez só e o DRE não conta em dobro.
  //   numerário: fatura a pagar, origem {tipo:'numerario', processo_id}
  //   abatimento: pagamento {forma:'compensacao', compensa:{tipo:'numerario', fatura_id}}
  //   devolução: fatura a receber, origem {tipo:'devolucao_numerario', numerario_id}
  const ehNumerario = f => !!(f && f.origem && f.origem.tipo === 'numerario');
  const ehDevolucaoNumerario = f => !!(f && f.origem && f.origem.tipo === 'devolucao_numerario');
  // A receber DO CLIENTE (22/10/2026): devolução de numerário é a receber do
  // despachante, não do cliente — fica fora dos cartões "A receber do cliente"
  // e "Recebido" da aba Faturas do processo.
  const ehReceberDoCliente = f => !!(f && f.tipo === 'receber' && !ehDevolucaoNumerario(f));
  // Quanto do numerário já foi usado (abatido em acertos ou devolvido) e
  // quanto sobra. "Pago" = o que entrou no numerário (dinheiro + crédito de
  // outro numerário abatido nele); só o pago pode ser abatido.
  function usoNumerario(numerario, faturas) {
    const n = numerario || {};
    const r2 = x => Math.round(x * 100) / 100;
    let pago = 0;
    if (n.status !== 'cancelada') {
      const pags = pagamentosValidos(n);
      pago = pags.length ? pags.reduce((s, p) => s + abatidoPagamento(p), 0) : (n.status === 'paga' ? num(n.valor_pago != null ? n.valor_pago : n.valor) : 0);
    }
    const usos = [], devolucoes = [];
    (faturas || []).forEach(f => {
      if (!f || f.id === n.id || f.status === 'cancelada') return;
      pagamentosValidos(f).forEach(p => {
        if (!(ehCompensacao(p) && p.compensa && p.compensa.fatura_id === n.id)) return;
        usos.push({ fatura_id: f.id, numero: f.numero || null, documento: f.documento || null, empresa_nome: f.empresa_nome || null, valor: num(p.valor), data: iso(p.data), pagamento_id: p.id || null });
      });
      if (ehDevolucaoNumerario(f) && f.origem.numerario_id === n.id) devolucoes.push({ fatura_id: f.id, numero: f.numero || null, valor: num(f.valor), status: f.status, recebido: num(f.valor_pago) });
    });
    const usado = r2(usos.reduce((s, u) => s + u.valor, 0));
    const devolvido = r2(devolucoes.reduce((s, d) => s + d.valor, 0));
    return { pago: r2(pago), usado, devolvido, disponivel: r2(pago - usado - devolvido), a_pagar: n.status === 'aberta' ? saldoFatura(n) : 0, usos, devolucoes };
  }
  // Numerários de um despachante (empresa) que ainda têm saldo pra abater.
  function numerariosComSaldo(empresa, numerarios, faturas) {
    const e = empresa || {};
    return (numerarios || []).filter(n => ehNumerario(n) && n.status !== 'cancelada' && mesmaEmpresa(e.empresa_id, e.empresa_nome, n.empresa_id, n.empresa_nome))
      .map(n => ({ numerario: n, uso: usoNumerario(n, faturas) }))
      .filter(x => x.uso.disponivel > 0.009)
      .sort((a, b) => String(a.numerario.vencimento || a.numerario.created_at || '').localeCompare(String(b.numerario.vencimento || b.numerario.created_at || '')));
  }
  // Abater (parte de) um numerário numa fatura a pagar do mesmo despachante.
  // Devolve { ok, erro, valor } — o valor é limitado ao saldo da fatura e ao
  // disponível do numerário.
  function validarAbatimentoNumerario(fatura, numerario, valor, faturas) {
    const f = fatura || {}, n = numerario || {};
    if (!f.id || !n.id) return { ok: false, erro: 'Fatura ou numerário não encontrado.' };
    if (!ehNumerario(n)) return { ok: false, erro: 'A fatura escolhida não é um numerário.' };
    if (f.id === n.id) return { ok: false, erro: 'Não dá pra abater o numerário nele mesmo.' };
    if (f.tipo !== 'pagar') return { ok: false, erro: 'Numerário só abate conta a pagar.' };
    if (f.status !== 'aberta') return { ok: false, erro: f.status === 'paga' ? 'Esta fatura já está quitada.' : 'Fatura cancelada.' };
    if ((f.moeda || 'BRL') !== 'BRL') return { ok: false, erro: 'O numerário é em R$ — só abate fatura em R$.' };
    if (n.status === 'cancelada') return { ok: false, erro: 'Numerário cancelado.' };
    if (!mesmaEmpresa(f.empresa_id, f.empresa_nome, n.empresa_id, n.empresa_nome)) return { ok: false, erro: `O numerário é de ${n.empresa_nome || '?'} e a fatura é de ${f.empresa_nome || '?'} — só abate fatura do mesmo despachante.` };
    const uso = usoNumerario(n, faturas);
    if (!(uso.disponivel > 0.009)) return { ok: false, erro: uso.pago > 0 ? 'Este numerário já foi todo abatido (ou devolvido).' : 'Este numerário ainda não foi pago — dê a baixa nele antes de abater.' };
    const saldo = saldoFatura(f);
    const pedido = valor == null || valor === '' ? Math.min(saldo, uso.disponivel) : num(typeof valor === 'string' ? valor.replace(/\./g, '').replace(',', '.') : valor);
    if (!(pedido > 0)) return { ok: false, erro: 'Informe o valor a abater.' };
    if (pedido - uso.disponivel > 0.01) return { ok: false, erro: `O numerário só tem R$ ${uso.disponivel.toFixed(2).replace('.', ',')} disponível.` };
    if (pedido - saldo > 0.01) return { ok: false, erro: `O saldo desta fatura é R$ ${saldo.toFixed(2).replace('.', ',')} — não dá pra abater mais que isso.` };
    return { ok: true, valor: Math.round(pedido * 100) / 100, uso };
  }

  // ── Agenda (Faturas fase 2, 21/10/2026) ─────────────────────────────────
  // O mínimo de cada fatura pra Agenda gerar as tarefas por responsável
  // (agenda-core.js: conferir, decidir diferenças, aprovar, pagar, acertar
  // numerário, receber) — no navegador e no job do servidor, com a mesma
  // regra. Sai sem itens, checagens, anexos e pagamentos: só etapa,
  // contagens, datas e valores. Fatura sem processo (despesa geral) fica
  // fora. processos[0] = o "dono" (o de maior parte da fatura; empate: o
  // primeiro) — a tarefa aparece só nele, pra não duplicar.
  function faturasParaAgenda(lista) {
    const todas = (lista || []).filter(f => f && f.id && f.status !== 'cancelada');
    const datas = arr => arr.map(iso).filter(Boolean).sort();
    const out = [];
    todas.forEach(f => {
      const pids = processosDaFatura(f);
      if (!pids.length) return;
      const processos = pids.map((id, ordem) => ({ id, fracao: parteDoProcesso(f, id).fracao, ordem }))
        .sort((a, b) => b.fracao - a.fracao || a.ordem - b.ordem)
        .map(x => ({ id: x.id, fracao: Math.round(x.fracao * 1000) / 1000 }));
      const conf = f.conferencia && typeof f.conferencia === 'object' ? f.conferencia : null;
      const docs = (Array.isArray(f.anexos) ? f.anexos : []).filter(a => a && a.tipo !== 'comprovante');
      const pags = pagamentosValidos(f);
      const o = f.origem && typeof f.origem === 'object' ? f.origem : null;
      const s = {
        id: f.id, numero: f.numero || null, tipo: f.tipo, status: f.status,
        empresa_id: f.empresa_id || null, empresa_nome: f.empresa_nome || '', documento: f.documento || null,
        vencimento: iso(f.vencimento), moeda: f.moeda || 'BRL', valor: num(f.valor), valor_pago: num(f.valor_pago), saldo: saldoFatura(f),
        etapa: etapaFatura(f), criada_em: iso(f.created_at),
        doc_em: docs.length ? (datas(docs.map(a => a.em))[0] || iso(f.created_at)) : null,
        conf: conf ? Object.assign(contagemConferencia(conf), { em: iso(conf.em) }) : null,
        aprovada: !!f.aprovacao,
        ultimo_pagamento: datas(pags.map(p => p.data)).pop() || iso(f.pago_em),
        processos,
        origem: o ? { tipo: o.tipo || null, processo_id: o.processo_id || null, idx: o.idx == null ? null : o.idx, parcela: o.parcela || null, de: o.de || null,
          numerario_id: o.numerario_id || null, operadora: o.operadora || null } : null,
      };
      // cartão / Trademaster: taxa da operadora que ainda não foi descontada
      if (o && o.operadora) s.taxa_restante = Math.max(0, num(num(o.taxa_operadora) - pags.reduce((t, p) => t + num(p.desconto), 0)));
      out.push(s);
    });
    // Numerário: quanto sobra e os acertos do mesmo despachante no processo dele.
    const porId = new Map(todas.map(f => [f.id, f]));
    out.forEach(s => {
      if (!(s.origem && s.origem.tipo === 'numerario')) return;
      const n = porId.get(s.id);
      const uso = usoNumerario(n, todas);
      const pidsN = new Set(s.processos.map(x => x.id));
      const acertos = todas.filter(f => f.id !== n.id && f.tipo === 'pagar' && !ehNumerario(f)
        && mesmaEmpresa(f.empresa_id, f.empresa_nome, n.empresa_id, n.empresa_nome) && processosDaFatura(f).some(id => pidsN.has(id)));
      const pagos = acertos.filter(f => f.status === 'paga');
      s.numerario = { pago: uso.pago, usado: uso.usado, devolvido: uso.devolvido, disponivel: uso.disponivel,
        acertos_abertos: acertos.filter(f => f.status === 'aberta').map(f => ({ id: f.id, numero: f.numero || null, documento: f.documento || null, vencimento: iso(f.vencimento), saldo: saldoFatura(f) }))
          .sort((a, b) => String(a.vencimento || '9999').localeCompare(String(b.vencimento || '9999'))),
        acertos_pagos: pagos.length,
        ultimo_acerto_pago: datas(pagos.map(f => datas(pagamentosValidos(f).map(p => p.data)).pop() || f.pago_em)).pop() || null };
    });
    // A pagar em aberto do despachante que tem numerário com saldo: dica "dá pra abater".
    const comSaldo = out.filter(s => s.numerario && s.numerario.disponivel > 0.009);
    if (comSaldo.length) out.forEach(s => {
      if (s.tipo !== 'pagar' || s.status !== 'aberta' || s.numerario || s.moeda !== 'BRL') return;
      const disp = comSaldo.filter(n => mesmaEmpresa(s.empresa_id, s.empresa_nome, n.empresa_id, n.empresa_nome)).reduce((t, n) => t + n.numerario.disponivel, 0);
      if (disp > 0.009) s.numerario_disponivel = num(disp);
    });
    return out;
  }

  const FaturasCore = { STATUS, TIPOS, MOEDAS, agruparLinhasEmFaturas, validarFatura, situacao, resumoFaturas, fatorBRL, proximoNumero, taxaPorDescricao, acharProcesso, faturasParaAlerta, fluxoMensalFaturas, conferirFatura, valorRealPorMoeda, valorCotado, aplicarPagamentos, saldoFatura, validarPagamento, sugerirFaturasParaComprovante, abatidoPagamento, caixaBrlPagamento, variacaoCambial, darfRetencoes, distribuirLote, RETENCOES, ehMigracao, parseOFX, parseExtratoCSV, conciliarExtrato, idLancamento, chaveOrigem, receberDoProcesso, filtroJsonbContem, TIPOS_DOC_CUSTO, linhasCustoDocumento, planoCustosDocumento,
    clienteAdiantaCambio, cambiosDoProcesso, parcelasDaVenda, processosDaFatura, parteDoProcesso, ETAPAS_PAGAR, etapaFatura, passosFatura, divergenciasConferencia, TIPOS_DIFERENCA, ehDiferenca, chaveCheck, decisaoCheck, contagemConferencia, mesclarDecisoes, decidirDiferenca, textoContestacao, ehCompensacao, caixaEfetivoPagamento, ehNumerario, ehDevolucaoNumerario, ehReceberDoCliente, usoNumerario, numerariosComSaldo, validarAbatimentoNumerario, OPERADORAS, ehOperadora, taxaOperadoraPadrao, operadoraDaVenda, resumoPorProcesso, seloProcesso, extratoProcesso, pagamentosValidos, faturasParaAgenda };
  if (typeof module !== 'undefined' && module.exports) module.exports = FaturasCore;
  if (typeof window !== 'undefined') window.FaturasCore = FaturasCore;
})();
