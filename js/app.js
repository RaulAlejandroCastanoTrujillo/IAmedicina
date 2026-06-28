/* ======================================================
   Health AI — Lógica de navegación y utilidades
   ====================================================== */

// ── Navegación SPA ────────────────────────────────────
const sections = document.querySelectorAll('.section');
const navItems = document.querySelectorAll('.nav-item[data-section]');

function navigateTo(sectionId) {
  sections.forEach(s => s.classList.remove('active'));
  navItems.forEach(n => n.classList.remove('active'));

  const target = document.getElementById(sectionId);
  if (target) target.classList.add('active');

  const activeNav = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
  if (activeNav) activeNav.classList.add('active');

  // Actualizar topbar
  const titles = {
    'sec-home':      { title: 'Inicio', sub: 'Panel principal de Health AI' },
    'sec-mediscribe':{ title: 'MediScribe', sub: 'Generación automática de notas SOAP' },
    'sec-historial': { title: 'Historial Clínico', sub: 'Consultas registradas' },
  };

  const info = titles[sectionId];
  if (info) {
    document.getElementById('topbar-title').textContent = info.title;
    document.getElementById('topbar-sub').textContent = info.sub;
  }

  // Cerrar sidebar en móvil
  document.querySelector('.sidebar')?.classList.remove('open');

  // Refrescar el historial (servidor) cada vez que se entra a esa sección
  if (sectionId === 'sec-historial' && typeof window.renderHistorial === 'function') {
    window.renderHistorial();
  }
}

navItems.forEach(item => {
  item.addEventListener('click', () => {
    const section = item.dataset.section;
    if (section) navigateTo(section);
  });
});

// Toggle sidebar móvil
document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
  document.querySelector('.sidebar')?.classList.toggle('open');
});

// ── Estado n8n ────────────────────────────────────────
const N8N_BASE_URL = window.HEALTHAI_CONFIG?.N8N_BASE_URL || 'http://192.168.40.3:5678';
const N8N_WEBHOOK_URL = `${N8N_BASE_URL}/webhook/consulta-medica`;

async function checkN8nStatus() {
  const dot = document.getElementById('status-dot');
  const label = document.getElementById('status-label');
  try {
    // mode: 'no-cors' evita que el navegador bloquee la respuesta por CORS.
    // No podemos leer el contenido, pero si el fetch resuelve (sin lanzar
    // excepción de red) significa que el servidor respondió algo.
    await fetch(N8N_WEBHOOK_URL.replace('/webhook/consulta-medica', '/healthz'), {
      method: 'GET',
      mode: 'no-cors',
      signal: AbortSignal.timeout(4000)
    });
    dot.className = 'dot online';
    label.textContent = 'n8n conectado';
  } catch {
    dot.className = 'dot offline';
    label.textContent = 'n8n sin conexión';
  }
}

// ── Fecha actual ──────────────────────────────────────
function setCurrentDate() {
  const el = document.getElementById('current-date');
  if (el) {
    el.textContent = new Date().toLocaleDateString('es-CO', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }
}

// ── Inicialización ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  navigateTo('sec-home');
  setCurrentDate();
  checkN8nStatus();
  setInterval(checkN8nStatus, 30000);
});
