// Toast Notification System
const Toast = {
  container: null,
  
  init() {
    this.container = document.getElementById('toast-container');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  },
  
  show(message, type = 'info', duration = 5000) {
    this.init();
    
    const icons = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ'
    };
    
    const titles = {
      success: 'موفقیت',
      error: 'خطا',
      warning: 'هشدار',
      info: 'اطلاعات'
    };
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    toast.innerHTML = `
      <div class="toast-icon">${icons[type] || icons.info}</div>
      <div class="toast-content">
        <div class="toast-title">${titles[type] || titles.info}</div>
        <div class="toast-message">${message}</div>
      </div>
      <button class="toast-close" onclick="this.parentElement.remove()">×</button>
    `;
    
    this.container.appendChild(toast);
    
    if (duration > 0) {
      setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
      }, duration);
    }
  },
  
  success(message) { this.show(message, 'success'); },
  error(message) { this.show(message, 'error'); },
  warning(message) { this.show(message, 'warning'); },
  info(message) { this.show(message, 'info'); }
};

// Theme Toggle
function initTheme() {
  const themeToggle = document.getElementById('theme-toggle');
  if (!themeToggle) return;
  
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.body.classList.toggle('dark', savedTheme === 'dark');
  themeToggle.textContent = savedTheme === 'dark' ? '☀️' : '🌙';

  themeToggle.addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    themeToggle.textContent = isDark ? '☀️' : '🌙';
  });
}

// Search Functionality
function initSearch() {
  const searchInput = document.getElementById('search');
  const dnsGrid = document.getElementById('dns-grid');
  if (!searchInput || !dnsGrid) return;
  
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    const cards = Array.from(dnsGrid.querySelectorAll('.dns-card'));
    
    cards.forEach(card => {
      const countryName = card.querySelector('.country-details h3')?.textContent.toLowerCase() || '';
      const countryCode = card.querySelector('.country-code')?.textContent.toLowerCase() || '';
      const matches = countryName.includes(query) || countryCode.includes(query);
      card.style.display = matches ? 'block' : 'none';
    });
  });
}

// Utility Functions
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function countryCodeToFlag(code) {
  if (!code || code.length !== 2) return '🌐';
  const A = 0x1F1E6;
  return Array.from(code.toUpperCase())
    .map(c => String.fromCodePoint(A + c.charCodeAt(0) - 65))
    .join('');
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initSearch();
});
