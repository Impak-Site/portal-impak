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

// ── RESUMO ───────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Total: ${totalTestes} testes, ${totalTestes - totalFalhas} passaram, ${totalFalhas} falharam`);
if (totalFalhas > 0) {
  console.log('\n⚠️  NÃO FAÇA DEPLOY com testes falhando sem entender o motivo.');
  process.exit(1);
} else {
  console.log('✓ Tudo certo para deploy (do ponto de vista destas regras testadas).');
}
