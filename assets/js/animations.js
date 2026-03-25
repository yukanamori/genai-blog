/* animations.js — IntersectionObserver scroll reveal */
(function () {
  'use strict';

  if (!('IntersectionObserver' in window)) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    {
      rootMargin: '0px 0px -48px 0px',
      threshold: 0.05
    }
  );

  // Observe all .js-reveal elements
  document.querySelectorAll('.js-reveal').forEach(el => observer.observe(el));

  // Also add .js-reveal dynamically to article body sections
  const articleBody = document.querySelector('.article-body');
  if (articleBody) {
    const sections = articleBody.querySelectorAll('h2, h3, .callout, .key-points, .diagram, figure, .article-summary');
    sections.forEach(el => {
      if (!el.classList.contains('js-reveal')) {
        el.classList.add('js-reveal');
        observer.observe(el);
      }
    });
  }
})();
