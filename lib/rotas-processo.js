// Importações de planilha (despachante, planilha interna, criação em lote) e
// a gravação do processo (salvar com conferência de versão, comissões,
// histórico, exclusão), notificações e as rotas antigas /api/controle/*.
// Saiu de server.js em 24/10/2026 sem mudar a lógica: o código é o mesmo, só
// recebe por parâmetro (deps) o que vinha do escopo do server.js, e é
// registrado na mesma posição. O que o server.js declara DEPOIS deste ponto
// (conexos, GED_BUCKET, o cache de usuários, follow-up) chega como função,
// lida só quando uma rota roda.
'use strict';
const CadastrosNormalizar = require('./cadastros-normalizar.js');

function registrar(app, deps) {
  const {
    auth, requireGerente, sb, gerarUUID, lerPlanilhaIsolada, escapeHtml, enviarEmail, Newsletter,
    RefProcesso, ValidacaoDatas, ReferenciaUnica, conferirConexosIdRepetido, MSG_CONEXOS_REPETIDO_BANCO,
    ehErroConexosRepetido, erroColunasVinculo, carregarListas, obterIndiceCadastros,
    desvincularCotacoesDoProcessoExcluido, normalizarPortoDestinoDespachante, formatarPortoDestinoEmail,
    buscarTodosProcessos, DATAS_VALIDADAS_PROCESSO, colunasSemRepetir, conferirDatasImportacao,
    quemSalvouNoMeio, conexosSvc, gedBucket, usuariosCache, decidirFollowUp, dispararFollowUp, ehLCLServidor
  } = deps;

// Planilhas de fora (despachante, planilha interna) casam a linha com o
// processo pela referência — igual, ou com/sem o prefixo "IMPAK-" quando só
// um processo bate (19/10/2026, referencia-processo.js). A linha não achada
// volta com as parecidas do Controle (ou com os processos em dúvida) para a
// pessoa saber o que corrigir na planilha.
function acharProcessoDaLinha(indice, refPlanilha) {
  const achado = RefProcesso.encontrar(indice, refPlanilha);
  if (!achado.processo) {
    const r = { referencia: refPlanilha, status: 'nao_encontrado' };
    if (achado.como === 'ambiguo') r.ambiguo = achado.candidatos;
    else if (achado.sugestoes && achado.sugestoes.length) r.sugestoes = achado.sugestoes;
    return { proc: null, naoEncontrado: r };
  }
  const ident = { referencia: achado.processo.referencia };
  if (achado.como === 'sem_prefixo') ident.referencia_planilha = String(refPlanilha).trim();
  return { proc: achado.processo, ident };
}
function textoRefNaoEncontrada(r) {
  let t = String(r.referencia || '');
  if (r.ambiguo && r.ambiguo.length) t += ` (mais de um processo: ${r.ambiguo.join(', ')})`;
  else if (r.sugestoes && r.sugestoes.length) t += ` (no Controle tem: ${r.sugestoes.join(', ')})`;
  return t;
}
function textoRefAchada(r) {
  return r.referencia_planilha ? `${r.referencia} (na planilha: ${r.referencia_planilha})` : String(r.referencia || '');
}
const DESTINATARIOS_RELATORIO_DESPACHANTE = [
  'importacao1@impak.com.br', // Emanuelly (suporte@ vai em cópia automática — ver enviarEmail)
];

async function enviarRelatorioImportDespachante(resumo, usuario) {
  const atualizados = resumo.filter(r => r.status === 'atualizado');
  const naoEncontrados = resumo.filter(r => r.status === 'nao_encontrado');
  const semMudancas = resumo.filter(r => r.status === 'sem_mudancas');
  const comErro = resumo.filter(r => r.status === 'erro');
  const blocoDatas = htmlDatasImportacao(resumo);

  if (!atualizados.length && !naoEncontrados.length && !comErro.length && !blocoDatas) return; // nada relevante pra reportar

  const NOMES_CAMPO = {
    hbl: 'HBL', mbl: 'MBL', data_chegada: 'Data de Chegada', eta: 'ETA (Previsao de Chegada)',
    porto_destino: 'Porto de Destino', navio: 'Navio', qtd_containers_prevista: 'Qtd. Containers',
    obs: 'Observacoes', data_liberacao: 'Data de Liberacao (DATA CI)',
  };

  const linhasAtualizados = atualizados.map(r => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-weight:600;">${escapeHtml(textoRefAchada(r))}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${r.campos.map(c => escapeHtml(NOMES_CAMPO[c] || c)).join(', ')}</td>
    </tr>`).join('');

  const linhasNaoEncontrados = naoEncontrados.map(r => `<li>${escapeHtml(textoRefNaoEncontrada(r))}</li>`).join('');
  const linhasComErro = comErro.map(r => `<li>${escapeHtml(r.referencia)}: ${escapeHtml(r.erro || '')}</li>`).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;color:#1f2937;max-width:640px;">
      <h2 style="margin:0 0 4px;">Import Despachante - Resultado</h2>
      <p style="margin:0 0 16px;color:#6b7280;">Executado por ${escapeHtml(usuario || 'desconhecido')} em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
      <p style="margin:0 0 16px;">
        <strong>${atualizados.length}</strong> processos atualizados &nbsp;-&nbsp;
        <strong>${semMudancas.length}</strong> sem mudancas &nbsp;-&nbsp;
        <strong>${naoEncontrados.length}</strong> nao encontrados
        ${comErro.length ? `&nbsp;-&nbsp; <strong style="color:#b91c1c;">${comErro.length} com erro</strong>` : ''}
      </p>
      ${atualizados.length ? `
      <h3 style="margin:16px 0 8px;">Processos atualizados</h3>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="text-align:left;padding:6px 10px;">Referencia</th>
            <th style="text-align:left;padding:6px 10px;">Campos alterados</th>
          </tr>
        </thead>
        <tbody>${linhasAtualizados}</tbody>
      </table>` : ''}
      ${naoEncontrados.length ? `
      <h3 style="margin:16px 0 8px;">Referencias nao encontradas no Controle</h3>
      <ul style="margin:0;padding-left:20px;">${linhasNaoEncontrados}</ul>` : ''}
      ${comErro.length ? `
      <h3 style="margin:16px 0 8px;color:#b91c1c;">Erros ao atualizar</h3>
      <ul style="margin:0;padding-left:20px;">${linhasComErro}</ul>` : ''}
      ${blocoDatas}
      <p style="margin-top:20px;color:#9ca3af;font-size:12px;">Enviado automaticamente pelo Portal IMPAK.</p>
    </div>`;

  const nRecusadas = resumo.reduce((s, r) => s + ((r.datas_recusadas || []).length), 0);
  const assunto = `Import Despachante: ${atualizados.length} atualizados, ${naoEncontrados.length} nao encontrados` + (nRecusadas ? `, ${nRecusadas} data(s) nao importada(s)` : '');
  for (const destinatario of DESTINATARIOS_RELATORIO_DESPACHANTE) {
    await enviarEmail(destinatario, assunto, html, { alerta: true });
  }
}

// Busca todas as linhas de controle_processos (paginado — o Supabase
// devolve no máximo 1000 por consulta).
// Processos com referência parecida (sem diferenciar maiúsculas) — usado para
// não criar processo novo com referência repetida (lib/referencia-unica.js).
async function buscarProcessosPorReferencia(ref) {
  const { data, error } = await sb().from('controle_processos')
    .select('id, referencia, cancelado')
    .ilike('referencia', String(ref).replace(/[%_\\]/g, m => '\\' + m))
    .limit(10);
  if (error) throw new Error(error.message);
  return data || [];
}

app.post('/api/controle/v2/importar-despachante', auth('controle','financeiro'), async (req, res) => {
  try {
    const { arquivo_base64 } = req.body;
    if (!arquivo_base64) return res.status(400).json({ erro: 'Arquivo ausente' });
    const buffer = Buffer.from(arquivo_base64, 'base64');

    let parsed;
    try {
      parsed = await lerPlanilhaIsolada('importarDespachanteBase', buffer);
    } catch (parseErr) {
      return res.status(400).json({ erro: parseErr.message });
    }
    if (parsed.erro) return res.status(400).json({ erro: parsed.erro });
    const linhas = parsed.linhas || [];
    if (!linhas.length) return res.json({ ok: true, resumo: [], total_linhas: 0 });

    const { data: processos, error: errBusca } = await buscarTodosProcessos(colunasSemRepetir('id, referencia, hbl, mbl, data_chegada, eta, porto_destino, navio, qtd_containers_prevista, obs, fechado, cancelado, tipo_container, data_liberacao', DATAS_VALIDADAS_PROCESSO));
    if (errBusca) throw new Error(errBusca.message);

    const indiceRefs = RefProcesso.criarIndice(processos);

    const resumo = [];
    const logsGlobais = [];
    const agora = new Date().toISOString();

    for (const linha of linhas) {
      const { proc, ident, naoEncontrado } = acharProcessoDaLinha(indiceRefs, linha.referencia);
      if (!proc) {
        resumo.push(naoEncontrado);
        continue;
      }
      // Segurança (item 6): processo fechado/cancelado não muda por planilha.
      if (proc.fechado || proc.cancelado) {
        resumo.push({ ...ident, status: 'travado', motivo: proc.fechado ? 'fechado' : 'cancelado' });
        continue;
      }

      const patch = {};
      const camposAlterados = [];
      const logsProc = [];
      const setCampo = (campo, novoValor) => {
        if (novoValor === undefined || novoValor === null || novoValor === '') return;
        const antigo = proc[campo];
        if (String(antigo || '') === String(novoValor)) return;
        patch[campo] = novoValor;
        camposAlterados.push(campo);
        logsProc.push({
          processo_id: proc.id, usuario: req.session.usuario, campo,
          valor_antes: String(antigo || ''), valor_depois: String(novoValor),
          created_at: agora,
        });
      };

      setCampo('hbl', linha.hbl);
      setCampo('mbl', linha.mbl);
      if (linha.data_chegada) {
        // A "CHEGADA" da planilha do despachante e uma previsao, nao uma
        // confirmacao. Datas futuras vao para o campo ETA (Previsao de
        // Chegada) -- so preenchem Data Chegada (que dispara o calculo de
        // demurrage) quando a data ja aconteceu ou e hoje. Mesma regra do
        // moverDataFuturaParaPrevisao() usado na digitacao manual.
        const hojeISO = new Date().toISOString().slice(0, 10);
        if (linha.data_chegada > hojeISO) {
          setCampo('eta', linha.data_chegada);
        } else {
          setCampo('data_chegada', linha.data_chegada);
        }
      }
      setCampo('porto_destino', normalizarPortoDestinoDespachante(linha.porto_destino));
      setCampo('navio', linha.navio);
      // DATA CI (Comprovante de Importação, emitido no desembaraço) → Data de
      // Liberação (21/10/2026, Emanuelly). A CI não existe antes de
      // acontecer: data no futuro não é gravada e vai para o relatório, como
      // a DATA CI que não deu para ler.
      const recusadasPlanilha = [];
      if (linha.data_liberacao) {
        if (linha.data_liberacao > new Date().toISOString().slice(0, 10)) recusadasPlanilha.push({ campo: 'data_liberacao', valor: linha.data_liberacao, motivo: 'DATA CI no futuro — a CI só sai no desembaraço' });
        else setCampo('data_liberacao', linha.data_liberacao);
      } else if (linha.data_ci_ilegivel) {
        recusadasPlanilha.push({ campo: 'data_liberacao', valor: linha.data_ci_ilegivel, motivo: 'DATA CI não é uma data válida' });
      }
      if (linha.qtd_containers && linha.qtd_containers > 0) setCampo('qtd_containers_prevista', linha.qtd_containers);
      if (linha.demanda_impak) {
        const obsAtual = proc.obs || '';
        if (!obsAtual.includes(linha.demanda_impak)) {
          const novoObs = obsAtual ? `${obsAtual}\n[Despachante] ${linha.demanda_impak}` : `[Despachante] ${linha.demanda_impak}`;
          setCampo('obs', novoObs);
        }
      }

      // Data impossível (ex.: chegada antes do embarque) não é gravada (18/10/2026).
      const confDatas = conferirDatasImportacao(proc, patch, camposAlterados, logsProc);
      confDatas.recusadas = recusadasPlanilha.concat(confDatas.recusadas);
      if (!camposAlterados.length) {
        resumo.push({ ...ident, status: 'sem_mudancas', datas_recusadas: confDatas.recusadas });
        continue;
      }

      patch.updated_at = agora;
      const { error: errUpdate } = await sb().from('controle_processos').update(patch).eq('id', proc.id);
      if (errUpdate) {
        resumo.push({ ...ident, status: 'erro', erro: errUpdate.message });
        conexosSvc().registrarLog(sb(), { origem:'despachante', processo_id: proc.id, referencia: proc.referencia, status:'erro', erro: errUpdate.message, campos_aplicados: patch, usuario: req.session.usuario }).catch(()=>{});
        continue;
      }
      logsGlobais.push(...logsProc);
      resumo.push({ ...ident, status: 'atualizado', campos: camposAlterados, datas_recusadas: confDatas.recusadas, avisos_datas: confDatas.avisos });
      conexosSvc().registrarLog(sb(), { origem:'despachante', processo_id: proc.id, referencia: proc.referencia, status:'ok', campos_aplicados: patch, usuario: req.session.usuario, payload: confDatas.recusadas.length ? { datas_recusadas: confDatas.recusadas } : null }).catch(()=>{});
    }

    if (logsGlobais.length) {
      try { await sb().from('controle_log').insert(logsGlobais); }
      catch (logErr) { console.warn('log despachante erro:', logErr.message); }
    }

    const totalAtualizados = resumo.filter(r => r.status === 'atualizado').length;
    const totalNaoEncontrados = resumo.filter(r => r.status === 'nao_encontrado').length;
    const totalSemMudancas = resumo.filter(r => r.status === 'sem_mudancas').length;

    const totalDatasRecusadas = resumo.reduce((s, r) => s + ((r.datas_recusadas || []).length), 0);
    console.log(`importar-despachante: ${totalAtualizados} atualizados, ${totalNaoEncontrados} nao encontrados, ${totalSemMudancas} sem mudancas, ${totalDatasRecusadas} data(s) recusada(s), por ${req.session.usuario}`);

    enviarRelatorioImportDespachante(resumo, req.session.usuario)
      .catch(mailErr => console.warn('relatorio email despachante erro:', mailErr.message));
    // Follow-up semanal sai logo depois da importação de segunda (19/10/2026).
    if (linhas.length && decidirFollowUp(Newsletter.agoraSP(), 'importacao')) {
      dispararFollowUp('importacao', { usuario: nomeUsuarioExibicao(req.session.usuario) })
        .catch(e => console.error('Erro no follow-up semanal (após importação):', e.message));
    }
    res.json({
      ok: true, resumo,
      total_linhas: linhas.length,
      total_atualizados: totalAtualizados,
      total_nao_encontrados: totalNaoEncontrados,
      total_sem_mudancas: totalSemMudancas,
      total_travados: resumo.filter(r => r.status === 'travado').length,
      total_datas_recusadas: totalDatasRecusadas,
    });
  } catch (e) {
    console.error('importar-despachante erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

const DESTINATARIOS_RELATORIO_MANU = [
  'importacao1@impak.com.br', // Emanuelly (suporte@ em cópia automática)
];

async function enviarRelatorioImportManu(resumo, usuario) {
  const atualizados = resumo.filter(r => r.status === 'atualizado');
  const naoEncontrados = resumo.filter(r => r.status === 'nao_encontrado');
  const semMudancas = resumo.filter(r => r.status === 'sem_mudancas');
  const comErro = resumo.filter(r => r.status === 'erro');
  const blocoDatas = htmlDatasImportacao(resumo);
  if (!atualizados.length && !naoEncontrados.length && !comErro.length && !blocoDatas) return;
  const NOMES_CAMPO = {
    data_presenca: 'Data de Prontidao', data_prontidao: 'Data de Prontidao', agente: 'Agente de Carga', etd: 'Previsao de Embarque (ETD)',
  };
  const linhaHtml = (r) => `<tr><td style="padding:4px 8px;border:1px solid #ddd;">${escapeHtml(textoRefAchada(r))}</td><td style="padding:4px 8px;border:1px solid #ddd;">${(r.campos||[]).map(c => escapeHtml(NOMES_CAMPO[c]||c)).join(', ')}</td></tr>`;
  const html = `
    <h3>Importacao Planilha Interna (Manu/Emanuelly)</h3>
    <p>Executado por: ${escapeHtml(usuario || '')}</p>
    <p><b>${atualizados.length}</b> processo(s) atualizado(s), <b>${semMudancas.length}</b> sem mudancas, <b>${naoEncontrados.length}</b> nao encontrado(s), <b>${comErro.length}</b> com erro.</p>
    ${atualizados.length ? `<table style="border-collapse:collapse;"><tr><th style="padding:4px 8px;border:1px solid #ddd;">Referencia</th><th style="padding:4px 8px;border:1px solid #ddd;">Campos atualizados</th></tr>${atualizados.map(linhaHtml).join('')}</table>` : ''}
    ${naoEncontrados.length ? `<p><b>Nao encontrados:</b> ${naoEncontrados.map(r=>escapeHtml(textoRefNaoEncontrada(r))).join(', ')}</p>` : ''}
    ${blocoDatas}
  `;
  const nRecusadas = resumo.reduce((s, r) => s + ((r.datas_recusadas || []).length), 0);
  const assunto = `Import Planilha Interna: ${atualizados.length} atualizados, ${naoEncontrados.length} nao encontrados` + (nRecusadas ? `, ${nRecusadas} data(s) nao importada(s)` : '');
  for (const destinatario of DESTINATARIOS_RELATORIO_MANU) {
    await enviarEmail(destinatario, assunto, html, { alerta: true });
  }
}

app.post('/api/controle/v2/importar-manu', auth('controle','financeiro'), async (req, res) => {
  try {
    const { arquivo_base64 } = req.body;
    if (!arquivo_base64) return res.status(400).json({ erro: 'Arquivo ausente' });
    const buffer = Buffer.from(arquivo_base64, 'base64');
    let parsed;
    try {
      parsed = await lerPlanilhaIsolada('importarManuBase', buffer);
    } catch (parseErr) {
      return res.status(400).json({ erro: parseErr.message });
    }
    if (parsed.erro) return res.status(400).json({ erro: parsed.erro });
    const linhas = parsed.linhas || [];
    if (!linhas.length) return res.json({ ok: true, resumo: [], total_linhas: 0 });

    const { data: processos, error: errBusca } = await buscarTodosProcessos(colunasSemRepetir('id, referencia, data_prontidao, agente, etd, fechado, cancelado, tipo_container', DATAS_VALIDADAS_PROCESSO));
    if (errBusca) throw new Error(errBusca.message);

    const indiceRefs = RefProcesso.criarIndice(processos);

    const resumo = [];
    const logsGlobais = [];
    const agora = new Date().toISOString();

    for (const linha of linhas) {
      const { proc, ident, naoEncontrado } = acharProcessoDaLinha(indiceRefs, linha.referencia);
      if (!proc) {
        resumo.push(naoEncontrado);
        continue;
      }
      // Segurança (item 6): processo fechado/cancelado não muda por planilha.
      if (proc.fechado || proc.cancelado) {
        resumo.push({ ...ident, status: 'travado', motivo: proc.fechado ? 'fechado' : 'cancelado' });
        continue;
      }
      const patch = {};
      const camposAlterados = [];
      const logsProc = [];
      const setCampo = (campo, novoValor) => {
        if (novoValor === undefined || novoValor === null || novoValor === '') return;
        const antigo = proc[campo];
        if (String(antigo || '') === String(novoValor)) return;
        patch[campo] = novoValor;
        camposAlterados.push(campo);
        logsProc.push({
          processo_id: proc.id, usuario: req.session.usuario, campo,
          valor_antes: String(antigo || ''), valor_depois: String(novoValor),
          created_at: agora,
        });
      };
      setCampo('data_prontidao', linha.data_prontidao);
      setCampo('agente', linha.agente);
      setCampo('etd', linha.etd);

      // Data impossível (ex.: ETD depois do ETA) não é gravada (18/10/2026).
      const confDatas = conferirDatasImportacao(proc, patch, camposAlterados, logsProc);
      if (!camposAlterados.length) {
        resumo.push({ ...ident, status: 'sem_mudancas', datas_recusadas: confDatas.recusadas });
        continue;
      }
      patch.updated_at = agora;
      const { error: errUpdate } = await sb().from('controle_processos').update(patch).eq('id', proc.id);
      if (errUpdate) {
        resumo.push({ ...ident, status: 'erro', erro: errUpdate.message });
        conexosSvc().registrarLog(sb(), { origem:'planilha_interna', processo_id: proc.id, referencia: proc.referencia, status:'erro', erro: errUpdate.message, campos_aplicados: patch, usuario: req.session.usuario }).catch(()=>{});
        continue;
      }
      logsGlobais.push(...logsProc);
      resumo.push({ ...ident, status: 'atualizado', campos: camposAlterados, datas_recusadas: confDatas.recusadas, avisos_datas: confDatas.avisos });
      conexosSvc().registrarLog(sb(), { origem:'planilha_interna', processo_id: proc.id, referencia: proc.referencia, status:'ok', campos_aplicados: patch, usuario: req.session.usuario, payload: confDatas.recusadas.length ? { datas_recusadas: confDatas.recusadas } : null }).catch(()=>{});
    }

    if (logsGlobais.length) {
      try { await sb().from('controle_log').insert(logsGlobais); }
      catch (logErr) { console.warn('log manu erro:', logErr.message); }
    }

    const totalAtualizados = resumo.filter(r => r.status === 'atualizado').length;
    const totalNaoEncontrados = resumo.filter(r => r.status === 'nao_encontrado').length;
    const totalSemMudancas = resumo.filter(r => r.status === 'sem_mudancas').length;

    const totalDatasRecusadas = resumo.reduce((s, r) => s + ((r.datas_recusadas || []).length), 0);
    console.log(`importar-manu: ${totalAtualizados} atualizados, ${totalNaoEncontrados} nao encontrados, ${totalSemMudancas} sem mudancas, ${totalDatasRecusadas} data(s) recusada(s), por ${req.session.usuario}`);

    enviarRelatorioImportManu(resumo, req.session.usuario)
      .catch(mailErr => console.warn('relatorio email manu erro:', mailErr.message));
    res.json({
      ok: true, resumo,
      total_linhas: linhas.length,
      total_atualizados: totalAtualizados,
      total_nao_encontrados: totalNaoEncontrados,
      total_sem_mudancas: totalSemMudancas,
      total_travados: resumo.filter(r => r.status === 'travado').length,
      total_datas_recusadas: totalDatasRecusadas,
    });
  } catch (e) {
    console.error('importar-manu erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// Comissões (uso interno, #517 — 13/10/2026): seleção de comissionados e
// registro de pagamento ficam em comissoes_json (migration 0045). Rota própria
// porque comissão costuma ser paga DEPOIS de o processo ser fechado — e isso
// não mexe no resultado (o lucro só muda pelo que é lançado em Custos Reais),
// então é aceito mesmo com o processo travado. Só grava esta coluna.
app.post('/api/controle/v2/processo/:id/comissoes', auth('controle','financeiro','resultado'), async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return res.status(400).json({ erro: 'id inválido' });
    const c = (req.body && req.body.comissoes_json) || {};
    const codigo = v => String(v || '').trim().toUpperCase().slice(0, 40);
    const limpo = {
      selecionados: [...new Set((Array.isArray(c.selecionados) ? c.selecionados : []).map(codigo).filter(x => /^[A-Z0-9 .\-_/]{1,40}$/.test(x)))].slice(0, 50),
      pagamentos: (Array.isArray(c.pagamentos) ? c.pagamentos : []).slice(0, 200).map(p => ({
        chave: String((p && p.chave) || '').slice(0, 120),
        data: /^\d{4}-\d{2}-\d{2}$/.test(String(p && p.data)) ? String(p.data) : null,
        valor: Number.isFinite(Number(p && p.valor)) ? Math.round(Number(p.valor) * 100) / 100 : 0,
        usuario: req.session.usuario,
      })).filter(p => p.chave && p.data),
    };
    const { data: atual, error: e1 } = await sb().from('controle_processos').select('id, comissoes_json, updated_at').eq('id', id).maybeSingle();
    if (e1) throw new Error(e1.message);
    if (!atual) return res.status(404).json({ erro: 'Processo não encontrado' });
    // Mantém quem registrou cada pagamento antigo (não troca pelo usuário atual).
    const antigos = (atual.comissoes_json && Array.isArray(atual.comissoes_json.pagamentos)) ? atual.comissoes_json.pagamentos : [];
    limpo.pagamentos = limpo.pagamentos.map(p => { const a = antigos.find(x => x && x.chave === p.chave && x.data === p.data); return a && a.usuario ? { ...p, usuario: a.usuario } : p; });
    const novaVersao = new Date().toISOString();
    const { error } = await sb().from('controle_processos').update({ comissoes_json: limpo, updated_at: novaVersao }).eq('id', id);
    if (error) throw new Error(error.message);
    try {
      await sb().from('controle_log').insert([{ processo_id: id, usuario: req.session.usuario, campo: 'comissoes_json',
        valor_antes: JSON.stringify(atual.comissoes_json || {}), valor_depois: JSON.stringify(limpo), created_at: new Date().toISOString() }]);
    } catch (logErr) { console.warn('log comissões:', logErr.message); }
    // versão nova + a anterior: o painel aberto avança a versão dele se
    // estava na anterior (senão o Salvar seguinte acusava edição simultânea).
    res.json({ ok: true, comissoes_json: limpo, updated_at: novaVersao, versao_anterior: atual.updated_at || null });
  } catch (e) {
    const msg = /comissoes_json/.test(e.message) ? 'Coluna comissoes_json ainda não existe — rodar a migration 0045 no Supabase.' : e.message;
    res.status(500).json({ erro: msg });
  }
});

app.post('/api/controle/v2/processo', auth('controle','financeiro'), async (req, res) => {
  try {
    const { processo } = req.body;
    if (!processo) return res.status(400).json({ erro: 'Processo ausente' });
    // Referência só é obrigatória ao CRIAR (sem id ainda) — em edições
    // parciais (ver controle_v2.html: coletarESalvar/salvarProcesso agora
    // manda só os campos que o usuário de fato alterou, pra não sobrescrever
    // edições concorrentes de outro usuário) o payload pode legitimamente
    // não incluir "referencia" se ela não foi um dos campos alterados.
    if (!processo.id && !processo.referencia) return res.status(400).json({ erro: 'Referência obrigatória' });
    // Segurança: o id vai parar em atributos onclick do front — só aceita
    // letras, números, hífen e _ (os ids gerados são UUID).
    if (processo.id && !/^[A-Za-z0-9_-]{1,64}$/.test(String(processo.id))) return res.status(400).json({ erro: 'id inválido' });

    // ── TRAVA DE PROCESSO ("Fechar Processo") ────────────────────────
    // Depois de conferido, o processo pode ser fechado (ver botão 🔒 no
    // painel do processo) pra impedir que NF, custos reais, lucro etc.
    // mudem por engano — trava o processo INTEIRO, não só os campos
    // financeiros, porque é mais simples e mais previsível do que travar
    // campo a campo. Isso é reforçado aqui no servidor (não só escondido/
    // desabilitado no front-end) porque a trava só vale alguma coisa se
    // não der pra contornar chamando a API direto.
    let processoExistente = false;
    // Edição simultânea (revisão 17/10/2026): o painel manda a versão
    // (updated_at) de quando abriu o processo. Se o banco já tem outra,
    // alguém salvou no meio — devolve 409 com o processo atual e o navegador
    // junta as alterações (concorrencia-processo.js) em vez de sobrescrever.
    const baseVersao = (typeof processo._base_updated_at === 'string' && processo._base_updated_at) ? processo._base_updated_at : null;
    let atualRow = null;
    if (processo.id) {
      const { data: atual } = await sb()
        .from('controle_processos')
        .select('fechado, cancelado, cancelamento_solicitado, updated_at, updated_by, tipo_container, conexos_id, ' + DATAS_VALIDADAS_PROCESSO)
        .eq('id', processo.id)
        .maybeSingle();
      processoExistente = !!atual;
      atualRow = atual || null;
      if (atual && baseVersao && atual.updated_at && new Date(atual.updated_at).getTime() !== new Date(baseVersao).getTime()) {
        return responderConflitoProcesso(res, processo.id, baseVersao, req.session.usuario);
      }
      const estavaFechado = !!(atual && atual.fechado);
      const tentandoDestravar = estavaFechado && processo.fechado === false;
      const tentandoTravar    = !estavaFechado && processo.fechado === true;

      // Exceção (25/09/2026): peso/NCM da DI/DUIMP são dados da Reciclagem
      // (relação trimestral pro cliente) e não mexem em nada financeiro —
      // podem ser completados mesmo com o processo fechado.
      // + taxa do dólar e total em R$ da DI (21/10/2026): só informativos, saem
      // no cabeçalho do DRE (Check-list Fechamento Importação). "log" e
      // "_base_updated_at" podem vir junto pra mudança aparecer no Histórico.
      const soDadosReciclagem = Object.keys(processo).every(k => ['id','di_peso_liquido','di_ncms','di_taxa_cambio','di_valor_aduaneiro','log','_base_updated_at'].includes(k))
        && Object.keys(processo).some(k => ['di_peso_liquido','di_ncms','di_taxa_cambio','di_valor_aduaneiro'].includes(k));
      // Exceção (29/09/2026): CFOP das NFs de saída é só classificação fiscal
      // (não muda valor nenhum). Em processo fechado, aceita um vendas_json
      // que seja IDÊNTICO ao salvo exceto pelo nf_saida_cfop de cada venda.
      let soCfopVendas = false;
      if (estavaFechado && Object.keys(processo).every(k => ['id','vendas_json'].includes(k)) && processo.vendas_json != null) {
        try {
          const { data: atualV } = await sb().from('controle_processos').select('vendas_json').eq('id', processo.id).maybeSingle();
          const parse = v => { const x = typeof v === 'string' ? JSON.parse(v || '[]') : (v || []); return Array.isArray(x) ? x : []; };
          const velhas = parse(atualV && atualV.vendas_json), novas = parse(processo.vendas_json);
          const semCfop = arr => JSON.stringify(arr.map(v => { const c = { ...v }; delete c.nf_saida_cfop; return c; }));
          soCfopVendas = velhas.length === novas.length && semCfop(velhas) === semCfop(novas);
        } catch (e) { soCfopVendas = false; }
      }
      if (estavaFechado && !tentandoDestravar && !soDadosReciclagem && !soCfopVendas) {
        return res.status(403).json({ erro: 'Processo fechado — reabra para editar (só gerente pode reabrir).' });
      }
      if (tentandoDestravar && req.session.role !== 'gerente') {
        return res.status(403).json({ erro: 'Só um gerente pode reabrir um processo fechado.' });
      }
      // fechado_em/fechado_por são registrados pelo servidor, nunca aceitos
      // direto do cliente — evita que alguém finja ter travado/destravado
      // em outro momento ou como outro usuário.
      if (tentandoTravar) {
        processo.fechado_em = new Date().toISOString();
        processo.fechado_por = req.session.usuario;
      } else if (tentandoDestravar) {
        processo.fechado_em = null;
        processo.fechado_por = null;
      } else {
        delete processo.fechado; // não deixa alterar a trava por acidente num save comum
        delete processo.fechado_em; delete processo.fechado_por; // só o servidor registra quem/quando
      }

      // ── VALIDAÇÃO ANTES DE FINALIZADO (14/10/2026, pedido Emanuelly) ──
      // finalizacao_validada_em só muda (marcar ou desfazer) por quem está
      // em Listas → "Aprovação por etapa" → FINALIZADO (usuarios/substitutos).
      // Quem validou é sempre o usuário da sessão — nunca vem do cliente.
      if (Object.prototype.hasOwnProperty.call(processo, 'finalizacao_validada_em')) {
        const lista = (await carregarListas()).listas.aprovacao_etapa || [];
        const item = lista.find(x => x.codigo === 'FINALIZADO' && x.ativo !== false);
        const split = v => String(v || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
        const permitidos = item ? split(item.dados && item.dados.usuarios).concat(split(item.dados && item.dados.substitutos)) : [];
        if (!permitidos.includes(String(req.session.usuario || '').toLowerCase())) {
          return res.status(403).json({ erro: 'Só quem está em "Aprovação por etapa" (Cadastros → Listas) pode validar a finalização.' });
        }
        if (processo.finalizacao_validada_em) {
          processo.finalizacao_validada_em = new Date().toISOString();
          processo.finalizacao_validada_por = req.session.usuario;
        } else {
          processo.finalizacao_validada_em = null;
          processo.finalizacao_validada_por = null;
        }
      } else {
        delete processo.finalizacao_validada_por;
      }

      // ── CANCELAMENTO DE PROCESSO ("Cancelar Processo") ──────────────
      // Pedido da Emanuelly (21/08/2026): processos que não vão pra frente
      // precisam sumir das contagens operacionais SEM perder o histórico
      // (diferente de excluir). Cancelar/reverter direto continua restrito
      // a gerente — ver também o fluxo de SOLICITAÇÃO logo abaixo, pedido
      // por ela no mesmo dia: quem não é gerente não cancela mais direto,
      // só "solicita" (com motivo) e um gerente aprova ou rejeita.
      const estavaCancelado = !!(atual && atual.cancelado);
      const tentandoCancelar     = !estavaCancelado && processo.cancelado === true;
      const tentandoDescancelar  = estavaCancelado && processo.cancelado === false;

      const estavaSolicitado  = !!(atual && atual.cancelamento_solicitado);
      const tentandoSolicitar = !estavaSolicitado && processo.cancelamento_solicitado === true;
      const tentandoRejeitar  = estavaSolicitado && processo.cancelamento_solicitado === false;

      if ((tentandoCancelar || tentandoDescancelar) && req.session.role !== 'gerente') {
        return res.status(403).json({ erro: 'Apenas gerentes podem cancelar ou reverter o cancelamento de um processo.' });
      }
      if (tentandoRejeitar && req.session.role !== 'gerente') {
        return res.status(403).json({ erro: 'Apenas gerentes podem rejeitar uma solicitação de cancelamento.' });
      }

      if (tentandoCancelar) {
        processo.cancelado_em = new Date().toISOString();
        processo.cancelado_por = req.session.usuario;
        // Aprovar (cancelar de verdade) encerra qualquer solicitação pendente.
        // cancelado_motivo é texto livre — se não vier no payload da aprovação,
        // mantém o motivo já registrado na solicitação original (não é tocado).
        processo.cancelamento_solicitado = false;
        processo.cancelamento_solicitado_em = null;
        processo.cancelamento_solicitado_por = null;
      } else if (tentandoDescancelar) {
        processo.cancelado_em = null;
        processo.cancelado_por = null;
        processo.cancelado_motivo = null;
      } else {
        delete processo.cancelado; // não deixa alterar por acidente num save comum
        delete processo.cancelado_em; delete processo.cancelado_por;
        if (!tentandoSolicitar && !tentandoRejeitar) delete processo.cancelado_motivo;
      }

      if (tentandoSolicitar) {
        processo.cancelamento_solicitado_em = new Date().toISOString();
        processo.cancelamento_solicitado_por = req.session.usuario;
        // Notifica (sino de notificações, visível a todos) pra um gerente
        // ver e decidir — clicar na notificação já abre o processo direto.
        try {
          await sb().from('controle_notificacoes').insert({
            processo_id: processo.id,
            tipo: 'alerta',
            titulo: `Solicitação de cancelamento: ${atual && atual.referencia ? atual.referencia : processo.referencia || ''}`,
            mensagem: `${req.session.usuario} solicitou o cancelamento deste processo.${processo.cancelado_motivo ? ' Motivo: ' + processo.cancelado_motivo : ''}`,
            created_by: req.session.usuario,
          });
        } catch (notifErr) {
          console.warn('notificacao solicitacao cancelamento erro:', notifErr.message);
        }
      } else if (tentandoRejeitar) {
        processo.cancelamento_solicitado_em = null;
        processo.cancelamento_solicitado_por = null;
        processo.cancelado_motivo = null;
      } else if (!tentandoCancelar) {
        delete processo.cancelamento_solicitado; // não deixa alterar por acidente num save comum
        delete processo.cancelamento_solicitado_em; delete processo.cancelamento_solicitado_por;
      }
    }

    // Processo NOVO com referência que já existe (23/10/2026, UD26-099
    // duplicado): não cria outro — quem salvou abre o existente.
    if (!processoExistente && processo.referencia) {
      const jaExiste = await ReferenciaUnica.referenciaJaUsada(processo.referencia, buscarProcessosPorReferencia);
      if (jaExiste) {
        return res.status(400).json({ ok: false, referencia_repetida: true, campos: ['referencia'],
          erro: `Já existe um processo com a referência ${jaExiste.referencia} — nada foi criado. Abra o processo existente.` });
      }
    }

    // Relatório de segurança (23/09/2026, item 5 — mass assignment): campos
    // de controle/auditoria só o servidor define. Processo NOVO não nasce
    // fechado/cancelado nem com autor forjado; vínculo com cotação
    // (cotacao_id/estimativa_json) só pelos fluxos próprios do Calculador.
    if (!processoExistente) {
      ['fechado','fechado_em','fechado_por','cancelado','cancelado_em','cancelado_por','cancelado_motivo',
       'cancelamento_solicitado','cancelamento_solicitado_em','cancelamento_solicitado_por']
        .forEach(k => { delete processo[k]; });
      processo.created_by = req.session.usuario;
      processo.created_at = new Date().toISOString();
    } else {
      delete processo.created_by; delete processo.created_at;
    }
    delete processo.cotacao_id; delete processo.estimativa_json;
    processo.updated_by = req.session.usuario;

    // ID no Conexos já usado em outro processo (21/10/2026, Emanuelly): nada
    // é gravado e a mensagem diz em qual processo o número está.
    {
      const msgConexos = await conferirConexosIdRepetido(processo, atualRow);
      if (msgConexos) return res.status(400).json({ ok: false, conexos_repetido: true, campos: ['conexos_id'], erro: msgConexos });
    }

    // Datas impossíveis (revisão 17/10/2026, validacao-datas.js): chegada
    // antes do embarque, devolução antes da chegada, ano "0026"... Só as
    // regras que envolvem campos deste save — processo antigo com data
    // errada não trava a edição de outro campo.
    {
      const camposSave = Object.keys(processo).filter(k => k[0] !== '_' && k !== 'log');
      const mesclado = Object.assign({}, atualRow || {}, processo);
      const errosDatas = ValidacaoDatas.erros(ValidacaoDatas.validar(mesclado, { campos: camposSave }));
      if (errosDatas.length) {
        return res.status(400).json({ ok: false, datas_invalidas: true,
          erro: 'Data impossível — nada foi salvo. ' + errosDatas.map(e => e.msg).join(' ') + ' Corrija a data e salve de novo.',
          campos: [...new Set([].concat(...errosDatas.map(e => e.campos)))] });
      }
    }

    if (!processo.id) processo.id = gerarUUID();
    processo.updated_at = new Date().toISOString();

    // Padronização pelos cadastros (01/10/2026, lib/cadastros-normalizar.js):
    // armador/agente/transportadora/despachante/armazém/depot/porto de origem
    // que baterem com a razão social, nome fantasia ou um sinônimo de uma
    // empresa cadastrada naquele papel são gravados com o nome canônico
    // ("PILL" → "PIL"). Valor desconhecido fica como veio. Feito ANTES do log
    // pra que o histórico mostre o valor que realmente foi gravado — e, se o
    // navegador não logou a mudança daquele campo, o servidor registra.
    try {
      const indice = await obterIndiceCadastros();
      const padronizados = CadastrosNormalizar.normalizarProcesso(processo, indice);
      if (padronizados.length) {
        processo.log = Array.isArray(processo.log) ? processo.log : [];
        padronizados.forEach(m => {
          const entrada = processo.log.find(l => !l._saved && l.campo === m.campo);
          if (entrada) entrada.valor_depois = m.depois;
          else processo.log.push({ campo: m.campo + ' (padronizado pelo cadastro)', valor_antes: m.antes, valor_depois: m.depois });
        });
      }
    } catch (normErr) {
      console.warn('padronização de cadastros ignorada:', normErr.message);
    }

    // Log de auditoria no banco — as linhas são montadas aqui e gravadas só
    // DEPOIS do update dar certo (num conflito de edição nada é gravado).
    const logEntries = (processo.log || []).filter(l => !l._saved);
    let linhasLog = null;
    if (logEntries.length) {
      linhasLog = logEntries.map(l => ({
        processo_id: processo.id,
        usuario: req.session.usuario, // sempre quem está logado -- nunca aceitar o nome vindo do navegador (log de auditoria)
        campo: l.campo || '',
        valor_antes: String(l.valor_antes || ''),
        valor_depois: String(l.valor_depois || ''),
        created_at: new Date().toISOString(), // sempre a hora do servidor (auditoria)
      }));
      processo.log = (processo.log || []).map(l => ({ ...l, _saved: true }));
    }

    // Porto de destino: trava pro código padrão (ITJ/IOA/NVT) mesmo se vier
    // uma grafia diferente (ex: "Navegantes, Brazil", "NAVEGANTES, BRAZIL",
    // "Itajai") — pedido do Ayslan (08/09/2026): "nao pode ter 3
    // nomenclaturas ou mais, para o mesmo porto". Normaliza aqui no
    // SERVIDOR (não só no <select> do formulário) pra travar de verdade,
    // mesmo se o valor chegar por outro caminho (API direta, script etc).
    if (processo.porto_destino) processo.porto_destino = normalizarPortoDestinoDespachante(processo.porto_destino);

    // Remover campos internos antes de salvar no banco
    const { log: _log, _fasePrevista, _savedAt, ...processoLimpo } = processo;
    // Campos só de tela (não são colunas): vêm na lista/abertura do processo.
    delete processoLimpo.ged_nomes; delete processoLimpo.conferencia_resumo;
    Object.keys(processoLimpo).forEach(k => { if (k.startsWith('_')) delete processoLimpo[k]; });

    // Processos já existentes usam UPDATE (não upsert): ações como Fechar/
    // Cancelar/Reabrir mandam só {id, campo} — um upsert nesse caso monta um
    // INSERT ... ON CONFLICT DO UPDATE, e o Postgres valida as colunas
    // NOT NULL (ex.: referencia) do candidato a INSERT mesmo quando a linha
    // já existe e o caminho real vai ser um UPDATE, derrubando esses saves
    // parciais com "null value in column referencia violates not-null
    // constraint" (bug relatado pela Paula, 21/08/2026). UPDATE só toca nas
    // colunas presentes no payload, então não tem esse problema.
    let error, gravados = null;
    // Com versão de base: o UPDATE só vale se ninguém salvou entre a
    // conferência lá em cima e agora (mesmo updated_at) — senão, conflito.
    const condicional = !!(processoExistente && baseVersao && atualRow && atualRow.updated_at);
    const gravar = async (obj) => {
      if (!processoExistente) return sb().from('controle_processos').upsert(obj, { onConflict: 'id' });
      let q = sb().from('controle_processos').update(obj).eq('id', processo.id);
      if (condicional) q = q.eq('updated_at', atualRow.updated_at).select('id');
      return q;
    };
    ({ data: gravados, error } = await gravar(processoLimpo));
    if (error && erroColunasVinculo(error)) {
      // Migration 0043 (cliente_id, fornecedor_id...) ainda não rodou:
      // grava sem os vínculos — o texto padronizado continua indo.
      const semIds = Object.assign({}, processoLimpo);
      CadastrosNormalizar.COLUNAS_ID.forEach(c => { delete semIds[c]; });
      ({ data: gravados, error } = await gravar(semIds));
    }
    // Trava do banco (migration 0057): duas gravações ao mesmo tempo com o
    // mesmo ID no Conexos — a segunda volta com a mensagem, não com erro 500.
    if (error && ehErroConexosRepetido(error)) return res.status(400).json({ ok: false, conexos_repetido: true, campos: ['conexos_id'], erro: MSG_CONEXOS_REPETIDO_BANCO });
    if (error) throw new Error(error.message);
    if (condicional && Array.isArray(gravados) && gravados.length === 0) {
      return responderConflitoProcesso(res, processo.id, baseVersao, req.session.usuario);
    }
    if (linhasLog) {
      try { await sb().from('controle_log').insert(linhasLog); }
      catch (logErr) { console.warn('log erro:', logErr.message); }
    }

    // Os alertas abaixo precisam do processo COMPLETO, não só do payload:
    // desde o salvamento parcial, o navegador manda só os campos alterados
    // (+ alguns fixos). Antes eles liam direto do payload, e um campo já
    // preenchido no banco mas ausente do payload era tratado como vazio --
    // ex.: todo save de um processo com demurrage vencendo em até 5 dias
    // gerava uma notificação NOVA (sem checar duplicata), mesmo com o
    // container já devolvido; e editar só a Presença de Carga gerava
    // "Carregamento pendente" mesmo com Data de Carregamento preenchida.
    const { data: salvo } = await sb()
      .from('controle_processos')
      .select('referencia, demurrage_vencimento, data_devolucao_vazio, data_presenca, data_carregamento, data_agendamento, transportadora, cancelado, finalidade, tipo_container')
      .eq('id', processo.id)
      .maybeSingle();
    const pAlerta = salvo || processo;
    const pularAlertas = !!(salvo && salvo.cancelado);

    // Criar notificação de demurrage se necessário (1 por processo por dia)
    if (!pularAlertas && pAlerta.demurrage_vencimento && pAlerta.finalidade !== 'ACOMPANHAMENTO' && !ehLCLServidor(pAlerta)) {
      const venc = new Date(pAlerta.demurrage_vencimento);
      const dias = Math.ceil((venc - new Date()) / 86400000);
      if (dias <= 5 && dias >= 0 && !pAlerta.data_devolucao_vazio) {
        try {
          const tituloDem = `Demurrage: ${pAlerta.referencia}`;
          const hoje = new Date().toISOString().slice(0,10);
          const { data: jaTem } = await sb()
            .from('controle_notificacoes')
            .select('id')
            .eq('processo_id', processo.id)
            .eq('titulo', tituloDem)
            .gte('created_at', hoje)
            .limit(1);
          if (!jaTem || !jaTem.length) {
            await sb().from('controle_notificacoes').insert({
              processo_id: processo.id,
              tipo: 'urgente',
              titulo: tituloDem,
              mensagem: `Container vence em ${dias} dia(s)!`,
              created_by: req.session.usuario,
            });
          }
        } catch(notifErr) {
          console.warn('notificacao erro:', notifErr.message);
        }
      }
    }

    // Alerta: Carregamento pendente (data de presenca preenchida mas sem data de carregamento)
    // Desligado 14/10/2026 (pedido Ayslan): é tarefa da Agenda (A27/A28 —
    // agendar retirada / confirmar carregamento), não evento pro sino.
    if (false && !pularAlertas && pAlerta.data_presenca && !pAlerta.data_carregamento && !pAlerta.data_devolucao_vazio) {
      try {
        const { data: existenteCarreg } = await sb()
          .from('controle_notificacoes')
          .select('id')
          .eq('processo_id', processo.id)
          .eq('tipo', 'urgente')
          .eq('titulo', `Carregamento pendente: ${pAlerta.referencia}`)
          .limit(1);
        if (!existenteCarreg || existenteCarreg.length === 0) {
          await sb().from('controle_notificacoes').insert({
            processo_id: processo.id,
            tipo: 'urgente',
            titulo: `Carregamento pendente: ${pAlerta.referencia}`,
            mensagem: 'Presença de carga registrada, mas ainda sem Data de Carregamento.',
            created_by: req.session.usuario,
          });
        }
      } catch(notifErr) {
        console.warn('notificacao carregamento pendente erro:', notifErr.message);
      }
    }

    // Alerta: Transportadora pendente (agregado semanal, limiar configuravel)
    if (!pularAlertas && pAlerta.data_agendamento && !pAlerta.transportadora && !pAlerta.data_devolucao_vazio) {
      try {
        const dataAg = new Date(pAlerta.data_agendamento + 'T00:00:00');
        const diaSemana = dataAg.getDay(); // 0=domingo
        const offsetSegunda = diaSemana === 0 ? 6 : diaSemana - 1;
        const inicio = new Date(dataAg); inicio.setDate(dataAg.getDate() - offsetSegunda);
        const fim = new Date(inicio); fim.setDate(inicio.getDate() + 6);
        const inicioStr = inicio.toISOString().slice(0,10);
        const fimStr = fim.toISOString().slice(0,10);

        const { data: processosSemana } = await sb()
          .from('controle_processos')
          .select('id, transportadora, data_agendamento, data_devolucao_vazio')
          .gte('data_agendamento', inicioStr)
          .lte('data_agendamento', fimStr);

        const semTransportadora = (processosSemana || []).filter(p => !p.transportadora && !p.data_devolucao_vazio);
        const limiar = parseInt(process.env.CARGA_ALERTA_TRANSPORTADORA_LIMIAR || '3', 10);

        if (semTransportadora.length >= limiar) {
          const tituloSemana = `Transportadoras pendentes - semana de ${inicioStr}`;
          const { data: existenteTransp } = await sb()
            .from('controle_notificacoes')
            .select('id')
            .eq('tipo', 'urgente')
            .eq('titulo', tituloSemana)
            .limit(1);
          if (!existenteTransp || existenteTransp.length === 0) {
            await sb().from('controle_notificacoes').insert({
              tipo: 'urgente',
              titulo: tituloSemana,
              mensagem: `${semTransportadora.length} processo(s) agendados nesta semana sem Transportadora preenchida.`,
              created_by: req.session.usuario,
            });
          }
        }
      } catch(notifErr) {
        console.warn('notificacao transportadora pendente erro:', notifErr.message);
      }
    }

    console.log(`controle v2 salvo: ${processo.referencia} por ${req.session.usuario}`);
    res.json({ ok: true, updated_at: processo.updated_at });
  } catch (e) {
    console.error('controle v2 POST erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

const NOMES_CAMPO_DATA_IMPORT = { data_chegada: 'Data de Chegada', eta: 'ETA', etd: 'ETD', data_prontidao: 'Prontidão na Fábrica', data_embarque: 'Data de Embarque', data_registro_di: 'Registro da DI', data_liberacao: 'Liberação', nf_entrada_data: 'NF de Entrada', nf_saida_data: 'NF de Saída', ci_data: 'Data da CI', pi_data_saldo: 'Vencimento do Saldo' };
// Bloco do e-mail de relatório das importações: datas não gravadas e avisos.
function htmlDatasImportacao(resumo) {
  const recusadas = resumo.filter(r => r.datas_recusadas && r.datas_recusadas.length);
  const comAviso = resumo.filter(r => r.avisos_datas && r.avisos_datas.length);
  if (!recusadas.length && !comAviso.length) return '';
  const fmt = v => /^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(8, 10) + '/' + String(v).slice(5, 7) + '/' + String(v).slice(0, 4) : String(v || '');
  return (recusadas.length ? `
      <h3 style="margin:16px 0 8px;color:#b91c1c;">Datas não importadas (impossíveis)</h3>
      <ul style="margin:0;padding-left:20px;">${recusadas.map(r => r.datas_recusadas.map(d => `<li><b>${escapeHtml(r.referencia)}</b> — ${escapeHtml(NOMES_CAMPO_DATA_IMPORT[d.campo] || d.campo)} ${escapeHtml(fmt(d.valor))}: ${escapeHtml(d.motivo)}</li>`).join('')).join('')}</ul>` : '')
    + (comAviso.length ? `
      <h3 style="margin:16px 0 8px;color:#b45309;">Importado, mas confira</h3>
      <ul style="margin:0;padding-left:20px;">${comAviso.map(r => r.avisos_datas.map(a => `<li><b>${escapeHtml(r.referencia)}</b> — ${escapeHtml(a)}</li>`).join('')).join('')}</ul>` : '');
}
function nomeUsuarioExibicao(login) {
  const u = usuariosCache().get(login);
  return (u && (u.display_name || u.nome)) || login || 'outra pessoa';
}
// 409 com o processo como está no banco + quem mudou o quê desde a versão
// que o navegador abriu (controle_log).
async function responderConflitoProcesso(res, id, baseVersao, usuarioAtual) {
  let atual = null, logs = [];
  try {
    const r = await sb().from('controle_processos').select('*').eq('id', id).maybeSingle();
    atual = r.data || null;
  } catch (e) { /* segue sem o processo — o navegador pede pra recarregar */ }
  try {
    const { data } = await sb().from('controle_log').select('usuario, campo, created_at')
      .eq('processo_id', id).gt('created_at', baseVersao).order('created_at', { ascending: false }).limit(80);
    logs = data || [];
  } catch (e) { /* histórico é só informativo */ }
  const alteracoes = logs.map(l => ({ usuario: nomeUsuarioExibicao(l.usuario), campo: l.campo, em: l.created_at }));
  const { login, mesmoUsuario } = quemSalvouNoMeio(logs, atual && atual.updated_by, usuarioAtual);
  const quem = nomeUsuarioExibicao(login || usuarioAtual);
  return res.status(409).json({ ok: false, conflito: true, mesmo_usuario: mesmoUsuario, alterado_por: quem, alterado_em: atual ? atual.updated_at : null,
    erro: mesmoUsuario
      ? 'Este processo foi salvo em outra aba ou tela enquanto você editava aqui. Atualize o processo antes de salvar de novo.'
      : `${quem} salvou este processo enquanto você editava. Atualize o processo antes de salvar de novo.`, atual, alteracoes });
}

// Histórico de alterações de um processo — faltava esta rota: o front-end
// (controle_v2.html) já chamava GET /api/controle/v2/processo/:id/log desde
// sempre, mas como a rota nunca existiu, a aba "Histórico" sempre recebia
// 404 e mostrava "sem histórico" mesmo com registros salvos normalmente na
// tabela controle_log (o insert em POST /api/controle/v2/processo sempre
// funcionou — só faltava como ler de volta).
app.get('/api/controle/v2/processo/:id/log', auth('controle','financeiro','resultado','tv','narcelio'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_log')
      .select('usuario, campo, valor_antes, valor_depois, created_at')
      .eq('processo_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    res.json({ ok: true, log: data || [] });
  } catch (e) {
    console.error('controle v2 log erro:', e.message);
    res.json({ ok: true, log: [] });
  }
});

app.delete('/api/controle/v2/processo/:id', auth('controle','financeiro'), requireGerente, async (req, res) => {
  try {
    const id = req.params.id;
    // Cotação vinculada perde o vínculo depois da exclusão (regra 6, lib/vinculo-cotacao.js).
    const { data: procExcl } = await sb().from('controle_processos').select('id, referencia, cotacao_id').eq('id', id).maybeSingle();
    // Antes disto, o DELETE só apagava a linha em controle_processos — em
    // qualquer processo com histórico (controle_log, populado a cada save),
    // notificação (controle_notificacoes) ou arquivo GED (controle_arquivos)
    // isso batia numa violação de foreign key no Postgres e o processo
    // "não excluía" sem mensagem clara (o front-end só mostrava "Erro ao
    // excluir" genérico). Processo novo/vazio excluía normalmente, o que
    // explicava o "só alguns processos não excluem" — na prática, qualquer
    // processo já usado de verdade. Agora apaga os dependentes primeiro
    // (arquivos GED também do Storage, não só a linha da tabela).
    const { data: arquivos } = await sb().from('controle_arquivos').select('storage_path').eq('processo_id', id);
    const paths = (arquivos || []).map(a => a.storage_path).filter(Boolean);
    if (paths.length) {
      try { await sb().storage.from(gedBucket()).remove(paths); }
      catch (e) { console.warn('excluir processo: falha ao limpar Storage GED:', e.message); }
    }
    await sb().from('controle_arquivos').delete().eq('processo_id', id);
    await sb().from('controle_notificacoes').delete().eq('processo_id', id);
    await sb().from('controle_log').delete().eq('processo_id', id);

    const { error } = await sb().from('controle_processos').delete().eq('id', id);
    if (error) throw new Error(error.message);
    if (procExcl) await desvincularCotacoesDoProcessoExcluido(procExcl, req.session.usuario);
    res.json({ ok: true });
  } catch (e) {
    console.error('controle/v2/processo DELETE erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

app.get('/api/controle/v2/notificacoes', auth('controle','financeiro','resultado','tv','narcelio'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_notificacoes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    res.json({ ok: true, notificacoes: data || [] });
  } catch (e) {
    res.json({ ok: true, notificacoes: [] });
  }
});

app.post('/api/controle/v2/notificacao', auth('controle','financeiro','resultado','tv','narcelio'), async (req, res) => {
  try {
    const { processo_id, tipo, titulo, mensagem } = req.body;
    if (!tipo || !titulo || !mensagem) return res.status(400).json({ erro: 'tipo, titulo e mensagem são obrigatórios' });
    if (processo_id) {
      const { data: procCheck } = await sb().from('controle_processos').select('id').eq('id', processo_id).maybeSingle();
      if (!procCheck) return res.status(400).json({ erro: 'processo_id inválido' });
    }
    await sb().from('controle_notificacoes').insert({
      processo_id, tipo, titulo, mensagem, created_by: req.session.usuario,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// Limpeza de notificações resolvidas (pedido Emanuelly 09/09/2026): o
// front-end recalcula os alertas de um processo a cada save e manda aqui
// só os ids que não representam mais nenhuma condição ativa (ex: alerta de
// "sem documentos" depois que CI/PL/Draft foram anexados, ou processo que
// avançou de fase/foi finalizado) — sem isso a notificação ficava no sino
// pra sempre, mesmo com o problema já resolvido.
app.post('/api/controle/v2/notificacoes/limpar', auth('controle','financeiro','resultado','tv','narcelio'), async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(id => Number.isInteger(id)) : [];
    if (!ids.length) return res.json({ ok: true, removidas: 0 });
    const { error } = await sb().from('controle_notificacoes').delete().in('id', ids);
    if (error) throw new Error(error.message);
    res.json({ ok: true, removidas: ids.length });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

app.post('/api/controle/v2/notificacao/:id/lida', auth('controle','financeiro','resultado','tv','narcelio'), async (req, res) => {
  try {
    const usuario = req.session.usuario;
    const { data } = await sb().from('controle_notificacoes').select('lida_por').eq('id', req.params.id).single();
    const lidaPor = [...(data?.lida_por || [])];
    if (!lidaPor.includes(usuario)) lidaPor.push(usuario);
    await sb().from('controle_notificacoes').update({ lida_por: lidaPor }).eq('id', req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});


app.get('/api/controle/index', auth('controle','financeiro','resultado','tv','narcelio'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_processos')
      .select('id, referencia, cliente, fase, status, updated_at, dados')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    const index = (data || []).map(p => {
      const d = p.dados || {};
      return {
        id: p.id, referencia: p.referencia, cliente: p.cliente,
        fase: p.fase, status: p.status,
        exportador: d.exportador||'', eta: d.eta||'',
        data_chegada: d.data_chegada||'', data_embarque: d.data_embarque||'',
        porto: d.porto||'', armador: d.armador||'', free_time: d.free_time||21,
        canal_parametrizacao: d.canal_parametrizacao||'', hbl: d.hbl||'',
        numero_di: d.numero_di||'', data_presenca: d.data_presenca||'',
        data_retirada: d.data_retirada||'', data_ric: d.data_ric||'',
        navio: d.navio||'', previsao_prontidao: d.previsao_prontidao||'',
        agente: d.agente||'', despachante: d.despachante||'',
        produtos: d.produtos||'', quant_containers: d.quant_containers||'',
        _updatedAt: new Date(p.updated_at).getTime(),
      };
    });
    res.json({ ok: true, index, processos: index, total: index.length });
  } catch (e) {
    console.error('controle/index erro:', e.message);
    res.json({ ok: true, index: [], processos: [], total: 0 });
  }
});

app.get('/api/controle/processo/:id', auth('controle','financeiro','resultado','tv','narcelio'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_processos')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    if (!data) return res.json({ ok: false, processo: null });
    const proc = { ...data.dados, id: data.id, referencia: data.referencia,
      cliente: data.cliente, fase: data.fase };
    res.json({ ok: true, processo: proc });
  } catch (e) {
    console.error('controle/processo GET erro:', e.message);
    res.json({ ok: false, processo: null });
  }
});

app.post('/api/controle/processo', auth('controle','financeiro'), async (req, res) => {
  try {
    const { processo } = req.body;
    if (!processo || !processo.id) return res.status(400).json({ erro: 'Processo inválido' });
    const row = {
      id:         processo.id,
      referencia: processo.referencia || '',
      cliente:    processo.cliente    || '',
      fase:       processo.fase       || 'PRODUCAO',
      status:     processo.status     || 'ativo',
      updated_by: req.session.usuario,
      updated_at: new Date().toISOString(),
      dados:      processo,
    };
    const { error } = await sb()
      .from('controle_processos')
      .upsert(row, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    console.log(`controle salvo: ${processo.referencia} por ${req.session.usuario}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('controle/processo POST erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

app.delete('/api/controle/processo/:id', auth('controle','financeiro'), requireGerente, async (req, res) => {
  try {
    const { data: procExcl } = await sb().from('controle_processos').select('id, referencia, cotacao_id').eq('id', req.params.id).maybeSingle();
    const { error } = await sb()
      .from('controle_processos')
      .delete()
      .eq('id', req.params.id);
    if (error) throw new Error(error.message);
    if (procExcl) await desvincularCotacoesDoProcessoExcluido(procExcl, req.session.usuario);
    res.json({ ok: true });
  } catch (e) {
    console.error('controle/processo DELETE erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

app.post('/api/controle/importar', auth('controle','financeiro'), async (req, res) => {
  try {
    const { processos } = req.body;
    if (!processos || !processos.length) return res.json({ ok: true, total: 0 });

    const agora = new Date().toISOString();

    // Já existentes (igual, ou com/sem o prefixo "IMPAK-") não são criados de novo.
    const { data: existentes, error: errExistentes } = await buscarTodosProcessos('id, referencia');
    if (errExistentes) throw new Error(errExistentes.message);
    const separados = RefProcesso.separarNovos(existentes, processos);

    const novos = separados.novos
      .map(p => {
        // Suportar tanto formato antigo (com dados{}) quanto novo (campos diretos)
        const d = p.dados || p;
        return {
          id:                  p.id || gerarUUID(),
          referencia:          p.referencia || d.referencia || '',
          fornecedor:          d.fornecedor  || '',
          cliente:             d.cliente     || p.cliente || '',
          produto:             d.produto     || '',
          fase:                d.fase        || p.fase || 'PI',
          eta:                 d.eta         || null,
          etd:                 d.etd         || null,
          data_embarque:       d.data_embarque || null,
          data_chegada:        d.data_chegada  || null,
          data_presenca:       d.data_presenca || null,
          armador:             d.armador     || '',
          navio:               d.navio       || '',
          container:           d.container   || '',
          hbl:                 d.hbl         || '',
          mbl:                 d.mbl         || '',
          numero_di:           d.numero_di   || '',
          obs:                 d.obs         || '',
          free_time:           d.free_time   || 21,
          demurrage_vencimento: d.demurrage_vencimento || null,
          created_by:          p.created_by || req.session.usuario,
          updated_by:          req.session.usuario,
          updated_at:          agora,
          created_at:          p.created_at || agora,
        };
      });

    // Mesma conferência de datas da criação em lote do Controle (v2).
    const datasRecusadas = [];
    for (const n of novos) {
      const { recusadas } = conferirDatasImportacao({}, n);
      recusadas.forEach(r => datasRecusadas.push({ referencia: n.referencia, campo: r.campo, valor: r.valor, motivo: r.motivo }));
    }

    if (!novos.length) {
      return res.json({ ok: true, total: 0, ignorados: processos.length, equivalentes: separados.equivalentes, msg: 'Todos já existem' });
    }

    for (let i = 0; i < novos.length; i += 50) {
      const { error } = await sb()
        .from('controle_processos')
        .insert(novos.slice(i, i + 50));
      if (error) throw new Error(error.message);
    }

    console.log(`controle/importar: ${novos.length} novos de ${processos.length} por ${req.session.usuario}`);
    res.json({ ok: true, total: novos.length, ignorados: processos.length - novos.length, equivalentes: separados.equivalentes, datas_recusadas: datasRecusadas });
  } catch (e) {
    console.error('controle/importar erro:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

app.get('/api/controle/carregar', auth('controle','financeiro','resultado','tv','narcelio'), async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('controle_processos')
      .select('dados')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    res.json({ ok: true, processos: (data || []).map(r => r.dados) });
  } catch (e) { res.json({ ok: true, processos: [] }); }
});

  return {};
}

module.exports = { registrar };
