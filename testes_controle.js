/**
 * TESTES AUTOMATIZADOS — Controle de Processos (IMPAK Portal)
 * ════════════════════════════════════════════════════════════════
 * Roda com: node testes_controle.js
 *
 * O QUE ESTE ARQUIVO FAZ DIFERENTE DE TESTES ANTERIORES:
 * Em vez de reescrever a lógica de cálculo aqui (o que cria risco de eu
 * copiar errado sem notar), este teste CARREGA O CÓDIGO REAL extraído do
 * controle_v2.html e testa as funções de fato em produção. Se alguém
 * editar controle_v2.html e uma função crítica mudar de comportamento,
 * este teste detecta — porque está rodando o código real, não uma cópia.
 *
 * QUANDO RODAR:
 * - Antes de qualquer deploy no dev ou main.
 * - Depois de qualquer mudança nas funções: calcularFase, demurrageDias,
 *   norm, calcularPeriodo (e outras puras que forem adicionadas).
 *
 * SE UM TESTE FALHAR:
 * Não suba a mudança. Alguma alteração no código mudou o comportamento
 * de uma regra de negócio já validada — pode ser intencional (a regra
 * mudou de propósito) ou um bug introduzido sem querer. Confirme qual
 * dos dois antes de continuar.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

// ── 1. CARREGAR O JS REAL DOS MÓDULOS ────────────────────────────
// controle_v2.html foi modularizado (ver commit "Quebrar controle_v2.html
// em módulos") — o JS que antes vivia num único <script> inline dentro do
// HTML agora é carregado via <script src="..."> a partir de arquivos
// separados (controle-core.js, controle-modal.js etc.). Este teste
// concatena esses mesmos módulos, na mesma ordem em que o HTML os carrega,
// e roda o resultado nos stubs abaixo — continua sendo o CÓDIGO REAL
// rodando (não uma cópia), só que montado a partir dos arquivos certos em
// vez de extraído de dentro do HTML (que não tem mais nenhum <script>
// inline pra extrair). chat.js (nav global) e excel-styles.js/ExcelJS
// ficam de fora de propósito — não têm nenhuma das funções puras testadas
// aqui, e excel-styles.js só é referenciado dentro do corpo de funções de
// export (não executado no carregamento do módulo).
const MODULOS_JS = [
  // taxas-catalogo.js precisa vir ANTES de controle-core.js — CUSTOS_REAIS_CONFIG
  // usa window.TaxasCatalogo.porId() pra derivar porContainer (ver comentário
  // em controle-core.js), mesma ordem do <script src> real em controle_v2.html.
  'taxas-catalogo.js',
  'controle-core.js',
  'controle-modal.js',
  'controle-campos.js',
  'controle-export.js',
  'controle-contatos.js',
  'controle-import-ia.js',
  'controle-dashboards.js',
];
const jsReal = MODULOS_JS.map(nome => {
  const caminho = path.join(__dirname, nome);
  if (!fs.existsSync(caminho)) {
    console.error('❌ Não encontrei o módulo', caminho);
    process.exit(1);
  }
  return fs.readFileSync(caminho, 'utf-8');
}).join('\n');

// ── 2. STUBS MÍNIMOS DE DOM/BROWSER ────────────────────────────
// Suficientes para o arquivo CARREGAR sem lançar erro ao definir as
// funções (mesmo que funções que de fato MANIPULAM a tela não funcionem
// nestes stubs — não é o que estamos testando aqui).
function criarSandbox() {
  const elementosFalsos = {};
  const documentFalso = {
    getElementById: (id) => elementosFalsos[id] || (elementosFalsos[id] = {
      value: '', innerHTML: '', style: {}, textContent: '', classList: { add(){}, remove(){}, contains(){ return false; } },
      addEventListener(){}, appendChild(){}, querySelector(){ return null; }, querySelectorAll(){ return []; }, dispatchEvent(){ return true; },
    }),
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
    // location: usado pelo wrapper de fetch em controle-core.js
    // (res.url.startsWith(location.origin)) pra detectar redirecionamento
    // de sessão expirada — sem isso, carregar o módulo real lança
    // "location is not defined" fora de um navegador de verdade.
    location: { origin: 'http://localhost', href: 'http://localhost/', pathname: '/' },
    Date, Math, JSON, Array, Object, String, Number, Boolean, RegExp, Promise,
    URL: typeof URL !== 'undefined' ? URL : undefined,
    Event: typeof Event !== 'undefined' ? Event : undefined, // usado por confirmarCambioComo (dispatchEvent de 'change')
    addEventListener: () => {}, // o código real registra listeners de window.onload etc.
  };
  sandbox.window = sandbox; // padrão comum: window === global scope no browser
  return sandbox;
}

const sandbox = criarSandbox();
vm.createContext(sandbox);
try {
  vm.runInContext(jsReal, sandbox, { filename: 'controle_v2_extraido.js' });
} catch (e) {
  console.error('❌ O código real não carregou nos stubs de teste.');
  console.error('   Isso pode significar que uma função nova usa algo do browser que');
  console.error('   os stubs não cobrem ainda (atualize criarSandbox), ou um erro real.');
  console.error('   Erro:', e.message);
  process.exit(1);
}

// ── 3. FRAMEWORK DE TESTE MÍNIMO ────────────────────────────────
let totalTestes = 0, totalFalhas = 0;
function teste(nome, fn) {
  totalTestes++;
  try {
    fn();
    console.log(`  ✓ ${nome}`);
  } catch (e) {
    totalFalhas++;
    console.log(`  ✗ ${nome}`);
    console.log(`      ${e.message}`);
  }
}
// Versão async: espera a Promise resolver antes de considerar passou/falhou.
// Necessária pra testar salvarProcesso() (async function real do código),
// diferente de teste() acima que só cobre funções síncronas puras.
async function testeAsync(nome, fn) {
  totalTestes++;
  try {
    await fn();
    console.log(`  ✓ ${nome}`);
  } catch (e) {
    totalFalhas++;
    console.log(`  ✗ ${nome}`);
    console.log(`      ${e.message}`);
  }
}
function iguais(a, b, msg) {
  if (a !== b) throw new Error(msg || `esperado "${b}", recebido "${a}"`);
}
function aproxIgual(a, b, margem, msg) {
  if (Math.abs(a - b) > margem) {
    throw new Error(msg || `esperado ≈${b}, recebido ${a} (diferença ${Math.abs(a-b).toFixed(4)} > margem ${margem})`);
  }
}
function verdadeiro(a, msg) {
  if (!a) throw new Error(msg || `esperado valor verdadeiro, recebido "${a}"`);
}

// ── 4. TESTES: calcularFase ─────────────────────────────────────
console.log('\n📋 calcularFase()');
teste('processo novo (sem nada) fica em PI', () => {
  iguais(sandbox.calcularFase({}), 'PI');
});
teste('ETD preenchido avança para AGUARDANDO_EMBARQUE', () => {
  iguais(sandbox.calcularFase({ etd: '2026-01-01' }), 'AGUARDANDO_EMBARQUE');
});
teste('HBL sozinho (sem Data de Embarque efetiva) NÃO avança para EMBARCADO — fica em AGUARDANDO_EMBARQUE (regra atualizada: HBL pode ser emitido antes do embarque físico)', () => {
  iguais(sandbox.calcularFase({ etd: '2026-01-01', hbl: 'ABC123' }), 'AGUARDANDO_EMBARQUE');
});
teste('Data de chegada avança para DESEMBARCADO', () => {
  iguais(sandbox.calcularFase({ hbl: 'ABC123', data_chegada: '2026-02-01' }), 'DESEMBARCADO');
});
teste('Número da DI avança para REGISTRO_DI', () => {
  iguais(sandbox.calcularFase({ data_chegada: '2026-02-01', numero_di: '26/123456-7' }), 'REGISTRO_DI');
});
teste('Canal Verde + Parametrização avança para FATURAMENTO', () => {
  iguais(sandbox.calcularFase({ numero_di: '26/123456-7', canal: 'VERDE', data_parametrizacao: '2026-02-05' }), 'FATURAMENTO');
});
teste('Canal Amarelo SEM data_liberacao fica em PARAMETRIZACAO (não avança sem liberação)', () => {
  iguais(sandbox.calcularFase({ numero_di: '26/123456-7', canal: 'AMARELO' }), 'PARAMETRIZACAO');
});
teste('Só NF Entrada preenchida -> CARREGAMENTO (não avança sozinha)', () => {
  iguais(sandbox.calcularFase({ nf_entrada_numero: '8305' }), 'CARREGAMENTO');
});
teste('Só NF Saída preenchida -> CARREGAMENTO (não avança sozinha)', () => {
  iguais(sandbox.calcularFase({ nf_saida_numero: '8309' }), 'CARREGAMENTO');
});
teste('Data de Embarque no futuro NÃO avança pra EMBARCADO (provável previsão no campo errado)', () => {
  const amanha = new Date(); amanha.setDate(amanha.getDate() + 4);
  iguais(sandbox.calcularFase({ etd: '2026-01-01', data_embarque: amanha.toISOString().slice(0,10) }), 'AGUARDANDO_EMBARQUE');
});
teste('Data de Embarque no passado avança normalmente pra EMBARCADO', () => {
  const ontem = new Date(); ontem.setDate(ontem.getDate() - 2);
  iguais(sandbox.calcularFase({ etd: '2026-01-01', data_embarque: ontem.toISOString().slice(0,10) }), 'EMBARCADO');
});
teste('Data de Embarque efetiva é obrigatória pra EMBARCADO — HBL sozinho não é mais suficiente (HBL pode ser emitido antes do embarque físico)', () => {
  const ontem = new Date(); ontem.setDate(ontem.getDate() - 2);
  iguais(sandbox.calcularFase({ etd: '2026-01-01', hbl: 'HBLX123', data_embarque: ontem.toISOString().slice(0,10) }), 'EMBARCADO');
  iguais(sandbox.calcularFase({ etd: '2026-01-01', hbl: 'HBLX123' }), 'AGUARDANDO_EMBARQUE');
});
teste('AMBAS as NFs preenchidas -> avança para DEVOLUCAO_VAZIO (regra de negócio confirmada com o usuário)', () => {
  iguais(sandbox.calcularFase({ nf_entrada_numero: '8305', nf_saida_numero: '8309' }), 'DEVOLUCAO_VAZIO');
});
teste('Devolução do vazio sozinha NÃO finaliza mais — precisa RIC Isento ou Lavagem paga (pedido Emanuelly 04/09/2026)', () => {
  iguais(sandbox.calcularFase({ nf_entrada_numero:'1', nf_saida_numero:'2', data_devolucao_vazio: '2026-06-30' }), 'DEVOLUCAO_VAZIO');
});
teste('Devolução do vazio + Status RIC Isento -> finaliza (não há taxa de lavagem a pagar)', () => {
  iguais(sandbox.calcularFase({ data_devolucao_vazio: '2026-06-30', ric_status: 'Isento' }), 'FINALIZADO');
});
teste('Devolução do vazio + Status RIC Termo (não isento) SEM data de pagamento da lavagem -> continua em Devolução do Vazio', () => {
  iguais(sandbox.calcularFase({ nf_entrada_numero:'1', nf_saida_numero:'2', data_devolucao_vazio: '2026-06-30', ric_status: 'Termo' }), 'DEVOLUCAO_VAZIO');
});
teste('Devolução do vazio + Status RIC Termo (não isento) COM data de pagamento da lavagem -> finaliza', () => {
  iguais(sandbox.calcularFase({ data_devolucao_vazio: '2026-06-30', ric_status: 'Termo', data_pagamento_lavagem: '2026-07-02' }), 'FINALIZADO');
});
teste('Devolução do vazio + data de pagamento da lavagem preenchida mesmo sem Status RIC definido -> finaliza', () => {
  iguais(sandbox.calcularFase({ data_devolucao_vazio: '2026-06-30', data_pagamento_lavagem: '2026-07-02' }), 'FINALIZADO');
});
teste('Devolução do vazio tem prioridade MÁXIMA mesmo com tudo preenchido (mas ainda depende de RIC/Lavagem pra finalizar)', () => {
  iguais(sandbox.calcularFase({
    etd:'2026-01-01', hbl:'X', data_chegada:'2026-02-01', numero_di:'1',
    canal:'VERDE', data_parametrizacao:'2026-02-05', nf_entrada_numero:'1',
    nf_saida_numero:'2', data_devolucao_vazio:'2026-06-30'
  }), 'DEVOLUCAO_VAZIO');
  iguais(sandbox.calcularFase({
    etd:'2026-01-01', hbl:'X', data_chegada:'2026-02-01', numero_di:'1',
    canal:'VERDE', data_parametrizacao:'2026-02-05', nf_entrada_numero:'1',
    nf_saida_numero:'2', data_devolucao_vazio:'2026-06-30', ric_status:'Isento'
  }), 'FINALIZADO');
});

// ── 5. TESTES: demurrageDias ────────────────────────────────────
console.log('\n📋 demurrageDias()');
teste('sem demurrage_vencimento retorna null', () => {
  iguais(sandbox.demurrageDias({}), null);
});
teste('vencimento no passado retorna número negativo', () => {
  const ontem = new Date(); ontem.setDate(ontem.getDate() - 5);
  const dias = sandbox.demurrageDias({ demurrage_vencimento: ontem.toISOString().slice(0,10) });
  verdadeiro(dias < 0, `esperado negativo, recebido ${dias}`);
});
teste('vencimento no futuro retorna número positivo', () => {
  const futuro = new Date(); futuro.setDate(futuro.getDate() + 10);
  const dias = sandbox.demurrageDias({ demurrage_vencimento: futuro.toISOString().slice(0,10) });
  verdadeiro(dias > 0, `esperado positivo, recebido ${dias}`);
});
teste('renderDemurInfo: base da contagem é Data de Chegada, não Presença de Carga (pedido Emanuelly 14/09/2026, reverte ajuste de 03/09/2026)', () => {
  const p = { data_presenca: '2026-08-20', data_chegada: '2026-08-24', free_time: 21 };
  const html = sandbox.renderDemurInfo(p);
  verdadeiro(html.includes('13/09/2026'), 'chegada 24/08 + 21 dias (contando 24/08 como o 1º) deveria vencer em 13/09/2026, não a partir da presença de carga (20/08)');
  verdadeiro(html.includes('Data de chegada'), 'deveria rotular a data usada como Data de chegada quando ela existe');
});
teste('renderDemurInfo: sem Data de Chegada, cai no fallback pra Presença de Carga (processos antigos)', () => {
  const p = { data_presenca: '2026-08-24', free_time: 21 };
  const html = sandbox.renderDemurInfo(p);
  verdadeiro(html.includes('13/09/2026'), 'sem chegada cadastrada, deveria contar a partir da Presença de Carga igual antes');
  verdadeiro(html.includes('Presença de carga'), 'deveria rotular a data usada como Presença de carga no fallback');
});

// ── 5b. TESTES: chegandoEmDias — card "Chegada em 7d" do Dashboard ─
console.log('\n📋 chegandoEmDias() — processo com ETA dentro da janela e ainda não desembarcado');
teste('ETA daqui a 3 dias, sem data_chegada -> true (dentro da janela de 7 dias)', () => {
  const eta = new Date(); eta.setDate(eta.getDate() + 3);
  verdadeiro(sandbox.chegandoEmDias({ eta: eta.toISOString().slice(0,10) }, 7) === true);
});
teste('ETA daqui a 10 dias -> false (fora da janela de 7 dias)', () => {
  const eta = new Date(); eta.setDate(eta.getDate() + 10);
  verdadeiro(sandbox.chegandoEmDias({ eta: eta.toISOString().slice(0,10) }, 7) === false);
});
teste('ETA dentro da janela mas já com data_chegada preenchida -> false (já desembarcou)', () => {
  const eta = new Date(); eta.setDate(eta.getDate() + 2);
  verdadeiro(sandbox.chegandoEmDias({ eta: eta.toISOString().slice(0,10), data_chegada: '2026-07-10' }, 7) === false);
});
teste('ETA dentro da janela mas processo FINALIZADO -> false', () => {
  const eta = new Date(); eta.setDate(eta.getDate() + 2);
  verdadeiro(sandbox.chegandoEmDias({ eta: eta.toISOString().slice(0,10), fase: 'FINALIZADO' }, 7) === false);
});
teste('sem ETA -> false', () => {
  verdadeiro(sandbox.chegandoEmDias({}, 7) === false);
});
teste('ETA no passado -> false (já deveria ter chegado, não é mais "próxima chegada")', () => {
  const eta = new Date(); eta.setDate(eta.getDate() - 2);
  verdadeiro(sandbox.chegandoEmDias({ eta: eta.toISOString().slice(0,10) }, 7) === false);
});

// ── 5c. TESTES: listarPagamentosPI / paisDoProcesso — base do Dashboard Financeiro ─
console.log('\n📋 listarPagamentosPI() — achata processos em parcelas de pagamento');
teste('paisDoProcesso: porto conhecido retorna o país; porto desconhecido retorna "—"', () => {
  iguais(sandbox.paisDoProcesso({ porto_origem: 'NINGBO' }), 'China');
  iguais(sandbox.paisDoProcesso({ porto_origem: 'busan' }), 'Coreia do Sul');
  iguais(sandbox.paisDoProcesso({ porto_origem: 'OUTRO PORTO QUALQUER' }), '—');
  iguais(sandbox.paisDoProcesso({}), '—');
});
teste('VISTA vira 1 parcela "unico" com vencimento em Data Entrada', () => {
  const procs = [{ referencia:'UD26-100', fornecedor:'ACME', porto_origem:'NINGBO', pi_valor_usd:10000, pi_pagamento:'VISTA', pi_data_entrada:'2026-08-01', pi_cambio:5.10, pi_pago:false, fase:'PI' }];
  const pags = sandbox.listarPagamentosPI(procs);
  iguais(pags.length, 1);
  iguais(pags[0].parcela, 'unico');
  iguais(pags[0].valorUsd, 10000);
  iguais(pags[0].vencimento, '2026-08-01');
  iguais(pags[0].pais, 'China');
  iguais(pags[0].pago, false);
});
teste('PRAZO vira 1 parcela "unico" com vencimento em Data Saldo (não Data Entrada)', () => {
  const procs = [{ referencia:'UD26-101', pi_valor_usd:5000, pi_pagamento:'PRAZO', pi_data_saldo:'2026-09-15', pi_pago:true, fase:'PI' }];
  const pags = sandbox.listarPagamentosPI(procs);
  iguais(pags.length, 1);
  iguais(pags[0].vencimento, '2026-09-15');
  iguais(pags[0].pago, true);
});
teste('ENTRADA_SALDO vira 2 parcelas (entrada + saldo), valor rateado pelo %', () => {
  const procs = [{ referencia:'UD26-102', pi_valor_usd:20000, pi_pagamento:'ENTRADA_SALDO', pi_entrada_pct:30,
    pi_data_entrada:'2026-08-01', pi_data_saldo:'2026-09-01', pi_cambio:5.0,
    pi_cambio_entrada:5.05, pi_cambio_saldo:null, pi_pago:false, fase:'PI' }];
  const pags = sandbox.listarPagamentosPI(procs);
  iguais(pags.length, 2);
  const entrada = pags.find(x=>x.parcela==='entrada');
  const saldo   = pags.find(x=>x.parcela==='saldo');
  iguais(entrada.valorUsd, 6000, 'entrada deveria ser 30% de 20000');
  iguais(saldo.valorUsd, 14000, 'saldo deveria ser os 70% restantes');
  iguais(entrada.pago, true, 'entrada com câmbio fechado registrado conta como paga');
  iguais(saldo.pago, false, 'saldo sem pi_pago ainda não conta como paga');
});
teste('PARCELADO vira 1 parcela por linha de pi_parcelas_json, valor fixo em USD cada', () => {
  const parcelas = JSON.stringify([
    { label:'Confirmação do pedido', valor_usd:8000, data_vencimento:'2026-07-01', cambio_fechado:5.20 },
    { label:'Embarque', valor_usd:9000, data_vencimento:'2026-08-01', cambio_fechado:null },
    { label:'Chegada', valor_usd:8000, data_vencimento:'2026-09-01', cambio_fechado:null },
  ]);
  const procs = [{ referencia:'UD26-105', pi_valor_usd:25000, pi_pagamento:'PARCELADO', pi_parcelas_json:parcelas, pi_cambio:5.10, fase:'PI' }];
  const pags = sandbox.listarPagamentosPI(procs);
  iguais(pags.length, 3, '3 linhas em pi_parcelas_json deveriam virar 3 pagamentos');
  const conf = pags.find(x=>x.parcela==='Confirmação do pedido');
  iguais(conf.valorUsd, 8000);
  iguais(conf.cambioFechado, 5.20);
  iguais(conf.pago, true, 'parcela com câmbio fechado registrado conta como paga');
  const embarque = pags.find(x=>x.parcela==='Embarque');
  iguais(embarque.pago, false, 'parcela sem câmbio fechado ainda não conta como paga');
  iguais(pags.reduce((s,x)=>s+x.valorUsd,0), 25000, 'soma das parcelas deveria bater com o total');
});
teste('PARCELADO ignora linhas sem valor_usd (linha em branco recém-adicionada, ainda não preenchida)', () => {
  const parcelas = JSON.stringify([{ label:'', valor_usd:'', data_vencimento:'', cambio_fechado:'' }]);
  const procs = [{ referencia:'UD26-106', pi_valor_usd:1000, pi_pagamento:'PARCELADO', pi_parcelas_json:parcelas, fase:'PI' }];
  iguais(sandbox.listarPagamentosPI(procs).length, 0);
});
teste('Processo FINALIZADO não entra na lista (já não representa capital em aberto)', () => {
  const procs = [{ referencia:'UD26-103', pi_valor_usd:1000, pi_pagamento:'VISTA', pi_pago:true, fase:'FINALIZADO' }];
  iguais(sandbox.listarPagamentosPI(procs).length, 0);
});
teste('Processo sem pi_valor_usd não entra na lista', () => {
  const procs = [{ referencia:'UD26-104', pi_pagamento:'VISTA', fase:'PI' }];
  iguais(sandbox.listarPagamentosPI(procs).length, 0);
});

// ── 6. TESTES: norm (normalização de medida, usada no TyreDesk) ─
if (sandbox.norm) {
  console.log('\n📋 norm() [se presente neste arquivo]');
  teste('remove prefixo de letra colado no número (bug real corrigido)', () => {
    iguais(sandbox.norm('P205/55R16'), '205/55R16');
  });
  teste('normaliza minúsculas e mantém formato', () => {
    iguais(sandbox.norm('205/55r16'), '205/55R16');
  });
}

(async () => {
// ── 6b. TESTES: moverDataFuturaParaPrevisao — data futura em campo "efetivo"
// Sobrescreve document.getElementById temporariamente pra injetar 2
// elementos falsos controlados pelo teste — sempre restaura o original
// logo em seguida, pra não vazar pros testes seguintes (que dependem do
// stub genérico completo, com classList/innerHTML/etc, usado por render(),
// carregarProcessos() e companhia).
console.log('\n📋 moverDataFuturaParaPrevisao() — auto-mover data futura pra previsão');
const getElementByIdOriginal = sandbox.document.getElementById;
teste('data futura no campo efetivo é movida pro campo de previsão e o efetivo é limpo', () => {
  const amanha = new Date(); amanha.setDate(amanha.getDate() + 5);
  const amanhaStr = amanha.toISOString().slice(0,10);
  const efetivo = { value: amanhaStr };
  const previsao = { value: '' };
  sandbox.document.getElementById = (id) => id==='f_data_embarque' ? efetivo : id==='f_etd' ? previsao : getElementByIdOriginal(id);
  try {
    const moveu = sandbox.moverDataFuturaParaPrevisao('f_data_embarque','f_etd','Previsão de Embarque (ETD)');
    verdadeiro(moveu === true, 'deveria retornar true quando move');
    iguais(efetivo.value, '');
    iguais(previsao.value, amanhaStr);
  } finally {
    sandbox.document.getElementById = getElementByIdOriginal;
  }
});
teste('data no passado no campo efetivo NÃO é mexida (é uma data efetiva legítima)', () => {
  const ontem = new Date(); ontem.setDate(ontem.getDate() - 3);
  const ontemStr = ontem.toISOString().slice(0,10);
  const efetivo = { value: ontemStr };
  const previsao = { value: '' };
  sandbox.document.getElementById = (id) => id==='f_data_chegada' ? efetivo : id==='f_eta' ? previsao : getElementByIdOriginal(id);
  try {
    const moveu = sandbox.moverDataFuturaParaPrevisao('f_data_chegada','f_eta','ETA (Previsão de Chegada)');
    verdadeiro(moveu === false, 'não deveria mexer em data passada');
    iguais(efetivo.value, ontemStr);
    iguais(previsao.value, '');
  } finally {
    sandbox.document.getElementById = getElementByIdOriginal;
  }
});

// ── 7. TESTES: salvarProcesso — concorrência (só envia o que mudou) ─
// Cobre o fix de vários usuários editando processos ao mesmo tempo: o save
// não pode mais mandar o processo inteiro (o que apagaria silenciosamente
// campos que outra pessoa tenha alterado nesse meio tempo) — só os campos
// realmente alterados (patchFields) + os sempre-recalculados (fase,
// demurrage_vencimento, pi_cambio, metadados). Mocka fetch pra capturar
// exatamente o que seria mandado pro servidor.
console.log('\n📋 salvarProcesso() — patch de concorrência');
vm.runInContext("_user = {usuario:'teste'}; _cambio = {USD:5.5};", sandbox);

await testeAsync('com patchFields, manda só os campos alterados + sempre-recalculados (não o processo inteiro)', async () => {
  let corpoEnviado = null;
  sandbox.fetch = (url, opts) => {
    if (String(url).includes('/processo') && !String(url).includes('processos')) {
      corpoEnviado = JSON.parse(opts.body).processo;
    }
    return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
  };
  const proc = {
    id: 'abc-123', referencia: 'UD26-999',
    fase: 'PI', // processo real: _editando sempre já vem com a fase atual carregada do banco
    despachante: 'NOVO DESPACHANTE',           // campo que o usuário editou
    fornecedor: 'FORNECEDOR QUE OUTRO USUARIO ALTEROU DEPOIS QUE ESTA TELA CARREGOU', // NÃO deveria ir
    cliente: 'CLIENTE ANTIGO NO CACHE LOCAL',   // idem — não deveria ir
  };
  await sandbox.salvarProcesso(proc, ['despachante']);
  verdadeiro(corpoEnviado !== null, 'fetch pro endpoint de salvar processo não foi chamado');
  iguais(corpoEnviado.despachante, 'NOVO DESPACHANTE');
  verdadeiro(!('fornecedor' in corpoEnviado), 'fornecedor não foi editado nesta sessão e não deveria estar no payload — isso sobrescreveria a alteração de outro usuário');
  verdadeiro(!('cliente' in corpoEnviado), 'cliente não foi editado nesta sessão e não deveria estar no payload — isso sobrescreveria a alteração de outro usuário');
  verdadeiro('id' in corpoEnviado && 'fase' in corpoEnviado && 'updated_by' in corpoEnviado, 'campos fixos (id/fase/updated_by) sempre devem ir junto');
});

await testeAsync('sem patchFields (chamada antiga), mantém comportamento de sempre — manda o processo inteiro', async () => {
  let corpoEnviado = null;
  sandbox.fetch = (url, opts) => {
    if (String(url).includes('/processo') && !String(url).includes('processos')) {
      corpoEnviado = JSON.parse(opts.body).processo;
    }
    return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
  };
  const proc = { id: 'abc-456', referencia: 'UD26-998', despachante: 'X', fornecedor: 'Y', cliente: 'Z' };
  await sandbox.salvarProcesso(proc);
  verdadeiro('fornecedor' in corpoEnviado && 'cliente' in corpoEnviado, 'sem patchFields deve continuar mandando o objeto inteiro (compatibilidade)');
});

await testeAsync('salvarProcesso: editar um campo não-relacionado (ex: qtd_containers_prevista) NÃO recalcula fase/demurrage de um processo com Presença de Carga represada no banco', async () => {
  // Regressão do bug relatado pela Emanuelly (04/09/2026): processos antigos
  // já tinham data_presenca preenchida no banco (de import) sem nunca terem
  // passado por um save que recalculasse fase/demurrage. Antes deste fix,
  // editar QUALQUER campo (mesmo um sem relação, tipo Qtd. Containers) e
  // salvar fazia a fase "saltar" pra Desembarcado e criava uma demurrage
  // vencida do nada.
  sandbox.fetch = (url, opts) => Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
  const proc = {
    id: 'presenca-represada', referencia: 'PVN2603B-1',
    fase: 'PI', // fase antiga, nunca recalculada
    data_presenca: '2026-07-28', // já passou — se recalculasse, fase iria pra DESEMBARCADO
    free_time: 21,
    qtd_containers_prevista: 3, // único campo que o usuário de fato editou agora
  };
  const proc2 = await sandbox.salvarProcesso(proc, ['qtd_containers_prevista']) && proc;
  iguais(proc.fase, 'PI', 'fase não deveria ter sido recalculada — patch não tocou em nenhum campo-gatilho de fase');
  verdadeiro(proc.demurrage_vencimento === undefined, 'demurrage_vencimento não deveria ter sido calculada — patch não tocou em data_presenca/data_chegada/free_time');
});

await testeAsync('salvarProcesso: editar Presença de Carga recalcula fase/demurrage normalmente (campo-gatilho de fato mudou)', async () => {
  sandbox.fetch = (url, opts) => Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
  const proc = {
    id: 'presenca-editada-agora', referencia: 'PVN2603B-2',
    fase: 'PI',
    data_presenca: '2026-07-28',
    free_time: 21,
  };
  await sandbox.salvarProcesso(proc, ['data_presenca']);
  iguais(proc.fase, 'DESEMBARCADO', 'fase deveria avançar — data_presenca foi o campo de fato editado nesta sessão');
  verdadeiro(!!proc.demurrage_vencimento, 'demurrage_vencimento deveria ter sido calculada — free_time + data_presenca presentes e data_presenca mudou');
});

await testeAsync('salvarProcesso: sem patchFields (chamada antiga/processo novo) continua recalculando tudo, igual sempre', async () => {
  sandbox.fetch = (url, opts) => Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
  const proc = {
    id: 'sem-patch', referencia: 'PVN2603B-3',
    fase: 'PI',
    data_presenca: '2026-07-28',
    free_time: 21,
  };
  await sandbox.salvarProcesso(proc);
  iguais(proc.fase, 'DESEMBARCADO', 'sem patchFields deve manter o comportamento antigo — recalcula tudo sempre');
});

teste('edição rápida inline de 1 campo (data) não vaza outros campos do cache local', () => {
  // Simula o padrão real de inlineEditData: só o campo em questão é
  // conhecido como "alterado agora"; o resto do objeto "proc" pode ser
  // cache desatualizado.
  const proc = { id: 'xyz', etd: '2026-08-01', hbl: 'HBL-VELHO-NO-CACHE' };
  const patchFields = ['etd'];
  const camposFixos = ['id','referencia','fase','demurrage_vencimento','pi_cambio','updated_by','updated_at','created_by','created_at','log'];
  const chaves = [...new Set([...camposFixos, ...patchFields])];
  const payload = {};
  chaves.forEach(k=>{ if(proc[k]!==undefined) payload[k] = proc[k]; });
  verdadeiro('etd' in payload, 'campo editado precisa estar no payload');
  verdadeiro(!('hbl' in payload), 'hbl não foi editado nesta ação e não deveria ir — evita sobrescrever HBL que outro usuário tenha acabado de preencher');
});

// ── 8. TESTES: confirmarCambioComo — comprovante de câmbio marca PI paga ─
// Cobre o fix do bug reportado: confirmar um comprovante de câmbio (Único/
// Entrada/Saldo) atualizava só a taxa de câmbio e nunca tocava em "PI Paga?"
// nem na data de pagamento — o usuário precisava ir lá marcar manualmente.
console.log('\n📋 confirmarCambioComo() — marca PI paga e data de pagamento');

teste('Pagamento Único (forma vazia) define VISTA, marca PI paga e usa data_pagamento do comprovante', () => {
  vm.runInContext("_cambioPendente = {taxa_cambio:5.35, valor_pago:10000, referencia:'UD26-999', data_pagamento:'2026-07-10'};", sandbox);
  sandbox.document.getElementById('f_pi_pagamento').value = '';
  sandbox.document.getElementById('f_pi_pago').value = 'false';
  sandbox.document.getElementById('f_pi_data_entrada').value = '';
  sandbox.confirmarCambioComo('unico');
  iguais(sandbox.document.getElementById('f_pi_pagamento').value, 'VISTA', 'forma de pagamento deveria virar VISTA por padrão');
  iguais(sandbox.document.getElementById('f_pi_pago').value, 'true', 'PI deveria ficar marcada como paga');
  iguais(sandbox.document.getElementById('f_pi_data_entrada').value, '2026-07-10', 'data de pagamento deveria vir do comprovante');
});

teste('Pagamento Único com forma já PRAZO grava a data no Saldo (não na Entrada)', () => {
  vm.runInContext("_cambioPendente = {taxa_cambio:5.40, valor_pago:20000, referencia:'UD26-998', data_pagamento:'2026-07-12'};", sandbox);
  sandbox.document.getElementById('f_pi_pagamento').value = 'PRAZO';
  sandbox.document.getElementById('f_pi_pago').value = 'false';
  sandbox.document.getElementById('f_pi_data_saldo').value = '';
  sandbox.confirmarCambioComo('unico');
  iguais(sandbox.document.getElementById('f_pi_pago').value, 'true', 'PI deveria ficar marcada como paga');
  iguais(sandbox.document.getElementById('f_pi_data_saldo').value, '2026-07-12', 'pagamento único a prazo fecha no Saldo, não na Entrada');
});

teste('Entrada define ENTRADA_SALDO, preenche Data Entrada mas NÃO marca PI como paga (é só parcial)', () => {
  vm.runInContext("_cambioPendente = {taxa_cambio:5.30, valor_pago:5000, referencia:'UD26-997', data_pagamento:'2026-07-05'};", sandbox);
  sandbox.document.getElementById('f_pi_pagamento').value = '';
  sandbox.document.getElementById('f_pi_pago').value = 'false';
  sandbox.document.getElementById('f_pi_data_entrada').value = '';
  sandbox.confirmarCambioComo('entrada');
  iguais(sandbox.document.getElementById('f_pi_pagamento').value, 'ENTRADA_SALDO', 'forma de pagamento deveria virar ENTRADA_SALDO');
  iguais(sandbox.document.getElementById('f_pi_data_entrada').value, '2026-07-05', 'data de pagamento da entrada deveria vir do comprovante');
  iguais(sandbox.document.getElementById('f_pi_pago').value, 'false', 'entrada é só parcial — PI não deveria ficar marcada como paga ainda');
});

teste('Saldo define ENTRADA_SALDO, preenche Data Saldo e marca PI como paga (fecha o pagamento)', () => {
  vm.runInContext("_cambioPendente = {taxa_cambio:5.45, valor_pago:15000, referencia:'UD26-996', data_pagamento:'2026-07-14'};", sandbox);
  sandbox.document.getElementById('f_pi_pagamento').value = 'ENTRADA_SALDO';
  sandbox.document.getElementById('f_pi_pago').value = 'false';
  sandbox.document.getElementById('f_pi_data_saldo').value = '';
  sandbox.confirmarCambioComo('saldo');
  iguais(sandbox.document.getElementById('f_pi_data_saldo').value, '2026-07-14', 'data de pagamento do saldo deveria vir do comprovante');
  iguais(sandbox.document.getElementById('f_pi_pago').value, 'true', 'saldo fecha o pagamento — PI deveria ficar marcada como paga');
});

teste('Pagamento Único grava a taxa em "Câmbio Fechado", SEM sobrescrever "Câmbio na PI" (previsto)', () => {
  vm.runInContext("_cambioPendente = {taxa_cambio:5.60, valor_pago:12000, referencia:'UD26-994', data_pagamento:'2026-07-11'};", sandbox);
  sandbox.document.getElementById('f_pi_pagamento').value = 'VISTA';
  sandbox.document.getElementById('f_pi_cambio').value = '5.10'; // previsão feita na época da PI
  sandbox.document.getElementById('f_pi_cambio_fechado').value = '';
  sandbox.confirmarCambioComo('unico');
  iguais(sandbox.document.getElementById('f_pi_cambio').value, '5.10', 'câmbio previsto (da PI) não deveria ser mexido ao confirmar o pagamento');
  iguais(sandbox.document.getElementById('f_pi_cambio_fechado').value, '5.6000', 'taxa fechada do comprovante deveria ir pro campo separado');
});

teste('Sem data_pagamento no comprovante, usa a data de hoje como aproximação', () => {
  vm.runInContext("_cambioPendente = {taxa_cambio:5.20, valor_pago:8000, referencia:'UD26-995'};", sandbox);
  sandbox.document.getElementById('f_pi_pagamento').value = '';
  sandbox.document.getElementById('f_pi_pago').value = 'false';
  sandbox.document.getElementById('f_pi_data_entrada').value = '';
  sandbox.confirmarCambioComo('unico');
  const hojeStr = new Date().toISOString().slice(0,10);
  iguais(sandbox.document.getElementById('f_pi_data_entrada').value, hojeStr, 'sem data no comprovante, deveria cair pra data de hoje');
});

// ── 8b. TESTES: confirmarCambioParcela / aplicarCambioNaParcelaPendente ─
// Cobre o fix de hoje (task #342): confirmar um comprovante de câmbio numa
// parcela específica (fluxo "Parcelado") só gravava cambio_fechado — Valor
// USD e Data ficavam em branco e o usuário tinha que digitar tudo de novo
// na mão (reclamação da Emanuelly: "só salva o câmbio"). Sem teste
// automatizado essa correção pode "voltar" silenciosamente numa
// refatoração futura sem ninguém notar.
console.log('\n📋 confirmarCambioParcela() / aplicarCambioNaParcelaPendente() — preenche Valor USD e Data');

teste('confirmarCambioParcela preenche Valor USD e Data quando a parcela está vazia', () => {
  vm.runInContext("_parcelas = [{label:'Inicial', valor_usd:'', data_vencimento:'', cambio_fechado:''}];", sandbox);
  vm.runInContext("_cambioPendente = {taxa_cambio:5.30, valor_pago:26500, referencia:'UD26-993', data_pagamento:'2026-07-20'};", sandbox);
  sandbox.confirmarCambioParcela(0);
  const parcela = JSON.parse(vm.runInContext("JSON.stringify(_parcelas[0]);", sandbox));
  iguais(parcela.cambio_fechado, '5.3000', 'câmbio fechado deveria vir do comprovante');
  iguais(parcela.valor_usd, (26500/5.30).toFixed(2), 'Valor USD deveria ser calculado a partir do valor pago / taxa');
  iguais(parcela.data_vencimento, '2026-07-20', 'Data deveria vir do comprovante');
});

teste('confirmarCambioParcela NÃO sobrescreve Valor USD e Data já preenchidos pelo usuário', () => {
  vm.runInContext("_parcelas = [{label:'Final', valor_usd:'1000.00', data_vencimento:'2026-06-01', cambio_fechado:''}];", sandbox);
  vm.runInContext("_cambioPendente = {taxa_cambio:5.30, valor_pago:26500, referencia:'UD26-992', data_pagamento:'2026-07-20'};", sandbox);
  sandbox.confirmarCambioParcela(0);
  const parcela = JSON.parse(vm.runInContext("JSON.stringify(_parcelas[0]);", sandbox));
  iguais(parcela.cambio_fechado, '5.3000', 'câmbio fechado deveria ser gravado normalmente');
  iguais(parcela.valor_usd, '1000.00', 'Valor USD já preenchido pelo usuário não deveria ser sobrescrito');
  iguais(parcela.data_vencimento, '2026-06-01', 'Data já preenchida pelo usuário não deveria ser sobrescrita');
});

teste('confirmarCambioParcela com taxa inválida no comprovante não mexe na parcela', () => {
  vm.runInContext("_parcelas = [{label:'Inicial', valor_usd:'', data_vencimento:'', cambio_fechado:''}];", sandbox);
  vm.runInContext("_cambioPendente = {taxa_cambio:0, valor_pago:1000, referencia:'UD26-991'};", sandbox);
  sandbox.confirmarCambioParcela(0);
  const parcela = JSON.parse(vm.runInContext("JSON.stringify(_parcelas[0]);", sandbox));
  iguais(parcela.cambio_fechado, '', 'sem taxa válida, câmbio fechado não deveria ser gravado');
});

teste('aplicarCambioNaParcelaPendente preenche Valor USD e Data na primeira parcela sem câmbio fechado', () => {
  vm.runInContext("_parcelas = [{label:'Inicial', valor_usd:'', data_vencimento:'', cambio_fechado:'5.1000'}, {label:'Final', valor_usd:'', data_vencimento:'', cambio_fechado:''}];", sandbox);
  vm.runInContext("_cambioPendente = {taxa_cambio:5.45, valor_pago:16350, referencia:'UD26-990', data_pagamento:'2026-07-22'};", sandbox);
  const idx = sandbox.aplicarCambioNaParcelaPendente(5.45);
  iguais(idx, 1, 'deveria escolher a primeira parcela ainda sem câmbio fechado (índice 1)');
  const parcela = JSON.parse(vm.runInContext("JSON.stringify(_parcelas[1]);", sandbox));
  iguais(parcela.cambio_fechado, '5.4500', 'câmbio fechado deveria ser gravado na parcela pendente');
  iguais(parcela.valor_usd, (16350/5.45).toFixed(2), 'Valor USD deveria ser calculado a partir do valor pago / taxa');
  iguais(parcela.data_vencimento, '2026-07-22', 'Data deveria vir do comprovante');
});

teste('aplicarCambioNaParcelaPendente NÃO sobrescreve Valor USD e Data já preenchidos pelo usuário', () => {
  vm.runInContext("_parcelas = [{label:'Inicial', valor_usd:'500.00', data_vencimento:'2026-05-01', cambio_fechado:''}];", sandbox);
  vm.runInContext("_cambioPendente = {taxa_cambio:5.45, valor_pago:16350, referencia:'UD26-989', data_pagamento:'2026-07-22'};", sandbox);
  sandbox.aplicarCambioNaParcelaPendente(5.45);
  const parcela = JSON.parse(vm.runInContext("JSON.stringify(_parcelas[0]);", sandbox));
  iguais(parcela.cambio_fechado, '5.4500', 'câmbio fechado deveria ser gravado normalmente');
  iguais(parcela.valor_usd, '500.00', 'Valor USD já preenchido pelo usuário não deveria ser sobrescrito');
  iguais(parcela.data_vencimento, '2026-05-01', 'Data já preenchida pelo usuário não deveria ser sobrescrita');
});

// ── 9. TESTES: renderControleCambialHtml / renderFluxoCaixaHtml (Dashboard Financeiro v2) ─
console.log('\n📋 Dashboard Financeiro v2 — controle cambial e fluxo de caixa');
teste('Sem pagamentos comparáveis (previsto+fechado), mostra aviso em vez de inventar número', () => {
  const html = sandbox.renderControleCambialHtml([]);
  verdadeiro(html.includes('Ainda não há pagamentos'), 'deveria mostrar o aviso de dado insuficiente');
});
teste('Câmbio fechado MENOR que o previsto -> mensagem de economia', () => {
  const pagamentos = [{ referencia:'UD26-200', processoId:'x1', pago:true, cambioPrevisto:5.50, cambioFechado:5.30, valorUsd:1000 }];
  const html = sandbox.renderControleCambialHtml(pagamentos);
  verdadeiro(html.includes('Você economizou'), 'câmbio fechado mais barato que o previsto deveria ser economia');
  verdadeiro(!html.includes('Você pagou') || !html.includes('a mais no câmbio'));
});
// Texto trocado de "Você perdeu" para "Você pagou X a mais" -- pedido
// Emanuelly 17/09/2026: "a palavra perdeu é ruim, tem como mudar?".
teste('Câmbio fechado MAIOR que o previsto -> mensagem "pagou a mais"', () => {
  const pagamentos = [{ referencia:'UD26-201', processoId:'x2', pago:true, cambioPrevisto:5.00, cambioFechado:5.40, valorUsd:1000 }];
  const html = sandbox.renderControleCambialHtml(pagamentos);
  verdadeiro(html.includes('Você pagou') && html.includes('a mais no câmbio'), 'câmbio fechado mais caro que o previsto deveria mostrar "Você pagou X a mais no câmbio"');
  verdadeiro(!html.includes('Você perdeu'), 'não deveria mais usar a palavra "perdeu"');
});
teste('Pagamento sem câmbio fechado ainda (só previsto) não entra na comparação', () => {
  const pagamentos = [{ referencia:'UD26-202', processoId:'x3', pago:false, cambioPrevisto:5.00, cambioFechado:null, valorUsd:1000 }];
  const html = sandbox.renderControleCambialHtml(pagamentos);
  verdadeiro(html.includes('Ainda não há pagamentos'), 'pagamento não fechado não deveria contar pro comparativo');
});
teste('renderFluxoCaixaHtml roda sem erro e lista os 6 meses', () => {
  const hoje = new Date();
  const vencProximo = new Date(hoje); vencProximo.setDate(hoje.getDate()+5);
  const pagamentos = [{ referencia:'UD26-203', valorUsd:2000, vencimento:vencProximo.toISOString().slice(0,10), pago:false, cambioPrevisto:5.2, cambioFechado:null }];
  const html = sandbox.renderFluxoCaixaHtml(pagamentos);
  verdadeiro(html.includes('Fluxo de Caixa'));
  verdadeiro(html.includes('entradas de clientes ainda não são rastreadas'), 'deveria deixar claro que Entradas não é rastreado ainda');
});

// ── 10. TESTE: ativarTelaFinanceiroExclusiva — tela /financeiro não quebra ─
console.log('\n📋 ativarTelaFinanceiroExclusiva() — tela exclusiva do Dashboard Financeiro');
teste('roda sem lançar erro mesmo com os stubs de DOM mínimos (sem elementos reais)', () => {
  let erro = null;
  try { sandbox.ativarTelaFinanceiroExclusiva(); } catch(e) { erro = e; }
  verdadeiro(erro === null, `não deveria lançar erro, lançou: ${erro && erro.message}`);
});

// ── 11. TESTES: calcularFechamento() / renderFechamentoInfo() — estimado × real ─
console.log('\n📋 Fechamento — estimado (cotação aprovada) × real (NF Entrada/Saída)');
teste('processo sem estimativa_json (criado direto no Controle) não tem comparação', () => {
  const f = sandbox.calcularFechamento({});
  verdadeiro(!f.temEstimativa, 'não deveria ter estimativa');
  verdadeiro(!f.temComparacao, 'sem estimativa não dá pra comparar');
});
teste('com estimativa mas sem NF Saída ainda, mostra estimado mas não fecha comparação', () => {
  const p = { estimativa_json: { custo_total: 239039.83, cenarios: { com_st: { faturamento_total: 363898.12, lucro_bruto: 124858.29, pct_lucro: 34.31 } } } };
  const f = sandbox.calcularFechamento(p);
  verdadeiro(f.temEstimativa, 'deveria ter estimativa');
  verdadeiro(!f.temReal, 'sem NF Saída não tem real ainda');
  verdadeiro(!f.temComparacao);
  aproxIgual(f.lucroEstimado, 124858.29, 0.01, 'lucro estimado vem do lucro_bruto do cenario com ST');
});
teste('com NF Entrada e NF Saída preenchidas, calcula lucro real e compara com o estimado', () => {
  const p = {
    estimativa_json: { custo_total: 239039.83, cenarios: { com_st: { faturamento_total: 363898.12, lucro_bruto: 124858.29, pct_lucro: 34.31 } } },
    nf_entrada_valor: 200000, nf_saida_valor: 360000,
  };
  const f = sandbox.calcularFechamento(p);
  verdadeiro(f.temReal && f.temComparacao);
  iguais(f.lucroReal, 160000);
  const lucroEstimado = 124858.29; // ja liquido, vem do lucro_bruto do cenario
  aproxIgual(f.deltaValor, 160000 - lucroEstimado, 0.01, 'diferença = lucro real - lucro estimado');
  verdadeiro(f.deltaValor > 0, 'nesse caso o real (160k) ficou acima do estimado (~124,9k)');
});
teste('resumo antigo (sem cenarios, só faturamento genérico) ainda funciona', () => {
  const p = { estimativa_json: { custo_total: 1000, faturamento: 1500, lucro_bruto: 500, pct_lucro: 33.33 }, nf_entrada_valor: 900, nf_saida_valor: 1600 };
  const f = sandbox.calcularFechamento(p);
  iguais(f.faturamentoEstimado, 1500);
  iguais(f.lucroEstimado, 500);
  iguais(f.lucroReal, 700);
  aproxIgual(f.deltaValor, 200, 0.01);
});
teste('NF Saída zero/vazia não conta como "real" (evita lucro real = -entrada, sem sentido)', () => {
  const f = sandbox.calcularFechamento({ estimativa_json:{custo_total:100,faturamento:150}, nf_entrada_valor: 80, nf_saida_valor: 0 });
  verdadeiro(!f.temReal);
});
teste('renderFechamentoInfo() sem estimativa mostra aviso, não lança erro', () => {
  const html = sandbox.renderFechamentoInfo({});
  verdadeiro(html.includes('não tem um valor estimado'), 'deveria explicar que não há estimativa vinculada');
});
teste('renderFechamentoInfo() sem estimativa mas com NF Entrada/Saída mostra o resultado real mesmo assim', () => {
  // Processo que nunca passou pela cotação do Calculador (ex: criado direto
  // no Controle), mas já tem NF Entrada e NF Saída lançadas na aba
  // Documentos — antes disso a função nem chegava a olhar pro NF, e a
  // margem desse tipo de processo nunca aparecia em lugar nenhum.
  const p = { nf_entrada_valor: 200000, nf_saida_valor: 260000 };
  const html = sandbox.renderFechamentoInfo(p);
  verdadeiro(!html.includes('não tem um valor estimado'), 'com NF preenchida não deveria cair no aviso genérico de "nada pra mostrar"');
  verdadeiro(html.includes('Lucro Real'), 'deveria calcular e mostrar o lucro real mesmo sem cotação vinculada');
  verdadeiro(html.includes('não passou pela cotação'), 'deveria avisar que não tem estimativa pra comparar, sem bloquear o resultado real');
});
teste('renderFechamentoInfo() com resultado pior que o estimado mostra "a menos" em vermelho', () => {
  // Estimado: lucro ≈124,9k (363.898,12 - 239.039,83). Real bem menor: NF Saída 250k - NF Entrada 220k = 30k.
  const p = {
    estimativa_json: { custo_total: 239039.83, cenarios: { com_st: { faturamento_total: 363898.12, lucro_bruto: 124858.29, pct_lucro: 34.31 } } },
    nf_entrada_valor: 220000, nf_saida_valor: 250000,
  };
  const html = sandbox.renderFechamentoInfo(p);
  verdadeiro(html.includes('a menos que o cotado'), 'lucro real menor deveria mostrar mensagem de "a menos"');
});
teste('renderFechamentoInfo() com resultado melhor que o estimado mostra "a mais" em verde', () => {
  const p = {
    estimativa_json: { custo_total: 239039.83, cenarios: { com_st: { faturamento_total: 363898.12, lucro_bruto: 124858.29, pct_lucro: 34.31 } } },
    nf_entrada_valor: 200000, nf_saida_valor: 360000,
  };
  const html = sandbox.renderFechamentoInfo(p);
  verdadeiro(html.includes('a mais que o cotado'), 'lucro real maior deveria mostrar mensagem de "a mais"');
});

console.log('=== calcularCustoRealTotal() e calcularFechamento() com Custos Reais lancados ==='); teste('calcularCustoRealTotal: sem real_json retorna null', () => { verdadeiro(sandbox.calcularCustoRealTotal({}) === null); }); teste('calcularCustoRealTotal: item legado em USD converte pelo câmbio da PI (sem real_cambio)', () => { const r = sandbox.calcularCustoRealTotal({ real_json: { fob: 10000 }, pi_cambio: 5.0 }); verdadeiro(r !== null); iguais(r.count, 1); aproxIgual(r.total, 50000, 0.01); }); teste('calcularCustoRealTotal: real_cambio tem prioridade sobre pi_cambio', () => { const r = sandbox.calcularCustoRealTotal({ real_json:{fob:1000}, pi_cambio:5.0, real_cambio:5.5 }); aproxIgual(r.total, 5500, 0.01); }); teste('calcularCustoRealTotal: item BRL (ex. imposto II) soma direto sem conversão de câmbio', () => { const r = sandbox.calcularCustoRealTotal({ real_json: { ii: 8000 } }); iguais(r.total, 8000); }); teste('calcularCustoRealTotal: soma múltiplos itens de grupos diferentes (USD convertido + BRL direto)', () => { const r = sandbox.calcularCustoRealTotal({ real_json:{ fob:1000, frete:200, ii:500 }, real_cambio:5 }); iguais(r.count, 3); aproxIgual(r.total, 6500, 0.01); }); teste('calcularCustoRealTotal: formato valor/moeda converte na moeda escolhida, não na padrão do item', () => { const r = sandbox.calcularCustoRealTotal({ real_json: { comissao_br: { valor: 100, moeda: 'USD' } }, real_cambio: 5 }); aproxIgual(r.total, 500, 0.01); }); teste('calcularCustoRealTotal: item detalhado por container soma cada container (moedas podem diferir)', () => { const r = sandbox.calcularCustoRealTotal({ real_json: { siscomex: { porContainer: { CONT1:{valor:100,moeda:'BRL'}, CONT2:{valor:50,moeda:'USD'} } } }, real_cambio: 5 }); aproxIgual(r.total, 350, 0.01); verdadeiro(r.detalhe[0].porContainer === true); }); teste('calcularCustoRealTotal: itens vazios/nulos são ignorados, não zeram o total', () => { const r = sandbox.calcularCustoRealTotal({ real_json: { fob:'', frete:null, ii:300 } }); iguais(r.count, 1); iguais(r.total, 300); }); teste('calcularFechamento: com Custos Reais lançados, usa Custo Real Total em vez de NF Entrada (mais preciso)', () => { const f = sandbox.calcularFechamento({ nf_saida_valor:100000, nf_entrada_valor:60000, real_json:{ fob:5000, ii:10000 }, real_cambio:5 }); verdadeiro(f.custosReais !== null, 'deveria ter custosReais calculado'); iguais(f.custoRealTotal, 35000); iguais(f.lucroReal, 65000, 'lucro real deveria usar Custo Real Total, nao NF Entrada'); }); teste('calcularFechamento: sem nenhum item em Custos Reais, custosReais fica null e usa cálculo antigo', () => { const f = sandbox.calcularFechamento({ nf_saida_valor: 50000, nf_entrada_valor: 30000 }); verdadeiro(f.custosReais === null); iguais(f.lucroReal, 20000); }); teste('calcularFechamento: margemTaxas calcula Cobrado menos Pago quando o campo cobrado também foi lançado', () => { const f = sandbox.calcularFechamento({ real_json: { siscomex: 1000, siscomex_cobrado: 1500 } }); verdadeiro(f.margemTaxas !== null); iguais(f.margemTaxas.custoTotal, 1000); iguais(f.margemTaxas.receitaTotal, 1500); iguais(f.margemTaxas.total, 500); }); teste('renderFechamentoInfo com Custos Reais lançados menciona Custo Real Total e a contagem de itens', () => { const p = { nf_saida_valor: 100000, real_json: { fob: 5000, ii:10000 }, real_cambio: 5 }; const html = sandbox.renderFechamentoInfo(p); verdadeiro(html.includes('Custo Real Total'), 'deveria mostrar a linha de Custo Real Total detalhado'); verdadeiro(html.includes('2 itens lançados'), 'deveria indicar quantos itens foram lançados na aba Custos Reais'); });
teste('calcularVencimentoVenda: sem forma_pagamento definida (venda antiga), retorna null', () => { verdadeiro(sandbox.calcularVencimentoVenda({ cliente:'X' }) === null); });
teste('calcularVencimentoVenda: à vista não tem texto de prazo', () => { const v = sandbox.calcularVencimentoVenda({ forma_pagamento:'avista' }); iguais(v.formaPagamento, 'avista'); verdadeiro(v.texto === null); });
teste('calcularVencimentoVenda: prazo é campo livre (ex: 30/60/90 dias)', () => { const v = sandbox.calcularVencimentoVenda({ forma_pagamento:'prazo', prazo_texto:'30/60/90 dias' }); iguais(v.formaPagamento, 'prazo'); iguais(v.texto, '30/60/90 dias'); });
teste('calcularVencimentoVenda: compat com registro antigo "aprazo" (dias numérico)', () => { const v = sandbox.calcularVencimentoVenda({ forma_pagamento:'aprazo', prazo_dias:'30' }); iguais(v.formaPagamento, 'prazo'); iguais(v.texto, '30 dias'); });
teste('renderFechamentoInfo: mostra o prazo (campo livre) na linha de cada cliente', () => { const p = { nf_saida_valor:100000, produtos_json: JSON.stringify([{descricao:'X',quantidade:10}]), real_json:{fob:5000}, real_cambio:5, vendas_json: JSON.stringify([{ cliente:'CLIENTE A', itens:[{descricao:'X',quantidade:10}], nf_saida_valor:100000, nf_saida_data:'2026-08-01', forma_pagamento:'prazo', prazo_texto:'30/60/90 dias' }]) }; const html = sandbox.renderFechamentoInfo(p); verdadeiro(html.includes('Prazo: 30/60/90 dias'), 'deveria mostrar o texto livre do prazo'); });
teste('calcularJurosVenda: usa o valor próprio da venda quando preenchido', () => { const v = sandbox.calcularJurosVenda({}, { juros_valor: '123.45' }, 2); iguais(v, 123.45); });
teste('calcularJurosVenda: com múltiplas vendas, sem valor próprio não cai no fallback antigo (evita juntar tudo numa só)', () => { const v = sandbox.calcularJurosVenda({ real_json:{ juros_valor: 999 } }, { juros_valor: '' }, 2); iguais(v, 0); });
teste('calcularJurosVenda: com 1 única venda sem valor próprio, cai no campo antigo (real_json.juros_valor) para não quebrar processos já preenchidos', () => { const v = sandbox.calcularJurosVenda({ real_json:{ juros_valor: 999 } }, { juros_valor: '' }, 1); iguais(v, 999); });
teste('renderFechamentoInfo: com múltiplas vendas, cada NF/cliente mostra sua própria Forma de Pagamento e Juros Cobrado', () => {
  const p = {
    nf_saida_valor: 100000,
    produtos_json: JSON.stringify([{descricao:'X',quantidade:20}]),
    real_json: { fob:5000 },
    real_cambio: 5,
    vendas_json: JSON.stringify([
      { cliente:'CLIENTE A', itens:[{descricao:'X',quantidade:10}], nf_saida_valor:50000, nf_saida_data:'2026-08-01', forma_pagamento:'prazo', prazo_texto:'30/60/90 dias', juros_valor: 1000 },
      { cliente:'CLIENTE B', itens:[{descricao:'X',quantidade:10}], nf_saida_valor:50000, nf_saida_data:'2026-08-02', forma_pagamento:'avista', juros_valor: 2000 },
    ]),
  };
  const html = sandbox.renderFechamentoInfo(p);
  verdadeiro(html.includes('Forma de Pagamento — CLIENTE A'), 'deveria rotular a forma de pagamento com o nome do cliente A');
  verdadeiro(html.includes('Forma de Pagamento — CLIENTE B'), 'deveria rotular a forma de pagamento com o nome do cliente B');
  verdadeiro(html.includes('Juros Cobrado do Cliente — CLIENTE A'), 'deveria rotular o juros com o nome do cliente A');
  verdadeiro(html.includes('Juros Cobrado do Cliente — CLIENTE B'), 'deveria rotular o juros com o nome do cliente B');
  verdadeiro(html.includes('1.000,00') || html.includes('1000,00'), 'deveria mostrar o juros do cliente A');
  verdadeiro(html.includes('2.000,00') || html.includes('2000,00'), 'deveria mostrar o juros do cliente B');
});
teste('Reciclagem (Taxas Operacionais): id "reciclagem" soma no Custo Real Total (BRL direto, sem conversão)', () => { const r = sandbox.calcularCustoRealTotal({ real_json: { reciclagem: 2000 } }); iguais(r.total, 2000); });
teste('Reciclagem: não colide com o item "Reciclagem (Fechamento)" do grupo Diferenças de Impostos — ids distintos', () => { const itens = sandbox.custosReaisItensFlat(); const ids = itens.map(it => it.id); const reciclagens = ids.filter(id => id === 'reciclagem' || id === 'reciclagem_fechamento'); iguais(reciclagens.length, 2, 'deveriam existir exatamente 2 itens de reciclagem, com ids diferentes'); verdadeiro(ids.filter(id => id === 'reciclagem').length === 1, 'id "reciclagem" deve aparecer só uma vez (sem duplicidade)'); });

console.log('\n🧾 calcularNotasBoss() / calcularFechamento() com Notas Fiscais BOSS (sub-livro G46-G56 da planilha)');
teste('calcularNotasBoss: sem real_json retorna null', () => { verdadeiro(sandbox.calcularNotasBoss({}) === null); });
teste('calcularNotasBoss: notas_boss_valor ausente/zero retorna null (nao ha nota Boss)', () => { verdadeiro(sandbox.calcularNotasBoss({ real_json:{} }) === null); verdadeiro(sandbox.calcularNotasBoss({ real_json:{ notas_boss_valor: 0 } }) === null); });
teste('calcularNotasBoss: cascata de impostos bate exatamente com a formula da planilha (Boss=100000)', () => {
  const nb = sandbox.calcularNotasBoss({ real_json: { notas_boss_valor: 100000 } });
  verdadeiro(nb !== null);
  iguais(nb.irRetido, 1500); iguais(nb.iss, 2500); iguais(nb.pis, 650); iguais(nb.cofins, 3000);
  iguais(nb.baseImpostosLopes, 32000); iguais(nb.irpj, 6500); iguais(nb.csll, 2880);
  aproxIgual(nb.ibs, 100, 0.001); aproxIgual(nb.cbs, 900, 0.001);
  iguais(nb.totalReceber, 82970, 'Total a Receber = valorBoss - ISS - PIS - COFINS - IRPJ - CSLL - IR (IBS/CBS ficam de fora, igual G56 da planilha)');
});
teste('calcularFechamento: com Notas Boss, soma o Total a Receber ao Lucro Real (G58 = G44 + G56)', () => {
  const f = sandbox.calcularFechamento({ nf_saida_valor: 200000, real_json: { fob: 100000, notas_boss_valor: 100000 }, real_cambio: 1 });
  iguais(f.lucroReal, 182970, 'lucroReal deveria ser (200000-100000) + 82970 de Total a Receber da nota Boss');
  aproxIgual(f.pctLucroReal, 182970/300000, 0.0001, 'percentual deveria usar NF Saida + valor Boss no denominador (igual H58=G58/(G15+G46))');
  verdadeiro(f.notasBoss !== null);
});
teste('calcularFechamento: sem Notas Boss lancada, lucroReal fica 100% inalterado (regressao)', () => {
  const f = sandbox.calcularFechamento({ nf_saida_valor: 200000, real_json: { fob: 100000 }, real_cambio: 1 });
  iguais(f.lucroReal, 100000);
  verdadeiro(f.notasBoss === null);
});
teste('calcularFechamento: Notas Boss tambem soma quando o processo usa Vendas multi-cliente (rateio)', () => {
  const p = {
    real_json: { fob: 40000, notas_boss_valor: 100000 },
    real_cambio: 1,
    vendas_json: JSON.stringify([{ cliente:'A', nf_saida_valor:120000, itens:[{descricao:'pneu', quantidade:10}], custos_diretos:[] }]),
    produtos_json: JSON.stringify([{ descricao:'pneu', quantidade:10 }]),
  };
  const f = sandbox.calcularFechamento(p);
  verdadeiro(f.vendasResumo !== null, 'deveria ter entrado no ramo de vendas multi-cliente');
  iguais(f.lucroReal, (120000-40000)+82970, 'Boss deveria somar em cima do lucro ja calculado por vendas_json');
});
teste('renderFechamentoInfo com Notas Boss lançada mostra o detalhamento e o rótulo "+ Notas Boss"', () => {
  const p = { nf_saida_valor: 200000, real_json: { fob: 100000, notas_boss_valor: 100000 } };
  const html = sandbox.renderFechamentoInfo(p);
  verdadeiro(html.includes('Notas Fiscais BOSS'), 'deveria mostrar o bloco de detalhamento da nota Boss');
  verdadeiro(html.includes('+ Notas Boss'), 'deveria indicar no rótulo do Lucro Real que o valor já inclui a nota Boss');
});

console.log('\n💰 calcularJurosCobrado() / calcularFechamento() com Juros Cobrado do Cliente (G13/G15 da planilha, processo KS260507SMBZIMP)');
teste('calcularJurosCobrado: sem real_json retorna null', () => { verdadeiro(sandbox.calcularJurosCobrado({}) === null); });
teste('calcularJurosCobrado: juros_valor ausente/zero retorna null (nao ha juro cobrado)', () => { verdadeiro(sandbox.calcularJurosCobrado({ real_json:{} }) === null); verdadeiro(sandbox.calcularJurosCobrado({ real_json:{ juros_valor: 0 } }) === null); });
teste('calcularJurosCobrado: com valor lancado, devolve o valor puro (sem impostos proprios - custo entra a parte em diferenca_pis/diferenca_cofins)', () => {
  const j = sandbox.calcularJurosCobrado({ real_json: { juros_valor: 23836.52 } });
  verdadeiro(j !== null);
  iguais(j.valor, 23836.52);
});
teste('calcularFechamento: com Juros Cobrado, soma direto ao Lucro Real (receita adicional a NF Saida)', () => {
  const f = sandbox.calcularFechamento({ nf_saida_valor: 287537.36, real_json: { fob: 100000, juros_valor: 23836.52 }, real_cambio: 1 });
  aproxIgual(f.lucroReal, (287537.36-100000)+23836.52, 0.01, 'lucroReal deveria somar o juro cobrado direto (sem custo proprio aqui)');
  aproxIgual(f.pctLucroReal, f.lucroReal/(287537.36+23836.52), 0.0001, 'percentual deveria usar NF Saida + Juros no denominador (igual G15 da planilha)');
  verdadeiro(f.jurosCobrado !== null);
});
teste('calcularFechamento: sem Juros Cobrado, lucroReal fica 100% inalterado (regressao)', () => {
  const f = sandbox.calcularFechamento({ nf_saida_valor: 200000, real_json: { fob: 100000 }, real_cambio: 1 });
  iguais(f.lucroReal, 100000);
  verdadeiro(f.jurosCobrado === null);
});
teste('calcularFechamento: Juros Cobrado + Notas Boss juntos - Juros entra na receita ANTES do denominador do Boss (igual planilha H58=G58/(G15+G46))', () => {
  const f = sandbox.calcularFechamento({ nf_saida_valor: 200000, real_json: { fob: 100000, juros_valor: 20000, notas_boss_valor: 100000 }, real_cambio: 1 });
  iguais(f.lucroReal, (200000-100000)+20000+82970, 'lucroReal deveria somar Juros E o Total a Receber da nota Boss');
  aproxIgual(f.pctLucroReal, f.lucroReal/(200000+20000+100000), 0.0001, 'denominador deveria ser NF Saida + Juros + valor Boss');
});
teste('renderFechamentoInfo com Juros Cobrado lançado mostra o detalhamento e o rótulo "+ Juros"', () => {
  const p = { nf_saida_valor: 287537.36, real_json: { fob: 100000, juros_valor: 23836.52 } };
  const html = sandbox.renderFechamentoInfo(p);
  verdadeiro(html.includes('Juros Cobrado do Cliente'), 'deveria mostrar a linha de detalhamento do juro cobrado');
  verdadeiro(html.includes('+ Juros'), 'deveria indicar no rótulo do Lucro Real que o valor já inclui o juro cobrado');
});

// ── 12. TESTES: Vendas multi-cliente (rateio de custo) ──────────────
// calcularRateioVenda / calcularVendasResumo / calcularFechamento com
// vendas_json preenchido — ver controle-core.js. Sem nenhuma venda
// cadastrada, tudo isso precisa continuar 100% idêntico ao comportamento
// anterior (coberto pelos testes da seção 11 acima, que não usam vendas_json).
console.log('\n📋 Vendas multi-cliente — parseVendas / calcularRateioVenda / calcularVendasResumo');

teste('parseVendas: sem vendas_json (processo antigo) retorna array vazio, não null/erro', () => {
  const v = sandbox.parseVendas({});
  verdadeiro(Array.isArray(v) && v.length === 0);
});
teste('parseVendas: JSON corrompido retorna array vazio em vez de lançar', () => {
  const v = sandbox.parseVendas({ vendas_json: '{isso não é um array válido' });
  verdadeiro(Array.isArray(v) && v.length === 0);
});
teste('calcularVendasResumo: processo sem vendas retorna null (não quebra nada do fluxo antigo)', () => {
  verdadeiro(sandbox.calcularVendasResumo({ vendas_json: '[]' }) === null);
  verdadeiro(sandbox.calcularVendasResumo({}) === null);
});
teste('calcularFechamento: processo sem vendas continua usando NF Saída única (comportamento antigo intacto)', () => {
  const f = sandbox.calcularFechamento({ nf_saida_valor: 50000, real_json: { fob: 10000 }, real_cambio: 5 });
  verdadeiro(f.vendasResumo === null, 'sem vendas_json, vendasResumo precisa ser null');
  iguais(f.nfSaida, 50000);
});

teste('calcularRateioVenda: rateia o custo real proporcional à quantidade da venda', () => {
  const p = { produtos_json: JSON.stringify([{descricao:'Pneu A', quantidade: 1000}]) };
  const venda = { itens: [{descricao:'Pneu A', quantidade: 250}], custos_diretos: [] };
  const r = sandbox.calcularRateioVenda(p, venda, 40000); // 250/1000 = 25% de 40000 = 10000
  iguais(r.totalQtd, 1000);
  iguais(r.qtdVenda, 250);
  aproxIgual(r.fracao, 0.25, 0.0001);
  aproxIgual(r.custoRateado, 10000, 0.01);
  iguais(r.custoDireto, 0);
  aproxIgual(r.custoTotal, 10000, 0.01);
});
teste('calcularRateioVenda: custo direto soma por fora do rateio, sem entrar na fração', () => {
  const p = { produtos_json: JSON.stringify([{descricao:'Pneu A', quantidade: 1000}]) };
  const venda = { itens: [{descricao:'Pneu A', quantidade: 250}], custos_diretos: [{label:'Frete extra', valor: 500}] };
  const r = sandbox.calcularRateioVenda(p, venda, 40000);
  aproxIgual(r.custoRateado, 10000, 0.01);
  iguais(r.custoDireto, 500);
  aproxIgual(r.custoTotal, 10500, 0.01);
});
teste('calcularRateioVenda: processo sem produtos_json (totalQtd=0) não lança erro nem divide por zero', () => {
  const r = sandbox.calcularRateioVenda({}, { itens: [{descricao:'X', quantidade: 10}], custos_diretos: [] }, 5000);
  iguais(r.totalQtd, 0);
  iguais(r.fracao, 0, 'sem denominador, fração cai pra 0 em vez de Infinity/NaN');
  iguais(r.custoRateado, 0);
});

teste('calcularVendasResumo: split 2 vias — soma das NFs, lucro por venda e lucro total corretos', () => {
  const p = {
    produtos_json: JSON.stringify([{descricao:'Pneu A', quantidade: 1000}]),
    real_json: { fob: 8000 }, real_cambio: 5, // custo real total = 40000
    vendas_json: JSON.stringify([
      { cliente:'Cliente A', itens:[{descricao:'Pneu A', quantidade:600}], nf_saida_valor: 40000, custos_diretos: [] },
      { cliente:'Cliente B', itens:[{descricao:'Pneu A', quantidade:400}], nf_saida_valor: 25000, custos_diretos: [] },
    ]),
  };
  const resumo = sandbox.calcularVendasResumo(p);
  verdadeiro(resumo !== null);
  iguais(resumo.custoRealTotal, 40000);
  iguais(resumo.totalQtd, 1000);
  iguais(resumo.qtdAlocada, 1000);
  iguais(resumo.saldoNaoAlocado, 0);
  const a = resumo.linhas.find(l=>l.venda.cliente==='Cliente A');
  const b = resumo.linhas.find(l=>l.venda.cliente==='Cliente B');
  aproxIgual(a.custoRateado, 24000, 0.01, 'Cliente A levou 60% -> 60% de 40000 = 24000');
  aproxIgual(b.custoRateado, 16000, 0.01, 'Cliente B levou 40% -> 40% de 40000 = 16000');
  aproxIgual(a.lucro, 40000-24000, 0.01);
  aproxIgual(b.lucro, 25000-16000, 0.01);
  verdadeiro(resumo.todasComNf === true);
  aproxIgual(resumo.nfSaidaTotal, 65000, 0.01);
  aproxIgual(resumo.lucroTotal, (40000-24000)+(25000-16000), 0.01);
});

teste('calcularVendasResumo: venda ainda sem NF Saída não trava as outras — lucroTotal fica null até todas terem NF', () => {
  const p = {
    produtos_json: JSON.stringify([{descricao:'Pneu A', quantidade: 1000}]),
    real_json: { fob: 8000 }, real_cambio: 5,
    vendas_json: JSON.stringify([
      { cliente:'Cliente A', itens:[{descricao:'Pneu A', quantidade:600}], nf_saida_valor: 40000, custos_diretos: [] },
      { cliente:'Cliente B', itens:[{descricao:'Pneu A', quantidade:400}], nf_saida_valor: '', custos_diretos: [] },
    ]),
  };
  const resumo = sandbox.calcularVendasResumo(p);
  verdadeiro(resumo.todasComNf === false);
  verdadeiro(resumo.lucroTotal === null, 'sem todas as NFs, não dá pra fechar o lucro total do processo ainda');
  const b = resumo.linhas.find(l=>l.venda.cliente==='Cliente B');
  verdadeiro(b.temNf === false && b.lucro === null);
});

teste('calcularVendasResumo: sobrevenda (soma das quantidades > total do processo) fica visível em saldoNaoAlocado negativo', () => {
  const p = {
    produtos_json: JSON.stringify([{descricao:'Pneu A', quantidade: 1000}]),
    vendas_json: JSON.stringify([
      { cliente:'Cliente A', itens:[{descricao:'Pneu A', quantidade:700}], nf_saida_valor: 10000, custos_diretos: [] },
      { cliente:'Cliente B', itens:[{descricao:'Pneu A', quantidade:500}], nf_saida_valor: 10000, custos_diretos: [] },
    ]),
  };
  const resumo = sandbox.calcularVendasResumo(p);
  iguais(resumo.qtdAlocada, 1200);
  iguais(resumo.saldoNaoAlocado, -200, 'alocou 200 unidades a mais do que o processo tem');
});

teste('calcularVendasResumo: split parcial (nem todo o processo foi vendido ainda) mostra saldoNaoAlocado positivo', () => {
  const p = {
    produtos_json: JSON.stringify([{descricao:'Pneu A', quantidade: 1000}]),
    vendas_json: JSON.stringify([
      { cliente:'Cliente A', itens:[{descricao:'Pneu A', quantidade:300}], nf_saida_valor: '', custos_diretos: [] },
    ]),
  };
  const resumo = sandbox.calcularVendasResumo(p);
  iguais(resumo.saldoNaoAlocado, 700);
});

teste('calcularVendasResumo: split 3 vias com resto — soma dos custos rateados bate EXATAMENTE (até o centavo) com o Custo Real Total', () => {
  // 100000/3 gera dízima (33.333,33...) — sem correção de arredondamento,
  // a soma de 3 valores truncados pode "vazar" ou "faltar" 1-2 centavos.
  const p = {
    produtos_json: JSON.stringify([{descricao:'Pneu A', quantidade: 3}]),
    real_json: { fob: 20000 }, real_cambio: 5, // custo real total = 100000
    vendas_json: JSON.stringify([
      { cliente:'Cliente A', itens:[{descricao:'Pneu A', quantidade:1}], nf_saida_valor: 40000, custos_diretos: [] },
      { cliente:'Cliente B', itens:[{descricao:'Pneu A', quantidade:1}], nf_saida_valor: 40000, custos_diretos: [] },
      { cliente:'Cliente C', itens:[{descricao:'Pneu A', quantidade:1}], nf_saida_valor: 40000, custos_diretos: [] },
    ]),
  };
  const resumo = sandbox.calcularVendasResumo(p);
  const somaCustoRateado = resumo.linhas.reduce((s,l)=> s + Math.round(l.custoRateado*100), 0) / 100;
  iguais(somaCustoRateado, 100000, `soma dos custos rateados (${somaCustoRateado}) deveria bater exatamente com o Custo Real Total (100000) — diferença de arredondamento não pode "sumir" nem "sobrar"`);
});

teste('calcularVendasResumo: com custos diretos, cada venda soma o rateio + seu próprio custo direto (não misturado com o das outras)', () => {
  const p = {
    produtos_json: JSON.stringify([{descricao:'Pneu A', quantidade: 1000}]),
    real_json: { fob: 8000 }, real_cambio: 5, // custo real total = 40000
    vendas_json: JSON.stringify([
      { cliente:'Cliente A', itens:[{descricao:'Pneu A', quantidade:500}], nf_saida_valor: 30000, custos_diretos: [{label:'Frete extra A', valor: 300}] },
      { cliente:'Cliente B', itens:[{descricao:'Pneu A', quantidade:500}], nf_saida_valor: 30000, custos_diretos: [{label:'Frete extra B', valor: 900}] },
    ]),
  };
  const resumo = sandbox.calcularVendasResumo(p);
  const a = resumo.linhas.find(l=>l.venda.cliente==='Cliente A');
  const b = resumo.linhas.find(l=>l.venda.cliente==='Cliente B');
  aproxIgual(a.custoTotal, 20000+300, 0.01);
  aproxIgual(b.custoTotal, 20000+900, 0.01);
  aproxIgual(a.lucro, 30000-20300, 0.01);
  aproxIgual(b.lucro, 30000-20900, 0.01);
});

teste('calcularFechamento: com vendas cadastradas, NF Saída do processo vira a soma das NFs e o Lucro Real vira a soma dos lucros de cada venda', () => {
  const p = {
    produtos_json: JSON.stringify([{descricao:'Pneu A', quantidade: 1000}]),
    real_json: { fob: 8000 }, real_cambio: 5, // custo real total = 40000
    nf_saida_valor: 999999, // valor legado antigo — deve ser IGNORADO quando há vendas cadastradas
    vendas_json: JSON.stringify([
      { cliente:'Cliente A', itens:[{descricao:'Pneu A', quantidade:600}], nf_saida_valor: 40000, custos_diretos: [] },
      { cliente:'Cliente B', itens:[{descricao:'Pneu A', quantidade:400}], nf_saida_valor: 25000, custos_diretos: [] },
    ]),
  };
  const f = sandbox.calcularFechamento(p);
  verdadeiro(f.vendasResumo !== null);
  aproxIgual(f.nfSaida, 65000, 0.01, 'NF Saída do processo deveria ser a soma das NFs das vendas, não o campo legado nf_saida_valor');
  aproxIgual(f.lucroReal, (40000-24000)+(25000-16000), 0.01);
  verdadeiro(f.temReal === true);
});

teste('renderFechamentoInfo: com vendas cadastradas, menciona "Vendido a N clientes" e lista cada um', () => {
  const p = {
    produtos_json: JSON.stringify([{descricao:'Pneu A', quantidade: 1000}]),
    real_json: { fob: 8000 }, real_cambio: 5,
    vendas_json: JSON.stringify([
      { cliente:'Cliente A', itens:[{descricao:'Pneu A', quantidade:600}], nf_saida_valor: 40000, custos_diretos: [] },
      { cliente:'Cliente B', itens:[{descricao:'Pneu A', quantidade:400}], nf_saida_valor: 25000, custos_diretos: [] },
    ]),
  };
  const html = sandbox.renderFechamentoInfo(p);
  verdadeiro(html.includes('2 clientes'), 'deveria mencionar quantos clientes compraram deste processo');
  verdadeiro(html.includes('Cliente A') && html.includes('Cliente B'), 'deveria listar o nome de cada cliente');
  verdadeiro(html.includes('soma das vendas'), 'deveria deixar claro que a NF Saída mostrada é a soma, não um valor único');
});

// 📊 calcularRelatorioNarcelio() — relatório semanal pro Sr. Narcélio
teste('calcularRelatorioNarcelio: conta fábrica/booking (PI), aguardando embarque e embarcados corretamente', () => {
  const hoje = new Date();
  const isoMesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-10`;
  const processos = [
    { fase: 'PI' },
    { fase: 'PI' },
    { fase: 'AGUARDANDO_EMBARQUE' },
    { fase: 'EMBARCADO', data_registro_di: isoMesAtual, containers_json: JSON.stringify([{numero:'CONT001'},{numero:'CONT002'}]) },
    { fase: 'DESEMBARCADO' }, // não deveria contar em nenhum dos 3 grupos
  ];
  const rel = sandbox.calcularRelatorioNarcelio(processos);
  aproxIgual(rel.fabricaBooking, 2, 0, 'deveria contar as 2 fases PI');
  aproxIgual(rel.aguardandoEmbarque, 1, 0);
  aproxIgual(rel.embarcados, 1, 0, 'DESEMBARCADO não é EMBARCADO, não deveria contar');
  aproxIgual(rel.total, 4, 0, 'total = fábrica/booking + aguardando embarque + embarcados');
  aproxIgual(rel.containersMes, 2, 0, 'containers do processo com Data Registro DI neste mês');
});

teste('calcularRelatorioNarcelio: exclui processos cancelados da contagem', () => {
  const processos = [
    { fase: 'PI' },
    { fase: 'PI', cancelado: true },
  ];
  const rel = sandbox.calcularRelatorioNarcelio(processos);
  aproxIgual(rel.fabricaBooking, 1, 0, 'processo cancelado não deveria contar');
});

teste('normalizarPortoDestino: reconhece variação por substring (ex: "NAVEGANTES, BRAZIL")', () => {
  iguais(sandbox.normalizarPortoDestino('NAVEGANTES, BRAZIL'), 'NVT');
  iguais(sandbox.normalizarPortoDestino('PORTO DE ITAJAÍ'), 'ITJ');
  iguais(sandbox.normalizarPortoDestino('ITJ'), 'ITJ', 'código já normalizado permanece igual');
});

teste('formatarPortoDestino: sempre devolve o nome completo do porto, não o código nem texto cru', () => {
  iguais(sandbox.formatarPortoDestino('ITJ'), 'Itajaí');
  iguais(sandbox.formatarPortoDestino('NVT'), 'Navegantes');
  iguais(sandbox.formatarPortoDestino('NAVEGANTES, BRAZIL'), 'Navegantes');
  iguais(sandbox.formatarPortoDestino(''), 'N/I');
  iguais(sandbox.formatarPortoDestino(null), 'N/I');
});

teste('idsNotificacoesResolvidas: mantém só as notificações cujo título ainda está ativo, apaga o resto', () => {
  const notifs = [
    { id: 1, titulo: 'Embarque esta semana sem documentos: UD26-001' },
    { id: 2, titulo: 'Demurrage: UD26-001' },
    { id: 3, titulo: 'Pendência pós-embarque: UD26-001' },
  ];
  // Só o alerta de Demurrage continua ativo agora (docs foram anexados,
  // HBL/LI aprovados) — os outros dois devem ser marcados pra apagar.
  const ativos = ['Demurrage: UD26-001'];
  const ids = sandbox.idsNotificacoesResolvidas(notifs, ativos);
  iguais(ids.length, 2, 'deve marcar 2 notificações pra apagar');
  iguais(ids.includes(1), true, 'notificação de docs (resolvida) deve estar na lista de apagar');
  iguais(ids.includes(3), true, 'notificação de pendência pós-embarque (resolvida) deve estar na lista de apagar');
  iguais(ids.includes(2), false, 'notificação de Demurrage (ainda ativa) NÃO deve ser apagada');
});

teste('idsNotificacoesResolvidas: processo finalizado sem alertas ativos -> apaga todas as notificações antigas dele', () => {
  const notifs = [
    { id: 10, titulo: 'Embarque esta semana sem documentos: UD26-050' },
  ];
  const ids = sandbox.idsNotificacoesResolvidas(notifs, []);
  iguais(ids.length, 1);
  iguais(ids[0], 10);
});

teste('idsNotificacoesResolvidas: sem notificações existentes -> não quebra, devolve lista vazia', () => {
  const ids = sandbox.idsNotificacoesResolvidas([], ['Demurrage: UD26-001']);
  iguais(ids.length, 0);
});

teste('verificarAlertas: processo embarcado sem HBL/LI aprovado gera alerta de pendência pós-embarque', () => {
  const p = { id:'x1', referencia:'UD26-999', fase:'DESEMBARCADO', data_embarque:'2026-08-01', aprovacao_hbl:null, solicitacao_li:null };
  const alertas = sandbox.verificarAlertas(p, false);
  const temPendencia = alertas.some(a => a.titulo.startsWith('Pendência pós-embarque'));
  iguais(temPendencia, true, 'processo em andamento sem HBL/LI deveria alertar');
});

teste('verificarAlertas: processo FINALIZADO não gera mais o alerta de HBL/LI mesmo com os campos vazios (pedido Emanuelly 09/09/2026)', () => {
  const p = { id:'x2', referencia:'UD26-998', fase:'FINALIZADO', data_embarque:'2026-06-01', aprovacao_hbl:null, solicitacao_li:null, pi_valor_usd:1000 };
  const alertas = sandbox.verificarAlertas(p, false);
  const temPendencia = alertas.some(a => a.titulo.startsWith('Pendência pós-embarque'));
  iguais(temPendencia, false, 'processo finalizado não deve mais alertar HBL/LI pendente');
});

// ── Etiquetas + "enviar docs à despachante" (pedido Ayslan 17/09/2026,
// substituindo as cores manuais da planilha da Paula) ──────────────────

teste('verificarAlertas: HBL aprovado sem docs enviados à despachante gera alerta MESMO antes do embarque', () => {
  const p = { id:'x3', referencia:'UD26-997', fase:'AGUARDANDO_EMBARQUE', data_embarque:null, aprovacao_hbl:'Sim', solicitacao_li:null, docs_enviados_despachante:null };
  const alertas = sandbox.verificarAlertas(p, false);
  const tem = alertas.some(a => a.titulo.startsWith('Enviar docs à despachante'));
  iguais(tem, true, 'HBL=Sim sem docs enviados deveria alertar pra mandar pra Amanda, mesmo sem embarque ainda');
});

teste('verificarAlertas: docs já enviados à despachante -> não repete o alerta', () => {
  const p = { id:'x4', referencia:'UD26-996', fase:'AGUARDANDO_EMBARQUE', data_embarque:null, aprovacao_hbl:'Sim', solicitacao_li:null, docs_enviados_despachante:'2026-09-10' };
  const alertas = sandbox.verificarAlertas(p, false);
  const tem = alertas.some(a => a.titulo.startsWith('Enviar docs à despachante'));
  iguais(tem, false, 'já marcou que enviou os docs -- não deveria mais alertar');
});

teste('verificarAlertas: LI já solicitada -> não precisa mais alertar pra enviar docs', () => {
  const p = { id:'x5', referencia:'UD26-995', fase:'AGUARDANDO_EMBARQUE', data_embarque:null, aprovacao_hbl:'Sim', solicitacao_li:'Sim', docs_enviados_despachante:null };
  const alertas = sandbox.verificarAlertas(p, false);
  const tem = alertas.some(a => a.titulo.startsWith('Enviar docs à despachante'));
  iguais(tem, false, 'LI já solicitada -- o passo intermediário já foi superado');
});

teste('etiquetasDoProcesso: HBL aprovado sem docs enviados -> badge "Enviar docs à despachante"', () => {
  const p = { id:'x6', referencia:'UD26-994', fase:'AGUARDANDO_EMBARQUE', aprovacao_hbl:'Sim', solicitacao_li:null, docs_enviados_despachante:null };
  const etiquetas = sandbox.etiquetasDoProcesso(p);
  iguais(etiquetas.some(e => e.id === 'ENVIAR_DESPACHANTE'), true);
});

teste('etiquetasDoProcesso: pronto na fábrica sem semana de booking -> badge "Pronto sem semana de booking"', () => {
  const p = { id:'x7', referencia:'UD26-993', fase:'FABRICA', data_prontidao:'2026-09-10', semana_booking:null, data_embarque:null };
  const etiquetas = sandbox.etiquetasDoProcesso(p);
  iguais(etiquetas.some(e => e.id === 'PRONTO_SEM_BOOKING'), true);
});

teste('etiquetasDoProcesso: pronto MAS já tem semana de booking -> sem essa badge', () => {
  const p = { id:'x8', referencia:'UD26-992', fase:'FABRICA', data_prontidao:'2026-09-10', semana_booking:41, data_embarque:null };
  const etiquetas = sandbox.etiquetasDoProcesso(p);
  iguais(etiquetas.some(e => e.id === 'PRONTO_SEM_BOOKING'), false);
});

teste('etiquetasDoProcesso: etiqueta manual "outro agente de carga" aparece quando marcada', () => {
  const p = { id:'x9', referencia:'UD26-991', fase:'FABRICA', etiquetas_manuais_json: JSON.stringify(['OUTRO_AGENTE_CARGA']) };
  const etiquetas = sandbox.etiquetasDoProcesso(p);
  iguais(etiquetas.some(e => e.id === 'OUTRO_AGENTE_CARGA'), true);
});

teste('etiquetasDoProcesso: processo FINALIZADO ou cancelado nunca tem etiquetas operacionais', () => {
  const p1 = { id:'x10', referencia:'UD26-990', fase:'FINALIZADO', aprovacao_hbl:'Sim', solicitacao_li:null, docs_enviados_despachante:null };
  const p2 = { id:'x11', referencia:'UD26-989', fase:'FABRICA', cancelado:true, data_prontidao:'2026-09-10', semana_booking:null };
  iguais(sandbox.etiquetasDoProcesso(p1).length, 0, 'finalizado não precisa mais de etiqueta operacional');
  iguais(sandbox.etiquetasDoProcesso(p2).length, 0, 'cancelado não precisa mais de etiqueta operacional');
});

teste('COLUNAS_TABELA / valoresDaColuna: coluna Etiquetas (multiplo) devolve array com todas as etiquetas do processo', () => {
  // COLUNAS_TABELA é `const` no top-level do módulo -- não vira propriedade
  // de sandbox (mesmo motivo de _processos/_filProcessoAvancado, ver
  // comentário acima) -- roda dentro da própria vm.context em vez de
  // acessar de fora.
  vm.runInContext(`_pTesteEtiquetas = { id:'x12', referencia:'UD26-988', fase:'FABRICA', aprovacao_hbl:'Sim', solicitacao_li:null, docs_enviados_despachante:null,
    data_prontidao:'2026-09-10', semana_booking:null, data_embarque:null,
    etiquetas_manuais_json: JSON.stringify(['OUTRO_AGENTE_CARGA']) };`, sandbox);
  const defExiste = vm.runInContext(`!!COLUNAS_TABELA.find(c => c.campo === 'etiquetas')`, sandbox);
  iguais(defExiste, true, 'coluna etiquetas deveria existir em COLUNAS_TABELA');
  const ehMultiplo = vm.runInContext(`!!COLUNAS_TABELA.find(c => c.campo === 'etiquetas').multiplo`, sandbox);
  iguais(ehMultiplo, true, 'coluna etiquetas deveria ser multiplo:true');
  const nValores = vm.runInContext(`valoresDaColuna(COLUNAS_TABELA.find(c => c.campo === 'etiquetas'), _pTesteEtiquetas).length`, sandbox);
  iguais(nValores, 3, 'deveria ter 3 etiquetas simultâneas: despachante + sem booking + outro agente');
});

teste('COLUNAS_TABELA: coluna Semana Booking agrupa e ordena numericamente (não alfabeticamente)', () => {
  const defExiste = vm.runInContext(`!!COLUNAS_TABELA.find(c => c.campo === 'semana_booking')`, sandbox);
  iguais(defExiste, true, 'coluna semana_booking deveria existir em COLUNAS_TABELA');
  const agrupavel = vm.runInContext(`COLUNAS_TABELA.find(c => c.campo === 'semana_booking').agrupavel`, sandbox);
  iguais(agrupavel, true, 'semana_booking deveria ser agrupável (view "Programação Semanal")');
  iguais(vm.runInContext(`COLUNAS_TABELA.find(c => c.campo === 'semana_booking').valor({semana_booking:7})`, sandbox), 'Semana 07');
  iguais(vm.runInContext(`COLUNAS_TABELA.find(c => c.campo === 'semana_booking').valor({semana_booking:41})`, sandbox), 'Semana 41');
  iguais(vm.runInContext(`COLUNAS_TABELA.find(c => c.campo === 'semana_booking').valor({})`, sandbox), 'Sem semana definida');
});

// ── TESTES: renderDashAnalises() — Fase 3 (Análises/BI, 10/09/2026) ─
// Reaproveita o MESMO motor de filtro genérico já testado acima (Fase 1/2)
// — não retesta avaliarCondicaoFiltro/aplicarFiltrosGenericos de novo,
// só confirma que a tela nova monta o HTML esperado (KPIs, série mensal,
// rankings) a partir de _processos, sem lançar erro nos stubs de DOM.
function setEstadoAnalises(processos, filAnalises){
  vm.runInContext(
    `_processos = ${JSON.stringify(processos)}; _filAnalises = ${JSON.stringify(filAnalises)};`,
    sandbox
  );
}

teste('renderDashAnalises: roda sem lançar erro e monta KPIs/série/rankings a partir de _processos', () => {
  const hoje = new Date().toISOString().slice(0,10);
  setEstadoAnalises([
    { id:'p1', cliente:'Cliente A', fornecedor:'Forn X', brand:'Marca X', nf_saida_data:hoje, nf_saida_valor:100000, nf_entrada_valor:60000 }, // lucro 40000
    { id:'p2', cliente:'Cliente B', fornecedor:'Forn Y', brand:'Marca Y', nf_saida_data:hoje, nf_saida_valor:50000,  nf_entrada_valor:70000 }, // lucro -20000
  ], { janelaMeses:12, cliente:'', condicoes:[], ordenarCampo:'lucroReal', ordenarDir:'desc' });
  sandbox.renderDashAnalises();
  const html = sandbox.document.getElementById('dash-analises-content').innerHTML;
  verdadeiro(html.includes('Lucro Real (janela)'), 'deveria mostrar o KPI de Lucro Real da janela');
  verdadeiro(html.includes('Evolução mensal'), 'deveria mostrar a série temporal mensal');
  verdadeiro(html.includes('Cliente A'), 'Cliente A (melhor lucro) deveria aparecer no ranking');
  verdadeiro(html.includes('Cliente B'), 'Cliente B (pior lucro) deveria aparecer no ranking');
  verdadeiro(html.includes('Cruzamento Cliente'), 'deveria mostrar a tabela de cruzamento Cliente × Fornecedor');
});

teste('renderDashAnalises: filtro avançado combinável (mesmo motor genérico da Fase 1/2) reduz os rankings corretamente', () => {
  const hoje = new Date().toISOString().slice(0,10);
  setEstadoAnalises([
    { id:'p1', cliente:'Cliente A', fornecedor:'Forn X', nf_saida_data:hoje, nf_saida_valor:100000, nf_entrada_valor:60000 }, // margem 40%
    { id:'p2', cliente:'Cliente B', fornecedor:'Forn Y', nf_saida_data:hoje, nf_saida_valor:50000,  nf_entrada_valor:45000 }, // margem 10%
  ], { janelaMeses:12, cliente:'', condicoes:[ { campo:'margemReal', operador:'gte', valor:'30', valor2:'' } ], ordenarCampo:'lucroReal', ordenarDir:'desc' });
  sandbox.renderDashAnalises();
  const html = sandbox.document.getElementById('dash-analises-content').innerHTML;
  verdadeiro(html.includes('Cliente A'), 'Cliente A (margem 40%) deveria passar no filtro >=30%');
  // Cliente B ainda aparece no <select> de cliente (lista sempre todos os clientes de _processos,
  // não só os filtrados) — então checamos a ausência dele na seção de RANKING, não no HTML inteiro.
  const iniRanking = html.indexOf('Cruzamento Cliente');
  const secaoRankings = html.slice(0, iniRanking);
  const rankingSemSelect = secaoRankings.slice(secaoRankings.indexOf('</select>'));
  verdadeiro(!rankingSemSelect.includes('Cliente B'), 'Cliente B (margem 10%) deveria ter sido filtrado fora dos rankings');
});

teste('renderDashAnalises: limpar o estado de volta (não deixar resíduo pros demais testes do arquivo)', () => {
  setEstadoAnalises([], { janelaMeses:12, cliente:'', condicoes:[], ordenarCampo:'lucroReal', ordenarDir:'desc' });
  sandbox.renderDashAnalises();
  const html = sandbox.document.getElementById('dash-analises-content').innerHTML;
  verdadeiro(html.includes('Nenhum processo faturado na janela selecionada'), 'sem processos, deveria mostrar o aviso de janela vazia');
});

// ── TESTES: sincronizarDemurrageAgregado() — bug OID2602-02 (10/09/2026) ─
// A Emanuelly/Ayslan reportaram que um processo com 2 containers, ambos
// já com Data Devolução preenchida mas o RIC ainda em "Termo" (lavagem
// pendente de pagar), continuava mostrando "Atenção: vence em Xd" no
// card de Cálculo do Demurrage — como se o container ainda estivesse
// retido no porto. Causa: o campo agregado f_data_devolucao_vazio só era
// preenchido quando TODOS os containers estavam "resolvidos" (devolvidos
// E isentos/lavagem paga), então devolução sozinha não bastava. Corrigido
// pra separar "devolvido" de "resolvido pra Finalizado".
function setContainersDemurrage(containers){
  vm.runInContext(`_containers = ${JSON.stringify(containers)};`, sandbox);
}

teste('sincronizarDemurrageAgregado: todos devolvidos mas RIC pendente (Termo, sem lavagem paga) -> data_devolucao_vazio agregado É preenchida', () => {
  setContainersDemurrage([
    { numero:'PCIU8714241', devolucao:'2026-09-08', ric_status:'Termo', data_pagamento_lavagem:'' },
    { numero:'PCIU8871507', devolucao:'2026-09-08', ric_status:'Termo', data_pagamento_lavagem:'' },
  ]);
  sandbox.sincronizarDemurrageAgregado();
  iguais(sandbox.document.getElementById('f_data_devolucao_vazio').value, '2026-09-08');
});

teste('sincronizarDemurrageAgregado: RIC pendente -> f_ric_status agregado continua vazio (Finalizado não deve liberar sem RIC/lavagem)', () => {
  setContainersDemurrage([
    { numero:'PCIU8714241', devolucao:'2026-09-08', ric_status:'Termo', data_pagamento_lavagem:'' },
    { numero:'PCIU8871507', devolucao:'2026-09-08', ric_status:'Termo', data_pagamento_lavagem:'' },
  ]);
  sandbox.sincronizarDemurrageAgregado();
  iguais(sandbox.document.getElementById('f_ric_status').value, '', 'sem Isento/lavagem, o agregado de RIC não deve fechar como resolvido');
});

teste('sincronizarDemurrageAgregado: 1 container ainda sem devolução -> data_devolucao_vazio agregado fica vazia', () => {
  setContainersDemurrage([
    { numero:'PCIU8714241', devolucao:'2026-09-08', ric_status:'Termo', data_pagamento_lavagem:'' },
    { numero:'PCIU8871507', devolucao:'', ric_status:'', data_pagamento_lavagem:'' },
  ]);
  sandbox.sincronizarDemurrageAgregado();
  iguais(sandbox.document.getElementById('f_data_devolucao_vazio').value, '', 'com 1 container ainda não devolvido, não deve marcar o processo como devolvido');
});

teste('sincronizarDemurrageAgregado: todos devolvidos E isentos de RIC -> f_ric_status agregado fecha como Isento (Finalizado libera)', () => {
  setContainersDemurrage([
    { numero:'PCIU8714241', devolucao:'2026-09-08', ric_status:'Isento', data_pagamento_lavagem:'' },
    { numero:'PCIU8871507', devolucao:'2026-09-08', ric_status:'Isento', data_pagamento_lavagem:'' },
  ]);
  sandbox.sincronizarDemurrageAgregado();
  iguais(sandbox.document.getElementById('f_data_devolucao_vazio').value, '2026-09-08');
  iguais(sandbox.document.getElementById('f_ric_status').value, 'Isento');
});

teste('sincronizarDemurrageAgregado: limpar o estado de volta (não deixar resíduo pros demais testes do arquivo)', () => {
  setContainersDemurrage([]);
});

// _processos é declarada com "let" no topo de controle-core.js — binding
// léxica de módulo. Pra alterá-la de fora é preciso rodar código NA MESMA
// vm.context (compartilhada entre execuções), não só sandbox.window.
function setEstadoProcessos(processos){
  vm.runInContext(`_processos = ${JSON.stringify(processos)};`, sandbox);
}

// ── TESTES: montarDREConsolidado() — DRE Consolidado (11/09/2026) ─
// Pedido do Ayslan: "fizemos um DRE por processo. tem como fazermos um
// DRE consolidado por semana, mes, ano... por cliente e alguns outros
// filtros?". Reusa montarDRE() por processo (já teria seus próprios bugs
// pegos pelos outros testes de calcularVendasResumo/calcularFechamento
// acima) — aqui testamos especificamente a SOMA: período por Data NF de
// Saída, filtro de cliente isolando só a venda certa (rateio por fração),
// e fluxo legado (sem vendas_json).

teste('montarDREConsolidado: processo legado (sem vendas_json) dentro do período entra inteiro (fração 1)', () => {
  setEstadoProcessos([
    { id:'p1', referencia:'UD1', cliente:'Cliente Único', fornecedor:'FornA', brand:'MarcaA',
      real_json:{ fob: 8000 }, real_cambio: 5, // custo real total = 40000
      nf_saida_data:'2026-09-15', nf_saida_valor: 60000 },
  ], []);
  const dre = sandbox.montarDREConsolidado({
    periodoIni: new Date('2026-09-01T00:00:00'), periodoFim: new Date('2026-09-30T23:59:59'),
  });
  verdadeiro(dre !== null, 'deveria encontrar o processo dentro do período');
  iguais(dre.nfSaidaValor, 60000);
  aproxIgual(dre.totalCustos, 40000, 0.01);
  aproxIgual(dre.lucroBrutoImpak, 20000, 0.01);
  iguais(dre._meta.qtdProcessos, 1);
});

teste('montarDREConsolidado: processo fora do período (Data NF de Saída) não entra na soma', () => {
  setEstadoProcessos([
    { id:'p2', referencia:'UD2', cliente:'Cliente X', real_json:{ fob: 1000 }, real_cambio: 5,
      nf_saida_data:'2026-05-10', nf_saida_valor: 10000 },
  ], []);
  const dre = sandbox.montarDREConsolidado({
    periodoIni: new Date('2026-09-01T00:00:00'), periodoFim: new Date('2026-09-30T23:59:59'),
  });
  iguais(dre, null, 'processo com NF de Saída em maio não deveria aparecer num período de setembro');
});

teste('montarDREConsolidado: filtro de cliente isola só a venda daquele cliente (rateio por fração, não o processo inteiro)', () => {
  setEstadoProcessos([
    { id:'p3', referencia:'UD3', fornecedor:'FornB',
      produtos_json: JSON.stringify([{descricao:'Pneu A', quantidade: 1000}]),
      real_json:{ fob: 8000 }, real_cambio: 5, // custo real total = 40000
      vendas_json: JSON.stringify([
        { cliente:'Cliente A', itens:[{descricao:'Pneu A', quantidade:600}], nf_saida_valor: 40000, nf_saida_data:'2026-09-10', custos_diretos: [] },
        { cliente:'Cliente B', itens:[{descricao:'Pneu A', quantidade:400}], nf_saida_valor: 25000, nf_saida_data:'2026-09-12', custos_diretos: [] },
      ]) },
  ], []);
  const dreA = sandbox.montarDREConsolidado({
    periodoIni: new Date('2026-09-01T00:00:00'), periodoFim: new Date('2026-09-30T23:59:59'),
    cliente: 'Cliente A',
  });
  verdadeiro(dreA !== null);
  iguais(dreA.nfSaidaValor, 40000, 'só a NF do Cliente A deveria entrar');
  aproxIgual(dreA.totalCustos, 24000, 0.01, 'Cliente A levou 60% do processo -> 60% de 40000 = 24000 (mesmo rateio de calcularVendasResumo)');
  aproxIgual(dreA.lucroBrutoImpak, 40000-24000, 0.01);

  const dreTodos = sandbox.montarDREConsolidado({
    periodoIni: new Date('2026-09-01T00:00:00'), periodoFim: new Date('2026-09-30T23:59:59'),
  });
  iguais(dreTodos.nfSaidaValor, 65000, 'sem filtro de cliente, soma as 2 vendas');
  aproxIgual(dreTodos.totalCustos, 40000, 0.01, 'sem filtro, as 2 frações somam 100% do custo real (sem duplicar)');
});

teste('montarDREConsolidado: filtro de fornecedor exclui processos de outro fornecedor', () => {
  setEstadoProcessos([
    { id:'p4', referencia:'UD4', cliente:'C1', fornecedor:'Fornecedor Certo',
      real_json:{ fob: 1000 }, real_cambio: 5, nf_saida_data:'2026-09-05', nf_saida_valor: 10000 },
    { id:'p5', referencia:'UD5', cliente:'C1', fornecedor:'Outro Fornecedor',
      real_json:{ fob: 1000 }, real_cambio: 5, nf_saida_data:'2026-09-06', nf_saida_valor: 10000 },
  ], []);
  const dre = sandbox.montarDREConsolidado({
    periodoIni: new Date('2026-09-01T00:00:00'), periodoFim: new Date('2026-09-30T23:59:59'),
    fornecedor: 'Fornecedor Certo',
  });
  iguais(dre._meta.qtdProcessos, 1);
  iguais(dre._meta.referencias[0], 'UD4');
});

teste('montarDREConsolidado: processo cancelado nunca entra na soma, mesmo com NF de Saída no período', () => {
  setEstadoProcessos([
    { id:'p6', referencia:'UD6', cliente:'C1', cancelado:true,
      real_json:{ fob: 1000 }, real_cambio: 5, nf_saida_data:'2026-09-05', nf_saida_valor: 10000 },
  ], []);
  const dre = sandbox.montarDREConsolidado({
    periodoIni: new Date('2026-09-01T00:00:00'), periodoFim: new Date('2026-09-30T23:59:59'),
  });
  iguais(dre, null, 'processo cancelado não deveria aparecer no DRE consolidado');
});

// ── atualizarDataPagamentoPrazo: prazo só conta a partir da Data de
// Embarque Efetiva (pedido Paula/Ayslan 17/09/2026, revisando a regra
// #413 -- não pode mais cair de volta pra Data PI) ─────────────────────

function setCampoModalPrazo({pagamento, dataPi, dataEmbarque, prazoDias, dataSaldoInicial}){
  vm.runInContext(`
    document.getElementById('f_pi_pagamento').value = ${JSON.stringify(pagamento||'')};
    document.getElementById('f_pi_data').value = ${JSON.stringify(dataPi||'')};
    document.getElementById('f_data_embarque').value = ${JSON.stringify(dataEmbarque||'')};
    document.getElementById('f_pi_prazo_dias').value = ${JSON.stringify(prazoDias!=null?String(prazoDias):'')};
    document.getElementById('f_pi_data_saldo').value = ${JSON.stringify(dataSaldoInicial||'')};
    document.getElementById('f_pi_valor_usd').value = '1000';
    _editando = { pi_pagamento: ${JSON.stringify(pagamento||'')} };
  `, sandbox);
}

teste('atualizarDataPagamentoPrazo: SEM Data de Embarque -- não cai mais pra Data PI, limpa o campo', () => {
  setCampoModalPrazo({ pagamento:'PRAZO', dataPi:'2026-07-22', dataEmbarque:'', prazoDias:60, dataSaldoInicial:'' });
  sandbox.atualizarDataPagamentoPrazo();
  const saldo = vm.runInContext(`document.getElementById('f_pi_data_saldo').value`, sandbox);
  iguais(saldo, '', 'sem embarque ainda -- não deveria inventar uma Data Pagamento a partir da Data PI');
});

teste('atualizarDataPagamentoPrazo: COM Data de Embarque -- calcula Data PI + prazo a partir do embarque', () => {
  setCampoModalPrazo({ pagamento:'PRAZO', dataPi:'2026-07-22', dataEmbarque:'2026-08-10', prazoDias:60, dataSaldoInicial:'' });
  sandbox.atualizarDataPagamentoPrazo();
  const saldo = vm.runInContext(`document.getElementById('f_pi_data_saldo').value`, sandbox);
  iguais(saldo, '2026-10-09', '60 dias a partir do embarque (10/08), não da Data PI (22/07)');
});

teste('atualizarDataPagamentoPrazo: embarque preenchido depois -- recalcula e sobrescreve o "sem vencimento" anterior', () => {
  setCampoModalPrazo({ pagamento:'PRAZO', dataPi:'2026-07-22', dataEmbarque:'', prazoDias:60, dataSaldoInicial:'' });
  sandbox.atualizarDataPagamentoPrazo();
  iguais(vm.runInContext(`document.getElementById('f_pi_data_saldo').value`, sandbox), '');
  vm.runInContext(`document.getElementById('f_data_embarque').value = '2026-08-10';`, sandbox);
  sandbox.atualizarDataPagamentoPrazo();
  iguais(vm.runInContext(`document.getElementById('f_pi_data_saldo').value`, sandbox), '2026-10-09');
});

teste('atualizarDataPagamentoPrazo: embarque preenchido mas SEM prazo (dias) definido -- também limpa, não calcula parcial', () => {
  setCampoModalPrazo({ pagamento:'PRAZO', dataPi:'2026-07-22', dataEmbarque:'2026-08-10', prazoDias:null, dataSaldoInicial:'2026-10-09' });
  sandbox.atualizarDataPagamentoPrazo();
  const saldo = vm.runInContext(`document.getElementById('f_pi_data_saldo').value`, sandbox);
  iguais(saldo, '', 'sem Prazo (dias) preenchido não dá pra calcular nada, mesmo com embarque OK');
});

teste('atualizarDataPagamentoPrazo: forma de pagamento diferente de PRAZO -- não mexe no campo', () => {
  setCampoModalPrazo({ pagamento:'VISTA', dataPi:'2026-07-22', dataEmbarque:'', prazoDias:60, dataSaldoInicial:'2026-01-01' });
  sandbox.atualizarDataPagamentoPrazo();
  const saldo = vm.runInContext(`document.getElementById('f_pi_data_saldo').value`, sandbox);
  iguais(saldo, '2026-01-01', 'forma de pagamento não é PRAZO -- função não deveria alterar nada');
});

// ── atualizarVencimentoSaldoPorETA: vencimento do saldo = ETA Previsto -
// 10 dias, pra 100% a Prazo e pra parcela Final do Parcelado (pedido do
// Ayslan, 17/09/2026: "sempre que o processo for 100% a prazo ou
// Parcelado (parcela final), deve ter a regra de preencher o saldo a
// pagar 10 dias antes do ETA (Previsto) ... assim ele lança
// automaticamente os câmbios futuro"). Fill-if-empty: nunca sobrescreve
// data já digitada nem parcela com câmbio já fechado. ────────────────

teste('atualizarVencimentoSaldoPorETA: PRAZO com Data Pagamento vazia -- preenche com ETA - 10 dias', () => {
  vm.runInContext(`
    document.getElementById('f_pi_pagamento').value = 'PRAZO';
    document.getElementById('f_eta').value = '2026-11-20';
    document.getElementById('f_pi_data_saldo').value = '';
  `, sandbox);
  sandbox.atualizarVencimentoSaldoPorETA();
  const saldo = vm.runInContext(`document.getElementById('f_pi_data_saldo').value`, sandbox);
  iguais(saldo, '2026-11-10', 'ETA 20/11 - 10 dias = 10/11');
});

teste('atualizarVencimentoSaldoPorETA: PRAZO com Data Pagamento já preenchida -- não sobrescreve', () => {
  vm.runInContext(`
    document.getElementById('f_pi_pagamento').value = 'PRAZO';
    document.getElementById('f_eta').value = '2026-11-20';
    document.getElementById('f_pi_data_saldo').value = '2026-10-01';
  `, sandbox);
  sandbox.atualizarVencimentoSaldoPorETA();
  const saldo = vm.runInContext(`document.getElementById('f_pi_data_saldo').value`, sandbox);
  iguais(saldo, '2026-10-01', 'data já digitada pelo usuário (ou calculada por atualizarDataPagamentoPrazo) não pode ser sobrescrita');
});

teste('atualizarVencimentoSaldoPorETA: sem ETA preenchido -- não faz nada', () => {
  vm.runInContext(`
    document.getElementById('f_pi_pagamento').value = 'PRAZO';
    document.getElementById('f_eta').value = '';
    document.getElementById('f_pi_data_saldo').value = '';
  `, sandbox);
  sandbox.atualizarVencimentoSaldoPorETA();
  const saldo = vm.runInContext(`document.getElementById('f_pi_data_saldo').value`, sandbox);
  iguais(saldo, '', 'sem ETA não dá pra calcular nada');
});

teste('atualizarVencimentoSaldoPorETA: PARCELADO -- preenche Data Vencimento da parcela Final vazia', () => {
  vm.runInContext(`
    document.getElementById('f_pi_pagamento').value = 'PARCELADO';
    document.getElementById('f_eta').value = '2026-11-20';
    _parcelas = [
      {label:'Inicial', valor_usd:'5054.40', data_vencimento:'2026-09-15', cambio_fechado:'5.1340'},
      {label:'Final', valor_usd:'20217.60', data_vencimento:'', cambio_fechado:''},
    ];
  `, sandbox);
  sandbox.atualizarVencimentoSaldoPorETA();
  iguais(vm.runInContext('_parcelas[1].data_vencimento', sandbox), '2026-11-10', 'parcela Final deveria receber ETA - 10 dias');
  iguais(vm.runInContext('_parcelas[0].data_vencimento', sandbox), '2026-09-15', 'parcela Inicial não deveria ser mexida');
});

teste('atualizarVencimentoSaldoPorETA: PARCELADO -- não sobrescreve Data Vencimento já preenchida na Final', () => {
  vm.runInContext(`
    document.getElementById('f_pi_pagamento').value = 'PARCELADO';
    document.getElementById('f_eta').value = '2026-11-20';
    _parcelas = [{label:'Final', valor_usd:'20217.60', data_vencimento:'2026-10-05', cambio_fechado:''}];
  `, sandbox);
  sandbox.atualizarVencimentoSaldoPorETA();
  iguais(vm.runInContext('_parcelas[0].data_vencimento', sandbox), '2026-10-05', 'não pode sobrescrever data já digitada');
});

teste('atualizarVencimentoSaldoPorETA: PARCELADO -- não mexe na Final se o câmbio já foi fechado', () => {
  vm.runInContext(`
    document.getElementById('f_pi_pagamento').value = 'PARCELADO';
    document.getElementById('f_eta').value = '2026-11-20';
    _parcelas = [{label:'Final', valor_usd:'20217.60', data_vencimento:'', cambio_fechado:'5.20'}];
  `, sandbox);
  sandbox.atualizarVencimentoSaldoPorETA();
  iguais(vm.runInContext('_parcelas[0].data_vencimento', sandbox), '', 'câmbio já fechado -- pagamento já em andamento, não faz sentido provisionar vencimento');
});

// ── caso real 26CFXPAK-001 (17/09/2026): a Paula preencheu o câmbio da
// parcela Inicial, o ETA já estava preenchido, mas a Final continuou sem
// Data Vencimento -- porque a regra só disparava no onchange de ETA/Forma
// de Pagamento, não quando o usuário edita Valor USD ou Câmbio Fechado de
// uma parcela (nem quando o processo é só reaberto já com tudo
// preenchido). Corrigido chamando atualizarVencimentoSaldoPorETA() também
// nesses pontos.
teste('atualizarVencimentoSaldoPorETA: caso real 26CFXPAK-001 -- ainda dispara mesmo sem tocar ETA/Forma de Pagamento', () => {
  vm.runInContext(`
    document.getElementById('f_pi_pagamento').value = 'PARCELADO';
    document.getElementById('f_eta').value = '2026-09-28';
    _parcelas = [
      {label:'Inicial', valor_usd:'9969.60', data_vencimento:'2026-07-09', cambio_fechado:'5.1173'},
      {label:'Final', valor_usd:'23262.40', data_vencimento:'', cambio_fechado:''},
    ];
  `, sandbox);
  // Simula o que renderPagamentoCampos() agora faz sempre que renderiza
  // Parcelado (abertura do processo/aba, sem precisar editar ETA de novo).
  sandbox.atualizarVencimentoSaldoPorETA();
  iguais(vm.runInContext('_parcelas[1].data_vencimento', sandbox), '2026-09-18', 'ETA 28/09 - 10 dias = 18/09 -- deveria preencher mesmo com a Inicial já tendo câmbio fechado');
});

// ── data_fechamento_cambio: campo novo, separado de data_vencimento.
// Pedido do Ayslan (17/09/2026): "tem que ter a data do fechamento do
// câmbio e a data do vencimento" -- antes data_vencimento fazia as duas
// funções (previsão E, em alguns fluxos, data do comprovante de
// pagamento), misturando planejamento com execução.
teste('parcelaVazia: já vem com data_fechamento_cambio (vazio)', () => {
  const pv = sandbox.parcelaVazia();
  iguais('data_fechamento_cambio' in pv, true, 'campo novo precisa existir na parcela vazia, senão sincronizarParcelasLegado/renderParcelas quebram');
  iguais(pv.data_fechamento_cambio, '', 'começa vazio');
});

teste('confirmarCambioParcela: grava data_fechamento_cambio a partir da data do comprovante, sem sobrescrever data_vencimento', () => {
  vm.runInContext(`
    _parcelas = [{label:'Inicial', valor_usd:'', data_vencimento:'', cambio_fechado:'', data_fechamento_cambio:'', banco:'', custo_operacao:'', codigo_bacen:''}];
    _cambioPendente = { taxa_cambio: 5.15, valor_usd_referencia: 9969.60, data_pagamento: '2026-07-09', banco: 'Santander' };
  `, sandbox);
  sandbox.confirmarCambioParcela(0);
  iguais(vm.runInContext('_parcelas[0].data_fechamento_cambio', sandbox), '2026-07-09', 'data do comprovante deveria ir pra data_fechamento_cambio');
  iguais(vm.runInContext('_parcelas[0].data_vencimento', sandbox), '2026-07-09', 'continua preenchendo data_vencimento também (fill-if-empty, comportamento existente preservado)');
});

teste('confirmarCambioParcela: não sobrescreve data_fechamento_cambio já preenchida manualmente', () => {
  vm.runInContext(`
    _parcelas = [{label:'Inicial', valor_usd:'', data_vencimento:'2026-07-01', cambio_fechado:'', data_fechamento_cambio:'2026-06-30', banco:'', custo_operacao:'', codigo_bacen:''}];
    _cambioPendente = { taxa_cambio: 5.15, valor_usd_referencia: 9969.60, data_pagamento: '2026-07-09', banco: 'Santander' };
  `, sandbox);
  sandbox.confirmarCambioParcela(0);
  iguais(vm.runInContext('_parcelas[0].data_fechamento_cambio', sandbox), '2026-06-30', 'data que o usuário já tinha digitado não pode ser sobrescrita pelo comprovante');
});



// ── ORDENAÇÃO POR COLUNA (ETA crescente/decrescente) ────────────
// Pedido do Ayslan (17/09/2026): "Fazer o filtro ficar por ordem de
// chegada / ETA Crescente no controle". aplicarOrdenacao() é a função
// pura (sem DOM) que faz o trabalho -- ordenarPorColuna() só seta o
// estado global _ordenacao e chama render(), então testamos direto a
// função pura com uma lista de processos controlada.
teste('aplicarOrdenacao: ETA crescente -- ordena pela Data Chegada/ETA mais próxima primeiro', () => {
  const lista = [
    { id:'A', eta:'2026-10-05', data_chegada:'' },
    { id:'B', eta:'2026-09-20', data_chegada:'' },
    { id:'C', eta:'2026-09-28', data_chegada:'' },
  ];
  vm.runInContext(`_ordenacao = { campo:'eta', dir:'asc' };`, sandbox);
  const out = vm.runInContext(`aplicarOrdenacao(${JSON.stringify(lista)})`, sandbox);
  iguais(out.map(p=>p.id).join(','), 'B,C,A', 'esperado ordem crescente por ETA: B(20/09), C(28/09), A(05/10)');
});

teste('aplicarOrdenacao: ETA decrescente -- inverte a ordem', () => {
  const lista = [
    { id:'A', eta:'2026-10-05', data_chegada:'' },
    { id:'B', eta:'2026-09-20', data_chegada:'' },
    { id:'C', eta:'2026-09-28', data_chegada:'' },
  ];
  vm.runInContext(`_ordenacao = { campo:'eta', dir:'desc' };`, sandbox);
  const out = vm.runInContext(`aplicarOrdenacao(${JSON.stringify(lista)})`, sandbox);
  iguais(out.map(p=>p.id).join(','), 'A,C,B', 'esperado ordem decrescente por ETA: A(05/10), C(28/09), B(20/09)');
});

teste('aplicarOrdenacao: Data Chegada tem prioridade sobre ETA quando as duas existem', () => {
  const lista = [
    { id:'A', eta:'2026-09-01', data_chegada:'2026-10-15' }, // já chegou -- usa data_chegada, não o ETA antigo
    { id:'B', eta:'2026-09-20', data_chegada:'' },
  ];
  vm.runInContext(`_ordenacao = { campo:'eta', dir:'asc' };`, sandbox);
  const out = vm.runInContext(`aplicarOrdenacao(${JSON.stringify(lista)})`, sandbox);
  iguais(out.map(p=>p.id).join(','), 'B,A', 'B (ETA 20/09) vem antes de A (Data Chegada real 15/10, não o ETA 01/09)');
});

teste('aplicarOrdenacao: processo sem ETA/Data Chegada vai sempre pro fim, em qualquer direção', () => {
  const lista = [
    { id:'SEM_DATA', eta:'', data_chegada:'' },
    { id:'A', eta:'2026-10-05', data_chegada:'' },
    { id:'B', eta:'2026-09-20', data_chegada:'' },
  ];
  vm.runInContext(`_ordenacao = { campo:'eta', dir:'asc' };`, sandbox);
  let out = vm.runInContext(`aplicarOrdenacao(${JSON.stringify(lista)})`, sandbox);
  iguais(out[out.length-1].id, 'SEM_DATA', 'crescente: sem data fica por último');
  vm.runInContext(`_ordenacao = { campo:'eta', dir:'desc' };`, sandbox);
  out = vm.runInContext(`aplicarOrdenacao(${JSON.stringify(lista)})`, sandbox);
  iguais(out[out.length-1].id, 'SEM_DATA', 'decrescente: sem data continua por último (não vira "maior data")');
});

teste('aplicarOrdenacao: sem _ordenacao ativa, devolve a lista na mesma ordem (não mexe em nada)', () => {
  const lista = [{ id:'B' }, { id:'A' }, { id:'C' }];
  vm.runInContext(`_ordenacao = null;`, sandbox);
  const out = vm.runInContext(`aplicarOrdenacao(${JSON.stringify(lista)})`, sandbox);
  iguais(out.map(p=>p.id).join(','), 'B,A,C', 'sem ordenação ativa, a ordem original é preservada');
});

// ── COMPROVANTE DE CÂMBIO: Banco/Código BACEN/Custo da operação ──
// Pedido do Ayslan (17/09/2026): "eu coloquei pra ler esse pdf, com o
// contrato de cambio de 2 processos. Porem, ele nao preencheu o banco, o
// codigo bacen, o custo total da operacao". A extração da IA nunca pediu
// esses campos e o código que aplica o resultado da confirmação também
// não os escrevia na parcela — corrigido nos dois lados.
console.log('\n📋 Comprovante de câmbio — Banco/Código BACEN/Custo da operação');

teste('confirmarCambioParcela: aplica banco/código BACEN/custo da operação na parcela (campos vazios)', () => {
  vm.runInContext(`_parcelas = [{label:'Inicial', valor_usd:'', data_vencimento:'', cambio_fechado:'', banco:'', custo_operacao:'', codigo_bacen:''}];`, sandbox);
  vm.runInContext(`_cambioPendente = {taxa_cambio:5.135, valor_pago:32737.06, referencia:'UD26-X', data_pagamento:'2026-09-15', banco:'Itaú', codigo_bacen:'632806455', custo_operacao:120.50};`, sandbox);
  sandbox.confirmarCambioParcela(0);
  const pc = vm.runInContext('_parcelas[0]', sandbox);
  iguais(pc.banco, 'Itaú', 'banco deveria vir do comprovante');
  iguais(pc.codigo_bacen, '632806455', 'código BACEN deveria vir do comprovante');
  // Custo da Operação agora é Valor USD x Câmbio + tarifa extra discriminada
  // no comprovante (pedido do Ayslan, 17/09/2026) -- não só a tarifa isolada.
  iguais(pc.custo_operacao, '32857.56', 'custo da operação deveria ser valor USD x câmbio + tarifa extra do comprovante');
});

teste('confirmarCambioParcela: NUNCA sobrescreve banco/código BACEN/custo já preenchidos pelo usuário', () => {
  vm.runInContext(`_parcelas = [{label:'Inicial', valor_usd:'', data_vencimento:'', cambio_fechado:'', banco:'Santander (digitado à mão)', custo_operacao:99, codigo_bacen:'000111222'}];`, sandbox);
  vm.runInContext(`_cambioPendente = {taxa_cambio:5.135, valor_pago:32737.06, referencia:'UD26-X', data_pagamento:'2026-09-15', banco:'Itaú', codigo_bacen:'632806455', custo_operacao:120.50};`, sandbox);
  sandbox.confirmarCambioParcela(0);
  const pc = vm.runInContext('_parcelas[0]', sandbox);
  iguais(pc.banco, 'Santander (digitado à mão)', 'banco já preenchido não deveria ser sobrescrito');
  iguais(pc.codigo_bacen, '000111222', 'código BACEN já preenchido não deveria ser sobrescrito');
  iguais(pc.custo_operacao, 99, 'custo já preenchido não deveria ser sobrescrito');
});

teste('aplicarCambioNaParcelaPendente: aplica banco/código BACEN/custo igual confirmarCambioParcela', () => {
  vm.runInContext(`_parcelas = [{label:'Inicial', valor_usd:'', data_vencimento:'', cambio_fechado:'', banco:'', custo_operacao:'', codigo_bacen:''}];`, sandbox);
  vm.runInContext(`_cambioPendente = {taxa_cambio:5.1932, valor_pago:147798.94, referencia:'', data_pagamento:'2026-08-20', banco:'Santander', codigo_bacen:'000624901400', custo_operacao:0};`, sandbox);
  vm.runInContext(`aplicarCambioNaParcelaPendente(5.1932)`, sandbox);
  const pc = vm.runInContext('_parcelas[0]', sandbox);
  iguais(pc.banco, 'Santander', 'banco deveria vir do comprovante');
  iguais(pc.codigo_bacen, '000624901400', 'código BACEN deveria vir do comprovante');
});

teste('confirmarCambioComo("unico"): aplica Banco/Custo nos campos do processo (legado, sem Código BACEN)', () => {
  sandbox.document.getElementById('f_pi_pagamento').value = 'VISTA';
  sandbox.document.getElementById('f_pi_cambio_fechado').value = '';
  sandbox.document.getElementById('f_pi_cambio_banco').value = '';
  sandbox.document.getElementById('f_pi_cambio_custo').value = '';
  vm.runInContext(`_cambioPendente = {taxa_cambio:5.20, valor_pago:10000, referencia:'UD26-Y', data_pagamento:'2026-09-01', banco:'Itaú', codigo_bacen:'999888777', custo_operacao:55.30};`, sandbox);
  sandbox.confirmarCambioComo('unico');
  iguais(sandbox.document.getElementById('f_pi_cambio_banco').value, 'Itaú', 'banco deveria ser preenchido no campo do processo');
  iguais(sandbox.document.getElementById('f_pi_cambio_custo').value, '10055.30', 'custo da operação deveria ser valor USD x câmbio + tarifa extra do comprovante');
});

// ── CATÁLOGO DE BANCOS DA IMPAK (cadastro + normalização) ───────
// Pedido do Ayslan (17/09/2026): cadastrar Itaú/Santander (contas da
// própria Impak) pra selecionar no campo Banco/Corretora do Câmbio, e a IA
// normalizar o nome ao ler um comprovante (evita fragmentar o agrupamento
// "por banco" do Dashboard Câmbio por variação de escrita).
teste('normalizarBancoCambio: reconhece variações de escrita e devolve o nome curto cadastrado', () => {
  iguais(sandbox.normalizarBancoCambio('Itaú Unibanco S.A.'), 'Itaú', 'deveria normalizar pro nome curto');
  iguais(sandbox.normalizarBancoCambio('BANCO SANTANDER (BRASIL) S.A.'), 'Santander', 'deveria reconhecer mesmo maiúsculo/com sufixo');
  iguais(sandbox.normalizarBancoCambio('itaú'), 'Itaú', 'case-insensitive');
});

teste('normalizarBancoCambio: banco fora do catálogo mantém o texto original (não força a lista)', () => {
  iguais(sandbox.normalizarBancoCambio('Banco XP'), 'Banco XP', 'banco não cadastrado deve continuar digitável livremente');
});

teste('normalizarBancoCambio: vazio devolve vazio', () => {
  iguais(sandbox.normalizarBancoCambio(''), '', 'sem texto não tem o que normalizar');
});

// ── COMPROVANTE DE CÂMBIO: rateio por referência em USD ─────────
// Bug real do Ayslan (17/09/2026): comprovante Itaú 632806609, rateio de
// duas referências mostrado em DÓLAR ($5.088,00 / $5.054,40, não reais) --
// o código antigo sempre dividia "valor_pago" pela taxa achando que vinha
// em reais, gerando um Valor USD errado (5088/5,134 ≈ 991 em vez de
// 5088,00). valor_usd_referencia resolve isso: quando vem preenchido, usa
// direto, sem dividir pela taxa de novo.
teste('confirmarCambioParcela: usa valor_usd_referencia direto quando o rateio já vem em dólar (não divide pela taxa de novo)', () => {
  vm.runInContext(`_parcelas = [{label:'Inicial', valor_usd:'', data_vencimento:'', cambio_fechado:''}];`, sandbox);
  vm.runInContext(`_cambioPendente = {taxa_cambio:5.134, valor_pago:0, valor_usd_referencia:5088.00, referencia:'QD-IMK-LPL-2605-1742', data_pagamento:'2026-09-15'};`, sandbox);
  sandbox.confirmarCambioParcela(0);
  const pc = vm.runInContext('_parcelas[0]', sandbox);
  iguais(pc.valor_usd, '5088.00', 'deveria usar o valor em USD do comprovante direto, sem dividir pela taxa de novo');
});

teste('confirmarCambioParcela: sem valor_usd_referencia, continua calculando valor_usd a partir de valor_pago (reais) / taxa', () => {
  vm.runInContext(`_parcelas = [{label:'Inicial', valor_usd:'', data_vencimento:'', cambio_fechado:''}];`, sandbox);
  vm.runInContext(`_cambioPendente = {taxa_cambio:5.134, valor_pago:26120.83, valor_usd_referencia:0, referencia:'UD26-X', data_pagamento:'2026-09-15'};`, sandbox);
  sandbox.confirmarCambioParcela(0);
  const pc = vm.runInContext('_parcelas[0]', sandbox);
  iguais(pc.valor_usd, (26120.83/5.134).toFixed(2), 'sem valor em USD explícito, mantém o cálculo antigo via reais/taxa');
});

// ── CUSTO DA OPERAÇÃO = Valor USD x Câmbio (+ tarifas) ──────────
// Pedido explícito do Ayslan (17/09/2026): "O CUSTO DA OPERACAO e o valor
// em USD x cambio, nesse caso do QD-IMK-LPL-2605-1740, e USD 5.054,40 x
// 5,1340 = BRL 25.949,2896". Antes o campo só recebia tarifas/IOF
// discriminadas separadamente no comprovante e ficava 0,00 quando o banco
// não cobra nada além do câmbio em si (caso mais comum).
teste('confirmarCambioParcela: Custo da Operação = Valor USD x Câmbio quando o comprovante não discrimina tarifa extra', () => {
  vm.runInContext(`_parcelas = [{label:'Inicial', valor_usd:'', data_vencimento:'', cambio_fechado:'', custo_operacao:''}];`, sandbox);
  vm.runInContext(`_cambioPendente = {taxa_cambio:5.1340, valor_pago:0, valor_usd_referencia:5054.40, referencia:'QD-IMK-LPL-2605-1740', data_pagamento:'2026-09-15', custo_operacao:0};`, sandbox);
  sandbox.confirmarCambioParcela(0);
  const pc = vm.runInContext('_parcelas[0]', sandbox);
  iguais(pc.custo_operacao, (5054.40*5.1340).toFixed(2), 'deveria ser Valor USD x Câmbio Fechado, igual ao exemplo do Ayslan');
});

// ── calcularParcelaResidualAuto: saldo automático da parcela vazia ──────
// Pedido do Ayslan (17/09/2026), caso real QD-IMK-LPL-2605-1740: PI de
// USD 25.272,00, parcela Inicial USD 5.054,40 certa, mas a Final tinha
// sido digitada manualmente como USD 17.577,00 -- não fecha com a PI
// (o certo seria USD 20.217,60 = 25.272,00 - 5.054,40). Esta regra evita
// que o usuário precise fazer essa conta de cabeça e erre.
teste('calcularParcelaResidualAuto: preenche o saldo da única parcela vazia (caso real QD-IMK-LPL-2605-1740)', () => {
  vm.runInContext(`document.getElementById('f_pi_valor_usd').value = '25.272,00';`, sandbox);
  vm.runInContext(`_parcelas = [
    {label:'Inicial', valor_usd:'5054.40'},
    {label:'Final', valor_usd:''},
  ];`, sandbox);
  sandbox.calcularParcelaResidualAuto();
  iguais(vm.runInContext('_parcelas[1].valor_usd', sandbox), (25272-5054.40).toFixed(2), 'saldo deveria ser PI total menos a parcela Inicial já preenchida');
});

teste('calcularParcelaResidualAuto: nunca sobrescreve um valor que o usuário já digitou', () => {
  vm.runInContext(`document.getElementById('f_pi_valor_usd').value = '25.272,00';`, sandbox);
  vm.runInContext(`_parcelas = [
    {label:'Inicial', valor_usd:'5054.40'},
    {label:'Final', valor_usd:'17577.00'},
  ];`, sandbox);
  sandbox.calcularParcelaResidualAuto();
  iguais(vm.runInContext('_parcelas[1].valor_usd', sandbox), '17577.00', 'não deveria mexer em campo já preenchido, mesmo que a soma não bata (o aviso de divergência cuida de avisar)');
});

teste('calcularParcelaResidualAuto: com 2+ parcelas vazias, não arrisca adivinhar -- não faz nada', () => {
  vm.runInContext(`document.getElementById('f_pi_valor_usd').value = '25.272,00';`, sandbox);
  vm.runInContext(`_parcelas = [
    {label:'Inicial', valor_usd:''},
    {label:'Final', valor_usd:''},
  ];`, sandbox);
  sandbox.calcularParcelaResidualAuto();
  iguais(vm.runInContext('_parcelas[0].valor_usd', sandbox), '', 'não deveria preencher nada com 2 parcelas vazias');
  iguais(vm.runInContext('_parcelas[1].valor_usd', sandbox), '', 'não deveria preencher nada com 2 parcelas vazias');
});

teste('calcularCustoOperacaoAuto: preenche Custo da Operação ao digitar Valor USD/Câmbio manualmente, sem sobrescrever edição do usuário', () => {
  vm.runInContext(`_parcelas = [{label:'Final', valor_usd:'1000.00', cambio_fechado:'5.20', custo_operacao:''}];`, sandbox);
  sandbox.calcularCustoOperacaoAuto(0);
  iguais(vm.runInContext('_parcelas[0].custo_operacao', sandbox), (1000*5.20).toFixed(2), 'deveria auto-calcular quando o campo está vazio');

  vm.runInContext(`_parcelas = [{label:'Final', valor_usd:'1000.00', cambio_fechado:'5.20', custo_operacao:'999.00'}];`, sandbox);
  sandbox.calcularCustoOperacaoAuto(0);
  iguais(vm.runInContext('_parcelas[0].custo_operacao', sandbox), '999.00', 'nunca sobrescreve um valor já digitado pelo usuário');
});

// ── PENDÊNCIAS DE DI (planilha mensal pro banco) ────────────────
// Pedido do Ayslan (17/09/2026): câmbios fechados no mês entram na planilha
// "Pendências de DI" enviada ao banco. Atualizado no mesmo dia (2ª
// instrução, com print): "pagamento antecipado (exige DI/DUIMP)... ELE
// SEMPRE PRECISA, nao tem que ter a opcao de nao ter" -- toda parcela
// Parcelado com câmbio fechado entra, não existe mais opt-out.
teste('calcularVencimentoDI: soma 180 dias corridos à data do câmbio fechado', () => {
  const out = vm.runInContext(`calcularVencimentoDI('2026-09-15')`, sandbox);
  iguais(out, '2027-03-14', '15/09/2026 + 180 dias = 14/03/2027');
});

teste('calcularVencimentoDI: sem data base, devolve string vazia', () => {
  const out = vm.runInContext(`calcularVencimentoDI('')`, sandbox);
  iguais(out, '', 'sem dataBase não tem o que calcular');
});

teste('listarPendenciasDI: inclui toda parcela Parcelado com câmbio fechado dentro do mês (não depende mais de pagto_antecipado)', () => {
  const processos = [
    { id:'P1', referencia:'REF1', pi_pagamento:'PARCELADO', pi_parcelas_json: JSON.stringify([
      { label:'Inicial', valor_usd:6375.28, data_vencimento:'2026-09-15', cambio_fechado:5.135, pagto_antecipado:true, codigo_bacen:'632806455', venc_di:'2027-03-14', duimp_numero:'', duimp_protocolo:'' },
      { label:'Final', valor_usd:1000, data_vencimento:'2026-09-20', cambio_fechado:5.20, pagto_antecipado:false }, // pagto_antecipado false mas tem câmbio fechado no mês -- entra assim mesmo (regra não usa mais esse campo)
    ])},
    { id:'P2', referencia:'REF2', pi_pagamento:'PARCELADO', pi_parcelas_json: JSON.stringify([
      { label:'Inicial', valor_usd:28460.09, data_vencimento:'2026-08-20', cambio_fechado:5.1932, pagto_antecipado:true, codigo_bacen:'000624901400', venc_di:'2027-02-16' }, // mês errado -- fora
    ])},
    { id:'P3', referencia:'REF3', pi_pagamento:'PARCELADO', pi_parcelas_json: JSON.stringify([
      { label:'Inicial', valor_usd:5000, data_vencimento:'2026-09-30', cambio_fechado:0, pagto_antecipado:true }, // sem câmbio fechado ainda -- fora
    ])},
    { id:'P4', referencia:'REF4', pi_pagamento:'ENTRADA_SALDO', pi_data_entrada:'2026-09-10', pi_cambio_entrada:5.1 }, // não é Parcelado -- fora do escopo desta planilha
  ];
  const out = vm.runInContext(`listarPendenciasDI(${JSON.stringify(processos)}, '2026-09-01', '2026-09-30')`, sandbox);
  iguais(out.length, 2, 'REF1/Inicial e REF1/Final entram (câmbio fechado + dentro do mês + Parcelado, pagto_antecipado não filtra mais)');
  iguais(out.map(l=>l.referencia).sort().join(','), 'REF1,REF1', 'as duas linhas são da REF1 (REF2 mês errado, REF3 sem câmbio, REF4 não é Parcelado)');
  const inicial = out.find(l=>l.codigoBacen==='632806455');
  iguais(inicial.referencia, 'REF1', 'referência correta');
  iguais(inicial.valorUsd, 6375.28, 'Valor M.E. correto');
});

teste('listarPendenciasDI: ordena pelo vencimento da DI mais próximo primeiro, sem data por último', () => {
  const processos = [
    { id:'P1', referencia:'A', pi_pagamento:'PARCELADO', pi_parcelas_json: JSON.stringify([
      { valor_usd:100, data_vencimento:'2026-09-05', cambio_fechado:5.1, pagto_antecipado:true, venc_di:'2027-03-04' },
    ])},
    { id:'P2', referencia:'B', pi_pagamento:'PARCELADO', pi_parcelas_json: JSON.stringify([
      { valor_usd:200, data_vencimento:'2026-09-10', cambio_fechado:5.1, pagto_antecipado:true, venc_di:'' },
    ])},
    { id:'P3', referencia:'C', pi_pagamento:'PARCELADO', pi_parcelas_json: JSON.stringify([
      { valor_usd:300, data_vencimento:'2026-09-15', cambio_fechado:5.1, pagto_antecipado:true, venc_di:'2027-01-10' },
    ])},
  ];
  const out = vm.runInContext(`listarPendenciasDI(${JSON.stringify(processos)}, '2026-09-01', '2026-09-30')`, sandbox);
  iguais(out.map(l=>l.referencia).join(','), 'C,A,B', 'C (venc. mais próximo) primeiro, A depois, B (sem venc. de DI) por último');
});

// ── RESUMO ───────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Total: ${totalTestes} testes, ${totalTestes - totalFalhas} passaram, ${totalFalhas} falharam`);
if (totalFalhas > 0) {
  console.log('\n⚠️  NÃO FAÇA DEPLOY com testes falhando sem entender o motivo.');
  process.exit(1);
} else {
  console.log('✓ Tudo certo para deploy (do ponto de vista destas regras testadas).');
  process.exit(0);
}

})();
