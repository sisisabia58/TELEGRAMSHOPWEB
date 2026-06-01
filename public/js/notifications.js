// Real-time Notifications Handler
class NotificationManager {
  constructor() {
    this.eventSource = null
    this.notificationContainer = null
    this.badgeElements = {}
    this.init()
  }

  init() {
    this.createNotificationContainer()
    this.connectSSE()
    this.loadNotificationCounts()
    this.setupBadgeUpdates()
    
    // Update counts setiap 30 detik
    setInterval(() => this.loadNotificationCounts(), 30000)
  }

  createNotificationContainer() {
    // Create notification container di body
    const notificationDiv = document.createElement('div')
    notificationDiv.id = 'notification-container'
    notificationDiv.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      z-index: 9999;
      max-width: 400px;
      pointer-events: none;
    `
    document.body.appendChild(notificationDiv)
    this.notificationContainer = notificationDiv
  }

  connectSSE() {
    if (typeof EventSource === 'undefined') {
      console.warn('SSE not supported')
      return
    }

    this.eventSource = new EventSource('/api/notifications/stream')

    this.eventSource.onmessage = (event) => {
      try {
        const notification = JSON.parse(event.data)
        if (notification.type !== 'connected') {
          this.handleNotification(notification)
        }
      } catch (error) {
        console.error('Error parsing notification:', error)
      }
    }

    this.eventSource.onerror = (error) => {
      console.error('SSE connection error:', error)
      // Reconnect setelah 5 detik
      setTimeout(() => {
        if (this.eventSource) {
          this.eventSource.close()
        }
        this.connectSSE()
      }, 5000)
    }
  }

  handleNotification(notification) {
    // Update badge counts
    this.updateBadge(notification.type)

    // Show browser notification jika diizinkan
    if (Notification.permission === 'granted') {
      new Notification(notification.title, {
        body: notification.message,
        icon: '/logo.jpg',
        tag: notification.type
      })
    }

    // Show in-app notification
    this.showInAppNotification(notification)
  }

  showInAppNotification(notification) {
    const notifDiv = document.createElement('div')
    notifDiv.className = 'notification-toast'
    notifDiv.style.cssText = `
      background: white;
      padding: 15px 20px;
      margin-bottom: 10px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      border-left: 4px solid ${this.getNotificationColor(notification.type)};
      pointer-events: auto;
      animation: slideIn 0.3s ease-out;
      cursor: pointer;
      max-width: 100%;
    `

    let actionButton = ''
    if (notification.data?.deposit_id) {
      actionButton = `
        <a href="/deposit/${notification.data.deposit_id}" style="display: inline-block; margin-top: 8px; padding: 4px 12px; background: #17a2b8; color: white; text-decoration: none; border-radius: 4px; font-size: 12px;">
          Lihat Detail →
        </a>
      `
    } else if (notification.data?.produk_id) {
      actionButton = `
        <a href="/produk/${notification.data.produk_id}/stok" style="display: inline-block; margin-top: 8px; padding: 4px 12px; background: #ffc107; color: #000; text-decoration: none; border-radius: 4px; font-size: 12px;">
          Cek Stok →
        </a>
      `
    } else if (notification.data?.trx_uuid) {
      actionButton = `
        <a href="/transaksi/${notification.data.trx_uuid}" style="display: inline-block; margin-top: 8px; padding: 4px 12px; background: #28a745; color: white; text-decoration: none; border-radius: 4px; font-size: 12px;">
          Lihat Transaksi →
        </a>
      `
    }

    notifDiv.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: start;">
        <div style="flex: 1;">
          <strong style="display: block; margin-bottom: 5px; color: #333;">${notification.title}</strong>
          <span style="color: #666; font-size: 14px;">${notification.message}</span>
          ${actionButton}
        </div>
        <button onclick="this.parentElement.parentElement.remove()" style="background: none; border: none; font-size: 20px; cursor: pointer; color: #999; margin-left: 10px; padding: 0; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">×</button>
      </div>
    `

    this.notificationContainer.appendChild(notifDiv)

    // Auto remove setelah 10 detik
    setTimeout(() => {
      if (notifDiv.parentElement) {
        notifDiv.style.animation = 'slideOut 0.3s ease-out'
        setTimeout(() => notifDiv.remove(), 300)
      }
    }, 10000)
  }

  getNotificationColor(type) {
    const colors = {
      'deposit_pending': '#17a2b8',
      'low_stock': '#ffc107',
      'large_transaction': '#28a745',
      'system': '#6c757d'
    }
    return colors[type] || '#6c757d'
  }

  async loadNotificationCounts() {
    try {
      const response = await fetch('/api/notifications/counts')
      const data = await response.json()
      
      if (data.success) {
        this.updateAllBadges(data.counts)
      }
    } catch (error) {
      console.error('Error loading notification counts:', error)
    }
  }

  updateBadge(type) {
    // Update badge berdasarkan type
    const badgeMap = {
      'deposit_pending': 'deposit-badge',
      'low_stock': 'stock-badge',
      'large_transaction': 'transaction-badge'
    }

    const badgeId = badgeMap[type]
    if (badgeId && this.badgeElements[badgeId]) {
      const current = parseInt(this.badgeElements[badgeId].textContent) || 0
      this.badgeElements[badgeId].textContent = current + 1
      this.badgeElements[badgeId].style.display = 'inline-block'
    }
  }

  updateAllBadges(counts) {
    // Update deposit badge
    if (this.badgeElements['deposit-badge']) {
      if (counts.deposit_pending > 0) {
        this.badgeElements['deposit-badge'].textContent = counts.deposit_pending
        this.badgeElements['deposit-badge'].style.display = 'inline-block'
      } else {
        this.badgeElements['deposit-badge'].style.display = 'none'
      }
    }

    // Update stock badge
    if (this.badgeElements['stock-badge']) {
      if (counts.low_stock > 0) {
        this.badgeElements['stock-badge'].textContent = counts.low_stock
        this.badgeElements['stock-badge'].style.display = 'inline-block'
      } else {
        this.badgeElements['stock-badge'].style.display = 'none'
      }
    }
  }

  setupBadgeUpdates() {
    // Setup badge elements
    const depositLink = document.querySelector('a[href="/deposit"]')
    if (depositLink) {
      const badge = document.createElement('span')
      badge.id = 'deposit-badge'
      badge.className = 'notification-badge'
      badge.style.cssText = `
        display: none;
        background: #dc3545;
        color: white;
        border-radius: 10px;
        padding: 2px 6px;
        font-size: 11px;
        margin-left: 5px;
        font-weight: bold;
      `
      depositLink.appendChild(badge)
      this.badgeElements['deposit-badge'] = badge
    }

    const produkLink = document.querySelector('a[href="/produk"]')
    if (produkLink) {
      const badge = document.createElement('span')
      badge.id = 'stock-badge'
      badge.className = 'notification-badge'
      badge.style.cssText = `
        display: none;
        background: #ffc107;
        color: #000;
        border-radius: 10px;
        padding: 2px 6px;
        font-size: 11px;
        margin-left: 5px;
        font-weight: bold;
      `
      produkLink.appendChild(badge)
      this.badgeElements['stock-badge'] = badge
    }
  }
}

// Request browser notification permission
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission().then(permission => {
    if (permission === 'granted') {
      console.log('Browser notifications enabled')
    }
  })
}

// CSS untuk animations
const style = document.createElement('style')
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(400px);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(400px);
      opacity: 0;
    }
  }
`
document.head.appendChild(style)

// Initialize notification manager
let notificationManager
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    notificationManager = new NotificationManager()
  })
} else {
  notificationManager = new NotificationManager()
}

