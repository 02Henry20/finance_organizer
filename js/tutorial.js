import { enterTutorialMode, exitTutorialMode, state, subscribe } from './store.js';
import { TUTORIAL_DATA } from './tutorial-data.js';

const $ = selector => document.querySelector(selector);

const tutorial = {
  active: false,
  stepIndex: 0,
  currentTarget: null,
  previousView: 'overview',
  overlay: null,
  hole: null,
  card: null,
  title: null,
  text: null,
  count: null,
  progress: null,
  backButton: null,
  nextButton: null,
  closeButton: null,
  raf: null,
  observer: null,
  unsub: null
};

const STEPS = [
  {
    view: 'overview',
    target: '[data-view-section="overview"] .balance-card',
    title: 'Overview | net worth at a glance',
    text: 'This hero card summarizes your net worth, its change over the selected comparison window and the linked cashflow context.'
  },
  {
    view: 'overview',
    target: '[data-view-section="overview"] .metric-strip',
    title: 'Liquidity, assets and debt',
    text: 'These compact stats break your situation into spendable cash, invested assets and liabilities.'
  },
  {
    view: 'overview',
    target: '#account-bars-chart',
    title: 'Balance comparison chart',
    text: 'The balances chart orders accounts by value and can optionally show change overlays using the same comparison period as the rest of the dashboard.'
  },
  {
    view: 'reports',
    target: '.reports-toolbar',
    title: 'Reports controls',
    text: 'Switch between month and year views here. On mobile the selector stays compact with the month/year mode in the upper-right and compare controls directly below.'
  },
  {
    view: 'reports',
    target: '.reports-metric-grid',
    title: 'Period analysis stats',
    text: 'Income, spending, net flow and savings rate update for the selected period, including comparison trends and inverse logic for spending-style metrics.'
  },
  {
    view: 'transactions',
    target: '.transactions-card',
    title: 'Transactions table',
    text: 'Filter, sort and review imported rows here. Truncated long categories keep the table readable on both desktop and mobile.'
  },
  {
    view: 'import',
    target: '.main-import',
    title: 'CSV import',
    text: 'Bank exports are parsed here. Ambiguous rows go into the review queue so you can safely check them before they affect reports.'
  },
  {
    view: 'accounts',
    target: '[data-view-section="accounts"] .page-toolbar',
    title: 'Accounts workspace',
    text: 'Accounts are grouped by type. Cash & bank accounts stay together, brokers follow below and hidden accounts remain in their own separate section.'
  },
  {
    view: 'rules',
    before: async () => {
      document.querySelectorAll('.rules-panel.is-folded .mobile-fold-button').forEach(btn => btn.click());
      await wait(220);
    },
    target: '#rules-panel',
    title: 'Rules and categories',
    text: 'Both categories and rules live in searchable scroll areas. On mobile they can fold away by default to keep the screen tidy.'
  },
  {
    view: 'settings',
    target: '.data-card',
    title: 'Data, backups and tutorial mode',
    text: 'Here you can export data, import JSON backups, clear all data with a typed confirmation and replay this guided tutorial whenever you want.'
  }
];

