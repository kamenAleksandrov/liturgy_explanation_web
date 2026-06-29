/*
  app.js

  Requirements addressed:
  - No frameworks, no build step
  - Load all liturgy text + explanations from external JSON (data/liturgy.json)
  - Render sections (People / Priest) responsively
  - Use IntersectionObserver (no scroll polling) to keep the Explanation panel in sync
  - Keyboard-friendly, no animations required

  Note on graceful degradation:
  - Without JavaScript, the page layout and instructions remain visible.
  - The liturgy content itself is intentionally not hardcoded in HTML per the constraints,
    so it cannot appear without JavaScript.
*/

'use strict';

const DATA_URL = 'data/liturgy.json';

const sectionsRoot = document.getElementById('sections');
const statusEl = document.getElementById('status');

const explanationTitleEl = document.getElementById('explanation-title');
const explanationContentEl = document.getElementById('explanation-content');

/**
 * Render helper: replaces explanation panel content.
 * Uses plain text nodes (no HTML injection).
 */
function setExplanation({ heading, explanation }) {
  explanationTitleEl.textContent = heading;

  // Clear existing
  while (explanationContentEl.firstChild) {
    explanationContentEl.removeChild(explanationContentEl.firstChild);
  }

  const p = document.createElement('p');
  p.textContent = explanation;
  explanationContentEl.appendChild(p);
}

function setStatus(message) {
  statusEl.hidden = false;
  statusEl.textContent = message;
}

function clearStatus() {
  statusEl.hidden = true;
  statusEl.textContent = '';
}

function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function roleLabelFor(type) {
  // Bulgarian labels requested.
  if (type === 'people') return 'Пред олтара';
  return 'В олтара';
}

/**
 * Creates one liturgy section DOM node.
 * The content is strictly textContent / pre-wrap.
 */
function createSectionNode(section) {
  const article = document.createElement('article');
  article.className = 'lit-section';
  article.id = section.id;
  article.tabIndex = -1; // makes it focusable for assistive tech / deep links
  article.dataset.sectionId = section.id;

  const columns = document.createElement('div');
  columns.className = 'columns';

  const frontOfAltar = normalizeText(section.frontOfAltar);
  const inAltar = normalizeText(section.inAltar);

  if (frontOfAltar) {
    columns.appendChild(createRoleBlock('people', frontOfAltar, section.id));
  }

  if (inAltar) {
    columns.appendChild(createRoleBlock('priest', inAltar, section.id));
  }

  article.appendChild(columns);

  return article;
}

function createRoleBlock(role, text, sectionId) {
  const wrapper = document.createElement('section');
  wrapper.className = 'role';
  wrapper.setAttribute('aria-label', role === 'people' ? 'Текст на народа' : 'Текст на свещеника');

  const label = document.createElement('h4');
  label.className = 'role__label';
  label.id = `${sectionId}-${role}-label`;
  label.textContent = roleLabelFor(role);

  const body = document.createElement('p');
  body.className = 'role__text';
  body.setAttribute('aria-labelledby', label.id);
  body.textContent = text;

  wrapper.appendChild(label);
  wrapper.appendChild(body);

  return wrapper;
}

/**
 * IntersectionObserver logic (core requirement)
 *
 * Goal:
 * - As user scrolls, detect which section is "currently visible"
 * - Update the explanation panel with that section's explanation
 *
 * Implementation notes:
 * - We observe every rendered <article>.
 * - We keep the latest IntersectionObserverEntry per section in a Map.
 * - On each callback, we compute the best "active" section:
 *   - consider only entries that are intersecting
 *   - choose the one whose top edge is closest to the top of the viewport
 *     but not too far above (helps when multiple sections intersect)
 */
