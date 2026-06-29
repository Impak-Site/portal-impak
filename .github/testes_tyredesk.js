/**
 * TESTES AUTOMATIZADOS — TyreDesk (IMPAK Portal)
 * ════════════════════════════════════════════════════════════════
 * Roda com: node testes_tyredesk.js
 *
 * Mesmo princípio do testes_controle.js: carrega o código REAL extraído
 * de tyredesk.html, não uma cópia reescrita. Veja o cabeçalho daquele
 * arquivo para a explicação completa da abordagem.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ARQUIVO_HTML = path.join(__dirname, 'tyredesk.html');
const html = fs.readFileSync(ARQUIVO_HTML, 'utf-8');
const scriptMatches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (!scriptMatches.length) {
  console.error('❌ Não encontrei nenhum bloco <script> em', ARQUIVO_HTML);
  process.exit(1);
}
const jsReal = scriptMatches[scriptMatches.length - 1][1];

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
    addEventListener: () => {},
  };
  sandbox.window = sandbox;
  return sandbox;
}

const sandbox = criarSandbox();
vm.createContext(sandbox);
try {
  vm.runInContext(jsReal, sandbox, { filename: 'tyredesk_extraido.js' });
} catch (e) {
  console.error('❌ O código real não carregou nos stubs de teste.');
  console.error('   Erro:', e.message);
  process.exit(1);
}

let totalTestes = 0, totalFalhas = 0;
function teste(nome, fn) {
  totalTestes++;
  try { fn(); console.log(`  ✓ ${nome}`); }
  catch (e) { totalFalhas++; console.log(`  ✗ ${nome}\n      ${e.message}`); }
}
function iguais(a, b, msg) { if (a !== b) throw new Error(msg || `esperado "${b}", recebido "${a}"`); }

console.log('\n📋 norm() — normalização de medida de pneu');
teste('remove prefixo de letra colado no número (bug real corrigido: P205/55R16)', () => {
  iguais(sandbox.norm('P205/55R16'), '205/55R16');
});
teste('normaliza minúsculas para maiúsculas', () => {
  iguais(sandbox.norm('205/55r16'), '205/55R16');
});
teste('medida já no formato correto permanece igual', () => {
  iguais(sandbox.norm('295/80R22.5'), '295/80R22.5');
});
teste('remove espaços internos', () => {
  iguais(sandbox.norm('205 / 55 R16'), '205/55R16');
});
teste('vírgula decimal é convertida para ponto', () => {
  iguais(sandbox.norm('295/80R22,5'), '295/80R22.5');
});

console.log(`\n${'─'.repeat(50)}`);
console.log(`Total: ${totalTestes} testes, ${totalTestes - totalFalhas} passaram, ${totalFalhas} falharam`);
if (totalFalhas > 0) { process.exit(1); }
