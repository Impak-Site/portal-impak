// E-mails automáticos e jobs diários/semanais (follow-up, Radar IMPAK, alertas
// diários e separados, transportadora, sem cotação, faturas, agenda, verificação
// de dados e auditoria de datas). Saiu de server.js em 24/10/2026, sem mudar a
// lógica: o código é o mesmo, só recebe por parâmetro (deps) o que vinha do
// escopo do server.js. registrar() roda na mesma posição em que o bloco ficava,
// então as rotas continuam na mesma ordem.
'use strict';

function registrar(app, deps) {
  const {
    ALERTA_COPIA, CadastrosNormalizar, ConferenciaChave, DATAS_VALIDADAS_PROCESSO, FaturasCore,
    Newsletter, ValidacaoDatas, auth, buscarTodosProcessos, carregarListas, colunasSemRepetir,
    destinatariosDoAssunto, enviarEmail, escapeHtml, formatarPortoDestinoEmail, htmlParaQuem,
    montarClassificadorClientes, obterIndiceCadastros, registrarLogProcesso, requireGerente,
    resolverEmpresaId, sb, vencimentoPelaChegada, vencimentoSaldoPI, usuariosCache
  } = deps;

// ── FOLLOW-UP SEMANAL POR E-MAIL (processos com ETA próxima) ────
// Toda semana, junta os processos ativos com chegada prevista (ETA) nos
// próximos 10 dias, agrupa por cliente, e manda por e-mail pra Ayslan e
// Emanuelly conferirem — Emanuelly repassa manualmente ao cliente depois
// (não vai direto pro cliente, de propósito: é um rascunho pra revisão).
// Pede também a transportadora de cada processo, pra dar tempo hábil de
// organizar a retirada assim que a carga desembaraçar.
const FOLLOWUP_DIAS_JANELA = 10;
// Ayslan 08/10/2026: follow-up vai pra Emanuelly, UM e-mail por cliente --
// ela confere e decide se encaminha ao cliente ou nao (nunca vai direto pro
// cliente). Trocavel sem mexer no codigo via FOLLOWUP_PARA no Railway.
const FOLLOWUP_DESTINATARIOS = (process.env.FOLLOWUP_PARA || 'importacao1@impak.com.br').split(',').map(x => x.trim()).filter(Boolean);

async function processosParaFollowUpSemanal(){
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const limite = new Date(hoje); limite.setDate(hoje.getDate() + FOLLOWUP_DIAS_JANELA);
  const hojeStr = hoje.toISOString().split('T')[0];
  const limiteStr = limite.toISOString().split('T')[0];

  const { data, error } = await sb()
    .from('controle_processos')
    .select('id, referencia, cliente, fornecedor, produto, produtos_json, vendas_json, eta, porto_destino, armador, navio, transportadora, fase, cancelado')
    .not('eta', 'is', null)
    .gte('eta', hojeStr)
    .lte('eta', limiteStr)
    .neq('fase', 'FINALIZADO')
    // Processo cancelado não entra no follow-up mandado pro cliente (pedido
    // Emanuelly 03/09/2026).
    .or('cancelado.is.null,cancelado.eq.false')
    .order('eta', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

function descricaoProdutos(p){
  try{
    if (p.produtos_json) {
      const itens = JSON.parse(p.produtos_json).filter(it => it && it.descricao);
      if (itens.length) return itens.map(it => it.descricao + (it.quantidade ? ` (${it.quantidade})` : '')).join(', ');
    }
  } catch(e) { /* ignora produtos_json malformado, cai no campo legado abaixo */ }
  return p.produto || '—';
}

// Descrição dos itens de UMA venda específica (aba Vendas), não do processo
// inteiro — usado quando o processo tem mais de um cliente, pra cada bloco
// do follow-up mostrar só a quantidade vendida àquele cliente.
function descricaoItensDaVenda(venda){
    if (!venda || !Array.isArray(venda.itens)) return '';
    const itens = venda.itens.filter(it => it && it.descricao);
    if (!itens.length) return '';
    return itens.map(it => it.descricao + (it.quantidade ? ` (${it.quantidade})` : '')).join(', ');
}

// Expande a lista de processos em linhas de follow-up: quando o processo
// tem vendas_json com mais de um cliente, gera uma linha por cliente/venda
// (com os itens daquela venda); senão, mantém 1 linha por processo (campo
// cliente + produtos_json, comportamento antigo).
function linhasFollowUpPorCliente(processos){
    const linhas = [];
    processos.forEach(p => {
          let vendas = [];
          try { vendas = p.vendas_json ? JSON.parse(p.vendas_json) : []; } catch(e) { vendas = []; }
          vendas = Array.isArray(vendas) ? vendas.filter(v => v && v.cliente) : [];
          if (vendas.length) {
                  vendas.forEach(v => {
                            linhas.push(Object.assign({}, p, { cliente: v.cliente, _clienteId: v.cliente_id || null, _produtosTexto: descricaoItensDaVenda(v) || descricaoProdutos(p) }));
                  });
          } else {
                  linhas.push(Object.assign({}, p, { _clienteId: p.cliente_id || null, _produtosTexto: descricaoProdutos(p) }));
          }
    });
    return linhas;
}

async function montarEmailsFollowUpPorCliente(processos){
  const escHtml = v => v ? String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : '';
  const fmtData = iso => { try { return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR'); } catch(e) { return iso || '—'; } };

  const porCliente = {};
  // Clientes avulsos (NF pra pessoa física/compra pontual) não recebem
  // follow-up (pedido Emanuelly 28/09/2026) — ficam só no log do servidor. Se a classificação falhar, segue com todos (comportamento antigo).
  let ehPrincipal = () => true;
  try { ehPrincipal = await montarClassificadorClientes(); } catch(e) { console.warn('[followup] classificação de clientes indisponível:', e.message); }
  const avulsos = {};
  const idPorCliente = {};
  linhasFollowUpPorCliente(processos).forEach(p => {
    const chave = p.cliente || '(cliente não definido)';
    if (p.cliente && !ehPrincipal(p.cliente)) { (avulsos[chave] = avulsos[chave] || new Set()).add(p.referencia); return; }
    (porCliente[chave] = porCliente[chave] || []).push(p);
    if (p._clienteId && !idPorCliente[chave]) idPorCliente[chave] = p._clienteId;
  });

  const clientes = Object.keys(porCliente).sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const emails = await Promise.all(clientes.map(async cliente => {
    // Para quem encaminhar (quadro do rascunho): quem marcou "Follow-up" em
    // "E-mails que recebe" no cadastro do cliente (21/10/2026); sem ninguém
    // marcado, o contato principal da empresa (regra antiga).
    let paraQuem;
    try {
      const empId = await resolverEmpresaId(cliente, idPorCliente[cliente]);
      paraQuem = htmlParaQuem(await destinatariosDoAssunto('FOLLOWUP', empId ? [empId] : [], { fallbackPrincipal: true }), 'Follow-up', 'Encaminhar para');
    } catch(e) { paraQuem = '<strong>Não consegui ler os contatos do cliente</strong> (' + escHtml(e.message) + ').'; }
    const linhas = porCliente[cliente].map(p => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-weight:600;">${escHtml(p.referencia)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${escHtml(p.fornecedor)||'—'}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${escHtml(p._produtosTexto)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;">${fmtData(p.eta)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${escHtml(formatarPortoDestinoEmail(p.porto_destino))}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${escHtml(p.navio)||'—'}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:${p.transportadora?'#166534':'#b45309'};font-weight:600;">${escHtml(p.transportadora)||'⚠ a definir'}</td>
      </tr>`).join('');
    const html = `
    <div style="font-family:sans-serif;max-width:760px;margin:0 auto;">
      <div style="background:#f3f4f6;border:1px dashed #9ca3af;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:#374151;">
        <strong>RASCUNHO INTERNO — ainda não foi enviado ao cliente.</strong> Confira os dados; se estiver ok, encaminhe ao cliente apagando este quadro.<br>${paraQuem}
      </div>
      <h2 style="color:#1a7fd4;margin-bottom:4px;">IMPAK — Follow-up Semanal · ${escHtml(cliente)}</h2>
      <p style="color:#444;font-size:13px;margin-top:0;">Processos com chegada prevista (ETA) nos próximos ${FOLLOWUP_DIAS_JANELA} dias.</p>
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#92400e;">
        ⚠ <strong>Pedir a transportadora de cada processo</strong> o quanto antes — as linhas marcadas "a definir" ainda não têm transportadora informada no sistema. Isso dá tempo hábil pra organizar a retirada assim que a carga desembaraçar.
      </div>
<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#1e3a8a;">
As datas de chegada (ETA) informadas sao previsoes e podem sofrer alteracoes ou atrasos - inclua esse aviso ao repassar o follow-up para os clientes. Para os processos com chegada prevista NESTA SEMANA, pergunte ao cliente qual transportadora sera utilizada, para termos tempo habil de organizar o fluxo do processo.
</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;font-family:sans-serif;">
          <thead>
            <tr style="background:#f3f4f6;">
              <th style="padding:8px 10px;text-align:left;">Referência</th>
              <th style="padding:8px 10px;text-align:left;">Fornecedor</th>
              <th style="padding:8px 10px;text-align:left;">Produto</th>
              <th style="padding:8px 10px;text-align:center;">ETA</th>
              <th style="padding:8px 10px;text-align:left;">Destino</th>
              <th style="padding:8px 10px;text-align:left;">Navio</th>
              <th style="padding:8px 10px;text-align:left;">Transportadora</th>
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
    </div>`;
    return { cliente, qtd: porCliente[cliente].length, html };
  }));
  return { emails, avulsos: Object.keys(avulsos).map(c => `${c} (${[...avulsos[c]].join(', ')})`) };
}

// Relatório de segurança (item baixo): "já enviou hoje?" + "marcar enviado"
// eram dois passos separados — com dois servidores no ar ao mesmo tempo
// (deploy sobreposto) os dois podiam enviar o mesmo e-mail. Agora é uma
// "reserva" atômica: só quem consegue gravar a data de hoje primeiro envia.
async function reivindicarJobHoje(jobName, opts) {
  const agora = new Date();
  // Dia do controle: UTC por padrão (o servidor roda em UTC; o dia vira às
  // 21h de Brasília). Jobs presos a um dia da semana de Brasília passam
  // { diaBR: true } — com o dia UTC eles "renasciam" às 21h e saíam de novo
  // (Radar IMPAK de quarta 21/10: 6h e de novo 21h23).
  let inicioHoje;
  if (opts && opts.diaBR) inicioHoje = Newsletter.inicioDiaSP(agora);
  else { inicioHoje = new Date(agora); inicioHoje.setHours(0, 0, 0, 0); }
  const { data, error } = await sb().from('app_job_runs')
    .update({ last_run_at: agora.toISOString() })
    .eq('job_name', jobName).lt('last_run_at', inicioHoje.toISOString())
    .select('job_name');
  if (error) { console.error(`reivindicarJobHoje(${jobName}): erro, pulando por segurança:`, error.message); return false; }
  if (data && data.length) return true;
  // Nenhuma linha antiga: ou já rodou hoje, ou o job nunca rodou (sem linha).
  const { error: errIns } = await sb().from('app_job_runs').insert({ job_name: jobName, last_run_at: agora.toISOString() });
  if (!errIns) return true;
  return false; // conflito de chave = já existe linha de hoje (outro servidor pegou)
}

async function jaEnviouFollowUpHoje(){
  // dia de Brasília: o follow-up é da segunda de Brasília (sem isto, às 21h
  // de segunda o dia UTC virava e ele sairia de novo para os clientes)
  return !(await reivindicarJobHoje('followup_semanal', { diaBR: true }));
}

async function marcarFollowUpEnviadoHoje(){
  const { error } = await sb().from('app_job_runs').upsert({ job_name: 'followup_semanal', last_run_at: new Date().toISOString() });
  if (error) console.error('marcarFollowUpEnviadoHoje: falha ao gravar app_job_runs (job pode repetir!):', error.message);
}

async function enviarFollowUpSemanal(origem){
  const processos = await processosParaFollowUpSemanal();
  const { emails, avulsos } = await montarEmailsFollowUpPorCliente(processos);
  // De onde saiu este envio (19/10/2026): depois da importação da planilha do
  // despachante ou no horário-limite sem importação — vai no topo do e-mail.
  const o = origem || {};
  const hora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  const faixa = o.motivo === 'importacao'
    ? `<p style="margin:0 0 8px;padding:6px 10px;background:#ecfdf5;border-left:4px solid #10b981;font-size:13px;color:#065f46;">Gerado logo após a importação da planilha do despachante (hoje, ${escapeHtml(hora)}${o.usuario ? ', por ' + escapeHtml(o.usuario) : ''}) — ETAs atualizadas.</p>`
    : o.motivo === 'limite'
      ? `<p style="margin:0 0 8px;padding:6px 10px;background:#fff7e0;border-left:4px solid #d99a00;font-size:13px;color:#8a5a00;">Atenção: a planilha do despachante não foi importada hoje até as ${FOLLOWUP_HORA_LIMITE}h. Este follow-up usa as datas que já estavam no sistema — confira as ETAs antes de repassar.</p>`
      : '';
  if (faixa) emails.forEach(e => { e.html = e.html.includes('<strong>RASCUNHO INTERNO') ? e.html.replace('<strong>RASCUNHO INTERNO', faixa + '<strong>RASCUNHO INTERNO') : faixa + e.html; });
  let enviados = 0;
  for (const e of emails) {
    const assunto = `Follow-up semanal — ${e.cliente} (${e.qtd} processo${e.qtd===1?'':'s'} com ETA próxima)`;
    for (const destinatario of FOLLOWUP_DESTINATARIOS) {
      try { await enviarEmail(destinatario, assunto, e.html, { alerta: true }); enviados++; }
      catch (err) { console.error(`[followup] erro ao enviar ${e.cliente} pra ${destinatario}:`, err.message); }
      await new Promise(r => setTimeout(r, 700)); // Resend aceita ~2 envios/s; espaça pra não tomar 429
    }
  }
  if (avulsos.length) console.log('[followup] clientes avulsos fora do follow-up:', avulsos.join('; '));
  await marcarFollowUpEnviadoHoje();
  return { emails: emails.length, enviados, processos: processos.length };
}

// Follow-up semanal: sai na SEGUNDA, logo depois da importação da planilha
// do despachante (pedido Emanuelly 19/10/2026: "receber somente depois de
// importar a planilha na segunda", porque a planilha muda no fim de semana e
// os clientes preferem receber na segunda). Antes saía no domingo.
//   • importação do despachante na segunda (com ao menos 1 linha) → dispara
//     na hora (uma vez por dia: reivindicarJobHoje);
//   • se ninguém importar até FOLLOWUP_HORA_LIMITE (14h de Brasília), sai
//     assim mesmo, com um aviso no topo de que a planilha não foi importada.
const FOLLOWUP_HORA_LIMITE = parseInt(process.env.FOLLOWUP_HORA_LIMITE || '14', 10);
// A regra nova começa na segunda 26/10/2026 (no dia da publicação, 19/10, o
// follow-up de domingo já tinha saído).
const FOLLOWUP_SEGUNDA_DESDE = process.env.FOLLOWUP_SEGUNDA_DESDE || '2026-10-26';
function decidirFollowUp(sp, gatilho) {
  return Newsletter.decidirFollowUp(sp, gatilho, { horaLimite: FOLLOWUP_HORA_LIMITE, desde: FOLLOWUP_SEGUNDA_DESDE });
}
async function dispararFollowUp(motivo, info) {
  if (await jaEnviouFollowUpHoje()) return null;
  const r = await enviarFollowUpSemanal({ motivo, ...(info || {}) });
  console.log(`✓ Follow-up semanal enviado (${motivo}): ${r.emails} e-mails, ${r.processos} processos`);
  return r;
}
function checarFollowUpSemanal(){
  const motivo = decidirFollowUp(Newsletter.agoraSP(), 'relogio');
  if (!motivo) return;
  dispararFollowUp(motivo).catch(e => console.error('Erro no follow-up semanal:', e.message));
}
checarFollowUpSemanal();
setInterval(checarFollowUpSemanal, 30 * 60 * 1000);

// Disparo manual pra testar sem esperar domingo — restrito a gerente.
app.post('/api/admin/followup-semanal', auth(), requireGerente, (req, res) => {
  enviarFollowUpSemanal({ motivo: 'manual' })
    .then(r => res.json({ ok: true, ...r }))
    .catch(e => res.status(500).json({ ok: false, erro: e.message }));
});

// ── RADAR IMPAK — newsletter semanal para revisão (19/10/2026) ──────
// Segunda 6h (pneus) e quarta 6h (câmbio): o portal pesquisa, redige e
// manda ao revisor (Narcélio), com cópia no suporte@. Ele confere e só
// encaminha aos clientes. Ver newsletter-servidor.js. NEWSLETTER_PARA troca
// o revisor sem mexer no código; NEWSLETTER_DESLIGADA=1 desliga o envio.
const NEWSLETTER_PARA = (process.env.NEWSLETTER_PARA || 'narcelio@impak.com.br').split(',').map(x => x.trim()).filter(Boolean);
function urlLogoNewsletter() {
  return (process.env.APP_URL || 'https://portal-impak-production.up.railway.app').replace(/\/+$/, '') + '/assets/logo-email-impak.png';
}
// Sai em nome do suporte@ (pedido Ayslan 22/10/2026): o Narcélio responde o
// e-mail de revisão, e a resposta precisa chegar numa caixa de verdade.
const NEWSLETTER_REMETENTE = 'Suporte IMPAK <' + ALERTA_COPIA + '>';
async function enviarNewsletter(tipo, para) {
  const ed = await Newsletter.prepararEdicao(tipo, { logoUrl: urlLogoNewsletter() });
  for (const dest of (para || NEWSLETTER_PARA)) {
    await enviarEmail(dest, ed.assunto, ed.html, { alerta: true, from: NEWSLETTER_REMETENTE });
    await new Promise(r => setTimeout(r, 700));
  }
  return { assunto: ed.assunto, avisos: ed.avisos, buscas: ed.buscas, para: para || NEWSLETTER_PARA };
}
async function avisarFalhaNewsletter(tipo, erro) {
  const nome = tipo === 'pneus' ? 'Pneus (segunda)' : 'Câmbio (quarta)';
  const html = `<div style="font-family:Arial,sans-serif;color:#1f2937;max-width:640px;"><h2 style="margin:0 0 8px;">Radar IMPAK · ${escapeHtml(nome)} não foi gerado</h2>`
    + `<p>O portal tentou montar a newsletter e não conseguiu: <b>${escapeHtml(erro && erro.message || String(erro))}</b>.</p>`
    + `<p>Nada foi enviado ao revisor. Um gerente pode gerar de novo pelo portal (POST /api/admin/newsletter/${escapeHtml(tipo)}) ou pedir ao suporte.</p></div>`;
  try { await enviarEmail(ALERTA_COPIA, `Radar IMPAK (${nome}) não foi gerado`, html, { alerta: true }); }
  catch (e) { console.error('[newsletter] falha ao avisar erro:', e.message); }
}
// Primeira edição automática: quarta 21/10/2026 (a de segunda 19/10 já foi
// mandada à mão para o Narcélio).
const NEWSLETTER_DESDE = process.env.NEWSLETTER_DESDE || '2026-10-21';
function checarNewsletter() {
  if (process.env.NEWSLETTER_DESLIGADA === '1') return;
  if (Newsletter.agoraSP().dataISO < NEWSLETTER_DESDE) return;
  const tipo = Newsletter.edicaoDoMomento();
  if (!tipo) return;
  reivindicarJobHoje('newsletter_' + tipo, { diaBR: true }).then(ok => {
    if (!ok) return;
    enviarNewsletter(tipo)
      .then(r => console.log(`✓ Radar IMPAK (${tipo}) enviado para revisão: ${r.assunto} | ${r.buscas} buscas | avisos: ${r.avisos.length}`))
      .catch(e => { console.error(`Erro no Radar IMPAK (${tipo}):`, e.message); avisarFalhaNewsletter(tipo, e); });
  }).catch(e => console.error('Erro ao checar Radar IMPAK:', e.message));
}
checarNewsletter();
setInterval(checarNewsletter, 30 * 60 * 1000);

// Gerar na hora (gerente). destino "revisor" = Narcélio (+ cópia suporte@);
// "suporte" = só suporte@ (prévia). Demora 1–3 min: responde já e roda por trás.
app.post('/api/admin/newsletter/:tipo', auth(), requireGerente, (req, res) => {
  const tipo = req.params.tipo;
  if (!Newsletter.EDICOES[tipo]) return res.status(400).json({ ok: false, erro: 'Edição inválida (use pneus ou cambio).' });
  const destino = (req.body && req.body.destino) === 'revisor' ? 'revisor' : 'suporte';
  const para = destino === 'revisor' ? NEWSLETTER_PARA : [ALERTA_COPIA];
  enviarNewsletter(tipo, para)
    .then(r => console.log(`✓ Radar IMPAK (${tipo}) manual → ${r.para.join(', ')} por ${req.session.usuario}`))
    .catch(e => { console.error(`Erro no Radar IMPAK manual (${tipo}):`, e.message); avisarFalhaNewsletter(tipo, e); });
  res.json({ ok: true, iniciado: true, para, mensagem: 'Gerando — chega por e-mail em 1 a 3 minutos.' });
});

// ── ALERTAS DIÁRIOS (demurrage crítico, ETA vencido, ETA na semana, PI vencida) ──
async function jaEnviouAlertasHoje(){
  return !(await reivindicarJobHoje('alertas_diarios'));
}

async function marcarAlertasEnviadosHoje(){
const { error } = await sb().from('app_job_runs').upsert({ job_name: 'alertas_diarios', last_run_at: new Date().toISOString() });
if (error) console.error('marcarAlertasEnviadosHoje: falha ao gravar app_job_runs (job pode repetir!):', error.message);
}

// Colunas que os jobs de alerta por e-mail de fato leem -- união do que
// verificarAlertasDiarios/Demurrage/PedidoLI/AjusteDocumentos/CambioSemana/
// Transportadora usam (conferido função por função em 19/09/2026). Antes
// todos faziam select('*') e traziam os JSONs pesados (real_json,
// estimativa_json, produtos_json, containers_json, log...) de todos os
// processos, várias vezes por dia, à toa. conferencia_json, vendas_json e
// pi_parcelas_json ficam porque 1 job cada usa de verdade.
// Carga LCL (pedido Emanuelly 05/10/2026): marcada no painel como tipo de
// container 'LCL' (tipo_container = tipo do 1º container). Sem container
// próprio: não tem devolução de vazio nem demurrage — mesmos filtros que já
// existiam pro Acompanhamento.
function ehLCLServidor(p){ return String((p && p.tipo_container) || '').toUpperCase() === 'LCL'; }

const COLS_ALERTAS = [
  'id','referencia','cliente','fornecedor','fase','cancelado',
  'eta','etd','data_chegada','transportadora',
  'demurrage_vencimento','data_devolucao_vazio','tipo_container',
  'aprovacao_hbl','solicitacao_li','docs_enviados_despachante',
  'pi_valor_usd','ci_valor_usd','pi_pagamento','pi_pago','pi_cambio','pi_entrada_pct',
  'pi_data_entrada','pi_data_saldo','pi_cambio_entrada','pi_parcelas_json','pi_prazo_dias','finalidade','data_embarque',
  'vendas_json','conferencia_json','updated_at',
].join(',');
// Processos ativos (não finalizados) só com as colunas acima -- usado por
// todos os jobs de alerta. O filtro de FINALIZADO vai no banco; o de
// cancelado continua no JS porque a coluna pode ser null (não é false).
async function _processosAtivosParaAlertas(){
  const { data, error } = await sb().from('controle_processos')
    .select(COLS_ALERTAS)
    .neq('fase', 'FINALIZADO')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

async function verificarAlertasDiarios(){
let ativos;
try { ativos = await _processosAtivosParaAlertas(); }
catch (e) { console.error('Erro ao buscar processos p/ alertas diarios:', e.message); return 0; }
const hoje = new Date();
const semana = new Date(hoje); semana.setDate(hoje.getDate() + 7);
function demDias(p){
if (!p.demurrage_vencimento || p.data_devolucao_vazio || p.finalidade === 'ACOMPANHAMENTO' || ehLCLServidor(p)) return null; // Acompanhamento e carga LCL: sem demurrage
const d = new Date(p.demurrage_vencimento);
return Math.ceil((d - hoje) / 86400000);
}
const demCrit = ativos.filter(p => { const d = demDias(p); return d !== null && d <= 5; });
const etaVenc = ativos.filter(p => p.eta && p.fase === 'EMBARCADO' && new Date(p.eta) < hoje);
const etaSem = ativos.filter(p => p.eta && new Date(p.eta) >= hoje && new Date(p.eta) <= semana && p.fase === 'EMBARCADO');
const piVenc = ativos.filter(p => { const v = vencimentoSaldoPI(p); return v && !p.pi_pago && new Date(v) < hoje; });
const total = demCrit.length + etaVenc.length + etaSem.length + piVenc.length;
if (!total) { await marcarAlertasEnviadosHoje(); return 0; }
const escHtmlAlerta = v => v ? String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : '';
const linhaProc = (p, extra) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap;">${escHtmlAlerta(p.referencia) || '-'}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${escHtmlAlerta(p.cliente || p.fornecedor) || '-'}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap;">${escHtmlAlerta(p.fase) || '-'}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap;">${escHtmlAlerta(extra)}</td></tr>`;
const tabela = (titulo, itens, extraFn) => itens.length ? `<h3 style="margin:20px 0 8px;color:#333;">${titulo} (${itens.length})</h3><table style="width:100%;border-collapse:collapse;font-size:13px;"><tr><th style="text-align:left;padding:6px 10px;">Referencia</th><th style="text-align:left;padding:6px 10px;">Cliente/Fornecedor</th><th style="text-align:left;padding:6px 10px;">Fase</th><th style="text-align:left;padding:6px 10px;"></th></tr>${itens.map(p => linhaProc(p, extraFn(p))).join('')}</table>` : '';
// Ayslan 08/10/2026: "Os alertas financeiros devem ir pra paula, e os
// operacionais para emanuelly e só". O e-mail combinado foi dividido em dois:
// operacional (Demurrage/ETA) -> Emanuelly; financeiro (PI vencida) -> Paula.
const cab = titulo => `<div style="font-family:sans-serif;max-width:640px;margin:0 auto;"><h2 style="color:#1a7fd4;">IMPAK Portal - ${titulo} (${hoje.toLocaleDateString('pt-BR')})</h2>`;
const rod = `<p style="margin-top:20px;font-size:12px;color:#888;">E-mail automatico diario do IMPAK Portal.</p></div>`;
const totalOp = demCrit.length + etaVenc.length + etaSem.length;
if (totalOp) {
let htmlOp = cab('Alertas operacionais do dia');
htmlOp += tabela('Demurrage critico (ate 5 dias)', demCrit, p => { const d = demDias(p); return d < 0 ? `Vencido ha ${-d}d` : `Vence em ${d}d`; });
htmlOp += tabela('ETA vencido (ainda embarcado)', etaVenc, p => `ETA: ${new Date(p.eta).toLocaleDateString('pt-BR')}`);
htmlOp += tabela('Chegando essa semana', etaSem, p => `ETA: ${new Date(p.eta).toLocaleDateString('pt-BR')}`);
await enviarParaDestinatariosAlerta(`IMPAK Portal - ${totalOp} alerta(s) operacional(is) hoje`, htmlOp + rod, 'operacional');
}
if (piVenc.length) {
let htmlFin = cab('Alertas financeiros do dia');
htmlFin += tabela('PI vencida (saldo nao pago)', piVenc, p => `Venceu: ${new Date(vencimentoSaldoPI(p)).toLocaleDateString('pt-BR')}${p.pi_valor_usd ? ' - US$ ' + Number(p.pi_valor_usd).toLocaleString('pt-BR',{minimumFractionDigits:2}) : ''}`);
await enviarParaDestinatariosAlerta(`IMPAK Portal - ${piVenc.length} PI(s) vencida(s)`, htmlFin + rod, 'financeiro');
}
await marcarAlertasEnviadosHoje();
return total;
}

// ════════════════════════════════════════════════════════════════
// ALERTAS SEPARADOS POR E-MAIL (pedido Paula, 18/09/2026): "as pendencias
// de demurrage, envio de pedido de Li, ajuste nos documentos, cambio da
// semana" -- "tudo email separado um do outro". Cada um roda 1x/dia,
// independente do alerta combinado acima (verificarAlertasDiarios), com
// seu próprio controle de "já enviado hoje" em app_job_runs (job_name
// próprio por alerta, mesma tabela/mecanismo já usado).
// ════════════════════════════════════════════════════════════════

async function jaEnviouJobHoje(jobName, opts){
  return !(await reivindicarJobHoje(jobName, opts));
}

async function marcarJobEnviadoHoje(jobName){
  const { error } = await sb().from('app_job_runs').upsert({ job_name: jobName, last_run_at: new Date().toISOString() });
  if (error) console.error(`marcarJobEnviadoHoje(${jobName}): falha ao gravar app_job_runs (job pode repetir!):`, error.message);
}

// Destinatários por tipo de alerta (Ayslan 08/10/2026): financeiro -> Paula,
// operacional -> Emanuelly, "e só". Dá pra trocar sem mexer no código criando
// no Railway ALERTA_FINANCEIRO_PARA / ALERTA_OPERACIONAL_PARA (lista separada
// por vírgula).
const ALERTA_DESTINOS_PADRAO = {
  financeiro:  'paula@impak.com.br',
  operacional: 'importacao1@impak.com.br',
};
function destinatariosAlertas(tipo){
  const env = tipo === 'financeiro' ? process.env.ALERTA_FINANCEIRO_PARA : process.env.ALERTA_OPERACIONAL_PARA;
  const lista = (env || ALERTA_DESTINOS_PADRAO[tipo] || ALERTA_DESTINOS_PADRAO.operacional).split(',').map(s => s.trim()).filter(Boolean);
  return [...new Set(lista)];
}

async function enviarParaDestinatariosAlerta(assunto, html, tipo = 'operacional'){
  const destinatarios = destinatariosAlertas(tipo);
  for (const email of destinatarios) {
    try { await enviarEmail(email, assunto, html, { alerta: true }); }
    catch (e) { console.error(`Erro ao enviar e-mail "${assunto}" pra ${email}:`, e.message); }
  }
  return destinatarios.length;
}

const _escA = v => v ? String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : '';

function _tabelaAlertaHtml(colunas, linhasHtml){
  return `<table style="width:100%;border-collapse:collapse;font-size:13px;"><tr>${colunas.map(c=>`<th style="text-align:left;padding:6px 10px;">${_escA(c)}</th>`).join('')}</tr>${linhasHtml}</table>`;
}
function _cabecalhoAlertaHtml(titulo, hoje){
  return `<div style="font-family:sans-serif;max-width:640px;margin:0 auto;"><h2 style="color:#1a7fd4;">IMPAK Portal - ${titulo} (${hoje.toLocaleDateString('pt-BR')})</h2>`;
}
function _rodapeAlertaHtml(){
  return `<p style="margin-top:20px;font-size:12px;color:#888;">E-mail automático diário do IMPAK Portal.</p></div>`;
}

// ── 1) Pendências de Demurrage ──────────────────────────────────────
async function verificarAlertaDemurrage(){
  const jobName = 'alerta_demurrage';
  let ativos;
  try { ativos = (await _processosAtivosParaAlertas()).filter(p => !p.cancelado); }
  catch (e) { console.error('Erro ao buscar processos p/ alerta demurrage:', e.message); return 0; }
  const hoje = new Date();
  function demDias(p){
    if (!p.demurrage_vencimento || p.data_devolucao_vazio || p.finalidade === 'ACOMPANHAMENTO' || ehLCLServidor(p)) return null; // Acompanhamento e carga LCL: sem demurrage
    return Math.ceil((new Date(p.demurrage_vencimento) - hoje) / 86400000);
  }
  const pendentes = ativos.map(p => ({ p, d: demDias(p) })).filter(x => x.d !== null).sort((a,b) => a.d - b.d);
  if (!pendentes.length) { await marcarJobEnviadoHoje(jobName); return 0; }
  const linhas = pendentes.map(({p,d}) => {
    const situacao = d < 0 ? `Vencido há ${-d}d` : (d === 0 ? 'Vence hoje' : `Vence em ${d}d`);
    const cor = d <= 0 ? '#dc2626' : (d <= 5 ? '#b45309' : '#475569');
    return `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap;">${_escA(p.referencia)||'-'}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${_escA(p.cliente||p.fornecedor)||'-'}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap;color:${cor};font-weight:600;">${situacao}</td></tr>`;
  }).join('');
  const html = _cabecalhoAlertaHtml('Pendências de Demurrage', hoje)
    + `<p style="font-size:13px;color:#555;">${pendentes.length} processo(s) com container ainda não devolvido (demurrage em aberto).</p>`
    + _tabelaAlertaHtml(['Referência','Cliente/Fornecedor','Situação'], linhas)
    + _rodapeAlertaHtml();
  await enviarParaDestinatariosAlerta(`IMPAK Portal - ${pendentes.length} pendência(s) de Demurrage`, html);
  await marcarJobEnviadoHoje(jobName);
  return pendentes.length;
}

// ── 2) Envio de pedido de LI ────────────────────────────────────────
async function verificarAlertaPedidoLI(){
  const jobName = 'alerta_pedido_li';
  let ativos;
  try { ativos = (await _processosAtivosParaAlertas()).filter(p => !p.cancelado); }
  catch (e) { console.error('Erro ao buscar processos p/ alerta LI:', e.message); return 0; }
  // Mesma condição de verificarAlertas() (controle-core.js): HBL aprovado é
  // o gatilho pra enviar os docs à despachante solicitar a LI; some quando
  // a LI já foi confirmada como solicitada (solicitacao_li === 'Sim').
  const pendentes = ativos.filter(p => p.aprovacao_hbl === 'Sim' && p.solicitacao_li !== 'Sim');
  if (!pendentes.length) { await marcarJobEnviadoHoje(jobName); return 0; }
  const hoje = new Date();
  const linhas = pendentes.map(p => {
    const situacao = p.docs_enviados_despachante ? 'Docs já enviados — aguardando despachante solicitar a LI' : 'Enviar HBL/CI à despachante (Amanda/Find Comex)';
    return `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap;">${_escA(p.referencia)||'-'}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${_escA(p.cliente||p.fornecedor)||'-'}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${situacao}</td></tr>`;
  }).join('');
  const html = _cabecalhoAlertaHtml('Pedido de LI pendente', hoje)
    + `<p style="font-size:13px;color:#555;">${pendentes.length} processo(s) com HBL aprovado onde a LI ainda não foi confirmada como solicitada.</p>`
    + _tabelaAlertaHtml(['Referência','Cliente/Fornecedor','Pendência'], linhas)
    + _rodapeAlertaHtml();
  await enviarParaDestinatariosAlerta(`IMPAK Portal - ${pendentes.length} pedido(s) de LI pendente(s)`, html);
  await marcarJobEnviadoHoje(jobName);
  return pendentes.length;
}

// ── 3) Ajuste nos documentos (CI/PL/Draft faltando + divergências da
// Conferência ainda não aceitas) — pedido Ayslan: "os dois juntos no
// mesmo e-mail" ──────────────────────────────────────────────────────
function _contarPendentesConferencia(analiseStr){
  if (!analiseStr) return 0;
  let analise;
  try { analise = JSON.parse(analiseStr); } catch(e) { return 0; }
  return ConferenciaChave.contarConferencia(analise).pendentes;
}

async function verificarAlertaAjusteDocumentos(){
  const jobName = 'alerta_ajuste_documentos';
  let ativos;
  try { ativos = (await _processosAtivosParaAlertas()).filter(p => !p.cancelado); }
  catch (e) { console.error('Erro ao buscar processos p/ alerta ajuste documentos:', e.message); return 0; }

  // Nomes de arquivo do GED, em lote (mesma paginação usada em
  // GET /api/controle/v2/processos, pro alerta CI/PL/Draft).
  const arquivos = [];
  try {
    const PAGINA = 1000;
    for (let offset = 0; ; offset += PAGINA) {
      const { data: bloco, error: erroArquivos } = await sb().from('controle_arquivos').select('processo_id, nome').range(offset, offset + PAGINA - 1);
      if (erroArquivos) throw new Error(erroArquivos.message);
      if (!bloco || !bloco.length) break;
      arquivos.push(...bloco);
      if (bloco.length < PAGINA) break;
    }
  } catch (e) { console.warn('alerta ajuste documentos: falha ao buscar arquivos GED:', e.message); }
  const gedPorProcesso = {};
  arquivos.forEach(a => { (gedPorProcesso[a.processo_id] = gedPorProcesso[a.processo_id] || []).push(a.nome); });

  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const diaSemana = hoje.getDay();
  const inicioSemana = new Date(hoje); inicioSemana.setDate(hoje.getDate() - (diaSemana===0?6:diaSemana-1));
  const fimSemana = new Date(inicioSemana); fimSemana.setDate(inicioSemana.getDate()+6);

  const linhasDocs = [];
  ativos.forEach(p => {
    if (!p.etd || (p.fase !== 'PI' && p.fase !== 'AGUARDANDO_EMBARQUE')) return;
    const etd = new Date(p.etd);
    if (etd < inicioSemana || etd > fimSemana) return;
    const nomes = gedPorProcesso[p.id] || [];
    const temCI = nomes.some(n => /ci/i.test(n) || /invoice/i.test(n));
    const temPL = nomes.some(n => /pl/i.test(n) || /packing/i.test(n));
    const temDraft = nomes.some(n => /draft/i.test(n));
    const faltando = [!temCI&&'CI', !temPL&&'PL', !temDraft&&'Draft'].filter(Boolean);
    if (faltando.length) linhasDocs.push({ p, msg: `Embarque ${etd.toLocaleDateString('pt-BR')} — faltando: ${faltando.join(', ')}` });
  });

  const linhasConf = [];
  ativos.forEach(p => {
    const n = _contarPendentesConferencia(p.conferencia_json);
    if (n > 0) linhasConf.push({ p, msg: `${n} divergência(s) aguardando aceite/ajuste na Conferência` });
  });

  const total = linhasDocs.length + linhasConf.length;
  if (!total) { await marcarJobEnviadoHoje(jobName); return 0; }

  const linha = ({p, msg}) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap;">${_escA(p.referencia)||'-'}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${_escA(p.cliente||p.fornecedor)||'-'}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${_escA(msg)}</td></tr>`;
  let html = _cabecalhoAlertaHtml('Ajuste nos documentos', hoje);
  if (linhasDocs.length) html += `<h3 style="margin:16px 0 6px;color:#333;">Embarque esta semana sem CI/PL/Draft (${linhasDocs.length})</h3>` + _tabelaAlertaHtml(['Referência','Cliente/Fornecedor','Pendência'], linhasDocs.map(linha).join(''));
  if (linhasConf.length) html += `<h3 style="margin:16px 0 6px;color:#333;">Divergências pendentes na Conferência (${linhasConf.length})</h3>` + _tabelaAlertaHtml(['Referência','Cliente/Fornecedor','Pendência'], linhasConf.map(linha).join(''));
  html += _rodapeAlertaHtml();

  await enviarParaDestinatariosAlerta(`IMPAK Portal - ${total} ajuste(s) de documento(s) pendente(s)`, html);
  await marcarJobEnviadoHoje(jobName);
  return total;
}

// ── 4) Câmbio da semana ─────────────────────────────────────────────
// Reimplementação enxuta (só o necessário pro e-mail) do mesmo raciocínio
// de listarPagamentosPI() (controle-core.js, client-side) -- server.js não
// pode dar require() nos módulos do front (esperam `document` no escopo),
// então os 3 formatos de pagamento (Entrada+Saldo, Parcelado, Único/Prazo)
// são achatados aqui de novo, só com os campos usados no e-mail.
function _parcelasAbertasSemana(p, inicioStr, fimStr){
  const linhas = [];
  const valorTotal = parseFloat(p.pi_valor_usd) || 0;
  if (!valorTotal || p.finalidade === 'ACOMPANHAMENTO') return linhas; // só acompanhamos: sem câmbio da IMPAK
  if (p.pi_pagamento === 'PARCELADO') {
    let parcelas = [];
    try { parcelas = p.pi_parcelas_json ? JSON.parse(p.pi_parcelas_json) : []; } catch(e) { parcelas = []; }
    parcelas.forEach((pc, i) => {
      const v = parseFloat(pc.valor_usd) || 0;
      if (!v || pc.cambio_fechado) return; // já pago/fechado, não é mais pendência da semana
      const venc = (pc.label === 'Final' && vencimentoPelaChegada(p)) || pc.data_vencimento;
      if (!venc || venc < inicioStr || venc > fimStr) return;
      linhas.push({ parcela: pc.label || ('Parcela '+(i+1)), valorUsd: v, vencimento: venc, cambioPrevisto: parseFloat(p.pi_cambio)||null });
    });
  } else if (p.pi_pagamento === 'ENTRADA_SALDO') {
    const pct = parseFloat(p.pi_entrada_pct||30)/100;
    if (!p.pi_cambio_entrada && p.pi_data_entrada && p.pi_data_entrada >= inicioStr && p.pi_data_entrada <= fimStr) {
      linhas.push({ parcela: 'Entrada', valorUsd: valorTotal*pct, vencimento: p.pi_data_entrada, cambioPrevisto: parseFloat(p.pi_cambio)||null });
    }
    if (!p.pi_pago && p.pi_data_saldo && p.pi_data_saldo >= inicioStr && p.pi_data_saldo <= fimStr) {
      linhas.push({ parcela: 'Saldo', valorUsd: valorTotal*(1-pct), vencimento: p.pi_data_saldo, cambioPrevisto: parseFloat(p.pi_cambio)||null });
    }
  } else if (p.pi_pagamento === 'VISTA' || p.pi_pagamento === 'PRAZO') {
    const vencimento = p.pi_pagamento === 'PRAZO' ? vencimentoSaldoPI(p) : p.pi_data_entrada;
    // 100% a Prazo fecha pelo valor da CI quando ela existe (mesma regra de
    // valorPagamentoUnicoUsd no controle-core.js — revisão 20/10/2026).
    const ci = parseFloat(p.ci_valor_usd) || 0;
    const valorUnico = (p.pi_pagamento === 'PRAZO' && ci > 0) ? ci : valorTotal;
    if (!p.pi_pago && vencimento && vencimento >= inicioStr && vencimento <= fimStr) {
      linhas.push({ parcela: 'Único', valorUsd: valorUnico, vencimento, cambioPrevisto: parseFloat(p.pi_cambio)||null });
    }
  }
  return linhas;
}

// Nome(s) do(s) cliente(s) do processo, pra exibir no e-mail de Câmbio da
// semana -- pedido do Ayslan (18/09/2026): "da pra incluir o nome do
// cliente em cada linha pra saber?". Processo pode ter vendas_json com mais
// de um cliente (mesmo raciocínio de linhasFollowUpPorCliente, acima); como
// a parcela de câmbio é paga ao FORNECEDOR (não por venda individual), só
// lista os nomes juntos em vez de duplicar a linha por cliente.
function _clientesResumoProcesso(p){
  let vendas = [];
  try { vendas = p.vendas_json ? JSON.parse(p.vendas_json) : []; } catch(e) { vendas = []; }
  const nomes = Array.isArray(vendas) ? vendas.map(v => v && v.cliente).filter(Boolean) : [];
  if (nomes.length) return [...new Set(nomes)].join(', ');
  return p.cliente || '';
}

async function verificarAlertaCambioSemana(){
  const jobName = 'alerta_cambio_semana';
  let ativos;
  try { ativos = (await _processosAtivosParaAlertas()).filter(p => !p.cancelado); }
  catch (e) { console.error('Erro ao buscar processos p/ alerta câmbio da semana:', e.message); return 0; }
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const daqui7 = new Date(hoje); daqui7.setDate(hoje.getDate()+7);
  const inicioStr = hoje.toISOString().slice(0,10);
  const fimStr = daqui7.toISOString().slice(0,10);

  const linhas = [];
  ativos.forEach(p => { _parcelasAbertasSemana(p, inicioStr, fimStr).forEach(pg => linhas.push({ p, ...pg })); });
  if (!linhas.length) { await marcarJobEnviadoHoje(jobName); return 0; }
  linhas.sort((a,b) => (a.vencimento||'9999').localeCompare(b.vencimento||'9999'));

  const totalUsd = linhas.reduce((s,l) => s + l.valorUsd, 0);
  const corpo = linhas.map(l => {
    const brl = l.cambioPrevisto ? `R$ ${(l.valorUsd*l.cambioPrevisto).toLocaleString('pt-BR',{minimumFractionDigits:2})}` : '—';
    return `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap;">${l.vencimento ? new Date(l.vencimento+'T00:00:00').toLocaleDateString('pt-BR') : '-'}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap;">${_escA(l.p.referencia)||'-'}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${_escA(_clientesResumoProcesso(l.p))||'-'}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${_escA(l.p.fornecedor)||'-'}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${_escA(l.parcela)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">US$ ${l.valorUsd.toLocaleString('pt-BR',{minimumFractionDigits:2})}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">${brl}</td></tr>`;
  }).join('');
  const html = _cabecalhoAlertaHtml('Câmbio da semana', hoje)
    + `<p style="font-size:13px;color:#555;">${linhas.length} parcela(s) vencendo nos próximos 7 dias — total aproximado US$ ${totalUsd.toLocaleString('pt-BR',{minimumFractionDigits:2})}.</p>`
    + _tabelaAlertaHtml(['Vencimento','Processo','Cliente','Fornecedor','Parcela','Valor USD','BRL Estimado'], corpo)
    + _rodapeAlertaHtml();
  await enviarParaDestinatariosAlerta(`IMPAK Portal - Câmbio da semana (${linhas.length} parcela(s))`, html, 'financeiro');
  await marcarJobEnviadoHoje(jobName);
  return linhas.length;
}

// ── 5) Transportadora pendente (chegou sem transportadora anotada) ──
// Pedido Paula (18/09/2026): "se o processo chegou tem que estar anotado
// qual vai ser a transportadora e não tem começar a dar alerto no outro
// dia" -- ou seja, vale a partir do PRÓPRIO dia da chegada (Data Chegada),
// sem esperar o dia seguinte. Diferente do alerta semanal agregado de
// transportadora já existente (ligado à Data de Agendamento de
// carregamento, ver POST /api/controle/v2/processo acima) -- este aqui é
// por processo, diário, e olha pra Data de Chegada.
async function verificarAlertaTransportadora(){
  const jobName = 'alerta_transportadora';
  let ativos;
  try { ativos = (await _processosAtivosParaAlertas()).filter(p => !p.cancelado); }
  catch (e) { console.error('Erro ao buscar processos p/ alerta transportadora:', e.message); return 0; }
  const pendentes = ativos.filter(p => p.data_chegada && !p.transportadora && !p.data_devolucao_vazio);
  if (!pendentes.length) { await marcarJobEnviadoHoje(jobName); return 0; }
  const hoje = new Date();
  const linhas = pendentes.map(p => {
    const chegada = new Date(p.data_chegada+'T00:00:00');
    const dias = Math.max(0, Math.round((hoje - chegada) / 86400000));
    return `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap;">${_escA(p.referencia)||'-'}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${_escA(p.cliente||p.fornecedor)||'-'}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap;">${chegada.toLocaleDateString('pt-BR')} (há ${dias}d)</td></tr>`;
  }).join('');
  const html = _cabecalhoAlertaHtml('Transportadora pendente', hoje)
    + `<p style="font-size:13px;color:#555;">${pendentes.length} processo(s) já chegado(s) sem a Transportadora informada (aba Logística).</p>`
    + _tabelaAlertaHtml(['Referência','Cliente/Fornecedor','Data Chegada'], linhas)
    + _rodapeAlertaHtml();
  await enviarParaDestinatariosAlerta(`IMPAK Portal - ${pendentes.length} transportadora(s) pendente(s)`, html);
  await marcarJobEnviadoHoje(jobName);
  return pendentes.length;
}

// ── Carregamento: pedir a transportadora ao cliente (20/10/2026, Ayslan) ──
// Um e-mail por cliente com os processos chegando (ETA em até N dias ou já
// chegados) sem transportadora: referência, peças por container, peso bruto,
// porto de chegada, qtd. de containers e chegada (regras em
// lib/carregamento-core.js). FASE DE TESTE: vai para a equipe
// (CARREGAMENTO_TESTE_PARA, padrão José e Emanuelly, cópia suporte@) — nunca
// para o cliente. Quando o cadastro tiver "quem recebe o quê" por pessoa, o
// mesmo e-mail passa a ir direto para o responsável do cliente.
const CarregamentoCore = require('./carregamento-core.js');
const CARREGAMENTO_TESTE_PARA = (process.env.CARREGAMENTO_TESTE_PARA || 'operacional01@impak.com.br,importacao1@impak.com.br').split(',').map(s => s.trim()).filter(Boolean);
const CARREGAMENTO_DIAS_ETA = 15;
// Data de hoje no fuso de Brasília (o Railway roda em UTC).
const hojeBrasilia = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
async function montarPedidosTransportadora(opts) {
  opts = opts || {};
  const dias = Math.min(Math.max(parseInt(opts.dias, 10) || CARREGAMENTO_DIAS_ETA, 1), 60);
  const hoje = hojeBrasilia();
  // Em blocos de 1000 (limite do Supabase por consulta), ordenado por id.
  const data = [];
  for (let offset = 0; ; offset += 1000) {
    const { data: bloco, error } = await sb().from('controle_processos')
      // Só colunas que existem em controle_processos (não há "qtd_containers":
      // a quantidade vem de containers_json ou de qtd_containers_prevista).
      .select('id, referencia, cliente, cliente_id, vendas_json, finalidade, fase, cancelado, fechado, transportadora, transportadora_id, despachante_id, data_agendamento, agendamento_cancelado, data_carregamento, data_devolucao_vazio, data_chegada, data_presenca, eta, porto_destino, qtd_containers_prevista, container, containers_json, peso_bruto, produtos_json')
      .neq('fase', 'FINALIZADO')
      .order('id', { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    if (!bloco || !bloco.length) break;
    data.push(...bloco);
    if (bloco.length < 1000) break;
  }
  const candidatos = data.filter(p => CarregamentoCore.precisaTransportadora(p, hoje, dias));
  // Peso/peças lidos dos documentos ficam no conferencia_json (pesado): só dos candidatos.
  if (candidatos.length) {
    const { data: confs, error: errConf } = await sb().from('controle_processos').select('id, conferencia_json').in('id', candidatos.map(p => p.id));
    if (errConf) throw new Error(errConf.message);
    const porId = new Map((confs || []).map(c => [c.id, c.conferencia_json]));
    candidatos.forEach(p => { p.conferencia_json = porId.get(p.id) || null; });
  }
  const grupos = CarregamentoCore.agruparPorCliente(candidatos);
  const escH = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const emails = [];
  for (const g of grupos) {
    let paraQuem;
    if (g.proprio) paraQuem = 'No futuro: lista interna da Logística (decisão da IMPAK).';
    else {
      // Quem marcou "Transporte rodoviário" no cadastro do cliente (Para/Cópia),
      // o despachante dos processos (marcados, em cópia) e a equipe marcada.
      try {
        const empId = await resolverEmpresaId(g.cliente, g.clienteId);
        const despachantes = [...new Set(g.processos.map(p => p.despachante_id).filter(Boolean))];
        const dest = await destinatariosDoAssunto('TRANSPORTE', empId ? [empId] : [], { fallbackPrincipal: true, empresasCopia: despachantes });
        paraQuem = htmlParaQuem(dest, 'Transporte rodoviário', 'No futuro iria para');
      } catch (e) { paraQuem = '<strong>Não consegui ler os contatos do cliente</strong> (' + escH(e.message) + ').'; }
    }
    if (opts.reenvio) paraQuem = '<strong>Reenvio:</strong> o envio anterior pode ter chegado incompleto (limite do provedor de e-mail) — considere este.<br>' + paraQuem;
    const o = { teste: true, reenvio: !!opts.reenvio, nomePorto: c => (c && String(c).trim()) ? formatarPortoDestinoEmail(c) : '', paraQuemHtml: paraQuem };
    emails.push({ cliente: g.cliente, proprio: g.proprio, qtd: g.processos.length, referencias: g.processos.map(p => p.referencia), assunto: CarregamentoCore.assuntoEmail(g, o), html: CarregamentoCore.htmlEmailCliente(g, o) });
  }
  return { hoje, dias, total: candidatos.length, emails };
}
app.get('/api/carregamento/pedir-transportadora/previa', auth('controle'), async (req, res) => {
  try {
    const r = await montarPedidosTransportadora({ dias: req.query.dias });
    res.json(Object.assign({ ok: true, para: CARREGAMENTO_TESTE_PARA, copia: ALERTA_COPIA }, r));
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});
let _carregamentoUltimoTeste = 0;
// Resultado do último envio (memória do servidor) — pra conferir depois o que
// foi e o que falhou (GET .../ultimo-envio). 20/10/2026: o 1º envio saiu sem
// intervalo e o Resend (~2 envios/s) pode ter recusado parte com 429.
let _carregamentoUltimoEnvio = null;
app.post('/api/carregamento/pedir-transportadora/enviar-teste', auth('controle'), async (req, res) => {
  try {
    const body = req.body || {};
    // Só alguns clientes (ex.: reenviar os que falharam) — lista de nomes como
    // aparecem na prévia.
    const filtro = Array.isArray(body.clientes) && body.clientes.length ? new Set(body.clientes.map(c => String(c))) : null;
    const espera = filtro ? 20 * 1000 : 2 * 60 * 1000;
    if (Date.now() - _carregamentoUltimoTeste < espera) return res.status(429).json({ ok: false, erro: `O teste acabou de ser enviado — espere ${filtro ? '20 segundos' : '2 minutos'} para mandar de novo.` });
    _carregamentoUltimoTeste = Date.now();
    const r = await montarPedidosTransportadora({ dias: body.dias, reenvio: !!body.reenvio });
    const emails = filtro ? r.emails.filter(m => filtro.has(m.cliente)) : r.emails;
    const resultados = await CarregamentoCore.enviarEmSequencia(emails, m => enviarEmail(CARREGAMENTO_TESTE_PARA, m.assunto, m.html, { alerta: true }));
    const enviados = resultados.filter(x => x.ok).length;
    const falhas = resultados.filter(x => !x.ok).map(x => ({ cliente: x.item.cliente, erro: x.erro }));
    falhas.forEach(f => console.warn(`[carregamento] e-mail de teste NÃO enviado (${f.cliente}): ${f.erro}`));
    console.log(`[carregamento] teste "pedir transportadora": ${enviados}/${emails.length} e-mail(s) para ${CARREGAMENTO_TESTE_PARA.join(', ')} por ${req.session.usuario}`);
    _carregamentoUltimoEnvio = {
      em: new Date().toISOString(), por: req.session.usuario, para: CARREGAMENTO_TESTE_PARA, reenvio: !!body.reenvio,
      resultados: resultados.map(x => ({ cliente: x.item.cliente, assunto: x.item.assunto, ok: x.ok, erro: x.erro || null })),
    };
    res.json({ ok: !falhas.length, enviados, total: emails.length, processos: r.total, para: CARREGAMENTO_TESTE_PARA, falhas, resultados: _carregamentoUltimoEnvio.resultados });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});
app.get('/api/carregamento/pedir-transportadora/ultimo-envio', auth('controle'), (req, res) => {
  res.json({ ok: true, envio: _carregamentoUltimoEnvio });
});

// ── Processos sem cotação (semanal, segunda-feira → Jean) ─────────────
// Ayslan 13/10/2026: regra "todo processo nasce no TyreDesk/Calculador";
// o alerta vai pro comercial (Jean) 1x por semana. Mesma regra de
// origemProcesso() (controle-core.js): sem cotacao_id e sem estimativa_json.
// Destinatário trocável pelo Railway: ALERTA_COMERCIAL_PARA.
const ALERTA_COMERCIAL_PADRAO = 'jean@impak.com.br';
// Só processos criados a partir do início da regra — o histórico migrado das
// planilhas nasceu no Controle por definição (mesma data de
// REGRA_COTACAO_DESDE em controle-core.js).
const ALERTA_SEM_COTACAO_DESDE = process.env.ALERTA_SEM_COTACAO_DESDE || '2026-10-13';
async function verificarAlertaSemCotacao(){
  const jobName = 'alerta_sem_cotacao_semanal';
  const { data, error } = await sb().from('controle_processos')
    .select('id, referencia, cliente, fornecedor, fase, finalidade, cancelado, pi_data, eta, created_at')
    .neq('fase', 'FINALIZADO')
    .is('cotacao_id', null).is('estimativa_json', null)
    .gte('created_at', ALERTA_SEM_COTACAO_DESDE)
    .order('created_at', { ascending: false });
  if (error) { console.error('Erro ao buscar processos sem cotação:', error.message); return 0; }
  const pendentes = (data || []).filter(p => !p.cancelado && p.finalidade !== 'ACOMPANHAMENTO');
  const hoje = new Date();
  if (!pendentes.length) { await marcarJobEnviadoHoje(jobName); return 0; }
  const fmtD = v => v ? new Date(String(v).slice(0,10)+'T00:00:00').toLocaleDateString('pt-BR') : '-';
  const linhas = pendentes.map(p => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap;">${_escA(p.referencia)||'-'}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${_escA(p.cliente)||'-'}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${_escA(p.fornecedor)||'-'}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap;">${_escA(p.fase)||'-'}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap;">${fmtD(p.pi_data)}</td></tr>`).join('');
  const html = _cabecalhoAlertaHtml('Processos sem cotação', hoje)
    + `<p style="font-size:13px;color:#555;">${pendentes.length} processo(s) em andamento criado(s) direto no Controle, sem cotação do TyreDesk/Calculador vinculada. Sem a cotação, a aba Custos Reais não tem o valor cotado para comparar com o real. Para regularizar: abrir a cotação no Calculador e usar "Vincular a processo".</p>`
    + _tabelaAlertaHtml(['Referência','Cliente','Fornecedor','Fase','Data PI'], linhas)
    + `<p style="margin-top:20px;font-size:12px;color:#888;">E-mail automático semanal (segunda-feira) do IMPAK Portal.</p></div>`;
  const destinos = (process.env.ALERTA_COMERCIAL_PARA || ALERTA_COMERCIAL_PADRAO).split(',').map(s => s.trim()).filter(Boolean);
  for (const email of [...new Set(destinos)]) {
    try { await enviarEmail(email, `IMPAK Portal - ${pendentes.length} processo(s) sem cotação`, html, { alerta: true }); }
    catch (e) { console.error('Erro ao enviar alerta sem cotação p/ ' + email + ':', e.message); }
  }
  await marcarJobEnviadoHoje(jobName);
  return pendentes.length;
}

// ── Faturas vencidas / vencendo (14/10/2026) ─────────────────────────
// Diário, pro Financeiro (destinatariosAlertas('financeiro'), só
// @impak.com.br). Só manda quando tem algo vencido ou vencendo em 3 dias.
async function verificarAlertaFaturas(){
  const jobName = 'alerta_faturas';
  const { data: dataBruta, error } = await sb().from('faturas').select('id,numero,tipo,empresa_nome,documento,moeda,valor,valor_pago,cambio,vencimento,status,itens').eq('status', 'aberta').not('vencimento', 'is', null);
  // pagamento parcial: o alerta mostra o SALDO, não o total
  const data = (dataBruta || []).map(f => ({ ...f, valor: FaturasCore.saldoFatura(f) })).filter(f => f.valor > 0);
  if (error) { console.error('alerta faturas:', error.message); return 0; }
  const hoje = new Date().toISOString().slice(0, 10);
  const { vencidas, proximas } = FaturasCore.faturasParaAlerta(data || [], hoje, 3);
  if (!vencidas.length && !proximas.length) { await marcarJobEnviadoHoje(jobName); return 0; }
  const fmtV = f => `${f.moeda === 'USD' ? 'US$' : f.moeda === 'EUR' ? '€' : 'R$'} ${(parseFloat(f.valor) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dBR = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '-';
  const td = (v, extra) => `<td style="padding:6px 10px;border-bottom:1px solid #eee;${extra || ''}">${v}</td>`;
  const linha = f => `<tr>${td(f.tipo === 'pagar' ? 'Pagar' : 'Receber')}${td(_escA(f.numero || '-'), 'white-space:nowrap;')}${td(_escA(f.empresa_nome))}${td(_escA(f.documento || '-'))}${td(_escA([...new Set((f.itens || []).map(i => i.referencia).filter(Boolean))].join(', ') || '-'))}${td(dBR(f.vencimento), 'white-space:nowrap;')}${td(fmtV(f), 'text-align:right;white-space:nowrap;')}</tr>`;
  const cols = ['Tipo', 'Nº', 'Empresa', 'Documento', 'Processo', 'Vencimento', 'Valor'];
  const url = (process.env.APP_URL || 'https://portal-impak-production.up.railway.app').replace(/\/+$/, '') + '/faturas';
  const html = _cabecalhoAlertaHtml('Faturas vencidas e vencendo', new Date())
    + (vencidas.length ? `<h3 style="margin:14px 0 6px;color:#dc2626;">Vencidas (${vencidas.length})</h3>` + _tabelaAlertaHtml(cols, vencidas.map(linha).join('')) : '')
    + (proximas.length ? `<h3 style="margin:18px 0 6px;color:#b45309;">Vencem em até 3 dias (${proximas.length})</h3>` + _tabelaAlertaHtml(cols, proximas.map(linha).join('')) : '')
    + `<p style="margin-top:14px;font-size:12px;color:#888;">Marcar como paga em <a href="${url}">Financeiro → Faturas</a>.</p>` + _rodapeAlertaHtml();
  await enviarParaDestinatariosAlerta(`IMPAK Portal - Faturas: ${vencidas.length} vencida(s), ${proximas.length} vencendo`, html, 'financeiro');
  await marcarJobEnviadoHoje(jobName);
  return vencidas.length + proximas.length;
}

// ════════════════════════════════════════════════════════════════
// AGENDA — histórico diário + resumo semanal pros gerentes (14/10/2026,
// pedido Ayslan). O cálculo das tarefas é o mesmo do navegador
// (agenda-servidor.js carrega o motor do front num sandbox).
// ════════════════════════════════════════════════════════════════
const AgendaServidor = require('../agenda-servidor.js');
const _agendaCtx = () => ({ sb, carregarListas, log: (m) => console.log(m) });

async function atualizarHistoricoAgenda(){
  return AgendaServidor.atualizarHistorico(_agendaCtx());
}

// ── Verificação diária dos dados (22/10/2026, pedido Ayslan) ─────────────
// Processos antigos não podem ficar para trás quando entra uma regra nova
// (ver verificacao-dados.js). Todo dia: aplica nos processos abertos (não
// fechados/cancelados) as regras que só rodavam no Salvar — cliente pela NF
// de venda e Nº da DUIMP nas parcelas —, com linha no Histórico em nome de
// "verificacao-diaria". O que precisa de gente vira tarefa na Agenda
// (D01–D05). Update condicional ao updated_at lido: se alguém salvou o
// processo no meio, a correção fica para o dia seguinte.
const VerificacaoDados = require('../verificacao-dados.js');
const DuimpParcelasServidor = require('../duimp-parcelas.js');
async function rodarVerificacaoDados(opts){
  const aplicar = !!(opts && opts.aplicar);
  const motor = AgendaServidor.carregarMotor();
  if (!motor || typeof motor.clienteDaVendaDoProcesso !== 'function') throw new Error('motor do Controle indisponível no servidor');
  const { data: procs, error } = await buscarTodosProcessos('*');
  if (error) throw new Error(error.message);
  const resumo = VerificacaoDados.resumir(procs, motor, DuimpParcelasServidor);
  const aplicadas = [], falhas = [];
  if (aplicar && resumo.correcoes.length) {
    let indice = null;
    try { indice = await obterIndiceCadastros(); } catch (e) { indice = null; }
    const ids = new Set(resumo.correcoes.map(c => c.id));
    for (const p of procs) {
      if (!ids.has(p.id)) continue;
      const cs = VerificacaoDados.correcoesAutomaticas(p, motor, DuimpParcelasServidor);
      if (!cs.length) continue;
      const patch = Object.assign({}, ...cs.map(c => c.patch));
      // cliente novo: acerta o cliente_id (e o nome canônico) pelo cadastro, igual ao Salvar
      if ('cliente' in patch && indice) { try { CadastrosNormalizar.normalizarProcesso(patch, indice); } catch (e) { /* segue sem id */ } }
      patch.updated_at = new Date().toISOString();
      patch.updated_by = 'verificacao-diaria';
      const { data: upd, error: e2 } = await sb().from('controle_processos').update(patch).eq('id', p.id).eq('updated_at', p.updated_at).select('id');
      if (e2 || !upd || !upd.length) { falhas.push({ referencia: p.referencia, motivo: e2 ? e2.message : 'alterado por alguém durante a verificação — fica para a próxima' }); continue; }
      await registrarLogProcesso(p.id, 'verificacao-diaria', cs.flatMap(c => c.log.map(l => ({ campo: l.campo + ' (verificação diária: ' + c.titulo + ')', valor_antes: l.valor_antes, valor_depois: l.valor_depois }))));
      cs.forEach(c => aplicadas.push({ referencia: p.referencia, regra: c.regra, titulo: c.titulo }));
    }
  }
  return { processos: procs.length, aplicar, correcoes: resumo.correcoes.map(c => ({ referencia: c.referencia, regra: c.regra, titulo: c.titulo, log: c.log })),
    aplicadas, falhas, pendencias: resumo.pendencias.map(x => ({ codigo: x.codigo, nome: x.nome, total: x.processos.length, processos: x.processos.slice(0, 200) })) };
}
// Gerente: prévia (o que seria corrigido + dados para conferir), sem gravar.
app.get('/api/admin/verificacao-dados', auth(), requireGerente, async (req, res) => {
  try { res.json({ ok: true, ...(await rodarVerificacaoDados({ aplicar: false })) }); }
  catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});
// Gerente: roda agora (aplica as correções seguras), sem esperar o job.
app.post('/api/admin/verificacao-dados/rodar', auth(), requireGerente, async (req, res) => {
  try { res.json({ ok: true, ...(await rodarVerificacaoDados({ aplicar: true })) }); }
  catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});
function _destinatariosResumoAgenda(){
  const env = process.env.AGENDA_RESUMO_PARA;
  if (env) return [...new Set(env.split(',').map(s => s.trim()).filter(Boolean))];
  // Padrão: todo mundo com perfil gerente (Narcélio, Paula, Jean, Bianca, suporte).
  return [...new Set([...usuariosCache().values()].filter(u => u.role === 'gerente' && u.email).map(u => u.email))];
}
async function enviarResumoSemanalAgenda(opts){
  opts = opts || {};
  await atualizarHistoricoAgenda(); // garante o histórico do dia antes de somar
  const ctx = _agendaCtx();
  const { hoje, cfg, tarefas } = await AgendaServidor.gerarTarefas(ctx);
  const desde = new Date(); desde.setDate(desde.getDate() - 7);
  const { data: hist } = await sb().from('agenda_historico').select('chave,funcao,prazo,fechada_em').gte('fechada_em', desde.toISOString().slice(0, 10));
  const r = AgendaServidor.resumoPorPessoa(cfg, tarefas.filter(t => t.status === 'aberta'), hist || [], hoje, 7);
  const dBR = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) : '-';
  const td = (v, extra) => `<td style="padding:6px 10px;border-bottom:1px solid #eee;${extra || ''}">${v}</td>`;
  const linhas = r.linhas.map(l => `<tr>${td('<b>' + _escA(l.nome) + '</b><br><span style="color:#888;font-size:11px;">' + _escA(l.funcoes.join(', ')) + '</span>')}${td(l.abertas, 'text-align:center;')}${td(l.atrasadas, 'text-align:center;font-weight:700;color:' + (l.atrasadas ? '#dc2626' : '#475569') + ';')}${td(l.maisAntiga ? l.maisAntiga + 'd' : '-', 'text-align:center;')}${td(l.fechadas, 'text-align:center;')}${td(l.comAtraso, 'text-align:center;color:' + (l.comAtraso ? '#b45309' : '#475569') + ';')}${td(l.pctNoPrazo == null ? '-' : l.pctNoPrazo + '%', 'text-align:center;')}</tr>`).join('');
  const piores = r.piores.map(t => `<tr>${td(_escA(t.referencia || '-'), 'white-space:nowrap;')}${td(_escA(t.atividade))}${td(_escA(t.responsaveis || t.funcao))}${td(dBR(t.prazo), 'white-space:nowrap;')}${td(t.atraso + 'd', 'color:#dc2626;font-weight:700;white-space:nowrap;')}</tr>`).join('');
  const totalAtr = r.linhas.reduce((s, l) => s + l.atrasadas, 0);
  const html = _cabecalhoAlertaHtml('Resumo semanal da Agenda', new Date())
    + `<p style="font-size:13px;color:#555;">Situação por pessoa em ${dBR(hoje)}. "Fechadas 7d" = tarefas concluídas desde ${dBR(r.desde)}; "c/ atraso" = concluídas depois do prazo.</p>`
    + _tabelaAlertaHtml(['Pessoa', 'Abertas', 'Atrasadas', 'Mais antiga', 'Fechadas 7d', 'c/ atraso', 'No prazo'], linhas)
    + (piores ? `<h3 style="margin:18px 0 6px;color:#333;">10 maiores atrasos</h3>` + _tabelaAlertaHtml(['Referência', 'Atividade', 'Responsável', 'Prazo', 'Atraso'], piores) : '<p>Nenhuma tarefa atrasada.</p>')
    + `<p style="margin-top:14px;font-size:12px;color:#888;">Detalhe em <a href="${(process.env.APP_URL || 'https://portal-impak-production.up.railway.app').replace(/\/+$/, '')}/agenda">Agenda → Toda a equipe</a>. Responsáveis por função em Cadastros → Listas → "Agenda — Funções".</p>`
    + `<p style="font-size:12px;color:#888;">E-mail automático semanal (segunda-feira) do IMPAK Portal.</p></div>`;
  const destinos = opts.para ? [String(opts.para)] : _destinatariosResumoAgenda();
  let enviados = 0;
  for (const email of destinos) {
    try { const r = await enviarEmail(email, `IMPAK Portal - Agenda: ${totalAtr} tarefa(s) atrasada(s) na equipe`, html, { alerta: true }); if (!(r && r.pulado)) enviados++; }
    catch (e) { console.error('Erro ao enviar resumo da agenda p/ ' + email + ':', e.message); }
  }
  if (!opts.forcar) await marcarJobEnviadoHoje('agenda_resumo_semanal');
  return { enviados, destinos, atrasadas: totalAtr, pessoas: r.linhas.length };
}

// ════════════════════════════════════════════════════════════════
// AUDITORIA SEMANAL DAS DATAS (pedido Ayslan): toda segunda, a partir das
// 07:00 de Brasília, a mesma conferência do painel (validacao-datas.js) em
// todos os processos não cancelados — data impossível, fora de sequência,
// longe da previsão, no futuro, viagem curta ou longa demais. Pega o erro
// venha de onde vier (digitação, leitura da IA, importação, Conexos).
// ════════════════════════════════════════════════════════════════
const COLS_AUDITORIA_DATAS = colunasSemRepetir(
  'id, referencia, cliente, fornecedor, fase, cancelado, fechado, updated_at, tipo_container',
  DATAS_VALIDADAS_PROCESSO,
  'ce_data_embarque, ci_data, data_agendamento, data_parametrizacao, data_envio_termo, data_solicitacao_demurrage, data_isencao_demurrage, ' +
  'data_pagamento_demurrage, data_pagamento_lavagem, demurrage_vencimento, armazenagem_vencimento, entrada_armazem, nf_saida_data, ' +
  'pi_data, pi_data_entrada, pi_data_saldo, pi_data_recebimento, pi_venc_di, previsao_prontidao');

// Quem recebe: ALERTA_DATAS_PARA no Railway (lista separada por vírgula) ou,
// sem ela, os mesmos destinatários dos alertas operacionais.
function _destinatariosAuditoriaDatas(){
  const env = process.env.ALERTA_DATAS_PARA;
  if (env) return [...new Set(env.split(',').map(s => s.trim()).filter(Boolean))];
  return destinatariosAlertas('operacional');
}

async function montarAuditoriaDatas(){
  const { data, error } = await buscarTodosProcessos(COLS_AUDITORIA_DATAS);
  if (error) throw new Error('auditoria de datas: ' + (error.message || error));
  const lista = data || [];
  const achados = ValidacaoDatas.auditarProcessos(lista);
  const nErros = a => a.problemas.filter(x => x.nivel === 'erro').length;
  const seteDias = Date.now() - 7 * 86400000;
  const recente = p => !!p.updated_at && Date.parse(p.updated_at) >= seteDias;
  const ordenar = itens => itens.sort((a, b) => (nErros(b) - nErros(a)) || String(a.processo.referencia || '').localeCompare(String(b.processo.referencia || '')));
  // Alterados na semana primeiro: problema novo é o mais fácil de conferir.
  const grupos = [
    { chave: 'recentes', titulo: 'Alterados nos últimos 7 dias', itens: ordenar(achados.filter(a => !a.processo.fechado && recente(a.processo))) },
    { chave: 'antigos', titulo: 'Sem alteração nos últimos 7 dias', itens: ordenar(achados.filter(a => !a.processo.fechado && !recente(a.processo))) },
    { chave: 'fechados', titulo: 'Processos fechados (para corrigir, reabra o processo)', itens: ordenar(achados.filter(a => a.processo.fechado)) },
  ];
  const totalErros = achados.reduce((s, a) => s + nErros(a), 0);
  const totalAvisos = achados.reduce((s, a) => s + a.problemas.length - nErros(a), 0);
  const base = (process.env.APP_URL || 'https://portal-impak-production.up.railway.app').replace(/\/+$/, '');
  const td = (v, extra) => `<td style="padding:6px 10px;border-bottom:1px solid #eee;vertical-align:top;${extra || ''}">${v}</td>`;
  const linha = a => {
    const p = a.processo;
    const probs = a.problemas.slice().sort((x, y) => (x.nivel === 'erro' ? 0 : 1) - (y.nivel === 'erro' ? 0 : 1))
      .map(x => `<div style="margin:0 0 3px;"><b style="color:${x.nivel === 'erro' ? '#dc2626' : '#b45309'};">${x.nivel === 'erro' ? 'Erro' : 'Aviso'}:</b> ${_escA(x.msg)}</div>`).join('');
    return `<tr>${td(`<a href="${base}/controle?processo=${encodeURIComponent(p.id)}" style="color:#1a7fd4;font-weight:600;">${_escA(p.referencia) || '-'}</a>`, 'white-space:nowrap;')}${td(_escA(p.cliente || p.fornecedor) || '-')}${td(_escA(p.fase) || '-', 'white-space:nowrap;')}${td(probs)}</tr>`;
  };
  const html = _cabecalhoAlertaHtml('Auditoria semanal das datas', new Date())
    + `<p style="font-size:13px;color:#555;">A mesma conferência que o painel faz ao salvar, rodada em ${lista.filter(p => !p.cancelado).length} processos não cancelados. `
    + `<b style="color:#dc2626;">Erro</b> = data impossível (o painel não deixa salvar assim). <b style="color:#b45309;">Aviso</b> = muito improvável — confira no documento. Clique na referência para abrir o processo.</p>`
    + (achados.length ? grupos.filter(g => g.itens.length).map(g => `<h3 style="margin:18px 0 6px;color:#333;">${_escA(g.titulo)} (${g.itens.length})</h3>`
        + _tabelaAlertaHtml(['Referência', 'Cliente/Fornecedor', 'Fase', 'O que conferir'], g.itens.map(linha).join(''))).join('')
      : '<p>Nenhuma data para conferir.</p>')
    + `<p style="margin-top:14px;font-size:12px;color:#888;">E-mail automático semanal (segunda-feira) do IMPAK Portal.</p></div>`;
  const assunto = `IMPAK Portal - Auditoria de datas: ${achados.length} processo(s) para conferir` + (totalErros ? ` (${totalErros} erro(s))` : '');
  return { html, assunto, processos: lista.length, comProblema: achados.length, erros: totalErros, avisos: totalAvisos,
    grupos: Object.fromEntries(grupos.map(g => [g.chave, g.itens.length])) };
}

async function enviarAuditoriaDatas(){
  const a = await montarAuditoriaDatas();
  if (a.comProblema) {
    for (const email of _destinatariosAuditoriaDatas()) {
      try { await enviarEmail(email, a.assunto, a.html, { alerta: true }); }
      catch (e) { console.error('Erro ao enviar auditoria de datas p/ ' + email + ':', e.message); }
    }
  }
  await marcarJobEnviadoHoje('auditoria_datas_semanal');
  return a.comProblema;
}

// Prévia (gerente): o e-mail como sairia agora, sem enviar nada.
// ?formato=json devolve só os números e os destinatários.
app.get('/api/admin/auditoria-datas/previa', auth(), requireGerente, async (req, res) => {
  try {
    const a = await montarAuditoriaDatas();
    if (req.query.formato === 'json') {
      return res.json({ ok: true, assunto: a.assunto, processos: a.processos, com_problema: a.comProblema, erros: a.erros, avisos: a.avisos,
        grupos: a.grupos, destinatarios: _destinatariosAuditoriaDatas() });
    }
    res.type('html').send(a.html);
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

function agendarAlertasSeparados(){
  const ALERTAS_SEPARADOS = [
    { nome:'verificacao-dados', jobName:'verificacao_dados_diaria', fn:() => rodarVerificacaoDados({ aplicar: true }).then(r => r.aplicadas.length) },
    { nome:'agenda-historico', jobName:'agenda_historico_diario', fn:() => atualizarHistoricoAgenda().then(r => r.fechadas) },
    { nome:'agenda-resumo', jobName:'agenda_resumo_semanal', fn:() => enviarResumoSemanalAgenda().then(r => r.enviados), diaSemana:1 }, // só segunda-feira
    { nome:'demurrage', jobName:'alerta_demurrage', fn:verificarAlertaDemurrage },
    { nome:'pedido-li', jobName:'alerta_pedido_li', fn:verificarAlertaPedidoLI },
    { nome:'ajuste-documentos', jobName:'alerta_ajuste_documentos', fn:verificarAlertaAjusteDocumentos },
    { nome:'cambio-semana', jobName:'alerta_cambio_semana', fn:verificarAlertaCambioSemana },
    { nome:'transportadora', jobName:'alerta_transportadora', fn:verificarAlertaTransportadora },
    { nome:'sem-cotacao', jobName:'alerta_sem_cotacao_semanal', fn:verificarAlertaSemCotacao, diaSemana:1 }, // só segunda-feira
    { nome:'faturas', jobName:'alerta_faturas', fn:verificarAlertaFaturas },
    { nome:'auditoria-datas', jobName:'auditoria_datas_semanal', fn:enviarAuditoriaDatas, diaSemanaBR:1 }, // segunda, 07:00–20:59 de Brasília
  ];
  // Horário de Brasília (UTC-3, sem horário de verão). A janela termina às
  // 21:00 porque app_job_runs conta o dia em UTC: depois disso já é outro dia
  // lá e o job seria reservado de novo na mesma segunda.
  function naJanelaBR(diaSemanaBR){
    const br = new Date(Date.now() - 3 * 3600 * 1000);
    const h = br.getUTCHours();
    return br.getUTCDay() === diaSemanaBR && h >= 7 && h < 21;
  }
  function checar(){
    ALERTAS_SEPARADOS.forEach(({nome, jobName, fn, diaSemana, diaSemanaBR}) => {
      if (diaSemana != null && new Date().getDay() !== diaSemana) return; // semanal: nem reserva o job fora do dia
      if (diaSemanaBR != null && !naJanelaBR(diaSemanaBR)) return;
      jaEnviouJobHoje(jobName).then(ja => {
        if (ja) { console.log(`[alerta-${nome}] já enviado hoje, pulando.`); return; }
        fn().then(n => console.log(`[alerta-${nome}] verificação concluída, ${n} pendência(s) encontrada(s).`))
          .catch(e => console.error(`Erro no alerta ${nome}:`, e.message));
      }).catch(e => console.error(`Erro ao checar alerta ${nome}:`, e.message));
    });
  }
  checar();
  setInterval(checar, 30 * 60 * 1000); // checa a cada 30min; cada alerta só dispara 1x/dia (app_job_runs)
}

app.post('/api/admin/alertas-separados', auth(), requireGerente, (req, res) => {
  if (!req.session.usuario) return res.status(401).json({ ok: false, erro: 'Não autenticado' });
  if (req.session.role !== 'gerente') return res.status(403).json({ ok: false, erro: 'Apenas gerentes podem fazer isso' });
  Promise.all([
    verificarAlertaDemurrage(),
    verificarAlertaPedidoLI(),
    verificarAlertaAjusteDocumentos(),
    verificarAlertaCambioSemana(),
    verificarAlertaTransportadora(),
  ]).then(([demurrage, li, docs, cambio, transportadora]) => res.json({ ok:true, demurrage, li, docs, cambio, transportadora }))
    .catch(e => res.status(500).json({ ok:false, erro: e.message }));
});

function agendarAlertasDiarios(){
// FIX: mesmo problema do follow-up semanal (ver checarFollowUpSemanal acima)
// — setInterval() só checava no primeiro tick (30min depois do boot), nunca
// na hora. Com deploys frequentes reiniciando o processo, o alerta diario
// podia simplesmente nunca chegar a rodar num dia inteiro. Agora roda 1x
// imediatamente no boot (com log explicito do resultado, pra aparecer no
// Railway) e depois a cada 30min.
function checar(){
console.log('[alertas-diarios] checando...');
jaEnviouAlertasHoje().then(ja => {
if (ja) { console.log('[alertas-diarios] ja enviado hoje, pulando.'); return; }
verificarAlertasDiarios()
  .then(n => console.log(`[alertas-diarios] verificacao concluida, ${n} alerta(s) encontrado(s).`))
  .catch(e => console.error('Erro nos alertas diarios:', e.message));
}).catch(e => console.error('Erro ao checar alertas diarios:', e.message));
}
checar();
setInterval(checar, 30 * 60 * 1000); // checa a cada 30min; só dispara 1x/dia (controlado por app_job_runs)
}

app.post('/api/admin/alertas-diarios', auth(), requireGerente, (req, res) => {
if (!req.session.usuario) return res.status(401).json({ ok: false, erro: 'Não autenticado' });
if (req.session.role !== 'gerente') return res.status(403).json({ ok: false, erro: 'Apenas gerentes podem fazer isso' });
verificarAlertasDiarios()
.then(n => res.json({ ok: true, total: n || 0 }))
.catch(e => res.status(500).json({ ok: false, erro: e.message }));
});

  return {
    reivindicarJobHoje, jaEnviouJobHoje, marcarJobEnviadoHoje, decidirFollowUp, dispararFollowUp,
    ehLCLServidor, atualizarHistoricoAgenda, enviarResumoSemanalAgenda, agendarAlertasDiarios,
    agendarAlertasSeparados
  };
}

module.exports = { registrar };
