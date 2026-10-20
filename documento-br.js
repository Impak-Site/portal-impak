// documento-br.js
//
// CNPJ/CPF: dígito verificador, correção de documentos importados e máscara.
// Um arquivo só (mesmo padrão UMD do listas-padrao.js), usado pelo servidor
// (require('./documento-br.js'), via lib/validacao-documento.js) e pelo
// navegador (<script src="/documento-br.js">, tela de Cadastros).
//
// Por que existe (20/10/2026, pedido Ayslan): os cadastros importados do
// Conexos vieram com o documento "corrido" e, em muitos casos, errado:
//  - CNPJ sem os zeros à esquerda (a planilha leu o número como número:
//    13 dígitos em vez de 14) — a consulta da Receita exige 14 dígitos, então
//    nunca disparava, e a tela não conseguia pôr a máscara;
//  - CPF no formato do Conexos: os 9 primeiros dígitos do CPF + "0000" + os
//    2 dígitos verificadores (15 dígitos, às vezes também sem os zeros à
//    esquerda), gravado como se fosse empresa.
// normalizarDocumento() corrige esses dois casos SÓ quando o dígito
// verificador confirma; qualquer outra coisa volta como veio (só os
// dígitos) e a validação de sempre decide.
(function () {
  function soDigitos(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }

  function digitoVerificadorValido_CPF(cpf) {
    cpf = soDigitos(cpf);
    if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
    let soma = 0;
    for (let i = 0; i < 9; i++) soma += parseInt(cpf[i], 10) * (10 - i);
    let resto = (soma * 10) % 11; if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cpf[9], 10)) return false;
    soma = 0;
    for (let i = 0; i < 10; i++) soma += parseInt(cpf[i], 10) * (11 - i);
    resto = (soma * 10) % 11; if (resto === 10 || resto === 11) resto = 0;
    return resto === parseInt(cpf[10], 10);
  }

  function digitoVerificadorValido_CNPJ(cnpj) {
    cnpj = soDigitos(cnpj);
    if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
    const calc = (base) => {
      let tamanho = base.length, pos = tamanho - 7, soma = 0;
      for (let i = tamanho; i >= 1; i--) { soma += base.charAt(tamanho - i) * pos--; if (pos < 2) pos = 9; }
      return soma % 11 < 2 ? 0 : 11 - (soma % 11);
    };
    const d1 = calc(cnpj.substring(0, 12));
    if (d1 !== parseInt(cnpj.charAt(12), 10)) return false;
    const d2 = calc(cnpj.substring(0, 12) + d1);
    return d2 === parseInt(cnpj.charAt(13), 10);
  }

  function ehBrasil(pais) {
    const p = String(pais == null ? '' : pais).trim().toLowerCase();
    return !p || p === 'brasil' || p === 'brazil';
  }

  // Devolve { documento (só dígitos, no Brasil), tipo_pessoa, correcao }.
  // correcao: null | 'zeros_cnpj' (CNPJ completado com zeros à esquerda) |
  // 'cpf_conexos' (CPF no formato do Conexos → CPF de 11 dígitos, pessoa física).
  function normalizarDocumento(tipoPessoa, pais, documento) {
    const tipo = tipoPessoa === 'FISICA' ? 'FISICA' : 'JURIDICA';
    const bruto = documento == null ? '' : String(documento);
    if (!ehBrasil(pais)) return { documento: bruto.trim(), tipo_pessoa: tipo, correcao: null };
    const d = soDigitos(bruto);
    const comoVeio = { documento: d, tipo_pessoa: tipo, correcao: null };
    if (!d) return comoVeio;
    if (tipo === 'FISICA' && d.length === 11) return comoVeio;
    if (tipo === 'JURIDICA' && d.length === 14 && digitoVerificadorValido_CNPJ(d)) return comoVeio;
    if (tipo === 'JURIDICA' && d.length < 14) {
      const cnpj = d.padStart(14, '0');
      if (digitoVerificadorValido_CNPJ(cnpj)) return { documento: cnpj, tipo_pessoa: 'JURIDICA', correcao: 'zeros_cnpj' };
    }
    if (d.length >= 7 && d.length <= 15) {
      const p = d.padStart(15, '0');
      const cpf = p.slice(0, 9) + p.slice(13, 15);
      if (p.slice(9, 13) === '0000' && digitoVerificadorValido_CPF(cpf)) return { documento: cpf, tipo_pessoa: 'FISICA', correcao: 'cpf_conexos' };
    }
    return comoVeio;
  }

  // Máscara pra mostrar: 00.000.000/0000-00 (14 dígitos) ou 000.000.000-00
  // (11 dígitos). Documento do exterior ou incompleto volta como está.
  function formatarDocumento(documento) {
    const d = soDigitos(documento);
    if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    return String(documento == null ? '' : documento).trim();
  }

  const DocumentoBR = { soDigitos, digitoVerificadorValido_CPF, digitoVerificadorValido_CNPJ, ehBrasil, normalizarDocumento, formatarDocumento };
  if (typeof module !== 'undefined' && module.exports) module.exports = DocumentoBR;
  if (typeof window !== 'undefined') window.DocumentoBR = DocumentoBR;
})();
