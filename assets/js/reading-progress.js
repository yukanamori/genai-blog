/* reading-progress.js — Article reading progress bar */
(function () {
  'use strict';

  const bar = document.querySelector('.reading-progress__fill');
  const articleBody = document.querySelector('.article-body');

  if (!bar || !articleBody) return;

  function update() {
    const rect = articleBody.getBoundingClientRect();
    const articleTop = rect.top + window.scrollY;
    const articleHeight = rect.height;
    const scrolled = window.scrollY - articleTop;
    const progress = Math.min(Math.max(scrolled / (articleHeight - window.innerHeight + 200), 0), 1);
    bar.style.width = (progress * 100) + '%';
  }

  window.addEventListener('scroll', update, { passive: true });
  update();
})();