function wait(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createOverlay() {
  if (tutorial.overlay) return;
  const overlay = document.createElement('div');
  overlay.id = 'tutorial-overlay';
  overlay.className = 'tutorial-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="tutorial-scrim"></div>
    <div id="tutorial-hole" class="tutorial-hole" aria-hidden="true"></div>
    <aside class="tutorial-card surface-card" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
      <button id="tutorial-close" class="tutorial-close" type="button" aria-label="Close tutorial">×</button>
      <div class="tutorial-meta">
        <span id="tutorial-count" class="metric-tag">Step 1 of 1</span>
        <strong id="tutorial-title">Guided tutorial</strong>
      </div>
      <p id="tutorial-text" class="tutorial-text"></p>
      <div class="tutorial-controls">
        <button id="tutorial-back" class="secondary-button compact" type="button">Back</button>
        <div class="tutorial-progress"><span id="tutorial-progress-bar"></span></div>
        <button id="tutorial-next" class="primary-button compact" type="button">Next</button>
      </div>
    </aside>
  `;
  document.body.appendChild(overlay);
  tutorial.overlay = overlay;
  tutorial.hole = overlay.querySelector('#tutorial-hole');
  tutorial.card = overlay.querySelector('.tutorial-card');
  tutorial.title = overlay.querySelector('#tutorial-title');
  tutorial.text = overlay.querySelector('#tutorial-text');
  tutorial.count = overlay.querySelector('#tutorial-count');
  tutorial.progress = overlay.querySelector('#tutorial-progress-bar');
  tutorial.backButton = overlay.querySelector('#tutorial-back');
  tutorial.nextButton = overlay.querySelector('#tutorial-next');
  tutorial.closeButton = overlay.querySelector('#tutorial-close');

  tutorial.backButton.addEventListener('click', () => goToStep(tutorial.stepIndex - 1));
  tutorial.nextButton.addEventListener('click', () => {
    if (tutorial.stepIndex >= STEPS.length - 1) finishTutorial();
    else goToStep(tutorial.stepIndex + 1);
  });
  tutorial.closeButton.addEventListener('click', finishTutorial);
  overlay.querySelector('.tutorial-scrim').addEventListener('click', finishTutorial);
}

async function startTutorial() {
  createOverlay();
  tutorial.previousView = document.querySelector('.nav-button.active, .mobile-nav button.active')?.dataset.view || 'overview';
  await enterTutorialMode(TUTORIAL_DATA);
  tutorial.active = true;
  tutorial.overlay.hidden = false;
  document.documentElement.classList.add('tutorial-active');
  document.body.classList.add('tutorial-active');
  tutorial.unsub = subscribe(() => scheduleSpotlightUpdate());
  attachRecomputeListeners();
  await goToStep(0);
}

async function finishTutorial() {
  if (!tutorial.active) return;
  detachRecomputeListeners();
  tutorial.active = false;
  tutorial.overlay.hidden = true;
  document.documentElement.classList.remove('tutorial-active');
  document.body.classList.remove('tutorial-active');
  clearHighlight();
  tutorial.unsub?.();
  tutorial.unsub = null;
  await exitTutorialMode();
  if (tutorial.previousView) switchView(tutorial.previousView);
}

function clearHighlight() {
  tutorial.currentTarget?.classList.remove('tutorial-target-active');
  tutorial.currentTarget = null;
}

function switchView(view) {
  const nav = document.querySelector(`.nav-button[data-view="${view}"], .mobile-nav button[data-view="${view}"]`);
  nav?.click();
}

async function ensureStepContext(step) {
  if (step.view) {
    switchView(step.view);
    await wait(280);
  }
  if (typeof step.before === 'function') {
    await step.before();
    await wait(150);
  }
}

function getStickyOffset() {
  const header = document.querySelector('.app-header');
  return (header?.getBoundingClientRect().height || 0) + 18;
}

function placeSpotlight(target) {
  if (!tutorial.active || !tutorial.hole || !target) return;
  const rect = target.getBoundingClientRect();
  const pad = Math.max(10, Math.min(18, Math.round(Math.min(rect.width, rect.height) * 0.06)));
  tutorial.hole.style.left = `${Math.max(8, rect.left - pad)}px`;
  tutorial.hole.style.top = `${Math.max(8, rect.top - pad)}px`;
  tutorial.hole.style.width = `${Math.min(window.innerWidth - 16, rect.width + pad * 2)}px`;
  tutorial.hole.style.height = `${Math.min(window.innerHeight - 16, rect.height + pad * 2)}px`;
  tutorial.hole.style.borderRadius = `${Math.max(18, Math.min(28, pad * 2))}px`;
}

function scheduleSpotlightUpdate() {
  if (!tutorial.active) return;
  cancelAnimationFrame(tutorial.raf);
  tutorial.raf = requestAnimationFrame(() => {
    if (tutorial.currentTarget) placeSpotlight(tutorial.currentTarget);
  });
}

async function alignTarget(target) {
  const rect = target.getBoundingClientRect();
  const tutorialCardHeight = tutorial.card?.getBoundingClientRect().height || 240;
  const desiredTop = getStickyOffset() + 18;
  const overlapThreshold = window.innerHeight - tutorialCardHeight - 24;
  const absoluteTop = rect.top + window.scrollY;
  const shouldMove = rect.top < desiredTop || rect.bottom > overlapThreshold;
  if (shouldMove) {
    const nextTop = Math.max(0, absoluteTop - desiredTop);
    window.scrollTo({ top: nextTop, behavior: 'smooth' });
    await wait(340);
  }
}

async function goToStep(index) {
  if (!tutorial.active) return;
  tutorial.stepIndex = Math.max(0, Math.min(index, STEPS.length - 1));
  const step = STEPS[tutorial.stepIndex];
  clearHighlight();
  await ensureStepContext(step);
  const target = document.querySelector(step.target);
  tutorial.title.textContent = step.title;
  tutorial.text.textContent = step.text;
  tutorial.count.textContent = `Step ${tutorial.stepIndex + 1} of ${STEPS.length}`;
  tutorial.progress.style.width = `${((tutorial.stepIndex + 1) / STEPS.length) * 100}%`;
  tutorial.backButton.disabled = tutorial.stepIndex === 0;
  tutorial.nextButton.textContent = tutorial.stepIndex === STEPS.length - 1 ? 'Finish' : 'Next';

  if (!target) {
    tutorial.hole.style.width = '0px';
    tutorial.hole.style.height = '0px';
    return;
  }

  await alignTarget(target);
  target.classList.add('tutorial-target-active');
  tutorial.currentTarget = target;
  placeSpotlight(target);
}

function attachRecomputeListeners() {
  const handler = () => scheduleSpotlightUpdate();
  window.addEventListener('resize', handler, { passive: true });
  window.addEventListener('scroll', handler, { passive: true });
  window.visualViewport?.addEventListener('resize', handler, { passive: true });
  tutorial._handler = handler;
  if (tutorial.observer) tutorial.observer.disconnect();
  tutorial.observer = new MutationObserver(() => scheduleSpotlightUpdate());
  tutorial.observer.observe(document.body, { childList: true, subtree: true, attributes: true });
}

function detachRecomputeListeners() {
  const handler = tutorial._handler;
  if (handler) {
    window.removeEventListener('resize', handler);
    window.removeEventListener('scroll', handler);
    window.visualViewport?.removeEventListener('resize', handler);
  }
  tutorial._handler = null;
  tutorial.observer?.disconnect();
}

function injectStartButtonBinding() {
  const bind = () => {
    const button = document.querySelector('#start-guided-tutorial');
    if (button && !button.dataset.boundTutorial) {
      button.dataset.boundTutorial = 'true';
      button.addEventListener('click', startTutorial);
    }
  };
  bind();
  const mo = new MutationObserver(bind);
  mo.observe(document.body, { childList: true, subtree: true });
}

injectStartButtonBinding();
