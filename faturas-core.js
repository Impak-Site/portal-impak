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
      if (pags.length) pags.forEach(p => { if (ehMigracao(p)) return; if ((iso(p.data) || '').slice(0, 7) === mes) { const c = caixaBrlPagamento(p, f, cambio); if (f.tipo === 'pagar') r.pago_mes += c; else r.recebido_mes += c; } });
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
  // escolhe na tela).
  const MAPA_TAXAS = [
    [/desconsolida/i, 'desconsolidacao'],
    [/libera[cç][aã]o.*(bl|conhecimento)|\bbl release|\bb\/?l fee|release fee/i, 'liberacao_bl'],
    [/\bthc\b|capatazia|terminal handling/i, 'capatazia'],
    [/\bisps\b|security charge|terminal security/i, 'isps'],
    [/armazenagem|storage/i, 'armazenagem'],
    [/siscomex/i, 'siscomex'],
    [/afrmm|marinha mercante/i, 'marinha'],
    [/\bli\b|licen[cç]a de importa/i, 'emissao_li'],
    [/honor[aá]rio|despachante|despacho aduaneiro/i, 'despachante'],
    [/\bsda\b|sindicato/i, 'sda'],
    [/lava[cç][aã]o|limpeza.*container|cleaning/i, 'lavacao'],
    [/drop ?off|devolu[cç][aã]o.*vazio/i, 'drop_off'],
    [/\biof\b/i, 'iof'],
    [/handling|disbursement/i, 'handling'],
    [/\btrs\b|\bcrs\b|cost recovery/i, 'trs'],
    [/\btsc\b/i, 'tsc'],
    [/logistic fee|import logistics|equipment logistic/i, 'import_logistics'],
    [/baixa.*p[aá]tio|pátio/i, 'baixa_patio'],
    [/seguro/i, 'seguro'],
    [/frete|ocean freight|sea freight|freight/i, 'frete'],
    [/agenciamento|agency fee|taxa do agente/i, 'agente'],
    [/reciclag|reciclanip/i, 'reciclagem'],
  ];
  function taxaPorDescricao(desc) {
    const s = limpa(desc);
    if (!s) return null;
    for (const [re, id] of MAPA_TAXAS) if (re.test(s)) return id;
    return null;
  }

  // Procura o processo citado no documento (referência IMPAK, HBL/MBL,
  // container). processos = [{id, referencia, hbl, mbl, container, containers_json}]
  // Referência com ou sem o prefixo "IMPAK-" é o mesmo processo (19/10/2026 —
  // mesma regra de referencia-processo.js): o documento pode citar
  // "ABC123-1" e o Controle ter "IMPAK-ABC123-1", ou o contrário.
  const semPrefixoImpak = s => limpa(s).replace(/^IMPAK[\s._/-]+/i, '');
  function acharProcesso(pistas, processos) {
    const ps = [...new Set((pistas || []).flatMap(p => [p, semPrefixoImpak(p)]).map(p => chave(p).replace(/\s+/g, '')).filter(p => p.length >= 5))];
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
        if (ehMigracao(p)) return;
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
  // Retorna {resumo:{ok,aviso,erro}, checks:[{nivel:'ok'|'aviso'|'erro'|'info', item:idx|null, msg}]}
  function conferirFatura(fatura, processos, existentes, opts) {
    const o = opts || {};
    const f = fatura || {};
    const checks = [];
    const push = (nivel, msg, item) => checks.push({ nivel, msg, item: item == null ? null : item });
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
      if (dup) push('erro', `Documento ${f.documento} dessa empresa já está lançado na fatura ${dup.numero || ''} (${dup.status === 'paga' ? 'paga' : 'em aberto'}). Pode ser cobrança em duplicidade.`);
      else push('ok', `Documento ${f.documento} ainda não foi lançado.`);
    } else push('aviso', 'Sem número de documento — não dá pra checar duplicidade.');

    // 2. Soma das linhas x total
    const itens = Array.isArray(f.itens) ? f.itens : [];
    const soma = itens.reduce((s, it) => s + num(it && it.valor), 0);
    const total = num(f.valor);
    if (itens.length && total > 0) {
      if (Math.abs(soma - total) > 0.05) push('aviso', `Soma das taxas (${fmt(moeda, soma)}) não bate com o total do documento (${fmt(moeda, total)}) — diferença ${fmt(moeda, total - soma)}.`);
      else push('ok', `Soma das taxas bate com o total (${fmt(moeda, total)}).`);
    }

    // 3. Datas
    const venc = iso(f.vencimento), emi = iso(f.emissao);
    if (venc && emi && venc < emi) push('aviso', 'Vencimento antes da emissão — confira as datas.');
    if (venc && o.hoje && venc < o.hoje) push('aviso', `Vencimento ${venc.split('-').reverse().join('/')} já passou.`);

    // 4. Linha a linha contra o processo
    const vistos = new Set();
    const avisadoProc = new Set();
    itens.forEach((it, i) => {
      if (!it) return;
      const v = num(it.valor);
      const p = it.processo_id ? procs[it.processo_id] : null;
      const nomeLinha = `${it.referencia || 'sem processo'} · ${lbl(it.taxa) || it.label || it.descricao || 'taxa'}`;
      if (!p) { push('aviso', `${nomeLinha}: sem processo vinculado — não dá pra conferir com os Custos Reais.`, i); return; }
      if (!avisadoProc.has(p.id)) {
        avisadoProc.add(p.id);
        if (p.cancelado) push('erro', `${p.referencia}: processo está CANCELADO.`, i);
        else if (p.fechado) push('aviso', `${p.referencia}: processo já está FECHADO — lançar custo agora muda o resultado apurado.`, i);
      }
      if (!it.taxa) { push('aviso', `${nomeLinha}: escolha a taxa pra conferir.`, i); return; }
      const chave = p.id + '|' + it.taxa;
      if (vistos.has(chave)) push('aviso', `${nomeLinha}: a mesma taxa aparece mais de uma vez nesta fatura.`, i);
      vistos.add(chave);
      const real = p.real_json || {};
      const meta = (real._meta && real._meta[it.taxa]) || {};
      // taxa já ligada a outra fatura
      if (meta.fatura_id && meta.fatura_id !== f.id) {
        const outra = (existentes || []).find(x => x.id === meta.fatura_id);
        if (!outra || outra.status !== 'cancelada') push('erro', `${nomeLinha}: essa taxa já está na fatura ${outra && outra.numero ? outra.numero : '(outra)'}${outra && outra.documento ? ' — doc ' + outra.documento : ''}.`, i);
      }
      // pagamos para
      if (f.tipo !== 'receber' && (meta.para || meta.para_id) && !mesmaEmpresa(f.empresa_id, f.empresa_nome, meta.para_id, meta.para))
        push('aviso', `${nomeLinha}: no processo está "pagar para ${meta.para || '?'}", mas a fatura é de ${f.empresa_nome || '?'}.`, i);
      if (f.tipo === 'receber' && (meta.de || meta.de_id) && !mesmaEmpresa(f.empresa_id, f.empresa_nome, meta.de_id, meta.de))
        push('aviso', `${nomeLinha}: no processo está "receber de ${meta.de || '?'}", mas a fatura é para ${f.empresa_nome || '?'}.`, i);
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
          if (sist == null || fat == null) { push('aviso', `${nomeLinha}: lançado ${sistTxt} em outra moeda e sem câmbio pra comparar.`, i); return; }
        }
        const dif = fat - sist;
        const tol = Math.max(1, Math.abs(sist) * 0.005);
        if (Math.abs(dif) <= tol) push('ok', `${nomeLinha}: bate com o lançado no sistema (${sistTxt}).`, i);
        else push(Math.abs(dif) > Math.abs(sist) * 0.05 ? 'erro' : 'aviso', `${nomeLinha}: fatura ${fmt(moeda, v)} × sistema ${sistTxt} — diferença ${dif > 0 ? '+' : ''}${(Math.round(dif * 100) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}${moedasReais.length === 1 && moedasReais[0] === moeda ? '' : ' (em R$)'}.`, i);
        return;
      }
      const cot = f.tipo === 'receber' ? null : valorCotado(p.estimativa_json && p.estimativa_json.custos_cotados_json, it.taxa);
      const fatBRL = emBRL(moeda, v);
      if (cot != null && cot > 0 && fatBRL != null) {
        const pct = (fatBRL - cot) / cot * 100;
        const txt = `${nomeLinha}: ainda sem valor lançado nos Custos Reais. Cotado ${fmt('BRL', cot)}, fatura ${fmt('BRL', fatBRL)} (${pct > 0 ? '+' : ''}${pct.toFixed(1).replace('.', ',')}%).`;
        if (pct > 10) push('aviso', txt + ' Acima do cotado.', i);
        else if (pct < -30) push('aviso', txt + ' Bem abaixo do cotado — confira se é cobrança parcial ou se falta algo.', i);
        else push('info', txt, i);
      } else push('info', `${nomeLinha}: ainda sem valor lançado nos Custos Reais e sem valor cotado pra comparar.`, i);
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
  // origem: {tipo:'parcela_cambio'|'venda', processo_id, referencia, idx}
  function chaveOrigem(o) { return o && o.tipo && o.processo_id != null && o.idx != null ? `${o.tipo}:${o.processo_id}:${o.idx}` : null; }

  // Filtro "contém" do banco para as colunas jsonb que guardam uma LISTA de
  // objetos (faturas.itens, faturas.pagamentos). O supabase-js transforma um
  // array em lista do Postgres ("cs.{[object Object]}"), e o banco responde
  // "invalid input syntax for type json" — como o erro era ignorado, a busca
  // voltava sempre vazia (achado em 19/10/2026: o selo da fatura na grade de
  // Custos Reais, o aviso "taxa já faturada" e o aviso "comprovante já usado"
  // nunca apareciam). Mandando o JSON como texto o filtro vira
  // cs.[{...}] e o Postgres usa o operador jsonb @>.
  function filtroJsonbContem(obj) { return JSON.stringify([obj || {}]); }
  // Candidatos a "fatura a receber" de um processo (o que ainda não tem fatura)
  function receberDoProcesso(p, chavesExistentes) {
    const ja = new Set(chavesExistentes || []);
    const out = [];
    if (!p || p.cancelado) return out;
    let parcelas = p.pi_parcelas_json;
    if (typeof parcelas === 'string') { try { parcelas = JSON.parse(parcelas); } catch (e) { parcelas = []; } }
    (Array.isArray(parcelas) ? parcelas : []).forEach((pc, i) => {
      const usd = numBR(pc.valor_usd), cx = parseFloat(String(pc.cambio_fechado || '').replace(',', '.')) || 0;
      if (!(usd > 0) || !cx) return; // só câmbio fechado tem valor em R$ definido
      const origem = { tipo: 'parcela_cambio', processo_id: p.id, referencia: p.referencia, idx: i };
      if (ja.has(chaveOrigem(origem))) return;
      out.push({ origem, empresa_nome: p.cliente || '', documento: `${p.referencia} · câmbio ${pc.label || 'parcela ' + (i + 1)}`, valor: Math.round(usd * cx * 100) / 100, vencimento: iso(pc.data_fechamento_cambio) || iso(pc.data_vencimento) || null,
        ja_recebido: num(pc.valor_recebido_cliente), recebido_em: iso(pc.data_recebimento) });
    });
    let vendas = p.vendas_json;
    if (typeof vendas === 'string') { try { vendas = JSON.parse(vendas); } catch (e) { vendas = []; } }
    (Array.isArray(vendas) ? vendas : []).forEach((v, i) => {
      const valor = numBR(v.nf_saida_valor);
      if (!(valor > 0)) return;
      const origem = { tipo: 'venda', processo_id: p.id, referencia: p.referencia, idx: i };
      if (ja.has(chaveOrigem(origem))) return;
      const dias = parseInt(String(v.prazo_texto || '').match(/\d+/) || [0], 10);
      let venc = iso(v.nf_saida_data);
      if (venc && v.forma_pagamento === 'prazo' && dias > 0) { const d = new Date(venc + 'T12:00:00'); d.setDate(d.getDate() + dias); venc = d.toISOString().slice(0, 10); }
      out.push({ origem, empresa_nome: v.cliente || p.cliente || '', documento: v.nf_saida_numero ? 'NF ' + v.nf_saida_numero : `${p.referencia} · venda ${i + 1}`, valor, vencimento: venc,
        prazo: v.forma_pagamento === 'prazo' ? (v.prazo_texto || '') : 'à vista', ja_recebido: num(v.recebido_valor), recebido_em: iso(v.recebido_em) });
    });
    return out;
  }

  const FaturasCore = { STATUS, TIPOS, MOEDAS, agruparLinhasEmFaturas, validarFatura, situacao, resumoFaturas, fatorBRL, proximoNumero, taxaPorDescricao, acharProcesso, faturasParaAlerta, fluxoMensalFaturas, conferirFatura, valorRealPorMoeda, valorCotado, aplicarPagamentos, saldoFatura, validarPagamento, sugerirFaturasParaComprovante, abatidoPagamento, caixaBrlPagamento, variacaoCambial, darfRetencoes, distribuirLote, RETENCOES, ehMigracao, parseOFX, parseExtratoCSV, conciliarExtrato, idLancamento, chaveOrigem, receberDoProcesso, filtroJsonbContem };
  if (typeof module !== 'undefined' && module.exports) module.exports = FaturasCore;
  if (typeof window !== 'undefined') window.FaturasCore = FaturasCore;
})();
