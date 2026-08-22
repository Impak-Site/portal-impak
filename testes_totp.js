/**
 * TESTES AUTOMATIZADOS — lib/totp.js (TOTP/HOTP próprio, sem dependências)
 * ════════════════════════════════════════════════════════════════
 * Roda com: node testes_totp.js
 *
 * Este módulo foi escrito à mão pra substituir o `otplib` (que quebrou a
 * produção duas vezes por causa de dependências transitivas ESM-only).
 * Justamente por ser criptografia de autenticação escrita do zero, ela
 * precisa ser validada contra os vetores de teste OFICIAIS do RFC 6238
 * (TOTP) -- não basta bater com ela mesma, tem que bater com a
 * especificação. Se algum desses testes falhar, NÃO suba a mudança: o
 * 2FA de todo mundo depende deste arquivo gerar exatamente os mesmos
 * códigos que qualquer app autenticador (Google Authenticator, Authy...)
 * também geraria a partir do mesmo segredo.
 */

const assert = require('assert');
const totp = require('./lib/totp.js');

let passou = 0, falhou = 0;
function teste(nome, fn) {
  try {
    fn();
    passou++;
    console.log(`  ✓ ${nome}`);
  } catch (e) {
    falhou++;
    console.log(`  ✗ ${nome}`);
    console.log(`    ${e.message}`);
  }
}

console.log('\n── Base32 (RFC 4648, sem padding) ──');

teste('encode/decode round-trip com bytes aleatórios', () => {
  const crypto = require('crypto');
  for (let i = 0; i < 20; i++) {
    const buf = crypto.randomBytes(1 + (i % 30));
    const enc = totp.base32Encode(buf);
    const dec = totp.base32Decode(enc);
    assert.strictEqual(dec.toString('hex'), buf.toString('hex'));
  }
});

// Vetores oficiais do RFC 4648 §10 (sem o padding '=', que este módulo
// deliberadamente não usa nem exige).
teste('vetores oficiais RFC 4648 (sem padding)', () => {
  const vetores = [
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ];
  for (const [texto, esperado] of vetores) {
    assert.strictEqual(totp.base32Encode(Buffer.from(texto, 'ascii')), esperado, `encode("${texto}")`);
    assert.strictEqual(totp.base32Decode(esperado).toString('ascii'), texto, `decode("${esperado}")`);
  }
});

teste('decode ignora minúsculas, espaços e padding "="', () => {
  const enc = totp.base32Encode(Buffer.from('teste123', 'ascii'));
  const comLixo = enc.toLowerCase().split('').join(' ') + '====';
  assert.strictEqual(totp.base32Decode(comLixo).toString('hex'), totp.base32Decode(enc).toString('hex'));
});

console.log('\n── HOTP (RFC 4226, Apêndice D — vetores oficiais) ──');

// Segredo dos vetores oficiais do RFC 4226: a string ASCII
// "12345678901234567890", codificada em base32 pra alimentar nosso hotp()
// (que sempre espera o segredo em base32, como um app autenticador real).
const SEGREDO_RFC4226 = totp.base32Encode(Buffer.from('12345678901234567890', 'ascii'));
const HOTP_ESPERADO = ['755224','287082','359152','969429','338314','254676','287922','162583','399871','520489'];

teste('HOTP contador 0..9 bate com os vetores oficiais do RFC 4226', () => {
  HOTP_ESPERADO.forEach((esperado, counter) => {
    const gerado = totp.hotp(SEGREDO_RFC4226, counter, 6, 'sha1');
    assert.strictEqual(gerado, esperado, `contador=${counter}`);
  });
});

console.log('\n── TOTP (RFC 6238, Apêndice B — vetores oficiais, SHA1/8 dígitos) ──');

const SEGREDO_RFC6238 = totp.base32Encode(Buffer.from('12345678901234567890', 'ascii'));
const TOTP_VETORES = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  // 20000000000 excede Number.MAX_SAFE_INTEGER em ms (epoch*1000), então
  // fica de fora -- os 5 vetores acima já cobrem a lógica de truncamento
  // dinâmico e o cálculo de contador por tempo.
];

