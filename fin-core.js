// fin-core.js — regras do financeiro da empresa (14/10/2026):
// plano de contas, contas bancárias (saldo), DRE gerencial (caixa ou
// competência), lançamentos para o contador e importação de títulos do
// Conexos. Funções puras (servidor, navegador e testes usam as mesmas).
// Depende de FaturasCore (faturas-core.js) para baixas/saldos.
(function () {
  'use strict';
  const FC = (typeof module !== 'undefined' && module.exports) ? require('./faturas-core.js') : (typeof window !== 'undefined' ? window.FaturasCore : null);

  const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  const r2 = x => Math.round(x * 100) / 100;
  const iso = d => { if (!d) return null; const s = String(d).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };
  const numBR = v => {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return v;
    let s = String(v).trim().replace(/[R$US€\s]/g, '');
    const neg = /^\(.*\)$/.test(s) || /-$/.test(s) || /^-/.test(s);
    s = s.replace(/[()\-]/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s); return isNaN(n) ? 0 : (neg ? -n : n);
  };
  const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  // ── Plano de contas padrão (editável na tela; não entra conta real da empresa) ─
  // grupo define a linha do DRE. 'neutra' = não entra no DRE (repasses, empréstimos).
  const GRUPOS = [
    ['receita_bruta', 'Receita bruta', +1],
    ['deducoes', '(−) Deduções e impostos sobre vendas', -1],
    ['custo', '(−) Custos das mercadorias importadas', -1],
    ['despesa_operacional', '(−) Despesas operacionais', -1],
    ['receita_financeira', '(+) Receitas financeiras', +1],
    ['despesa_financeira', '(−) Despesas financeiras', -1],
    ['impostos_lucro', '(−) IRPJ / CSLL', -1],
    ['neutra', 'Não entra no DRE', 0],
  ];
  const PLANO_PADRAO = [
    ['3.1.01', 'Receita de vendas de mercadorias', 'receita_bruta'],
    ['3.1.02', 'Reembolsos de clientes (câmbio / despesas)', 'receita_bruta'],
    ['3.1.03', 'Outras receitas operacionais', 'receita_bruta'],
    ['3.2.01', 'Juros e descontos obtidos', 'receita_financeira'],
    ['3.2.02', 'Variação cambial ativa', 'receita_financeira'],
    ['4.1.01', 'Impostos sobre vendas (ICMS, PIS, COFINS, IPI)', 'deducoes'],
    ['4.1.02', 'ICMS / ICMS-ST a recolher (apuração)', 'deducoes'],
    ['4.1.03', 'PIS / COFINS a recolher (apuração)', 'deducoes'],
    ['4.2.01', 'Custo da mercadoria importada (FOB)', 'custo'],
    ['4.2.02', 'Frete e seguro internacional', 'custo'],
    ['4.2.03', 'Impostos de importação', 'custo'],
    ['4.2.04', 'Despesas portuárias, armazenagem e despachante', 'custo'],
    ['4.2.05', 'Frete nacional', 'custo'],
    ['4.2.06', 'Comissões', 'custo'],
    ['5.1.01', 'Salários (folha de pagamento)', 'despesa_operacional'],
    ['5.1.02', 'Pró-labore', 'despesa_operacional'],
    ['5.1.03', 'Aluguel e condomínio', 'despesa_operacional'],
    ['5.1.04', 'Energia, água, telefone e internet', 'despesa_operacional'],
    ['5.1.05', 'Sistemas e software', 'despesa_operacional'],
    ['5.1.06', 'Contabilidade e jurídico', 'despesa_operacional'],
    ['5.1.07', 'Marketing e viagens', 'despesa_operacional'],
    ['5.1.08', 'Material e despesas gerais', 'despesa_operacional'],
    ['5.1.09', 'Impostos e taxas (não sobre vendas)', 'despesa_operacional'],
    ['5.1.10', 'Encargos sociais (INSS, FGTS)', 'despesa_operacional'],
    ['5.1.11', 'Benefícios (VT, VR, plano de saúde)', 'despesa_operacional'],
    ['5.1.12', 'Férias, 13º e rescisões', 'despesa_operacional'],
    ['5.1.13', 'Seguros', 'despesa_operacional'],
    ['5.1.14', 'Manutenção e conservação', 'despesa_operacional'],
    ['5.1.15', 'Veículos e combustível', 'despesa_operacional'],
    ['5.2.01', 'Tarifas bancárias', 'despesa_financeira'],
    ['5.2.02', 'Juros e multas pagos', 'despesa_financeira'],
    ['5.2.03', 'Variação cambial passiva', 'despesa_financeira'],
    ['5.2.04', 'IOF', 'despesa_financeira'],
    ['6.1.01', 'IRPJ e CSLL', 'impostos_lucro'],
    ['9.1.01', 'Impostos retidos a recolher (repasse)', 'neutra'],
    ['9.1.02', 'Empréstimos e financiamentos (principal)', 'neutra'],
    ['9.1.03', 'Distribuição de lucros', 'neutra'],
    ['9.1.04', 'Aplicações e resgates', 'neutra'],
  ];
  // Taxa do processo (Custos Reais) → conta de custo padrão
  function contaPadraoPorTaxa(taxa) {
    const t = String(taxa || '');
    if (/^(fob)$/.test(t)) return '4.2.01';
    if (/^(frete|seguro|handling|additional_costs|import_logistics|trs|tsc|drop_off|isps|desconsolidacao)$/.test(t)) return '4.2.02';
    if (/^(ii|ipi|pis|cofins|icms|ibs|cbs|antidumping|marinha|siscomex|taxa_ce|diferenca_|marjoracao)/.test(t)) return '4.2.03';
    if (/^comissao|^timp|^trademaster/.test(t)) return '4.2.06';
    if (/frete_terrestre|frete_nacional|transporte/.test(t)) return '4.2.05';
    if (/^iof$/.test(t)) return '5.2.04';
    return '4.2.04';
  }
  function validarConta(b) {
    b = b || {};
    const codigo = String(b.codigo || '').trim().slice(0, 20);
    const nome = String(b.nome || '').trim().slice(0, 120);
    if (!/^[0-9A-Za-z.\-]{1,20}$/.test(codigo)) return { ok: false, erro: 'Código inválido (ex.: 5.1.10).' };
    if (!nome) return { ok: false, erro: 'Informe o nome da conta.' };
    if (!GRUPOS.some(g => g[0] === b.grupo)) return { ok: false, erro: 'Grupo do DRE inválido.' };
    return { ok: true, conta: { codigo, nome, grupo: b.grupo, conta_contabil: String(b.conta_contabil || '').trim().slice(0, 40) || null, ativo: b.ativo !== false } };
  }
  function validarBanco(b) {
    b = b || {};
    const nome = String(b.nome || '').trim().slice(0, 80);
    if (!nome) return { ok: false, erro: 'Informe um nome para a conta (ex.: Itaú movimento).' };
    const moeda = ['BRL', 'USD', 'EUR'].includes(b.moeda) ? b.moeda : 'BRL';
    return { ok: true, banco: { nome, banco: String(b.banco || '').trim().slice(0, 60) || null, agencia: String(b.agencia || '').trim().slice(0, 20) || null, conta: String(b.conta || '').trim().slice(0, 30) || null,
      moeda, saldo_inicial: r2(numBR(b.saldo_inicial)), saldo_inicial_em: iso(b.saldo_inicial_em) || null, conta_contabil: String(b.conta_contabil || '').trim().slice(0, 40) || null, ativo: b.ativo !== false } };
  }
  function validarTransferencia(b) {
    b = b || {};
    const data = iso(b.data); if (!data) return { ok: false, erro: 'Informe a data.' };
    if (!b.de_banco_id || !b.para_banco_id) return { ok: false, erro: 'Escolha as duas contas.' };
    if (b.de_banco_id === b.para_banco_id) return { ok: false, erro: 'Contas de origem e destino iguais.' };
    const valor = r2(numBR(b.valor)); if (!(valor > 0)) return { ok: false, erro: 'Valor deve ser maior que zero.' };
    return { ok: true, transf: { data, de_banco_id: String(b.de_banco_id), para_banco_id: String(b.para_banco_id), valor, obs: String(b.obs || '').trim().slice(0, 300) || null } };
  }
  function addMeses(d, n) {
    const s = iso(d); if (!s) return null;
    const [y, m, dia] = s.split('-').map(Number);
    const alvo = new Date(Date.UTC(y, m - 1 + n, 1));
    const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
    alvo.setUTCDate(Math.min(dia, ultimo));
    return alvo.toISOString().slice(0, 10);
  }


  // ── Classificação da despesa (15/10/2026) ───────────────────────────
  // Fatura a pagar sem processo (aluguel, folha, imposto…) precisa de conta.
  function precisaClassificar(f) {
    if (!f || f.tipo !== 'pagar' || f.conta_id) return false;
    if (f.origem) return false;
    return !(f.itens || []).some(it => it && (it.processo_id || it.referencia));
  }
  // Sugere a conta pelo texto (empresa, documento, observação). Devolve o código.
  const REGRAS_CONTA = [
    [/pro.?labore/, '5.1.02'],
    [/ferias|decimo terceiro|13o salario|rescis/, '5.1.12'],
    [/inss|fgts|\bgps\b|encargo/, '5.1.10'],
    [/vale.?transporte|vale.?refeicao|vale.?alimentacao|plano de saude|unimed|odonto|beneficio|\bvt\b|\bvr\b/, '5.1.11'],
    [/salario|folha|holerite/, '5.1.01'],
    [/aluguel|locacao|condominio/, '5.1.03'],
    [/energia|eletric|celesc|copel|cemig|\benel\b|\bagua\b|saneamento|casan|sabesp|telefon|internet|\bvivo\b|\bclaro\b|\btim\b/, '5.1.04'],
    [/software|sistema|licenca|assinatura|conexos|google|microsoft|\baws\b|cloud|hospedagem/, '5.1.05'],
    [/contab|advoca|advog|juridic|honorario/, '5.1.06'],
    [/marketing|publicidade|anuncio|viagem|passage|hotel|hospedag/, '5.1.07'],
    [/seguro/, '5.1.13'],
    [/combustivel|\bposto\b|veiculo|\bipva\b|estacionamento|pedagio/, '5.1.15'],
    [/irpj|csll/, '6.1.01'],
    [/icms/, '4.1.02'],
    [/\bpis\b|cofins/, '4.1.03'],
    [/\biof\b/, '5.2.04'],
    [/tarifa|cesta de servico|manutencao de conta/, '5.2.01'],
    [/emprestimo|financiamento/, '9.1.02'],
    [/juros|multa/, '5.2.02'],
    [/iptu|alvara|taxa municipal|\bdas\b|simples nacional|\biss\b|darf|imposto|tributo/, '5.1.09'],
    [/manutencao|conserto|reparo|limpeza/, '5.1.14'],
    [/material|escritorio|papelaria|correio/, '5.1.08'],
  ];
  function sugerirConta(texto) {
    const t = semAcento(texto);
    if (!t) return null;
    const r = REGRAS_CONTA.find(([re]) => re.test(t));
    return r ? r[1] : null;
  }

  // ── Despesas / receitas recorrentes ─────────────────────────────────
  // Uma recorrência gera as faturas sozinha (job diário), com antecedência.
  // Cada fatura gerada tem origem {tipo:'recorrencia', processo_id: id da
  // recorrência, idx: 'AAAA-MM'}; o índice único impede duplicar o mês e
  // fatura cancelada não é recriada.
  const FREQUENCIAS = { mensal: [1, 'Mensal'], bimestral: [2, 'Bimestral'], trimestral: [3, 'Trimestral'], semestral: [6, 'Semestral'], anual: [12, 'Anual'] };
  function validarRecorrencia(b) {
    b = b || {};
    const descricao = String(b.descricao || '').trim().slice(0, 120);
    if (!descricao) return { ok: false, erro: 'Informe a descrição (ex.: Aluguel do escritório).' };
    const empresa_nome = String(b.empresa_nome || '').trim().slice(0, 200);
    if (!empresa_nome) return { ok: false, erro: 'Informe a empresa (quem recebe / quem paga).' };
    const valor = r2(numBR(b.valor));
    if (!(valor > 0)) return { ok: false, erro: 'Informe o valor.' };
    if (!b.conta_id) return { ok: false, erro: 'Escolha a classificação (aluguel, folha, imposto…).' };
    const inicio = iso(b.inicio);
    if (!inicio) return { ok: false, erro: 'Informe o 1º vencimento.' };
    const fim = iso(b.fim);
    if (fim && fim < inicio) return { ok: false, erro: 'A data final é antes do 1º vencimento.' };
    const frequencia = FREQUENCIAS[b.frequencia] ? b.frequencia : 'mensal';
    const ant = parseInt(b.antecedencia_dias, 10);
    return { ok: true, recorrencia: {
      descricao, empresa_nome, empresa_id: b.empresa_id ? String(b.empresa_id).slice(0, 80) : null,
      tipo: b.tipo === 'receber' ? 'receber' : 'pagar',
      moeda: ['BRL', 'USD', 'EUR'].includes(b.moeda) ? b.moeda : 'BRL', valor,
      conta_id: String(b.conta_id).slice(0, 80), centro_custo_id: b.centro_custo_id ? String(b.centro_custo_id).slice(0, 80) : null,
      frequencia, inicio, fim: fim || null, valor_variavel: !!b.valor_variavel,
      antecedencia_dias: isNaN(ant) ? 30 : Math.max(0, Math.min(90, ant)),
      obs: String(b.obs || '').trim().slice(0, 500) || null, ativo: b.ativo !== false,
    } };
  }
  function addDias(d, n) { const s = iso(d); if (!s) return null; const x = new Date(s + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  // Vencimentos de 'inicio' até 'ate' (e até 'fim', se houver).
  function vencimentosRecorrencia(r, ate, max) {
    const passo = (FREQUENCIAS[r.frequencia] || FREQUENCIAS.mensal)[0];
    const out = [];
    for (let k = 0; k < (max || 600); k++) {
      const v = addMeses(r.inicio, k * passo);
      if (!v || (ate && v > ate) || (r.fim && v > r.fim)) break;
      out.push({ k, competencia: v.slice(0, 7), vencimento: v });
    }
    return out;
  }
  function proximoVencimento(r, hoje) {
    if (!r || r.ativo === false) return null;
    const passo = (FREQUENCIAS[r.frequencia] || FREQUENCIAS.mensal)[0];
    for (let k = 0; k < 600; k++) { const v = addMeses(r.inicio, k * passo); if (!v || (r.fim && v > r.fim)) return null; if (v >= hoje) return v; }
    return null;
  }
  // Faturas que faltam gerar: até hoje + antecedência; a 1ª sempre sai
  // (pra quem cadastra hoje um aluguel que vence daqui a 40 dias).
  function faturasDaRecorrencia(r, competenciasJaGeradas, hoje, limite) {
    if (!r || r.ativo === false || !r.inicio) return [];
    const ja = new Set(competenciasJaGeradas || []);
    const ate = addDias(hoje, r.antecedencia_dias != null ? +r.antecedencia_dias : 30);
    let lista = vencimentosRecorrencia(r, ate);
    if (!lista.length && !ja.size) lista = vencimentosRecorrencia(r, null, 1);
    const [mm, aaaa] = [s => s.slice(5, 7), s => s.slice(0, 4)];
    return lista.filter(x => !ja.has(x.competencia)).slice(0, limite || 24).map(x => ({
      competencia: x.competencia,
      fatura: {
        tipo: r.tipo || 'pagar', empresa_nome: r.empresa_nome, empresa_id: r.empresa_id || null,
        documento: `${r.descricao} ${mm(x.vencimento)}/${aaaa(x.vencimento)}`.slice(0, 120),
        moeda: r.moeda || 'BRL', cambio: (r.moeda || 'BRL') === 'BRL' ? 1 : null, valor: num(r.valor),
        emissao: null, vencimento: x.vencimento, conta_id: r.conta_id || null, centro_custo_id: r.centro_custo_id || null,
        obs: [r.obs, r.valor_variavel ? 'Valor estimado (recorrente) — confira o valor da conta antes de pagar' : 'Gerada pela recorrência'].filter(Boolean).join(' · '),
        itens: [],
      },
    }));
  }

  // ── Saldos bancários ────────────────────────────────────────────────
  // saldo = saldo inicial + recebimentos − pagamentos (com juros) ± transferências,
  // só movimentos a partir da data do saldo inicial. Valor em R$ (conta BRL) ou
  // na moeda da conta quando fatura e conta são da mesma moeda estrangeira.
  function movimentoNaConta(p, f, banco, cambio) {
    if (banco.moeda !== 'BRL' && f.moeda === banco.moeda) return num(p.valor) + num(p.juros);
    if (banco.moeda !== 'BRL') return 0;
    return FC.caixaBrlPagamento(p, f, cambio);
  }
  function saldosBancarios(bancos, faturas, transferencias, cambio) {
    const out = {};
    (bancos || []).forEach(b => { out[b.id] = { id: b.id, nome: b.nome, moeda: b.moeda || 'BRL', inicial: num(b.saldo_inicial), entradas: 0, saidas: 0, transf: 0, saldo: 0, desde: iso(b.saldo_inicial_em) }; });
    const semBanco = { entradas: 0, saidas: 0, qtd: 0 };
    (faturas || []).forEach(f => {
      if (!f || f.status === 'cancelada') return;
      (f.pagamentos || []).forEach(p => {
        if (!p || p.estornado || FC.ehMigracao(p)) return;
        const o = p.banco_id && out[p.banco_id];
        if (!o) { const v = FC.caixaBrlPagamento(p, f, cambio); semBanco.qtd++; if (f.tipo === 'receber') semBanco.entradas += v; else semBanco.saidas += v; return; }
        if (o.desde && iso(p.data) && iso(p.data) < o.desde) return;
        const b = (bancos || []).find(x => x.id === p.banco_id);
        const v = movimentoNaConta(p, f, b, cambio);
        if (f.tipo === 'receber') o.entradas += v; else o.saidas += v;
      });
    });
    (transferencias || []).forEach(t => {
      if (!t || t.estornado) return;
      const de = out[t.de_banco_id], para = out[t.para_banco_id];
      if (de && !(de.desde && t.data < de.desde)) de.transf -= num(t.valor);
      if (para && !(para.desde && t.data < para.desde)) para.transf += num(t.valor_destino != null ? t.valor_destino : t.valor);
    });
    Object.values(out).forEach(o => { o.entradas = r2(o.entradas); o.saidas = r2(o.saidas); o.transf = r2(o.transf); o.saldo = r2(o.inicial + o.entradas - o.saidas + o.transf); });
    semBanco.entradas = r2(semBanco.entradas); semBanco.saidas = r2(semBanco.saidas);
    return { contas: Object.values(out), semBanco };
  }

  // ── DRE gerencial da empresa ───────────────────────────────────────
  // Cada fatura é distribuída nas contas: conta_id explícita; senão, itens
  // de processo pela taxa (contaPadraoPorTaxa); senão, padrão por tipo.
  // regime 'caixa': pelas baixas (data do pagamento, valor que saiu/entrou);
  // regime 'competencia': pela emissão (ou vencimento), valor total da fatura.
  function _contasPorCodigo(contas) { const m = {}; (contas || []).forEach(c => { m[c.codigo] = c; m[c.id] = c; }); return m; }
  function _rateioFatura(f, mapa) {
    // retorna [{codigo, peso}] com pesos somando 1
    if (f.conta_id && mapa[f.conta_id]) return [{ codigo: mapa[f.conta_id].codigo, peso: 1 }];
    const itens = (f.itens || []).filter(it => num(it.valor) > 0);
    if (itens.length && f.tipo === 'pagar') {
      const tot = itens.reduce((s, it) => s + num(it.valor), 0) || 1;
      const acc = {};
      itens.forEach(it => { const c = contaPadraoPorTaxa(it.taxa); acc[c] = (acc[c] || 0) + num(it.valor) / tot; });
      return Object.entries(acc).map(([codigo, peso]) => ({ codigo, peso }));
    }
    if (f.tipo === 'receber') {
      const o = f.origem && f.origem.tipo;
      return [{ codigo: o === 'parcela_cambio' ? '3.1.02' : o === 'venda' ? '3.1.01' : '3.1.01', peso: 1 }];
    }
    return [{ codigo: '5.1.08', peso: 1 }];
  }
  function dreEmpresa(faturas, contas, opts) {
    const o = opts || {};
    const de = iso(o.de) || '0000-01-01', ate = iso(o.ate) || '9999-12-31';
    const regime = o.regime === 'competencia' ? 'competencia' : 'caixa';
    const mapa = _contasPorCodigo(contas);
    const linhas = {}; // codigo → valor (positivo = valor da conta)
    const add = (codigo, v) => { if (!v) return; linhas[codigo] = (linhas[codigo] || 0) + v; };
    const dentro = d => d && d >= de && d <= ate;
    (faturas || []).forEach(f => {
      if (!f || f.status === 'cancelada') return;
      const rateio = _rateioFatura(f, mapa);
      const fx = f.moeda === 'BRL' ? 1 : (num(f.cambio) || num((o.cambio || {})[f.moeda]));
      if (regime === 'competencia') {
        const d = iso(f.emissao) || iso(f.vencimento) || iso(f.created_at);
        if (!dentro(d)) return;
        rateio.forEach(r => add(r.codigo, num(f.valor) * fx * r.peso));
        return;
      }
      (f.pagamentos || []).forEach(p => {
        if (!p || p.estornado || FC.ehMigracao(p) || !dentro(iso(p.data))) return;
        const principalPrev = (num(p.valor) + FC.RETENCOES.reduce((s, k) => s + num(p.retencoes && p.retencoes[k]), 0)) * (f.moeda === 'BRL' ? 1 : (num(f.cambio) || fx));
        rateio.forEach(r => add(r.codigo, principalPrev * r.peso));
        const jur = num(p.juros) * (f.moeda === 'BRL' ? 1 : (num(p.cambio_efetivo) || fx));
        if (jur) add(f.tipo === 'pagar' ? '5.2.02' : '3.2.01', jur);
        const desc = num(p.desconto) * (f.moeda === 'BRL' ? 1 : fx);
        if (desc) add(f.tipo === 'pagar' ? '3.2.01' : '5.2.02', desc);
        const vc = FC.variacaoCambial(p, f);
        if (vc) add(f.tipo === 'pagar' ? (vc > 0 ? '5.2.03' : '3.2.02') : (vc > 0 ? '3.2.02' : '5.2.03'), Math.abs(vc));
      });
    });
    // monta por grupo
    const grupos = GRUPOS.map(([id, label, sinal]) => ({ id, label, sinal, contas: [], total: 0 }));
    Object.entries(linhas).forEach(([codigo, v]) => {
      const c = mapa[codigo] || { codigo, nome: codigo, grupo: codigo.startsWith('3.2') ? 'receita_financeira' : codigo.startsWith('3') ? 'receita_bruta' : codigo.startsWith('5.2') ? 'despesa_financeira' : 'despesa_operacional' };
      const g = grupos.find(x => x.id === c.grupo) || grupos.find(x => x.id === 'despesa_operacional');
      g.contas.push({ codigo, nome: c.nome, valor: r2(v) });
      g.total += v;
    });
    grupos.forEach(g => { g.total = r2(g.total); g.contas.sort((a, b) => a.codigo.localeCompare(b.codigo)); });
    const t = id => (grupos.find(g => g.id === id) || {}).total || 0;
    const receitaLiquida = r2(t('receita_bruta') - t('deducoes'));
    const lucroBruto = r2(receitaLiquida - t('custo'));
    const resultadoOperacional = r2(lucroBruto - t('despesa_operacional'));
    const resultadoAntesIR = r2(resultadoOperacional + t('receita_financeira') - t('despesa_financeira'));
    const resultadoLiquido = r2(resultadoAntesIR - t('impostos_lucro'));
    return { regime, de, ate, grupos, receitaLiquida, lucroBruto, resultadoOperacional, resultadoAntesIR, resultadoLiquido };
  }

  // ── Lançamentos para o contador (modelo genérico partidas dobradas) ──
  // Uma linha por movimento de caixa no período. Conta = conta_contabil do
  // plano (se cadastrada) senão o código gerencial. Banco = conta_contabil
  // do banco ou "BANCO <nome>". O contador ajusta o de-para ao sistema dele.
  function lancamentosContabeis(faturas, contas, bancos, opts) {
    const o = opts || {};
    const de = iso(o.de) || '0000-01-01', ate = iso(o.ate) || '9999-12-31';
    const mapa = _contasPorCodigo(contas);
    const contaDe = codigo => (mapa[codigo] && mapa[codigo].conta_contabil) || codigo;
    const bancoDe = id => { const b = (bancos || []).find(x => x.id === id); return b ? (b.conta_contabil || 'BANCO ' + b.nome) : 'BANCO (não informado)'; };
    const out = [];
    (faturas || []).forEach(f => {
      if (!f || f.status === 'cancelada') return;
      const rateio = _rateioFatura(f, mapa);
      const fx = f.moeda === 'BRL' ? 1 : (num(f.cambio) || 0);
      (f.pagamentos || []).forEach(p => {
        if (!p || p.estornado || FC.ehMigracao(p)) return;
        const d = iso(p.data); if (!d || d < de || d > ate) return;
        const banco = bancoDe(p.banco_id);
        const hist = `${f.tipo === 'pagar' ? 'Pgto' : 'Receb.'} ${f.documento || ''} ${f.empresa_nome || ''} (fatura ${f.numero || ''})`.replace(/\s+/g, ' ').trim();
        const caixa = FC.caixaBrlPagamento(p, f) - (f.moeda === 'BRL' ? num(p.juros) : num(p.juros) * (num(p.cambio_efetivo) || fx));
        const ret = FC.RETENCOES.reduce((s, k) => s + num(p.retencoes && p.retencoes[k]), 0) * (fx || 1);
        rateio.forEach(r => {
          const v = r2(caixa * r.peso);
          if (v) out.push(f.tipo === 'pagar' ? { data: d, debito: contaDe(r.codigo), credito: banco, valor: v, historico: hist, documento: f.documento || '', participante: f.empresa_nome || '', fatura: f.numero || '' }
            : { data: d, debito: banco, credito: contaDe(r.codigo), valor: v, historico: hist, documento: f.documento || '', participante: f.empresa_nome || '', fatura: f.numero || '' });
          const vr = r2(ret * r.peso);
          if (vr && f.tipo === 'pagar') out.push({ data: d, debito: contaDe(r.codigo), credito: contaDe('9.1.01'), valor: vr, historico: 'Retenções ' + hist, documento: f.documento || '', participante: f.empresa_nome || '', fatura: f.numero || '' });
        });
        const jur = r2(num(p.juros) * (f.moeda === 'BRL' ? 1 : (num(p.cambio_efetivo) || fx)));
        if (jur) out.push(f.tipo === 'pagar' ? { data: d, debito: contaDe('5.2.02'), credito: banco, valor: jur, historico: 'Juros/multa ' + hist, documento: f.documento || '', participante: f.empresa_nome || '', fatura: f.numero || '' }
          : { data: d, debito: banco, credito: contaDe('3.2.01'), valor: jur, historico: 'Juros recebidos ' + hist, documento: f.documento || '', participante: f.empresa_nome || '', fatura: f.numero || '' });
      });
    });
    // transferências entre contas próprias: débito no banco que recebe, crédito no que envia
    (o.transferencias || []).forEach(t => {
      if (!t || t.estornado) return;
      const d = iso(t.data); if (!d || d < de || d > ate) return;
      const v = r2(num(t.valor)); if (!v) return;
      out.push({ data: d, debito: bancoDe(t.para_banco_id), credito: bancoDe(t.de_banco_id), valor: v, historico: ('Transferência entre contas ' + (t.obs || '')).trim(), documento: '', participante: '', fatura: '' });
    });
    out.sort((a, b) => a.data.localeCompare(b.data));
    return out;
  }

  // ── Importação de títulos do Conexos (planilha) ─────────────────────
  const PISTAS = {
    tipo: /^(tipo|natureza|pag.*rec|cp.?cr|operacao|d\/c|debito.?credito)$/,
    empresa: /(pessoa|fornecedor|cliente|favorecido|sacado|cedente|razao|nome|participante|parceiro)/,
    cnpj: /(cnpj|cpf|documento.?pessoa|doc.?pessoa)/,
    documento: /(^n[ºo°.]?\s*doc|documento|titulo|n.?fatura|^numero|^n[ºo°]$|nota|nf)/,
    emissao: /(emissao|data.?doc|data.?lanc|competencia|^data$)/,
    vencimento: /(vencimento|venc)/,
    valor: /(^valor$|valor.?(original|titulo|bruto|total|documento)|^vl\.?\s*(titulo|original|doc))/,
    saldo: /(saldo|em.?aberto|valor.?aberto|a.?pagar$|a.?receber$|restante)/,
    moeda: /^(moeda|divisa)$/,
    obs: /(observ|historico|descricao|complemento)/,
    id: /^(id|codigo|cod|chave|sequencia|seq|n.?interno)$/,
    conta: /(plano|conta.?gerencial|categoria|natureza.?fin|classificacao)/,
    centro: /(centro.?de.?custo|c\.?\s*custo|^cc$)/,
  };
  function adivinharColunas(cabecalhos) {
    const mapa = {};
    const usados = new Set();
    const ordem = ['vencimento', 'saldo', 'cnpj', 'empresa', 'documento', 'emissao', 'valor', 'tipo', 'moeda', 'obs', 'id', 'conta', 'centro'];
    ordem.forEach(campo => {
      const i = (cabecalhos || []).findIndex((h, k) => !usados.has(k) && PISTAS[campo].test(semAcento(h)));
      if (i >= 0) { mapa[campo] = i; usados.add(i); }
    });
    return mapa;
  }
  function dataPlanilha(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
    if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000); return d.toISOString().slice(0, 10); }
    const s = String(v).trim();
    let m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/.exec(s);
    if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return null;
  }
  function tipoDe(v, valorBruto, padrao) {
    const s = semAcento(v);
    if (/^(p|cp|pagar|a pagar|d|deb|debito|despesa|saida)/.test(s)) return 'pagar';
    if (/^(r|cr|receber|a receber|c|cred|credito|receita|entrada)/.test(s)) return 'receber';
    if (numBR(valorBruto) < 0) return 'pagar';
    return padrao || null;
  }
  // linha → {ok, fatura, saldo, erro}
  function linhaParaFatura(cols, mapa, opcoes) {
    const o = opcoes || {};
    const get = c => (mapa[c] != null ? cols[mapa[c]] : null);
    const valorBruto = get('valor');
    const valor = Math.abs(numBR(valorBruto));
    const saldoCol = get('saldo');
    const saldo = saldoCol != null && saldoCol !== '' ? Math.abs(numBR(saldoCol)) : valor;
    const tipo = tipoDe(get('tipo'), valorBruto, o.tipoPadrao);
    const empresa = String(get('empresa') || '').trim();
    if (!tipo) return { ok: false, erro: 'Não sei se é a pagar ou a receber (escolha o tipo padrão).' };
    if (!empresa) return { ok: false, erro: 'Sem empresa/pessoa.' };
    const vTotal = valor || saldo;
    if (!(vTotal > 0)) return { ok: false, erro: 'Sem valor.' };
    if (!(saldo > 0.009)) return { ok: false, erro: 'Já quitado (saldo zero) — não importado.', quitado: true };
    const moedaRaw = String(get('moeda') || '').toUpperCase();
    const moeda = /USD|US\$|DOLAR/.test(moedaRaw) ? 'USD' : /EUR|€/.test(moedaRaw) ? 'EUR' : 'BRL';
    const idExt = String(get('id') || '').trim();
    const fatura = {
      tipo, empresa_nome: empresa.slice(0, 200), documento: String(get('documento') || '').trim().slice(0, 120) || null,
      emissao: dataPlanilha(get('emissao')), vencimento: dataPlanilha(get('vencimento')), moeda, valor: r2(vTotal),
      obs: ['Importado do Conexos', String(get('obs') || '').trim()].filter(Boolean).join(' · ').slice(0, 1000),
      externo: { fonte: 'conexos', id: idExt || null, cnpj: String(get('cnpj') || '').replace(/\D/g, '') || null, conta: String(get('conta') || '').trim() || null, centro: String(get('centro') || '').trim() || null },
      itens: [],
    };
    return { ok: true, fatura, saldo: r2(saldo), jaPago: r2(Math.max(0, vTotal - saldo)) };
  }
  // chave pra não importar 2 vezes o mesmo título
  function chaveImportacao(f) {
    if (f.externo && f.externo.id) return 'conexos:' + f.externo.id;
    return ['conexos', f.tipo, semAcento(f.empresa_nome).replace(/[^a-z0-9]/g, ''), String(f.documento || '').replace(/\W/g, ''), f.vencimento || '', num(f.valor).toFixed(2)].join('|');
  }

  const FinCore = { GRUPOS, PLANO_PADRAO, contaPadraoPorTaxa, validarConta, validarBanco, validarTransferencia, addMeses, saldosBancarios, dreEmpresa, lancamentosContabeis, adivinharColunas, linhaParaFatura, chaveImportacao, dataPlanilha, numBR, precisaClassificar, sugerirConta, FREQUENCIAS, validarRecorrencia, vencimentosRecorrencia, proximoVencimento, faturasDaRecorrencia, addDias };
  if (typeof module !== 'undefined' && module.exports) module.exports = FinCore;
  if (typeof window !== 'undefined') window.FinCore = FinCore;
})();
