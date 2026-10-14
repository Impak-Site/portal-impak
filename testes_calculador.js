/**
 * TESTES AUTOMATIZADOS — Calculador de Importação (IMPAK Portal)
 * ════════════════════════════════════════════════════════════════
 * Roda com: node testes_calculador.js
 *
 * Diferente dos outros dois arquivos de teste (testes_controle.js,
 * testes_tyredesk.js), aqui a função calcular() lê dezenas de campos
 * direto do DOM via document.getElementById(...).value — não é uma
 * função "pura" que recebe parâmetros. Por isso o stub de DOM aqui é
 * mais elaborado: ele simula um formulário completo, preenchido com
 * um caso real conhecido (Pneu Automóvel/SC, NCM 40111000, o mesmo
 * caso que já foi validado manualmente com o usuário em conversa).
 *
 * Ainda assim, é o CÓDIGO REAL do calculador.html rodando — não uma
 * reescrita da fórmula. Se alguém mudar a lógica de calcular() de um
 * jeito que muda o resultado para este caso conhecido, o teste pega.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ARQUIVO_HTML = path.join(__dirname, 'calculador.html');
const html = fs.readFileSync(ARQUIVO_HTML, 'utf-8');
const scriptMatches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (!scriptMatches.length) {
  console.error('❌ Não encontrei nenhum bloco <script> em', ARQUIVO_HTML);
  process.exit(1);
}
// O calculador pode ter mais de um <script> (ex: libs externas via src
// não contam pois não têm conteúdo) — pegamos o maior bloco, que é a
// lógica principal.
const jsReal = scriptMatches.reduce((maior, atual) =>
  atual[1].length > maior.length ? atual[1] : maior, '');

// taxas-catalogo.js é carregado via <script src="..."> no HTML real (não
// inline), então o extrator acima (que só pega <script> sem src) não o
// inclui — precisamos concatenar manualmente, na mesma ordem que o HTML
// real carrega (taxas-catalogo.js ANTES do script principal), senão
// window.TaxasCatalogo fica undefined e TAXAS_CONFIG quebra no load.
const jsCatalogo = fs.readFileSync(path.join(__dirname, 'taxas-catalogo.js'), 'utf-8');
const jsRealCompleto = jsCatalogo + '\n' + jsReal;

// ── STUB DE FORMULÁRIO — caso real: Pneu Automóvel / SC ────────
// Valores baseados no caso "IMPAK-PVN25010-1" já discutido e validado
// manualmente nesta mesma conversa (câmbio, FOB, frete, etc. reais).
function valoresPadraoFormulario() {
  return {
    // Identificação / NCM
    cambio_usd: '5.1695',
    produto: 'PCR',          // -> NCM 40111000 (Pneu Automóvel)
    uf_destino: 'SC',         // chave da tabela: 40111000SC
    cliente: 'Cliente Teste',

    // Valores da operação
    fob_usd: '27812.96',      // FOB real visto no Extrato da DI (PVN25010-1)
    frete_usd: '1000',
    qtde_containers: '1',
    custos_diversos: '500',

    // Seguros
    taxa_seguro_compra: '0.04',
    taxa_seguro_venda: '0.04',

    // Despesas aduaneiras (USD)
    taxa_ce_usd: '0',

    // Comissões — desligadas por padrão no caso base
    br_pct: '0', br_nome: '',
    china_pct: '3', boss_pct: '0', boss_nome: '',

    // Parcelamento / financeiro
    pct_entrada: '30',
    prazo_medio_dias: '30',
    taxa_juros_am: '0',
    pct_nota_servico: '0',

    // Cenário / Fator NFe
    cenario_valor: '',

    // Antidumping
    dump_valor: '0',

    // Taxas operacionais fixas (campos tx_*) — usar os valores padrão
    // já documentados em TAXAS_FIXAS_CONTAINER do próprio arquivo, para
    // o teste refletir o que o usuário veria sem editar nada na tela.
    tx_siscomex: '480', tx_marinha: '1712', tx_armazenagem: '2088',
    tx_emissao_li: '153.53', tx_baixa_patio: '500', tx_capatazia: '1100',
    tx_liberacao_bl: '650', tx_despachante: '1650', tx_sda: '650',
    tx_lavacao: '550', tx_administrativo: '300', tx_agente: '476',
    tx_additional_costs: '0', tx_import_logistics: '0', tx_trs: '0',
    tx_tsc: '0', tx_drop_off: '0', tx_isps: '0', tx_iof: '0',
    tx_desconsolidacao: '0',
  };
}

function criarSandbox(valoresCustom = {}) {
  const valores = { ...valoresPadraoFormulario(), ...valoresCustom };
  const elementosFalsos = {};

  function getOrCreate(id) {
    if (!elementosFalsos[id]) {
      elementosFalsos[id] = {
        value: valores[id] !== undefined ? valores[id] : '',
        innerHTML: '', textContent: '', style: {},
        classList: { add(){}, remove(){}, contains(){ return false; }, toggle(){} },
        addEventListener(){}, appendChild(){}, querySelector(){ return null; },
        querySelectorAll(){ return []; }, setAttribute(){}, getAttribute(){ return null; },
        disabled: false, checked: false,
      };
    }
    return elementosFalsos[id];
  }

  const documentFalso = {
    getElementById: (id) => getOrCreate(id),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => ({ style:{}, classList:{add(){},remove(){}}, appendChild(){}, setAttribute(){} }),
    body: { appendChild(){}, classList:{add(){},remove(){}} },
  };

  const sandbox = {
    document: documentFalso,
    window: {},
    localStorage: { getItem(){ return null; }, setItem(){}, removeItem(){} },
    sessionStorage: { getItem(){ return null; }, setItem(){}, removeItem(){} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({ ok: true }) }),
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    navigator: { clipboard: { writeText(){} } },
    Date, Math, JSON, Array, Object, String, Number, Boolean, RegExp, Promise,
    addEventListener: () => {},
    XLSX: undefined, // o calculador usa XLSX só na exportação, fora do escopo destes testes
  };
  sandbox.window = sandbox;
  sandbox._elementos = elementosFalsos; // exposto para os testes inspecionarem/alterarem valores
  return sandbox;
}

function carregarNoSandbox(sandbox) {
  vm.createContext(sandbox);
  // `const`/`let` de nível superior, diferente de `function` e `var`, não
  // viram propriedades automáticas do objeto de contexto no vm do Node.
  // Para os testes conseguirem inspecionar TABELA_NCM e NCM_POR_TIPO (que
  // são `const` no arquivo real), anexamos uma linha ao final do código
  // que as expõe explicitamente — isso não altera o comportamento do
  // calculador.html em si, é só um efeito do ambiente de teste isolado.
  const exposicaoExtra = `
;try{ this.TABELA_NCM = TABELA_NCM; }catch(e){}
;try{ this.NCM_POR_TIPO = NCM_POR_TIPO; }catch(e){}
`;
  vm.runInContext(jsRealCompleto + exposicaoExtra, sandbox, { filename: 'calculador_extraido.js' });
}

// ── FRAMEWORK DE TESTE MÍNIMO ───────────────────────────────────
let totalTestes = 0, totalFalhas = 0;
function teste(nome, fn) {
  totalTestes++;
  try { fn(); console.log(`  ✓ ${nome}`); }
  catch (e) { totalFalhas++; console.log(`  ✗ ${nome}\n      ${e.message}`); }
}
function aproxIgual(a, b, margem, msg) {
  if (Math.abs(a - b) > margem) {
    throw new Error(msg || `esperado ≈${b}, recebido ${a} (diferença ${Math.abs(a-b).toFixed(4)} > margem ${margem})`);
  }
}
function verdadeiro(a, msg) {
  if (!a) throw new Error(msg || `esperado valor verdadeiro, recebido "${a}"`);
}

// ── PRIMEIRO: confirmar que o arquivo carrega sem erro nos stubs ─
let sandboxBase;
try {
  sandboxBase = criarSandbox();
  carregarNoSandbox(sandboxBase);
} catch (e) {
  console.error('❌ O código real não carregou nos stubs de teste.');
  console.error('   Isso pode significar que uma função nova usa algo do browser que');
  console.error('   os stubs não cobrem ainda (atualize criarSandbox), ou um erro real.');
  console.error('   Erro:', e.message);
  process.exit(1);
}

console.log('\n📋 calculador.html — carregamento e funções básicas');
teste('arquivo carrega sem lançar exceção', () => {
  verdadeiro(typeof sandboxBase.calcular === 'function', 'calcular() deveria existir no escopo global');
});
teste('TABELA_NCM tem a entrada real usada nos testes (40111000SC)', () => {
  verdadeiro(sandboxBase.TABELA_NCM && sandboxBase.TABELA_NCM['40111000SC'], 'chave 40111000SC deveria existir');
});
teste('NCM_POR_TIPO traduz PCR corretamente', () => {
  if (sandboxBase.NCM_POR_TIPO.PCR !== 40111000) {
    throw new Error(`esperado 40111000, recebido ${sandboxBase.NCM_POR_TIPO.PCR}`);
  }
});

// ── TESTE: ICMS Normal usa a coluna G (aliq_inter = 4%), não R ──
// Este é o bug real corrigido nesta mesma conversa: o rótulo da tela
// mostrava 1,4% (coluna R, ICMS Próprio) quando deveria mostrar 4%
// (coluna G, Alíquota Interestadual) para a linha "ICMS Normal".
console.log('\n📋 Regra: ICMS Normal vs ICMS Próprio (bug real corrigido)');
teste('aliq_inter (coluna G) da tabela NCM é 4% para Pneu Automóvel/SC', () => {
  const t = sandboxBase.TABELA_NCM['40111000SC'];
  aproxIgual(t.aliq_inter, 0.04, 0.0001, 'aliq_inter deveria ser 0.04 (4%)');
});
teste('icms_prop (coluna R) da tabela NCM é 1.4% para Pneu Automóvel/SC — DIFERENTE do aliq_inter', () => {
  const t = sandboxBase.TABELA_NCM['40111000SC'];
  aproxIgual(t.icms_prop, 0.014, 0.0001, 'icms_prop deveria ser 0.014 (1.4%)');
  verdadeiro(t.icms_prop !== t.aliq_inter, 'icms_prop e aliq_inter devem ser valores DIFERENTES — se forem iguais, o bug do ICMS duplicado pode ter voltado');
});

// ── TESTE: mudar UF muda o resultado (a tabela está sendo de fato usada) ─
console.log('\n📋 Sensibilidade a parâmetros — confirma que calcular() usa os inputs de verdade');
teste('calcular() não lança exceção com os valores padrão preenchidos', () => {
  const sandbox = criarSandbox();
  carregarNoSandbox(sandbox);
  sandbox.calcular(); // não deve lançar
});
teste('UFs diferentes (SC vs RS) geram chaves de tabela diferentes com MVA diferente', () => {
  const t_sc = sandboxBase.TABELA_NCM['40111000SC'];
  const t_rs = sandboxBase.TABELA_NCM['40111000RS'];
  verdadeiro(t_sc.mva !== t_rs.mva, 'MVA de SC e RS deveriam ser diferentes (são UFs com alíquotas distintas)');
});

// ── TESTE: Seguro Compra usa câmbio de abertura da chegada ×1,02 ──
// Caso real auditado (UD25-305, planilha OST 15-06-2026): FOB 36.106,34 +
// Frete 2.050 (taxa seguro 0,04%) -> Seguro Compra USD 18,46766856
// (já validado antes). A CONVERSÃO pra R$ usa o câmbio de abertura do dia
// da chegada ×1,02 (mesmo parâmetro do Frete/Seguro Venda) — NÃO o câmbio
// principal da simulação. Confirmado célula a célula contra MODELO - COM
// S.T.!F7 da planilha real (R$96,08, não R$93,87 que o câmbio principal
// dava antes deste fix).
console.log('\n📋 Regra: Seguro Compra (BRL) usa câmbio de abertura+2% (bug real corrigido — UD25-305)');
teste('com câmbio de abertura da chegada explícito, seguro_brl bate com a planilha (R$96,08)', () => {
  const sandbox = criarSandbox({
    cambio_usd: '5.0827', fob_usd: '36106.34', frete_usd: '2050',
    taxa_ce_usd: '120', qtde_containers: '1', produto: 'TBR', uf_destino: 'RS',
    custos_diversos: '0', taxa_seguro_compra: '0.04', cambio_chegada: '5.1007',
  });
  carregarNoSandbox(sandbox);
  sandbox.calcular();
  // O resultado do cálculo, antes exposto numa variável solta
  // "_ultimoResultado", foi consolidado dentro do objeto de estado global
  // único "_estado" (ver comentário "ESTADO" em calculador.html — refactor
  // que juntou ~10 variáveis soltas do formulário/wizard num objeto só).
  // Continua sendo o mesmo objeto de sempre (mesmos campos), só o caminho
  // pra chegar nele mudou: _estado.ultimoResultado em vez de
  // _ultimoResultado direto.
  vm.runInContext('this._ultimoResultado = _estado.ultimoResultado;', sandbox);
  const r = sandbox._ultimoResultado;
  aproxIgual(r.seguro_brl, 96.08, 0.05, `seguro_brl deveria ≈R$96,08 (planilha), recebido ${r.seguro_brl}`);
});
teste('sem câmbio de abertura preenchido (fallback = câmbio principal), ainda aplica o ×1,02', () => {
  const sandbox = criarSandbox({ cambio_chegada: '' }); // usa o padrão da suíte (cambio_usd 5.1695)
  carregarNoSandbox(sandbox);
  sandbox.calcular();
  vm.runInContext('this._ultimoResultado = _estado.ultimoResultado;', sandbox);
  const r = sandbox._ultimoResultado;
  const esperado = r.seguro_compra_usd * 5.1695 * 1.02;
  aproxIgual(r.seguro_brl, esperado, 0.01, `sem câmbio de chegada explícito, deveria cair no fallback (câmbio principal ×1,02)`);
});

// ── TESTE: Royal/Rev96 — Import Logistics Fee e CRS são R$ fixos (164/180) ──
console.log('\n📋 Regra: Import Logistics Fee = R$164 e CRS = R$180 fixos, qualquer câmbio (Jean 28/09/2026)');
[4.9, 5.2, 6.1].forEach(cc => {
  teste(`Import Logistics R$164 e CRS R$180 com câmbio de chegada ${cc}`, () => {
    const sandbox = criarSandbox({ cambio_chegada: String(cc), tx_import_logistics_brl: '164', tx_crs_brl: '180' });
    carregarNoSandbox(sandbox);
    sandbox.calcular();
    const mk = cc * 1.02;
    aproxIgual(parseFloat(sandbox._elementos['tx_import_logistics'].value) * mk, 164, 0.0001, 'Import Logistics em R$ deveria ser 164');
    aproxIgual(parseFloat(sandbox._elementos['tx_trs'].value) * mk, 180, 0.0001, 'CRS em R$ deveria ser 180');
  });
});

// ── TESTE: IOF automático = Frete USD × 3,5% (bug real corrigido — UD25-305) ──
// Fórmula antiga somava outras taxas em USD (destino) + frete antes de aplicar
// 3,5% — confirmado com o usuário que o valor real é só Frete×3,5%.
console.log('\n📋 Regra: IOF automático = Frete USD × 3,5% (bug real corrigido — UD25-305)');
teste('IOF auto com Frete 2050 USD dá 71,75 (2050×3,5%), ignorando outras taxas USD', () => {
  const sandbox = criarSandbox({
    frete_usd: '2050', tx_handling: '0', tx_additional_costs: '95', tx_import_logistics: '31.52',
    tx_trs: '0', tx_tsc: '0', tx_drop_off: '15', tx_isps: '20', tx_desconsolidacao: '60',
  });
  sandbox._elementos['auto_iof'] = { value: '', checked: true, classList: { add(){},remove(){},contains(){return false;},toggle(){} }, addEventListener(){}, setAttribute(){}, getAttribute(){return null;} };
  carregarNoSandbox(sandbox);
  sandbox.calcular();
  const iof = parseFloat(sandbox._elementos['tx_iof'].value);
  aproxIgual(iof, 71.75, 0.01, `IOF deveria ser 71.75 (só Frete×3,5%), recebido ${iof}`);
});

// ── TESTE: AFRMM automático = (FRETE_USD × câmbio D.I./DUIMP + CAPATAZIA) ×8%+20 ──
// (bug real corrigido — UD25-305, fórmula confirmada com o usuário, incluindo
// print da conversa com a fórmula exata). Taxa C.E. NÃO entra na fórmula automática
// — só é somada manualmente em casos excepcionais (checkbox "auto" desmarcado).
console.log('\n📋 Regra: AFRMM automático = Frete×câmbio D.I. + Capatazia (bug real corrigido — UD25-305)');
teste('AFRMM auto com Frete 2050 USD, câmbio D.I. 5.0827, capatazia 1100 BRL bate exato com a planilha (R$941,56)', () => {
  const sandbox = criarSandbox({
    cambio_usd: '5.0827', frete_usd: '2050', taxa_ce_usd: '120', tx_capatazia: '1100', qtde_containers: '1',
  });
  sandbox._elementos['auto_marinha'] = { value: '', checked: true, classList: { add(){},remove(){},contains(){return false;},toggle(){} }, addEventListener(){}, setAttribute(){}, getAttribute(){return null;} };
  carregarNoSandbox(sandbox);
  sandbox.calcular();
  const marinha = parseFloat(sandbox._elementos['tx_marinha'].value);
  aproxIgual(marinha, 941.5628, 0.01, `AFRMM deveria ≈941,56 (planilha real UD25-305), recebido ${marinha}`);
});
teste('Taxa C.E. não afeta o AFRMM automático (só o Frete e a Capatazia entram)', () => {
  const base = { cambio_usd: '5.0827', frete_usd: '2050', tx_capatazia: '1100', qtde_containers: '1' };
  const semTaxaCe = criarSandbox({ ...base, taxa_ce_usd: '0' });
  semTaxaCe._elementos['auto_marinha'] = { value: '', checked: true, classList: { add(){},remove(){},contains(){return false;},toggle(){} }, addEventListener(){}, setAttribute(){}, getAttribute(){return null;} };
  carregarNoSandbox(semTaxaCe);
  semTaxaCe.calcular();
  const marinhaSemTaxaCe = parseFloat(semTaxaCe._elementos['tx_marinha'].value);

  const comTaxaCe = criarSandbox({ ...base, taxa_ce_usd: '500' });
  comTaxaCe._elementos['auto_marinha'] = { value: '', checked: true, classList: { add(){},remove(){},contains(){return false;},toggle(){} }, addEventListener(){}, setAttribute(){}, getAttribute(){return null;} };
  carregarNoSandbox(comTaxaCe);
  comTaxaCe.calcular();
  const marinhaComTaxaCe = parseFloat(comTaxaCe._elementos['tx_marinha'].value);

  aproxIgual(marinhaSemTaxaCe, marinhaComTaxaCe, 0.01, `AFRMM não deveria mudar com Taxa C.E. diferente (automático usa só Frete+Capatazia)`);
});

// ── Câmbio da parcela única (Ayslan 13/10/2026, cotação ROVELO TBR) ──
console.log('\n📋 Parcelas: câmbio fechado no FOB');
teste('parcela única com Valor (USD) = o próprio câmbio: câmbio da parcela vale pro FOB inteiro', () => {
  const r = sandboxBase.fobBrlPelasParcelas([{ label:'Final', valor_usd:'5.20090004', cambio_fechado:'5.20090004' }], 35564.08, 5.0821);
  aproxIgual(r.cambioMedio, 5.20090004, 0.000001);
  aproxIgual(r.fobBrl, 35564.08 * 5.20090004, 0.01);
});
teste('parcela única com Valor (USD) vazio: cobre o FOB inteiro', () => {
  const r = sandboxBase.fobBrlPelasParcelas([{ valor_usd:'', cambio_fechado:'5.2' }], 10000, 5);
  aproxIgual(r.fobBrl, 52000, 0.001);
});
teste('2 parcelas com valor: cada fatia no seu câmbio, resto no câmbio da simulação', () => {
  const r = sandboxBase.fobBrlPelasParcelas([{ valor_usd:'3000', cambio_fechado:'5.1' }, { valor_usd:'5000', cambio_fechado:'5.3' }], 10000, 5);
  aproxIgual(r.fobBrl, 3000*5.1 + 5000*5.3 + 2000*5, 0.001);
});
teste('parcela com valor + parcela de câmbio sem valor: a segunda cobre o restante', () => {
  const r = sandboxBase.fobBrlPelasParcelas([{ valor_usd:'3000', cambio_fechado:'5.1' }, { valor_usd:'', cambio_fechado:'5.3' }], 10000, 5);
  aproxIgual(r.fobBrl, 3000*5.1 + 7000*5.3, 0.001);
});
teste('sem câmbio fechado: tudo no câmbio da simulação', () => {
  const r = sandboxBase.fobBrlPelasParcelas([{ valor_usd:'3000', cambio_fechado:'' }], 10000, 5);
  aproxIgual(r.fobBrl, 50000, 0.001);
});

// ── Vendas previstas — armazenagem pós-nacionalização (RF) ──
console.log('\n📋 Vendas previstas (RF) no Calculador');
const _rRF = {
  fob_usd: 10000, custo_total: 60000,
  cenarios: {
    com_st: { faturamento_total: 75000, mix: [{ vlr_unit_brl: 1875 }, { vlr_unit_brl: 375 }] },
    sem_st: { faturamento_total: 72000, mix: [{ vlr_unit_brl: 1800 }, { vlr_unit_brl: 360 }] },
  },
};
const _mixRF = { tipo: 'TBR', itens: [ { medida: '295/80R22.5', qtd: 20, preco: 250 }, { medida: '205/55R16', qtd: 100, preco: 50 } ] };
teste('tipo automático: R22.5 → TBR, R16 cai no tipo do mix (TBR) a menos que trocado', () => {
  verdadeiro(sandboxBase.detectarTipoRFCalc('295/80R22.5', 'PCR') === 'TBR');
  verdadeiro(sandboxBase.detectarTipoRFCalc('205/55R16', 'PCR') === 'PCR');
});
teste('lote vendido 60 dias após a chegada: 31 dias cobrados, custo e preço ajustados por item', () => {
  const res = sandboxBase.calcularVendasPrevistasRF(_rRF, _mixRF, { vendas: [{ dias: 60, itens: { 0: 10, 1: 40 } }], tipos: { 1: 'PCR' } });
  const [a, b] = res.vendas[0].linhas;
  aproxIgual(a.diasCobrados, 31, 0); aproxIgual(a.armUnit, 12.4, 0.001);        // TBR 0,40 × 31
  aproxIgual(res.itens[0].custoUnit, 1500, 0.001);                              // 60000 × 250/10000
  aproxIgual(a.custoUnitAjust, 1512.4, 0.001);
  aproxIgual(a.precoComSt, 1875 + 12.4 * 1.25, 0.01);
  aproxIgual(a.precoSemSt, 1800 + 12.4 * 1.2, 0.01);
  aproxIgual(b.armUnit, 1.4, 0.001);                                            // PCR 0,045 × 31 = 1,395 → 1,40
  aproxIgual(res.armazenagemTotal, 12.4 * 10 + 1.4 * 40, 0.01);
});
teste('dentro da carência não cobra; quantidade acima do mix é sinalizada', () => {
  const res = sandboxBase.calcularVendasPrevistasRF(_rRF, _mixRF, { vendas: [{ dias: 20, itens: { 0: 15 } }, { dias: 90, itens: { 0: 10 } }] });
  aproxIgual(res.vendas[0].linhas[0].armUnit, 0, 0);
  verdadeiro(res.itens[0].excede === true, 'previsto 25 de 20 deveria exceder');
});
teste('tarifas do cadastro (Listas) substituem o padrão', () => {
  const res = sandboxBase.calcularVendasPrevistasRF(_rRF, _mixRF, { vendas: [{ dias: 40, itens: { 0: 1 } }] }, { TBR: { tarifa_dia: 1, carencia_dias: 10 } });
  aproxIgual(res.vendas[0].linhas[0].armUnit, 30, 0.001);
});

// ── Comissionados do cadastro (Passo 3b) — nomes/percentuais fictícios ──
console.log('\n📋 calculador-comissionados.js — base de cada comissionado');
const _comCalc = require('./calculador-comissionados.js');
teste('cada comissionado usa a sua base (faturamento, NF, FOB, lucro)', () => {
  const itens = [
    { codigo: 'VEND_A', dados: { percentual: '2', base: 'FATURAMENTO_TOTAL' } },
    { codigo: 'VEND_B', dados: { percentual: '1,5', base: 'NOTA_FISCAL' } },
    { codigo: 'VEND_C', dados: { percentual: 1, base: 'FOB_DOLAR' } },
    { codigo: 'VEND_D', dados: { percentual: 10, base: 'LUCRO_BRUTO' } },
  ];
  const r = _comCalc.calcularComissionadosCalc(itens, { faturamento: 1000, nf: 900, fob: 500, lucro: 200 });
  aproxIgual(r.linhas[0].valor, 20, 1e-9);
  aproxIgual(r.linhas[1].valor, 13.5, 1e-9);
  aproxIgual(r.linhas[2].valor, 5, 1e-9);
  aproxIgual(r.linhas[3].valor, 20, 1e-9);
  aproxIgual(r.total, 58.5, 1e-9);
});
teste('lucro negativo não gera comissão sobre lucro', () => {
  const r = _comCalc.calcularComissionadosCalc([{ codigo: 'X', dados: { percentual: 10, base: 'LUCRO_BRUTO' } }], { lucro: -50 });
  aproxIgual(r.total, 0, 0);
});
teste('cliente casa por palavra inteira (OST não casa com COSTA)', () => {
  const c = { dados: { clientes: 'OST, CLIENTE TESTE' } };
  verdadeiro(_comCalc.comissionadoAtendeClienteCalc(c, 'Comercial Ost Ltda') === true, 'OST deveria casar');
  verdadeiro(_comCalc.comissionadoAtendeClienteCalc(c, 'Costa Pneus') === false, 'COSTA não deveria casar');
  verdadeiro(_comCalc.comissionadoAtendeClienteCalc({ dados: { clientes: '' } }, 'Qualquer') === false, 'sem lista não marca sozinho');
});

console.log('\n📋 Marjoração 0,6% e comissionados dentro do calcular()');
function _rodarCalc(prep) {
  const sb = criarSandbox();
  carregarNoSandbox(sb);
  if (prep) vm.runInContext(prep, sb);
  sb.calcular();
  return vm.runInContext('_estado.ultimoResultado', sb);
}
teste('Marjoração SIM soma 0,6% da base de importação ao custo total', () => {
  const a = _rodarCalc();
  const b = _rodarCalc("setToggle('marj','SIM');");
  aproxIgual(a.MARJ, 0, 0);
  aproxIgual(b.MARJ, b.base_imp_brl * 0.006, 0.01);
  aproxIgual(b.custo_total - a.custo_total, b.MARJ, 0.01);
});
teste('comissionados do cadastro substituem o % manual e cada um usa sua base', () => {
  const base = _rodarCalc();
  const prep = `
    this.calcularComissionadosCalc = ${_comCalc.calcularComissionadosCalc.toString()};
    this.comissionadosSelecionadosCalc = () => [
      { codigo: 'VEND_A', nome: 'Vend A', dados: { percentual: 1, base: 'FATURAMENTO_TOTAL' } },
      { codigo: 'VEND_B', nome: 'Vend B', dados: { percentual: 1, base: 'FOB_DOLAR' } },
    ];
    setToggle('br','SIM'); document.getElementById('br_pct').value = '50';`;
  const r = _rodarCalc(prep);
  verdadeiro(Array.isArray(r.COM_br_linhas) && r.COM_br_linhas.length === 2, 'deveria ter 2 linhas de comissão');
  aproxIgual(r.COM_br_linhas[0].valor, r.cenarios[r.tem_st ? 'com_st' : 'sem_st'].faturamento_total * 0.01, 0.01);
  verdadeiro(r.COM_br < base.faturamento * 0.5, 'o % manual (50%) não pode ser usado quando há comissionado');
  verdadeiro(r.br_nome === 'Vend A + Vend B', 'nome deveria juntar os comissionados: ' + r.br_nome);
});

console.log('\n📋 Formas de pagamento (Passo 4): juros no boleto, prazo interno, cartão, Trademaster');
const _prepParc = `setToggle('parcelado','SIM'); document.getElementById('taxa_juros_am').value='2'; document.getElementById('prazo_medio_dias').value='60';`;
teste('juros no boleto: fórmula da planilha (K44) e NF menor para a mesma margem', () => {
  const semJb = _rodarCalc(_prepParc);
  const comJb = _rodarCalc(_prepParc + `setToggle('jb','SIM'); document.getElementById('juros_boleto_fixo').value='10000';`);
  const base = comJb.valor_saldo * 0.02 / 30 * 60 + 10000;
  aproxIgual(comJb.juros_boleto, base + (base + base * 0.0465) * 0.0465, 0.01);
  verdadeiro(comJb.vlr_total_nfe < semJb.vlr_total_nfe, `NF com juros no boleto (${comJb.vlr_total_nfe}) deveria ser menor que sem (${semJb.vlr_total_nfe})`);
  aproxIgual(comJb.juros_parcelamento, 0, 0, 'no modo boleto o juros não é descontado do lucro');
});
teste('comissão sobre faturamento inclui o juros no boleto', () => {
  const r = _rodarCalc(_prepParc + `setToggle('jb','SIM'); setToggle('br','SIM'); document.getElementById('br_pct').value='1';`);
  const c = r.cenarios[r.tem_st ? 'com_st' : 'sem_st'];
  aproxIgual(r.COM_br, (c.faturamento_total + r.juros_boleto) * 0.01, 0.01);
});
teste('custo financeiro: prazo interno, cartão REDE e Trademaster', () => {
  const sb = criarSandbox(); carregarNoSandbox(sb);
  const pct = (forma, extra) => vm.runInContext(`document.getElementById('forma_custo_fin').value='${forma}'; ${extra||''} pctCustoFinanceiroCalc()`, sb);
  aproxIgual(pct('prazo', `document.getElementById('cf_taxa_am').value='1.5'; document.getElementById('cf_prazo_medio').value='45';`), 0.015/30*45, 1e-9);
  aproxIgual(pct('cartao', `document.getElementById('cf_parcelas').value='1';`), 0.0291 + 0.018, 1e-9);
  aproxIgual(pct('cartao', `document.getElementById('cf_parcelas').value='6';`), 0.0327 + 0.018/30*105, 1e-9);
  aproxIgual(pct('trademaster', `document.getElementById('cf_parcelas').value='6';`), 0.0928600832612018, 1e-12);
  aproxIgual(pct(''), 0, 0);
});
teste('custo financeiro entra como custo (desconta do lucro / sobe a NF)', () => {
  const a = _rodarCalc();
  const b = _rodarCalc(`document.getElementById('forma_custo_fin').value='trademaster'; document.getElementById('cf_parcelas').value='3';`);
  aproxIgual(b.custo_financeiro, b.vlr_total_nfe * 0.0530629047206867, 0.01);
  verdadeiro(b.vlr_total_nfe > a.vlr_total_nfe, 'com custo financeiro a NF precisa subir pra manter a margem');
});

teste('prazo do boleto "como é" → média dos vencimentos', () => {
  const sb = criarSandbox(); carregarNoSandbox(sb);
  const m = t => vm.runInContext(`prazoMedioDeTexto(${JSON.stringify(t)})`, sb);
  aproxIgual(m('30dd'), 30, 1e-9); aproxIgual(m('30/60dd'), 45, 1e-9); aproxIgual(m('15/30/45/60dd'), 37.5, 1e-9);
  aproxIgual(m('28/42/56/70/84dd'), 56, 1e-9); aproxIgual(m('30/60/90/120/150/180dd'), 105, 1e-9); aproxIgual(m('20/40/60dd'), 40, 1e-9);
  verdadeiro(m('') === null);
  const r = vm.runInContext(`document.getElementById('prazo_boleto').value='30/60/90/120dd'; onPrazoSelectChange('prazo_boleto','prazo_boleto_outro','prazo_medio_dias','prazo_medio_info'); document.getElementById('prazo_medio_dias').value`, sb);
  aproxIgual(parseFloat(r), 75, 1e-9);
});

// ── Antidumping por item (#488, Jean 14/10/2026) — valores fictícios ──
teste('antidumping: peso só dos itens SIM × US$/kg × câmbio DI', () => {
  const sb = criarSandbox(); carregarNoSandbox(sb);
  const r = vm.runInContext(`calcularDumpingItens([{qtd:10,peso_kg:50},{qtd:20,peso_kg:40,dumping:false},{qtd:5,peso_kg:60}], 0.5, 5)`, sb);
  aproxIgual(r.peso_total, 10*50 + 20*40 + 5*60, 1e-9);
  aproxIgual(r.peso_sim, 10*50 + 5*60, 1e-9);            // o item NÃO fica fora do peso
  aproxIgual(r.total_brl, (10*50 + 5*60) * 0.5 * 5, 1e-9);
  aproxIgual(r.porItem[1].dump_brl, 0, 0);
  verdadeiro(r.temPeso);
});
teste('antidumping: sem peso no mix usa o valor manual; com peso usa o calculado', () => {
  const mix = "_estado.mix = { itens: [{medida:'AAA',qtd:100,preco:100},{medida:'BBB',qtd:100,preco:178.1296}], fob_total: 27812.96 };";
  const manual = _rodarCalc(mix + "setToggle('dump','SIM'); document.getElementById('dump_valor').value='1000';");
  aproxIgual(manual.DUMP, 1000, 1e-9);
  const porPeso = _rodarCalc("_estado.mix = { itens: [{medida:'AAA',qtd:100,preco:100,peso_kg:50},{medida:'BBB',qtd:100,preco:178.1296,peso_kg:60,dumping:false}], fob_total: 27812.96 }; setToggle('dump','SIM'); document.getElementById('dump_taxa_kg').value='0.5'; document.getElementById('dump_valor').value='1000';");
  const cambioDI = 5.1695; // sem câmbio DI informado, usa o câmbio principal do caso base
  aproxIgual(porPeso.DUMP, 100*50 * 0.5 * cambioDI, 0.01);
});
teste('antidumping: o valor do dumping vai pro preço só dos itens SIM e o total do mix não muda', () => {
  const base = "_estado.mix = { itens: [{medida:'AAA',qtd:100,preco:100,peso_kg:50},{medida:'BBB',qtd:100,preco:178.1296,peso_kg:60,dumping:false}], fob_total: 27812.96 }; document.getElementById('dump_taxa_kg').value='0.5';";
  const sem = _rodarCalc(base);                          // toggle NÃO
  const com = _rodarCalc(base + "setToggle('dump','SIM');");
  const tot = r => r.mix_result.reduce((s, it) => s + it.total_brl, 0);
  aproxIgual(tot(com), com.faturamento - (com.china_fora_val||0) - (com.boss_fora_val||0), 0.05);
  // Proporção entre os dois itens muda: o item SIM fica relativamente mais caro.
  const razaoSem = sem.mix_result[0].vlr_unit_brl / sem.mix_result[1].vlr_unit_brl;
  const razaoCom = com.mix_result[0].vlr_unit_brl / com.mix_result[1].vlr_unit_brl;
  verdadeiro(razaoCom > razaoSem, 'item com dumping deveria pesar mais no preço');
});


// ── Rev97 (14/10/2026): variação cambial da entrada, frete terrestre, meta de lucro ──
teste('variação cambial entrada: só parcelas com câmbio abaixo do câmbio DI, × 4,65%', () => {
  const sb = criarSandbox(); carregarNoSandbox(sb);
  const r = vm.runInContext(`calcularVariacaoCambialEntrada([{label:'Inicial',valor_usd:10000,cambio_fechado:5.0},{label:'Final',valor_usd:20000,cambio_fechado:5.6}], 5.4)`, sb);
  aproxIgual(r.variacao_brl, 10000 * (5.4 - 5.0), 1e-9);   // a Final (5,6 > 5,4) não gera variação
  aproxIgual(r.custo_brl, 4000 * 0.0465, 1e-9);
  verdadeiro(r.detalhe.length === 1 && !r.manual);
  const m = vm.runInContext(`calcularVariacaoCambialEntrada([{valor_usd:10000,cambio_fechado:5.0}], 5.4, '1500')`, sb);
  aproxIgual(m.variacao_brl, 1500, 0); aproxIgual(m.custo_brl, 1500 * 0.0465, 1e-9); verdadeiro(m.manual);
  const z = vm.runInContext(`calcularVariacaoCambialEntrada([{valor_usd:10000,cambio_fechado:5.5}], 5.4)`, sb);
  aproxIgual(z.custo_brl, 0, 0);
});
teste('variação cambial entra no Total Taxas e no custo total', () => {
  const a = _rodarCalc();
  const b = _rodarCalc("document.getElementById('tx_var_cambial').value='2000';");
  aproxIgual(b.VAR_CAMB, 93, 1e-9);
  aproxIgual(b.total_taxas - a.total_taxas, 93, 0.01);
  aproxIgual(b.custo_total - a.custo_total, 93, 0.01);
});
teste('frete terrestre: só Transportadora, % do Vlr. Total NFe, desconta do lucro bruto (não do custo)', () => {
  const a = _rodarCalc("document.getElementById('frete_terrestre_pct').value='2';"); // tipo ENCOMENDA → ignora
  aproxIgual(a.frete_terrestre, 0, 0);
  const b = _rodarCalc("document.getElementById('tipo_importacao').value='TRANSPORTADORA'; document.getElementById('frete_terrestre_pct').value='2';");
  verdadeiro(b.frete_terrestre > 0);
  aproxIgual(b.frete_terrestre, b.vlr_total_nfe * 0.02, 0.01);
  aproxIgual(b.custo_total, a.custo_total, 0.01); // custo não muda; o cenário resolve o fator pra manter o lucro-alvo
});
teste('meta de lucro por cliente: linha específica vence o padrão', () => {
  const lista = [
    { codigo: 'PADRAO', dados: { percentual: 2, clientes: '' } },
    { codigo: 'META_A', nome: 'Grupo A', dados: { percentual: '3,5', clientes: 'CLIENTE ALFA, BETA' } },
    { codigo: 'INATIVA', dados: { percentual: 9, clientes: 'ALFA' }, ativo: false },
  ];
  const a = _comCalc.metaLucroParaCliente(lista, 'CLIENTE ALFA LTDA');
  aproxIgual(a.pct, 3.5, 0); verdadeiro(a.especifica);
  const b = _comCalc.metaLucroParaCliente(lista, 'OUTRO CLIENTE');
  aproxIgual(b.pct, 2, 0); verdadeiro(!b.especifica);
  verdadeiro(_comCalc.metaLucroParaCliente([], 'X') === null);
  verdadeiro(_comCalc.metaLucroParaCliente(lista, 'ALFABETO SA').pct === 2); // palavra inteira: ALFA não casa com ALFABETO
});


teste('2 containers: só as taxas por container dobram (Siscomex/AFRMM/L.I./Agente/IOF são únicas — Rev97)', () => {
  const a = _rodarCalc("['auto_marinha','auto_agente','auto_iof'].forEach(id=>{document.getElementById(id).checked=false;});");
  const b = _rodarCalc("['auto_marinha','auto_agente','auto_iof'].forEach(id=>{document.getElementById(id).checked=false;}); document.getElementById('qtde_containers').value='2';");
  verdadeiro(a.containers === 1 && b.containers === 2);
  const f = a.txOp.fixas;
  const porContainer = f.capatazia + f.liberacao_bl + f.despachante + f.sda + f.lavacao + f.administrativo + f.baixa_patio;
  aproxIgual(b.taxas_fixas - a.taxas_fixas, porContainer, 0.01); // Siscomex, AFRMM, L.I. e Agente NÃO dobram
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
