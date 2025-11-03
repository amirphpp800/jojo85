// Load data and render page
async function loadData() {
  try {
    const [entriesRes, usersRes] = await Promise.all([
      fetch('/api/ipv6'),
      fetch('/api/users/count')
    ]);
    
    const entries = await entriesRes.json();
    const userData = await usersRes.json();
    const userCount = userData.count || 0;
    
    renderEntries(entries);
    updateStats(entries, userCount);
  } catch (e) {
    console.error('خطا در بارگذاری داده‌ها:', e);
    Toast.error('خطا در بارگذاری داده‌ها');
  }
}

function renderEntries(entries) {
  const dnsGrid = document.getElementById('dns-grid');
  if (!dnsGrid) return;
  
  if (entries.length === 0) {
    dnsGrid.innerHTML = '<div class="empty-state">هنوز هیچ IPv6 ثبت نشده است</div>';
    return;
  }
  
  const html = entries.map(e => {
    const flag = countryCodeToFlag(e.code);
    const count = Array.isArray(e.addresses) ? e.addresses.length : 0;
    const stockColor = (e.stock || 0) > 5 ? '#10b981' : (e.stock || 0) > 0 ? '#f59e0b' : '#ef4444';
    
    return `
    <div class="dns-card">
      <div class="card-header">
        <div class="country-info">
          <span class="country-flag">${flag}</span>
          <div class="country-details">
            <h3>${escapeHtml(e.country)}</h3>
            <span class="country-code">${escapeHtml(e.code)}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn-edit" onclick="editCountry('${escapeHtml(e.code)}', '${escapeHtml(e.country)}')" title="ویرایش نام">✏️</button>
          <form method="POST" action="/api/admin/delete-ipv6" style="display:inline;">
            <input type="hidden" name="code" value="${escapeHtml(e.code)}">
            <button type="submit" class="btn-delete" onclick="return confirm('آیا مطمئن هستید؟')" title="حذف">🗑️</button>
          </form>
        </div>
      </div>
      <div class="card-body">
        <div class="stat-item">
          <span class="stat-label">موجودی:</span>
          <span class="stat-value" style="color: ${stockColor};">${e.stock ?? 0}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">تعداد آدرس:</span>
          <span class="stat-value">${count}</span>
        </div>
      </div>
      <div class="card-footer">
        <details>
          <summary>مشاهده آدرس‌ها</summary>
          <div class="addresses-list">
            ${count > 0 ? e.addresses.map(addr => `<code>${escapeHtml(addr)}</code>`).join('') : '<span class="empty">هیچ آدرسی ثبت نشده</span>'}
          </div>
        </details>
      </div>
    </div>`;
  }).join('\n');
  
  dnsGrid.innerHTML = html;
}

function updateStats(entries, userCount) {
  const countryCount = document.getElementById('country-count');
  const totalStock = document.getElementById('total-stock');
  const userCountEl = document.getElementById('user-count');
  const entriesBadge = document.getElementById('entries-badge');
  
  if (countryCount) countryCount.textContent = entries.length;
  if (totalStock) totalStock.textContent = entries.reduce((sum, e) => sum + (e.stock || 0), 0);
  if (userCountEl) userCountEl.textContent = userCount;
  if (entriesBadge) entriesBadge.textContent = `${entries.length} مورد`;
}

// Edit Country Name
function editCountry(code, currentName) {
  const newName = prompt('نام جدید کشور را وارد کنید:', currentName);
  if (newName && newName.trim() !== '' && newName !== currentName) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/api/admin/add-ipv6';
    
    const actionInput = document.createElement('input');
    actionInput.type = 'hidden';
    actionInput.name = 'action';
    actionInput.value = 'edit';
    
    const codeInput = document.createElement('input');
    codeInput.type = 'hidden';
    codeInput.name = 'existing_code';
    codeInput.value = code;
    
    const countryInput = document.createElement('input');
    countryInput.type = 'hidden';
    countryInput.name = 'country';
    countryInput.value = newName.trim();
    
    form.appendChild(actionInput);
    form.appendChild(codeInput);
    form.appendChild(countryInput);
    document.body.appendChild(form);
    form.submit();
  }
}

