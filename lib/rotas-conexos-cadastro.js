// Rotas "Atualizar pelo Conexos" (Catálogo de Produtos → botão ⬆).
// Saíram do server.js em 24/10/2026 (primeiro bloco do server.js num arquivo
// próprio). O server.js chama registrar(app, deps) passando o que já tem.
'use strict';
const ConexosCadastro = require('../conexos-cadastro.js');
const ConexosAplicar = require('./conexos-aplicar.js');

function registrar(app, deps) {
  const { auth, sb, lerPlanilhaIsolada, buscarTodosProcessos, RefProcesso } = deps;
  // ── CÓDIGOS DO CONEXOS (23/10/2026, pedido do Jean) ──────────────────────
  // Sobe a planilha que o Conexos exporta — Processos (CadProcessos: "Cód.
  // Processo" × "Referência Externa") ou Produtos (CadProdutos: "Produto" ×
  // "Descrição Produto" × "Cód. Externo") — e atualiza o ID no Conexos dos
  // processos ou o Catálogo de Produtos. Sempre em 2 passos: prévia (não grava
  // nada) e aplicar (grava o mesmo plano). Regras em conexos-cadastro.js.
  // O "banco" que lib/conexos-aplicar.js usa — aqui, o Supabase.
  function dbConexos() {
    return {
      limparConexos: ids => sb().from('controle_processos').update({ conexos_id: null }).in('id', ids),
      atualizarProcesso: (id, campos) => sb().from('controle_processos').update(campos).eq('id', id),
      inserirLogs: linhas => sb().from('controle_log').insert(linhas),
      atualizarProduto: (id, campos) => sb().from('catalogo_produtos').update(campos).eq('id', id),
      inserirProdutos: lote => sb().from('catalogo_produtos').insert(lote),
    };
  }
  async function planoCadastroConexos(arquivo_base64) {
    if (!arquivo_base64) return { erro: 'Nenhum arquivo enviado.' };
    const lido = await lerPlanilhaIsolada('lerCadastroConexos', Buffer.from(arquivo_base64, 'base64'));
    if (!lido || lido.erro || !lido.tipo) return { erro: (lido && lido.erro) || 'Planilha não reconhecida.' };
    if (lido.tipo === 'processos') {
      const { data: processos, error } = await buscarTodosProcessos('id, referencia, conexos_id, fechado, cancelado');
      if (error) throw new Error(error.message);
      return { tipo: 'processos', linhas: lido.itens.length, plano: ConexosCadastro.planoProcessos(lido.itens, processos || [], RefProcesso) };
    }
    const catalogo = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await sb().from('catalogo_produtos').select('id, descricao, codigo_interno, codigo_conexos').order('id').range(offset, offset + 999);
      if (error) throw new Error(error.message);
      catalogo.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return { tipo: 'produtos', linhas: lido.itens.length, plano: ConexosCadastro.planoProdutos(lido.itens, catalogo) };
  }
  function resumoPlanoConexos(r) {
    const p = r.plano, corta = (l, n) => (l || []).slice(0, n || 300);
    if (r.tipo === 'processos') return { tipo: r.tipo, linhas: r.linhas,
      contagem: { mudar: p.mudar.length, iguais: p.iguais.length, nao_encontrados: p.nao_encontrados.length, ambiguos: p.ambiguos.length, conflitos: p.conflitos.length },
      mudar: corta(p.mudar), conflitos: corta(p.conflitos), ambiguos: corta(p.ambiguos, 100), nao_encontrados: corta(p.nao_encontrados, 100) };
    return { tipo: r.tipo, linhas: r.linhas,
      contagem: { inserir: p.inserir.length, atualizar: p.atualizar.length, iguais: p.iguais.length, avisos: p.avisos.length },
      inserir: corta(p.inserir, 100), atualizar: corta(p.atualizar, 200), avisos: corta(p.avisos, 100) };
  }
  app.post('/api/conexos/cadastro/previa', auth('tyredesk', 'controle'), async (req, res) => {
    try {
      const r = await planoCadastroConexos(req.body && req.body.arquivo_base64);
      if (r.erro) return res.status(400).json({ ok: false, erro: r.erro });
      res.json({ ok: true, ...resumoPlanoConexos(r) });
    } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
  });
  app.post('/api/conexos/cadastro/aplicar', auth('tyredesk', 'controle'), async (req, res) => {
    try {
      const r = await planoCadastroConexos(req.body && req.body.arquivo_base64);
      if (r.erro) return res.status(400).json({ ok: false, erro: r.erro });
      const usuario = req.session.usuario;
      // Gravação em lib/conexos-aplicar.js (paralelo, testada com banco de mentira).
      const { gravados, falhas } = await ConexosAplicar.aplicarPlanoConexos(r, dbConexos(), { usuario });
      console.log(`conexos/cadastro/aplicar (${r.tipo}): ${gravados} gravados, ${falhas.length} falha(s), por ${usuario}`);
      res.json({ ok: true, ...resumoPlanoConexos(r), gravados, falhas });
    } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
  });
}

module.exports = { registrar };
