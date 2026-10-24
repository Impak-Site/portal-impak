// controle-import-ia.js
//
// Importação de planilha de fornecedor e extração de PI via IA (extrairComIA) — os dois fluxos de import de dados externos, e edição inline da lista (inlineEditData/inlineEditFase).
//
// Parte do controle_v2.html, extraído do <script> único original pra
// facilitar manutenção. Carregado via <script src> junto com os outros
// módulos (ver controle_v2.html) — não é um ES module, então todo
// estado (let/const de topo) e funções aqui continuam visíveis pros
// outros arquivos, exatamente como estavam quando tudo era um só
// <script>. controle-core.js precisa carregar ANTES dos demais (é
// quem declara o estado global: _processos, _user, FASES etc.).
//
async function importarPlanilha(input){
  const file = input.files[0];
  if(!file) return;
  input.value = '';

  // Criar modal de diagnóstico visível na tela
  let logDiv = document.getElementById('import-log-modal');
  if(!logDiv){
    logDiv = document.createElement('div');
    logDiv.id = 'import-log-modal';
    logDiv.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:9999;background:#0a2d5e;color:#fff;border-radius:12px;padding:16px 20px;min-width:320px;max-width:420px;font-size:12px;font-family:"JetBrains Mono",monospace;max-height:300px;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.4);';
    document.body.appendChild(logDiv);
  }
  logDiv.innerHTML = `<div style="font-weight:700;margin-bottom:8px;font-size:13px;">📊 Importando: ${file.name}</div>`;
  const addLog = (msg, cor) => {
    const d = document.createElement('div');
    d.style.cssText = `color:${cor||'#fff'};padding:2px 0;`;
    d.textContent = msg;
    logDiv.appendChild(d);
    logDiv.scrollTop = logDiv.scrollHeight;
  };
  const fecharLog = (delay) => setTimeout(()=>{ if(logDiv) logDiv.remove(); }, delay||5000);

  showToast('Lendo planilha...','info');
  addLog('Lendo arquivo...', '#7dd3fc');

  try{
    if(!window.XLSX){ await new Promise((ok,falha)=>{ const sc=document.createElement('script'); sc.src='/vendor/xlsx-0.18.5.full.min.js'; sc.onload=ok; sc.onerror=falha; document.head.appendChild(sc); }); } // servido localmente (relatório de segurança, item 13)
    const XLSX = window.XLSX;
    const buf = await file.arrayBuffer();
    // raw:true para não converter datas automaticamente (evita conflito com cellDates)
    const wb = XLSX.read(buf, {type:'array', cellDates:true, raw:false});

    const processos = [];
    const refs = new Set(_processos.map(p=>p.referencia));

    function parseDate(v){
      if(!v) return null;
      if(v instanceof Date){
        if(isNaN(v.getTime())||v.getFullYear()<1950) return null;
        return v.toISOString().split('T')[0];
      }
      // Serial numérico do Excel (ex: 45667)
      if(typeof v === 'number' && v > 25000 && v < 60000){
        const d = new Date(Math.round((v - 25569) * 86400 * 1000));
        if(!isNaN(d.getTime())&&d.getFullYear()>=1950) return d.toISOString().split('T')[0];
      }
      const s = String(v).trim().split(/[\n\r]/)[0].trim();
      if(!s||s==='—'||s==='-') return null;
      const su = s.toUpperCase();
      if(su.includes('PRODUÇÃO')||su.includes('PRODUCAO')||su.includes('ANDAMENTO')||su.includes('PRODUC')) return null;

      // YYYY-MM-DD
      let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if(m){ const [,y,mo,d]=m; if(parseInt(y)>=1950) return `${y}-${mo}-${d}`; }

      // DD/MM/YYYY (formato brasileiro)
      m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if(m){
        const [,a,b,y]=m;
        if(parseInt(y)>=1950){
          // Verificar se é DD/MM ou MM/DD pela validade do mês
          if(parseInt(b)<=12) return `${y}-${b.padStart(2,'0')}-${a.padStart(2,'0')}`;
          if(parseInt(a)<=12) return `${y}-${a.padStart(2,'0')}-${b.padStart(2,'0')}`;
        }
      }

      // M/D/YYYY ou M/D/YY (formato americano do Excel/XLSX.js)
      m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if(m){
        let [,mo,d,y]=m;
        const year = y.length===2 ? (parseInt(y)>=50?'19'+y:'20'+y) : y;
        if(parseInt(year)>=1950 && parseInt(mo)>=1 && parseInt(mo)<=12 && parseInt(d)>=1 && parseInt(d)<=31){
          return `${year}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
        }
        // Tentar como DD/MM/YY se mês > 12
        if(parseInt(mo)>12 && parseInt(d)<=12){
          return `${year}-${d.padStart(2,'0')}-${mo.padStart(2,'0')}`;
        }
      }

      // Serial numérico como string (ex: "45667")
      const num = parseInt(s);
      if(!isNaN(num) && num > 25000 && num < 60000){
        const d2 = new Date(Math.round((num - 25569) * 86400 * 1000));
        if(!isNaN(d2.getTime())&&d2.getFullYear()>=1950) return d2.toISOString().split('T')[0];
      }

      return null;
    }
    function pStr(v){
      if(v===null||v===undefined) return null;
      const s = String(v).trim().replace(/\s+/g,' ');
      return s&&s!=='—'&&s!=='-'&&s!=='null'&&s.length>0 ? s : null;
    }
    // Finalidade: aceita "direto"/"própria", "encomenda", "conta e ordem" (livre, case-insensitive)
    function parseFinalidade(v){
      const s = pStr(v);
      if(!s) return null;
      const su = s.toUpperCase();
      if(su.includes('CONTA') && su.includes('ORDEM')) return 'CONTA_E_ORDEM';
      if(su.includes('ENCOMENDA')) return 'ENCOMENDA';
      if(su.includes('DIRET') || su.includes('PRÓPRIA') || su.includes('PROPRIA')) return 'IMPORTACAO_DIRETA';
      return null;
    }

    // Detectar tipo — mais tolerante
    const sheetNames = wb.SheetNames.map(s=>s.trim().toUpperCase());
    const isControle = sheetNames.includes('CONTROLE');
    const isFollowUp = sheetNames.includes('EM ANDAMENTO') || sheetNames.some(s=>s.includes('ANDAMENTO'));

    addLog(`Abas: ${wb.SheetNames.join(', ')}`, '#7dd3fc'); addLog(`isControle: ${isControle} | isFollowUp: ${isFollowUp}`, '#7dd3fc');

    if(!isControle && !isFollowUp){
      showToast('Planilha não reconhecida. Use a planilha Controle ou Follow Up.','err');
      return;
    }

    if(isControle){
      // Encontrar a aba correta (case-insensitive)
      const abaName = wb.SheetNames.find(s=>s.trim().toUpperCase()==='CONTROLE');
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[abaName], {header:1, defval:null, raw:false});
      addLog(`CONTROLE: ${rows.length} linhas | header: ${(rows[0]||[]).slice(0,3).join(', ')}`, '#7dd3fc');

      // Linha 1 = header, dados a partir de linha 2 (índice 1)
      for(let i=1;i<rows.length;i++){
        const r = rows[i];
        if(!r || !r[1]) continue;
        const ref = pStr(r[1]);
        if(!ref) continue;
        if(refs.has(ref)) continue;
        refs.add(ref);

        const prontidao = parseDate(r[11]);
        const embarque  = parseDate(r[12]);
        const chegada   = parseDate(r[13]);
        const presenca  = parseDate(r[14]);
        const retirada  = parseDate(r[19]);
        const dataRic   = parseDate(r[22]);
        const prevPront = parseDate(r[30]);
        const demurVenc = parseDate(r[18]);

        // Finalidade — coluna A do formato Controle
        const finalidade = parseFinalidade(r[0]);

        let fase='PI';
        if(dataRic)             fase='FINALIZADO';
        else if(retirada)       fase='CARREGAMENTO';  // retirada = carregamento já feito
        else if(presenca||chegada) fase='DESEMBARCADO';
        else if(embarque)       fase='EMBARCADO';
        else if(prevPront||prontidao) fase='AGUARDANDO_EMBARQUE';

        processos.push({
          referencia:        ref,
          finalidade,
          cliente:           pStr(r[2]),
          produto:           pStr(r[3]),
          fornecedor:        pStr(r[9]),
          porto_destino:     normalizarPortoDestino(pStr(r[8])),
          pi_data:           parseDate(r[10]),
          data_prontidao:    prontidao,
          previsao_prontidao:prevPront,
          data_embarque:     embarque,
          data_chegada:      chegada,
          data_presenca:     presenca,
          armador:           pStr(r[24]),
          agente:            pStr(r[31]),
          hbl:               pStr(r[32]),
          mbl:               pStr(r[33]),
          ce_master:         pStr(r[34]),
          ce_house:          pStr(r[35]),
          container:         pStr(r[36]),
          navio:             pStr(r[37]),
          numero_di:         pStr(r[38]),
          demurrage_vencimento: demurVenc,
          obs:               pStr(r[5]),
          pendencia_revisao: pStr(r[43]),
          fase,
          created_by:        'importacao_controle',
        });
      }
      addLog(`✓ CONTROLE: ${processos.length} processos mapeados`, '#86efac');
    }

    if(isFollowUp){
      for(const sheetName of wb.SheetNames.filter(s=>['EM ANDAMENTO','FINALIZADOS'].includes(s.trim().toUpperCase()))){
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {header:1, defval:null, raw:false});
        addLog(`${sheetName}: ${rows.length} linhas`, '#7dd3fc');

        for(let i=1;i<rows.length;i++){
          const r = rows[i];
          if(!r||!r[0]) continue;
          const ref = pStr(r[0]);
          if(!ref) continue;
          if(refs.has(ref)) continue;
          refs.add(ref);

          const hblMbl = pStr(r[3]);
          const finalidade = parseFinalidade(r[1]);
          const partes = hblMbl ? hblMbl.split(/[\n\r]/).map(s=>s.trim()).filter(Boolean) : [];
          const hbl = partes[0]||null;
          const mbl = partes[1]||null;

          // A célula de chegada tem 2 formatos possíveis (planilha Follow Up):
          //  - Já chegou:  "06/07/26\nNVT\n07/07"       → linha 1 = chegada efetiva, linha 3 = presença
          //  - Ainda não:  "ETA 13/07/26 - 13h\nIOA"     → é só previsão, NÃO é chegada efetiva
          // Antes o código jogava a linha 1 direto em "chegada" nos dois casos —
          // por isso uma previsão virava "já chegou" e pulava a fase pra Desembarcado.
          const chegadaStr = pStr(r[4]);
          const chegadaPartes = chegadaStr ? chegadaStr.split(/[\n\r]/).map(s=>s.trim()).filter(Boolean) : [];
          let chegada = null, etaFollowUp = null;
          if(chegadaPartes[0]){
            if(chegadaPartes[0].toUpperCase().startsWith('ETA')){
              const m = chegadaPartes[0].match(/(\d{2}\/\d{2}\/\d{2,4})/);
              etaFollowUp = m ? parseDate(m[1]) : null;
            } else {
              chegada = parseDate(chegadaPartes[0]);
            }
          }

          const armAg = pStr(r[13]);
          const armadorPartes = armAg ? armAg.split(/[\n\r]/).map(s=>s.trim()).filter(Boolean) : [];
          const armador = armadorPartes[0]||null;
          const agente = armadorPartes[1]||null;

          const ceMasterHouse = pStr(r[7]);
          const cePartes = ceMasterHouse ? ceMasterHouse.split(/[\n\r]/).map(s=>s.trim()).filter(Boolean) : [];
          const ce_master = cePartes[0]||null;
          const ce_house = cePartes[1]||null;

          const di = pStr(r[8]);
          const status = pStr(r[14])||'';

          let fase = 'EMBARCADO';
          if(status.toLowerCase().includes('finaliz')) fase='FINALIZADO';
          else if(di) fase='REGISTRO_DI';
          else if(chegada) fase='DESEMBARCADO';

          processos.push({
            referencia:       ref,
            finalidade,
            fornecedor:       pStr(r[2]),
            hbl, mbl,
            ce_master, ce_house,
            data_chegada:     chegada,
            eta:              etaFollowUp,
            navio:            pStr(r[5]),
            numero_di:        di,
            data_registro_di: parseDate(r[9]),
            container:        pStr(r[11]),
            armador, agente, fase,
            obs:              status.slice(0,200)||null,
            created_by:       'importacao_followup',
          });
        }
      }
      addLog(`✓ FOLLOWUP: ${processos.length} processos mapeados`, '#86efac');
    }

    if(!processos.length){
      addLog('⚠ Nenhum processo novo (todos já existem ou planilha vazia)', '#fcd34d');
      fecharLog(8000);
      showToast('Nenhum processo novo encontrado','warn');
      return;
    }

    addLog(`Enviando ${processos.length} processos ao servidor...`, '#7dd3fc');
    showToast(`Importando ${processos.length} processos...`,'info');

    let total = 0, erros = 0, datasRecusadas = 0, jaExistiam = 0;
    for(let i=0;i<processos.length;i+=50){
      const lote = processos.slice(i,i+50);
      try{
        const resp = await fetch('/api/controle/v2/importar',{
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({processos:lote})
        });
        const d = await resp.json();
        if(d.ok){
          // 19/10/2026: "total: 0" (todos já existiam) contava como o lote inteiro salvo.
          const salvos = typeof d.total === 'number' ? d.total : lote.length;
          total += salvos; addLog(`✓ Lote ${Math.floor(i/50)+1}: ${salvos} salvos`, '#86efac');
          if(d.ignorados){ jaExistiam += d.ignorados; addLog(`• ${d.ignorados} já estavam no Controle (não foram criados de novo)`, '#93c5fd'); }
          (d.equivalentes||[]).forEach(x => addLog(`↔ ${x.referencia} já existe como ${x.existente}`, '#93c5fd'));
          // Data impossível na planilha: o processo foi criado sem ela (ver logDatasImportacao).
          (d.datas_recusadas||[]).forEach(x => { datasRecusadas++; addLog(`✕ ${x.referencia}: ${rotuloCampoImportacao(x.campo)} ${dataImportBR(x.valor)} não importada — ${x.motivo}`, '#fca5a5'); });
        }
        else { erros++; addLog(`✕ Lote erro: ${d.erro||'?'}`, '#fca5a5'); }
      }catch(e){ erros++; addLog(`✕ Fetch erro: ${e.message}`, '#fca5a5'); }
    }

    if(total > 0){
      addLog(`✅ ${total} processos importados!`, '#86efac');
      if(datasRecusadas) addLog(`⚠ ${datasRecusadas} data(s) impossível(is) ficaram em branco — confira nos processos acima.`, '#fcd34d');
      fecharLog(datasRecusadas ? 30000 : 6000);
      showToast(`✓ ${total} processos importados${erros>0?' ('+erros+' com erro)':''}${datasRecusadas?` — ${datasRecusadas} data(s) não importada(s), veja o log`:''}`, (erros>0||datasRecusadas)?'warn':'ok');
      await carregarProcessos(true);
    } else if(!erros && jaExistiam){
      addLog('• Nenhum processo novo — todos já estavam no Controle', '#93c5fd');
      fecharLog(10000);
      showToast('Nenhum processo novo — todos já estavam no Controle','warn');
    } else {
      addLog('✕ Zero processos importados — verifique os erros acima', '#fca5a5');
      fecharLog(10000);
      showToast('Erro ao importar. Veja o log na tela.','err');
    }
  }catch(e){
    if(typeof addLog === 'function') addLog(`✕ ERRO: ${e.message}`, '#fca5a5');
    showToast('Erro: '+e.message,'err');
    if(typeof fecharLog === 'function') fecharLog(10000);
  }
}

// ════════════════════════════════════════════════════════════════
// IMPORTAR PLANILHA DO DESPACHANTE ("Separa Data.xlsx", aba EM ANDAMENTO)
// ════════════════════════════════════════════════════════════════
// Planilha recorrente que o despachante manda com o status dos processos em
// andamento. Ao contrario de importarPlanilha() acima (que so CRIA processos
// novos), aqui o fluxo e o inverso: casa cada linha com um processo JA
// EXISTENTE (por referencia) e atualiza HBL/MBL/data de chegada/porto/navio/
// qtd de containers + acrescenta a "DEMANDA IMPAK" em Observacoes -- pedido da
// Emanuelly, 26/08/2026. O parse acontece no servidor (planilha-import.js:
// importarDespachanteBase), entao aqui so manda o arquivo em base64 e mostra
// o resumo devolvido (mesmo modal de diagnostico do importarPlanilha).
async function importarPlanilhaDespachante(input){
  const file = input.files[0];
  if(!file) return;
  input.value = '';

  let logDiv = document.getElementById('import-log-modal');
  if(!logDiv){
    logDiv = document.createElement('div');
    logDiv.id = 'import-log-modal';
    logDiv.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:9999;background:#0a2d5e;color:#fff;border-radius:12px;padding:16px 20px;min-width:320px;max-width:420px;font-size:12px;font-family:"JetBrains Mono",monospace;max-height:300px;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.4);';
    document.body.appendChild(logDiv);
  }
  logDiv.innerHTML = `<div style="font-weight:700;margin-bottom:8px;font-size:13px;">📦 Importando planilha do despachante: ${file.name}</div>`;
  const addLog = (msg, cor) => {
    const d = document.createElement('div');
    d.style.cssText = `color:${cor||'#fff'};padding:2px 0;`;
    d.textContent = msg;
    logDiv.appendChild(d);
    logDiv.scrollTop = logDiv.scrollHeight;
  };
  const fecharLog = (delay) => setTimeout(()=>{ if(logDiv) logDiv.remove(); }, delay||8000);

  showToast('Lendo planilha do despachante...','info');
  addLog('Enviando arquivo pro servidor...', '#7dd3fc');

  try{
    const buf = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i=0; i<bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);

    const resp = await fetch('/api/controle/v2/importar-despachante', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ arquivo_base64: base64 })
    });
    const data = await resp.json();
    if(!resp.ok || data.erro){
      addLog(`✕ ERRO: ${data.erro||'falha desconhecida'}`, '#fca5a5');
      showToast('Erro: '+(data.erro||'falha desconhecida'),'err');
      fecharLog(10000);
      return;
    }

    addLog(`${data.total_linhas} linha(s) na planilha`, '#7dd3fc');
    addLog(`✓ ${data.total_atualizados} processo(s) atualizado(s)`, '#86efac');
    if(data.total_sem_mudancas) addLog(`• ${data.total_sem_mudancas} sem mudanca (ja estavam com esses dados)`, '#93c5fd');
    logReferenciasImportacao(data, addLog);
    (data.resumo||[]).filter(r=>r.status==='atualizado').forEach(r => addLog(`✓ ${r.referencia}: ${(r.campos||[]).map(rotuloCampoImportacao).join(', ')}`, '#86efac'));
    const datasImp = logDatasImportacao(data.resumo, addLog);
    // DATA CI → Data de Liberação (21/10/2026): quantos desembaraços entraram.
    const nLiberacao = (data.resumo||[]).filter(r => r.status==='atualizado' && (r.campos||[]).includes('data_liberacao')).length;
    if(nLiberacao) addLog(`🛃 ${nLiberacao} processo(s) com a Data de Liberação preenchida pela DATA CI`, '#86efac');

    const pendencias = (data.total_nao_encontrados||0) + datasImp.recusadas;
    showToast(pendencias ? `Importacao concluida com ${pendencias} pendencia(s) - veja o log` : `Tudo certo: ${data.total_atualizados} processo(s) confirmado(s), sem erros`, pendencias ? 'warn' : 'ok');
    fecharLog(datasImp.recusadas || datasImp.comAviso ? 30000 : 15000);
    if(typeof carregarProcessos === 'function') await carregarProcessos();
    if(typeof render === 'function') render();
  }catch(e){
    addLog(`✕ ERRO: ${e.message}`, '#fca5a5');
    showToast('Erro: '+e.message,'err');
    fecharLog(10000);
  }
}

// ── Referências nas importações de planilha (19/10/2026) ──
// O servidor acha o processo pela referência igual ou com/sem o prefixo
// "IMPAK-" (referencia-processo.js). Aqui o log mostra quais foram achadas
// assim, e, nas não encontradas, as parecidas que existem no Controle (ou os
// processos em dúvida) — para saber o que corrigir na planilha.
function textoRefNaoEncontrada(r){
  let t = String(r.referencia || '');
  if(r.ambiguo && r.ambiguo.length) t += ` (mais de um processo: ${r.ambiguo.join(', ')})`;
  else if(r.sugestoes && r.sugestoes.length) t += ` (no Controle tem: ${r.sugestoes.join(', ')})`;
  return t;
}
function logReferenciasImportacao(data, addLog){
  const resumo = data.resumo || [];
  if(data.total_travados) addLog(`🔒 ${data.total_travados} processo(s) fechado(s)/cancelado(s) ignorado(s): ${resumo.filter(r=>r.status==='travado').map(r=>r.referencia).join(', ')}`, '#fcd34d');
  const semPrefixo = resumo.filter(r => r.referencia_planilha);
  if(semPrefixo.length) addLog(`↔ ${semPrefixo.length} referência(s) achada(s) com/sem o prefixo IMPAK-: ${semPrefixo.map(r => `${r.referencia_planilha} → ${r.referencia}`).join(', ')}`, '#93c5fd');
  if(data.total_nao_encontrados){
    addLog(`⚠ ${data.total_nao_encontrados} referencia(s) nao encontrada(s) no Controle:`, '#fcd34d');
    resumo.filter(r=>r.status==='nao_encontrado').forEach(r => addLog(`   ${textoRefNaoEncontrada(r)}`, '#fcd34d'));
  } else {
    addLog(`✅ Tudo certo! Todas as referencias da planilha foram encontradas e conferidas.`, '#4ade80');
  }
}

// ── Datas nas importações de planilha (18/10/2026) ──
// O servidor confere as datas da planilha com as mesmas regras do painel
// (validacao-datas.js): a data impossível não é gravada e volta em
// resumo[].datas_recusadas; a só improvável é gravada e volta em
// resumo[].avisos_datas. Aqui elas entram no log da importação.
const NOMES_CAMPO_IMPORTACAO = { data_chegada:'Data de Chegada', eta:'ETA', etd:'ETD', data_prontidao:'Prontidão na Fábrica',
  data_embarque:'Data de Embarque', data_registro_di:'Registro da DI', data_liberacao:'Data de Liberação (DATA CI)', nf_entrada_data:'NF de Entrada', pi_data_saldo:'Vencimento do Saldo',
  hbl:'HBL', mbl:'MBL', navio:'Navio', porto_destino:'Porto de Destino', qtd_containers_prevista:'Qtd. Containers', obs:'Observações',
  agente:'Agente de Carga', booking_numero:'Booking', previsao_prontidao:'Previsão de Prontidão', semana_booking:'Semana do Booking' };
function rotuloCampoImportacao(campo){
  return NOMES_CAMPO_IMPORTACAO[campo] || (typeof ValidacaoDatas !== 'undefined' && ValidacaoDatas.ROTULOS && ValidacaoDatas.ROTULOS[campo]) || campo;
}
function dataImportBR(v){
  const s = String(v == null ? '' : v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(8,10) + '/' + s.slice(5,7) + '/' + s.slice(0,4) : s;
}
function logDatasImportacao(resumo, addLog){
  let recusadas = 0, comAviso = 0;
  (resumo||[]).forEach(r => {
    (r.datas_recusadas||[]).forEach(d => { recusadas++; addLog(`✕ ${r.referencia}: ${rotuloCampoImportacao(d.campo)} ${dataImportBR(d.valor)} não importada — ${d.motivo}`, '#fca5a5'); });
    (r.avisos_datas||[]).forEach(a => { comAviso++; addLog(`⚠ ${r.referencia}: ${a}`, '#fcd34d'); });
  });
  if(recusadas) addLog(`⚠ ${recusadas} data(s) impossível(is) não foram importadas — o processo ficou com a data anterior. Confira na planilha.`, '#fcd34d');
  return { recusadas, comAviso };
}

// ════════════════════════════════════════════════════════════════
// IMPORTAR PLANILHA INTERNA (Manu/Emanuelly) — prontidao + booking/ETD
// ════════════════════════════════════════════════════════════════
async function importarPlanilhaManu(input){
  const file = input.files[0];
  if(!file) return;
  input.value = '';

  let logDiv = document.getElementById('import-log-modal');
  if(!logDiv){
    logDiv = document.createElement('div');
    logDiv.id = 'import-log-modal';
    logDiv.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:9999;background:#0a2d5e;color:#fff;border-radius:12px;padding:16px 20px;min-width:320px;max-width:420px;font-size:12px;font-family:"JetBrains Mono",monospace;max-height:300px;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.4);';
    document.body.appendChild(logDiv);
  }
  logDiv.innerHTML = `<div style="font-weight:700;margin-bottom:8px;font-size:13px;">📋 Importando planilha interna: ${file.name}</div>`;
  const addLog = (msg, cor) => {
    const d = document.createElement('div');
    d.style.cssText = `color:${cor||'#fff'};padding:2px 0;`;
    d.textContent = msg;
    logDiv.appendChild(d);
    logDiv.scrollTop = logDiv.scrollHeight;
  };
  const fecharLog = (delay) => setTimeout(()=>{ if(logDiv) logDiv.remove(); }, delay||8000);

  showToast('Lendo planilha interna...','info');
  addLog('Enviando arquivo pro servidor...', '#7dd3fc');

  try{
    const buf = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i=0; i<bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);

    const resp = await fetch('/api/controle/v2/importar-manu', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ arquivo_base64: base64 })
    });
    const data = await resp.json();
    if(!resp.ok || data.erro){
      addLog(`✕ ERRO: ${data.erro||'falha desconhecida'}`, '#fca5a5');
      showToast('Erro: '+(data.erro||'falha desconhecida'),'err');
      fecharLog(10000);
      return;
    }

    addLog(`${data.total_linhas} linha(s) na planilha`, '#7dd3fc');
    addLog(`✓ ${data.total_atualizados} processo(s) atualizado(s)`, '#86efac');
    if(data.total_sem_mudancas) addLog(`• ${data.total_sem_mudancas} sem mudanca (ja estavam com esses dados)`, '#93c5fd');
    logReferenciasImportacao(data, addLog);
    (data.resumo||[]).filter(r=>r.status==='atualizado').forEach(r => addLog(`✓ ${r.referencia}: ${(r.campos||[]).map(rotuloCampoImportacao).join(', ')}`, '#86efac'));
    const datasImp = logDatasImportacao(data.resumo, addLog);

    const pendencias = (data.total_nao_encontrados||0) + datasImp.recusadas;
    showToast(pendencias ? `Importacao concluida com ${pendencias} pendencia(s) - veja o log` : `Tudo certo: ${data.total_atualizados} processo(s) confirmado(s), sem erros`, pendencias ? 'warn' : 'ok');
    fecharLog(datasImp.recusadas || datasImp.comAviso ? 30000 : 15000);
    if(typeof carregarProcessos === 'function') await carregarProcessos();
    if(typeof render === 'function') render();
  }catch(e){
    addLog(`✕ ERRO: ${e.message}`, '#fca5a5');
    showToast('Erro: '+e.message,'err');
    fecharLog(10000);
  }
}


// ════════════════════════════════════════════════════════════════
// IMPORTAR PLANILHA DE FECHAMENTO (aba Custos Reais, por processo)
// ════════════════════════════════════════════════════════════════
// Reaproveita POST /api/controle/importar-fechamento (server-side,
// planilha-import.js/parseFechamento) — mesmo parser já usado e testado
// pro Calculador, só que lendo a aba "Fechamento" do template BASE SP/SC em
// vez de DADOS/MIX. Botão fica dentro do processo (aba Custos Reais) — só
// existia via upload solto antes, sem nenhum gatilho na tela (ver histórico
// de tasks #188/#189: endpoint foi construído mas nunca ligado a um botão).
//
// Preenche só os campos "Pago" (f_cr_<item>) — nunca o "Cobrado" — porque a
// planilha de Fechamento só registra o que foi de fato desembolsado, não o
// preço cobrado do cliente. As datas (Embarque/Chegada/Registro DI) seguem
// a mesma regra "só preenche vazio" da extração por IA — não sobrescreve o
// que já estiver preenchido manualmente.
async function importarFechamentoProcesso(input){
  const file = input.files[0];
  if(!file) return;
  input.value = '';

  showToast('Lendo planilha de Fechamento...','info');

  try{
    const base64 = await new Promise((res,rej)=>{
      const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });

    const resp = await fetch('/api/controle/importar-fechamento', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({arquivo_base64: base64})
    });
    const d = await resp.json();
    if(!d.ok) throw new Error(d.erro || 'Erro ao ler a planilha');

    let preenchidos = 0;

    // Datas — Embarque/Chegada/Registro DI (aba Documentos/Logística)
    Object.entries(d.datas||{}).forEach(([campo, valor])=>{
      const el = document.getElementById('f_'+campo);
      if(el && !el.value){ el.value = valor; preenchidos++; }
    });

    // Custos reais — cada chave do real_json vira o campo "Pago" do item
    // correspondente na aba Custos Reais (f_cr_<id>). Só preenche campo
    // vazio, pra não sobrescrever o que o usuário já tiver lançado à mão.
    // Aba redesenhada (30/09/2026): crAplicarImportado garante que a linha
    // exista na tela (itens sem valor ficam escondidos), aplica a máscara
    // 1.234,56, não sobrescreve o que alguém já conferiu à mão e marca a
    // linha como conferida "pela planilha".
    // Adiantamento Porto / Agente Frete chegam item a item (pela aba MODELO)
    // ou como valor único; crResolverPacotesImportados garante que pacote e
    // itens do mesmo grupo nunca fiquem juntos na grade (20/10/2026).
    const realJson = Object.assign({}, d.real_json || {});
    const resumo = d.resumo || {};
    const extra = (typeof crResolverPacotesImportados === 'function') ? crResolverPacotesImportados(realJson, resumo.pacotes) : { avisos: [], infos: [] };
    if(typeof crAplicarImportado === 'function'){
      preenchidos += crAplicarImportado(realJson, d.moedas||{});
    } else {
      Object.entries(realJson).forEach(([itemId, valor])=>{
        const el = document.getElementById('f_cr_'+itemId);
        if(el && !el.value){
          el.value = valor;
          const selMoeda = document.getElementById('f_cr_moeda_'+itemId);
          if(selMoeda && d.moedas && d.moedas[itemId]) selMoeda.value = d.moedas[itemId];
          preenchidos++;
        }
      });
      if(typeof atualizarTotalCustosReais === 'function') atualizarTotalCustosReais();
    }

    // Notas de saída da planilha → venda (aba Vendas) ou NF de Saída do
    // processo: completa o valor/número/data que estiverem vazios (UD26-047:
    // a venda existia sem valor e o Fechamento ficava sem receita).
    const notas = (typeof aplicarNotasDaPlanilha === 'function') ? aplicarNotasDaPlanilha(resumo.notas || []) : { preenchidos: [], avisos: [] };
    preenchidos += notas.preenchidos.length;

    showToast(`✓ Planilha lida: ${preenchidos} campo${preenchidos===1?'':'s'} preenchido${preenchidos===1?'':'s'}. Revise e clique em Salvar.`, 'ok');
    extra.infos.forEach(t => showToast('ℹ️ ' + t, 'info', 12000));
    if(notas.preenchidos.length) showToast('🧾 ' + notas.preenchidos.join(' · '), 'ok', 12000);
    [].concat(Array.isArray(d.avisos) ? d.avisos : [], extra.avisos, notas.avisos).forEach(av => showToast('⚠ '+av, 'warn'));
  }catch(e){
    showToast('Erro ao importar planilha: '+e.message, 'err');
  }
}

// ════════════════════════════════════════════════════════════════
// EXTRAÇÃO COM IA
// ════════════════════════════════════════════════════════════════
async function extrairComIA_umArquivo(input){
  let _prazoDiasTermos = 0; // "N days after B/L" lido dos termos de pagamento
  const file = input.files[0];
  if(!file) return;
  input.value='';

  const status = document.getElementById('ia-status');
  if(status) status.textContent = '⏳ Analisando documento...';
  // A leitura pode levar minutos. Se nesse meio tempo o painel for fechado ou
  // outro processo for aberto, o resultado NÃO pode cair no processo errado
  // (24/10/2026 — mesma família do UD26-099).
  const _versaoPainelNaLeitura = typeof versaoDoPainel === 'function' ? versaoDoPainel() : null;
  const painelTrocouNaLeitura = () => _versaoPainelNaLeitura !== null && versaoDoPainel() !== _versaoPainelNaLeitura;

  try{
    // Converter para base64
    const base64 = await new Promise((res,rej)=>{
      const r=new FileReader();
      r.onload=()=>res(r.result.split(',')[1]);
      r.onerror=rej;
      r.readAsDataURL(file);
    });

    const isImg = file.type.startsWith('image/');
    // A chave da Anthropic é sempre a configurada no servidor (Railway).

    // Prompt de instruções: texto FIXO, idêntico em toda chamada (só muda o
    // documento anexado). Extraído numa constante própria e colocado ANTES do
    // documento no array `content`, marcado com cache_control — a API Anthropic
    // cacheia o PREFIXO da mensagem, então o bloco que não muda precisa vir
    // primeiro. Isso reduz o custo desse bloco (~12 mil tokens) para ~10% do
    // valor normal em chamadas subsequentes dentro da janela de cache (5 min),
    // sem alterar em nada o resultado da extração.
    const promptInstrucoes = `Extraia os dados deste documento de importação e retorne SOMENTE JSON com os campos disponíveis:
{
  "referencia": "",  // referência INTERNA da IMPAK (comprador) para este pedido/processo — costuma vir em "PO#", "PO No.", "Buyer's Ref", "Your Ref", "Customer Ref", "Order No." ou nas Shipping Marks, muitas vezes começando com "IMPAK-" (ex: "PO#: IMPAK-TKH2609B-1" → "IMPAK-TKH2609B-1"). Copie exatamente como aparece. Se não houver uma referência do comprador, deixe "" (o nº do contrato/PI do fornecedor vai em "pi_numero", não aqui).
  "fornecedor": "",  // razão social ou nome comercial da empresa EXPORTADORA/fabricante que vendeu e emitiu a PI/CI (ex: "Sailun Group") — quem efetivamente fatura e embarca a mercadoria, mesmo que o produto seja de uma marca diferente
  "brand": "",  // marca do PRODUTO/pneu impressa na PI/CI/embalagem (ex: "Maxam", "Triangle", "Linglong") — NÃO é o fornecedor. É comum o fornecedor real (quem fatura) ser diferente da marca do pneu (ex: fornecedor "Sailun Group" fabricando/vendendo pneus marca "Maxam") — extraia os dois separadamente, nunca use a marca como se fosse o fornecedor. Deixe "" se o documento não trouxer uma marca de produto distinta do nome do fornecedor.
  "produto": "",  // usar SOMENTE quando o documento tiver um único item/descrição corrida (ex: CI com texto livre) — extrair de: Description of Goods, Cargo Description, Item Description. Se o documento tiver uma TABELA com múltiplos itens (Size/Pattern/Quantity por linha, comum em PI/Sales Contract), deixar "produto" vazio e usar "itens" abaixo.
  "itens": [],  // ARRAY com um objeto por LINHA DE PRODUTO da tabela do documento (comum em PI/Sales Contract com colunas Size, Pattern, L.I./S.R., P.R., Quantity — mas também vale para uma tabela de item único com colunas tipo Description/Brand/NCM/Qty, comum em Proforma Invoice). Cada objeto: {"size":"","pattern":"","li_sr":"","pr":"","quantidade":0,"preco_unit_usd":0}. "preco_unit_usd" é o preço UNITÁRIO em US$ daquela linha (coluna Unit Price / U. Price / Price / USD/PC) quando a tabela tiver essa coluna — nunca o total da linha (Amount/Total); sem essa coluna, 0. "pr" é a coluna PR / P.R. / Ply Rating (ex: "18PR") QUANDO ela existir como coluna separada na tabela — preencha SEMPRE que a tabela tiver essa coluna, mesmo que pareça redundante com L.I./S.R., senão a informação de lonas se perde. Ex. de uma tabela com 3 linhas (600/65R28, 600/70R30, 710/70R42): retornar 3 objetos, um por linha, cada um com sua própria quantidade — NUNCA somar as quantidades num único item. Se a tabela trouxer a descrição do produto já combinada numa única coluna (ex: "215/75R17.5 16PR 135/133L TL TR685"), sem separação clara entre Size/Pattern/L.I. S.R./PR, preencha "size" com o texto COMPLETO dessa descrição e deixe "pattern"/"li_sr"/"pr" vazios (já está tudo dentro de "size") — NUNCA deixe "size" e "pattern" vazios ao mesmo tempo numa linha que tiver quantidade preenchida, senão o item é descartado. Se o documento não tiver tabela de itens (só descrição corrida, sem coluna de quantidade), deixar "itens" como array vazio [] e usar "produto" acima.
  "pi_numero": "",  // extrair APENAS o número principal; ignorar números secundários entre parênteses (ex: "PI-001 (JY-999)" → usar "PI-001")
  "po_numero": "",  // número do PEDIDO DE COMPRA quando o documento tiver um campo próprio pra isso: "Number PO", "PO No.", "P.O. Number", "Purchase Order No." (ex: "Number PO: BR26R124" → "BR26R124"). Só o valor, sem o rótulo. Deixe "" se o documento não tiver esse campo — NUNCA copie o nº da PI/CI pra cá.
  "pi_data": "YYYY-MM-DD",
  "pi_valor_usd": 0,
  "pi_incoterm": "",
  "pi_termos_pagamento": "",  // copie LITERALMENTE o texto dos termos de pagamento ("Payment Terms", "Terms of Payment"), sem traduzir nem resumir (ex.: "USD 1.000,00 100% At Sight 10 days before ETA"). "" se não houver.
  "pi_pagamento": "VISTA|PRAZO|PARCELADO",  // forma de pagamento pelos TERMOS DE PAGAMENTO da PI/CI: PARCELADO quando há adiantamento + saldo (ex.: "20% T/T in advance, 80% balance against copy of B/L"); VISTA SOMENTE quando 100% é pago ANTES DO EMBARQUE (ex.: "100% T/T in advance", "100% before shipment"); PRAZO quando 100% é pago DEPOIS do embarque — inclui pagamento referido ao ETA/chegada ou ao B/L, mesmo que o texto diga "at sight" (ex.: "100% T/T 90 days after B/L date", "100% At Sight 10 days before ETA", "100% against copy of B/L"). "At sight" sozinho NÃO significa à vista antecipado. Deixe "" se o documento não trouxer os termos.
  "pi_adiantamento_pct": 0,  // % do valor pago ANTES do embarque (deposit / advance / down payment / prepayment) nos termos de pagamento — ex.: "20% T/T in advance" → 20; "30% deposit, balance before shipment" → 30. Só o número. 0 quando não houver adiantamento ou o documento não disser.
  "etd": "YYYY-MM-DD",
  "eta": "YYYY-MM-DD",
  "data_embarque": "YYYY-MM-DD",  // Data EFETIVA de embarque (a carga já está a bordo) — SOMENTE de documento que comprova o embarque: BL/HBL/MBL final ou original ("On Board Date", "Shipped on Board", "Laden on Board"; se esse campo estiver em branco, a "Place and date of issue" do BL original/final), CE Mercante (data de embarque / data de emissão do BL registrada no CE) ou DI/DUIMP (data de embarque informada na declaração). NUNCA de PI, CI, packing list, booking ou rascunho (draft) de BL — nesses a data é só previsão e vai em "etd".
  "armador": "",  // NÃO inferir armador pelo nome do navio (ex: navio MSC XXXX não significa armador MSC — extrair apenas de campos explícitos como Carrier, Shipping Line, Armador) NÃO usar o emissor de um House B/L (agente de carga/NVOCC, ex: nomes com "Logistics", "Forwarding", "Cargo") como armador — o armador real (ocean carrier) deve vir do Master B/L ou Booking Confirmation. Exemplos de armadores reais: MSC, CMA CGM, COSCO, MAERSK, HAPAG-LLOYD, ONE, EVERGREEN, YANG MING, PIL, ZIM, HMM, WAN HAI.
  "navio": "",  // se o documento for um CE Mercante, usar o navio de CHEGADA: em caso de transbordo/baldeação no exterior, o navio de chegada é o navio de conexão/último navio que efetivamente atracou no porto de destino brasileiro — NÃO o navio original de embarque na origem
  "porto_origem": "",
  "porto_destino": "",  // extrair de: POD, Port of Discharge, Port of Destination, Discharge Port. PRIORIDADE DE FONTE: o BL e a DI/Extrato da DI são mais confiáveis que o Sales Contract — o Sales Contract é só a intenção comercial registrada antes do embarque e pode estar desatualizado (ex: prevê "Itajai" mas a carga acabou desembarcando em "Itapoa"). Se o documento atual for um BL ou DI/Extrato da DI, o porto_destino dele deve SOBRESCREVER um valor que tenha vindo de um Sales Contract.
  "hbl": "",  // número do House B/L (emitido pelo agente de carga/NVOCC) — no BL é o "Bill of Lading No."
  "mbl": "",  // número do Master B/L do armador — no rascunho do HBL costuma vir como "MBL#" ou "MBL No."; na nota de débito do agente, como "Master BL(s)". Se o documento só traz o número do House B/L, deixe mbl vazio — NUNCA repita o número do HBL no mbl.
  "containers": [],  // ARRAY com TODOS os containers do documento — um item por container: {"numero":"TCKU7973104","lacre":"2299285"}. IMPORTANTE: BL e CE Mercante frequentemente listam 2 OU MAIS containers na mesma tabela (ex: "3X40HQ CONTAINER FCL/FCL" com 3 linhas de número+lacre). Inclua UM item no array PARA CADA linha de container encontrada — nunca junte vários números numa única string separada por vírgula. Mesmo se houver só 1 container no documento, retorne um array com 1 item.
  "valor_frete": 0,  // valor do frete marítimo — extrair de: BL (campo "Freight", "Ocean Freight", "Freight Charges", geralmente no rodapé/seção de charges do BL — usar o valor "Prepaid" OU "Collect", o que estiver preenchido com valor) ou CE Mercante (campo "Frete"). Se não encontrar um valor de frete explícito no documento, deixar 0.
  "moeda_frete": "",  // moeda em que o valor_frete veio no documento: "USD", "BRL" ou "EUR". Deixar "" se valor_frete for 0.
  "numero_di": "",  // número da Declaração de Importação (DI) — ex: "26/0672265-4". Se o documento for uma DUIMP (não uma DI), usar aqui o próprio número da DUIMP, ex: "26BR0001279136-0" (costuma aparecer no topo do documento, tipo "Extrato da Duimp 26BR0001279136-0" ou "Duimp Nº").
  "duimp_numero": "",  // preencher SOMENTE quando o documento for especificamente uma DUIMP (não uma DI antiga) — repete o mesmo número de "numero_di" acima nesse caso. Útil pra localizar depois qual parcela de pagamento essa DUIMP se refere. Deixar "" se o documento não for uma DUIMP.
  "di_peso_liquido": 0,  // SOMENTE para DI/DUIMP: PESO LÍQUIDO TOTAL da declaração em kg (campo "PESO LIQUIDO" das Informações Complementares ou "Peso Líquido (kg)" dos Dados da Carga), ex: 15780.76. Usado na relação de Reciclagem.
  "di_ncms": "",  // SOMENTE para DI/DUIMP: NCM(s) distintos dos itens/adições, no formato "4011.20.90" (com pontos), separados por vírgula se houver mais de um
  "di_ncms_detalhe": [],  // SOMENTE para DI/DUIMP: UM objeto por item/adição da declaração: {"ncm":"4011.80.90","quantidade":24,"peso_liquido":1091.76} — "quantidade" = "Quantidade na unidade estatística" do item e "peso_liquido" = "Peso líquido (kg)" DAQUELE item. Liste TODOS os itens (não some você mesmo). Deixar [] para outros documentos.
  "data_registro_di": "YYYY-MM-DD",  // "DATA DO REGISTRO" no Comprovante de Importação/Extrato da DI. Se for uma DUIMP, usar a data do evento "Declaração registrada" no histórico/timeline do documento (ex: "27/07/2026, 19:13" → "2026-07-27").
  "di_tributos": {},  // SOMENTE para DI/DUIMP: tributos federais da declaração em R$ (valor A RECOLHER / RECOLHIDO, não o "calculado" nem o "suspenso"), TOTAL da declaração (somando todos os itens/adições): {"ii":0,"ipi":0,"pis":0,"cofins":0,"siscomex":0,"antidumping":0,"afrmm":0}. "siscomex" = Taxa de Utilização do Siscomex; "afrmm" = AFRMM (Marinha Mercante) quando o documento trouxer o valor. Use 0 para o que não aparecer. Deixar {} para outros documentos.
  "canal": "VERDE|AMARELO|VERMELHO",  // "CANAL DE CONFERENCIA ADUANEIRA" no Comprovante de Importação/Extrato da DI
  "di_taxa_cambio": 0,  // SOMENTE para DI/DUIMP: taxa do dólar (USD) usada na declaração — ex.: "TAXA USD: 5,0908" nas Informações Complementares, ou a taxa de câmbio do USD nos dados da declaração. Copie com todas as casas impressas (ex.: 5.0908). 0 para outros documentos.
  "di_valor_aduaneiro": 0,  // SOMENTE para DI/DUIMP: valor TOTAL da declaração em R$ — FOB + frete + seguro na taxa da DI (ex.: "TOTAL: USD 36.253,03 - BRL 184.556,93" → 184556.93; ou o "Valor Aduaneiro"/"VMLD" em R$). 0 para outros documentos.
  "data_liberacao": "YYYY-MM-DD",  // "DATA DO DESEMBARAÇO" no Comprovante de Importação (CI) — é a liberação da carga, não a data de emissão do documento. Na consulta do Portal Siscomex ("Relatório de Pesquisa Direta de Declarações de Importação") é a "Data/Hora" da linha cuja "Situação Atual" é DESEMBARAÇADA. Na DUIMP, a data do evento de desembaraço no histórico ("Desembaraço", "Desembaraçada", "Carga liberada"). O Extrato da DI comum NÃO traz essa data — se o documento não mostrar o desembaraço, deixe vazio.
  "ci_numero": "",  // número da CI (Commercial Invoice/Fatura Comercial) — extrair de rótulos como "Invoice No", "Invoice Number", "INV. NO", "INV NO", "INV. NO:", "CI No", "Commercial Invoice No" (aceitar variações de pontuação/abreviação do rótulo, ex: com ou sem ponto, com ou sem dois-pontos)
  "ci_valor_usd": 0,  // valor total da Commercial Invoice — "Total Amount", "Total Value", "Grand Total", "Total USD"
  "ci_data": "YYYY-MM-DD",  // data de emissão da Commercial Invoice — "Invoice Date", "INV. DATE", "Date"
  "data_chegada": "YYYY-MM-DD",  // preencher SOMENTE quando o documento for a DI/Extrato da DI — é a única fonte que confirma o desembarque efetivo. Para qualquer outro documento (BL, CE Mercante, invoice, etc.), NÃO preencher este campo — a data de chegada/atracação deles é só previsão, então use "eta" em vez disso.
  "ce_master": "",  // número do CE Mercante MASTER (do armador/linha de navegação), se houver
  "ce_house": "",  // número do CE Mercante HOUSE (do agente de carga/consolidador), se houver
  "ce_data_embarque": "YYYY-MM-DD",  // data de embarque conforme o CE Mercante
  "nf_entrada_numero": "",  // número da Nota Fiscal de ENTRADA (nacionalização/entrada da mercadoria no estoque)
  "nf_entrada_data": "YYYY-MM-DD",  // data de emissão da NF de entrada
  "nf_entrada_valor": 0,  // valor da NF de entrada em REAIS (R$) — NF brasileira nunca é emitida em USD
  "nf_saida_numero": "",  // número da Nota Fiscal de SAÍDA (venda ao cliente final)
  "nf_saida_data": "YYYY-MM-DD",  // data de emissão da NF de saída
  "nf_saida_valor": 0,  // valor da NF de saída em REAIS (R$)
  "nf_cfop": "",  // SOMENTE para NF-e (DANFE): o CFOP do item principal da nota (ex.: 5102, 6108, 5905, 5907, 1907, 3102)
  "cliente": "",  // razão social do cliente/destinatário final — extrair do campo "NOME/RAZÃO SOCIAL" do DESTINATÁRIO na NF de SAÍDA (não confundir com o fornecedor/exportador, que é estrangeiro)
  "encomendante_cnpj": "",  // CNPJ do encomendante/adquirente — ver instruções específicas na seção do Comprovante de Importação/Extrato da DI abaixo. Deixar "" se o documento não for esse tipo ou não trouxer esse campo.
  "data_devolucao_vazio": "YYYY-MM-DD",  // data em que o container VAZIO foi devolvido/entregue no depósito/terminal
  "depot": "",  // SOMENTE para RIC/EIR de devolução: nome do terminal/depósito onde o vazio foi devolvido (cabeçalho do documento, ex: "LECHMAN TERMINAIS NAVEGANTES")
  "eh_ric": false,
  "ric_avaria": false,  // SOMENTE para RIC: true se o RIC registrar avaria/dano, lavagem ou limpeza (ex: "recebido com AVARIA", "CHEMICAL CLEAN", "LAVAGEM", "LIMPEZA", "DAMAGE", "REPARO", "ESTIMATIVA DE REPARO"); false se o container foi recebido sem nenhuma observação desse tipo  // true SOMENTE se o documento for um RIC/EIR/Intercâmbio/Gate Pass de container (comprovante de entrada/saída de container em terminal/depósito)
  "cambio_referencias": [],  // usar SOMENTE para Comprovante de Câmbio (inclusive mensagem SWIFT de pagamento — câmbio futuro) — ver instruções específicas abaixo. Array de objetos {"referencia":"", "valor_pago":0, "valor_usd_referencia":0, "taxa_cambio":0, "taxa_cambio_texto":"", "valor_total_usd":0, "valor_total_brl":0, "data_pagamento":"YYYY-MM-DD", "banco":"", "codigo_bacen":"", "custo_operacao":0, "tipo_cambio":"NORMAL|FUTURO", "swift_id":""}. Deixar [] para qualquer outro tipo de documento.
  "datas_texto": {},  // para CADA campo de data que você preencheu acima (pi_data, etd, eta, data_embarque, data_registro_di, data_liberacao, ci_data, data_chegada, ce_data_embarque, nf_entrada_data, nf_saida_data, data_devolucao_vazio), copie aqui o TEXTO da data exatamente como está impresso no documento, sem converter e sem trocar a ordem de dia e mês — ex.: {"data_devolucao_vazio": "30/05/2026 10:54", "etd": "SEP. 05, 2026", "nf_entrada_data": "05/10/2026"}. Só o trecho da data (pode vir com a hora). Campo de data que você deixou vazio não entra aqui.
  "documento_brasileiro": false,  // true quando o documento foi emitido no Brasil e traz as datas no formato dia/mês/ano (RIC/EIR de terminal brasileiro, NF-e/DANFE, DI/DUIMP, CE Mercante, comprovante de câmbio de banco brasileiro); false para PI, CI, packing list, BL, booking e demais documentos emitidos no exterior
  "free_time": null
}
Se o documento for um EIR (Equipment Interchange Receipt), também chamado de RIC ou "Gate Pass Receipt", emitido por um terminal/depósito de containers (ex: MEDLOG, Santos Brasil, etc.):
- também é RIC o "INTERCAMBIO DE ENTRADA" / "INTERCÂMBIO" / "EIR" de terminais como LECHMAN, Portonave, Poly, etc. Marque "eh_ric": true.
- extrair um item no array "containers" com o número do container (campo "Container No." ou a linha logo abaixo da data, ex: "PIDU 452832-3 40HC"). O número do container é SEMPRE 4 letras + 7 dígitos: devolva sem espaços, hífens ou pontos (ex: "PIDU 452832-3" → "PIDU4528323"). Não inclua o tipo (40HC) no número. Deixe "lacre" vazio se o campo LACRE do RIC estiver em branco.
- extrair "ric_avaria": true quando o RIC mencionar avaria, dano, reparo, lavagem ou limpeza do container (inclusive limpeza química / "CHEMICAL CLEAN").
- extrair "depot": nome do terminal/depósito que emitiu o RIC (cabeçalho, ex: "LECHMAN TERMINAIS NAVEGANTES").
- num RIC, NÃO preencha nenhum outro campo além de containers, data_devolucao_vazio, depot e eh_ric — em especial NÃO preencha armador (o RIC traz só a sigla, ex: "PIL"), transportadora (é quem levou o vazio, não a transportadora do processo), navio, cliente/importador, referencia ou lacre.
- data_devolucao_vazio vem do campo "Gate In Date/Time" (nos RICs brasileiros de entrada, o campo "ENTRADA: dd/mm/aaaa hh:mm" — converta para "YYYY-MM-DD"; NÃO use "REGISTRO") — esta é a data e hora em que o container vazio deu entrada no depósito, ou seja, a devolução física de fato. O formato no documento costuma ser "YYYY/MM/DD HH:MM" (ex: "2026/05/30 10:54") — converta apenas a parte da data para "YYYY-MM-DD" (ex: "2026-05-30"), descartando a hora.
- se o campo "Gate In Date/Time" estiver vazio mas "Gate Out Date/Time" estiver preenchido, este documento é de SAÍDA do container vazio do depósito (não de devolução) — não preencher data_devolucao_vazio neste caso.
Se o documento for um Comprovante de Importação, Extrato da Declaração de Importação (DI) ou uma DUIMP (Declaração Única de Importação — o novo formato que está substituindo a DI), emitidos pela Receita Federal/Siscomex:
- NUNCA preencha ce_master, ce_house ou ce_data_embarque a partir desse documento, mesmo que ele mencione ou referencie um número de CE Mercante em algum trecho (a DUIMP costuma citar o CE vinculado à carga como parte dos próprios dados da declaração) — esses 3 campos só podem vir de um CE Mercante emitido de verdade, nunca de uma DI/DUIMP. Preenchê-los a partir daqui troca ou apaga o CE Master/House corretos já registrados no processo.
- extrair "di_peso_liquido" (peso líquido TOTAL da declaração, em kg — nas DUIMPs aparece em "Informações Complementares" como "PESO LIQUIDO: 15.780,76 KGS"; se não houver, use o "Peso Líquido (kg)" dos Dados da Carga; NÃO use o peso de um item/adição isolado) e "di_ncms" (todos os NCMs distintos das adições/itens, ex.: "4011.20.90"). Extraia também "di_ncms_detalhe": um objeto por item/adição com o NCM, a "Quantidade na unidade estatística" e o "Peso líquido (kg)" daquele item — usado para separar quantidade e peso por NCM na reciclagem.
- Se for uma DI (documento antigo): numero_di vem de "DECLARAÇÃO DE IMPORTAÇÃO Nº" (ex: "26/0672265-4"); data_registro_di vem de "DATA DO REGISTRO".
- Se for uma DUIMP (documento novo, geralmente chamado "Extrato da Duimp"): numero_di E duimp_numero recebem os DOIS o número da própria DUIMP, impresso no topo do documento (ex: "Extrato da Duimp 26BR0001279136-0" → usar "26BR0001279136-0"); data_registro_di vem da data do evento "Declaração registrada" listado no Histórico do documento (ignorar o horário, só a data).
- "di_tributos": no Extrato da DUIMP os valores costumam estar nas Informações Complementares, no bloco "DEMONSTRATIVO DE CÁLCULOS" (ex.: "I.I. ....: R$ 40.096,18", "I.P.I. ....: R$ 19.546,89", "PIS ....: R$ 4.298,31", "COFINS ....: R$ 19.807,52", "TAXA SISCOMEX....: R$ 154,23") e o AFRMM numa linha "AFRMM: R$ 2.458,90" — use esses valores. Em outros layouts os tributos aparecem por tributo (II, IPI, PIS, COFINS, Taxa de Utilização/Siscomex, Direito Antidumping) com colunas tipo "Calculado", "A recolher", "Suspenso", "Recolhido". Use o valor efetivamente A RECOLHER / RECOLHIDO, em R$, somando todos os itens/adições. Na DI antiga, use os valores recolhidos do quadro de tributos/pagamentos. NÃO inclua ICMS aqui (nem IBS/CBS).
- canal vem de "CANAL DE CONFERENCIA ADUANEIRA".
- data_liberacao vem de "DATA DO DESEMBARAÇO" — esta é a data de liberação da carga, diferente da data de emissão do documento. Na consulta/relatório do Portal Siscomex (Pesquisa de Declarações de Importação), use a "Data/Hora" da "Situação Atual" DESEMBARAÇADA. O Extrato da DI comum só traz o registro — sem desembaraço no documento, deixe data_liberacao vazio (não use a data de registro no lugar).
- se o documento trouxer dados de embarque (navio, data de embarque na origem, baldeação/transbordo, data de chegada no porto brasileiro — ex.: "EMBARQUE: VUNG TAU, VIETNÃ EM 19/01/2026" nas informações complementares), extraia também "navio" (use a mesma regra de navio de chegada: em caso de baldeação no exterior, o navio de chegada é o navio de conexão), "data_embarque" (data de embarque na origem — na DI/DUIMP ela já é a data REAL, não previsão; NÃO preencha "etd" a partir da DI) e "data_chegada" (data de chegada efetiva no porto brasileiro).
- extrair "encomendante_cnpj": o CNPJ do ENCOMENDANTE/ADQUIRENTE da operação (campos comuns: "Encomendante", "Adquirente", "Importador por conta e ordem de" — em operações de importação por conta e ordem ou por encomenda) — extrair só os 14 dígitos do CNPJ, sem pontuação. Se o documento não mostrar essa figura (importação direta, sem encomendante/adquirente distinto do importador), deixar "".
Se o documento for uma Nota Fiscal (NF-e brasileira):
- em toda NF-e, preencha "nf_cfop" com o CFOP do item principal da nota.
- se o CFOP da NF for de REMESSA ou RETORNO de armazém/depósito (5905, 6905, 5906, 6906, 5907, 6907, 1906, 2906, 1907, 2907 — ex.: "remessa para depósito", "retorno simbólico"), preencha "nf_cfop" e os campos nf_saida_* (número, data e valor da nota), mas NÃO preencha nf_entrada_* nem cliente: essa nota é só movimentação de estoque e o sistema a registra no lugar certo (aba Documentos ou Vendas).
- todo valor de NF está em REAIS (R$), nunca em USD — não confundir com pi_valor_usd/ci_valor_usd.
- se a NF for de ENTRADA (compra/nacionalização, destinatário é a própria importadora), preencher apenas os campos nf_entrada_*. O destinatário desta NF é a própria IMPAK — não usar como "cliente".
- se a NF for de SAÍDA (venda, destinatário é o cliente final), preencher os campos nf_saida_* e também extrair "cliente" do nome/razão social do destinatário.
- não preencher os dois grupos ao mesmo tempo a partir do mesmo documento — cada NF enviada é de um tipo só.
Se o documento for um CE Mercante (Conhecimento Eletrônico de Carga, emitido pela Receita Federal/Siscomex):
- extrair ce_master (CE do armador/linha de navegação) e/ou ce_house (CE do agente de carga/consolidador) — um CE Mercante pode ter só um dos dois ou os dois, dependendo se a carga é consolidada. Preencher cada campo apenas se aquele número aparecer no documento.
- na consulta de um CE de carga consolidada ("Tipo de Conhecimento: Filhote (HBL)"), o número ao lado de "CE-MERCANTE FILHOTE" (em "Identificação Única do Conhecimento") é o ce_house, e o número de "CE-Mercante do Master" (no bloco "Dados de seu Master") é o ce_master. Se o conhecimento for o próprio master ou BL único (sem filhote), o número dele é o ce_master e ce_house fica vazio. NUNCA repita o mesmo número em ce_master e ce_house.
- extrair também "eta" (data de chegada/atracação no porto brasileiro segundo o CE — isso ainda é só previsão até a DI ser registrada, então usar "eta", NUNCA "data_chegada"), ce_data_embarque (data de embarque na origem — repita a mesma data em "data_embarque": o CE registra o embarque efetivo; a consulta do CE do Siscomex muitas vezes NÃO tem um campo chamado "data de embarque" — nesse caso use a "Data de Emissão" de "Dados Gerais do Conhecimento" (a do próprio conhecimento/BL, não a de encerramento do manifesto nem a data/hora da consulta) e preencha ce_data_embarque e data_embarque com ela) e "armador" (transportador/armador conforme o CE — mesmo campo usado pra BL, o CE Mercante é a fonte mais confiável quando os dois documentos existem).
- o campo "navio" deve refletir o navio de CHEGADA informado no CE — se houver transbordo/baldeação no exterior, use o navio de conexão (o último navio que trouxe a carga até o porto de destino), não o navio do embarque original.
Se o documento for um Comprovante de Câmbio (operação de câmbio bancária — compra de moeda estrangeira para pagamento ao exterior):
- NUNCA preencha o campo "referencia" (o de nível superior, fora de "cambio_referencias") a partir deste tipo de documento — deixe-o sempre "". A referência de cada processo/invoice coberto pela operação vai DENTRO de cada item de "cambio_referencias" (campo "referencia" de cada item), nunca no campo solto. Em especial, NUNCA use a "Referência Interna" do banco, o número do Contrato de Câmbio/código BACEN, ou qualquer identificador interno da instituição financeira para preencher o campo "referencia" solto — esses números não identificam nenhum processo da IMPAK, mesmo parecendo uma referência.
- extrair "taxa_cambio" (a taxa/PTAX da operação, em R$ por US$) — normalmente é UMA só para o comprovante inteiro, mesmo que ele cubra várias referências/faturas.
  - copie a taxa EXATAMENTE como está impressa, com TODAS as casas decimais que aparecem (normalmente 4 — ex.: Santander "Taxa Cambial 5,1435" → 5.1435; contrato de câmbio formal "4,963500000" → 4.9635). NUNCA arredonde para 2 casas e nunca calcule a taxa você mesmo. Se o documento mostrar menos casas (ex.: o resumo "detalhes da operação" do Itaú imprime "taxa de câmbio: 5.24"), copie como está — o sistema confere com os totais.
  - "taxa_cambio_texto": o TEXTO da taxa exatamente como aparece no documento, sem converter (ex.: "5,1435", "5.24", "4,963500000", "taxa 5,084"). Repetir em cada item.
  - "valor_total_usd" e "valor_total_brl": os valores TOTAIS da operação impressos no documento — em moeda estrangeira (Itaú "valor em moeda estrangeira contratada"; Santander "Valor em Moeda Estrangeira (USD)"; contrato "Valor em moeda estrangeira") e em reais (Itaú "valor em reais contratado"; Santander "Valor em reais (R$) (BRL)"; contrato "Valor em moeda nacional"). São os totais do comprovante, mesmo que ele cubra várias referências — repetir em cada item. Deixe 0 o que não aparecer (mensagem SWIFT não tem valor em reais).
- o comprovante pode listar UMA OU VÁRIAS referências de processo/invoice na mesma operação (ex: numa tabela ou lista de "faturas pagas" dentro do comprovante, às vezes só uma anotação com os números das referências e o valor de cada uma). Para CADA referência encontrada, criar um item em "cambio_referencias" com "referencia" (o número/código da referência ou invoice, exatamente como aparece no documento) e o valor específico dela — preste MUITA atenção em que MOEDA esse valor está escrito, porque comprovantes de bancos diferentes mostram isso de jeitos diferentes:
  - se o valor daquela referência estiver em DÓLAR (símbolo "$" ou "US$" ou "USD" antes do número, ex: "$5.088,00"), preencher "valor_usd_referencia" com esse valor e deixar "valor_pago" como 0.
  - se o valor daquela referência estiver em REAIS (símbolo "R$" antes do número), preencher "valor_pago" com esse valor e deixar "valor_usd_referencia" como 0.
  - nunca preencha os dois campos ao mesmo tempo pra uma mesma referência, a menos que o documento mostre claramente os dois valores lado a lado pra ela.
  - use os valores EXATOS do documento pra cada referência — nunca divida o total igualmente entre as referências por conta própria, nem faça a conversão de moeda você mesmo (o sistema faz a conversão depois, usando "taxa_cambio").
  - repetir "taxa_cambio" (a mesma taxa da operação) em cada item, a menos que o documento mostre taxas diferentes por referência.
- se o comprovante não mencionar nenhuma referência/invoice explicitamente (só o valor total e a taxa), retornar um único item em "cambio_referencias" com "referencia" vazia ("") e o valor total — o sistema vai pedir confirmação manual de qual processo isso pertence.
- extrair também "data_pagamento" (a data em que a operação de câmbio/pagamento foi feita — normalmente "Data da Operação", "Data de Liquidação" ou a data de emissão do comprovante) — repetir a mesma data em cada item de "cambio_referencias", a menos que o documento mostre datas diferentes por referência.
- extrair "banco": o nome do banco ou corretora que emitiu o comprovante (ex: "Itaú", "Santander", "Banco do Brasil") — normalmente identificável pelo logo/cabeçalho do documento ou pelo nome que aparece no rodapé/timbre. Repetir em cada item de "cambio_referencias".
- extrair "codigo_bacen": o número do CONTRATO DE CÂMBIO junto ao Banco Central — é a referência que identifica a operação perante o BACEN, não o número da fatura/invoice comercial. Costuma aparecer como "Referência", "Nº do Contrato de Câmbio", "Contrato de Câmbio Nº" ou "Número do Contrato" — geralmente um número de 8 a 12 dígitos, diferente da referência do processo/invoice. Repetir o mesmo código em cada item de "cambio_referencias" (é um único contrato por operação, mesmo quando cobre várias referências).
  - ATENÇÃO (erro comum, já aconteceu): nos comprovantes do Itaú o layout tem uma tabelinha no topo do documento com as colunas "Tipo de Operação | Evento | Referência | Data da operação" — o valor dessa coluna "Referência" (ex: "632806455") é SEMPRE o código do contrato de câmbio junto ao BACEN, vai SEMPRE em "codigo_bacen", e NUNCA deve ser usado como o campo "referencia" de um item de "cambio_referencias", mesmo sendo o campo mais visível/rotulado "Referência" do documento. O mesmo vale pro Santander, onde esse número aparece como "Referência Interna" ou "N° do Contrato de Câmbio" numa tabela semelhante no topo. Esses números identificam a OPERAÇÃO BANCÁRIA perante o banco/BACEN, nunca um processo/invoice da IMPAK — só use como "referencia" de "cambio_referencias" um número/código que apareça claramente vinculado a uma fatura/invoice/processo específico (ex: anotação manual, carimbo, ou uma tabela separada de "faturas pagas" dentro do comprovante).
- "tipo_cambio": "NORMAL" para o comprovante brasileiro de operação de câmbio (em português, com nº do contrato/código BACEN e taxa impressa). "FUTURO" quando o documento for uma MENSAGEM SWIFT de pagamento internacional (em inglês — tem marcas como "pacs.008", "MT103", "UETR", "BICFI", "Interbank Settlement Amount", "Debtor"/"Creditor", "Message Identifier"): é o câmbio futuro da IMPAK, que NÃO tem código BACEN.
- Se for câmbio FUTURO (mensagem SWIFT):
  - "codigo_bacen" fica SEMPRE "" (não existe). NUNCA use o UETR, o MUR, o nº da mensagem ou a conta como codigo_bacen.
  - "swift_id": o identificador da mensagem — "Business Message Identifier" / "Message Identification" / "MUR" / "Instruction Identification" (normalmente começa com letras, ex.: "IF058503659905"). Repetir em cada item.
  - valor: o total está em "Amount" / "Interbank Settlement Amount" (em USD). As referências dos processos e o valor de cada uma vêm ANOTADOS À MÃO/carimbados no documento (ex.: "HK60684 $7.806,51") — um item por referência anotada, valor em "valor_usd_referencia". Uma referência anotada SEM valor ao lado recebe o valor total (Amount).
  - "taxa_cambio": a taxa NÃO vem impressa na mensagem SWIFT — procure um número anotado à mão no formato de taxa de câmbio (entre 3 e 8, com 2 a 4 casas, ex.: "5,03", "taxa 5,084", "5,1540"). Copie com exatamente as casas anotadas — não arredonde e não complete com zeros — e coloque o texto anotado em "taxa_cambio_texto". Não confunda com valores em dólar nem com a "Priority". Se não houver anotação legível, deixe 0 (o sistema pede a taxa ao usuário).
  - "data_pagamento": "Value Date" / "Interbank Settlement Date" / "Creation Date".
  - "banco": o banco remetente (Sender/Debtor Agent — ex.: BSCHBRSP = Santander).
- extrair "custo_operacao": o custo total da operação em REAIS, somando IOF + tarifas/spread bancário, SE o comprovante discriminar esses valores separadamente (campos como "IOF", "Tarifa", "Despesas", "Encargos"). Some todos os valores dessa natureza que aparecerem. Se o documento não discriminar nenhum custo separado do valor da operação, deixar 0 — nunca estimar ou inventar um valor. Repetir o mesmo total em cada item de "cambio_referencias".
Não preencha free_time — deixe sempre null. Free time só é preenchido manualmente após emissão do BL.
Retorne apenas JSON válido, sem texto adicional. Deixe em branco ("") os campos não encontrados.`;

    const content = [{
      type: 'text',
      text: promptInstrucoes,
      cache_control: { type: 'ephemeral' }
    },{
      type: isImg ? 'image' : 'document',
      source: { type:'base64', media_type: file.type, data: base64 }
    }];

    // Faz a chamada com 1 retry automático: falhas como "Could not process PDF"
    // ou hiccups passageiros do servidor (resposta não-JSON, ex: página de
    // erro HTML do proxy) costumam ser intermitentes — uma segunda tentativa
    // depois de uma pequena espera resolve a maioria dos casos.
    async function chamarAnalise(tentativa){
      const resp = await fetch('/api/analisar',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({content})
      });
      const textoResp = await resp.text();
      let d;
      try{
        d = JSON.parse(textoResp);
      }catch(e){
        // Resposta não é JSON — geralmente página de erro do servidor/proxy
        // (ex: <!DOCTYPE...>), não um problema no documento em si.
        if(tentativa < 2){
          if(status) status.textContent = '⏳ Falha de comunicação, tentando novamente...';
          await new Promise(r=>setTimeout(r, 2000));
          return chamarAnalise(tentativa+1);
        }
        throw new Error('O servidor não respondeu corretamente (pode ter sido uma instabilidade momentânea). Tente novamente em alguns segundos.');
      }
      if(!d.ok || !d.jobId){
        // Erro real na criação do job (ex: falha de validação ou chave não
        // configurada) — também vale a pena tentar de novo uma vez.
        if(tentativa < 2 && /could not process|processar.*pdf/i.test(d.erro||'')){
          if(status) status.textContent = '⏳ Falha ao processar o PDF, tentando novamente...';
          await new Promise(r=>setTimeout(r, 2000));
          return chamarAnalise(tentativa+1);
        }
        throw new Error(d.erro||'Erro na IA');
      }
      // /api/analisar agora só CRIA o job e responde na hora (evita erro 502
      // em análises longas) — o resultado real vem via polling em
      // /api/analisar/job/:id, exatamente como o runAnalysis() da Conferência
      // (processos.html) já faz. Sem isso, extrairComIA() lia "d.data" de uma
      // resposta que só tinha "jobId", travando com "Cannot read properties
      // of undefined (reading 'content')" toda vez que a IA lia um documento.
      const jobId = d.jobId;
      const inicio = Date.now();
      while(true){
        await new Promise(r=>setTimeout(r, 2500));
        const rJob = await fetch('/api/analisar/job/'+jobId);
        const dJob = await rJob.json();
        if(!dJob.ok) throw new Error(dJob.erro||'Erro ao consultar análise');
        if(dJob.status === 'concluido') return { ok:true, data: dJob.resultado };
        if(dJob.status === 'erro'){
          if(tentativa < 2 && /could not process|processar.*pdf/i.test(dJob.erro||'')){
            if(status) status.textContent = '⏳ Falha ao processar o PDF, tentando novamente...';
            return chamarAnalise(tentativa+1);
          }
          throw new Error(dJob.erro||'Erro na IA');
        }
        if(status) status.textContent = '⏳ Analisando documento...';
        if(Date.now()-inicio > 340000) throw new Error('Análise demorou demais. Tente novamente com um documento menor.');
      }
    }

    const d = await chamarAnalise(1);
    if(painelTrocouNaLeitura()){
      if(status) status.textContent = '';
      showToast(`A leitura de ${file.name} terminou depois que o processo foi fechado ou trocado — nada foi preenchido. Abra o processo e leia o documento de novo.`, 'warn', 10000);
      return;
    }

    const raw = (d.data.content||[]).map(c=>c.text||'').join('');
    let extracted;
    try{
      extracted = extrairJsonRespostaIA(raw);
    } catch(e){
      console.warn('Resposta da IA não pôde ser lida como JSON:', raw);
      const motivo = (d.data && d.data.stop_reason === 'max_tokens') ? ' (resposta cortada por ser longa demais)' : '';
      throw new Error('Resposta da IA inválida' + motivo + ' — tente ler o documento de novo');
    }

    // Normalizar valores numéricos e limpar PI antes de preencher
    function normNum(v){
      if(!v && v!==0) return null;
      const s = String(v).replace(/[R$USD\s]/gi,'').trim();
      if(/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(s)) return parseFloat(s.replace(/\./g,'').replace(',','.'));
      return parseFloat(s.replace(',','.')) || null;
    }
    if(extracted.pi_valor_usd) extracted.pi_valor_usd = normNum(extracted.pi_valor_usd);
    if(extracted.ci_valor_usd) extracted.ci_valor_usd = normNum(extracted.ci_valor_usd);
    // Termos de pagamento (05/10/2026, processos 26DTPI0476-x): "Entrada + Saldo" é legado
    // (o <select> nem tem mais essa opção em processo novo — setar esse valor
    // deixava a Forma de Pagamento em branco); adiantamento + saldo = Parcelado.
    // O % de adiantamento vai pro campo "% Entrada (PI)" do Parcelado.
    if(extracted.pi_pagamento === 'ENTRADA_SALDO') extracted.pi_pagamento = 'PARCELADO';
    // PF BR26R142 (Tyre Export, 06/10/2026): "100% At Sight 10 days before ETA"
    // vinha como À Vista. O texto literal dos termos é reclassificado por
    // regra fixa (classificarTermosPagamento) e prevalece sobre o palpite da IA.
    {
      const termos = extracted.pi_termos_pagamento;
      delete extracted.pi_termos_pagamento;
      const cls = classificarTermosPagamento(termos);
      if(cls){
        extracted.pi_pagamento = cls.pagamento;
        if(cls.pagamento === 'PARCELADO' && cls.adiantamento_pct) extracted.pi_adiantamento_pct = cls.adiantamento_pct;
        if(cls.pagamento !== 'PARCELADO') extracted.pi_adiantamento_pct = 0;
        if(cls.prazo_dias) _prazoDiasTermos = cls.prazo_dias;
      }
    }
    if(extracted.pi_pagamento && !['VISTA','PRAZO','PARCELADO'].includes(extracted.pi_pagamento)) delete extracted.pi_pagamento;
    {
      const pct = Math.round(parseFloat(String(extracted.pi_adiantamento_pct ?? '').replace(',','.').replace('%','')) || 0);
      extracted.pi_adiantamento_pct = (pct > 0 && pct < 100) ? pct : 0;
      if(extracted.pi_adiantamento_pct && !extracted.pi_pagamento) extracted.pi_pagamento = 'PARCELADO';
    }
    if(extracted.nf_entrada_valor) extracted.nf_entrada_valor = normNum(extracted.nf_entrada_valor);
    if(extracted.nf_saida_valor)   extracted.nf_saida_valor   = normNum(extracted.nf_saida_valor);
    if(extracted.di_peso_liquido)  extracted.di_peso_liquido  = normNum(extracted.di_peso_liquido);
    // Taxa do dólar e total em R$ da DI (21/10/2026, cabeçalho "Check-list
    // Fechamento Importação" do DRE): só valem de DI/DUIMP.
    {
      const ehDiDoc = !!(extracted.numero_di || extracted.data_registro_di || extracted.canal);
      const taxa = parseFloat(String(extracted.di_taxa_cambio ?? '').replace(',', '.'));
      const total = normNum(extracted.di_valor_aduaneiro);
      if(ehDiDoc && taxa > 1 && taxa < 20) extracted.di_taxa_cambio = Math.round(taxa * 10000) / 10000; else delete extracted.di_taxa_cambio;
      if(ehDiDoc && total > 0) extracted.di_valor_aduaneiro = total; else delete extracted.di_valor_aduaneiro;
    }
    // Quebra por NCM (qtd/peso de cada item da DI/DUIMP) → vai pro próprio
    // di_ncms no formato "4011.80.90: 48 un, 2227.68 kg; ..." (Reciclagem).
    let _ncmsDet = '';
    if(Array.isArray(extracted.di_ncms_detalhe) && extracted.di_ncms_detalhe.length && typeof formatarNcmsDetalhe === 'function'){
      _ncmsDet = formatarNcmsDetalhe(extracted.di_ncms_detalhe);
      if(!/un,/.test(_ncmsDet)) _ncmsDet = '';
    }
    delete extracted.di_ncms_detalhe;
    if(_ncmsDet){ extracted.di_ncms = _ncmsDet; }
    else if(extracted.di_ncms){
      // normaliza "4011.2090" / "40112090" → "4011.20.90"
      extracted.di_ncms = String(extracted.di_ncms).split(/[,;\s]+/).map(n=>n.replace(/\D/g,'')).filter(n=>n.length>=8)
        .map(n=>n.slice(0,4)+'.'+n.slice(4,6)+'.'+n.slice(6,8)).filter((n,i,a)=>a.indexOf(n)===i).join(', ');
      if(!extracted.di_ncms) delete extracted.di_ncms;
    }
    if(extracted.pi_numero)    extracted.pi_numero    = extracted.pi_numero.replace(/\s*\(.*?\)\s*/g,'').trim();
    if(!extracted.free_time)   delete extracted.free_time;

    // ── NF de SAÍDA (venda, remessa ou retorno) — 20/10/2026 ──
    // Uma NF de venda lida aqui ocupou o lugar da NF de remessa na aba
    // Documentos, e o CFOP 5905 da remessa ficou na venda (a venda sumiu do
    // faturamento). Agora a NF de saída segue o mesmo caminho do botão de NF
    // (importarNFSaidaProcessoArquivo, controle-nf-import.js): remessa e venda
    // ficam as duas (a segunda vai para a aba Vendas, com o CFOP dela), o CFOP
    // anda junto com a nota e a mesma NF não entra duas vezes. Nenhum outro
    // campo do processo é lido de uma NF de saída. NF de entrada segue abaixo.
    if(nfSaidaNaLeituraGeral(extracted) && typeof importarNFSaidaProcessoArquivo === 'function'){
      if(status) status.textContent = '⏳ Nota fiscal de saída: lançando pela regra de NF (remessa × venda)...';
      const rNF = await importarNFSaidaProcessoArquivo(file, { statusEl: status });
      if(rNF && rNF.mensagem) showToast(rNF.mensagem, rNF.ok ? 'ok' : 'warn', 12000);
      if(_editando && rNF && rNF.ok && rNF.camposLog.length){
        _editando.log = _editando.log || [];
        _editando.log.push({ campo: LOG_CAMPO_LEITURA_IA, valor_antes: file.name, valor_depois: rNF.camposLog.join(', '), usuario: _user.usuario, created_at: new Date().toISOString() });
      }
      if(_editando && _editando.id) uploadArquivosGed([file]);
      return;
    }
    delete extracted.nf_cfop; // NF de entrada: o processo não tem campo de CFOP de entrada

    // Fallback: alguns documentos (principalmente a CI/Commercial Invoice)
    // não trazem uma "referência" interna do processo — só o número da CI.
    // Nesse caso, usa o próprio número da CI como referência, pra não deixar
    // o campo obrigatório em branco. Só entra em ação quando a IA não achou
    // NENHUMA referência no documento.
    if(!extracted.referencia && extracted.ci_numero) extracted.referencia = extracted.ci_numero;

    // ── Regra do cadastro do fornecedor: de onde vem a referência ──
    // Pedido Emanuelly (01/10/2026): "sempre que for ele [Tyre Export], ler
    // o nº da proforma no campo Number PO" como referência do processo. A
    // regra fica no cadastro da empresa (regras_json.referencia_origem, ver
    // modal de Empresa em /cadastros), então vale pra qualquer fornecedor
    // configurado — aqui só procuramos o cadastro pelo nome que o documento
    // traz (ou o já preenchido no processo) e aplicamos. Sobrescreve o que a
    // IA tinha chutado em "referencia", nunca o campo já salvo no processo
    // (isso continua passando pelo aviso/divergência abaixo).
    let _refPelaRegra = false;
    const nomeFornecedorDoc = String(extracted.fornecedor || document.getElementById('f_fornecedor')?.value || '').trim();
    if(nomeFornecedorDoc && typeof acharCadastroFornecedor === 'function'){
      try{
        const cadForn = await acharCadastroFornecedor(nomeFornecedorDoc);
        const refRegra = cadForn ? referenciaPelaRegraDoFornecedor(extracted, regrasDoCadastro(cadForn)) : '';
        if(refRegra) _refPelaRegra = true;
        if(refRegra && refRegra.toUpperCase() !== String(extracted.referencia||'').toUpperCase()){
          extracted.referencia = refRegra;
          showToast(`Referência "${refRegra}" lida pela regra do cadastro de ${cadForn.razao_social}`, 'ok');
        }
      }catch(e){ console.warn('regra de referência do fornecedor:', e); }
    }
    // ── Referência IMPAK (pedido Emanuelly 15/10/2026, PI Sailun PI10515052):
    // a PI traz "PO#: IMPAK-TKH2609B-1" e o processo novo ficava SEM referência.
    // 1) Um código "IMPAK-xxxx" no documento (referência, PO) é a referência
    //    interna da IMPAK e vale mais que o nº do contrato do fornecedor.
    // 2) Processo NOVO (referência ainda vazia na tela) sem nada lido: usa o
    //    "IMPAK-xxxx" do nome do arquivo, senão PO, senão nº da PI. Em processo
    //    já existente não inventa referência (evita aviso falso de "outro processo").
    if(!_refPelaRegra){
      const acharImpak = t => { const m = String(t || '').toUpperCase().match(/\bIMPAK[-_]([A-Z0-9][A-Z0-9-]{3,})/); return m ? 'IMPAK-' + m[1].replace(/-+$/, '') : ''; };
      const refImpakDoc = acharImpak(extracted.referencia) || acharImpak(extracted.po_numero);
      const telaVazia = !(document.getElementById('f_referencia')?.value || '').trim();
      if(refImpakDoc) extracted.referencia = refImpakDoc;
      else if(telaVazia && !String(extracted.referencia || '').trim()){
        const sug = acharImpak(file && file.name) || String(extracted.po_numero || '').trim() || String(extracted.pi_numero || '').trim();
        if(sug) extracted.referencia = sug;
      }
    }
    delete extracted.po_numero; // só serve pra regra acima; não existe campo f_po_numero

    // ── Aviso de documento de OUTRO processo — pedido direto da Emanuelly
    // (10/09/2026): ela testou de propósito subir a CI do processo UD26-079
    // dentro do processo TVN2605B-2 (aberto por engano) e o sistema aplicou
    // os dados sem avisar nada — Itens/Produtos, Navio e Porto de destino
    // foram sobrescritos com dados de um processo errado, em silêncio.
    // Compara a referência que o PRÓPRIO documento traz (ou o nº da CI,
    // já com o fallback acima) com a referência do processo ABERTO agora;
    // se não bater nem por substring (cobre prefixos como "IMPAK-"), pede
    // confirmação ANTES de aplicar qualquer campo — e cancela a leitura
    // inteira se a pessoa disser que não é o documento certo.
    const refProcessoAtual = (document.getElementById('f_referencia')?.value || '').trim().toUpperCase();
    const refDocumentoLido = (extracted.referencia || '').trim().toUpperCase();
    if(refProcessoAtual && refDocumentoLido){
      const bateSubstring = refProcessoAtual.includes(refDocumentoLido) || refDocumentoLido.includes(refProcessoAtual);
      if(!bateSubstring){
        const confirmaMesmoAssim = confirm(`⚠️ Este documento parece ser do processo "${extracted.referencia}", mas você está no processo "${refProcessoAtual}".\n\nTem certeza que quer aplicar os dados deste documento aqui mesmo assim?`);
        if(!confirmaMesmoAssim){
          if(status) status.textContent = '❌ Leitura cancelada — documento parece ser de outro processo';
          showToast('Leitura cancelada — documento parece ser de outro processo','err');
          return;
        }
      }
    }

    // CNPJ do encomendante (extraído do Comprovante de Importação/Extrato da
    // DI) — cruza com o cadastro de contatos pra usar o nome OFICIAL já
    // cadastrado em vez de confiar na grafia exata do documento (evita
    // "cliente" divergente por causa de abreviação/acento/razão social
    // desatualizada entre documentos do mesmo cliente real).
    if(extracted.encomendante_cnpj){
      const cnpjDigits = String(extracted.encomendante_cnpj).replace(/\D/g,'');
      if(cnpjDigits.length === 14){
        try{
          const rContato = await fetch('/api/contatos?q='+cnpjDigits+'&limit=5');
          const dContato = await rContato.json();
          const match = (dContato.contatos||[]).find(c => (c.cnpj||'') === cnpjDigits);
          if(match){
            extracted.cliente = match.razao_social;
            showToast(`Encomendante identificado pelo cadastro: ${match.razao_social}`,'ok');
          } else {
            const cnpjFmt = cnpjDigits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,'$1.$2.$3/$4-$5');
            showToast(`CNPJ do encomendante (${cnpjFmt}) não está cadastrado — cadastre em Cadastros pra reconhecimento automático`,'warn');
          }
        }catch(e){ /* falha na consulta de cadastro não deve travar o resto da extração */ }
      }
      delete extracted.encomendante_cnpj; // não é campo de input direto no formulário
    }

    // Um documento nunca é, ao mesmo tempo, um CE Mercante genuíno E uma
    // DI/DUIMP genuína (são tipos mutuamente exclusivos) — mas a DUIMP
    // referencia o CE Mercante vinculado à carga como parte dos próprios
    // dados da declaração, então a IA às vezes lê esse número mencionado
    // dentro da DUIMP e devolve em ce_master/ce_house. Isso fazia
    // ehCeMercante virar true numa leitura de DUIMP e liberar a sobrescrita
    // de CE Master/House com um valor que não é o CE Mercante de verdade
    // desse processo (bug real reportado: CE Master sendo substituído pelo
    // número do CE House ao incluir uma DUIMP). Por isso, se o documento
    // também tiver dados de DI/DUIMP (numero_di, data_registro_di ou
    // canal), ce_master/ce_house/ce_data_embarque são descartados ANTES de
    // qualquer outra lógica — nunca vêm de um documento desse tipo.
    const pareceDiOuDuimp = !!(extracted.numero_di || extracted.data_registro_di || extracted.canal);
    if(pareceDiOuDuimp){
      delete extracted.ce_master;
      delete extracted.ce_house;
      delete extracted.ce_data_embarque;
    }

    // CE Mercante de carga consolidada: o número do FILHOTE é o CE House e o
    // do bloco "Dados de seu Master" é o CE Master. A leitura às vezes
    // devolvia o número do filhote nos dois campos — foi assim que 14
    // processos ficaram com CE Master igual ao CE House (auditoria de
    // 19/10/2026, corrigidos pelos CEs do Dropbox). Mesmo número nos dois =
    // leitura errada: fica só o House, o Master não é mexido e a tela avisa.
    // O mesmo vale para o BL: o House B/L do agente (Royal/Parisi...) não
    // traz o Master — a leitura repetia o número do HBL no MBL (6 processos
    // assim, corrigidos pelo "MBL#" do rascunho do HBL e pela nota de débito
    // do agente). Mesmo número nos dois: fica só o HBL e a tela avisa.
    const avisosNumerosIguais = [], notasNumerosIguais = [];
    if(extracted.ce_master && extracted.ce_house
       && String(extracted.ce_master).replace(/\D/g,'') === String(extracted.ce_house).replace(/\D/g,'')){
      avisosNumerosIguais.push(`O CE Master veio com o mesmo número do CE House (${extracted.ce_house}) — preenchi só o CE House. O CE Master certo está no bloco "Dados de seu Master" do CE Mercante.`);
      notasNumerosIguais.push('CE Master não usado (igual ao CE House)');
      delete extracted.ce_master;
    }
    const numBL = v => String(v || '').replace(/[\s.\-\/]/g, '').toUpperCase();
    if(extracted.mbl && extracted.hbl && numBL(extracted.mbl) === numBL(extracted.hbl)){
      avisosNumerosIguais.push(`O MBL veio com o mesmo número do HBL (${extracted.hbl}) — preenchi só o HBL. O MBL do armador costuma vir como "MBL#" no rascunho do HBL ou como "Master BL" na nota de débito do agente.`);
      notasNumerosIguais.push('MBL não usado (igual ao HBL)');
      delete extracted.mbl;
    }

    // Quando o documento é um CE Mercante, o navio/armador/etd que ele traz
    // são mais confiáveis que os do BL (refletem o navio de chegada real, já
    // considerando transbordo/baldeação no exterior) — por isso sobrescrevem
    // o que já estiver no formulário em vez de respeitar a regra "só preenche vazio".
    const ehCeMercante = !!(extracted.ce_master || extracted.ce_house);
    // Quando o documento é um BL ou uma DI/Extrato da DI, o porto de destino
    // e o container/navio que eles trazem são mais confiáveis que o Sales
    // Contract (que é só a intenção comercial registrada antes do embarque,
    // podendo estar desatualizada — ex: contrato previa "Itajai" mas a carga
    // foi operacionalmente desembarcada em "Itapoa"). Por isso, se vierem de
    // um BL/DI, esses campos também sobrescrevem o que já estiver preenchido.
    const ehBlOuDi = !!(extracted.hbl || extracted.mbl || extracted.numero_di || extracted.data_registro_di);
    // Quando o documento é uma PI/Sales Contract (traz pi_numero e/ou a
    // tabela de itens), os TERMOS COMERCIAIS que ele carrega (data, valor,
    // incoterm, forma de pagamento) são desse documento específico — se o
    // fornecedor manda uma PI "-update"/"(1)" com preço e data novos pro
    // MESMO PO#, essa nova leitura tem que sobrescrever o que a PI anterior
    // tinha preenchido, senão a Aba Financeiro fica com a Data PI/Valor USD
    // da PI velha enquanto os Itens (que já são sempre substituídos, ver
    // bloco de "itens" acima) mostram os dados novos — foi exatamente esse
    // descompasso que o Jean reportou em 10/09/2026 (2 PIs atualizadas:
    // PID2608-G e PCN2608-G, itens atualizaram OK mas Data PI/Valor USD
    // ficaram travados na leitura anterior e precisaram de correção manual).
    // ── CI = dados finais (pedido do Ayslan, 06/10/2026): "sempre que
    // colocarmos a CI para ler, ela tem os dados finais e deve ser
    // considerada e sobrescrever a PI. Se tiver dúvidas, pode abrir o pop-up
    // e questionar." Regras (ver também regrasCI* mais abaixo):
    //  • Itens/quantidades, Produto, Incoterm e os campos da CI (Nº, Data,
    //    Valor) são sobrescritos direto, sem perguntar.
    //  • Nº/Data/Valor da PI ficam como estão — a CI costuma citar o nº da PI
    //    e a IA às vezes devolvia a data/valor da CI nos campos da PI.
    //  • Pop-up (dúvida): outra CI já lançada com número diferente; itens sem
    //    nenhuma medida em comum com os atuais (pode ser a CI de outro
    //    processo); forma de pagamento diferente; fornecedor/marca diferentes.
    const ehCI = ehDocumentoCI(extracted);
    if(ehCI){ delete extracted.pi_data; delete extracted.pi_valor_usd; }
    const ehPI = !ehCI && !!(extracted.pi_numero || extracted.pi_data);
    const ciNumeroAtual = (document.getElementById('f_ci_numero')?.value || '').trim();
    const outraCI = ehCI && !!ciNumeroAtual && !!extracted.ci_numero
      && normalizarNumeroDoc(ciNumeroAtual) !== normalizarNumeroDoc(extracted.ci_numero);
    const camposSobrescritosPorCI = !ehCI ? [] : ['produto','pi_incoterm', ...(outraCI ? [] : ['ci_numero','ci_data','ci_valor_usd'])];
    // Dúvida da CI que já vem marcada "usar o valor da CI" no pop-up.
    const camposCIPadraoNovo = ['ci_numero','ci_data','ci_valor_usd','pi_pagamento'];
    function extraConflitoCI(campo){
      if(!ehCI) return null;
      if(outraCI && ['ci_numero','ci_data','ci_valor_usd'].includes(campo))
        return { padrao:'novo', motivo:`Já existe a CI ${ciNumeroAtual} neste processo e este documento é a CI ${extracted.ci_numero}. É uma CI corrigida/substituta (usar a nova) ou uma segunda invoice?` };
      if(campo === 'pi_pagamento') return { padrao:'novo', motivo:'A CI traz termos de pagamento diferentes da PI. A CI é o documento final — confirme antes de trocar a forma de pagamento (as parcelas mudam).' };
      if(campo === 'fornecedor' || campo === 'brand') return { padrao:'atual', motivo:'A CI traz um nome diferente — pode ser só grafia diferente do mesmo cadastro.' };
      if(campo === 'pi_numero') return { padrao:'atual', motivo:'A CI cita outro nº de PI. Confira se é a CI deste processo.' };
      return camposCIPadraoNovo.includes(campo) ? { padrao:'novo', motivo:'Valor da CI (documento final).' } : null;
    }
    const camposSobrescritosPorCe = ehCeMercante ? ['navio','armador'] : [];
    const camposSobrescritosPorBlDi = ehBlOuDi ? ['porto_destino','container','navio'] : [];
    const camposSobrescritosPorPI = ehPI ? ['pi_numero','pi_data','pi_valor_usd','pi_incoterm','pi_pagamento'] : [];
    // Regra de negócio: o processo só pode ser considerado DESEMBARCADO de
    // fato com base na DI/Extrato da DI — qualquer outro documento (CE
    // Mercante, BL, invoice etc.) só traz uma PREVISÃO de chegada. Por isso
    // "data_chegada" (que é o campo que muda a fase pra Desembarcado, ver
    // calcularFase) só é aceito quando o documento atual é mesmo a DI —
    // caso contrário, a data extraída vira "eta" (previsão), nunca chegada
    // efetiva, mesmo que a IA (por engano) tenha devolvido "data_chegada".
    const ehDI = !!(extracted.numero_di || extracted.data_registro_di);

    let preenchidos = 0;
    // Rastreia quais campos esta LEITURA especifica preencheu (diferente de
    // _camposIA, que acumula por toda a sessao de edicao) -- usado so pra
    // registrar no Historico o que essa leitura de documento trouxe.
    const camposLidosNestaLeitura = [];

    // ── Conflitos: campo já preenchido com um valor DIFERENTE do que este
    // documento trouxe, e o tipo de documento não é um dos "mais confiáveis"
    // pra esse campo (CE/BL-DI/PI) nem já foi preenchido pela própria IA
    // antes — em vez de descartar a leitura em silêncio (comportamento
    // antigo, que escondia a divergência do usuário sem nenhum aviso),
    // guarda pra mostrar tudo junto num pop-up de revisão ao final da
    // leitura (pedido do Ayslan, 10/09/2026). Declarado aqui (antes do
    // bloco de Itens logo abaixo) porque Itens/Produtos também passou a
    // usar esse mesmo mecanismo — ver comentário no bloco de itens.
    const conflitos = [];
    let itensSubstituidosPelaCI = false;
    function valoresDivergem(a, b){
      const na = (a==null?'':String(a)).trim().toLowerCase();
      const nb = (b==null?'':String(b)).trim().toLowerCase();
      return na !== nb;
    }
    function registrarConflito(campo, el, valorNovo, valorNovoExibicao, aplicar, valorAtualExibicao){
      if(!el.value) return; // vazio não é conflito, é só preenchimento normal (já tratado no if principal)
      const exibicao = valorNovoExibicao!=null ? valorNovoExibicao : valorNovo;
      if(!valoresDivergem(el.value, exibicao)) return; // já é o mesmo valor — não é divergência real
      const extra = extraConflitoCI(campo) || {};
      conflitos.push({
        campo,
        label: LABELS_CAMPOS_IA[campo] || campo,
        valorAtual: valorAtualExibicao!=null ? valorAtualExibicao : el.value,
        valorNovo: exibicao,
        aplicar: aplicar || (() => { el.value = valorNovo; }),
        padrao: extra.padrao || 'atual',
        motivo: extra.motivo || '',
      });
    }

    // Itens estruturados (Size/Pattern/L.I.S.R./Quantidade por linha da tabela do
    // documento) — populam a LISTA VISUAL de produtos (_produtos), não o campo
    // legado escondido. Sem isso, a extração "preenchia" um campo que o usuário
    // nunca via na tela, e a lista de produtos parecia vazia mesmo após a IA
    // rodar com sucesso.
    if(Array.isArray(extracted.itens) && extracted.itens.length){
      const itensValidos = extracted.itens.filter(it=>it && (it.size||it.pattern||it.quantidade));
      if(itensValidos.length){
        const novosProdutos = itensValidos.map(it=>{
          const partes = [it.size, it.pattern, it.li_sr, it.pr].filter(Boolean);
          const novo = { descricao: partes.join(' '), quantidade: it.quantidade!=null?it.quantidade:'' };
          // US$/un da CI/PI (20/10/2026) → Mix do Calculador (preço por medida).
          const precoUn = precoUnitarioItemIA(it.preco_unit_usd);
          if(precoUn) novo.fob_usd = precoUn;
          return novo;
        });
        // Itens/Produtos sempre substituíam a lista inteira sem nenhuma
        // verificação — problema real reportado pela Emanuelly (10/09/2026):
        // ela testou de propósito subir a CI de OUTRO processo (UD26-079) no
        // processo TVN2605B-2 e os itens corretos foram trocados pelos itens
        // errados em silêncio. Agora, se o processo já tem itens REAIS
        // cadastrados (não é só o placeholder vazio) e a leitura nova traz
        // uma lista diferente, isso vira um conflito como qualquer outro
        // campo — entra no mesmo pop-up de revisão em vez de substituir na
        // hora. Só continua substituindo direto quando a lista ainda está
        // vazia (primeira leitura) ou quando o conteúdo é o mesmo.
        const temItensReais = _produtos.some(p => p && p.descricao && p.descricao.trim());
        const resumoAtual = _produtos.filter(p=>p&&p.descricao&&p.descricao.trim()).map(p=>`${p.descricao} (${p.quantidade||'?'})`).join('; ');
        const resumoNovo = novosProdutos.map(p=>`${p.descricao} (${p.quantidade||'?'})`).join('; ');
        // CI (06/10/2026): itens e quantidades da CI são os finais e
        // substituem os da PI direto — só pergunta se nenhuma medida bater
        // (sinal de CI de outro processo).
        const ciSubstituiDireto = ehCI && itensTemMedidaEmComum(_produtos.map(p=>p&&p.descricao), novosProdutos.map(p=>p.descricao));
        // Mesmas medidas e quantidades, só escritas diferente (ex.: a PL
        // repete a marca na descrição): não é divergência — mantém o atual.
        const mesmoPedido = temItensReais && itensEquivalentes(_produtos, novosProdutos);
        if(mesmoPedido){
          // Mesmo pedido lido de novo (ex.: a CI depois da PL): só completa o
          // US$/un que faltava em cada medida — não troca nada já preenchido.
          const comp = completarFobUnitarioItens(_produtos, novosProdutos);
          if(comp.completados){
            _produtos = comp.lista;
            renderMultiProdutos();
            preenchidos += comp.completados;
            camposLidosNestaLeitura.push('itens');
          }
        } else if(temItensReais && valoresDivergem(resumoAtual, resumoNovo) && !ciSubstituiDireto){
          conflitos.push({
            campo: 'itens',
            label: LABELS_CAMPOS_IA.itens || 'Itens/Produtos',
            valorAtual: resumoAtual,
            valorNovo: resumoNovo,
            aplicar: () => { _produtos = herdarDadosDosItensAtuais(novosProdutos, _produtos); renderMultiProdutos(); },
            padrao: 'atual',
            motivo: ehCI ? 'Os itens desta CI não têm nenhuma medida em comum com os atuais. Confira se é a CI deste processo antes de substituir.' : '',
          });
        } else {
          if(ehCI && temItensReais && valoresDivergem(resumoAtual, resumoNovo)) itensSubstituidosPelaCI = true;
          _produtos = herdarDadosDosItensAtuais(novosProdutos, _produtos);
          renderMultiProdutos();
          preenchidos += _produtos.length;
          camposLidosNestaLeitura.push('itens');
        }
      }
    }
    delete extracted.itens; // não é um campo de input direto — já tratado acima

    // Comprovante de Câmbio — pode cobrir várias referências na mesma
    // operação. Nunca preenche pi_cambio/pi_cambio_entrada/pi_cambio_saldo
    // sozinho: primeiro localiza o item da lista que bate com a referência
    // do processo ABERTO agora, e abre um modal pedindo confirmação manual
    // de qual parcela é (Entrada/Saldo/Único) antes de gravar qualquer coisa.
    let abriuModalCambio = false;
    if(Array.isArray(extracted.cambio_referencias) && extracted.cambio_referencias.length){
      const refAtual = (document.getElementById('f_referencia')?.value||'').trim().toUpperCase();
      // Câmbio futuro (SWIFT) às vezes vem SEM taxa legível — não descarta
      // mais o item (antes sumia sem aviso); o modal pede a taxa ao usuário.
      const itensCambio = extracted.cambio_referencias.filter(c=>c && (c.taxa_cambio || c.taxa_cambio_texto || c.valor_usd_referencia || c.valor_pago || c.swift_id));
      itensCambio.forEach(c=>{
        c.tipo_cambio = (typeof tipoCambioDe === 'function' ? tipoCambioDe(c) : '') || 'NORMAL';
        if(c.tipo_cambio === 'FUTURO') c.codigo_bacen = ''; // SWIFT não tem contrato BACEN
        // Taxa como está no documento, até 4 casas (regra do Ayslan, 20/10/2026 —
        // ver taxaCambioDoDocumento em controle-core.js). Resumo do Itaú com taxa
        // de 2 casas e totais em R$ e US$ vira R$ ÷ US$ com 4 casas.
        if(typeof taxaCambioDoDocumento === 'function'){
          const t = taxaCambioDoDocumento(c);
          if(t.taxa > 0){ c.taxa_cambio = t.taxa; c._taxa_origem = t.origem; c._taxa_impressa = t.impressa; }
        }
      });
      let match = itensCambio.find(c=>(c.referencia||'').trim().toUpperCase()===refAtual);
      // Se não bateu exato, tenta por substring nos dois sentidos — cobre casos como
      // referência do processo com prefixo ("IMPAK-OID2605A") vs. documento que só
      // mostra "OID2605A" (sem prefixo), ou uma anotação manual truncada/cortada que
      // não coube inteira no comprovante (relato da Paula, 21/09/2026: "ele só le se a
      // referencia estiver completa, e as vezes ela é longa e nao cabe").
      if(!match) match = itensCambio.find(c=>{
        const rc = (c.referencia||'').trim().toUpperCase();
        return rc.length>=4 && (refAtual.includes(rc) || rc.includes(refAtual));
      });
      if(!match && itensCambio.length===1 && !itensCambio[0].referencia) match = itensCambio[0];
      if(match){
        abrirModalConfirmarCambio(match, refAtual);
        abriuModalCambio = true;
      } else if(itensCambio.length){
        const refsEncontradas = itensCambio.map(c=>c.referencia||'(sem referência)').join(', ');
        showToast(`⚠ Comprovante de câmbio não menciona a referência "${refAtual}" — encontradas: ${refsEncontradas}. Abra o processo correto.`,'warn');
      }
    }
    delete extracted.cambio_referencias; // tratado à parte acima, nunca vai pro loop genérico

    // Nº DUIMP (aba Financeiro, por parcela) — pedido do Ayslan (18/09/2026):
    // subiu o Extrato da DUIMP e o campo não foi preenchido porque ele é
    // por PARCELA (_parcelas[i].duimp_numero), não um input direto "f_..."
    // como os demais campos, então precisa de tratamento à parte aqui,
    // igual containers/câmbio acima. Espalha o número em toda parcela que
    // já tem câmbio fechado (cambio_fechado preenchido) e ainda não tem
    // Nº DUIMP — cobre o caso comum de uma DUIMP só valendo pro processo
    // inteiro, sem precisar adivinhar a qual parcela específica ela pertence.
    //
    // Pagamento ÚNICO (À Vista / 100% a Prazo / Entrada+Saldo) — Emanuelly,
    // 01/10/2026 (IMPAK-OID2605C, "estou importando a Duimp mas ele não está
    // puxando o nº da Duimp pra aba financeiro"): nesses casos não existe
    // parcela, o Nº DUIMP fica no campo do processo (f_pi_duimp_numero,
    // migration 0041). Então o número vai pro loop genérico abaixo com o nome
    // do campo da tela — se o campo já tiver outro valor, vira divergência
    // pro usuário decidir, igual aos demais campos.
    const formaPagamentoAtual = document.getElementById('f_pi_pagamento')?.value || '';
    if(extracted.duimp_numero && formaPagamentoAtual !== 'PARCELADO'){
      extracted.pi_duimp_numero = extracted.duimp_numero;
    } else if(extracted.duimp_numero && typeof _parcelas !== 'undefined' && Array.isArray(_parcelas) && _parcelas.length){
      let parcelasAtualizadas = 0;
      let jaTinha = 0;
      _parcelas.forEach(pc => {
        if(!pc) return;
        if(pc.duimp_numero) jaTinha++;
        else if(pc.cambio_fechado){
          pc.duimp_numero = extracted.duimp_numero;
          parcelasAtualizadas++;
        }
      });
      if(parcelasAtualizadas){
        if(typeof renderParcelas === 'function') renderParcelas();
        if(typeof sincronizarParcelasLegado === 'function') sincronizarParcelasLegado();
        preenchidos += parcelasAtualizadas;
        camposLidosNestaLeitura.push('duimp_numero');
      } else if(!jaTinha){
        // Parcelado sem nenhuma parcela com câmbio fechado: antes o número
        // sumia em silêncio e parecia que a leitura não tinha funcionado.
        showToast(`Nº DUIMP lido (${extracted.duimp_numero}), mas nenhuma parcela tem câmbio fechado — informe na parcela certa.`, 'warn');
      }
    }
    delete extracted.duimp_numero; // tratado à parte acima, nunca vai pro loop genérico

    // ── Tributos da DI/DUIMP → aba Custos Reais (15/10/2026, Bianca/Ayslan) ──
    // Os impostos vêm separados na DUIMP; no Conexos só aparecem somados na
    // prestação de contas do despachante. Preenche o "Pago" de II/IPI/PIS/
    // COFINS/Siscomex/Antidumping SÓ se o campo estiver vazio (ou se veio de
    // outra leitura de DUIMP) — nunca sobrescreve o que alguém lançou.
    if(extracted.di_tributos && typeof extracted.di_tributos === 'object'){
      const trib = {};
      // afrmm da DUIMP → item "marinha" (Marinha/AFRMM) dos Custos Reais
      [['ii','ii'],['ipi','ipi'],['pis','pis'],['cofins','cofins'],['siscomex','siscomex'],['antidumping','antidumping'],['afrmm','marinha']].forEach(([k, id]) => {
        const v = normNum(extracted.di_tributos[k]);
        if(v > 0) trib[id] = Math.round(v * 100) / 100;
      });
      if(Object.keys(trib).length && typeof crAplicarDuimp === 'function'){
        const r = crAplicarDuimp(trib);
        if(r.preenchidos){ preenchidos += r.preenchidos; camposLidosNestaLeitura.push('custos_reais_tributos'); }
        const nomes = { ii:'II', ipi:'IPI', pis:'PIS', cofins:'COFINS', siscomex:'Siscomex', antidumping:'Antidumping', marinha:'AFRMM' };
        if(r.preenchidos) showToast(`Tributos da DUIMP lançados em Custos Reais: ${r.ids.map(i=>nomes[i]).join(', ')}` + (r.mantidos.length ? ` (mantidos os já lançados: ${r.mantidos.map(i=>nomes[i]).join(', ')})` : ''), 'ok');
        else if(r.mantidos.length) showToast(`Tributos da DUIMP lidos, mas ${r.mantidos.map(i=>nomes[i]).join(', ')} já estavam lançados em Custos Reais — mantidos.`, 'warn');
      }
    }
    delete extracted.di_tributos;

    // ── Datas lidas com dia e mês trocados (18/10/2026) ──
    // A IA às vezes lê a data brasileira como americana (RIC ou NF de 03/04
    // lido como 04/03). Antes de preencher, as datas deste
    // documento são conferidas com as do processo (validacao-datas.js): se a
    // data lida é impossível e a versão com dia e mês trocados fecha, vale a
    // trocada; se nenhuma fecha, a data não é preenchida. Tudo fica avisado
    // na tela e anotado no Histórico desta leitura.
    const avisosDatasLidas = [], notasDatasLidas = [];
    // Datas confirmadas pelo texto impresso no documento (ver datas_texto
    // abaixo): a conferência nunca troca dia e mês delas.
    const semTrocaTexto = new Set();
    const dataBR = s => /^\d{4}-\d{2}-\d{2}/.test(String(s || '')) ? s.slice(8,10) + '/' + s.slice(5,7) + '/' + s.slice(0,4) : String(s || '');
    const rotuloDataLida = k => LABELS_CAMPOS_IA[k] || (typeof ValidacaoDatas !== 'undefined' && ValidacaoDatas.ROTULOS[k]) || k;
    const conferirDatasDoDocumento = (lidas, estado) => {
      if(typeof ValidacaoDatas === 'undefined' || !ValidacaoDatas.conferirDatasLidas || !Object.keys(lidas).length) return null;
      try{
        const r = ValidacaoDatas.conferirDatasLidas(lidas, estado, { semTroca: [...semTrocaTexto] });
        r.trocadas.forEach(t => { avisosDatasLidas.push(t.aviso); notasDatasLidas.push(`${rotuloDataLida(t.campo)} lida ${dataBR(t.lida)} → usada ${dataBR(t.usada)} (dia e mês trocados)`); });
        r.descartadas.forEach(d => { avisosDatasLidas.push(d.aviso); notasDatasLidas.push(`${rotuloDataLida(d.campo)} lida ${dataBR(d.lida)} não usada`); });
        return r;
      }catch(e){ console.warn('conferência das datas lidas:', e); return null; }
    };
    const tipoContainerTela = () => (typeof cargaEhLCLNaTela === 'function' && cargaEhLCLNaTela()) ? 'LCL' : (document.getElementById('f_tipo_container')?.value || '');
    const estadoDatasTela = () => {
      const e = {};
      ['etd','eta','data_embarque','data_chegada','data_presenca','data_carregamento','data_devolucao_vazio',
       'data_registro_di','data_liberacao','nf_entrada_data','nf_saida_data','ce_data_embarque','pi_data','ci_data']
        .forEach(k => { const el = document.getElementById('f_'+k); if(el && el.value) e[k] = el.value; });
      e.tipo_container = tipoContainerTela();
      e.containers_json = JSON.stringify(Array.isArray(_containers) ? _containers : []);
      return e;
    };

    // ── A data como está impressa no documento (18/10/2026, 2ª parte) ──
    // A IA devolve também, em datas_texto, cada data copiada sem conversão; o
    // sistema converte esse texto sozinho (ValidacaoDatas.lerDataTexto) — no
    // documento brasileiro (RIC, NF, DI/DUIMP, CE Mercante) a data é
    // dia/mês/ano. Quando o texto mostra que a IA inverteu dia e mês, vale a
    // data do texto. Quando o texto não deixa dúvida (ano na frente, mês por
    // extenso, dia acima de 12), a data fica protegida da troca automática da
    // conferência (semTrocaTexto). O texto sozinho nunca preenche um campo que
    // a IA deixou vazio.
    {
      const textos = (extracted.datas_texto && typeof extracted.datas_texto === 'object' && !Array.isArray(extracted.datas_texto)) ? extracted.datas_texto : {};
      const docBrasileiro = extracted.documento_brasileiro === true || extracted.documento_brasileiro === 'true' || !!extracted.eh_ric || pareceDiOuDuimp || ehCeMercante
        || !!(extracted.nf_entrada_numero || extracted.nf_entrada_data || extracted.nf_saida_numero || extracted.nf_saida_data);
      if(typeof ValidacaoDatas !== 'undefined' && ValidacaoDatas.lerDataTexto){
        Object.keys(textos).forEach(k => {
          try{
            if(!ValidacaoDatas.ehCampoData(k) || typeof textos[k] !== 'string') return;
            const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(extracted[k] || '').trim());
            if(!m) return;
            const lida = m[0], impresso = textos[k].trim().slice(0, 40);
            const t = ValidacaoDatas.lerDataTexto(impresso, { diaPrimeiro: docBrasileiro ? true : undefined });
            if(!t || !t.data) return; // texto sem data, data inexistente ou dia/mês ambíguo num documento do exterior
            if(t.data === lida){ if(!t.ambigua) semTrocaTexto.add(k); return; }
            if(t.data === ValidacaoDatas.trocarDiaMes(lida)){
              extracted[k] = t.data;
              if(!t.ambigua) semTrocaTexto.add(k);
              avisosDatasLidas.push(`${rotuloDataLida(k)}: o documento traz "${impresso}"${t.ambigua ? ' (dia/mês/ano)' : ''} — usei ${dataBR(t.data)}, não ${dataBR(lida)}. Confira.`);
              notasDatasLidas.push(`${rotuloDataLida(k)} lida ${dataBR(lida)} → ${dataBR(t.data)} pelo texto impresso ("${impresso}")`);
              return;
            }
            // Texto e data lida não batem nem com dia e mês trocados: fica a
            // data lida (a conferência abaixo ainda vale para ela) com aviso.
            avisosDatasLidas.push(`${rotuloDataLida(k)} lida como ${dataBR(lida)}, mas o texto copiado do documento é "${impresso}" — confira no documento.`);
            notasDatasLidas.push(`${rotuloDataLida(k)} lida ${dataBR(lida)} não bate com o texto impresso ("${impresso}")`);
          }catch(e){ console.warn('texto da data lida:', k, e); }
        });
      }
    }
    delete extracted.datas_texto; delete extracted.documento_brasileiro;

    // ── Número de container normalizado (25/09/2026, RIC da UD26-047) ──
    // Alguns documentos escrevem o container com espaço/hífen antes do
    // dígito verificador ("PIDU 452832-3"); no processo ele está como
    // "PIDU4528323". Comparar sem normalizar fazia o sistema achar que era
    // um container NOVO e adicioná-lo à lista.
    const normCont = v => String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(Array.isArray(extracted.containers)) extracted.containers.forEach(c=>{ if(c && c.numero) c.numero = normCont(c.numero); });

    // ── RIC / EIR de devolução do vazio ──
    // O RIC nunca cria container: só registra a devolução (data + depot) do
    // container que JÁ está no processo. Com 2+ containers, a data vai para
    // o container certo (aba Demurrage por container); com 1, para os campos
    // normais. Se o container do RIC não for deste processo, avisa e não
    // aplica nada.
    if(extracted.eh_ric){
      const itensRic = (extracted.containers||[]).filter(c=>c && c.numero);
      const devolRic = extracted.data_devolucao_vazio || '';
      const depotRic = extracted.depot || '';
      // RIC com avaria/lavagem → Status RIC "Termo" (pedido do Ayslan,
      // 25/09/2026). Só preenche se o status ainda estiver vazio — nunca
      // troca um "Isento"/"Parcial Isento" já decidido.
      const statusRic = extracted.ric_avaria ? 'Termo' : '';
      const achados = [], faltando = [];
      itensRic.forEach(it=>{
        const i = _containers.findIndex(c => normCont(c.numero) === it.numero);
        if(i >= 0) achados.push(i); else faltando.push(it.numero);
      });
      const temContainerCadastrado = _containers.some(c => c && c.numero);
      if(faltando.length && temContainerCadastrado){
        showToast(`⚠️ RIC do container ${faltando.join(', ')} — esse container não está neste processo (${_containers.filter(c=>c.numero).map(c=>c.numero).join(', ')}). Nada foi alterado.`, 'warn');
      }
      if(_containers.length > 1){
        // Data do RIC conferida com a chegada do processo (dia e mês
        // trocados, ver acima). Por container não há data de carregamento.
        let devolUsar = devolRic;
        if(devolRic && achados.length){
          const rDev = conferirDatasDoDocumento({ data_devolucao_vazio: devolRic },
            { data_chegada: document.getElementById('f_data_chegada')?.value || '', tipo_container: tipoContainerTela() });
          if(rDev) devolUsar = rDev.datas.data_devolucao_vazio || '';
        }
        achados.forEach(i=>{
          if(devolUsar) _containers[i].devolucao = devolUsar;
          if(statusRic && !_containers[i].ric_status) _containers[i].ric_status = statusRic;
          if(depotRic && !_containers[i].depot) _containers[i].depot = depotRic;
        });
        if(achados.length){
          if(typeof renderDemurrageContainers === 'function') renderDemurrageContainers();
          preenchidos += achados.length;
          if(devolUsar) camposLidosNestaLeitura.push('data_devolucao_vazio');
        }
        delete extracted.data_devolucao_vazio; delete extracted.depot;
      } else if(faltando.length && temContainerCadastrado){
        delete extracted.data_devolucao_vazio; delete extracted.depot;
      } else if(!itensRic.length && temContainerCadastrado && _containers.filter(c=>c.numero).length > 1){
        delete extracted.data_devolucao_vazio; delete extracted.depot;
      }
      // Processo com 1 container: Status RIC vai no campo normal.
      if(statusRic && _containers.length <= 1 && !(faltando.length && temContainerCadastrado)){
        const selRic = document.getElementById('f_ric_status');
        if(selRic && !selRic.value){ selRic.value = statusRic; preenchidos++; camposLidosNestaLeitura.push('ric_status'); try{ marcarComoIA('ric_status'); }catch(e){} }
      }
      // Um RIC não cria/edita containers e não mexe em outros dados do processo.
      extracted.containers = [];
      ['container','lacre','armador','transportadora','navio','cliente','referencia','consignatario','notify'].forEach(k=>delete extracted[k]);
    }
    delete extracted.eh_ric; delete extracted.ric_avaria;

    // Datas deste documento conferidas juntas, antes de preencher (dia e mês
    // trocados, ver acima). Fora da DI a chegada lida é só previsão e vai
    // para o ETA (o loop abaixo fazia isso no próprio campo) — passa para o
    // ETA já aqui, para ser conferida como ETA.
    if(!ehDI && extracted.data_chegada){
      extracted.eta = extracted.data_chegada; delete extracted.data_chegada;
      if(semTrocaTexto.has('data_chegada')) semTrocaTexto.add('eta'); else semTrocaTexto.delete('eta');
    }
    // DI/DUIMP registrada antes da atracação traz a chegada ainda no futuro:
    // é a previsão — vai para o ETA (como quando alguém digita uma chegada
    // futura, ver moverDataFuturaParaPrevisao) e não passa pela troca de dia
    // e mês, porque nesse caso a data futura é legítima.
    if(ehDI && extracted.data_chegada && typeof ValidacaoDatas !== 'undefined' && ValidacaoDatas.noFuturo && ValidacaoDatas.noFuturo(extracted.data_chegada)){
      const cheg = String(extracted.data_chegada).slice(0, 10);
      if(!extracted.eta) extracted.eta = cheg;
      avisosDatasLidas.push(`Data de Chegada lida como ${dataBR(cheg)} ainda não aconteceu (DI/DUIMP registrada antes da atracação) — ${extracted.eta === cheg ? 'preenchi o ETA (previsão de chegada)' : 'não preenchi'}. Se a carga já chegou, confira a data no documento.`);
      notasDatasLidas.push(`Data de Chegada lida ${dataBR(cheg)} (futura) ${extracted.eta === cheg ? 'foi para o ETA' : 'não usada'}`);
      delete extracted.data_chegada;
    }
    // CE Mercante: a "Data Embarque (CE)" e a Data de Embarque efetiva são a
    // mesma data do documento (22/10/2026, Emanuelly: a leitura do CE às vezes
    // devolvia só uma das duas e a "Data Embarque (CE)" ficava vazia). Uma
    // completa a outra; a conferência de datas logo abaixo vale para as duas.
    if(ehCeMercante && !pareceDiOuDuimp){
      if(!extracted.ce_data_embarque && extracted.data_embarque){
        extracted.ce_data_embarque = extracted.data_embarque;
        if(semTrocaTexto.has('data_embarque')) semTrocaTexto.add('ce_data_embarque');
      } else if(extracted.ce_data_embarque && !extracted.data_embarque){
        extracted.data_embarque = extracted.ce_data_embarque;
        if(semTrocaTexto.has('ce_data_embarque')) semTrocaTexto.add('data_embarque');
      }
    }
    // Data EFETIVA de embarque (TVN2511A, 20/10/2026: a leitura nunca
    // preenchia — o embarque da DI ia para o ETD e o do CE só para
    // "Data embarque (CE)"). Só vale de documento que comprova o embarque:
    // BL, CE Mercante ou DI/DUIMP. Em PI, CI, packing list ou booking a data
    // é previsão e vai para o ETD; embarque no futuro também é previsão.
    if(extracted.data_embarque){
      const emb = String(extracted.data_embarque).slice(0, 10);
      const comprovaEmbarque = ehBlOuDi || ehCeMercante || ehDI;
      const embFuturo = typeof ValidacaoDatas !== 'undefined' && ValidacaoDatas.noFuturo && ValidacaoDatas.noFuturo(emb);
      if(!comprovaEmbarque || embFuturo){
        if(!extracted.etd) extracted.etd = emb;
        if(semTrocaTexto.has('data_embarque')) semTrocaTexto.add('etd');
        notasDatasLidas.push(`Data de Embarque lida ${dataBR(emb)} ${embFuturo ? '(ainda não aconteceu)' : '(este documento não comprova o embarque)'} ${extracted.etd === emb ? 'foi para o ETD (previsão)' : 'não usada'}`);
        delete extracted.data_embarque;
      }
    }
    {
      const lidas = {};
      Object.keys(extracted).forEach(k => {
        const v = extracted[k];
        if(v && typeof v === 'string' && typeof ValidacaoDatas !== 'undefined' && ValidacaoDatas.ehCampoData(k)) lidas[k] = v;
      });
      const rDatas = conferirDatasDoDocumento(lidas, estadoDatasTela());
      if(rDatas){
        // datas = as que podem ser usadas (já trocadas e só com a data, sem hora)
        Object.keys(rDatas.datas).forEach(k => { extracted[k] = rDatas.datas[k]; });
        rDatas.descartadas.forEach(d => { delete extracted[d.campo]; });
      }
    }

    // % de adiantamento dos termos de pagamento: não é um input direto do
    // formulário — aplicado nas parcelas depois de renderPagamentoCampos().
    const pctAdiantamentoDoc = extracted.pi_adiantamento_pct || 0;
    delete extracted.pi_adiantamento_pct;

    // Conferência final antes de mexer no formulário (houve outras esperas acima:
    // cadastro do fornecedor, contato pelo CNPJ).
    if(painelTrocouNaLeitura()){
      if(status) status.textContent = '';
      showToast(`A leitura de ${file.name} terminou depois que o processo foi fechado ou trocado — nada foi preenchido.`, 'warn', 10000);
      return;
    }

    // Preencher campos do formulário
    const camposMoedaIA = ['pi_valor_usd','ci_valor_usd','demurrage_valor','nf_entrada_valor','nf_saida_valor','valor_frete','di_peso_liquido','di_valor_aduaneiro'];
    const camposContainerTratadosSeparado = ['container','lacre']; // ver bloco de _containers abaixo
    // camposIA (ver abrirNovo/abrirProcesso) guarda quais campos a última
    // leitura de IA preencheu NESTA sessão — se o campo já tiver um valor mas
    // veio da própria IA (não foi digitado pelo usuário), uma leitura nova
    // pode corrigi-lo. Ex.: documento errado preenche "fornecedor" errado →
    // usuário percebe e sobe o documento certo → agora corrige normalmente,
    // em vez de ficar bloqueado pela regra "só preenche vazio". Se o usuário
    // tiver editado esse campo manualmente nesse meio tempo, o listener de
    // 'input' em fecharModal() já removeu o campo daqui, então ele volta a
    // ficar protegido como sempre foi.
    if(!_editando._camposIA) _editando._camposIA = {};
    const foiPreenchidoPorIA = campo => !!_editando._camposIA[campo];
    const alteracoesPeloDocumento = [];
    const marcarComoIA = campo => { _editando._camposIA[campo] = true; camposLidosNestaLeitura.push(campo); };

    Object.keys(extracted).forEach(campo=>{
      let val = extracted[campo];
      if(!val) return;
      if(camposContainerTratadosSeparado.includes(campo)) return;
      const el = document.getElementById('f_'+campo);
      if(!el) return;
      if(camposMoedaIA.includes(campo)) val = exibirMoeda(val);
      // Campos específicos de um tipo de documento (ex: CE Master/House só
      // existem num CE Mercante) não podem ser sobrescritos por uma leitura de
      // IA de um documento de OUTRO tipo, mesmo que já tenham sido preenchidos
      // pela IA antes nesta sessão — antes, foiPreenchidoPorIA(campo) sozinho
      // liberava a sobrescrita por QUALQUER leitura seguinte, então ler uma
      // DUIMP/DI depois de ler um CE Mercante no mesmo processo podia apagar ou
      // trocar CE Master/House com um valor mal interpretado do documento de DI
      // (que não é CE Mercante e não deveria mexer nesses campos).
      const camposRestritosATipoDoc = ['ce_master','ce_house','ce_data_embarque'];
      const restritoEBloqueado = camposRestritosATipoDoc.includes(campo) && !ehCeMercante;
      const podeSobrescrever = !restritoEBloqueado && (camposSobrescritosPorCe.includes(campo) || camposSobrescritosPorBlDi.includes(campo) || camposSobrescritosPorPI.includes(campo) || camposSobrescritosPorCI.includes(campo) || foiPreenchidoPorIA(campo));
      // Porto Destino é <select> agora — não aceita texto livre direto.
      // Normaliza pro código (ITJ/IOA/NVT) e, se não bater com nenhum,
      // reconstrói as opções incluindo o valor extraído como fallback
      // visível (em vez de falhar silenciosamente sem selecionar nada).
      if(campo==='porto_destino'){
        if(!el.value || podeSobrescrever){
          const normalizado = normalizarPortoDestino(val);
          if(!PORTOS_DESTINO.some(p=>p.codigo===normalizado)) el.innerHTML = gerarOptionsPortoDestino(normalizado);
          else el.value = normalizado;
          el.style.borderColor='var(--ok)'; el.style.background='rgba(22,163,74,.04)';
          preenchidos++; marcarComoIA(campo);
          setTimeout(()=>{ el.style.borderColor=''; el.style.background=''; }, 3000);
        } else {
          const normalizado = normalizarPortoDestino(val);
          registrarConflito(campo, el, normalizado, formatarPortoDestino(normalizado), () => {
            if(!PORTOS_DESTINO.some(p=>p.codigo===normalizado)) el.innerHTML = gerarOptionsPortoDestino(normalizado);
            else el.value = normalizado;
          }, formatarPortoDestino(el.value));
        }
        return;
      }
      if(campo==='porto_origem'){
        // "QINGDAO, CHINA" é o mesmo porto que "QINGDAO" (06/10/2026).
        const semPais = portoSemPais(val);
        if(PORTOS_ORIGEM.includes(semPais)) val = semPais;
        const atualPorto = el.value === 'OUTRO' ? (document.getElementById('f_porto_origem_outro')?.value || '') : el.value;
        if(el.value && portoSemPais(atualPorto) === semPais) return;
        if(!el.value || podeSobrescrever){
          const vu = val.trim().toUpperCase();
          const outro = document.getElementById('f_porto_origem_outro');
          if(PORTOS_ORIGEM.includes(vu)){
            el.value = vu;
            if(outro) outro.style.display = 'none';
          } else {
            el.value = 'OUTRO';
            if(outro){ outro.value = val; outro.style.display = 'block'; }
          }
          el.style.borderColor='var(--ok)'; el.style.background='rgba(22,163,74,.04)';
          preenchidos++; marcarComoIA(campo);
          setTimeout(()=>{ el.style.borderColor=''; el.style.background=''; }, 3000);
        } else {
          const vu = val.trim().toUpperCase();
          const outro = document.getElementById('f_porto_origem_outro');
          const valorAtualExibicao = el.value==='OUTRO' ? (outro?.value || 'OUTRO') : el.value;
          registrarConflito(campo, el, vu, val, () => {
            if(PORTOS_ORIGEM.includes(vu)){
              el.value = vu;
              if(outro) outro.style.display = 'none';
            } else {
              el.value = 'OUTRO';
              if(outro){ outro.value = val; outro.style.display = 'block'; }
            }
          }, valorAtualExibicao);
        }
        return;
      }
      if(campo==='data_chegada'){
        if(ehDI){
          if(!el.value || podeSobrescrever){
            el.value = val;
            el.style.borderColor='var(--ok)'; el.style.background='rgba(22,163,74,.04)';
            preenchidos++; marcarComoIA(campo);
            setTimeout(()=>{ el.style.borderColor=''; el.style.background=''; }, 3000);
          } else {
            registrarConflito(campo, el, val);
          }
        } else {
          const elEta = document.getElementById('f_eta');
          if(elEta){
            if(!elEta.value || foiPreenchidoPorIA('eta')){
              elEta.value = val;
              elEta.style.borderColor='var(--ok)'; elEta.style.background='rgba(22,163,74,.04)';
              preenchidos++; marcarComoIA('eta');
              setTimeout(()=>{ elEta.style.borderColor=''; elEta.style.background=''; }, 3000);
            } else {
              registrarConflito('eta', elEta, val);
            }
          }
        }
        return;
      }
      if(!el.value || podeSobrescrever){
        // Valor que já estava e foi TROCADO pelo documento (06/10/2026,
        // PF BR26R142: a forma de pagamento mudava sem ninguém perceber).
        const textoCampo = e => e.tagName === 'SELECT' ? ((e.options[e.selectedIndex] || {}).text || e.value) : e.value;
        const antesVal = el.value, antesTxt = antesVal ? textoCampo(el) : '';
        el.value = val;
        if(antesVal && String(antesVal) !== String(el.value)){
          alteracoesPeloDocumento.push({ campo, label: LABELS_CAMPOS_IA[campo] || campo, antes: antesTxt, depois: textoCampo(el) });
        }
        el.style.borderColor='var(--ok)';
        el.style.background='rgba(22,163,74,.04)';
        preenchidos++; marcarComoIA(campo);
        setTimeout(()=>{ el.style.borderColor=''; el.style.background=''; }, 3000);
      } else {
        registrarConflito(campo, el, val);
      }
    });

    // O campo "container" (e o novo "lacre") extraídos pela IA precisam ser
    // refletidos na LISTA VISUAL de containers (_containers), não só no
    // input hidden f_container — senão a extração "preenche" um campo que
    // o usuário nunca vê na tela, e o container/lacre parecem não ter sido
    // lidos. Só populamos automaticamente se a lista ainda estiver vazia
    // (1 container sem número), para não sobrescrever o que o usuário já
    // tiver preenchido manualmente — exceto quando vem de BL/DI, que é mais
    // confiável e pode corrigir um container errado de um documento anterior.
    let listaContainersExtraidos = [];
    if(Array.isArray(extracted.containers) && extracted.containers.length){
      listaContainersExtraidos = extracted.containers
        .filter(x => x && x.numero)
        .map(x => ({numero: normCont(x.numero), lacre: x.lacre ? String(x.lacre).trim() : ''}));
    } else if(extracted.container){
      // Fallback defensivo pro formato antigo (string única) — caso a IA ainda devolva
      // vários números concatenados numa string só (ex: documento com 2+ containers).
      const numsPart = String(extracted.container).split(/[,;\/]+/).map(s => s.trim()).filter(Boolean);
      const lacresPart = extracted.lacre ? String(extracted.lacre).split(/[,;\/]+/).map(s => s.trim()).filter(Boolean) : [];
      listaContainersExtraidos = numsPart.map((numero, i) => ({numero: normCont(numero), lacre: lacresPart[i] || ''}));
    }
    if(listaContainersExtraidos.length){
      listaContainersExtraidos.forEach(item => {
        const numNovo = item.numero.toUpperCase();
        const idxExistente = _containers.findIndex(c => c.numero && normCont(c.numero) === normCont(numNovo));
        if(idxExistente !== -1){
          // Mesmo container já estava na lista (re-leitura do mesmo documento, ou
          // outro documento confirmando o mesmo container) — só completa o lacre.
          if(item.lacre && !_containers[idxExistente].lacre) _containers[idxExistente].lacre = item.lacre;
        } else {
          const primeiroVazio = !_containers.length || (!_containers[0].numero);
          if(primeiroVazio){
            if(!_containers.length) _containers.push({numero:'', tipo:'40HC', lacre:''});
            _containers[0].numero = item.numero;
            if(item.lacre) _containers[0].lacre = item.lacre;
          } else {
            // Já existe container diferente cadastrado — em processo multi-container,
            // cada documento novo (ou cada linha da tabela do mesmo documento) pode
            // revelar um container adicional. Adiciona em vez de sobrescrever.
            // Carga LCL (05/10/2026): container novo herda o tipo LCL, senão o
            // processo deixaria de ser LCL e voltaria a cobrar devolução.
            const tipoNovo = (typeof cargaEhLCLNaTela === 'function' && cargaEhLCLNaTela()) ? 'LCL' : '40HC';
            _containers.push({numero: item.numero, tipo: tipoNovo, lacre: item.lacre || ''});
          }
        }
      });
      renderMultiContainers();
      preenchidos++; marcarComoIA('container');
    }

    // ── Valor da CI diferente do valor da PI (Ayslan, 06/10/2026): "se o
    // valor da PI está 20 mil USD e na CI veio 19.900, tem que perguntar —
    // às vezes são negociações e descontos; não pode ficar só o valor da PI
    // e não mudar nunca". Pergunta se o valor do processo passa a ser o da CI.
    if(ehCI && extracted.ci_valor_usd){
      const elPi = document.getElementById('f_pi_valor_usd');
      const valorPi = typeof valorMoeda === 'function' ? (valorMoeda('f_pi_valor_usd') || 0) : 0;
      const valorCi = Number(extracted.ci_valor_usd) || 0;
      if(elPi && valorPi > 0 && valorCi > 0 && Math.abs(valorPi - valorCi) >= 0.01){
        const dif = valorCi - valorPi;
        const fmt = v => 'US$ ' + Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
        conflitos.push({
          campo: 'pi_valor_usd',
          label: 'Valor do processo (USD) — PI × CI',
          valorAtual: fmt(valorPi),
          valorNovo: fmt(valorCi),
          aplicar: () => { elPi.value = exibirMoeda(valorCi); },
          padrao: 'novo',
          motivo: `A CI veio ${dif < 0 ? 'menor' : 'maior'} que a PI em ${fmt(Math.abs(dif))} (${(Math.abs(dif)/valorPi*100).toLocaleString('pt-BR',{maximumFractionDigits:2})}%). Desconto ou renegociação? Se usar o valor da CI, o Valor USD do processo passa a ser ${fmt(valorCi)}.`,
        });
      }
    }

    const sufixoConflitos = conflitos.length ?` — ⚠ ${conflitos.length} divergência(s) aguardando revisão` : '';
    if(status) status.textContent = (abriuModalCambio
      ? `💱 Comprovante de câmbio lido — confirme no modal a qual parcela pertence`
      : ehCeMercante
      ? `✓ ${preenchidos} campos preenchidos (CE Mercante — navio de chegada atualizado)`
      : ehBlOuDi ? `✓ ${preenchidos} campos preenchidos (BL/DI — porto e container atualizados)`
      : ehCI ? `✓ ${preenchidos} campos preenchidos (CI — dados finais${itensSubstituidosPelaCI ? ': itens e quantidades da CI substituíram os da PI' : ''})`
      : ehPI ? `✓ ${preenchidos} campos preenchidos (PI — data e valor USD atualizados)`
      : `✓ ${preenchidos} campos preenchidos`) + sufixoConflitos;
    const listaAlteracoes = alteracoesPeloDocumento.map(a => `${a.label}: ${a.antes} → ${a.depois}`);
    const sufixoDatas = avisosDatasLidas.length ? ` — ⚠ ${avisosDatasLidas.length} data(s) conferida(s), veja abaixo` : '';
    const sufixoCe = avisosNumerosIguais.length ? ' — ⚠ ' + notasNumerosIguais.join(' e ').replace(/ não usado/g, ' não preenchido') + ', veja abaixo' : '';
    if(!abriuModalCambio) showToast(`IA preencheu ${preenchidos} campos automaticamente${sufixoConflitos}${sufixoDatas}${sufixoCe}` + (listaAlteracoes.length ? ` — alterado: ${listaAlteracoes.join('; ')}` : ''), (conflitos.length || listaAlteracoes.length || avisosDatasLidas.length || avisosNumerosIguais.length) ? 'warn' : 'ok');
    if(status && avisosNumerosIguais.length && !abriuModalCambio){
      const box = document.createElement('div');
      box.className = 'ia-numeros-iguais';
      box.setAttribute('role', 'alert');
      box.style.cssText = 'margin-top:6px;padding:8px 10px;border:1px solid var(--warn,#d97706);border-radius:6px;background:rgba(217,119,6,.06);font-size:12px;line-height:1.5';
      box.innerHTML = '<strong>Números repetidos no documento</strong>:<br>' + avisosNumerosIguais.map(a => esc(a)).join('<br>');
      status.appendChild(box);
    }
    if(status && listaAlteracoes.length && !abriuModalCambio){
      const box = document.createElement('div');
      box.className = 'ia-alteracoes';
      box.style.cssText = 'margin-top:6px;padding:8px 10px;border:1px solid var(--warn,#d97706);border-radius:6px;background:rgba(217,119,6,.06);font-size:12px;line-height:1.5';
      box.innerHTML = '<strong>Alterado pelo documento</strong> (confira antes de salvar):<br>' +
        alteracoesPeloDocumento.map(a => `${esc(a.label)}: <s style="opacity:.7">${esc(a.antes)}</s> → <strong>${esc(a.depois)}</strong>`).join('<br>');
      status.appendChild(box);
    }
    if(status && avisosDatasLidas.length && !abriuModalCambio){
      const box = document.createElement('div');
      box.className = 'ia-datas-conferidas';
      box.setAttribute('role', 'alert');
      box.style.cssText = 'margin-top:6px;padding:8px 10px;border:1px solid var(--warn,#d97706);border-radius:6px;background:rgba(217,119,6,.06);font-size:12px;line-height:1.5';
      box.innerHTML = '<strong>Datas conferidas</strong> (a leitura pode ter trocado dia e mês):<br>' + avisosDatasLidas.map(a => esc(a)).join('<br>');
      status.appendChild(box);
    }

    // Preenchimento programático não dispara onchange/oninput dos campos —
    // por isso a regra de parametrização e o recálculo de fase/demurrage
    // precisam ser chamados manualmente aqui. O mesmo vale pro campo "Forma
    // de Pagamento" (f_pi_pagamento): setar .value direto NÃO dispara seu
    // onchange="renderPagamentoCampos()", então quando a IA lê uma PI e
    // preenche "100% a Prazo" o <select> mostra a opção certa mas o campo
    // "Prazo (dias)" (e Data Pagamento) nunca aparecia — precisa chamar de
    // novo aqui manualmente, senão o formulário fica com dado "invisível".
    aplicarRegraParametrizacaoVerde();
    atualizarFaseEmTempoReal();
    if(extracted.pi_pagamento) renderPagamentoCampos();
    // Aviso fixo junto da Forma de Pagamento quando a leitura a trocou.
    {
      const alt = alteracoesPeloDocumento.find(a => a.campo === 'pi_pagamento');
      const sel = document.getElementById('f_pi_pagamento');
      if(alt && sel && sel.parentNode){
        let av = document.getElementById('pi-pagamento-aviso-ia');
        if(!av){ av = document.createElement('div'); av.id = 'pi-pagamento-aviso-ia'; sel.parentNode.appendChild(av); }
        av.style.cssText = 'margin-top:4px;font-size:11.5px;color:var(--warn,#b45309)';
        av.textContent = `Alterado pela leitura de ${file.name}: era "${alt.antes}". Confira antes de salvar.`;
        sel.style.borderColor = 'var(--warn,#d97706)';
      }
    }
    // Embarque efetivo lido agora num 100% a Prazo com prazo em dias: o
    // vencimento conta do embarque (regra #413), igual a quando se digita a
    // data — só calcula se a Data Pagamento ainda estiver vazia.
    if(document.getElementById('f_pi_pagamento')?.value === 'PRAZO' && camposLidosNestaLeitura.includes('data_embarque')
       && !document.getElementById('f_pi_data_saldo')?.value && typeof atualizarDataPagamentoPrazo === 'function'){
      atualizarDataPagamentoPrazo();
    }
    // 100% a Prazo: "N days after B/L" vai pro Prazo (dias), que conta do
    // embarque; sem prazo em dias o vencimento fica Chegada/ETA - 10 dias.
    if(document.getElementById('f_pi_pagamento')?.value === 'PRAZO'){
      const inpPrazo = document.getElementById('f_pi_prazo_dias');
      if(_prazoDiasTermos && inpPrazo && !inpPrazo.value){
        inpPrazo.value = String(_prazoDiasTermos);
        if(typeof atualizarDataPagamentoPrazo === 'function') atualizarDataPagamentoPrazo();
        camposLidosNestaLeitura.push('pi_prazo_dias');
        preenchidos++;
      } else if(typeof atualizarVencimentoSaldoPorETA === 'function'){
        atualizarVencimentoSaldoPorETA();
      }
    }

    // Parcelado (05/10/2026, processos 26DTPI0476-x): o % de entrada lido dos termos de
    // pagamento vai pro campo "% Entrada (PI)" e refaz a Inicial (se ainda sem
    // câmbio) e o saldo; uma CI lida com valor novo faz o saldo fechar com ela.
    if(document.getElementById('f_pi_pagamento')?.value === 'PARCELADO'){
      const inpPct = document.getElementById('f_pi_entrada_pct');
      if(pctAdiantamentoDoc && inpPct && String(inpPct.value) !== String(pctAdiantamentoDoc)){
        inpPct.value = String(pctAdiantamentoDoc);
        if(typeof aplicarPctEntradaParcelas === 'function') aplicarPctEntradaParcelas({ origem: 'documento' });
        camposLidosNestaLeitura.push('pi_entrada_pct');
        preenchidos++;
      } else if(camposLidosNestaLeitura.includes('ci_valor_usd') && typeof aoMudarValorCI === 'function'){
        aoMudarValorCI();
      }
    }

    // Atualizar _editando com os valores extraídos
    if(_editando) Object.assign(_editando, extracted);

    // Se sobrou alguma divergência sem regra automática de prioridade,
    // abre o pop-up de revisão — só interrompe o fluxo quando existe algo
    // de fato pra decidir (a maioria das leituras não vai ter nenhuma).
    if(conflitos.length){
      const tipoDocLido = ehCI ? 'CI — Commercial Invoice' : ehPI ? 'PI — Proforma' : ehCeMercante ? 'CE Mercante' : ehDI ? 'DI/DUIMP' : ehBlOuDi ? 'BL' : '';
      abrirModalConflitosIA(conflitos, file.name, tipoDocLido);
    }

    // Salva automaticamente no GED do processo o documento que acabou de ser
    // lido pela IA — antes disso, o único jeito de guardar o arquivo era um
    // upload manual separado na aba GED, então o documento usado pra extrair
    // os dados quase nunca ficava de fato anexado ao processo. Reaproveita
    // uploadArquivosGed() (mesma validação/limite/endpoint do upload manual).
    // Só roda se o processo já tiver id (já foi salvo ao menos uma vez) —
    // num processo novo ainda não salvo, o arquivo fica de fora do GED por
    // enquanto (evita um toast de aviso logo após o sucesso da extração);
    // o usuário anexa manualmente depois de salvar, como já era possível.
    // Registra no Histórico do processo qual documento foi lido pela IA e
    // quais campos ela preencheu a partir dele -- fica junto do log de
    // auditoria de alterações normal (mesma tabela controle_log), só com um
    // "campo" especial que o carregarHistorico() sabe renderizar de forma
    // diferente (não é "alterou X: antes → depois", é "leu o documento").
    if(_editando && (camposLidosNestaLeitura.length || notasDatasLidas.length)){
      const camposUnicos = [...new Set(camposLidosNestaLeitura)];
      const rotulo = campo => LABELS_CAMPOS_IA[campo] || campo;
      // Datas trocadas/não usadas vão no fim, num item só (sem ", " dentro —
      // origemDoValorAtual() separa os campos lidos por ", ").
      const itensLog = camposUnicos.map(rotulo);
      if(notasDatasLidas.length) itensLog.push('Datas conferidas: ' + notasDatasLidas.join('; ').replace(/, /g, ' '));
      notasNumerosIguais.forEach(n => itensLog.push(n));
      _editando.log = _editando.log || [];
      _editando.log.push({
        campo: LOG_CAMPO_LEITURA_IA,
        valor_antes: file.name,
        valor_depois: itensLog.join(', '),
        usuario: _user.usuario,
        created_at: new Date().toISOString(),
      });
    }

    if(_editando && _editando.id){
      uploadArquivosGed([file]);
    }

  } catch(e){
    if(status) status.textContent = '❌ Erro: '+e.message;
    showToast('Erro na extração: '+e.message,'err');
  }
}

// ════════════════════════════════════════════════════════════════
// EDIÇÃO RÁPIDA INLINE
// ════════════════════════════════════════════════════════════════
function inlineEditData(id, campo, el){
  const proc = _processos.find(p=>p.id===id);
  if(!proc) return;
  const valorAtual = proc[campo]||'';
  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'inline-input';
  input.value = valorAtual;
  input.style.width = '130px';
  el.innerHTML = '';
  el.appendChild(input);
  input.focus();
  // O blur dispara de novo quando o confirm() abaixo tira o foco do campo ou
  // quando render() remove o campo: só a primeira vez vale.
  let feito = false;
  function salvar(){
    if(feito) return;
    feito = true;
    const novoValor = input.value;
    if(novoValor !== valorAtual){
      // Mesmas regras de data do painel (validacao-datas.js; o servidor confere
      // de novo): data impossível não grava, data improvável pergunta antes.
      if(typeof ValidacaoDatas !== 'undefined'){
        const probs = ValidacaoDatas.validar(Object.assign({}, proc, { [campo]: novoValor || null }), { campos: [campo] });
        const errosDatas = ValidacaoDatas.erros(probs), avisosDatas = ValidacaoDatas.avisos(probs);
        if(errosDatas.length){
          showToast('Data impossível — nada foi salvo: ' + errosDatas.map(e => e.msg).join(' '), 'err');
          render();
          return;
        }
        if(avisosDatas.length && !confirm('Confira as datas antes de salvar:\n\n' + avisosDatas.map(a => '• ' + a.msg).join('\n') + '\n\nSalvar mesmo assim?')){
          render();
          return;
        }
      }
      const antes = proc[campo];
      proc[campo] = novoValor||null;
      // Log
      proc.log = proc.log||[];
      proc.log.push({campo, valor_antes:antes||'', valor_depois:novoValor||'', usuario:_user.usuario, created_at:new Date().toISOString()});
      // Edição rápida inline: só este campo mudou de fato — manda só ele
      // (ver nota de concorrência em salvarProcesso/coletarESalvar). "proc"
      // aqui vem do cache local (_processos), que pode estar levemente
      // desatualizado em relação ao servidor; sem isso, salvar essa edição
      // rápida sobrescreveria com esse cache velho qualquer campo que outra
      // pessoa tivesse alterado nesse meio tempo.
      salvarProcesso(proc, [campo]);
    }
    render();
  }
  input.addEventListener('blur', salvar);
  // Esc desiste da edição — e um blur que venha depois (render() remove o campo) não grava.
  input.addEventListener('keydown', e=>{ if(e.key==='Enter') input.blur(); if(e.key==='Escape'){ feito = true; proc[campo]=valorAtual; render(); } });
}

function inlineEditFase(id, el){
  const proc = _processos.find(p=>p.id===id);
  if(!proc) return;
  const sel = document.createElement('select');
  sel.className = 'inline-select';
  FASES.forEach(f=>{
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.icon+' '+f.label;
    if(f.id===proc.fase) opt.selected = true;
    sel.appendChild(opt);
  });
  el.innerHTML='';
  el.appendChild(sel);
  sel.focus();
  function salvar(){
    const novaFase = sel.value;
    if(novaFase !== proc.fase){
      proc.log = proc.log||[];
      proc.log.push({campo:'fase', valor_antes:proc.fase, valor_depois:novaFase, usuario:_user.usuario, created_at:new Date().toISOString()});
      proc.fase = novaFase;
      // Override manual de fase — só esse campo. Ver nota em inlineEditData.
      salvarProcesso(proc, ['fase']);
    }
    render();
  }
  sel.addEventListener('change', salvar);
  sel.addEventListener('blur', ()=>render());
}

// ════════════════════════════════════════════════════════════════
// DASHBOARD FINANCEIRO
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
// DASHBOARD EXECUTIVO
// ════════════════════════════════════════════════════════════════


// Fila de processamento: processa varios arquivos, um de cada vez, reaproveitando extrairComIA_umArquivo
// Arquivo de OUTRO processo (Emanuelly 13/10/2026): ao ler os docs do
// UD26-123/124 vinham junto OHBL_UD26-117.pdf e CE_..._UD26-117.pdf (seleção
// pegando arquivos de outra pasta/Recentes) e o container PIDU4460624 do
// UD26-117 era adicionado como 2º container. Se o NOME do arquivo cita uma
// referência de processo cadastrada que não é a deste processo (e não cita a
// deste), o arquivo é pulado com aviso. Comparação sem espaço/hífen.
function _normRefArquivo(v){ return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,''); }
function arquivoDeOutroProcesso(nomeArquivo, refAtual, refsCadastradas){
  const nome = _normRefArquivo(nomeArquivo);
  const atual = _normRefArquivo(refAtual);
  if(!nome || !atual) return null;
  if(nome.includes(atual)) return null;
  const outras = (refsCadastradas||[]).map(_normRefArquivo)
    .filter(r => r && r.length >= 5 && r !== atual && !atual.includes(r) && nome.includes(r));
  if(!outras.length) return null;
  // Pega a referência mais longa (UD26-117 e não UD26-11).
  const r = outras.sort((a,b)=>b.length-a.length)[0];
  const original = (refsCadastradas||[]).find(x => _normRefArquivo(x) === r) || r;
  return original;
}

async function processarFilaIA(arquivos){
  const refAtual = (document.getElementById('f_referencia') || {}).value || (typeof _editando !== 'undefined' && _editando && _editando.referencia) || '';
  const refs = (typeof _processos !== 'undefined' && Array.isArray(_processos)) ? _processos.map(p => p && p.referencia).filter(Boolean) : [];
  const pulados = [];
  arquivos = Array.from(arquivos || []).filter(a => {
    const outro = arquivoDeOutroProcesso(a && a.name, refAtual, refs);
    if(outro){ pulados.push(`${a.name} (é do ${outro})`); return false; }
    return true;
  });
  if(pulados.length){
    showToast(`⚠️ ${pulados.length} arquivo(s) de outro processo não foram lidos: ${pulados.join('; ')}. Este processo é ${refAtual}.`, 'warn');
  }
  const versaoFila = typeof versaoDoPainel === 'function' ? versaoDoPainel() : null;
  for(const arquivo of arquivos){
    if(versaoFila !== null && versaoDoPainel() !== versaoFila){
      showToast('O processo foi fechado ou trocado — os documentos restantes da fila não foram lidos.', 'warn', 8000);
      break;
    }
    try{
      await extrairComIA_umArquivo({ files: [arquivo], set value(v){} });
    }catch(e){
      console.error('Erro ao processar arquivo via IA:', arquivo && arquivo.name, e);
    }
  }
}

// Ponto de entrada publico (mantem o nome extrairComIA para compatibilidade com onchange="extrairComIA(this)")
async function extrairComIA(inputReal){
  const arquivos = Array.from((inputReal && inputReal.files) || []);
  if(!arquivos.length) return;
  if(inputReal) inputReal.value = '';
  await processarFilaIA(arquivos);
}

function handleDragOverIA(ev){
  ev.preventDefault();
  ev.stopPropagation();
  const zone = document.getElementById('ia-drop-zone');
  if(zone){ zone.style.borderColor = 'rgba(26,127,212,.6)'; zone.style.background = 'rgba(26,127,212,.10)'; }
}

function handleDragLeaveIA(ev){
  ev.preventDefault();
  ev.stopPropagation();
  const zone = document.getElementById('ia-drop-zone');
  if(zone){ zone.style.borderColor = 'rgba(26,127,212,.15)'; zone.style.background = 'rgba(26,127,212,.04)'; }
}

// ── Drag-and-drop pra "Extrair NF (Entrada ou Saida) com IA" (aba
// Faturamento) -- mesmo padrão de handleDragOverIA/handleDragLeaveIA/
// handleDropIA acima (task #405), só que apontando pro drop-zone e pro
// arquivo único dessa seção (aceita XML também, além de PDF/imagem), e
// chamando importarNFSaidaProcessoArquivo (controle-nf-import.js) em vez
// de processarFilaIA. Pedido Ayslan 17/09/2026.
function handleDragOverIA_NF(ev){
  ev.preventDefault();
  ev.stopPropagation();
  const zone = document.getElementById('ia-nf-saida-drop-zone');
  if(zone){ zone.style.borderColor = 'rgba(26,127,212,.6)'; zone.style.background = 'rgba(26,127,212,.10)'; }
}

function handleDragLeaveIA_NF(ev){
  ev.preventDefault();
  ev.stopPropagation();
  const zone = document.getElementById('ia-nf-saida-drop-zone');
  if(zone){ zone.style.borderColor = 'rgba(26,127,212,.15)'; zone.style.background = 'rgba(26,127,212,.04)'; }
}

async function handleDropIA_NF(ev){
  ev.preventDefault();
  ev.stopPropagation();
  const zone = document.getElementById('ia-nf-saida-drop-zone');
  if(zone){ zone.style.borderColor = 'rgba(26,127,212,.15)'; zone.style.background = 'rgba(26,127,212,.04)'; }
  const dt = ev.dataTransfer;
  if(!dt || !dt.files || !dt.files.length) return;
  const arquivo = Array.from(dt.files).find(f => /\.(pdf|png|jpe?g|xml)$/i.test(f.name));
  if(!arquivo) return;
  if(typeof importarNFSaidaProcessoArquivo === 'function') await importarNFSaidaProcessoArquivo(arquivo);
}

async function handleDropIA(ev){
  ev.preventDefault();
  ev.stopPropagation();
  const zone = document.getElementById('ia-drop-zone');
  if(zone){ zone.style.borderColor = 'rgba(26,127,212,.15)'; zone.style.background = 'rgba(26,127,212,.04)'; }
  const dt = ev.dataTransfer;
  if(!dt || !dt.files || !dt.files.length) return;
  const arquivos = Array.from(dt.files).filter(f => /\.(pdf|png|jpe?g)$/i.test(f.name));
  if(!arquivos.length) return;
  await processarFilaIA(arquivos);
}

// ════════════════════════════════════════════════════════════════
// POP-UP DE CONFLITOS DA EXTRAÇÃO POR IA
// ════════════════════════════════════════════════════════════════
// Quando um documento novo traz um valor DIFERENTE de um campo que já
// estava preenchido (e não é um caso de prioridade automática conhecida —
// ver camposSobrescritosPorCe/BlDi/PI acima), em vez de descartar a leitura
// da IA em silêncio, esses conflitos são coletados e mostrados aqui, todos
// juntos, num único pop-up ao final da leitura do documento — o usuário
// escolhe campo a campo se mantém o valor atual ou usa o valor lido no
// documento novo. Modal montado dinamicamente (sem markup fixo no HTML)
// porque a lista de campos divergentes muda a cada leitura.
// Lê o JSON devolvido pela IA de forma tolerante (06/10/2026 — comprovante
// de câmbio da 2605-1737 dava "Resposta da IA inválida"). O modelo às vezes:
// escreve uma frase antes/depois do JSON, copia os comentários "// ..." do
// modelo de resposta, ou deixa vírgula sobrando antes de } ou ]. Aqui:
// 1) tenta direto; 2) recorta do primeiro "{" ao "}" que fecha; 3) remove
// comentários fora de strings e vírgulas sobrando. Lança erro se nada der.
function extrairJsonRespostaIA(raw){
  const semCerca = String(raw || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  try{ return JSON.parse(semCerca); }catch(e){ /* segue */ }
  const ini = semCerca.indexOf('{');
  if(ini < 0) throw new Error('sem JSON');
  // recorta até a chave que fecha o objeto (respeitando strings)
  let nivel = 0, emStr = false, esc = false, fim = -1;
  for(let i = ini; i < semCerca.length; i++){
    const ch = semCerca[i];
    if(emStr){ if(esc) esc = false; else if(ch === '\\') esc = true; else if(ch === '"') emStr = false; continue; }
    if(ch === '"') emStr = true;
    else if(ch === '{') nivel++;
    else if(ch === '}'){ nivel--; if(nivel === 0){ fim = i; break; } }
  }
  let trecho = fim > 0 ? semCerca.slice(ini, fim + 1) : semCerca.slice(ini);
  try{ return JSON.parse(trecho); }catch(e){ /* segue */ }
  // remove comentários // e /* */ fora de strings
  let out = '', i = 0; emStr = false; esc = false;
  while(i < trecho.length){
    const ch = trecho[i], nx = trecho[i+1];
    if(emStr){ out += ch; if(esc) esc = false; else if(ch === '\\') esc = true; else if(ch === '"') emStr = false; i++; continue; }
    if(ch === '"'){ emStr = true; out += ch; i++; continue; }
    if(ch === '/' && nx === '/'){ while(i < trecho.length && trecho[i] !== '\n') i++; continue; }
    if(ch === '/' && nx === '*'){ i += 2; while(i < trecho.length && !(trecho[i] === '*' && trecho[i+1] === '/')) i++; i += 2; continue; }
    out += ch; i++;
  }
  out = out.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(out);
}

let _conflitosIAPendentes = [];
// Troca de processo no painel: os conflitos pendentes eram do processo
// anterior — fecha a janela para ninguém aplicá-los no processo novo.
if(typeof aoTrocarProcessoNoPainel === 'function') aoTrocarProcessoNoPainel(() => {
  if(_conflitosIAPendentes.length && typeof document !== 'undefined') document.getElementById('modal-conflitos-ia-bg')?.remove();
  _conflitosIAPendentes = [];
});

// ── CI (Commercial Invoice) = dados finais — 06/10/2026 ──
// Documento é CI quando a IA leu Nº ou Valor da CI e NÃO é uma DI/DUIMP
// (o "Comprovante de Importação" da Receita também é chamado de CI).
function ehDocumentoCI(ex){
  if(!ex) return false;
  const ehDiOuDuimp = !!(ex.numero_di || ex.data_registro_di || ex.duimp_numero || ex.canal);
  return !ehDiOuDuimp && !!(ex.ci_numero || ex.ci_valor_usd);
}
function normalizarNumeroDoc(v){ return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,''); }
// Medidas de pneu numa descrição ("215/75R17.5 16PR", "12.00R20", "18.4-30",
// "600/65R28") normalizadas pra comparar listas de itens de PI x CI.
function medidasDoTexto(t){
  const s = String(t||'').toUpperCase().replace(/,/g,'.');
  const m = s.match(/\d{1,3}(?:\.\d{1,2})?(?:\/\d{2,3})?\s*(?:ZR|R|-)\s*\d{2}(?:\.\d)?/g) || [];
  return m.map(x => x.replace(/\s+/g,''));
}
// true se as duas listas têm ao menos uma medida em comum — ou se não dá
// pra saber (alguma das listas sem medida reconhecível): na dúvida sobre o
// FORMATO, vale a regra "CI é final".
function itensTemMedidaEmComum(descricoesAtuais, descricoesNovas){
  const a = new Set((descricoesAtuais||[]).flatMap(medidasDoTexto));
  const b = (descricoesNovas||[]).flatMap(medidasDoTexto);
  if(!a.size || !b.length) return true;
  return b.some(x => a.has(x));
}

// Medida + quantidade de cada item: "195/60R16|100". Usado pra ver se duas
// listas são o MESMO pedido escrito de jeitos diferentes (ex.: a PL repete
// a marca "SAILFISH" na descrição) — aí não é divergência de verdade.
function assinaturaItens(lista){
  const out = [];
  for(const it of (lista||[])){
    if(!it || !String(it.descricao||'').trim()) continue;
    const med = medidasDoTexto(it.descricao);
    if(med.length !== 1) return null; // sem medida clara: não dá pra comparar
    out.push(med[0] + '|' + (parseFloat(String(it.quantidade??'').replace(',','.')) || 0));
  }
  return out.length ? out.sort().join(';') : null;
}
// A leitura geral (Extração com IA) trouxe uma NF de SAÍDA? Venda (CFOP
// 5xxx/6xxx/7xxx), remessa (5905/6905) ou retorno de remessa (1906/1907/
// 2906/2907/5906/5907/6906/6907 — chega com a IMPAK de destinatária). NF de
// entrada (compra/nacionalização) não: segue no fluxo normal da leitura.
function nfSaidaNaLeituraGeral(ex){
  if(!ex) return false;
  const cfop = String(ex.nf_cfop || '').replace(/\D/g, '');
  if(cfop && typeof ehCfopRetornoRemessa === 'function' && ehCfopRetornoRemessa(cfop)) return true;
  if(/\d/.test(String(ex.nf_saida_numero || '')) || /^\d{4}-\d{2}-\d{2}/.test(String(ex.nf_saida_data || '')) || parseFloat(ex.nf_saida_valor) > 0) return true;
  return /^[567]\d{3}$/.test(cfop) && !ex.nf_entrada_numero;
}
function itensEquivalentes(listaA, listaB){
  const a = assinaturaItens(listaA), b = assinaturaItens(listaB);
  return !!a && a === b;
}
// Preço unitário lido pela IA ("12.50", "US$ 12,50", 0/vazio = sem preço).
function precoUnitarioItemIA(v){
  if(v == null || v === '') return null;
  let t = String(v).replace(/[^\d.,-]/g, '');
  if(t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if(t.includes(',')) t = t.replace(',', '.');
  const n = parseFloat(t);
  return isFinite(n) && n > 0 ? Math.round(n * 10000) / 10000 : null;
}
// Lista nova substituindo a atual (CI depois da PI, por exemplo): o que a
// pessoa já tinha preenchido na mesma medida e quantidade — US$/un e o tipo
// da armazenagem RF — não se perde quando o documento novo não traz.
function herdarDadosDosItensAtuais(novos, atuais){
  const qtd = it => parseFloat(String(it && it.quantidade != null ? it.quantidade : '').replace(',', '.')) || 0;
  const usados = new Set();
  return (novos || []).map(nv => {
    const out = { ...nv };
    const med = medidasDoTexto(out.descricao)[0];
    if(!med) return out;
    const j = (atuais || []).findIndex((at, k) => !usados.has(k) && at && medidasDoTexto(at.descricao)[0] === med && qtd(at) === qtd(out));
    if(j < 0) return out;
    usados.add(j);
    const at = atuais[j];
    if(!(parseFloat(out.fob_usd) > 0) && parseFloat(at.fob_usd) > 0) out.fob_usd = at.fob_usd;
    if(!out.tipo && at.tipo) out.tipo = at.tipo;
    return out;
  });
}
// Completa o US$/un (fob_usd) dos itens atuais com o da leitura nova, casando
// medida + quantidade (cada item novo só é usado uma vez). Não troca preço já
// preenchido. Devolve { lista, completados }.
function completarFobUnitarioItens(atuais, novos){
  const qtd = it => parseFloat(String(it && it.quantidade != null ? it.quantidade : '').replace(',', '.')) || 0;
  const usados = new Set();
  let completados = 0;
  const lista = (atuais || []).map(it => {
    const out = { ...it };
    if(!out.descricao || !String(out.descricao).trim() || parseFloat(out.fob_usd) > 0) return out;
    const med = medidasDoTexto(out.descricao)[0];
    if(!med) return out;
    const j = (novos || []).findIndex((nv, k) => !usados.has(k) && nv && parseFloat(nv.fob_usd) > 0
      && medidasDoTexto(nv.descricao)[0] === med && qtd(nv) === qtd(out));
    if(j < 0) return out;
    usados.add(j);
    out.fob_usd = novos[j].fob_usd;
    completados++;
    return out;
  });
  return { lista, completados };
}
// "QINGDAO, CHINA" → "QINGDAO"; "Qingdao Port" fica como está.
// Classifica o texto literal dos termos de pagamento da PI/CI.
// Retorna {pagamento, adiantamento_pct, prazo_dias} ou null quando o texto
// não permite decidir com segurança (aí vale o que a IA respondeu).
function classificarTermosPagamento(texto){
  const t = String(texto||'').toLowerCase().replace(/\s+/g,' ').trim();
  if(!t) return null;
  const antes = /\b(in advance|advance(d)?|prepay(ment)?|pre-payment|deposit|down ?payment|before (shipment|loading|shipping|delivery)|prior to (shipment|loading|shipping))\b/;
  const depois = /\b(after|before (eta|arrival)|prior to (eta|arrival)|against (the )?(copy|bl|b\/l|bill|documents?)|upon (arrival|receipt)|on arrival|eta|b\/l|bill of lading|o\/a|open account|d\/p|d\/a|l\/c|balance)\b/;
  const pcts = (t.match(/(\d{1,3})(?:[.,]\d+)?\s?%/g) || []).map(x => parseFloat(x)).filter(n => n > 0 && n <= 100);
  const parcial = pcts.find(n => n < 100);
  if(parcial && antes.test(t)) return { pagamento:'PARCELADO', adiantamento_pct: Math.round(parcial), prazo_dias: 0 };
  if(parcial && pcts.length >= 2) return { pagamento:'PARCELADO', adiantamento_pct: Math.round(parcial), prazo_dias: 0 };
  const m = t.match(/(\d{1,3})\s*days?\s*(after|from)\s*(the\s*)?(b\/l|bl|bill of lading|shipment|shipping|loading|on board)/);
  const prazo = m ? parseInt(m[1],10) : 0;
  const temDepois = depois.test(t.replace(antes, ''));
  if(temDepois && !antes.test(t)) return { pagamento:'PRAZO', adiantamento_pct: 0, prazo_dias: prazo };
  if(antes.test(t) && !temDepois) return { pagamento:'VISTA', adiantamento_pct: 0, prazo_dias: 0 };
  return null;
}

function portoSemPais(v){ return String(v||'').split(',')[0].trim().toUpperCase(); }

// ── De onde veio o valor ATUAL de um campo (pop-up de divergências) ──
// Pedido do Ayslan (06/10/2026): "tem que avisar de qual documento é a
// informação atual, e qual documento ele quer usar". Procura no histórico do
// processo (mais recente primeiro): a leitura de documento por IA que
// preencheu o campo, ou a alteração manual. Ao salvar, o sistema também
// grava "alterou campo" no nome do usuário para o que a IA preencheu — por
// isso uma alteração logo depois (até 3h) de uma leitura que cobriu o mesmo
// campo, pelo mesmo usuário, é atribuída ao documento.
function origemDoValorAtual(campo, log, labels){
  const label = (labels && labels[campo]) || campo;
  const nomesLog = campo === 'itens' ? ['itens','produtos_json'] : [campo];
  const leuCampo = l => l.campo === LOG_CAMPO_LEITURA_IA && String(l.valor_depois||'').split(', ').includes(label);
  const ord = (log||[]).slice().sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
  const doc = l => {
    const nome = String(l.valor_antes||'').replace(/^Revisão de divergências( — )?/, '') || 'escolhido na revisão de divergências';
    return { tipo:'doc', documento: nome, quando: l.created_at || '', usuario: l.usuario || '' };
  };
  for(const l of ord){
    if(leuCampo(l)) return doc(l);
    if(nomesLog.includes(l.campo)){
      const t = new Date(l.created_at||0).getTime();
      const leitura = ord.find(x => leuCampo(x) && x.usuario === l.usuario
        && new Date(x.created_at||0).getTime() <= t && t - new Date(x.created_at||0).getTime() <= 3*3600*1000);
      if(leitura) return doc(leitura);
      return { tipo:'manual', documento:'', quando: l.created_at || '', usuario: l.usuario || '' };
    }
  }
  return null;
}
function textoOrigem(o){
  if(!o) return 'origem não registrada (preenchido antes do histórico)';
  const quando = o.quando ? new Date(o.quando).toLocaleDateString('pt-BR') : '';
  return o.tipo === 'doc'
    ? `📄 ${o.documento}${quando ? ' · lido em '+quando : ''}${o.usuario ? ' por '+o.usuario : ''}`
    : `✍️ digitado por ${o.usuario || '?'}${quando ? ' em '+quando : ''}`;
}

let _conflitosIAArquivo = '';
async function abrirModalConflitosIA(conflitos, nomeArquivo, tipoDoc){
  document.getElementById('modal-conflitos-ia-bg')?.remove();
  _conflitosIAPendentes = conflitos;
  _conflitosIAArquivo = nomeArquivo || '';
  // Histórico do processo (salvo + o que ainda está pendente nesta edição).
  let log = [];
  try{
    if(_editando && _editando.id){
      const r = await fetch('/api/controle/v2/processo/'+_editando.id+'/log');
      const d = await r.json();
      if(d && d.ok) log = d.log || [];
    }
  }catch(e){ /* sem histórico: mostra "origem não registrada" */ }
  if(_editando && Array.isArray(_editando.log)) log = log.concat(_editando.log.filter(l => l.valor_antes !== nomeArquivo));
  const origemNovo = `📄 ${nomeArquivo}${tipoDoc ? ' ('+tipoDoc+')' : ''} — documento que você acabou de enviar`;
  const bloco = (i, valor, marcado, titulo, origem, cor) => `
      <label style="display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border:1px solid ${marcado?cor:'var(--border)'};border-radius:8px;cursor:pointer;background:#fff;flex:1;min-width:220px;">
        <input type="radio" name="conflito-ia-${i}" value="${titulo==='atual'?'atual':'novo'}" ${marcado?'checked':''} style="margin-top:3px;"
          onchange="this.closest('.conf-ia-op').querySelectorAll('label').forEach(l=>l.style.borderColor='var(--border)');this.closest('label').style.borderColor='${cor}'">
        <span style="min-width:0;">
          <span style="display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--muted);">${titulo==='atual'?'Manter o atual':'Usar o do documento novo'}</span>
          <strong style="display:block;font-size:12.5px;color:${titulo==='atual'?'var(--text)':'var(--ok)'};word-break:break-word;">${esc(String(valor))}</strong>
          <span style="display:block;font-size:11px;color:var(--muted);margin-top:3px;">${esc(origem)}</span>
        </span>
      </label>`;
  const linhas = conflitos.map((c,i) => `
    <div style="padding:12px 0;border-bottom:1px solid var(--border);">
      <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:6px;">${esc(c.label)}</div>
      ${c.motivo ? `<div style="font-size:11.5px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:5px 8px;margin-bottom:8px;">❓ ${esc(c.motivo)}</div>` : ''}
      <div class="conf-ia-op" style="display:flex;gap:8px;flex-wrap:wrap;">
        ${bloco(i, c.valorAtual, c.padrao !== 'novo', 'atual', c.origemAtualTexto || textoOrigem(origemDoValorAtual(c.campoOrigem || c.campo, log, LABELS_CAMPOS_IA)), 'var(--ac)')}
        ${bloco(i, c.valorNovo, c.padrao === 'novo', 'novo', c.origemNovoTexto || origemNovo, 'var(--ok)')}
      </div>
    </div>
  `).join('');
  const html = `
    <div class="modal-bg open" id="modal-conflitos-ia-bg">
      <div class="modal" style="max-width:760px;">
        <div class="modal-header">
          <div class="modal-title">⚠️ ${conflitos.length} campo(s) com valor divergente</div>
          <button class="modal-close" onclick="fecharModalConflitosIA()">×</button>
        </div>
        <div class="modal-body">
          <p style="font-size:12px;color:var(--muted);margin-bottom:4px;">Documento lido: <strong>${esc(nomeArquivo)}</strong>${tipoDoc ? ` · identificado como <strong>${esc(tipoDoc)}</strong>` : ''}</p>
          <p style="font-size:12px;color:var(--muted);margin-bottom:6px;">Cada campo mostra de onde veio o valor atual e o valor deste documento. A opção sugerida já vem marcada (numa CI, o valor da CI, que é o documento final).</p>
          <div id="conflitos-ia-lista">${linhas}</div>
          <div style="display:flex;justify-content:flex-end;gap:10px;padding-top:16px;flex-wrap:wrap;">
            <button class="btn btn-outline" onclick="fecharModalConflitosIA()">Manter tudo como está</button>
            <button class="btn btn-primary" onclick="aplicarConflitosIA()">✓ Aplicar escolhidas</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

function fecharModalConflitosIA(){
  document.getElementById('modal-conflitos-ia-bg')?.remove();
  _conflitosIAPendentes = [];
}

function aplicarConflitosIA(){
  const lista = _conflitosIAPendentes || [];
  let aplicados = 0;
  const camposAplicados = [];
  lista.forEach((c,i) => {
    const escolha = document.querySelector(`input[name="conflito-ia-${i}"]:checked`)?.value;
    if(escolha === 'novo'){
      c.aplicar();
      if(_editando){
        if(!_editando._camposIA) _editando._camposIA = {};
        _editando._camposIA[c.campo] = true;
      }
      aplicados++;
      camposAplicados.push(c.label);
    }
  });
  if(aplicados){
    // Mesma necessidade do fluxo principal: preenchimento programático não
    // dispara onchange/oninput, então a fase e a parametrização precisam
    // ser recalculadas manualmente depois de aplicar as escolhas.
    aplicarRegraParametrizacaoVerde();
    atualizarFaseEmTempoReal();
    // Valor da PI/CI aceito do documento: parcelas do Parcelado acompanham
    // (05/10/2026 — saldo fecha com a CI; Inicial = % da PI).
    const camposEscolhidos = lista.filter((c,i) => document.querySelector(`input[name="conflito-ia-${i}"]:checked`)?.value === 'novo').map(c => c.campo);
    // Forma de pagamento trocada pelo pop-up (ex.: CI com termos diferentes):
    // .value programático não dispara o onchange que monta os campos.
    if(camposEscolhidos.includes('pi_pagamento') && typeof renderPagamentoCampos === 'function') renderPagamentoCampos();
    if(typeof _painelDirty !== 'undefined') _painelDirty = true;
    if(camposEscolhidos.includes('pi_valor_usd') && typeof aoMudarValorPI === 'function') aoMudarValorPI();
    if(camposEscolhidos.includes('ci_valor_usd') && typeof aoMudarValorCI === 'function') aoMudarValorCI();
    if(_editando){
      _editando.log = _editando.log || [];
      _editando.log.push({
        campo: LOG_CAMPO_LEITURA_IA,
        valor_antes: 'Revisão de divergências — ' + (_conflitosIAArquivo || ''),
        valor_depois: camposAplicados.join(', '),
        usuario: _user.usuario,
        created_at: new Date().toISOString(),
      });
    }
    showToast(`✓ ${aplicados} campo(s) atualizado(s) com o valor do documento`,'ok');
  } else {
    showToast('Nenhuma alteração aplicada — valores atuais mantidos','ok');
  }
  fecharModalConflitosIA();
}
