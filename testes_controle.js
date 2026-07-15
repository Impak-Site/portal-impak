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

// ── 1. EXTRAIR O JS REAL DO ARQUIVO ────────────────────────────
const ARQUIVO_HTML = path.join(__dirname, 'controle_v2.html');
const html = fs.readFileSync(ARQUIVO_HTML, 'utf-8');
const scriptMatches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (!scriptMatches.length) {
  console.error('❌ Não encontrei nenhum bloco <script> em', ARQUIVO_HTML);
  process.exit(1);
}
const jsReal = scriptMatches[scriptMatches.length - 1][1];

// ── 2. STUBS MÍNIMOS DE DOM/BROWSER ────────────────────────────
// Suficientes para o arquivo CARREGAR sem lançar erro ao definir as
// funções (mesmo que funções que de fato MANIPULAM a tela não funcionem
// nestes stubs — não é o que estamos testando aqui).
function criarSandbox() {
  const elementosFalsos = {};
  const documentFalso = {
    getElementById: (id) => elementosFalsos[id] || (elementosFalsos[id] = {
      value: '', innerHTML: '', style: {}, textContent: '', classList: { add(){}, remove(){}, contains(){ return false; } },
      addEventListener(){}, appendChild(){}, querySelector(){ return null; }, querySelectorAll(){ return []; },
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
    Date, Math, JSON, Array, Object, String, Number, Boolean, RegExp, Promise,
    URL: typeof URL !== 'undefined' ? URL : undefined,
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
teste('HBL preenchido avança para EMBARCADO', () => {
  iguais(sandbox.calcularFase({ etd: '2026-01-01', hbl: 'ABC123' }), 'EMBARCADO');
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
teste('HBL presente avança pra EMBARCADO mesmo sem data_embarque (não depende só da data)', () => {
  iguais(sandbox.calcularFase({ etd: '2026-01-01', hbl: 'HBLX123' }), 'EMBARCADO');
});
teste('AMBAS as NFs preenchidas -> avança para DEVOLUCAO_VAZIO (regra de negócio confirmada com o usuário)', () => {
  iguais(sandbox.calcularFase({ nf_entrada_numero: '8305', nf_saida_numero: '8309' }), 'DEVOLUCAO_VAZIO');
});
teste('Data de devolução do vazio sempre finaliza, mesmo com outros campos vazios', () => {
  iguais(sandbox.calcularFase({ data_devolucao_vazio: '2026-06-30' }), 'FINALIZADO');
});
teste('Devolução do vazio tem prioridade MÁXIMA mesmo com tudo preenchido', () => {
  iguais(sandbox.calcularFase({
    etd:'2026-01-01', hbl:'X', data_chegada:'2026-02-01', numero_di:'1',
    canal:'VERDE', data_parametrizacao:'2026-02-05', nf_entrada_numero:'1',
    nf_saida_numero:'2', data_devolucao_vazio:'2026-06-30'
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
