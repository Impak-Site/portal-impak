// conexos-id.js — "ID no Conexos" nunca repetido entre processos
// (21/10/2026, pedido Emanuelly: "consegue colocar uma regra pra nunca deixar
// repetir o numero?" — "O número do conexo nunca pode existir dois iguais").
//
// O ID no Conexos é o número do MESMO processo lá no Conexos Cloud: cada
// processo tem o seu. Para comparar, ignora espaços, zeros à esquerda
// ("0123" = "123") e maiúsculas/minúsculas. Vale também contra processo
// cancelado — o número continua sendo daquele processo no Conexos.
//
// Quem confere: o painel (antes de salvar e enquanto digita), o servidor
// (POST /api/controle/v2/processo) e o banco (migration 0057: índice único
// com esta mesma regra — se mudar aqui, mude lá também).
//
// UMD: navegador (<script src="/conexos-id.js">, window.ConexosId) e Node
// (require). Testes em testes_revisao.js.
(function () {
  'use strict';

  // Forma usada na comparação ('' = sem ID).
  function chave(v) {
    const s = String(v == null ? '' : v).replace(/\s+/g, '');
    if (!s) return '';
    if (/^\d+$/.test(s)) return s.replace(/^0+/, '') || '0';
    return s.toUpperCase();
  }

  // Outro processo (id diferente) com o mesmo ID no Conexos, ou null.
  function processoComMesmoId(processos, valor, idAtual) {
    const k = chave(valor);
    if (!k) return null;
    return (processos || []).find(p => p && p.id !== idAtual && chave(p.conexos_id) === k) || null;
  }

  function mensagemRepetido(valor, outro) {
    const ref = (outro && outro.referencia) || 'outro processo';
    const cancelado = outro && outro.cancelado ? ' (cancelado)' : '';
    return 'O ID no Conexos ' + String(valor == null ? '' : valor).trim() + ' já está no processo ' + ref + cancelado +
      '. Cada processo tem um número próprio no Conexos — confira o número. Se ele for mesmo deste processo, apague o ID no ' + ref + ' primeiro.';
  }

  // Grupos de processos com o mesmo ID (conferência dos dados).
  function repetidos(processos) {
    const grupos = new Map();
    (processos || []).forEach(p => {
      const k = chave(p && p.conexos_id);
      if (!k) return;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(p);
    });
    return [...grupos.entries()].filter(([, l]) => l.length > 1).map(([k, l]) => ({ chave: k, processos: l }));
  }

  const ConexosId = { chave, processoComMesmoId, mensagemRepetido, repetidos };
  if (typeof module !== 'undefined' && module.exports) module.exports = ConexosId;
  if (typeof window !== 'undefined') window.ConexosId = ConexosId;
})();
