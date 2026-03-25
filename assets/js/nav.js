/* nav.js — Mobile menu, scroll-spy TOC */
(function () {
  'use strict';

  // ── Mobile hamburger toggle ──────────────────────────────────
  const toggle = document.querySelector('.site-header__nav-toggle');
  const mobileNav = document.querySelector('.mobile-nav');

  if (toggle && mobileNav) {
    toggle.addEventListener('click', () => {
      const isOpen = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!isOpen));
      mobileNav.classList.toggle('is-open', !isOpen);
      document.body.classList.toggle('nav-open', !isOpen);
    });
  }

  // ── Scroll-spy: highlight active TOC item ───────────────────
  const tocLinks = document.querySelectorAll('.article-toc__item a');
  if (tocLinks.length === 0) return;

  const headings = Array.from(tocLinks)
    .map(link => {
      const id = link.getAttribute('href').slice(1);
      return document.getElementById(id);
    })
    .filter(Boolean);

  let activeIndex = -1;

  function updateActive() {
    const scrollY = window.scrollY + 80;
    let newIndex = -1;

    for (let i = headings.length - 1; i >= 0; i--) {
      if (headings[i].getBoundingClientRect().top + window.scrollY <= scrollY) {
        newIndex = i;
        break;
      }
    }

    if (newIndex !== activeIndex) {
      activeIndex = newIndex;
      document.querySelectorAll('.article-toc__item').forEach((item, i) => {
        item.classList.toggle('is-active', i === newIndex);
      });
    }
  }

  window.addEventListener('scroll', updateActive, { passive: true });
  updateActive();
})();
