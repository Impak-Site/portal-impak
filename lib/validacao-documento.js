// lib/validacao-documento.js
//
// Validação de CNPJ/CPF por dígito verificador — extraído do server.js
// pra poder ser testado isoladamente (node testes_cadastros.js), no mesmo
// espírito do lib/totp.js: lógica pura, sem depender do Express/Supabase
// pra ser carregada.
//
// Regra de negócio (pedido do Ayslan, 12/09/2026): empresa brasileira
// exige CNPJ, pessoa física exige CPF, e empresa/pessoa do exterior não
// tem regra de documento por enquanto.

function digitoVerificadorValido_CPF(cpf){
  cpf = String(cpf || '').replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(cpf[i], 10) * (10 - i);
  let resto = (soma * 10) % 11; if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf[9], 10)) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(cpf[i], 10) * (11 - i);
  resto = (soma * 10) % 11; if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf[10], 10)) return false;
  return true;
}

function digitoVerificadorValido_CNPJ(cnpj){
  cnpj = String(cnpj || '').replace(/\D/g, '');
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
  const calc = (base) => {
    let tamanho = base.length, pos = tamanho - 7, soma = 0;
    for (let i = tamanho; i >= 1; i--) { soma += base.charAt(tamanho - i) * pos--; if (pos < 2) pos = 9; }
    return soma % 11 < 2 ? 0 : 11 - (soma % 11);
  };
  const d1 = calc(cnpj.substring(0, 12));
  if (d1 !== parseInt(cnpj.charAt(12), 10)) return false;
  const d2 = calc(cnpj.substring(0, 12) + d1);
  if (d2 !== parseInt(cnpj.charAt(13), 10)) return false;
  return true;
}

// Retorna string de erro (pra devolver ao front) ou null se estiver ok/isento de regra.
function validarDocumento(tipoPessoa, pais, documento){
  const paisNorm = (pais || 'Brasil').trim().toLowerCase();
  if (paisNorm !== 'brasil') return null; // exterior: nenhuma regra por enquanto
  const doc = String(documento || '').replace(/\D/g, '');
  if (tipoPessoa === 'FISICA') {
    if (!doc) return 'CPF é obrigatório para pessoa física no Brasil.';
    if (!digitoVerificadorValido_CPF(doc)) return 'CPF inválido — confira os números digitados.';
    return null;
  }
  if (!doc) return 'CNPJ é obrigatório para empresa brasileira.';
  if (!digitoVerificadorValido_CNPJ(doc)) return 'CNPJ inválido — confira os números digitados.';
  return null;
}

module.exports = { digitoVerificadorValido_CPF, digitoVerificadorValido_CNPJ, validarDocumento };