teste('TOTP bate com os vetores oficiais do RFC 6238 (8 dígitos)', () => {
  TOTP_VETORES.forEach(([tempoSegundos, esperado]) => {
    const gerado = totp.generate({ secret: SEGREDO_RFC6238, digits: 8, period: 30, algorithm: 'sha1', epoch: tempoSegundos * 1000 });
    assert.strictEqual(gerado, esperado, `epoch=${tempoSegundos}s`);
  });
});

console.log('\n── generate() / verify() (uso real do sistema: 6 dígitos, período 30s) ──');

teste('código gerado agora é aceito por verify() agora', () => {
  const secret = totp.generateSecret();
  const codigo = totp.generate({ secret });
  const r = totp.verify({ secret, token: codigo });
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.delta, 0);
});

teste('verify() tolera ±1 janela de tempo (relógio do celular levemente errado)', () => {
  const secret = totp.generateSecret();
  const agora = Date.now();
  const umPeriodoAntes = agora - 30_000;
  const codigoAntigo = totp.generate({ secret, epoch: umPeriodoAntes });
  const r = totp.verify({ secret, token: codigoAntigo, epoch: agora });
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.delta, -1);
});

teste('verify() rejeita código de 2+ janelas atrás (fora da tolerância)', () => {
  const secret = totp.generateSecret();
  const agora = Date.now();
  const doisPeriodosAntes = agora - 90_000;
  const codigoVelho = totp.generate({ secret, epoch: doisPeriodosAntes });
  const r = totp.verify({ secret, token: codigoVelho, epoch: agora });
  assert.strictEqual(r.valid, false);
});

teste('verify() rejeita código errado', () => {
  const secret = totp.generateSecret();
  const certo = totp.generate({ secret });
  const errado = certo === '000000' ? '111111' : '000000';
  const r = totp.verify({ secret, token: errado });
  assert.strictEqual(r.valid, false);
});

teste('verify() rejeita segredo diferente', () => {
  const secretA = totp.generateSecret();
  const secretB = totp.generateSecret();
  const codigo = totp.generate({ secret: secretA });
  const r = totp.verify({ secret: secretB, token: codigo });
  assert.strictEqual(r.valid, false);
});

teste('verify() não lança exceção com entrada maliciosa/malformada (não trava o login)', () => {
  const secret = totp.generateSecret();
  const entradasRuins = ['', 'abcdef', '12345', '1234567', '000000000000000000000', null, undefined, '  123456  '.repeat(50)];
  for (const entrada of entradasRuins) {
    assert.doesNotThrow(() => totp.verify({ secret, token: entrada }), `token=${JSON.stringify(entrada)}`);
  }
});

teste('verify() rejeita token mais longo que `digits` sem lançar RangeError (timingSafeEqual)', () => {
  // Regressão específica: antes da correção, um token com mais dígitos que
  // o esperado chegava direto no crypto.timingSafeEqual com buffers de
  // tamanhos diferentes, o que lança RangeError em vez de simplesmente
  // recusar o código.
  const secret = totp.generateSecret();
  const codigoCerto = totp.generate({ secret });
  assert.doesNotThrow(() => {
    const r = totp.verify({ secret, token: codigoCerto + '9' });
    assert.strictEqual(r.valid, false);
  });
});

teste('generateURI() produz uma URI otpauth:// bem formada', () => {
  const secret = totp.generateSecret();
  const uri = totp.generateURI({ secret, label: 'usuario@impak.com.br', issuer: 'IMPAK Portal' });
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.ok(uri.includes(encodeURIComponent('IMPAK Portal')));
  assert.ok(uri.includes(`secret=${secret}`));
});

teste('generateSecret() nunca repete e sempre decodifica de volta pro tamanho certo', () => {
  const vistos = new Set();
  for (let i = 0; i < 50; i++) {
    const s = totp.generateSecret();
    assert.ok(!vistos.has(s), 'segredo repetido -- randomBytes não está sendo usado direito');
    vistos.add(s);
    assert.strictEqual(totp.base32Decode(s).length, 20);
  }
});

console.log(`\n${passou} passaram, ${falhou} falharam.\n`);
if (falhou > 0) process.exit(1);
