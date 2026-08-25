(() => {
  'use strict';

  const PROJECT_URL = 'https://tgienxsborizhisbkfik.supabase.co';
  const PUBLIC_KEY = 'sb_publishable_0VM_0MDbFJe4-G_cwKbSrg_bezz59D6';
  const TRACK_ENDPOINT = PROJECT_URL + '/rest/v1/rpc/track_funnel_event';
  const SESSION_TTL_MS = 30 * 60 * 1000;
  const SESSION_KEY = 'fdp_funnel_session_v1';
  const VISITOR_KEY = 'fdp_visitor_id_v1';
  const QUEUE_KEY = 'fdp_analytics_queue_v1';
  const QUIZ_CONTEXT_KEY = 'fdp_quiz_context_v1';
  const SITE_ID = 'formula-dos-pros';
  const ANALYTICS_VERSION = 2;
  const MAX_QUEUE = 80;

  const memoryStore = {};
  const safeStorage = {
    get(key) {
      try { return window.localStorage.getItem(key); }
      catch { return memoryStore[key] || null; }
    },
    set(key, value) {
      try { window.localStorage.setItem(key, value); }
      catch { memoryStore[key] = value; }
    }
  };

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
      const value = Math.random() * 16 | 0;
      return (char === 'x' ? value : (value & 0x3 | 0x8)).toString(16);
    });
  }

  function readJson(key, fallback) {
    try { return JSON.parse(safeStorage.get(key)) || fallback; }
    catch { return fallback; }
  }

  function writeJson(key, value) {
    safeStorage.set(key, JSON.stringify(value));
  }

  function clean(value, maxLength = 250) {
    if (value == null) return null;
    return String(value).trim().slice(0, maxLength) || null;
  }

  function getVisitorId() {
    let id = safeStorage.get(VISITOR_KEY);
    if (!id) {
      id = uuid();
      safeStorage.set(VISITOR_KEY, id);
    }
    return id;
  }

  function getAttribution(previous) {
    const params = new URLSearchParams(window.location.search);
    const current = {
      utm_source: clean(params.get('utm_source'), 120),
      utm_medium: clean(params.get('utm_medium'), 120),
      utm_campaign: clean(params.get('utm_campaign'), 160),
      utm_content: clean(params.get('utm_content'), 160),
      utm_term: clean(params.get('utm_term'), 160),
      fbclid: clean(params.get('fbclid'), 220),
      gclid: clean(params.get('gclid'), 220)
    };
    const old = previous || {};
    Object.keys(current).forEach((key) => {
      if (!current[key] && old[key]) current[key] = old[key];
    });
    return current;
  }

  function getSession() {
    const now = Date.now();
    const saved = readJson(SESSION_KEY, null);
    const valid = saved && saved.id && saved.lastActivity && now - saved.lastActivity < SESSION_TTL_MS;
    const session = valid ? saved : {
      id: uuid(),
      startedAt: new Date(now).toISOString(),
      lastActivity: now,
      attribution: getAttribution(saved && saved.attribution)
    };
    session.lastActivity = now;
    session.attribution = getAttribution(session.attribution);
    writeJson(SESSION_KEY, session);
    return session;
  }

  function deviceType() {
    const width = Math.max(window.innerWidth || 0, window.screen && window.screen.width || 0);
    if (width <= 767) return 'mobile';
    if (width <= 1024) return 'tablet';
    return 'desktop';
  }

  const visitorId = getVisitorId();
  const session = getSession();
  const pageType = document.documentElement.dataset.page || 'quiz';
  const savedQuizContext = readJson(QUIZ_CONTEXT_KEY, null);
  const quizContext = savedQuizContext && savedQuizContext.session_id === session.id ? savedQuizContext : null;
  const pageStartedAt = Date.now();
  let currentStep = pageType === 'landing' ? 22 : 1;
  let stepStartedAt = Date.now();
  let completed = Boolean(quizContext && quizContext.completed_at);
  let exitSent = false;
  let flushing = false;
  const knownAnswers = { ...((quizContext && quizContext.answers) || {}) };

  function persistQuizContext(completedAt) {
    const previous = readJson(QUIZ_CONTEXT_KEY, null);
    const context = {
      session_id: session.id,
      answers: { ...knownAnswers },
      completed_at: completedAt || (previous && previous.session_id === session.id ? previous.completed_at : null)
    };
    writeJson(QUIZ_CONTEXT_KEY, context);
    return context;
  }

  function context() {
    return {
      site_id: SITE_ID,
      landing_url: clean(window.location.href, 1000),
      referrer: clean(document.referrer, 1000),
      device_type: deviceType(),
      screen_width: window.screen && window.screen.width || window.innerWidth || null,
      screen_height: window.screen && window.screen.height || window.innerHeight || null,
      browser_language: clean(navigator.language, 30),
      timezone: clean(Intl.DateTimeFormat().resolvedOptions().timeZone, 80),
      ...session.attribution
    };
  }

  function queuePayload(payload) {
    const queue = readJson(QUEUE_KEY, []);
    queue.push(payload);
    writeJson(QUEUE_KEY, queue.slice(-MAX_QUEUE));
  }

  async function send(payload, queueOnFail = true) {
    session.lastActivity = Date.now();
    writeJson(SESSION_KEY, session);
    try {
      const response = await fetch(TRACK_ENDPOINT, {
        method: 'POST',
        keepalive: true,
        headers: {
          apikey: PUBLIC_KEY,
          Authorization: 'Bearer ' + PUBLIC_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ p_payload: payload })
      });
      if (!response.ok) throw new Error('Supabase ' + response.status);
      return true;
    } catch (error) {
      if (queueOnFail) queuePayload(payload);
      return false;
    }
  }

  async function flushQueue() {
    if (flushing || !navigator.onLine) return;
    const queue = readJson(QUEUE_KEY, []);
    if (!queue.length) return;
    flushing = true;
    const remaining = [];
    for (const payload of queue) {
      if (!await send(payload, false)) remaining.push(payload);
    }
    writeJson(QUEUE_KEY, remaining.slice(-MAX_QUEUE));
    flushing = false;
  }

  function event(eventName, options = {}) {
    const payload = {
      event_id: uuid(),
      session_id: session.id,
      visitor_id: visitorId,
      event_name: eventName,
      step_number: Number.isFinite(Number(options.step)) ? Number(options.step) : currentStep,
      question_key: clean(options.questionKey, 80),
      answer_value: clean(options.answerValue, 250),
      occurred_at: new Date().toISOString(),
      context: context(),
      metadata: options.metadata && typeof options.metadata === 'object' ? options.metadata : {}
    };
    payload.metadata.analytics_version = ANALYTICS_VERSION;
    void send(payload);
    return payload.event_id;
  }

  function stage(step, label) {
    const nextStep = Number(step) || 1;
    const now = Date.now();
    if (currentStep && stepStartedAt && currentStep !== nextStep) {
      event('step_duration', {
        step: currentStep,
        metadata: { duration_ms: now - stepStartedAt }
      });
    }
    currentStep = nextStep;
    stepStartedAt = now;
    event('step_viewed', { step: nextStep, metadata: { label: clean(label, 180) } });
  }

  function answer(questionKey, answerValue, step) {
    knownAnswers[questionKey] = answerValue;
    persistQuizContext();
    event('answer_selected', {
      step,
      questionKey,
      answerValue,
      metadata: { answer_label: clean(answerValue, 250) }
    });
  }

  function action(eventName, metadata, step) {
    event(eventName, { step, metadata: metadata || {} });
  }

  function complete(allAnswers) {
    if (completed) return;
    completed = true;
    if (allAnswers && typeof allAnswers === 'object') Object.assign(knownAnswers, allAnswers);
    persistQuizContext(new Date().toISOString());
    event('quiz_completed', {
      step: currentStep,
      metadata: {
        duration_ms: Date.now() - pageStartedAt,
        answers: allAnswers || knownAnswers
      }
    });
  }

  function landingUnlocked(allAnswers) {
    if (allAnswers && typeof allAnswers === 'object') Object.assign(knownAnswers, allAnswers);
    persistQuizContext();
    event('landing_unlocked', { step: currentStep, metadata: { answers: allAnswers || knownAnswers } });
  }

  function trackCheckout(anchor) {
    const href = anchor && anchor.href || '';
    event('checkout_clicked', {
      step: currentStep,
      metadata: {
        checkout_url: clean(href, 1000),
        country: knownAnswers.country || null,
        position: knownAnswers.position || null,
        price: clean(document.getElementById('offer-price')?.textContent, 40),
        button_text: clean(anchor?.textContent, 120)
      }
    });
  }

  document.addEventListener('click', (eventObject) => {
    const anchor = eventObject.target.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    if (anchor.id === 'offer-checkout' || anchor.classList.contains('upsell-btn-full') || anchor.classList.contains('q-card-buy') || /ggcheckout\.app|pay\.hotmart\.com|pagar\.formula-dos-pros\.com\.br/i.test(href)) {
      trackCheckout(anchor);
    }
  }, true);

  function sendExit() {
    if (exitSent) return;
    exitSent = true;
    event('page_exited', {
      step: currentStep,
      metadata: {
        completed,
        page_duration_ms: Date.now() - pageStartedAt,
        step_duration_ms: Date.now() - stepStartedAt
      }
    });
  }

  window.addEventListener('online', flushQueue);
  window.addEventListener('pagehide', sendExit);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sendExit();
  });

  window.FunnelAnalytics = {
    stage,
    answer,
    action,
    complete,
    landingUnlocked,
    checkout: trackCheckout,
    flush: flushQueue,
    getSessionId: () => session.id,
    getAnswers: () => ({ ...knownAnswers }),
    getQuizContext: () => {
      const context = readJson(QUIZ_CONTEXT_KEY, null);
      return context && context.session_id === session.id ? context : null;
    }
  };

  if (pageType === 'landing') {
    event('offer_viewed', {
      step: 22,
      metadata: {
        entry_mode: quizContext && quizContext.completed_at ? 'quiz' : 'direct',
        country: knownAnswers.country || null,
        position: knownAnswers.position || null
      }
    });
  } else {
    event('funnel_started', { step: 1, metadata: { session_started_at: session.startedAt } });
  }
  void flushQueue();
})();
