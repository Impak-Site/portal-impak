/**
 * TESTES AUTOMATIZADOS — lib/validacao-documento.js (CNPJ/CPF por tipo/país)
 * ════════════════════════════════════════════════════════════════
 * Roda com: node testes_cadastros.js
 *
 * Cobre a regra pedida pelo Ayslan (12/09/2026) pra tela de Cadastros:
 * empresa brasileira exige CNPJ válido, pessoa física brasileira exige
 * CPF válido, e qualquer documento do exterior passa sem regra (ainda).
 */

const assert = require('assert');
const { digitoVerificadorValido_CPF, digitoVerificadorValido_CNPJ, validarDocumento } = require('./lib/validacao-documento.js');

let passou = 0, falhou = 0;
function teste(nome, fn) {
  try { fn(); passou++; console.log(`  ✓ ${nome}`); }
  catch (e) { falhou++; console.log(`  ✗ ${nome}`); console.log(`    ${e.message}`); }
}

console.log('\n── CPF ──');

teste('CPF válido conhecido (111.444.777-35)', () => {
  assert.strictEqual(digitoVerificadorValido_CPF('111.444.777-35'), true);
});
teste('CPF com todos os dígitos iguais é inválido', () => {
  assert.strictEqual(digitoVerificadorValido_CPF('111.111.111-11'), false);
});
teste('CPF com dígito verificador errado é inválido', () => {
  assert.strictEqual(digitoVerificadorValido_CPF('111.444.777-36'), false);
});
teste('CPF com tamanho errado é inválido', () => {
  assert.strictEqual(digitoVerificadorValido_CPF('123456'), false);
});

console.log('\n── CNPJ ──');

teste('CNPJ válido conhecido (11.222.333/0001-81)', () => {
  assert.strictEqual(digitoVerificadorValido_CNPJ('11.222.333/0001-81'), true);
});
teste('CNPJ com todos os dígitos iguais é inválido', () => {
  assert.strictEqual(digitoVerificadorValido_CNPJ('11.111.111/1111-11'), false);
});
teste('CNPJ com dígito verificador errado é inválido', () => {
  assert.strictEqual(digitoVerificadorValido_CNPJ('11.222.333/0001-82'), false);
});

console.log('\n── validarDocumento (regra por tipo de pessoa/país) ──');

teste('Jurídica + Brasil + CNPJ válido: sem erro', () => {
  assert.strictEqual(validarDocumento('JURIDICA', 'Brasil', '11.222.333/0001-81'), null);
});
teste('Jurídica + Brasil + sem CNPJ: exige documento', () => {
  assert.ok(validarDocumento('JURIDICA', 'Brasil', '').includes('CNPJ'));
});
teste('Jurídica + Brasil + CNPJ inválido: rejeita', () => {
  assert.ok(validarDocumento('JURIDICA', 'Brasil', '11.222.333/0001-82').includes('inválido'));
});
teste('Física + Brasil + CPF válido: sem erro', () => {
  assert.strictEqual(validarDocumento('FISICA', 'Brasil', '111.444.777-35'), null);
});
teste('Física + Brasil + sem CPF: exige documento', () => {
  assert.ok(validarDocumento('FISICA', 'Brasil', '').includes('CPF'));
});
teste('Física + Brasil + CPF inválido: rejeita', () => {
  assert.ok(validarDocumento('FISICA', 'Brasil', '111.111.111-11').includes('inválido'));
});
teste('Jurídica + exterior + sem documento: sem regra (passa)', () => {
  assert.strictEqual(validarDocumento('JURIDICA', 'China', ''), null);
});
teste('Física + exterior + documento qualquer: sem regra (passa)', () => {
  assert.strictEqual(validarDocumento('FISICA', 'Estados Unidos', 'abc123'), null);
});
teste('País vazio assume Brasil (mantém a regra)', () => {
  assert.ok(validarDocumento('JURIDICA', '', '').includes('CNPJ'));
});

console.log(`\n════════════════════════════════════════`);
console.log(`RESULTADO: ${passou} passaram, ${falhou} falharam`);
console.log(`════════════════════════════════════════\n`);
if (falhou > 0) process.exit(1);
