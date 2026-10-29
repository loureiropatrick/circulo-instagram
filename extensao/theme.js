(() => {
  const key = 'circulo.theme';
  const modes = ['system', 'light', 'dark'];
  const labels = { system: 'Tema: automático', light: 'Tema: claro', dark: 'Tema: escuro' };
  const icons = {
    system: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4"/>',
    dark: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/>'
  };
  const read = () => { try { const v = localStorage.getItem(key); return modes.includes(v) ? v : 'system'; } catch { return 'system'; } };
  const write = mode => { try { localStorage.setItem(key, mode); } catch { /* preferência não persistida */ } };
  const dark = mode => mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const apply = mode => {
    const root = document.documentElement;
    if (mode === 'system') root.removeAttribute('data-theme'); else root.dataset.theme = mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark(mode) ? '#141513' : '#f7f7f3');
  };
  let mode = read();
  apply(mode);
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => apply(mode));
  addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('theme-toggle');
    if (!button) return;
    const paint = () => {
      button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[mode]}</svg>`;
      button.setAttribute('aria-label', `${labels[mode]}. Clique para alterar.`);
      button.title = labels[mode];
    };
    button.addEventListener('click', () => {
      mode = modes[(modes.indexOf(mode) + 1) % modes.length];
      write(mode); apply(mode); paint();
    });
    paint();
  });
})();
