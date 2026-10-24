// Gravação do plano "Atualizar pelo Conexos" (24/10/2026).
// Antes ficava dentro da rota em server.js, gravando um item por vez (587
// produtos levavam ~1 min e o navegador desistia com "Erro de rede" mesmo
// gravando). Aqui: grava em paralelo, poucos por vez, e recebe o banco por
// parâmetro (db) — assim os testes usam um banco de mentira e a rota só monta
// o db com o Supabase. Nunca apaga nada.
'use strict';

// Roda fn(item) para todos os itens, no máximo `limite` ao mesmo tempo.
// Devolve os resultados na mesma ordem dos itens.
async function emParalelo(itens, limite, fn) {
  const lista = Array.isArray(itens) ? itens : [];
  const n = Math.max(1, Math.min(limite || 1, lista.length || 1));
  const saida = new Array(lista.length);
  let proximo = 0;
  async function trabalhador() {
    while (proximo < lista.length) {
      const i = proximo++;
      saida[i] = await fn(lista[i], i);
    }
  }
  await Promise.all(Array.from({ length: n }, trabalhador));
  return saida;
}

function emLotes(lista, tamanho) {
  const lotes = [];
  for (let i = 0; i < (lista || []).length; i += tamanho) lotes.push(lista.slice(i, i + tamanho));
  return lotes;
}

// db (todas devolvem { error } como o Supabase):
//   limparConexos(ids)            → conexos_id = null nos processos
//   atualizarProcesso(id, campos)
//   inserirLogs(linhas)
//   atualizarProduto(id, campos)
//   inserirProdutos(lote)
// r = { tipo: 'processos'|'produtos', plano } (plano de conexos-cadastro.js)
async function aplicarPlanoConexos(r, db, opts) {
  const o = opts || {};
  const agora = o.agora || new Date().toISOString();
  const usuario = o.usuario || null;
  const paralelo = o.paralelo || 10;
  const falhas = [];
  let gravados = 0;

  if (r.tipo === 'processos') {
    const mudar = r.plano.mudar || [];
    // 1º limpa quem vai trocar de código (o banco não aceita o mesmo código em
    // dois processos nem por um instante), depois grava os códigos novos.
    for (const lote of emLotes(mudar.filter(m => m.de).map(m => m.id), 100)) {
      const { error } = await db.limparConexos(lote);
      if (error) throw new Error(error.message || String(error));
    }
    const logs = [];
    await emParalelo(mudar, paralelo, async m => {
      const { error } = await db.atualizarProcesso(m.id, { conexos_id: m.para, updated_at: agora, updated_by: usuario });
      if (error) { falhas.push({ referencia: m.referencia, erro: error.message || String(error) }); return; }
      gravados++;
      logs.push({ processo_id: m.id, usuario, campo: 'conexos_id (planilha do Conexos)', valor_antes: m.de || '', valor_depois: m.para, created_at: agora });
    });
    for (const lote of emLotes(logs, 200)) {
      try {
        const { error } = await db.inserirLogs(lote);
        if (error) falhas.push({ historico: true, erro: error.message || String(error) });
      } catch (e) { falhas.push({ historico: true, erro: e.message }); }
    }
    return { gravados, falhas };
  }

  const atualizar = r.plano.atualizar || [];
  const inserir = r.plano.inserir || [];
  await emParalelo(atualizar, paralelo, async u => {
    const { error } = await db.atualizarProduto(u.id, { ...u.campos, ativo: true, updated_at: agora });
    if (error) falhas.push({ produto: (u.campos && u.campos.descricao) || (u.antes && u.antes.descricao) || u.id, erro: error.message || String(error) });
    else gravados++;
  });
  let n = 0;
  for (const lote of emLotes(inserir, 200)) {
    n++;
    const linhas = lote.map(x => ({ ...x, ativo: true }));
    const { error } = await db.inserirProdutos(linhas);
    if (error) falhas.push({ produto: `lote ${n}`, erro: error.message || String(error) });
    else gravados += linhas.length;
  }
  return { gravados, falhas };
}

module.exports = { emParalelo, emLotes, aplicarPlanoConexos };
