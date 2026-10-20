// receita-cnpj.js
//
// Consulta pública do CNPJ (BrasilAPI, que devolve a base da Receita
// Federal) e a regra de como completar o cadastro com ela — 20/10/2026,
// pedido Ayslan: os cadastros importados do Conexos vieram só com razão
// social, cidade e UF (sem nome fantasia, endereço, CEP...).
//
// Mesmo padrão UMD do listas-padrao.js: o navegador carrega
// <script src="/receita-cnpj.js"> e o servidor faz require('./receita-cnpj.js').
// A CONSULTA roda sempre no navegador (botão "Receita" do cadastro e o
// "Arrumar" em lote): a BrasilAPI recusa (403) as consultas que saem do
// servidor do portal. O servidor só recebe o resultado, limpa
// (limparDadosReceita), confere se é do mesmo CNPJ e grava com
// completarComReceita. A parte de mapear/limpar/completar é pura (testada em
// testes_cadastros.js, sem rede).
(function () {
  function soDigitos(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
  function chave(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim(); }
  function formatarCep(v) { const d = soDigitos(v); return d.length === 8 ? d.slice(0, 5) + '-' + d.slice(5) : String(v == null ? '' : v).trim(); }
  function formatarTelefone(v) {
    const d = soDigitos(v);
    if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    return String(v == null ? '' : v).trim();
  }
  function texto(v) { const t = String(v == null ? '' : v).trim(); return /^\*+$/.test(t) ? '' : t; }

  // Resposta da BrasilAPI (/api/cnpj/v1/<cnpj>) → campos do cadastro.
  // A Receita guarda o tipo do logradouro à parte ("RUA" + "XV DE NOVEMBRO").
  function mapearDadosReceita(j) {
    j = j || {};
    const tipoLog = texto(j.descricao_tipo_de_logradouro);
    let logradouro = texto(j.logradouro);
    if (tipoLog && logradouro && !chave(logradouro).startsWith(chave(tipoLog))) logradouro = tipoLog + ' ' + logradouro;
    return {
      cnpj: soDigitos(j.cnpj),
      razao_social: texto(j.razao_social),
      nome_fantasia: texto(j.nome_fantasia),
      logradouro,
      numero: texto(j.numero),
      complemento: texto(j.complemento),
      bairro: texto(j.bairro),
      cidade: texto(j.municipio),
      uf: texto(j.uf).toUpperCase(),
      cep: formatarCep(j.cep),
      telefone: formatarTelefone(j.ddd_telefone_1 || j.ddd_telefone_2),
      email: texto(j.email).toLowerCase(),
      situacao: texto(j.descricao_situacao_cadastral),
    };
  }

  // Campos que o lote completa sozinho. E-mail e telefone da Receita costumam
  // ser os do contador — esses só entram pelo botão do cadastro, com a
  // pessoa vendo antes de salvar.
  const CAMPOS_LOTE = ['nome_fantasia', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'cep'];
  const CAMPOS_TELA = CAMPOS_LOTE.concat(['telefone', 'email']);
  const CAMPOS_COMPARAR = ['cidade', 'uf', 'cep'];

  // O lote consulta no navegador e manda o resultado pro servidor gravar. O
  // servidor não confia no formato: só os campos conhecidos, em texto, com
  // tamanho limitado; UF, CEP, telefone e e-mail só se tiverem o formato certo.
  const CAMPOS_DADOS = ['razao_social', 'nome_fantasia', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'cep', 'telefone', 'email', 'situacao'];
  function limparDadosReceita(d) {
    d = d && typeof d === 'object' ? d : {};
    const out = { cnpj: soDigitos(typeof d.cnpj === 'string' || typeof d.cnpj === 'number' ? d.cnpj : '').slice(0, 14) };
    CAMPOS_DADOS.forEach(k => {
      const v = d[k];
      out[k] = typeof v === 'string' || typeof v === 'number' ? texto(v).replace(/\s+/g, ' ').slice(0, 150) : '';
    });
    out.uf = /^[A-Za-z]{2}$/.test(out.uf) ? out.uf.toUpperCase() : '';
    out.cep = soDigitos(out.cep).length === 8 ? formatarCep(out.cep) : '';
    const tel = soDigitos(out.telefone);
    out.telefone = tel.length === 10 || tel.length === 11 ? formatarTelefone(tel) : '';
    out.email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email) ? out.email.toLowerCase() : '';
    return out;
  }

  // Completa o cadastro com os dados da Receita SEM apagar nem trocar o que
  // já foi digitado. Razão social: só troca quando a nossa é o começo da da
  // Receita (o Conexos corta o nome em 35 letras) — a antiga vira sinônimo,
  // pro processo que tem o nome cortado continuar achando o cadastro.
  // Nome fantasia de ARMADOR não entra: pro armador ele é o nome curto que vai
  // pro processo (ex.: PIL), escolhido pelo time.
  // Devolve { alteracoes (só o que muda), preenchidos (nomes dos campos),
  // divergencias [{campo, atual, receita}] }.
  function completarComReceita(contato, receita, opts) {
    opts = opts || {};
    const c = contato || {}, r = receita || {};
    const campos = opts.campos || CAMPOS_LOTE;
    const papeis = [c.tipo].concat(Array.isArray(c.papeis) ? c.papeis : []).map(p => String(p || '').toUpperCase());
    const ehArmador = papeis.includes('ARMADOR');
    const alteracoes = {}, preenchidos = [], divergencias = [];
    campos.forEach(k => {
      if (k === 'nome_fantasia' && ehArmador) return;
      const novo = r[k];
      if (!novo) return;
      const atual = String(c[k] == null ? '' : c[k]).trim();
      if (!atual) { alteracoes[k] = novo; preenchidos.push(k); return; }
      if (CAMPOS_COMPARAR.includes(k) && chave(atual).replace(/ /g, '') !== chave(novo).replace(/ /g, '')) divergencias.push({ campo: k, atual, receita: novo });
    });
    const rsAtual = String(c.razao_social == null ? '' : c.razao_social).trim();
    if (r.razao_social) {
      const a = chave(rsAtual), b = chave(r.razao_social);
      if (!a) { alteracoes.razao_social = r.razao_social; preenchidos.push('razao_social'); }
      else if (a !== b) {
        if (a.length >= 10 && b.startsWith(a)) {
          alteracoes.razao_social = r.razao_social; preenchidos.push('razao_social');
          const sin = Array.isArray(c.sinonimos) ? c.sinonimos.slice() : [];
          if (!sin.some(s => chave(s) === a)) sin.push(rsAtual);
          alteracoes.sinonimos = sin;
        } else {
          divergencias.push({ campo: 'razao_social', atual: rsAtual, receita: r.razao_social });
        }
      }
    }
    return { alteracoes, preenchidos, divergencias };
  }

  // Busca na BrasilAPI. opts.fetch permite testar sem rede; no servidor e no
  // navegador usa o fetch global. Nunca lança: devolve { ok, status, dados, erro }.
  async function buscarCnpjReceita(cnpj, opts) {
    opts = opts || {};
    const d = soDigitos(cnpj);
    if (d.length !== 14) return { ok: false, status: 0, erro: 'CNPJ precisa ter 14 dígitos.' };
    const f = opts.fetch || (typeof fetch === 'function' ? fetch : null);
    if (!f) return { ok: false, status: 0, erro: 'Consulta indisponível neste ambiente.' };
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs || 8000) : null;
    try {
      const resp = await f('https://brasilapi.com.br/api/cnpj/v1/' + d, ctrl ? { signal: ctrl.signal, headers: { Accept: 'application/json' } } : { headers: { Accept: 'application/json' } });
      if (resp.status === 404 || resp.status === 400) return { ok: false, status: resp.status, erro: 'CNPJ não encontrado na base pública da Receita.' };
      if (!resp.ok) return { ok: false, status: resp.status, erro: 'Consulta da Receita indisponível agora (' + resp.status + ').' };
      const j = await resp.json();
      return { ok: true, status: resp.status, dados: mapearDadosReceita(j) };
    } catch (e) {
      return { ok: false, status: 0, erro: e && e.name === 'AbortError' ? 'A consulta da Receita demorou demais.' : 'Falha ao consultar a Receita.' };
    } finally { if (t) clearTimeout(t); }
  }

  const ReceitaCNPJ = { mapearDadosReceita, limparDadosReceita, completarComReceita, buscarCnpjReceita, formatarCep, formatarTelefone, CAMPOS_LOTE, CAMPOS_TELA };
  if (typeof module !== 'undefined' && module.exports) module.exports = ReceitaCNPJ;
  if (typeof window !== 'undefined') window.ReceitaCNPJ = ReceitaCNPJ;
})();
