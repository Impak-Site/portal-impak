// conferencia-chave.js — identificação estável das divergências da
// Conferência documental (usado no navegador E no servidor).
//
// Por que existe (06/10/2026): o aceite de uma divergência era gravado pela
// POSIÇÃO dela na lista ("grupo 2, item 3"). Ao rodar uma conferência nova
// (ex.: chegou o BL original), a IA devolve a lista em outra ordem, mas os
// aceites antigos eram copiados pelas mesmas posições — uma divergência nova
// podia aparecer como "aceita" sem ninguém ter aceitado, e uma já aceita
// voltava como pendente. Agora a chave é o CONTEÚDO da divergência: campo,
// documentos comparados e os valores de cada um. Um aceite só se repete se a
// divergência for exatamente a mesma; se um valor mudar, precisa aceitar de
// novo.
//
// Compatibilidade: análises gravadas antes desta mudança (sem chaveVersao 2)
// continuam lendo os aceites antigos pela posição — era o que a tela mostrava
// pra elas. Ao rodar uma conferência nova por cima, os aceites antigos são
// convertidos pela análise em que foram feitos (migrarAceites).
(function (root) {
  function normalizar(v) {
    return String(v == null ? '' : v)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function chaveDivergencia(c) {
    c = c || {};
    return 'k' + hash([c.campo, c.doc1_label, c.doc1_valor, c.doc2_label, c.doc2_valor].map(normalizar).join('|'));
  }
  // ── Regras dispensadas (19/10/2026, pedido Emanuelly) ──────────────
  // 1) NCM no BL: o BL sempre traz só a posição de 4 dígitos (ex.: 4011).
  //    "NCM incompleto no BL" não é pendência. Continua pendência se a
  //    posição de 4 dígitos do BL for diferente da CI/PI (ex.: 4012 x 4011).
  // 2) Porto de destino: muda entre PI, CI, PL e Draft BL na maioria das
  //    vezes — porto diferente entre esses documentos não é pendência. É
  //    pendência se algum documento trouxer porto de destino FORA de Santa
  //    Catarina.
  // 3) (20/10/2026, Emanuelly) Nos documentos FINAIS — BL original/emitido,
  //    CE Mercante e DI/DUIMP — o porto de destino TEM que ser o mesmo:
  //    porto diferente entre dois documentos finais continua pendência, mesmo
  //    com os dois em SC. O mesmo porto escrito de outro jeito (NAVEGANTES x
  //    "BRNVT001 - TERMINAL PORTONAVE") não é pendência.
  const PORTOS_SC = ['ITAJAI', 'NAVEGANTES', 'PORTONAVE', 'ITAPOA', 'IMBITUBA', 'SAO FRANCISCO DO SUL',
    'BRITJ', 'BRNVT', 'BRIOA', 'BRIBB', 'BRSFS'];
  // Nomes e códigos (UN/LOCODE) de cada porto de SC.
  const PORTOS_CODIGO = [
    ['NVT', ['PORTONAVE', 'NAVEGANTES', 'BRNVT']],
    ['IOA', ['ITAPOA', 'BRIOA']],
    ['IBB', ['IMBITUBA', 'BRIBB']],
    ['SFS', ['SAO FRANCISCO DO SUL', 'BRSFS']],
    ['ITJ', ['ITAJAI', 'BRITJ']],
  ];
  function maiusculo(v) { return normalizar(v).toUpperCase(); }
  function contemPorto(t, p) {
    return (' ' + t + ' ').includes(' ' + p + ' ') || t.replace(/\s/g, '').includes(p.replace(/\s/g, ''));
  }
  function ehPortoSC(v) {
    const t = maiusculo(v).replace(/[^A-Z0-9 ]/g, ' ');
    return PORTOS_SC.some(p => contemPorto(t, p));
  }
  // Portos de SC citados no texto (códigos). A DI/DUIMP às vezes traz só a
  // Alfândega (URF): a de Itajaí atende Itajaí e Navegantes; a de São
  // Francisco do Sul atende São Francisco e Itapoá.
  function portosDoTexto(v) {
    const t = maiusculo(v).replace(/[^A-Z0-9 ]/g, ' ');
    const s = new Set();
    PORTOS_CODIGO.forEach(([cod, nomes]) => { if (nomes.some(n => contemPorto(t, n))) s.add(cod); });
    if (/\b(ALFANDEGA|ALF|URF|RECEITA FEDERAL)\b/.test(t)) {
      if (s.has('ITJ')) s.add('NVT');
      if (s.has('SFS')) s.add('IOA');
    }
    return s;
  }
  // Mesmo porto? Pelos códigos (basta um em comum, para textos que citam
  // dois nomes, ex.: "ITAJAI (PORTONAVE)"); sem porto conhecido, pelo texto.
  function mesmoPorto(a, b) {
    const pa = portosDoTexto(a), pb = portosDoTexto(b);
    if (pa.size && pb.size) return [...pa].some(x => pb.has(x));
    const limpar = v => maiusculo(v).replace(/[^A-Z0-9 ]/g, ' ')
      .replace(/\b(PORTO|PORT|OF|DE|DO|DA|BRAZIL|BRASIL|BR|SC|PR|SP|RS|RJ)\b/g, ' ').replace(/\s+/g, ' ').trim();
    return !!limpar(a) && limpar(a) === limpar(b);
  }
  // Documento final: BL emitido (não o draft), CE Mercante ou DI/DUIMP.
  function ehDocFinal(label) {
    const t = maiusculo(label).replace(/[^A-Z0-9 ]/g, ' ');
    if (/\b(CE|MERCANTE|DUIMP|DI|DECLARACAO DE IMPORTACAO)\b/.test(t)) return true;
    if (/\b(DRAFT|RASCUNHO|MINUTA|PREVIA|PRELIMINAR)\b/.test(t)) return false;
    return /\b(BL|HBL|MBL|B L|BILL OF LADING|CONHECIMENTO DE EMBARQUE)\b/.test(t);
  }
  function textoDa(c) { return maiusculo([c.campo, c.doc1_label, c.doc2_label, c.observacao].join(' ')); }
  function ehCampoPortoDestino(c) {
    const campo = maiusculo(c.campo);
    if (!/PORT/.test(campo)) return false;
    if (/ORIGEM|ORIGIN|EMBARQUE|LOADING|FOB|SAIDA/.test(campo)) return false;
    return /DESTIN|DESCARGA|DISCHARGE|DELIVERY|DESEMBARQUE|CHEGADA/.test(campo) || campo.trim() === 'PORTO';
  }
  // ── CE Mercante (21/10/2026, pedido Emanuelly) ─────────────────────
  // 4) A situação de pagamento do CE ("SUSPENSO DE PAGAMENTO", suspensão,
  //    pendente de pagamento, sem cobertura cambial — é o AFRMM/frete no
  //    Mercante) não é conferência de documentos: "é referente a outra coisa".
  // 5) "No CE não vai lacre": o CE Mercante não traz lacre (e o extrato nem
  //    sempre mostra os containers). Container/lacre "não informado" no CE, ou
  //    lacre comparado com o CE, não é pendência — container e lacre se
  //    conferem entre BL, PL e CI. Continua pendência se o CE mostrar um
  //    container que não está no outro documento.
  const ehLabelCE = l => /\b(CE|MERCANTE)\b/.test(maiusculo(l).replace(/[^A-Z0-9 ]/g, ' '));
  function ehSituacaoPagamentoCE(c) {
    // O CE tem que estar no campo ou num dos documentos comparados (não só
    // citado na observação) — "Forma de pagamento" CI x PI continua valendo.
    if (!(ehLabelCE(c.campo) || ehLabelCE(c.doc1_label) || ehLabelCE(c.doc2_label))) return false;
    const campo = maiusculo(c.campo);
    const vals = maiusculo([c.doc1_valor, c.doc2_valor].join(' '));
    if (/SUSPENS/.test(campo + ' ' + vals)) return true;
    if (/COBERTURA CAMBIAL/.test(campo + ' ' + vals + ' ' + maiusculo(c.observacao))) return true;
    return /\b(SITUACAO|STATUS|CONDICAO)\b/.test(campo) && /PAGAMENTO|\bPAGO\b|QUITAD|PENDENTE|AFRMM/.test(campo + ' ' + vals);
  }
  // O CE não mostra o container: vazio, "N/A" ou um texto sem nenhum número
  // de container dizendo que não tem ("não informado", "não consta", "não
  // explicitado", "apenas volumes totais", "sem container"...).
  function valorAusente(v) {
    const t = maiusculo(v).replace(/[.;:]+$/, '').trim();
    if (!t || /^(N ?\/ ?A|NA|NONE|NULL|-+|—+|SEM VALOR)$/.test(t)) return true;
    if (conteineres(t).length) return false;
    return /\b(NAO|SEM|APENAS|SOMENTE|NENHUM|NENHUMA)\b|AUSENT|INEXISTENT|INDISPONIVEL|OMITID/.test(t);
  }
  // Números de container (4 letras + 7 dígitos, ex.: ABCU1234567).
  function conteineres(v) {
    return (maiusculo(v).replace(/[^A-Z0-9]+/g, ' ').match(/\b[A-Z]{4} ?\d{6,7}\b/g) || []).map(x => x.replace(/ /g, ''));
  }
  function ehContainerLacreCE(c) {
    const campo = maiusculo(c.campo).replace(/[^A-Z0-9 ]/g, ' ');
    const lacre = /\b(LACRE|LACRES|SEAL|SEALS)\b/.test(campo);
    const container = /\b(CONTAINER|CONTAINERS|CONTEINER|CONTEINERES|CNTR|CTNR)\b/.test(campo);
    if (!lacre && !container) return false;
    if (/\b(QTD|QUANTIDADE|QTDE|NUMERO DE|TIPO)\b/.test(campo) && !lacre) return false;
    const lados = [[c.doc1_label, c.doc1_valor], [c.doc2_label, c.doc2_valor]];
    const ce = lados.find(([l]) => ehLabelCE(l));
    if (!ce) return false;
    const outro = lados.find(x => x !== ce) || [];
    if (valorAusente(ce[1])) return true;          // o CE não mostra container/lacre
    if (lacre && !container) return true;          // lacre não vai no CE
    if (lacre) {                                   // "Container e Lacre": só o lacre difere
      const doCE = conteineres(ce[1]), doOutro = conteineres(outro[1]);
      if (doCE.length && doCE.every(x => doOutro.includes(x))) return true;
    }
    return false;
  }
  function regraDispensada(c) {
    if (!c) return null;
    if (ehSituacaoPagamentoCE(c)) return 'Situação de pagamento do CE Mercante não é conferência de documentos';
    if (ehContainerLacreCE(c)) return 'CE Mercante não traz lacre (container e lacre se conferem no BL/PL)';
    // NCM com 4 dígitos no BL
    if (/\bNCM\b/.test(maiusculo(c.campo))) {
      const temBL = /\b(BL|HBL|MBL|BILL|DRAFT)\b/.test(textoDa(c));
      // primeiro código com 4+ dígitos do texto ("4011 (4 digitos)" → 4011; "4011.20.90" → 40112090)
      const dig = v => { const m = String(v == null ? '' : v).replace(/(\d)[.\-\s](?=\d)/g, '$1').match(/\d{4,}/); return m ? m[0] : ''; };
      const vals = [c.doc1_valor, c.doc2_valor].map(dig).filter(Boolean);
      if (temBL && vals.length && vals.some(v => v.length < 8)) {
        const posicoes = new Set(vals.map(v => v.slice(0, 4)));
        if (posicoes.size === 1) return 'NCM com 4 dígitos no BL é o padrão';
      }
    }
    // Porto de destino diferente entre documentos, todos em SC
    if (ehCampoPortoDestino(c)) {
      const v1 = String(c.doc1_valor == null ? '' : c.doc1_valor).trim();
      const v2 = String(c.doc2_valor == null ? '' : c.doc2_valor).trim();
      const vals = [v1, v2].filter(Boolean);
      if (vals.length && vals.every(ehPortoSC)) {
        // BL original x CE Mercante x DI/DUIMP: tem que ser o mesmo porto
        if (v1 && v2 && ehDocFinal(c.doc1_label) && ehDocFinal(c.doc2_label)) {
          return mesmoPorto(v1, v2) ? 'Mesmo porto de destino nos documentos finais (escrito de outro jeito)' : null;
        }
        return 'Porto de destino em SC (pode mudar entre PI, CI, PL e Draft BL)';
      }
    }
    return null;
  }
  function ehPendenciaConferencia(c) {
    return !!c && (c.status === 'DIVERGENCIA' || c.status === 'AUSENTE' || (c.status === 'ALERTA' && !!c.campo)) && !regraDispensada(c);
  }
  function ehAnaliseNova(analise) { return !!analise && analise.chaveVersao >= 2; }
  // Aceite gravado pra esta divergência (ou null).
  function aceiteDe(analise, c, gi, ci) {
    const m = (analise && analise.divResolvedMap) || {};
    return m[chaveDivergencia(c)] || (!ehAnaliseNova(analise) ? (m[gi + '-' + ci] || null) : null);
  }
  // Aceites que passam pra uma conferência nova: só por conteúdo.
  function migrarAceites(analiseAnterior) {
    const m = (analiseAnterior && analiseAnterior.divResolvedMap) || {};
    const out = {};
    Object.keys(m).forEach(k => { if (!/^\d+-\d+$/.test(k)) out[k] = m[k]; });
    if (analiseAnterior && !ehAnaliseNova(analiseAnterior)) {
      (analiseAnterior.grupos || []).forEach((g, gi) => (g.campos || []).forEach((c, ci) => {
        const v = m[gi + '-' + ci];
        const k = chaveDivergencia(c);
        if (v && ehPendenciaConferencia(c) && !out[k]) out[k] = v;
      }));
    }
    return out;
  }
  // Contagem usada no badge, na fila e nos e-mails.
  function contarConferencia(analise) {
    let pendentes = 0, bloqueantes = 0, aceitas = 0;
    ((analise && analise.grupos) || []).forEach((g, gi) => (g.campos || []).forEach((c, ci) => {
      if (!ehPendenciaConferencia(c)) return;
      if (aceiteDe(analise, c, gi, ci)) aceitas++;
      else { pendentes++; if (c.severidade === 'BLOQUEANTE') bloqueantes++; }
    }));
    return { pendentes, bloqueantes, aceitas };
  }
  // Texto das regras novas para o prompt da IA (usado na aba Conferência e,
  // no servidor, para a tela antiga processos.html, que não é editada).
  const REGRAS_NCM_PORTO_PROMPT = 'REGRA NCM NO BL (atualizada): o BL traz o NCM so com a posicao de 4 digitos (ex: 4011) — isso e o PADRAO, NAO gerar divergencia nem alerta de "NCM incompleto" no BL; so gerar DIVERGENCIA de NCM se os 4 primeiros digitos do BL forem diferentes dos da CI/PI. '
    + 'REGRA PORTO DE DESTINO (atualizada): (1) Nos documentos comerciais e preliminares (PI, CI, PL, Draft BL, booking, sales contract) o porto de destino/descarga MUDA com frequencia (ex: PI NAVEGANTES e CI ITAPOA) — isso e NORMAL: NAO comparar o porto de destino desses documentos entre si nem com os documentos finais, e NAO gerar divergencia por isso. '
    + '(2) Nos documentos FINAIS — BL original/emitido (HBL ou MBL, NAO o draft), CE Mercante e DI/DUIMP — o porto de destino/descarga TEM QUE SER O MESMO: comparar BL x CE Mercante x DI/DUIMP (os que estiverem presentes, inclusive os ja conferidos) e, se forem portos diferentes, gerar DIVERGENCIA BLOQUEANTE com campo="Porto de destino (documentos finais)", doc1_label=<documento final, ex: BL Original>, doc1_valor=<porto>, doc2_label=<outro documento final, ex: CE Mercante>, doc2_valor=<porto>. O mesmo porto escrito de outro jeito NAO e divergencia (NAVEGANTES = PORTONAVE = BRNVT; ITAJAI = BRITJ; ITAPOA = BRIOA; IMBITUBA = BRIBB; SAO FRANCISCO DO SUL = BRSFS). Na DI/DUIMP use o porto/local de descarga ou o recinto alfandegado (ex: PORTONAVE = NAVEGANTES), NAO o nome da Alfandega/URF de despacho (a Alfandega de Itajai atende Itajai e Navegantes; a de Sao Francisco do Sul atende Sao Francisco e Itapoa) — o mesmo vale para o porto_destino da DI/DUIMP em dados_por_documento. Nos labels use "BL Original" (ou "BL") para o BL emitido, "Draft BL" para o rascunho, "CE Mercante" e "DUIMP" ou "DI". '
    + '(3) Em qualquer documento, o porto de destino/descarga deve ser um porto de Santa Catarina (ITAJAI, NAVEGANTES/PORTONAVE, ITAPOA, IMBITUBA ou SAO FRANCISCO DO SUL). Se algum documento trouxer porto de destino FORA de Santa Catarina = DIVERGENCIA BLOQUEANTE com campo="Porto de destino fora de SC", doc1_label=<documento> e doc1_valor=<porto encontrado>. ';
  // Regras do CE Mercante (21/10/2026) — também vão para as duas telas.
  const REGRAS_CE_PROMPT = 'REGRAS CE MERCANTE (atualizadas): (1) A SITUACAO DE PAGAMENTO do CE (campos "Situacao", "Situacao do Master/House", "Condicao de pagamento", "Situacao pagamento"; valores como "SUSPENSO DE PAGAMENTO", "Suspensao", "Pendente de pagamento", "Pago", "Sem cobertura cambial", AFRMM) NAO e conferencia de documentos: NAO gerar divergencia, ausencia nem alerta sobre a situacao de pagamento do CE, em nenhum grupo. '
    + '(2) O CE Mercante NAO traz lacre (e o extrato nem sempre traz os containers): NAO comparar lacre com o CE e NAO gerar ausencia, divergencia ou alerta de container/lacre porque o CE nao mostra — container e lacre se conferem so entre BL, PL e CI. So gerar divergencia de container com o CE se o CE mostrar um numero de container diferente dos do BL. ';
  const api = { chaveDivergencia, ehPendenciaConferencia, regraDispensada, ehPortoSC, ehDocFinal, mesmoPorto, aceiteDe, migrarAceites, contarConferencia, REGRAS_NCM_PORTO_PROMPT, REGRAS_CE_PROMPT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ConferenciaChave = api;
})(typeof window !== 'undefined' ? window : this);
