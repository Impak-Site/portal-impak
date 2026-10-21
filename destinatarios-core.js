// destinatarios-core.js
//
// Quem recebe cada e-mail do sistema (21/10/2026, pedido Ayslan): "no
// cadastro, precisamos ter um flag para receber" — cada pessoa (do cliente,
// fornecedor, despachante, transportadora, agente de cargas ou da própria
// IMPAK) marca, por ASSUNTO, se recebe como destinatário (Para) ou em cópia
// (Cópia). Fica em cadastros_pessoas.assuntos_email (migration 0056):
//   { "CAMBIO": "para", "TRANSPORTE": "cc", ... }   (assunto ausente = não recebe)
//
// Regra de montagem de um e-mail (destinatarios()):
//   - entram as pessoas das EMPRESAS envolvidas naquele e-mail (ex.: o
//     cliente do processo; no pedido de carregamento, a transportadora e o
//     despachante) que marcaram o assunto: "para" → Para, "cc" → Cópia;
//   - a equipe IMPAK (funcionários) que marcou o assunto entra sempre em
//     Cópia (num e-mail para fora, a equipe nunca é o destinatário principal);
//   - follow-up: empresa sem ninguém marcado usa o "contato principal" de
//     antes (compatibilidade com o follow-up semanal);
//   - e-mail repetido sai uma vez só; quem está em Para não repete em Cópia.
//
// Mesmo padrão UMD do receita-cnpj.js: o navegador carrega
// <script src="/destinatarios-core.js"> (tela de Pessoas) e o servidor faz
// require('./destinatarios-core.js') (montagem dos e-mails). Sem banco e sem
// rede — testado em testes_cadastros.js.
(function () {
  'use strict';

  const ASSUNTOS_EMAIL = [
    { codigo: 'CAMBIO', nome: 'Adiantamento de câmbio', curto: 'Câmbio',
      dica: 'Pedido de aprovação e depósito para fechar os câmbios: valor FOB por processo, taxa estimada e total em R$.' },
    { codigo: 'TRANSPORTE', nome: 'Transporte rodoviário', curto: 'Transporte',
      dica: 'Qual transportadora vai retirar a carga, pedido de carregamento e agendamento.' },
    { codigo: 'FOLLOWUP', nome: 'Follow-up', curto: 'Follow-up',
      dica: 'Datas de prontidão, embarque e chegada (consolidado por cliente).' },
    { codigo: 'FINANCEIRO', nome: 'Financeiro', curto: 'Financeiro',
      dica: 'Resumo do processo, NF, boleto e pagamentos.' },
    { codigo: 'DESPACHANTE', nome: 'Abertura de processo (despachante)', curto: 'Abertura despachante',
      dica: 'Informações principais e documentos para o despachante abrir o processo.' },
    { codigo: 'INSTRUCAO', nome: 'Instrução de embarque', curto: 'Instrução embarque',
      dica: 'Exportador, importador, notify, containers, Incoterm, contato do exportador e referência (agente de cargas).' },
  ];
  const CODIGOS = ASSUNTOS_EMAIL.map(a => a.codigo);
  const MODOS = ['para', 'cc'];

  function emailValido(e) {
    return /^[^\s@<>(),;:"']+@[^\s@<>(),;:"']+\.[^\s@<>(),;:"']+$/.test(String(e == null ? '' : e).trim());
  }

  // Aceita o que vier da tela/API e devolve só assuntos e modos conhecidos.
  function limparAssuntos(obj) {
    const out = {};
    if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch (e) { obj = null; } }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
    CODIGOS.forEach(c => {
      const v = String(obj[c] == null ? '' : obj[c]).trim().toLowerCase();
      if (MODOS.includes(v)) out[c] = v;
    });
    return out;
  }

  // Para mostrar na lista de pessoas: [{ codigo, nome, curto, modo }].
  function resumoAssuntos(obj) {
    const a = limparAssuntos(obj);
    return ASSUNTOS_EMAIL.filter(x => a[x.codigo]).map(x => ({ codigo: x.codigo, nome: x.nome, curto: x.curto, modo: a[x.codigo] }));
  }

  const ehEquipe = p => String((p && p.tipo) || '').toUpperCase() === 'FUNCIONARIO';
  const ativa = p => p && p.ativo !== false;

  // assunto: código (ex.: 'TRANSPORTE'); pessoas: linhas de cadastros_pessoas;
  // empresas: ids (ou [{id}]) das empresas a quem o e-mail se dirige (ex.: o
  //   cliente) — quem marcou o assunto entra como marcou (Para ou Cópia);
  // opts: { equipe: true (funcionários marcados em Cópia),
  //         fallbackPrincipal: false (empresa sem ninguém em Para usa o principal),
  //         empresasCopia: [] (terceiros do processo — despachante, transportadora,
  //           agente — cujos marcados entram sempre em Cópia) }
  // → { para: [{nome,email,empresaId,origem}], cc: [...], semDestinatario: [empresaId] }
  function destinatarios(assunto, pessoas, empresas, opts) {
    opts = opts || {};
    const codigo = String(assunto || '').toUpperCase();
    const idsDe = lista => new Set((lista || []).map(e => (e && typeof e === 'object') ? e.id : e).filter(Boolean).map(String));
    const ids = idsDe(empresas);
    const idsCopia = idsDe(opts.empresasCopia);
    const para = [], cc = [], vistos = new Map();
    const incluir = (lista, p, origem) => {
      const email = String(p.email || '').trim();
      if (!emailValido(email)) return;
      const k = email.toLowerCase();
      if (vistos.has(k)) {
        // Já está em Cópia e agora apareceu como Para → sobe para Para.
        if (lista === para && vistos.get(k) === 'cc') {
          const i = cc.findIndex(x => x.email.toLowerCase() === k);
          if (i >= 0) para.push(cc.splice(i, 1)[0]);
          vistos.set(k, 'para');
        }
        return;
      }
      vistos.set(k, lista === para ? 'para' : 'cc');
      lista.push({ nome: String(p.nome || '').trim(), email, empresaId: p.empresa_id || null, origem });
    };
    const ativas = (pessoas || []).filter(ativa);
    ativas.forEach(p => {
      const modo = limparAssuntos(p.assuntos_email)[codigo];
      if (!modo) return;
      if (p.empresa_id && ids.has(String(p.empresa_id))) incluir(modo === 'para' ? para : cc, p, 'empresa');
    });
    ativas.forEach(p => {
      if (!p.empresa_id || ids.has(String(p.empresa_id)) || !idsCopia.has(String(p.empresa_id))) return;
      if (limparAssuntos(p.assuntos_email)[codigo]) incluir(cc, p, 'copia');
    });
    if (opts.fallbackPrincipal) {
      ids.forEach(id => {
        const temPara = para.some(x => String(x.empresaId) === id);
        if (temPara) return;
        ativas.filter(p => String(p.empresa_id) === id && p.principal).forEach(p => incluir(para, p, 'principal'));
      });
    }
    if (opts.equipe !== false) {
      ativas.forEach(p => {
        if (!ehEquipe(p)) return;
        if (limparAssuntos(p.assuntos_email)[codigo]) incluir(cc, p, 'equipe');
      });
    }
    const semDestinatario = [...ids].filter(id => !para.some(x => String(x.empresaId) === id));
    return { para, cc, semDestinatario };
  }

  // "Nome <a@b.com>; c@d.com, Outro Nome <e@f.com>" (linha Para/Cc copiada de
  // um e-mail) → [{ nome, email }] sem repetidos. Usado no "colar e-mails" do
  // cadastro de pessoas.
  function extrairContatos(texto) {
    const out = [], vistos = new Set();
    const partes = String(texto == null ? '' : texto).split(/[;,\n]+/);
    partes.forEach(parte => {
      const m = parte.match(/[^\s<>"'(),;:]+@[^\s<>"'(),;:]+\.[^\s<>"'(),;:]+/);
      if (!m) return;
      const email = m[0].replace(/[.]+$/, '').trim();
      if (!emailValido(email)) return;
      const k = email.toLowerCase();
      if (vistos.has(k)) return;
      vistos.add(k);
      let nome = parte.replace(m[0], '').replace(/[<>"'()]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!nome) nome = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      out.push({ nome, email: k });
    });
    return out;
  }

  // "Colar e-mails" no cadastro da empresa: texto colado + pessoas que a
  // empresa já tem + assuntos marcados → o que fazer com cada contato:
  //   novo      → cria a pessoa com os assuntos marcados;
  //   atualizar → já existe (mesmo e-mail): soma os assuntos marcados aos que
  //               ela já tinha (o marcado agora vale);
  //   igual     → já existe e já recebe exatamente isso (nada a fazer);
  //   equipe    → e-mail da própria IMPAK (opts.dominioEquipe): não entra como
  //               contato da empresa — funcionário é cadastrado em Funcionários.
  function planoColarContatos(texto, pessoasDaEmpresa, assuntos, opts) {
    opts = opts || {};
    const marcar = limparAssuntos(assuntos);
    const dominio = String(opts.dominioEquipe || '').trim().toLowerCase().replace(/^@/, '');
    const porEmail = new Map();
    (pessoasDaEmpresa || []).filter(ativa).forEach(p => {
      const k = String(p.email || '').trim().toLowerCase();
      if (k && !porEmail.has(k)) porEmail.set(k, p);
    });
    return extrairContatos(texto).map(c => {
      if (dominio && c.email.endsWith('@' + dominio)) return { acao: 'equipe', nome: c.nome, email: c.email, assuntos_email: {} };
      const p = porEmail.get(c.email);
      if (!p) return { acao: 'novo', nome: c.nome, email: c.email, assuntos_email: marcar };
      const antes = limparAssuntos(p.assuntos_email);
      const depois = limparAssuntos(Object.assign({}, antes, marcar));
      const igual = JSON.stringify(antes) === JSON.stringify(depois);
      return { acao: igual ? 'igual' : 'atualizar', id: p.id, nome: String(p.nome || c.nome), email: c.email, assuntos_email: depois };
    });
  }

  // "Nome <email>; outro@x.com" — para mostrar Para/Cópia num aviso ou prévia.
  function textoLista(lista) {
    return (lista || []).map(x => x && x.email ? (x.nome ? `${x.nome} <${x.email}>` : x.email) : '').filter(Boolean).join('; ');
  }

  const DestinatariosCore = { ASSUNTOS_EMAIL, CODIGOS, MODOS, emailValido, limparAssuntos, resumoAssuntos, destinatarios, extrairContatos, planoColarContatos, textoLista };
  if (typeof module !== 'undefined' && module.exports) module.exports = DestinatariosCore;
  if (typeof window !== 'undefined') window.DestinatariosCore = DestinatariosCore;
})();
