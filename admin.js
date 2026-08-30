(() => {
  'use strict';
  const PROJECT_URL = 'https://tgienxsborizhisbkfik.supabase.co';
  const PUBLIC_KEY = 'sb_publishable_0VM_0MDbFJe4-G_cwKbSrg_bezz59D6';
  const ANALYTICS_VERSION = 4;
  const PAGE_SIZE = 1000;
  const MAX_ROWS = 50000;
  const STAGES = [
    { step: 1, label: 'Introdução' }, { step: 2, label: 'VSL' },
    { step: 3, label: 'Oferta' }
  ];
  const VSL_POINTS = [10, 25, 50, 75, 90, 100];
  const elements = {};
  let client;
  let currentData = { sessions: [], events: [] };
  function $(id) { return document.getElementById(id); }
  function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
  function percent(part, total) { return total ? Math.round(part / total * 100) : 0; }
  function number(value) { return new Intl.NumberFormat('pt-BR').format(value || 0); }
  function dateTime(value) { return value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'; }
  function startIso(value) { return new Date(value + 'T00:00:00').toISOString(); }
  function endIso(value) { const date = new Date(value + 'T00:00:00'); date.setDate(date.getDate() + 1); return date.toISOString(); }
  function idsFor(events, name, predicate) { return new Set(events.filter((item) => item.event_name === name && (!predicate || predicate(item))).map((item) => item.session_id)); }
  function countFor(events, name, predicate) { return idsFor(events, name, predicate).size; }
  function hasStage(item, step) { return item.event_name === 'step_viewed' && Number(item.step_number) === step; }
  function vslStartedIds(events) { return new Set(events.filter((item) => ['vsl_started', 'vsl_progress', 'vsl_completed'].includes(item.event_name) || hasStage(item, 2) || Number(item.step_number) >= 3).map((item) => item.session_id)); }
  function vslCompletedIds(events) { return new Set(events.filter((item) => item.event_name === 'vsl_completed' || item.event_name === 'offer_viewed' || hasStage(item, 3) || item.event_name === 'checkout_clicked').map((item) => item.session_id)); }
  function offerIds(events) { return new Set(events.filter((item) => item.event_name === 'offer_viewed' || hasStage(item, 3) || item.event_name === 'checkout_clicked').map((item) => item.session_id)); }
  function countStage(events, step) { if (step === 1) return countFor(events, 'funnel_started'); if (step === 2) return vslStartedIds(events).size; if (step === 3) return offerIds(events).size; return 0; }
  function isV2(item) { return Number(item?.metadata?.analytics_version) === ANALYTICS_VERSION; }
  function toast(message, error) { elements.toast.textContent = message; elements.toast.className = 'toast show' + (error ? ' error' : ''); window.clearTimeout(toast.timer); toast.timer = window.setTimeout(() => { elements.toast.className = 'toast'; }, 3200); }
  function setLoading(loading, message) { elements.dashboard.classList.toggle('loading', loading); elements.status.textContent = message || ''; }
  function defaultDates() { const today = new Date(); const local = (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'); elements.dateFrom.value = local(today); elements.dateTo.value = local(today); }
  async function fetchAll(table, columns, dateColumn, from, to) { const rows = []; for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) { const { data, error } = await client.from(table).select(columns).gte(dateColumn, from).lt(dateColumn, to).order(dateColumn, { ascending: false }).range(offset, offset + PAGE_SIZE - 1); if (error) throw error; rows.push(...data); if (data.length < PAGE_SIZE) break; } return rows; }
  async function checkAdmin() { const { data, error } = await client.rpc('is_funnel_admin'); if (error) throw error; return data === true; }
  function showLogin(message) { elements.login.hidden = false; elements.dashboard.hidden = true; elements.loginMessage.textContent = message || ''; }
  async function showDashboard() { if (!await checkAdmin()) { await client.auth.signOut(); showLogin('Este usuário ainda não foi autorizado como administrador.'); return; } elements.login.hidden = true; elements.dashboard.hidden = false; await loadData(); }
  function metricCard(label, value, detail) { return '<article class="metric-card"><span class="metric-label">' + escapeHtml(label) + '</span><strong class="metric-value">' + escapeHtml(value) + '</strong><span class="metric-detail">' + escapeHtml(detail) + '</span></article>'; }
  function renderMetrics(sessions, events) {
    const started = countFor(events, 'funnel_started');
    const vslStarted = vslStartedIds(events).size;
    const vslCompleted = vslCompletedIds(events).size;
    const offer = offerIds(events).size;
    const checkout = countFor(events, 'checkout_clicked');
    elements.metricGrid.innerHTML = [
      metricCard('Entraram no funil', number(started), 'Novas sessões rastreadas'), metricCard('Iniciaram a VSL', number(vslStarted), percent(vslStarted, started) + '% das entradas'),
      metricCard('Concluíram a VSL', number(vslCompleted), percent(vslCompleted, vslStarted) + '% de quem iniciou a VSL'), metricCard('Viram a oferta', number(offer), percent(offer, started) + '% das entradas'),
      metricCard('Cliques no checkout', number(checkout), percent(checkout, offer) + '% de quem viu a oferta'), metricCard('Funil → checkout', percent(checkout, started) + '%', number(checkout) + ' cliques únicos'),
      metricCard('Abandono na VSL', percent(Math.max(0, vslStarted - vslCompleted), vslStarted) + '%', number(Math.max(0, vslStarted - vslCompleted)) + ' sessões'), metricCard('Sessões no período', number(sessions.length), 'Somente analytics V4')
    ].join('');
  }
  function renderFunnel(events) { const total = countFor(events, 'funnel_started'); let previous = total; elements.funnelList.innerHTML = STAGES.map(({ step, label }) => { const count = step === 1 ? total : countStage(events, step); const drop = previous ? Math.max(0, Math.round((previous - count) / previous * 100)) : 0; const width = Math.max(count ? 2 : 0, percent(count, total)); previous = count; return '<div class="funnel-row"><span class="step-number">' + step + '</span><span class="step-name">' + escapeHtml(label) + '</span><div class="funnel-track"><div class="funnel-fill" style="width:' + width + '%"></div></div><span class="funnel-count">' + number(count) + ' · ' + percent(count, total) + '%</span><span class="funnel-drop">-' + drop + '%</span></div>'; }).join(''); }
  function renderRetention(events) { const vslStarts = vslStartedIds(events).size; elements.retentionGrid.innerHTML = VSL_POINTS.map((point) => { const count = countFor(events, 'vsl_progress', (item) => Number(item.metadata?.percent) === point); return '<article class="retention-card"><strong>' + point + '%</strong><span>' + number(count) + ' pessoas</span><small>' + percent(count, vslStarts) + '% retidas</small></article>'; }).join(''); }
  function groupBy(items, keyFn) { const groups = new Map(); items.forEach((item) => { const key = keyFn(item) || 'Direto / sem UTM'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item); }); return groups; }
  function renderSources(sessions, events) { const offerSessionIds = offerIds(events); const checkoutIds = idsFor(events, 'checkout_clicked'); const groups = [...groupBy(sessions, (item) => item.utm_source).entries()].sort((a, b) => b[1].length - a[1].length); elements.sourceTable.innerHTML = groups.slice(0, 12).map(([source, rows]) => { const offer = rows.filter((item) => offerSessionIds.has(item.id)).length; const checkout = rows.filter((item) => checkoutIds.has(item.id)).length; return '<tr><td><strong>' + escapeHtml(source) + '</strong></td><td>' + number(rows.length) + '</td><td>' + number(offer) + ' (' + percent(offer, rows.length) + '%)</td><td>' + number(checkout) + ' (' + percent(checkout, rows.length) + '%)</td></tr>'; }).join('') || '<tr><td colspan="4" class="empty-state">Nenhuma origem encontrada.</td></tr>'; }
  function renderActions(events) { const vslStarts = vslStartedIds(events).size; const completed = vslCompletedIds(events).size; const offer = offerIds(events).size; const items = [['Concluíram a VSL', completed, vslStarts], ['Clicaram para ver a oferta', countFor(events, 'offer_cta_clicked'), completed], ['Visualizaram a oferta', offer, completed], ['Clicaram no checkout', countFor(events, 'checkout_clicked'), offer]]; elements.actionGrid.innerHTML = items.map(([label, count, base]) => '<article class="action-card"><strong>' + number(count) + '</strong><span>' + escapeHtml(label) + '</span><small>' + percent(count, base) + '% de conversão</small></article>').join(''); }
  function sessionStage(events) { if (events.some((item) => item.event_name === 'checkout_clicked')) return 'Checkout'; if (events.some((item) => item.event_name === 'offer_viewed' || hasStage(item, 3))) return 'Oferta'; if (vslStartedIds(events).size) return 'VSL'; return 'Introdução'; }
  function sessionVsl(events) { const progress = events.filter((item) => item.event_name === 'vsl_progress').map((item) => Number(item.metadata?.percent) || 0); if (progress.length) return Math.max(...progress) + '%'; if (events.some((item) => item.event_name === 'vsl_started' || hasStage(item, 2))) return 'Iniciou'; return '—'; }
  function renderSessions(sessions, events) { const bySession = groupBy(events, (item) => item.session_id); elements.sessionsTable.innerHTML = sessions.slice(0, 100).map((item) => { const rows = bySession.get(item.id) || []; const checkout = rows.some((event) => event.event_name === 'checkout_clicked'); const offer = rows.some((event) => event.event_name === 'offer_viewed' || hasStage(event, 3)); const status = checkout ? '<span class="badge success">Checkout</span>' : offer ? '<span class="badge">Oferta</span>' : '<span class="badge muted">Em andamento / saiu</span>'; return '<tr><td>' + dateTime(item.started_at) + '</td><td>' + escapeHtml(item.utm_source || 'Direto') + '</td><td>' + escapeHtml(item.device_type || '—') + '</td><td>' + sessionVsl(rows) + '</td><td>' + escapeHtml(sessionStage(rows)) + '</td><td>' + status + '</td></tr>'; }).join('') || '<tr><td colspan="6" class="empty-state">Nenhuma sessão nova encontrada.</td></tr>'; }
  function updateSourceOptions(sessions) { const current = elements.filterSource.value; const sources = [...new Set(sessions.map((item) => item.utm_source).filter(Boolean))].sort(); elements.filterSource.innerHTML = '<option value="">Todas</option>' + sources.map((source) => '<option value="' + escapeHtml(source) + '">' + escapeHtml(source) + '</option>').join(''); if (sources.includes(current)) elements.filterSource.value = current; }
  async function loadData() {
    if (!elements.dateFrom.value || !elements.dateTo.value) return toast('Escolha o período.', true);
    setLoading(true, 'Carregando os novos dados...');
    try {
      const from = startIso(elements.dateFrom.value); const to = endIso(elements.dateTo.value);
      const [allSessions, rawEvents] = await Promise.all([fetchAll('funnel_sessions', '*', 'started_at', from, to), fetchAll('funnel_events', 'event_id,session_id,event_name,step_number,metadata,occurred_at', 'occurred_at', from, to)]);
      const v3Events = rawEvents.filter(isV2); const newIds = new Set(v3Events.map((item) => item.session_id)); const newSessions = allSessions.filter((item) => newIds.has(item.id));
      updateSourceOptions(newSessions); const device = elements.filterDevice.value; const source = elements.filterSource.value; const sessions = newSessions.filter((item) => (!device || item.device_type === device) && (!source || item.utm_source === source)); const ids = new Set(sessions.map((item) => item.id)); const events = v3Events.filter((item) => ids.has(item.session_id));
      currentData = { sessions, events }; renderMetrics(sessions, events); renderFunnel(events); renderRetention(events); renderSources(sessions, events); renderActions(events); renderSessions(sessions, events);
      elements.status.textContent = number(sessions.length) + ' novas sessões · atualizado às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch (error) { console.error(error); toast(error.message || 'Não foi possível carregar os dados.', true); elements.status.textContent = 'Erro ao carregar os dados. Tente entrar novamente.'; }
    finally { elements.dashboard.classList.remove('loading'); }
  }
  function csvCell(value) { return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"'; }
  function exportCsv() { const rows = currentData.sessions.map((session) => { const events = currentData.events.filter((item) => item.session_id === session.id); return [session.started_at, session.utm_source, session.utm_medium, session.utm_campaign, session.device_type, sessionVsl(events), sessionStage(events), events.some((item) => item.event_name === 'checkout_clicked')]; }); const lines = [['started_at','utm_source','utm_medium','utm_campaign','device_type','vsl_retention','last_stage','checkout_clicked'], ...rows].map((row) => row.map(csvCell).join(';')); const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'funil-formula-dos-pros-v2-' + elements.dateFrom.value + '-a-' + elements.dateTo.value + '.csv'; link.click(); URL.revokeObjectURL(link.href); }
  async function init() {
    Object.assign(elements, { login: $('login-view'), dashboard: $('dashboard-view'), loginForm: $('login-form'), loginMessage: $('login-message'), dateFrom: $('date-from'), dateTo: $('date-to'), filterDevice: $('filter-device'), filterSource: $('filter-source'), metricGrid: $('metric-grid'), funnelList: $('funnel-list'), retentionGrid: $('retention-grid'), sourceTable: $('source-table'), actionGrid: $('action-grid'), sessionsTable: $('sessions-table'), status: $('status-line'), toast: $('toast') });
    defaultDates(); if (!window.supabase?.createClient) return showLogin('Não foi possível carregar o acesso ao painel. Atualize a página.');
    client = window.supabase.createClient(PROJECT_URL, PUBLIC_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
    elements.loginForm.addEventListener('submit', async (event) => { event.preventDefault(); elements.loginMessage.textContent = 'Entrando...'; const { error } = await client.auth.signInWithPassword({ email: $('login-email').value.trim(), password: $('login-password').value }); if (error) return showLogin('E-mail ou senha inválidos.'); try { await showDashboard(); } catch (reason) { showLogin(reason.message || 'Usuário sem acesso ao painel.'); } });
    $('refresh-button').addEventListener('click', loadData); $('export-button').addEventListener('click', exportCsv); $('logout-button').addEventListener('click', async () => { await client.auth.signOut(); showLogin(''); });
    const { data } = await client.auth.getSession(); if (data.session) { try { await showDashboard(); } catch (error) { showLogin(error.message || 'Não foi possível validar seu acesso.'); } } else showLogin('');
  }
  document.addEventListener('DOMContentLoaded', init);
})();
