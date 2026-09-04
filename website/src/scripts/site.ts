const root = document.documentElement;
const themeToggle = document.querySelector<HTMLButtonElement>('[data-theme-toggle]');
const menuToggle = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
const mobileMenu = document.querySelector<HTMLElement>('[data-mobile-menu]');
const navLinks = document.querySelectorAll<HTMLAnchorElement>('[data-nav-link]');

root.classList.add('js');

function updateThemeButton(theme: 'light' | 'dark') {
  if (!themeToggle) return;
  const nextTheme = theme === 'dark' ? 'claro' : 'oscuro';
  themeToggle.setAttribute('aria-label', `Cambiar a modo ${nextTheme}`);
  themeToggle.setAttribute('title', `Cambiar a modo ${nextTheme}`);
  themeToggle.dataset.theme = theme;
}

function setTheme(theme: 'light' | 'dark') {
  root.dataset.theme = theme;
  updateThemeButton(theme);
  try {
    localStorage.setItem('coreos-theme', theme);
  } catch {
    // El tema sigue funcionando si el navegador bloquea localStorage.
  }
}

const currentTheme = root.dataset.theme === 'dark' ? 'dark' : 'light';
updateThemeButton(currentTheme);

themeToggle?.addEventListener('click', () => {
  const nextTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  setTheme(nextTheme);
});

function closeMenu() {
  if (!menuToggle || !mobileMenu) return;
  mobileMenu.classList.remove('is-open');
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', 'Abrir navegación');
}

menuToggle?.addEventListener('click', () => {
  if (!mobileMenu) return;
  const isOpen = mobileMenu.classList.toggle('is-open');
  menuToggle.setAttribute('aria-expanded', String(isOpen));
  menuToggle.setAttribute('aria-label', isOpen ? 'Cerrar navegación' : 'Abrir navegación');
});

navLinks.forEach((link) => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeMenu();
});

if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px' },
  );

  document.querySelectorAll<HTMLElement>('.reveal').forEach((element) => revealObserver.observe(element));
} else {
  document.querySelectorAll<HTMLElement>('.reveal').forEach((element) => element.classList.add('is-visible'));
}
