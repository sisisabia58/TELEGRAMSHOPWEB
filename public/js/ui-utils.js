// UI Utilities - Toast Notifications, Loading States, etc.

// Toast Notification System
class ToastManager {
    constructor() {
        this.container = null;
        this.init();
    }

    init() {
        // Create toast container if it doesn't exist
        if (!document.getElementById('toast-container')) {
            this.container = document.createElement('div');
            this.container.id = 'toast-container';
            this.container.className = 'toast-container';
            document.body.appendChild(this.container);
        } else {
            this.container = document.getElementById('toast-container');
        }
    }

    show(message, type = 'info', title = null, duration = 5000) {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };

        toast.innerHTML = `
            <span class="toast-icon">${icons[type] || icons.info}</span>
            <div class="toast-content">
                ${title ? `<div class="toast-title">${title}</div>` : ''}
                <div class="toast-message">${message}</div>
            </div>
            <button class="toast-close" onclick="this.parentElement.remove()">×</button>
        `;

        this.container.appendChild(toast);

        // Auto remove after duration
        if (duration > 0) {
            setTimeout(() => {
                if (toast.parentElement) {
                    toast.style.animation = 'slideOut 0.3s ease-out';
                    setTimeout(() => toast.remove(), 300);
                }
            }, duration);
        }

        return toast;
    }

    success(message, title = 'Berhasil', duration = 5000) {
        return this.show(message, 'success', title, duration);
    }

    error(message, title = 'Error', duration = 7000) {
        return this.show(message, 'error', title, duration);
    }

    warning(message, title = 'Peringatan', duration = 6000) {
        return this.show(message, 'warning', title, duration);
    }

    info(message, title = 'Info', duration = 5000) {
        return this.show(message, 'info', title, duration);
    }
}

// Loading Overlay Manager
class LoadingManager {
    constructor() {
        this.overlay = null;
    }

    show(message = 'Memuat...') {
        if (this.overlay) {
            this.hide();
        }

        this.overlay = document.createElement('div');
        this.overlay.className = 'loading-overlay';
        this.overlay.innerHTML = `
            <div style="text-align: center;">
                <div class="spinner"></div>
                ${message ? `<p style="margin-top: 16px; color: #666;">${message}</p>` : ''}
            </div>
        `;
        document.body.appendChild(this.overlay);
    }

    hide() {
        if (this.overlay && this.overlay.parentElement) {
            this.overlay.remove();
            this.overlay = null;
        }
    }
}

// Form Validation Helper
class FormValidator {
    static validate(formElement) {
        const inputs = formElement.querySelectorAll('input[required], select[required], textarea[required]');
        let isValid = true;

        inputs.forEach(input => {
            if (!input.value.trim()) {
                this.showError(input, 'Field ini wajib diisi');
                isValid = false;
            } else {
                this.clearError(input);
            }
        });

        return isValid;
    }

    static showError(input, message) {
        input.classList.add('error');
        let errorDiv = input.parentElement.querySelector('.form-error');
        if (!errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.className = 'form-error';
            input.parentElement.appendChild(errorDiv);
        }
        errorDiv.textContent = message;
    }

    static clearError(input) {
        input.classList.remove('error');
        const errorDiv = input.parentElement.querySelector('.form-error');
        if (errorDiv) {
            errorDiv.remove();
        }
    }
}

// Search Helper
class SearchHelper {
    static init(searchInput, tableBody, searchColumns = []) {
        if (!searchInput || !tableBody) return;

        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const rows = tableBody.querySelectorAll('tr');

            rows.forEach(row => {
                let found = false;
                const cells = row.querySelectorAll('td');

                cells.forEach((cell, index) => {
                    if (searchColumns.length === 0 || searchColumns.includes(index)) {
                        if (cell.textContent.toLowerCase().includes(query)) {
                            found = true;
                        }
                    }
                });

                row.style.display = found ? '' : 'none';
            });
        });
    }
}

// Confirm Dialog Helper
function confirmAction(message, onConfirm, onCancel = null) {
    if (confirm(message)) {
        if (onConfirm) onConfirm();
    } else {
        if (onCancel) onCancel();
    }
}

// Format Currency Helper
function formatRupiah(nominal) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0
    }).format(nominal);
}

// Format Date Helper
function formatDate(date, format = 'DD MMMM YYYY, HH:mm') {
    // Simple date formatter - you can use moment.js or date-fns for more features
    const d = new Date(date);
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 
                    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    
    const day = d.getDate();
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');

    return `${day} ${month} ${year}, ${hours}:${minutes}`;
}

// Debounce Helper
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Initialize Toast Manager
const toast = new ToastManager();
const loading = new LoadingManager();

// Auto-hide alerts after 5 seconds
document.addEventListener('DOMContentLoaded', () => {
    const alerts = document.querySelectorAll('.alert');
    alerts.forEach(alert => {
        setTimeout(() => {
            alert.style.transition = 'opacity 0.3s';
            alert.style.opacity = '0';
            setTimeout(() => alert.remove(), 300);
        }, 5000);
    });

    // Handle form submissions with loading
    const forms = document.querySelectorAll('form[data-loading]');
    forms.forEach(form => {
        form.addEventListener('submit', (e) => {
            if (FormValidator.validate(form)) {
                loading.show('Memproses...');
            }
        });
    });

    // Handle links with loading
    const loadingLinks = document.querySelectorAll('a[data-loading]');
    loadingLinks.forEach(link => {
        link.addEventListener('click', () => {
            loading.show('Memuat...');
        });
    });
});