function setupObserver(sectionsById) {
  const lastEntries = new Map();
  let activeId = null;

  function setActiveSection(id, reason) {
    if (!id || id === activeId) return;

    // Remove previous highlight
    if (activeId) {
      const prevEl = document.querySelector(`[data-section-id="${CSS.escape(activeId)}"]`);
      if (prevEl) {
        prevEl.classList.remove('is-active');
        prevEl.removeAttribute('aria-current');
      }
    }

    activeId = id;

    const el = document.querySelector(`[data-section-id="${CSS.escape(activeId)}"]`);
    if (el) {
      el.classList.add('is-active');
      el.setAttribute('aria-current', 'true');
    }

    const section = sectionsById.get(activeId);
    if (!section) return;

    setExplanation({
      heading: `Обяснение — Раздел ${section.order}`,
      explanation: section.explanation,
    });

    // Reason is intentionally unused in UI (keeps UX minimal),
    // but it helps readability while maintaining logic.
    void reason;
  }

  const thresholds = [0, 0.1, 0.25, 0.5, 0.75, 1];

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const id = entry.target.dataset.sectionId;
      if (id) lastEntries.set(id, entry);
    }

    const candidates = [];
    for (const [id, entry] of lastEntries.entries()) {
      if (!entry.isIntersecting) continue;

      // Use section center distance to viewport center.
      // This behaves better on big screens where multiple sections are visible.
      const rect = entry.boundingClientRect;
      const sectionCenter = rect.top + rect.height / 2;
      const viewportCenter = window.innerHeight / 2;
      const centerDistance = Math.abs(sectionCenter - viewportCenter);

      candidates.push({ id, centerDistance, ratio: entry.intersectionRatio });
    }

    if (candidates.length === 0) return;

    // Choose the intersecting section whose center is closest to the viewport center.
    // Tie-break with higher intersection ratio to reduce jitter.
    candidates.sort((a, b) => {
      if (a.centerDistance !== b.centerDistance) return a.centerDistance - b.centerDistance;
      return b.ratio - a.ratio;
    });

    setActiveSection(candidates[0].id, 'observer');
  }, {
    // Narrow band around center makes switching feel stable.
    root: null,
    rootMargin: '-35% 0px -35% 0px',
    threshold: thresholds,
  });

  for (const id of sectionsById.keys()) {
    const el = document.querySelector(`[data-section-id="${CSS.escape(id)}"]`);
    if (!el) continue;

    // Mouse/touch/keyboard focus should also sync the explanation.
    // This makes it clear "which part" you're reading even when several are visible.
    el.addEventListener('focusin', () => setActiveSection(id, 'focus'));
    el.addEventListener('click', () => setActiveSection(id, 'click'));

    observer.observe(el);
  }
}

async function loadData() {
  const resp = await fetch(DATA_URL, { cache: 'no-cache' });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }

  const data = await resp.json();
  if (!data || !Array.isArray(data.sections)) {
    throw new Error('Invalid JSON format: expected { sections: [...] }');
  }

  return data.sections;
}

function validateSection(section) {
  const required = ['id', 'order', 'frontOfAltar', 'inAltar', 'explanation', 'type'];
  for (const key of required) {
    if (!(key in section)) return `Missing key: ${key}`;
  }

  if (typeof section.id !== 'string' || section.id.trim() === '') return 'Invalid id';
  if (typeof section.order !== 'number') return 'Invalid order (must be number)';
  if (typeof section.explanation !== 'string') return 'Invalid explanation (must be string)';

  const allowed = new Set(['people_only', 'priest_only', 'responsive']);
  if (!allowed.has(section.type)) return 'Invalid type';

  return null;
}

async function init() {
  // Mark JS as available (CSS hides the no-JS note).
  document.documentElement.classList.add('js');

  setStatus('Зареждане на текста…');
  sectionsRoot.setAttribute('aria-busy', 'true');

  let sections;
  try {
    sections = await loadData();
  } catch (err) {
    setStatus(`Грешка при зареждане: ${String(err && err.message ? err.message : err)}`);
    sectionsRoot.setAttribute('aria-busy', 'false');

    const help = document.createElement('p');
    help.className = 'muted';
    help.textContent = 'Провери дали съществува data/liturgy.json и дали е валиден JSON.';
    sectionsRoot.appendChild(help);
    return;
  }

  // Validate + sort by order
  const cleaned = [];
  for (const s of sections) {
    const problem = validateSection(s);
    if (problem) {
      setStatus(`Грешка в данните (${s && s.id ? s.id : 'неизвестен'}): ${problem}`);
      sectionsRoot.setAttribute('aria-busy', 'false');
      return;
    }

    cleaned.push({
      id: s.id.trim(),
      order: s.order,
      frontOfAltar: String(s.frontOfAltar ?? ''),
      inAltar: String(s.inAltar ?? ''),
      explanation: String(s.explanation ?? ''),
      type: s.type,
    });
  }

  cleaned.sort((a, b) => a.order - b.order);

  // Render
  const sectionsById = new Map();
  for (const section of cleaned) {
    sectionsById.set(section.id, section);
    sectionsRoot.appendChild(createSectionNode(section));
  }

  sectionsRoot.setAttribute('aria-busy', 'false');
  clearStatus();

  // Set initial explanation (first section) even before scroll.
  const first = cleaned[0];
  if (first) {
    // Also highlight the first section for clarity.
    const firstEl = document.querySelector(`[data-section-id="${CSS.escape(first.id)}"]`);
    if (firstEl) {
      firstEl.classList.add('is-active');
      firstEl.setAttribute('aria-current', 'true');
    }

    setExplanation({ heading: `Обяснение — Раздел ${first.order}`, explanation: first.explanation });
  }

  setupObserver(sectionsById);
}

init();
