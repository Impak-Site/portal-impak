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
//
// 20/10/2026: o dígito verificador, a correção de documentos importados
// (CNPJ sem zeros à esquerda, CPF no formato do Conexos) e a máscara moram
// em ../documento-br.js, que o navegador também carrega — a tela e o
// servidor usam exatamente a mesma regra.

const DocumentoBR = require('../documento-br.js');
const { digitoVerificadorValido_CPF, digitoVerificadorValido_CNPJ, normalizarDocumento, formatarDocumento } = DocumentoBR;

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

module.exports = { digitoVerificadorValido_CPF, digitoVerificadorValido_CNPJ, validarDocumento, normalizarDocumento, formatarDocumento };