// Fix Country Names
async function fixCountryNames() {
  if (!confirm('آیا می‌خواهید تمام اسم‌های کشورها را به فارسی تبدیل کنید؟')) return;
  
  try {
    const res = await fetch('/api/admin/fix-country-names-ipv6', { method: 'POST' });
    const data = await res.json();
    
    if (data.success) {
      Toast.success(`✅ ${data.updated} کشور بروزرسانی شد`);
      setTimeout(() => location.reload(), 2000);
    } else {
      Toast.error('❌ خطا در بروزرسانی');
    }
  } catch (e) {
    Toast.error('❌ خطا در ارتباط با سرور');
  }
}

// Remove Duplicates
async function removeDuplicates() {
  if (!confirm('آیا می‌خواهید آدرس‌های تکراری را از همه کشورها حذف کنید؟')) return;
  
  try {
    const res = await fetch('/api/admin/remove-duplicates-ipv6', { method: 'POST' });
    const data = await res.json();
    
    if (data.success) {
      Toast.success(`✅ ${data.removed} آدرس تکراری حذف شد`);
      setTimeout(() => location.reload(), 2000);
    } else {
      Toast.error('❌ خطا در حذف تکراری‌ها');
    }
  } catch (e) {
    Toast.error('❌ خطا در ارتباط با سرور');
  }
}

// Download JSON
async function downloadJSON() {
  try {
    const res = await fetch('/api/ipv6');
    const data = await res.json();
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ipv6-addresses-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    Toast.success('✅ فایل JSON دانلود شد');
  } catch (e) {
    Toast.error('❌ خطا در دانلود فایل');
  }
}

// Bulk Add Form Handler
function initBulkAddForm() {
  const bulkForm = document.querySelector('form[action="/api/admin/bulk-add-ipv6"]');
  if (!bulkForm) return;
  
  bulkForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const submitBtn = document.getElementById('bulk-submit');
    const progressDiv = document.getElementById('bulk-progress');
    const progressFill = progressDiv.querySelector('.progress-fill');
    const progressText = progressDiv.querySelector('.progress-text');
    const currentIpEl = progressDiv.querySelector('.current-ip');
    const errorList = progressDiv.querySelector('.error-list');
    const errorItems = errorList.querySelector('.error-items');
    
    const addresses = bulkForm.querySelector('textarea[name="addresses"]').value
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
    
    if (addresses.length === 0) {
      Toast.error('❌ لطفاً حداقل یک آدرس وارد کنید');
      return;
    }
    
    submitBtn.disabled = true;
    progressDiv.style.display = 'block';
    currentIpEl.style.display = 'block';
    errorList.style.display = 'none';
    errorItems.innerHTML = '';
    
    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    
    for (let i = 0; i < addresses.length; i++) {
      const ip = addresses[i];
      const progress = ((i + 1) / addresses.length) * 100;
      progressFill.style.width = progress + '%';
      currentIpEl.textContent = `در حال پردازش: ${ip}`;
      progressText.textContent = `${i + 1} از ${addresses.length} آدرس پردازش شد`;
      
      try {
        const formData = new FormData();
        formData.append('addresses', ip);
        
        const res = await fetch('/api/admin/bulk-add-ipv6', {
          method: 'POST',
          body: formData
        });
        
        const data = await res.json();
        
        if (data.success) {
          successCount++;
        } else {
          errorCount++;
          errors.push({ ip, reason: data.message || 'خطای نامشخص' });
        }
      } catch (e) {
        errorCount++;
        errors.push({ ip, reason: 'خطا در ارتباط با سرور' });
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    currentIpEl.style.display = 'none';
    progressText.textContent = `✅ پردازش کامل شد: ${successCount} موفق، ${errorCount} خطا`;
    
    if (errors.length > 0) {
      errorList.style.display = 'block';
      errorItems.innerHTML = errors.map(e => 
        `<div class="error-item"><code>${e.ip}</code>: ${e.reason}</div>`
      ).join('');
    }
    
    Toast.success(`✅ ${successCount} آدرس با موفقیت اضافه شد`);
    
    setTimeout(() => {
      submitBtn.disabled = false;
      if (successCount > 0) {
        location.reload();
      }
    }, 3000);
  });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  initBulkAddForm();
});
