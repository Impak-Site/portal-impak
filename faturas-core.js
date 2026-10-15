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
  function resumoFaturas(lista, hoje, cambio) {
    cambio = cambio || {};
    const brl = f => f.moeda === 'BRL' ? num(f.valor) : num(f.valor) * (parseFloat(cambio[f.moeda]) || 0);
    const r = { pagar_aberto: 0, pagar_vencido: 0, receber_aberto: 0, receber_vencido: 0, pago_mes: 0, recebido_mes: 0, qtd_aberta: 0, qtd_vencida: 0 };
    const mes = (hoje || '').slice(0, 7);
    (lista || []).forEach(f => {
      if (!f || f.status === 'cancelada') return;
      const s = situacao(f, hoje);
      if (f.status === 'paga') {
        if ((iso(f.pago_em) || '').slice(0, 7) === mes) { if (f.tipo === 'pagar') r.pago_mes += brl(f); else r.recebido_mes += brl(f); }
        return;
      }
      r.qtd_aberta++;
      if (f.tipo === 'pagar') r.pagar_aberto += brl(f); else r.receber_aberto += brl(f);
      if (s === 'vencida') { r.qtd_vencida++; if (f.tipo === 'pagar') r.pagar_vencido += brl(f); else r.receber_vencido += brl(f); }
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
  function acharProcesso(pistas, processos) {
    const ps = (pistas || []).map(p => chave(p).replace(/\s+/g, '')).filter(p => p.length >= 5);
    if (!ps.length) return null;
    for (const p of (processos || [])) {
      const alvos = [p.referencia, p.hbl, p.mbl, p.container];
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
    const brl = (f, v) => f.moeda === 'BRL' ? v : v * (parseFloat(f.cambio) || parseFloat(cx[f.moeda]) || 0);
    const out = {};
    (mesesIso || []).forEach(m => { out[m] = { pagar_pago: 0, pagar_previsto: 0, receber_recebido: 0, receber_previsto: 0, qtd: 0 }; });
    const semVenc = { pagar: 0, receber: 0, qtd: 0 };
    (lista || []).forEach(f => {
      if (!f || f.status === 'cancelada') return;
      if (f.status === 'paga') {
        const m = (iso(f.pago_em) || '').slice(0, 7);
        if (!out[m]) return;
        const v = brl(f, num(f.valor_pago != null ? f.valor_pago : f.valor));
        if (f.tipo === 'pagar') out[m].pagar_pago += v; else out[m].receber_recebido += v;
        out[m].qtd++;
        return;
      }
      const venc = iso(f.vencimento);
      const v = brl(f, num(f.valor));
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
    return { meses: out, semVencimento: semVenc };
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

  const FaturasCore = { STATUS, TIPOS, MOEDAS, agruparLinhasEmFaturas, validarFatura, situacao, resumoFaturas, proximoNumero, taxaPorDescricao, acharProcesso, faturasParaAlerta, fluxoMensalFaturas, conferirFatura, valorRealPorMoeda, valorCotado };
  if (typeof module !== 'undefined' && module.exports) module.exports = FaturasCore;
  if (typeof window !== 'undefined') window.FaturasCore = FaturasCore;
})();
