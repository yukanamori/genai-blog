/* search.js — Client-side article search */
(function () {
  'use strict';

  const input = document.querySelector('.search-bar__input');
  const results = document.querySelector('.search-results');
  const articleList = document.querySelector('.article-list');

  if (!input) return;

  let articles = [];

  fetch('_data/articles.json')
    .then(r => r.json())
    .then(data => { articles = data; })
    .catch(() => {});

  function highlight(text, query) {
    if (!query) return text;
    const re = new RegExp('(' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return text.replace(re, '<mark style="background:var(--color-accent);color:#000;padding:0 2px;">$1</mark>');
  }

  function render(query) {
    const q = query.trim().toLowerCase();

    if (!q) {
      if (results) { results.classList.remove('is-active'); results.innerHTML = ''; }
      if (articleList) articleList.style.display = '';
      return;
    }

    const matched = articles.filter(a =>
      a.title.toLowerCase().includes(q) ||
      a.subtitle.toLowerCase().includes(q) ||
      (a.tags || []).some(t => t.toLowerCase().includes(q))
    );

    if (articleList) articleList.style.display = 'none';
    if (!results) return;

    results.classList.add('is-active');

    if (matched.length === 0) {
      results.innerHTML = '<p style="color:var(--color-text-dim);font-family:var(--font-mono);font-size:var(--text-sm);padding:var(--sp-6) 0;">一致する記事が見つかりません。</p>';
      return;
    }

    results.innerHTML = matched.map(a => `
      <a href="${a.path}" class="article-card">
        <span class="article-card__number">${a.id}</span>
        <span class="article-card__body">
          <span class="article-card__title">${highlight(a.title, query.trim())}</span>
          <span class="article-card__subtitle" style="display:block;">${highlight(a.subtitle, query.trim())}</span>
          <span class="article-card__tags">${(a.tags || []).map(t => `<span class="tag">${t}</span>`).join('')}</span>
        </span>
      </a>
    `).join('');
  }

  input.addEventListener('input', e => render(e.target.value));

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      input.value = '';
      render('');
    }
  });
})();
