// controle-export.js
//
// Exports (RelatÃ³rio, Excel padrÃ£o, planilha formato cliente) â usa window.ExcelStyles (excel-styles.js) pra estilizaÃ§Ã£o.
//
// Parte do controle_v2.html, extraÃ­do do <script> Ãºnico original pra
// facilitar manutenÃ§Ã£o. Carregado via <script src> junto com os outros
// mÃ³dulos (ver controle_v2.html) â nÃ£o Ã© um ES module, entÃ£o todo
// estado (let/const de topo) e funÃ§Ãµes aqui continuam visÃ­veis pros
// outros arquivos, exatamente como estavam quando tudo era um sÃ³
// <script>. controle-core.js precisa carregar ANTES dos demais (Ã©
// quem declara o estado global: _processos, _user, FASES etc.).
//
async function exportarRelatorio(){
  const lista = filtrarProcessos();
  if(!lista.length){ showToast('Nenhum processo no filtro atual','warn'); return; }

  const cliente = document.getElementById('filtro-cliente')?.value||'Todos';
  const dtDe = document.getElementById('filtro-data-de')?.value||'';
  const dtAte = document.getElementById('filtro-data-ate')?.value||'';
  const fase = document.getElementById('fase-filter')?.querySelector('.active')?.textContent||'';

  showToast(`Gerando relatório de ${lista.length} processos...`,'ok');

  const rows = [
    ['IMPAK — Relatório de Processos de Importação'],
    [`Cliente: ${cliente}`, `Período: ${dtDe||'—'} a ${dtAte||'—'}`, `Fase: ${fase||'Todas'}`, `Total: ${lista.length} processos`],
    [`Gerado em: ${new Date().toLocaleString('pt-BR')}`],
    [],
    ['REF','FORNECEDOR','CLIENTE','FASE','ETA','ETD','EMBARQUE','CHEGADA',
     'ARMADOR','NAVIO','CONTAINER','HBL','MBL','Nº DI','CANAL',
     'PI VALOR USD','PI PAGO','NF SAÍDA Nº','NF SAÍDA VALOR',
     'LUCRO ESTIMADO','LUCRO REAL','DIFERENÇA (REAL − ESTIMADO)','OBS'],
  ];

  lista.forEach(p=>{
    const ctrs = p.containers_json ? JSON.parse(p.containers_json) : [{numero:p.container||'',tipo:p.tipo_container||'',lacre:''}];
    const ctStr = ctrs.map(c=>`${c.numero}${c.tipo?' ('+c.tipo+')':''}${c.lacre?' L:'+c.lacre:''}`).join(' | ');
    // Fechamento (estimado Ã real) â ver calcularFechamento(); vazio quando o
    // processo nÃ£o tem estimativa_json (criado direto no Controle) ou ainda nÃ£o
    // tem NF SaÃ­da lanÃ§ada.
    const f = calcularFechamento(p);
    // Vendas multi-cliente: quando o processo foi vendido a mais de um
    // cliente, nÃ£o existe "a" NF SaÃ­da â usa a soma (f.nfSaida, jÃ¡ calculada
    // por calcularFechamento a partir das vendas) e sinaliza no nÃºmero em
    // vez de mostrar o campo legado nf_saida_numero (que fica vazio/errado
    // nesse caso, jÃ¡ que cada venda tem seu prÃ³prio nÃºmero de NF).
    const nfSaidaNumeroCol = f.vendasResumo
      ? `Múltiplos (${f.vendasResumo.linhas.length} clientes — ver aba Vendas)`
      : (p.nf_saida_numero||'');
    const nfSaidaValorCol = f.vendasResumo ? (f.nfSaida!=null ? f.nfSaida.toFixed(2) : '') : (p.nf_saida_valor||'');
    rows.push([
      p.referencia||'', p.fornecedor||'', p.cliente||'', p.fase||'',
      p.eta||'', p.etd||'', p.data_embarque||'', p.data_chegada||'',
      p.armador||'', p.navio||'', ctStr,
      p.hbl||'', p.mbl||'', p.numero_di||'', p.canal||'',
      p.pi_valor_usd||'', p.pi_pago?'SIM':'NÃO',
      nfSaidaNumeroCol, nfSaidaValorCol,
      f.lucroEstimado!=null ? f.lucroEstimado.toFixed(2) : '',
      f.lucroReal!=null ? f.lucroReal.toFixed(2) : '',
      f.deltaValor!=null ? f.deltaValor.toFixed(2) : '',
      p.obs||'',
    ]);
  });

  try{
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [12,18,18,16,11,11,11,11,14,16,22,14,14,14,8,13,8,14,14,14,14,16,30].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb, ws, 'Processos');
    const nome = `IMPAK_Relatorio_${cliente.replace(/[^a-zA-Z0-9]/g,'_')}_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, nome);
    showToast(`✓ Relatório exportado: ${lista.length} processos`,'ok');
  }catch(e){
    showToast('Erro ao gerar relatório: '+e.message,'err');
  }
}

async function exportarExcel(){
  showToast('Gerando planilha...','info');
  try{
    const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
    const lista = filtrarProcessos(); // exporta a visão atual (com filtros aplicados)

    const linhas = lista.map(p=>{
    // Vendas multi-cliente: quando o processo foi vendido a mais de um
    // cliente, o campo legado NF SaÃ­da nÃ£o representa mais o processo
    // inteiro â troca pelo resumo (soma das NFs) e sinaliza quantos
    // clientes levaram parte deste processo, em vez de mostrar um valor
    // vazio ou de uma venda sÃ³.
    let vendasResumoExport = null;
    try{
      const vs = p.vendas_json ? JSON.parse(p.vendas_json) : [];
      if(Array.isArray(vs) && vs.length && typeof calcularVendasResumo==='function') vendasResumoExport = calcularVendasResumo(p);
    }catch(e){ vendasResumoExport = null; }
    return {
      'Referência':          p.referencia||'',
      'Fornecedor':          p.fornecedor||'',
      'Cliente':             p.cliente||'',
      'Produto':             p.produto||'',
      'Fase':                FASE_LABEL[p.fase]||p.fase||'',
      'Despachante':         p.despachante||'',
      'Armador':             p.armador||'',
      'Navio':               p.navio||'',
      'Valor do Frete':      p.valor_frete||'',
      'Moeda do Frete':      p.moeda_frete||'USD',
      'Porto Origem':        p.porto_origem||'',
      'Porto Destino':       p.porto_destino||'',
      'ETD':                 p.etd||'',
      'ETA':                 p.eta||'',
      'Data Embarque':       p.data_embarque||'',
      'Data Chegada':        p.data_chegada||'',
      'Presença de Carga':   p.data_presenca||'',
      'HBL':                 p.hbl||'',
      'MBL':                 p.mbl||'',
      'Container':           p.container||'',
      'Tipo Container':      p.tipo_container||'',
      'Free Time':           p.free_time||21,
      'Demurrage Vence':     p.demurrage_vencimento||'',
      'Demurrage Valor R$':  p.demurrage_valor||'',
      'Demurrage Pago':      p.demurrage_pago?'Sim':'Não',
      'Data Devolução Vazio':p.data_devolucao_vazio||'',
      'Nº DI':               p.numero_di||'',
      'Data Registro DI':    p.data_registro_di||'',
      'Canal':               p.canal||'',
      'Data Liberação':      p.data_liberacao||'',
      'Nº PI':               p.pi_numero||'',
      'Data PI':             p.pi_data||'',
      'Valor PI (USD)':      p.pi_valor_usd||'',
      'Câmbio PI':           p.pi_cambio||'',
      'Valor PI (BRL)':      p.pi_valor_usd&&p.pi_cambio ? (parseFloat(p.pi_valor_usd)*parseFloat(p.pi_cambio)).toFixed(2) : '',
      'Incoterm':            p.pi_incoterm||'',
      'Pagamento':           p.pi_pagamento||'',
      'PI Paga':             p.pi_pago?'Sim':'Não',
      'Nº CI':               p.ci_numero||'',
      'Valor CI (USD)':      p.ci_valor_usd||'',
      'NF Entrada Nº':       p.nf_entrada_numero||'',
      'NF Entrada Valor':    p.nf_entrada_valor||'',
      'NF Saída Nº':         vendasResumoExport ? `Múltiplos (${vendasResumoExport.linhas.length} clientes)` : (p.nf_saida_numero||''),
      'NF Saída Valor':      vendasResumoExport ? (vendasResumoExport.nfSaidaTotal||'') : (p.nf_saida_valor||''),
      'Vendido a (multi-cliente)': vendasResumoExport ? vendasResumoExport.linhas.map(l=>l.venda.cliente||'(sem cliente)').join(' / ') : '',
      'Agendamento':         p.data_agendamento||'',
      'Data Carregamento':   p.data_carregamento||'',
      'Transportadora':      p.transportadora||'',
      'Obs':                 p.obs||'',
    };
    });

    const wb  = XLSX.utils.book_new();
    const ws  = XLSX.utils.json_to_sheet(linhas);

    // Largura das colunas
    ws['!cols'] = Object.keys(linhas[0]||{}).map(k=>({wch: Math.max(k.length, 12)}));
    XLSX.utils.book_append_sheet(wb, ws, 'Processos');

    const data = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `IMPAK_Controle_${data}.xlsx`);
    showToast(`✓ ${lista.length} processos exportados`,'ok');
  }catch(e){
    showToast('Erro ao exportar: '+e.message,'err');
    console.error(e);
  }
}

// ââ MODAL: "Exportar p/ Cliente" â confirmar status + ordenar por chegada ââ
// Pedido: antes de gerar a planilha de follow-up, deixar o usuÃ¡rio confirmar
// quais status/fases entram (PI Recebida, Ag. Embarque, Embarcado etc), e
// garantir que o resultado saia ordenado por Data de Chegada. Em vez de
// exportar direto no clique do botÃ£o, abre este popup com um checkbox por
// fase (lido de FASES, controle-core.js, pra nunca ficar desalinhado com as
// fases reais do sistema) e sÃ³ chama exportarFormatoCliente() depois de
// confirmado.
function abrirModalExportCliente(){
  const cont = document.getElementById('exportcliente-status-list');
  cont.innerHTML = FASES.map(f=>`
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text);cursor:pointer;padding:3px 0;">
      <input type="checkbox" class="exportcliente-status-chk" value="${f.id}" checked> ${f.icon} ${f.label}
    </label>
  `).join('');
  document.getElementById('modal-exportcliente-bg').classList.add('open');
}

function fecharModalExportCliente(){
  document.getElementById('modal-exportcliente-bg').classList.remove('open');
}

function marcarTodosStatusExport(valor){
  document.querySelectorAll('.exportcliente-status-chk').forEach(chk=>{ chk.checked = valor; });
}

function confirmarExportCliente(){
  const statusSelecionados = Array.from(document.querySelectorAll('.exportcliente-status-chk'))
    .filter(chk=>chk.checked).map(chk=>chk.value);
  if(!statusSelecionados.length){ showToast('Marque ao menos um status para exportar','warn'); return; }
  fecharModalExportCliente();
  exportarFormatoCliente(statusSelecionados);
}

// ExportaÃ§Ã£o no formato de planilha enviada aos clientes (modelo "PNEUS
// EXPRESS"): uma linha por produto/medida (nÃ£o por processo), agrupado por
// Fornecedor, com mapeamento:
//   Data do Pedido = Data da PI Â· Medida = descriÃ§Ã£o do produto Â·
//   Quantidade = quantidade preenchida daquele item Â· Data de ProntidÃ£o na
//   FÃ¡brica = sem fonte no sistema hoje, fica em branco Â· Data de Embarque =
//   ETD Â· Data Chegada = Data Chegada Â· POD = Porto Destino.
//
// statusSelecionados (opcional): array com os ids de fase (FASES[].id) que
// devem entrar na planilha, escolhidos no popup abrirModalExportCliente().
// Quando omitido/vazio, exporta todos os status (mesmo comportamento de
// antes do popup existir) â mantÃ©m a funÃ§Ã£o utilizÃ¡vel de outros lugares
// sem quebrar nada.
async function exportarFormatoCliente(statusSelecionados){
  showToast('Gerando planilha no formato cliente...','info');
  try{
    // ExcelJS (carregado antecipadamente no <head>, ver comentÃ¡rio lÃ¡) em
    // vez da lib "xlsx" (usada nos outros exports) â o build gratuito da
    // "xlsx" nÃ£o estiliza cÃ©lulas (cor, borda, fonte); ExcelJS suporta isso
    // nativamente, o que permite gerar aqui uma planilha com visual
    // profissional, pronta pra ser enviada a um cliente/terceiro (task:
    // planilha de follow-up bem formatada pra exportar ao cliente).
    if(typeof ExcelJS === 'undefined'){
      showToast('Biblioteca de exportação ainda carregando, tente novamente em 1 segundo','err');
      return;
    }
    let lista = filtrarProcessos(true); // ignora o filtro de fase/status ativo na tela (task #335: antes, exportar com uma aba de status aberta gerava planilha só daquela fase; a seleção de status agora é feita só pelo popup, que já vem com todos marcados por padrão) — mantém os demais filtros (cliente, busca, data)

    // Filtro de status escolhido no popup (pedido: confirmar quais fases
    // entram antes de exportar). Sem seleÃ§Ã£o (chamada antiga/direta) exporta
    // todos os status, igual ao comportamento original.
    if(Array.isArray(statusSelecionados) && statusSelecionados.length){
      lista = lista.filter(p=>statusSelecionados.includes(p.fase));
    }

    // Ordena por Data de Chegada, do mais prÃ³ximo pro mais distante (pedido:
    // "tem que ser ordenado pela data de chegada"). Processos sem chegada
    // lanÃ§ada ainda vÃ£o pro final, nÃ£o pro topo. parseDataLocal() (nÃ£o
    // `new Date()` direto) pra nÃ£o reintroduzir o bug de UTCÃlocal jÃ¡
    // corrigido no resto do sistema.
    // Data Chegada (real) tem prioridade; processos que ainda nÃ£o chegaram
    // (ex.: Ag. Embarque, PI Recebida) usam a ETA (estimada) no lugar â mesma
    // regra da coluna "ETA / Chegada" da tela principal (ver dataDisplay em
    // render(), controle-core.js: `chegadaDate || etaDate`). Sem esse
    // fallback, todo processo ainda nÃ£o chegado ficava jogado pro fim da
    // planilha (Infinity), fora de ordem em relaÃ§Ã£o Ã  previsÃ£o de chegada.
    lista = [...lista].sort((a,b)=>{
      const dtA = a.data_chegada || a.eta;
      const dtB = b.data_chegada || b.eta;
      const da = dtA ? parseDataLocal(dtA).getTime() : Infinity;
      const db = dtB ? parseDataLocal(dtB).getTime() : Infinity;
      return da - db;
    });

    // Toggle manual (checkbox dentro do popup) â decide se a coluna "Valor
    // do Frete" entra ou nÃ£o nesse export. Fica marcado sÃ³ quando o usuÃ¡rio
    // realmente quer que o cliente veja esse valor (ex: negociaÃ§Ã£o FOB onde
    // o frete Ã© por conta do cliente); por padrÃ£o vem desmarcado/oculto.
    const incluirFrete = !!document.getElementById('exportcliente-incluir-frete')?.checked;

    // Nome do cliente selecionado no filtro da tela (se houver) â usado no
    // tÃ­tulo da planilha e no nome do arquivo, pra deixar claro pra quem Ã©
    // esse follow-up quando for reenviado por e-mail.
    const clienteFiltro = document.getElementById('filtro-cliente')?.value || '';

    // Montar 1 linha por produto. Quando o processo tem vendas cadastradas
    // (aba Vendas, vendas_json) e mais de uma delas tem cliente preenchido,
    // cada linha nasce a partir dos itens DA VENDA (venda.itens) â nÃ£o de
    // produtos_json â e carrega o cliente daquela venda especificamente
    // (pedido: "quando fizermos o follow up/exportar para cliente, tem que
    // puxar os dados de cada pedido separado por cliente da aba vendas").
    // Processos sem vendas cadastradas (ou com sÃ³ 1 venda) continuam usando
    // produtos_json/produto legado e o campo p.cliente, como antes.
    // lista jÃ¡ estÃ¡ ordenada por chegada, entÃ£o as linhas nascem nessa
    // ordem dentro de cada fornecedor/cliente.
    const linhas = [];
    lista.forEach(p=>{
      let vendas = [];
      try{ vendas = p.vendas_json ? JSON.parse(p.vendas_json) : []; }catch(e){ vendas = []; }
      const temMultiCliente = Array.isArray(vendas) && vendas.filter(v=>v && (v.itens||[]).length).length > 1;

      // Idem ao sort acima: sem chegada real ainda, usa a ETA â senÃ£o a
      // coluna "Data Chegada" ficava em branco pra qualquer processo em
      // Ag. Embarque/PI Recebida, mesmo jÃ¡ tendo previsÃ£o de chegada.
      const dtChegadaOuEta = p.data_chegada || p.eta;
      const chegadaTs = dtChegadaOuEta ? parseDataLocal(dtChegadaOuEta).getTime() : Infinity;

      const montarLinha = (clienteNome, it)=>{
        const linha = {
          // Pedido: na planilha de follow-up, mostrar a MARCA do produto
          // (ex: "Maxam") em vez do Fornecedor (ex: "Sailun Group", quem
          // efetivamente fatura/exporta) quando a marca estiver preenchida â
          // sÃ£o coisas diferentes e o cliente final reconhece a marca, nÃ£o
          // necessariamente o nome do fornecedor real. Sem marca preenchida,
          // cai no fornecedor, como sempre foi.
          fornecedor: p.brand || p.fornecedor || '—',
          cliente: clienteNome || '(sem cliente)',
          _chegadaTs: chegadaTs, // só pra ordenar os grupos de fornecedor abaixo, não vira coluna
          'Invoice':                 p.referencia||'',
          'Medida':                  it.descricao||'',
          'Qte':                     it.quantidade||'',
          'Data do Pedido':          p.pi_data ? parseDataLocal(p.pi_data).toLocaleDateString('pt-BR') : '',
          'Data de Prontidão na Fábrica': '', // sem fonte no sistema hoje
          'Data de Embarque':        p.etd ? parseDataLocal(p.etd).toLocaleDateString('pt-BR') : '',
          'Data Chegada':            dtChegadaOuEta ? parseDataLocal(dtChegadaOuEta).toLocaleDateString('pt-BR') + (p.data_chegada?'':' (estimado)') : '',
          'POD':                     p.porto_destino||'N/I',
        };
        if(incluirFrete){
          linha['Valor do Frete'] = p.valor_frete ? `${exibirMoeda(p.valor_frete)} ${p.moeda_frete||'USD'}` : '';
        }
        return linha;
      };

      if(temMultiCliente){
        vendas.forEach(v=>{
          (v.itens||[]).filter(it=>it.descricao).forEach(it=>{
            linhas.push(montarLinha(v.cliente || p.cliente, it));
          });
        });
      }else{
        let produtos = [];
        try{
          if(p.produtos_json) produtos = JSON.parse(p.produtos_json);
          else if(p.produto) produtos = [{descricao:p.produto, quantidade:''}];
        }catch(e){ produtos = p.produto ? [{descricao:p.produto, quantidade:''}] : []; }
        if(!produtos.length) produtos = [{descricao:'—', quantidade:''}];
        produtos.filter(it=>it.descricao).forEach(it=>{
          linhas.push(montarLinha(p.cliente, it));
        });
      }
    });

    if(!linhas.length){ showToast('Nenhum produto encontrado para exportar','err'); return; }

    // Separar por cliente â pedido: "um arquivo por cliente" quando hÃ¡ mais
    // de um cliente envolvido nas linhas selecionadas (seja porque a lista
    // tem processos de clientes diferentes, seja porque um Ãºnico processo
    // foi vendido a mais de um cliente na aba Vendas). Com um cliente sÃ³,
    // gera 1 arquivo, igual ao comportamento de sempre.
    const porCliente = {};
    linhas.forEach(l=>{ (porCliente[l.cliente] = porCliente[l.cliente]||[]).push(l); });
    const clientesOrdenados = Object.keys(porCliente).sort((a,b)=>a.localeCompare(b,'pt-BR'));

    const { CORES, estilizarTitulo, estilizarSubtitulo, estilizarHeaderCell,
            estilizarGrupoHeader, estilizarCelulaDado } = window.ExcelStyles;

    const colunas = ['Invoice','Medida','Qte','Data do Pedido','Data de Prontidão na Fábrica','Data de Embarque','Data Chegada','POD'];
    if(incluirFrete) colunas.push('Valor do Frete');
    const numCols = colunas.length;
    const largurasMinimas = {Invoice:14,Medida:26,Qte:8,'Data do Pedido':16,'Data de Prontidão na Fábrica':22,'Data de Embarque':16,'Data Chegada':16,POD:10,'Valor do Frete':16};
    const dataArq = new Date().toISOString().split('T')[0];

    // Monta e baixa 1 arquivo .xlsx pra um cliente especÃ­fico (reaproveitado
    // tanto no caso de 1 cliente sÃ³ quanto no loop multi-cliente abaixo).
    async function gerarArquivoCliente(nomeCliente, linhasCliente){
      const porForn = {};
      linhasCliente.forEach(l=>{ (porForn[l.fornecedor] = porForn[l.fornecedor]||[]).push(l); });

      // Grupos de fornecedor em ordem de chegada mais prÃ³xima primeiro (nÃ£o
      // mais alfabÃ©tica) â pega a menor Data de Chegada de cada grupo pra
      // decidir a ordem, mantendo o pedido de "ordenado pela data de chegada"
      // mesmo com a planilha agrupada por fornecedor.
      const fornOrdenados = Object.keys(porForn).sort((fa,fb)=>{
        const da = Math.min(...porForn[fa].map(l=>l._chegadaTs));
        const db = Math.min(...porForn[fb].map(l=>l._chegadaTs));
        return da - db;
      });

      // Paleta/bordas/estilizaÃ§Ã£o compartilhadas com calculador.html e
      // tyredesk.html â ver excel-styles.js (window.ExcelStyles).
      const wb = new ExcelJS.Workbook();
      wb.creator = 'IMPAK';
      wb.created = new Date();
      const nomeClienteExibir = nomeCliente === '(sem cliente)' ? '' : nomeCliente;
      const nomeAbaBruto = (nomeClienteExibir || clienteFiltro || 'Follow-up').replace(/[\\\/\?\*\[\]:]/g,'').substring(0,31);
      const ws = wb.addWorksheet(nomeAbaBruto || 'Follow-up');
      ws.views = [{state:'frozen', ySplit:4}];

      // Linha 1 â tÃ­tulo (nome do cliente)
      ws.mergeCells(1,1,1,numCols);
      const titulo = ws.getCell(1,1);
      titulo.value = `IMPAK — Follow-up de Importação${nomeClienteExibir?' · '+nomeClienteExibir:(clienteFiltro?' · '+clienteFiltro:'')}`;
      estilizarTitulo(titulo);
      ws.getRow(1).height = 30;

      // Linha 2 â subtÃ­tulo (data de geraÃ§Ã£o)
      ws.mergeCells(2,1,2,numCols);
      const agora = new Date();
      const sub = ws.getCell(2,1);
      sub.value = `Gerado em ${agora.toLocaleDateString('pt-BR')} às ${agora.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`;
      estilizarSubtitulo(sub);
      ws.getRow(2).height = 20;

      ws.mergeCells(3,1,3,numCols);
const disclaimerCell = ws.getCell(3,1);
disclaimerCell.value = 'As datas de chegada informadas sao previsoes (ETA) e podem sofrer alteracoes ou atrasos.';
disclaimerCell.font = {italic:true, size:9, color:{argb:'FF92400E'}};
disclaimerCell.alignment = {vertical:'middle', horizontal:'left'};
ws.getRow(3).height = 16;

      // Linha 4 â cabeÃ§alho das colunas
      const headerRow = ws.getRow(4);
      colunas.forEach((c,i)=>{
        const cell = headerRow.getCell(i+1);
        cell.value = c;
        estilizarHeaderCell(cell, {size:11});
      });
      headerRow.height = 32;
      ws.autoFilter = {from:{row:4,column:1}, to:{row:4,column:numCols}};

      // Linhas de dados, agrupadas por fornecedor (cada grupo com uma linha
      // de cabeÃ§alho destacada, igual ao modelo original) â grupos e linhas
      // dentro de cada grupo em ordem de Data de Chegada.
      let rowIdx = 5;
      fornOrdenados.forEach(forn=>{
        ws.mergeCells(rowIdx,1,rowIdx,numCols);
        const gcell = ws.getCell(rowIdx,1);
        gcell.value = `🏭  ${forn}`;
        estilizarGrupoHeader(gcell);
        gcell.alignment = {vertical:'middle', horizontal:'left', indent:1};
        gcell.border = {bottom:{style:'thin',color:{argb:CORES.BORDA}}};
        ws.getRow(rowIdx).height = 22;
        rowIdx++;

        porForn[forn].forEach((l,idx)=>{
          const row = ws.getRow(rowIdx);
          colunas.forEach((c,i)=>{
            const cell = row.getCell(i+1);
            cell.value = l[c];
            estilizarCelulaDado(cell, {idx, alinhamento: c==='Qte' ? 'center':'left', size:10.5});
          });
          rowIdx++;
        });
      });

      // Linha final â resumo
      ws.mergeCells(rowIdx,1,rowIdx,numCols);
      const totalCell = ws.getCell(rowIdx,1);
      totalCell.value = `Total: ${linhasCliente.length} item(ns) em ${Object.keys(porForn).length} fornecedor(es)`;
      totalCell.font = {name:'Calibri', bold:true, italic:true, size:10, color:{argb:CORES.CINZA}};
      totalCell.alignment = {horizontal:'right'};
      ws.getRow(rowIdx).height = 20;

      // Larguras de coluna
      colunas.forEach((c,i)=>{ ws.getColumn(i+1).width = largurasMinimas[c]||14; });

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const url = URL.createObjectURL(blob);
      const sufixoCliente = '_'+(nomeClienteExibir || clienteFiltro || 'FollowUp').replace(/[^a-zA-Z0-9]+/g,'');
      const a = document.createElement('a');
      a.href = url;
      a.download = `IMPAK_FollowUp${sufixoCliente}_${dataArq}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return Object.keys(porForn).length;
    }

    if(clientesOrdenados.length <= 1){
      const nomeUnico = clientesOrdenados[0] || (clienteFiltro || 'Follow-up');
      const nForn = await gerarArquivoCliente(nomeUnico, linhas);
      showToast(`✓ ${linhas.length} item(ns) exportado(s), agrupados em ${nForn} fornecedor(es), ordenado por chegada${incluirFrete?' — com Valor do Frete':''}`,'ok');
    }else{
      // MÃºltiplos clientes: 1 arquivo por cliente (pedido confirmado com o
      // usuÃ¡rio: "Um arquivo por cliente"). O navegador bloqueia downloads
      // mÃºltiplos disparados sem pausa em alguns casos â um pequeno delay
      // entre cada `a.click()` evita isso.
      for(let i=0;i<clientesOrdenados.length;i++){
        const nome = clientesOrdenados[i];
        await gerarArquivoCliente(nome, porCliente[nome]);
        if(i < clientesOrdenados.length-1) await new Promise(r=>setTimeout(r,400));
      }
      showToast(`✓ ${linhas.length} item(ns) exportado(s) em ${clientesOrdenados.length} arquivo(s) (1 por cliente)`,'ok');
    }
  }catch(e){
    showToast('Erro ao exportar: '+e.message,'err');
    console.error(e);
  }
}