// Enhanced Sidebar Toggle with Backdrop
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const body = document.body;
    
    if (sidebar) {
        sidebar.classList.toggle('open');
        body.classList.toggle('sidebar-open');
    }
}

// Close sidebar when clicking backdrop
document.addEventListener('click', (e) => {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.querySelector('.sidebar-toggle');
    const body = document.body;
    
    if (window.innerWidth <= 768 && 
        sidebar && 
        sidebar.classList.contains('open') && 
        !sidebar.contains(e.target) && 
        (!toggleBtn || !toggleBtn.contains(e.target)) &&
        body.classList.contains('sidebar-open')) {
        sidebar.classList.remove('open');
        body.classList.remove('sidebar-open');
    }
});

// Close sidebar on escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const sidebar = document.getElementById('sidebar');
        if (sidebar && sidebar.classList.contains('open')) {
            sidebar.classList.remove('open');
            document.body.classList.remove('sidebar-open');
        }
    }
});

// Handle window resize for sidebar
function handleSidebarResize() {
    const sidebar = document.getElementById('sidebar');
    if (window.innerWidth > 768) {
        if (sidebar) sidebar.classList.remove('open');
        document.body.classList.remove('sidebar-open');
    }
}

// Mobile Table Card View Helper
function initMobileTable() {
    if (window.innerWidth > 640) {
        // Hide mobile cards, show table
        const mobileCards = document.querySelectorAll('.table-mobile-card');
        mobileCards.forEach(card => card.style.display = 'none');
        
        const tables = document.querySelectorAll('.table-wrapper table');
        tables.forEach(table => table.style.display = '');
        return;
    }
    
    // Show mobile cards, hide table
    const tables = document.querySelectorAll('.table-wrapper table');
    tables.forEach(table => {
        if (table.querySelector('tbody tr').querySelector('.table-mobile-card')) return; // Already converted
        
        const tbody = table.querySelector('tbody');
        if (!tbody) return;
        
        const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
        const rows = Array.from(tbody.querySelectorAll('tr'));
        
        // Create mobile card container
        const cardContainer = document.createElement('div');
        cardContainer.className = 'table-mobile-card';
        
        rows.forEach((row) => {
            const cells = Array.from(row.querySelectorAll('td'));
            if (cells.length === 0) return;
            
            const card = document.createElement('div');
            card.className = 'mobile-card-item';
            
            headers.forEach((header, i) => {
                if (i >= cells.length) return;
                
                const rowDiv = document.createElement('div');
                rowDiv.className = 'mobile-card-row';
                
                const label = document.createElement('span');
                label.className = 'mobile-card-label';
                label.textContent = header;
                
                const value = document.createElement('span');
                value.className = 'mobile-card-value';
                value.innerHTML = cells[i].innerHTML;
                
                rowDiv.appendChild(label);
                rowDiv.appendChild(value);
                card.appendChild(rowDiv);
            });
            
            // Add actions if exists
            const actions = row.querySelector('.table-actions');
            if (actions) {
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'mobile-card-actions';
                actionsDiv.innerHTML = actions.innerHTML;
                card.appendChild(actionsDiv);
            }
            
            cardContainer.appendChild(card);
        });
        
        // Insert after table wrapper
        const tableWrapper = table.closest('.table-wrapper');
        if (tableWrapper && !tableWrapper.querySelector('.table-mobile-card')) {
            tableWrapper.appendChild(cardContainer);
        }
    });
    
    // Hide tables, show cards
    tables.forEach(table => table.style.display = 'none');
    const mobileCards = document.querySelectorAll('.table-mobile-card');
    mobileCards.forEach(card => card.style.display = 'block');
}

// Call on load and resize
document.addEventListener('DOMContentLoaded', () => {
    initMobileTable();
    
    // Show/hide sidebar toggle based on screen size
    function updateSidebarToggle() {
        const toggleBtns = document.querySelectorAll('.sidebar-toggle');
        if (window.innerWidth <= 768) {
            toggleBtns.forEach(btn => {
                btn.style.display = 'flex';
            });
        } else {
            toggleBtns.forEach(btn => {
                btn.style.display = 'none';
            });
        }
    }
    
    // Initial check
    updateSidebarToggle();
    
    // Update on resize
    window.addEventListener('resize', debounce(() => {
        updateSidebarToggle();
        handleSidebarResize();
        initMobileTable();
    }, 250));
});

window.addEventListener('resize', debounce(() => {
    initMobileTable();
    
    // Show/hide sidebar toggle based on screen size
    const toggleBtns = document.querySelectorAll('.sidebar-toggle');
    if (window.innerWidth <= 768) {
        toggleBtns.forEach(btn => btn.style.display = 'flex');
    } else {
        toggleBtns.forEach(btn => btn.style.display = 'none');
    }
}, 250));

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ToastManager, LoadingManager, FormValidator, SearchHelper, toggleSidebar, initMobileTable };
}

