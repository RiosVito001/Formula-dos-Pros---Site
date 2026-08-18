(() => {
  'use strict';

  const PROJECT_URL = 'https://tgienxsborizhisbkfik.supabase.co';
  const PUBLIC_KEY = 'sb_publishable_0VM_0MDbFJe4-G_cwKbSrg_bezz59D6';
  const PAGE_SIZE = 1000;
  const MAX_ROWS = 50000;
  const DEFAULT_RANGE_DAYS = 1;

  const STAGES = {
    1: 'Introdução do quiz', 2: 'Está preparado?', 3: 'Bem-vindo ao 1%',
    4: 'País', 5: 'Posição', 6: 'Idade', 7: 'Objetivo principal',
    8: 'Objetivo físico', 9: 'Plano físico', 10: 'Pensamento pós-jogo',
    11: 'Diagnóstico mental', 12: 'O que precisa melhorar', 13: 'Treina, mas não evolui',
    14: 'Conhecimento sobre fáscia', 15: 'Vídeo da fáscia', 16: 'Conhecimento sobre instinto',
    17: 'Vídeo do instinto', 18: 'Conhecimento sobre flow', 19: 'Vídeo do flow',
    20: 'Brindes', 21: 'Analisando o plano'
  };

  const QUESTION_LABELS = {
    ready: 'Está preparado para evoluir?', country: 'País', position: 'Posição', age: 'Idade',
    mainGoal: 'Principal objetivo', physicalGoal: 'Objetivo físico', postGame: 'Pensamento após o jogo',
    awareness: 'Sabe o que precisa melhorar?', plateau: 'Treina, mas não evolui?',
    fascia: 'Conhecimento sobre fáscia', instinct: 'Conhecimento sobre instinto',
    flow: 'Conhecimento sobre flow', gift: 'Resgatou os brindes?',
    heightCm: 'Altura (cm)', weightKg: 'Peso (kg)', imc: 'IMC calculado', imcCategory: 'Classificação do IMC'
  };

  const VALUE_LABELS = {
    prepared: 'Sim, estou preparado', comfortable: 'Prefere o confortável',
    professional: 'Ser jogador profissional', friends: 'Jogar melhor com amigos', fun: 'Diversão', respect: 'Parar de ser zoado',
    lose: 'Perder peso', gain: 'Ganhar massa muscular', maintain: 'Manter o peso', unknown: 'Ainda não sabe',
    more: 'Poderia ter feito mais', training: 'Joga melhor no treino', forget: 'Desaprende no jogo',
    none: 'Não faz ideia', exact: 'Sabe exatamente', some: 'Mais ou menos',
    yes: 'Exatamente isso', sometimes: 'Às vezes', rarely: 'Raramente',
    heard: 'Já ouviu, mas não domina', never: 'Nunca ouviu falar', trained: 'Já tentou treinar', claimed: 'Sim'
  };

  const elements = {};
  let client;
  let currentData = { sessions: [], events: [], answers: [] };

  function $(id) { return document.getElementById(id); }
  function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
  function percent(part, total) { return total ? Math.round(part / total * 100) : 0; }
  function number(value) { return new Intl.NumberFormat('pt-BR').format(value || 0); }
  function dateTime(value) { return value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'; }
  function duration(ms) { if (!ms) return '—'; const seconds = Math.round(ms / 1000); return seconds < 60 ? seconds + 's' : Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's'; }
  function startIso(dateValue) { return new Date(dateValue + 'T00:00:00').toISOString(); }
  function endIso(dateValue) { const date = new Date(dateValue + 'T00:00:00'); date.setDate(date.getDate() + 1); return date.toISOString(); }

  function toast(message, error) {
    elements.toast.textContent = message;
    elements.toast.className = 'toast show' + (error ? ' error' : '');
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => { elements.toast.className = 'toast'; }, 3200);
  }

  function setLoading(loading, message) {
    elements.dashboard.classList.toggle('loading', loading);
    elements.status.textContent = message || '';
  }

  function defaultDates() {
    const today = new Date();
    const earlier = new Date();
    earlier.setDate(today.getDate() - (DEFAULT_RANGE_DAYS - 1));
    const local = (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    elements.dateFrom.value = local(earlier);
    elements.dateTo.value = local(today);
  }

  async function fetchAll(table, columns, dateColumn, from, to) {
    const rows = [];
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
      let query = client.from(table).select(columns).gte(dateColumn, from).lt(dateColumn, to)
        .order(dateColumn, { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
      const { data, error } = await query;
      if (error) throw error;
      rows.push(...data);
      if (data.length < PAGE_SIZE) break;
    }
    return rows;
  }

  async function checkAdmin() {
    const { data, error } = await client.rpc('is_funnel_admin');
    if (error) throw error;
    return data === true;
  }

  function showLogin(message) {
    elements.login.hidden = false;
    elements.dashboard.hidden = true;
    elements.loginMessage.textContent = message || '';
  }

  async function showDashboard() {
    const isAdmin = await checkAdmin();
    if (!isAdmin) {
      await client.auth.signOut();
      showLogin('Este usuário ainda não foi autorizado na tabela funnel_admins.');
      return;
    }
    elements.login.hidden = true;
    elements.dashboard.hidden = false;
    await loadData();
  }

  function uniqueSessions(events, name, step) {
    return new Set(events.filter((item) => item.event_name === name && (step == null || item.step_number === step)).map((item) => item.session_id)).size;
  }

  function sessionIds(events, name, predicate) {
    return new Set(events.filter((item) => item.event_name === name && (!predicate || predicate(item))).map((item) => item.session_id));
  }

  function metricCard(label, value, detail) {
    return '<article class="metric-card"><span class="metric-label">' + escapeHtml(label) + '</span><strong class="metric-value">' + escapeHtml(value) + '</strong><span class="metric-detail">' + escapeHtml(detail || '') + '</span></article>';
  }

  function renderMetrics(sessions, events) {
    const quizIds = sessionIds(events, 'funnel_started');
    const total = quizIds.size;
    const directLpIds = sessionIds(events, 'offer_viewed', (item) => item.metadata?.entry_mode === 'direct');
    const started = uniqueSessions(events, 'step_viewed', 2);
    const completed = uniqueSessions(events, 'quiz_completed');
    const unlocked = uniqueSessions(events, 'landing_unlocked');
    const lpViews = uniqueSessions(events, 'offer_viewed');
    const checkout = uniqueSessions(events, 'checkout_clicked');
    const comfort = uniqueSessions(events, 'comfort_exit');
    const completedEvents = events.filter((item) => item.event_name === 'quiz_completed' && item.metadata?.duration_ms);
    const averageMs = completedEvents.length ? completedEvents.reduce((sum, item) => sum + Number(item.metadata.duration_ms || 0), 0) / completedEvents.length : 0;
    elements.metricGrid.innerHTML = [
      metricCard('Entraram no funil', number(total), '100% das entradas no quiz'),
      metricCard('Entradas diretas na LP', number(directLpIds.size), 'Acessaram /LP sem concluir o quiz'),
      metricCard('Começaram o quiz', number(started), percent(started, total) + '% das entradas'),
      metricCard('Concluíram o quiz', number(completed), percent(completed, total) + '% das entradas'),
      metricCard('LP liberada', number(unlocked), percent(unlocked, total) + '% das entradas'),
      metricCard('Cliques no checkout', number(checkout), percent(checkout, lpViews) + '% de quem viu a LP'),
      metricCard('Saíram no confortável', number(comfort), percent(comfort, total) + '% das entradas'),
      metricCard('Tempo médio do quiz', duration(averageMs), completedEvents.length + ' conclusões medidas'),
      metricCard('Abandono antes da LP', percent(Math.max(0, total - unlocked), total) + '%', number(Math.max(0, total - unlocked)) + ' sessões')
    ].join('');
  }

  function renderFunnel(sessions, events) {
    const quizIds = sessionIds(events, 'funnel_started');
    const quizEvents = events.filter((item) => quizIds.has(item.session_id));
    const total = quizIds.size;
    let previous = total;
    const rows = Object.entries(STAGES).map(([numberStep, label]) => {
      const step = Number(numberStep);
      const count = step === 1 ? total : uniqueSessions(quizEvents, 'step_viewed', step);
      const drop = previous ? Math.max(0, Math.round((previous - count) / previous * 100)) : 0;
      const width = Math.max(count ? 2 : 0, percent(count, total));
      const html = '<div class="funnel-row"><span class="step-number">' + step + '</span><span class="step-name" title="' + escapeHtml(label) + '">' + escapeHtml(label) + '</span><div class="funnel-track"><div class="funnel-fill" style="width:' + width + '%"></div></div><span class="funnel-count">' + number(count) + ' · ' + percent(count, total) + '%</span><span class="funnel-drop">-' + drop + '%</span></div>';
      previous = count;
      return html;
    });
    elements.funnelList.innerHTML = rows.join('') || '<div class="empty-state">Nenhum dado no período.</div>';
  }

  function groupBy(items, keyFn) {
    const groups = new Map();
    items.forEach((item) => {
      const key = keyFn(item) || 'Direto / sem UTM';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    return groups;
  }

  function renderSources(sessions) {
    const groups = [...groupBy(sessions, (item) => item.utm_source).entries()].sort((a, b) => b[1].length - a[1].length);
    elements.sourceTable.innerHTML = groups.slice(0, 12).map(([source, rows]) => {
      const completed = rows.filter((item) => item.is_completed).length;
      const checkout = rows.filter((item) => item.checkout_clicked_at).length;
      return '<tr><td><strong>' + escapeHtml(source) + '</strong></td><td>' + number(rows.length) + '</td><td>' + number(completed) + ' (' + percent(completed, rows.length) + '%)</td><td>' + number(checkout) + ' (' + percent(checkout, rows.length) + '%)</td></tr>';
    }).join('') || '<tr><td colspan="4" class="empty-state">Nenhuma origem encontrada.</td></tr>';
  }

  function topValue(sessions, field) {
    const groups = [...groupBy(sessions.filter((item) => item[field]), (item) => item[field]).entries()].sort((a, b) => b[1].length - a[1].length);
    return groups[0] ? { label: groups[0][0], count: groups[0][1].length } : { label: 'Sem dados', count: 0 };
  }

  function renderAudience(sessions) {
    const cards = [
      ['País principal', topValue(sessions, 'country')], ['Posição principal', topValue(sessions, 'position')],
      ['Faixa de idade principal', topValue(sessions, 'age_range')], ['Dispositivo principal', topValue(sessions, 'device_type')]
    ];
    elements.audienceGrid.innerHTML = cards.map(([title, item]) => '<article class="audience-card"><strong>' + escapeHtml(item.label) + '</strong><span>' + escapeHtml(title) + ' · ' + number(item.count) + ' sessões</span></article>').join('');
  }

  function renderAnswers(answers) {
    const questions = [...groupBy(answers, (item) => item.question_key).entries()].sort((a, b) => Math.min(...a[1].map((item) => item.step_number)) - Math.min(...b[1].map((item) => item.step_number)));
    elements.answersGrid.innerHTML = questions.map(([question, rows]) => {
      const values = [...groupBy(rows, (item) => item.answer_value).entries()].sort((a, b) => b[1].length - a[1].length);
      const total = rows.length;
      return '<article class="answer-card"><h3>' + escapeHtml(QUESTION_LABELS[question] || question) + '</h3>' + values.map(([value, valueRows]) => {
        const rate = percent(valueRows.length, total);
        return '<div class="answer-row"><span class="answer-label" title="' + escapeHtml(VALUE_LABELS[value] || value) + '">' + escapeHtml(VALUE_LABELS[value] || value) + '</span><span class="answer-count">' + number(valueRows.length) + ' · ' + rate + '%</span><div class="answer-track"><div class="answer-fill" style="width:' + rate + '%"></div></div></div>';
      }).join('') + '</article>';
    }).join('') || '<div class="empty-state">Nenhuma resposta registrada no período.</div>';
  }

  function renderSessions(sessions, events) {
    const quizIds = sessionIds(events, 'funnel_started');
    const directLpIds = sessionIds(events, 'offer_viewed', (item) => item.metadata?.entry_mode === 'direct');
    elements.sessionsTable.innerHTML = sessions.slice(0, 100).map((item) => {
      const isDirectLp = directLpIds.has(item.id) && !quizIds.has(item.id);
      const status = item.checkout_clicked_at
        ? '<span class="badge success">Checkout' + (isDirectLp ? ' · LP direta' : '') + '</span>'
        : isDirectLp
          ? '<span class="badge">LP direta</span>'
          : item.is_completed
            ? '<span class="badge">Quiz completo</span>'
            : '<span class="badge muted">Abandonou</span>';
      const progress = isDirectLp ? 'LP' : escapeHtml(item.max_step || 1) + '/21';
      return '<tr><td>' + dateTime(item.started_at) + '</td><td>' + escapeHtml(item.utm_source || 'Direto') + '</td><td>' + escapeHtml(item.country || '—') + '</td><td>' + escapeHtml(item.position || '—') + '</td><td>' + escapeHtml(item.device_type || '—') + '</td><td>' + progress + '</td><td>' + status + '</td></tr>';
    }).join('') || '<tr><td colspan="7" class="empty-state">Nenhuma sessão encontrada.</td></tr>';
  }

  function updateSourceOptions(allSessions) {
    const current = elements.filterSource.value;
    const sources = [...new Set(allSessions.map((item) => item.utm_source).filter(Boolean))].sort();
    elements.filterSource.innerHTML = '<option value="">Todas</option>' + sources.map((source) => '<option value="' + escapeHtml(source) + '">' + escapeHtml(source) + '</option>').join('');
    if (sources.includes(current)) elements.filterSource.value = current;
  }

  async function loadData() {
    if (!elements.dateFrom.value || !elements.dateTo.value) return toast('Escolha o período.', true);
    setLoading(true, 'Carregando os dados do Supabase...');
    try {
      const from = startIso(elements.dateFrom.value);
      const to = endIso(elements.dateTo.value);
      const [allSessions, allEvents, allAnswers] = await Promise.all([
        fetchAll('funnel_sessions', '*', 'started_at', from, to),
        fetchAll('funnel_events', 'event_id,session_id,event_name,step_number,question_key,answer_value,metadata,occurred_at', 'occurred_at', from, to),
        fetchAll('funnel_answers', 'session_id,question_key,step_number,answer_value,answered_at', 'answered_at', from, to)
      ]);
      updateSourceOptions(allSessions);
      const country = elements.filterCountry.value;
      const device = elements.filterDevice.value;
      const source = elements.filterSource.value;
      const sessions = allSessions.filter((item) => (!country || item.country === country) && (!device || item.device_type === device) && (!source || item.utm_source === source));
      const ids = new Set(sessions.map((item) => item.id));
      const events = allEvents.filter((item) => ids.has(item.session_id));
      const answers = allAnswers.filter((item) => ids.has(item.session_id));
      currentData = { sessions, events, answers };
      renderMetrics(sessions, events);
      renderFunnel(sessions, events);
      renderSources(sessions);
      renderAudience(sessions);
      renderAnswers(answers);
      renderSessions(sessions, events);
      elements.status.textContent = number(sessions.length) + ' sessões no período · atualizado às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch (error) {
      console.error(error);
      toast(error.message || 'Não foi possível carregar os dados.', true);
      elements.status.textContent = 'Erro ao carregar. Confira se o SQL foi executado e se seu usuário está autorizado.';
    } finally {
      elements.dashboard.classList.remove('loading');
    }
  }

  function csvCell(value) { return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"'; }
  function exportCsv() {
    const columns = ['started_at','utm_source','utm_medium','utm_campaign','country','position','age_range','main_goal','physical_goal','device_type','max_step','is_completed','completed_at','landing_unlocked_at','checkout_clicked_at'];
    const lines = [columns.map(csvCell).join(';'), ...currentData.sessions.map((row) => columns.map((column) => csvCell(row[column])).join(';'))];
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'funil-formula-dos-pros-' + elements.dateFrom.value + '-a-' + elements.dateTo.value + '.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function init() {
    Object.assign(elements, {
      login: $('login-view'), dashboard: $('dashboard-view'), loginForm: $('login-form'),
      loginMessage: $('login-message'), dateFrom: $('date-from'), dateTo: $('date-to'),
      filterCountry: $('filter-country'), filterDevice: $('filter-device'), filterSource: $('filter-source'),
      metricGrid: $('metric-grid'), funnelList: $('funnel-list'), sourceTable: $('source-table'),
      audienceGrid: $('audience-grid'), answersGrid: $('answers-grid'), sessionsTable: $('sessions-table'),
      status: $('status-line'), toast: $('toast')
    });
    defaultDates();
    if (!window.supabase?.createClient) return showLogin('Não foi possível carregar o cliente do Supabase.');
    client = window.supabase.createClient(PROJECT_URL, PUBLIC_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });

    elements.loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      elements.loginMessage.textContent = 'Entrando...';
      const email = $('login-email').value.trim();
      const password = $('login-password').value;
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) return showLogin('E-mail ou senha inválidos.');
      try { await showDashboard(); }
      catch (errorObject) { showLogin(errorObject.message || 'Usuário sem acesso ao painel.'); }
    });
    $('refresh-button').addEventListener('click', loadData);
    $('export-button').addEventListener('click', exportCsv);
    $('logout-button').addEventListener('click', async () => { await client.auth.signOut(); showLogin(''); });

    const { data } = await client.auth.getSession();
    if (data.session) {
      try { await showDashboard(); }
      catch (error) { showLogin(error.message || 'Não foi possível validar seu acesso.'); }
    } else {
      showLogin('');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
