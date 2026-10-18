// Testes da revisão de 17/10/2026: datas impossíveis, edição simultânea do
// mesmo processo e tradução de mensagens de erro. Cada caso reproduz um
// problema encontrado nos dados/código antes da correção.
// Rodar: node testes_revisao.js
const VD = require('./validacao-datas.js');
const CP = require('./concorrencia-processo.js');

let total = 0, passaram = 0;
function teste(nome, fn) {
  total++;
  try { fn(); passaram++; console.log('  ✓ ' + nome); }
  catch (e) { console.log('  ✗ ' + nome + '\n      ' + (e.message || e)); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'falhou'); }
function iguais(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg ? msg + ' — ' : '') + `esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); }
const HOJE = '2026-10-17';

console.log('\n── Datas impossíveis (validacao-datas.js) ──');
teste('Chegada antes do embarque é erro', () => {
  const r = VD.validar({ data_embarque: '2026-08-07', data_chegada: '2026-07-28' }, { hoje: HOJE });
  ok(VD.erros(r).length === 1, JSON.stringify(r));
  ok(/Data de Chegada \(28\/07\/2026\) está antes de Data de Embarque \(07\/08\/2026\)/.test(VD.erros(r)[0].msg), VD.erros(r)[0].msg);
});
teste('Embarque = chegada (padrão encontrado na base) gera aviso de trânsito curto', () => {
  const r = VD.validar({ data_embarque: '2026-08-07', data_chegada: '2026-08-07' }, { hoje: HOJE });
  iguais(VD.erros(r).length, 0);
  ok(VD.avisos(r).some(a => /0 dia\(s\) entre o Embarque/.test(a.msg)), JSON.stringify(r));
});
teste('Devolução do vazio antes da chegada (padrão encontrado na base) é erro', () => {
  const r = VD.validar({ data_chegada: '2026-08-24', data_devolucao_vazio: '2026-02-09' }, { hoje: HOJE });
  ok(VD.erros(r).some(e => e.campos.includes('data_devolucao_vazio')), JSON.stringify(r));
});
teste('Carga LCL não tem devolução de vazio — regra não se aplica', () => {
  const r = VD.validar({ tipo_container: 'LCL', data_chegada: '2026-08-24', data_devolucao_vazio: '2026-02-09' }, { hoje: HOJE });
  iguais(VD.erros(r).length, 0, JSON.stringify(r));
});
teste('Carregamento antes da chegada é erro', () => {
  const r = VD.validar({ data_chegada: '2026-08-10', data_carregamento: '2026-08-01' }, { hoje: HOJE });
  iguais(VD.erros(r).length, 1);
});
teste('Devolução antes do carregamento é erro', () => {
  const r = VD.validar({ data_chegada: '2026-08-01', data_carregamento: '2026-08-12', data_devolucao_vazio: '2026-08-10' }, { hoje: HOJE });
  ok(VD.erros(r).some(e => e.campos.join() === 'data_carregamento,data_devolucao_vazio'), JSON.stringify(r));
});
teste('ETA antes do ETD é erro', () => {
  const r = VD.validar({ etd: '2026-11-10', eta: '2026-11-01' }, { hoje: HOJE });
  iguais(VD.erros(r).length, 1);
});
teste('Ano digitado pela metade (0026-07-22, visto no histórico) é erro', () => {
  const r = VD.validar({ eta: '0026-07-22' }, { hoje: HOJE });
  ok(VD.erros(r).length >= 1 && /ano 0026/.test(VD.erros(r)[0].msg), JSON.stringify(r));
});
teste('Ano muito no futuro (2099) é erro', () => {
  const r = VD.validar({ pi_data_saldo: '2099-01-01' }, { hoje: HOJE });
  iguais(VD.erros(r).length, 1);
});
teste('Data real no futuro vira aviso (não erro)', () => {
  const r = VD.validar({ data_chegada: '2026-11-30' }, { hoje: HOJE });
  iguais(VD.erros(r).length, 0); ok(VD.avisos(r).length === 1);
});
teste('Sequência normal não gera nada', () => {
  const r = VD.validar({ etd: '2026-06-01', eta: '2026-07-28', data_embarque: '2026-06-03', data_chegada: '2026-07-30', data_presenca: '2026-07-31', data_carregamento: '2026-08-05', data_devolucao_vazio: '2026-08-12' }, { hoje: HOJE });
  iguais(r, []);
});
teste('Só valida regras dos campos alterados (processo antigo com erro não trava outra edição)', () => {
  const p = { data_chegada: '2026-08-24', data_devolucao_vazio: '2026-02-09', obs: 'x' };
  iguais(VD.validar(p, { hoje: HOJE, campos: ['obs'] }), []);
  ok(VD.erros(VD.validar(p, { hoje: HOJE, campos: ['data_chegada'] })).length === 1);
});

// ── 18/10/2026: DI x Liberação/NF e devolução de cada container ──
teste('Liberação antes do registro da DI: aviso ao digitar (não trava)', () => {
  const r = VD.validar({ data_registro_di: '2026-03-12', data_liberacao: '2026-03-11' }, { hoje: HOJE });
  iguais(VD.erros(r).length, 0, JSON.stringify(r));
  ok(VD.avisos(r).some(a => /Data de Liberação \(11\/03\/2026\) está antes de Registro da DI\/DUIMP \(12\/03\/2026\)/.test(a.msg)), JSON.stringify(r));
});
teste('NF de entrada antes do registro da DI: aviso ao digitar (não trava)', () => {
  const r = VD.validar({ data_registro_di: '2026-03-12', nf_entrada_data: '2026-03-04' }, { hoje: HOJE });
  iguais(VD.erros(r).length, 0); ok(VD.avisos(r).some(a => /NF de Entrada/.test(a.msg)), JSON.stringify(r));
});
const DOIS_CONT = devs => JSON.stringify(devs.map((d, i) => ({ numero: 'TSTU000000' + (i + 1), tipo: '40HC', devolucao: d })));
teste('Devolução de um container antes da chegada é erro (2+ containers)', () => {
  const r = VD.validar({ data_chegada: '2026-04-20', containers_json: DOIS_CONT(['2026-04-28', '2026-04-02']) }, { hoje: HOJE, campos: ['containers_json'] });
  iguais(VD.erros(r).length, 1, JSON.stringify(r));
  ok(/TSTU0000002 \(02\/04\/2026\) está antes de Data de Chegada \(20\/04\/2026\)/.test(VD.erros(r)[0].msg), VD.erros(r)[0].msg);
});
teste('Container: mudar a chegada para depois de uma devolução também trava', () => {
  const r = VD.validar({ data_chegada: '2026-04-30', containers_json: DOIS_CONT(['2026-04-28', '']) }, { hoje: HOJE, campos: ['data_chegada'] });
  iguais(VD.erros(r).length, 1, JSON.stringify(r));
});
teste('Container: com 1 só vale a devolução do processo (o container guardado não trava)', () => {
  iguais(VD.validar({ data_chegada: '2026-04-20', containers_json: DOIS_CONT(['2026-04-02']) }, { hoje: HOJE, campos: ['containers_json'] }), []);
});
teste('Container: carga LCL não tem devolução', () => {
  iguais(VD.validar({ tipo_container: 'LCL', data_chegada: '2026-04-20', containers_json: DOIS_CONT(['2026-04-02', '2026-04-03']) }, { hoje: HOJE, campos: ['containers_json'] }), []);
});
teste('Container: editar outro campo não confere as devoluções antigas', () => {
  iguais(VD.validar({ data_chegada: '2026-04-20', containers_json: DOIS_CONT(['2026-04-02', '']), obs: 'x' }, { hoje: HOJE, campos: ['obs'] }), []);
});
teste('Container: devolução no futuro vira aviso; ano pela metade é erro', () => {
  const r = VD.validar({ data_chegada: '2026-04-20', containers_json: DOIS_CONT(['2026-12-01', '0026-05-02']) }, { hoje: HOJE, campos: ['containers_json'] });
  ok(VD.avisos(r).some(a => /TSTU0000001 \(01\/12\/2026\) está no futuro/.test(a.msg)), JSON.stringify(r));
  ok(VD.erros(r).some(e => /TSTU0000002 com ano 0026/.test(e.msg)), JSON.stringify(r));
});

console.log('\n── Datas lidas pela IA com dia e mês trocados (conferirDatasLidas) ──');
const LER = (lidas, processo) => VD.conferirDatasLidas(lidas, processo, { hoje: HOJE });
teste('trocarDiaMes/dataExiste: só troca quando o dia serve de mês', () => {
  iguais(VD.trocarDiaMes('2026-03-04'), '2026-04-03');
  iguais(VD.trocarDiaMes('2026-03-13'), null, 'dia 13 não vira mês');
  iguais(VD.trocarDiaMes('2026-05-05'), null, 'dia = mês: a troca não muda nada');
  iguais(VD.trocarDiaMes('2026-02-30'), null, '30/02 trocado também não existe');
  iguais(VD.trocarDiaMes('2026-25-04'), '2026-04-25', 'mês 25 trocado vira 25/04');
  ok(!VD.dataExiste('2026-02-30') && !VD.dataExiste('2026-13-05') && VD.dataExiste('2028-02-29') && VD.dataExiste('0026-07-22'));
});
teste('RIC lido com dia e mês trocados (devolução antes da chegada): usa a trocada e avisa', () => {
  const r = LER({ data_devolucao_vazio: '2026-02-04' }, { data_chegada: '2026-03-20', data_carregamento: '2026-03-27' });
  iguais(r.datas, { data_devolucao_vazio: '2026-04-02' });
  iguais(r.trocadas.map(t => [t.campo, t.lida, t.usada]), [['data_devolucao_vazio', '2026-02-04', '2026-04-02']]);
  ok(/Devolução do Vazio lida como 04\/02\/2026 não fecha: .*antes de Data de Chegada \(20\/03\/2026\)\. Usei 02\/04\/2026 \(dia e mês trocados\)/.test(r.avisos[0]), r.avisos[0]);
});
teste('NF de entrada lida antes do registro da DI: usa a trocada', () => {
  const r = LER({ nf_entrada_data: '2026-02-04' }, { data_registro_di: '2026-03-30' });
  iguais(r.datas.nf_entrada_data, '2026-04-02'); iguais(r.trocadas.length, 1);
  ok(/Data da NF de Entrada \(04\/02\/2026\) está antes de Registro da DI\/DUIMP \(30\/03\/2026\)/.test(r.trocadas[0].motivo), r.trocadas[0].motivo);
});
teste('Data que já fecha não é trocada, mesmo quando a troca também fecharia', () => {
  const r = LER({ nf_entrada_data: '2026-04-03' }, { data_registro_di: '2026-03-01' });
  iguais(r.datas.nf_entrada_data, '2026-04-03'); iguais(r.avisos, []);
});
teste('Leitura da própria DI com o registro trocado (liberação e chegada certas): troca só o registro', () => {
  const r = LER({ data_registro_di: '2026-05-04', data_liberacao: '2026-04-16', data_chegada: '2026-04-03' }, { data_embarque: '2026-02-20' });
  iguais(r.datas, { data_registro_di: '2026-04-05', data_liberacao: '2026-04-16', data_chegada: '2026-04-03' });
  iguais(r.trocadas.map(t => t.campo), ['data_registro_di']);
  ok(/Data de Liberação \(16\/04\/2026\) está antes de Registro da DI\/DUIMP \(04\/05\/2026\)/.test(r.trocadas[0].motivo), r.trocadas[0].motivo);
});
teste('DI em que trocar o registro OU a liberação fecharia: não preenche nenhum dos dois', () => {
  // registro 04/05 x liberação 06/04: tanto 05/04 x 06/04 quanto 04/05 x 04/06 fecham
  const r = LER({ data_registro_di: '2026-05-04', data_liberacao: '2026-04-06', data_chegada: '2026-04-03' }, { data_embarque: '2026-02-20' });
  iguais(r.datas, { data_chegada: '2026-04-03' });
  iguais(r.descartadas.map(d => [d.campo, d.tipo]), [['data_registro_di', 'ambigua'], ['data_liberacao', 'ambigua']]);
});
teste('Data no futuro: troca quando a trocada fecha', () => {
  const r = LER({ data_devolucao_vazio: '2026-12-03' }, { data_chegada: '2026-02-20' });
  iguais(r.datas.data_devolucao_vazio, '2026-03-12');
  ok(/está no futuro/.test(r.trocadas[0].motivo), r.trocadas[0].motivo);
});
teste('Nenhuma das duas fecha: não usa e avisa (com a troca que também não serve)', () => {
  const r = LER({ data_devolucao_vazio: '2026-01-02' }, { data_chegada: '2026-03-08' });
  iguais(r.datas, {}); iguais(r.trocadas.length, 0); iguais(r.descartadas[0].tipo, 'ordem');
  ok(/Devolução do Vazio lida como 02\/01\/2026 não foi preenchida: .*antes de Data de Chegada \(08\/03\/2026\)\. Com dia e mês trocados \(01\/02\/2026\) também não fecha\. Confira no documento/.test(r.avisos[0]), r.avisos[0]);
});
teste('Dia acima de 12 (sem troca possível) e impossível: não usa e avisa', () => {
  const r = LER({ data_devolucao_vazio: '2026-03-15' }, { data_chegada: '2026-03-18' });
  iguais(r.datas, {}); iguais(r.trocadas.length, 0);
  ok(/Devolução do Vazio lida como 15\/03\/2026 não foi preenchida: .*antes de Data de Chegada \(18\/03\/2026\)\. Confira no documento/.test(r.avisos[0]), r.avisos[0]);
});
teste('Data que não existe (mês 25): usa a trocada', () => {
  const r = LER({ data_devolucao_vazio: '2026-25-04' }, { data_chegada: '2026-04-10' });
  iguais(r.datas.data_devolucao_vazio, '2026-04-25'); ok(/não existe no calendário/.test(r.avisos[0]), r.avisos[0]);
});
teste('Ambígua (trocar o ETD ou o ETA fecha igual): não usa nenhuma', () => {
  const r = LER({ etd: '2026-09-05', eta: '2026-08-10' }, {});
  iguais(r.datas, {}); iguais(r.descartadas.map(d => d.tipo), ['ambigua', 'ambigua']);
  ok(/Não dá para saber qual das datas deste documento está errada/.test(r.avisos[0]), r.avisos[0]);
});
teste('Data só improvável (trânsito curto) não é trocada — o aviso aparece ao salvar', () => {
  const r = LER({ data_chegada: '2026-03-08' }, { data_embarque: '2026-03-05' });
  iguais(r.datas.data_chegada, '2026-03-08'); iguais(r.avisos, []);
});
teste('Trocada que daria trânsito curto (ou longo) demais não é usada', () => {
  // chegada lida 08/03 é antes do embarque (28/07); a trocada, 03/08, daria 6 dias de viagem
  const r = LER({ data_chegada: '2026-03-08' }, { data_embarque: '2026-07-28' });
  iguais(r.datas, {}); iguais(r.trocadas.length, 0);
  // chegada lida 06/01 é antes do embarque (05/02); a trocada, 01/06, daria 116 dias — ainda vale (até 150)
  iguais(LER({ data_chegada: '2026-01-06' }, { data_embarque: '2026-02-05' }).datas.data_chegada, '2026-06-01');
  // ...mas com embarque em 05/01 a trocada de uma chegada 2026-12-06 (06/12) daria 151 dias: não usa
  iguais(LER({ data_chegada: '2026-12-06' }, { data_embarque: '2026-01-05' }).datas, {});
});
teste('Datas certas passam sem aviso (PI/CI não são conferidas contra o processo)', () => {
  const r = LER({ data_registro_di: '2026-04-05', data_liberacao: '2026-04-06', data_chegada: '2026-04-03', ci_data: '2026-01-15', pi_data: '2026-01-02' }, { data_embarque: '2026-02-20', etd: '2026-02-18' });
  iguais(r.trocadas.length + r.descartadas.length, 0); iguais(r.datas.ci_data, '2026-01-15');
});
teste('Carga LCL: devolução não é conferida contra a chegada', () => {
  const r = LER({ data_devolucao_vazio: '2026-02-04' }, { data_chegada: '2026-03-20', tipo_container: 'LCL' });
  iguais(r.datas.data_devolucao_vazio, '2026-02-04'); iguais(r.avisos, []);
});
teste('Chegada lida depois da devolução de um container (2+ containers): não usa', () => {
  const r = LER({ data_chegada: '2026-04-21' }, { data_embarque: '2026-02-20', containers_json: DOIS_CONT(['2026-04-15', '']) });
  iguais(r.datas, {}); ok(/TSTU0000001 \(15\/04\/2026\) está antes de Data de Chegada \(21\/04\/2026\)/.test(r.avisos[0]), r.avisos[0]);
});
teste('Ano pela metade: não usa e não sugere troca', () => {
  const r = LER({ nf_entrada_data: '0026-04-05' }, {});
  iguais(r.datas, {}); ok(/ano 0026/.test(r.avisos[0]) && !/Com dia e mês trocados/.test(r.avisos[0]), r.avisos[0]);
});
teste('Formato que não é AAAA-MM-DD passa como veio; data com hora é lida só pela data', () => {
  iguais(LER({ nf_entrada_data: '05/04/2026' }, {}).datas, { nf_entrada_data: '05/04/2026' });
  iguais(LER({ data_devolucao_vazio: '2026-04-02T10:54' }, { data_chegada: '2026-03-20' }).datas, { data_devolucao_vazio: '2026-04-02' });
});
teste('noFuturo: mais de 1 dia à frente', () => {
  ok(VD.noFuturo('2026-10-19', HOJE) && !VD.noFuturo('2026-10-18', HOJE) && !VD.noFuturo('', HOJE));
});

console.log('\n── Edição simultânea (concorrencia-processo.js) ──');
const original = { id: 'p1', referencia: 'UD26-900', fase: 'EMBARCADO', obs: 'a', navio: 'MSC X', data_chegada: null, vendas_json: '[]', updated_at: '2026-10-17T10:00:00.000+00:00' };
const atual = { ...original, fase: 'CHEGOU', data_chegada: '2026-10-16', navio: 'MSC Y', updated_at: '2026-10-17T10:05:00.000+00:00', updated_by: 'fulano' };
teste('Detecta o que a outra pessoa mudou (sem contar campos calculados)', () => {
  iguais(CP.alteradosPorOutros(original, atual), ['data_chegada', 'navio']);
});
teste('Campos diferentes: junta sem perguntar e mantém fase/chegada da outra pessoa', () => {
  const meu = { ...original, obs: 'b' };
  iguais(CP.camposEmConflito(original, atual, meu, ['obs']), []);
  const m = CP.mesclar(atual, meu, ['obs']);
  iguais([m.obs, m.data_chegada, m.fase, m.navio], ['b', '2026-10-16', 'CHEGOU', 'MSC Y']);
});
teste('Mesmo campo com valores diferentes: conflito', () => {
  const meu = { ...original, navio: 'MSC Z' };
  const c = CP.camposEmConflito(original, atual, meu, ['navio']);
  iguais(c.map(x => x.campo), ['navio']); iguais(c[0].deles, 'MSC Y');
});
teste('Mesmo campo com o MESMO valor: não é conflito', () => {
  const meu = { ...original, navio: 'MSC Y' };
  iguais(CP.camposEmConflito(original, atual, meu, ['navio']), []);
});
teste('Usuário escolhe manter o valor da outra pessoa num campo', () => {
  const meu = { ...original, navio: 'MSC Z', obs: 'b' };
  const m = CP.mesclar(atual, meu, ['navio', 'obs'], ['navio']);
  iguais([m.navio, m.obs], ['MSC Y', 'b']);
});
teste('Campo calculado (fase) mandado pelo painel nunca vira conflito nem sobrescreve', () => {
  const meu = { ...original, fase: 'EMBARCADO', obs: 'c' };
  iguais(CP.camposEmConflito(original, atual, meu, ['fase', 'obs']), []);
  iguais(CP.mesclar(atual, meu, ['fase', 'obs']).fase, 'CHEGOU');
});
teste('JSON com chaves em outra ordem não conta como diferente', () => {
  ok(!CP.diferente('[{"a":1,"b":2}]', [{ b: 2, a: 1 }]));
  ok(!CP.diferente('5.10', 5.1));
  ok(!CP.diferente(null, ''));
});
teste('real_json: vínculo com fatura gravado pelo servidor é mantido e não é conflito', () => {
  const o = { ...original, real_json: { frete: { valor: 100, moeda: 'USD' } } };
  const a = { ...o, real_json: { frete: { valor: 100, moeda: 'USD' }, _meta: { frete: { fatura_id: 'f1', pago_em: '2026-10-16' } } } };
  const meu = { ...o, real_json: { frete: { valor: 120, moeda: 'USD' } } };
  iguais(CP.camposEmConflito(o, a, meu, ['real_json']), []);
  const m = CP.mesclar(a, meu, ['real_json']);
  iguais(m.real_json.frete.valor, 120); iguais(m.real_json._meta.frete.fatura_id, 'f1');
});
teste('real_json: dois mudando o mesmo custo é conflito', () => {
  const o = { ...original, real_json: { frete: { valor: 100 } } };
  const a = { ...o, real_json: { frete: { valor: 110 } } };
  const meu = { ...o, real_json: { frete: { valor: 120 } } };
  iguais(CP.camposEmConflito(o, a, meu, ['real_json']).map(x => x.campo), ['real_json']);
});

console.log('\n── Mistura de moedas nos totais (faturas-core.js / fin-core.js) ──');
const FAT = require('./faturas-core.js');
const FIN = require('./fin-core.js');
const HOJE_F = '2026-10-17';
// Sem a cotação do dia, a tela passa { USD: null } (cambioParaTotais) — antes passava 1.
const SEM_COTACAO = { BRL: 1, USD: null, EUR: null };
teste('Fatura em US$ sem câmbio fica FORA do total (antes contava US$ como R$) e é contada', () => {
  const lista = [
    { tipo: 'pagar', status: 'aberta', moeda: 'BRL', valor: 1000, vencimento: '2026-11-01' },
    { tipo: 'pagar', status: 'aberta', moeda: 'USD', valor: 1000, cambio: null, vencimento: '2026-11-01' },
  ];
  const r = FAT.resumoFaturas(lista, HOJE_F, SEM_COTACAO);
  iguais(r.pagar_aberto, 1000); iguais(r.sem_cambio, 1);
});
teste('Fatura em US$ usa o câmbio da própria fatura (igual à linha da lista)', () => {
  const lista = [{ tipo: 'pagar', status: 'aberta', moeda: 'USD', valor: 1000, cambio: 5.25, vencimento: '2026-11-01' }];
  iguais(FAT.resumoFaturas(lista, HOJE_F, SEM_COTACAO).pagar_aberto, 5250);
  iguais(FAT.resumoFaturas(lista, HOJE_F, { USD: 5.6 }).pagar_aberto, 5250, 'câmbio da fatura vem antes do câmbio do dia');
  iguais(FAT.fatorBRL({ moeda: 'USD', cambio: null }, { USD: 5.6 }), 5.6, 'sem câmbio na fatura, usa o do dia');
  iguais(FAT.fatorBRL({ moeda: 'BRL' }, {}), 1);
});
teste('Fluxo de caixa conta as faturas sem câmbio', () => {
  const fl = FAT.fluxoMensalFaturas([{ tipo: 'pagar', status: 'aberta', moeda: 'EUR', valor: 300, vencimento: '2026-11-10' }], ['2026-10', '2026-11'], HOJE_F, SEM_COTACAO);
  iguais(fl.semCambio.qtd, 1); iguais(fl.meses['2026-11'].pagar_previsto, 0);
});
teste('Baixa de fatura em US$ sem câmbio nenhum é recusada (entraria como R$ 0 no caixa)', () => {
  const f = { valor: 1000, status: 'aberta', moeda: 'USD', cambio: null };
  const v = FAT.validarPagamento({ data: '2026-10-10', valor: 1000 }, f);
  ok(!v.ok && /sem câmbio/.test(v.erro), JSON.stringify(v));
  ok(FAT.validarPagamento({ data: '2026-10-10', valor: 1000, cambio_efetivo: '5,30' }, f).ok, 'com câmbio efetivo passa');
  ok(FAT.validarPagamento({ data: '2026-10-10', valor: 1000 }, { ...f, cambio: 5.2 }).ok, 'com câmbio na fatura passa (só avisa)');
});
const CONTAS_F = FIN.PLANO_PADRAO.map(([codigo, nome, grupo]) => ({ id: 'c' + codigo, codigo, nome, grupo }));
teste('DRE (competência): fatura em US$ sem câmbio fica fora e é contada', () => {
  const d = FIN.dreEmpresa([{ tipo: 'pagar', status: 'aberta', moeda: 'USD', valor: 500, emissao: '2026-10-05' }], CONTAS_F, { de: '2026-10-01', ate: '2026-10-31', regime: 'competencia', cambio: SEM_COTACAO });
  iguais(d.sem_cambio, 1); iguais(d.resultadoLiquido, 0);
});
teste('DRE (caixa): sem câmbio na fatura, o pagamento sai pelo câmbio efetivo da baixa', () => {
  const f = { tipo: 'pagar', status: 'paga', moeda: 'USD', valor: 100, cambio: null, pagamentos: [{ data: '2026-10-08', valor: 100, cambio_efetivo: 5.5, pago_brl: 550 }] };
  const d = FIN.dreEmpresa([f], CONTAS_F, { de: '2026-10-01', ate: '2026-10-31', regime: 'caixa', cambio: SEM_COTACAO });
  iguais(d.sem_cambio, 0); iguais(d.resultadoLiquido, -550);
});
teste('Contador: transferência US$ → R$ usa o valor creditado em R$', () => {
  const bancos = [{ id: 'b1', nome: 'Conta US$', moeda: 'USD' }, { id: 'b2', nome: 'Conta R$', moeda: 'BRL' }];
  const l = FIN.lancamentosContabeis([], CONTAS_F, bancos, { de: '2026-10-01', ate: '2026-10-31', transferencias: [{ data: '2026-10-09', de_banco_id: 'b1', para_banco_id: 'b2', valor: 1000, valor_destino: 5400 }] });
  iguais(l.length, 1); iguais(l[0].valor, 5400);
  const l2 = FIN.lancamentosContabeis([], CONTAS_F, [{ id: 'b1', nome: 'A', moeda: 'USD' }, { id: 'b3', nome: 'B', moeda: 'EUR' }], { transferencias: [{ data: '2026-10-09', de_banco_id: 'b1', para_banco_id: 'b3', valor: 100 }] });
  ok(/\[valor em USD\]/.test(l2[0].historico), 'sem lado em R$, marca a moeda no histórico');
});

// ── Rede (chat.js): erro que não veio do sistema vira mensagem útil ──
// Durante uma atualização o Railway responde 502 com uma página HTML; a tela
// fazia r.json() e mostrava "Unexpected token '<'". Roda o trecho de rede do
// chat.js de verdade, num sandbox, com um fetch falso por baixo.
const fs = require('fs'), vm = require('vm'), path = require('path');
async function testeAsync(nome, fn) {
  total++;
  try { await fn(); passaram++; console.log('  ✓ ' + nome); }
  catch (e) { console.log('  ✗ ' + nome + '\n      ' + (e.message || e)); }
}
function redeDoChatJs(fetchFalso) {
  const src = fs.readFileSync(path.join(__dirname, 'chat.js'), 'utf8');
  const ini = src.indexOf('(function instalarRedeImpak(){');
  const fim = src.indexOf('\n})();', ini);
  if (ini < 0 || fim < 0) throw new Error('trecho instalarRedeImpak não encontrado no chat.js');
  const janela = { fetch: fetchFalso };
  const ctx = { window: janela, location: { pathname: '/controle', search: '' }, Response, Map, Date, Math, JSON, String, Error, setTimeout, encodeURIComponent,
    document: { getElementById: () => null, body: null } };
  vm.runInNewContext(src.slice(ini, fim + '\n})();'.length), ctx);
  return janela.fetch;
}
const resposta = (status, corpo, tipo) => Promise.resolve(new Response(corpo, { status, headers: { 'Content-Type': tipo } }));

// ── Leitura por IA de verdade (controle-import-ia.js / controle-nf-import.js) ──
// Monta os módulos do Controle num sandbox com tela e fetch falsos: o "fetch"
// devolve o JSON que a IA teria lido e o teste confere o que foi parar nos
// campos depois da trava de dia/mês trocados (18/10/2026).
const MODULOS_LEITURA = ['taxas-catalogo.js', 'listas-padrao.js', 'validacao-datas.js', 'concorrencia-processo.js', 'controle-core.js',
  'controle-modal.js', 'controle-campos.js', 'controle-export.js', 'controle-contatos.js', 'controle-import-ia.js', 'controle-nf-import.js', 'controle-dashboards.js'];
let _jsLeitura = null;
function telaComIA(respostaIA) {
  _jsLeitura = _jsLeitura || MODULOS_LEITURA.map(f => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n');
  const els = {}, toasts = [];
  const novoEl = id => ({ id, value: '', innerHTML: '', style: {}, textContent: '', dataset: {}, checked: false, options: [], selectedIndex: 0, tagName: 'INPUT',
    classList: { add() {}, remove() {}, contains() { return false; } }, addEventListener() {}, appendChild(c) { (this.filhos = this.filhos || []).push(c); },
    querySelector() { return null; }, querySelectorAll() { return []; }, dispatchEvent() { return true; }, setAttribute() {}, removeAttribute() {}, remove() {} });
  const json = d => ({ ok: true, status: 200, json: async () => d, text: async () => JSON.stringify(d) });
  const ctx = {
    document: { getElementById: id => els[id] || (els[id] = novoEl(id)), querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
      createElement: t => novoEl('novo-' + t), body: { appendChild() {}, classList: { add() {}, remove() {} } }, head: { appendChild() {} } },
    fetch: async url => String(url) === '/api/analisar' ? json({ ok: true, jobId: 'j1' })
      : String(url).startsWith('/api/analisar/job/') ? json({ ok: true, status: 'concluido', resultado: { content: [{ text: JSON.stringify(respostaIA) }] } })
      : json({ ok: true, contatos: [], empresas: [] }),
    FileReader: class { readAsDataURL() { this.result = 'data:application/pdf;base64,AAAA'; setImmediate(() => this.onload && this.onload()); } },
    setTimeout: fn => setImmediate(fn), clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    location: { origin: 'http://localhost', href: 'http://localhost/controle', pathname: '/controle', search: '' }, navigator: { clipboard: { writeText() {} } },
    console, Date, Math, JSON, Promise, URL, Event: class {}, addEventListener() {}, confirm: () => true, alert() {}, __toasts: toasts,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(_jsLeitura, ctx, { filename: 'modulos-controle.js' });
  vm.runInContext(`showToast = (m, t) => { __toasts.push([t, m]); };
    _user = { usuario: 'teste', role: 'gerente' }; _editando = { id: null, _camposIA: {}, log: [] }; _containers = [{ numero: '', tipo: '40HC', lacre: '' }];`, ctx);
  const tela = (id, v) => { ctx.document.getElementById(id).value = v; };
  const ler = () => vm.runInContext(`extrairComIA_umArquivo({ files: [{ name: 'doc-teste.pdf', type: 'application/pdf' }], value: 'x' })`, ctx);
  return { ctx, els, toasts, tela, ler, rodar: code => vm.runInContext(code, ctx) };
}

(async () => {
  console.log('\n── Leitura por IA: trava de dia/mês trocados nos campos (controle-import-ia.js) ──');
  await testeAsync('RIC (1 container) lido com dia e mês trocados: devolução corrigida, avisada e anotada no Histórico', async () => {
    const t = telaComIA({ eh_ric: true, containers: [{ numero: 'TSTU0000001', lacre: '' }], data_devolucao_vazio: '2026-02-04', depot: 'DEPOT TESTE' });
    t.tela('f_data_chegada', '2026-03-20'); t.tela('f_data_carregamento', '2026-03-27'); t.rodar(`_containers = [{ numero: 'TSTU0000001', tipo: '40HC', lacre: '' }];`);
    await t.ler();
    iguais(t.els.f_data_devolucao_vazio.value, '2026-04-02');
    ok(t.toasts.some(x => x[0] === 'warn' && /1 data\(s\) conferida/.test(x[1])), JSON.stringify(t.toasts));
    ok((t.els['ia-status'].filhos || []).some(f => /Datas conferidas/.test(f.innerHTML) && /Usei 02\/04\/2026/.test(f.innerHTML)), 'caixa de aviso na tela');
    ok(t.rodar('_editando.log').some(l => /, Datas conferidas: .* lida 04\/02\/2026 → usada 02\/04\/2026 \(dia e mês trocados\)$/.test(l.valor_depois)), JSON.stringify(t.rodar('_editando.log')));
  });
  await testeAsync('RIC (2 containers): a data trocada vai para o container certo', async () => {
    const t = telaComIA({ eh_ric: true, containers: [{ numero: 'TSTU0000002', lacre: '' }], data_devolucao_vazio: '2026-02-04', depot: 'DEPOT TESTE' });
    t.tela('f_data_chegada', '2026-03-20');
    t.rodar(`_containers = [{ numero: 'TSTU0000001', tipo: '40HC', lacre: '' }, { numero: 'TSTU0000002', tipo: '40HC', lacre: '' }];`);
    await t.ler();
    iguais(t.rodar('_containers.map(c => c.devolucao || "")'), ['', '2026-04-02']);
  });
  await testeAsync('RIC (2 containers) impossível nos dois sentidos: não grava a data (o depot sim)', async () => {
    const t = telaComIA({ eh_ric: true, containers: [{ numero: 'TSTU0000002', lacre: '' }], data_devolucao_vazio: '2026-03-15', depot: 'DEPOT TESTE' });
    t.tela('f_data_chegada', '2026-03-20');
    t.rodar(`_containers = [{ numero: 'TSTU0000001', tipo: '40HC', lacre: '' }, { numero: 'TSTU0000002', tipo: '40HC', lacre: '' }];`);
    await t.ler();
    iguais(t.rodar('_containers.map(c => [c.devolucao || "", c.depot || ""])'), [['', ''], ['', 'DEPOT TESTE']]);
    ok(t.toasts.some(x => /data\(s\) conferida/.test(x[1])), JSON.stringify(t.toasts));
  });
  await testeAsync('DI registrada antes da atracação (chegada no futuro): a chegada vai para o ETA, sem troca', async () => {
    const daqui40 = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10); // sempre no futuro
    const t = telaComIA({ numero_di: '26BR0000000001-0', data_registro_di: '2026-10-10', data_chegada: daqui40, canal: 'VERDE' });
    t.tela('f_data_embarque', '2026-09-01');
    await t.ler();
    iguais([t.els.f_data_chegada.value, t.els.f_eta.value, t.els.f_data_registro_di.value], ['', daqui40, '2026-10-10']);
    ok(t.toasts.some(x => /data\(s\) conferida/.test(x[1])), JSON.stringify(t.toasts));
  });
  await testeAsync('NF de entrada (leitura geral) antes do registro da DI: data trocada', async () => {
    const t = telaComIA({ nf_entrada_numero: '123', nf_entrada_data: '2026-02-04', nf_entrada_valor: 1000 });
    t.tela('f_data_registro_di', '2026-03-30');
    await t.ler();
    iguais(t.els.f_nf_entrada_data.value, '2026-04-02');
  });
  await testeAsync('CE Mercante: chegada lida fora da DI continua indo para o ETA e é conferida como ETA', async () => {
    const t = telaComIA({ ce_master: '123456789012345', data_chegada: '2026-03-08', etd: '2026-04-20' });
    await t.ler();
    iguais([t.els.f_eta.value, t.els.f_data_chegada.value], ['2026-08-03', '']);
  });
  await testeAsync('Documento com datas certas: nada muda e não há aviso de datas', async () => {
    const t = telaComIA({ numero_di: '26/0000001-0', data_registro_di: '2026-04-05', data_liberacao: '2026-04-06', data_chegada: '2026-04-03' });
    t.tela('f_data_embarque', '2026-02-20');
    await t.ler();
    iguais([t.els.f_data_registro_di.value, t.els.f_data_liberacao.value, t.els.f_data_chegada.value], ['2026-04-05', '2026-04-06', '2026-04-03']);
    ok(!t.toasts.some(x => /conferida/.test(x[1])), JSON.stringify(t.toasts));
  });
  await testeAsync('Extrator de NF (PDF lido pela IA): NF de entrada antes da DI tem a data trocada e avisada', async () => {
    const t = telaComIA({ tipo: 'ENTRADA', nf_numero: '555', nf_data: '2026-02-04', nf_valor: 100, cfop: '3102', itens: [] });
    t.rodar(`_editando = { id: 'p-teste', _camposIA: {}, log: [] };`); t.tela('f_data_registro_di', '2026-03-30');
    await t.rodar(`importarNFSaidaProcessoArquivo({ name: 'nf-teste.pdf', type: 'application/pdf' })`);
    iguais(t.els.f_nf_entrada_data.value, '2026-04-02');
    ok(t.toasts.some(x => /Usei 02\/04\/2026/.test(x[1])), JSON.stringify(t.toasts));
  });
  await testeAsync('Extrator de NF com XML: a data do XML é exata e não passa pela troca', async () => {
    const t = telaComIA({});
    t.rodar(`_editando = { id: 'p-teste', _camposIA: {}, log: [] };`); t.tela('f_data_registro_di', '2026-03-30');
    t.rodar(`parseNFeXml = async () => ({ tipo: 'ENTRADA', cliente: '', nf_numero: '556', nf_data: '2026-02-04', nf_valor: 100, cfop: '3102', itens: [] });`);
    await t.rodar(`importarNFSaidaProcessoArquivo({ name: 'nf-teste.xml', type: 'text/xml' })`);
    iguais(t.els.f_nf_entrada_data.value, '2026-02-04');
  });

  console.log('\n── Rede: erro que não veio do sistema (chat.js) ──');
  await testeAsync('502 com página HTML (atualização no ar) vira { ok:false, erro } que diz o que fazer', async () => {
    const f = redeDoChatJs(() => resposta(502, '<html><body>Bad Gateway</body></html>', 'text/html'));
    const r = await f('/api/controle/v2/processos', { method: 'POST', body: '{"a":1}' });
    iguais(r.status, 502);
    const d = await r.json();
    iguais(d.ok, false); ok(/reiniciando/.test(d.erro) && /Nada foi salvo/.test(d.erro), d.erro);
  });
  await testeAsync('413 do proxy (sem JSON) explica o limite de tamanho', async () => {
    const f = redeDoChatJs(() => resposta(413, 'Request Entity Too Large', 'text/plain'));
    const d = await (await f('/api/controle/v2/arquivos', { method: 'POST', body: 'x' })).json();
    ok(/15 MB/.test(d.erro), d.erro);
  });
  await testeAsync('erro JSON do próprio sistema passa intacto', async () => {
    const f = redeDoChatJs(() => resposta(409, JSON.stringify({ ok: false, erro: 'Outra pessoa salvou antes.' }), 'application/json'));
    const d = await (await f('/api/controle/v2/processos/1', { method: 'PUT', body: '{}' })).json();
    iguais(d.erro, 'Outra pessoa salvou antes.');
  });
  await testeAsync('arquivo comum (fora de /api) não é mexido', async () => {
    const f = redeDoChatJs(() => resposta(404, 'not found', 'text/plain'));
    const r = await f('/assets/inexistente.png');
    iguais(await r.text(), 'not found');
  });
  await testeAsync('sem internet: "Failed to fetch" vira mensagem que diz o que fazer', async () => {
    const f = redeDoChatJs(() => Promise.reject(new TypeError('Failed to fetch')));
    let msg = '';
    try { await f('/api/fin/bancos'); } catch (e) { msg = e.message; }
    ok(/Sem conexão com o servidor/.test(msg), msg);
  });

  console.log('\n── Mensagens de erro do servidor (lib/erros-amigaveis.js) ──');
  const { traduzirErro } = require('./lib/erros-amigaveis');
  teste('arquivo acima do limite do armazenamento → limite + o que fazer', () => {
    ok(/15 MB/.test(traduzirErro('The object exceeded the maximum allowed size').msg));
  });
  teste('erro de programação (TypeError) não aparece em inglês pra pessoa', () => {
    const t = traduzirErro("Cannot read properties of undefined (reading 'id')");
    iguais(t.traduzido, true); ok(/avise o suporte/.test(t.msg), t.msg);
  });
  teste('mensagem em português do sistema continua igual', () => {
    iguais(traduzirErro('"nota.pdf" tem 18,2 MB — o limite do GED é 15 MB por arquivo.').traduzido, false);
  });

  console.log(`\nTotal: ${total} testes, ${passaram} passaram, ${total - passaram} falharam`);
  if (passaram !== total) process.exit(1);
})();
