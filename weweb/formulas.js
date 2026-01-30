/**
 * WeWeb Custom Formulas and Code Snippets
 * Tax Document Processing Portal
 *
 * Copy these formulas into WeWeb's formula editor where needed.
 */

// ============================================
// DATE FORMATTING
// ============================================

/**
 * Format date as relative time (e.g., "2 hours ago")
 * Usage: {{item.created_at | relativeTime}}
 */
function relativeTime(date) {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour > 1 ? 's' : ''} ago`;
  if (diffDay < 7) return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;
  return then.toLocaleDateString();
}

/**
 * Format date with custom pattern
 * Usage: {{item.created_at | date:'MMM DD, YYYY'}}
 */
function formatDate(date, pattern = 'MMM DD, YYYY') {
  const d = new Date(date);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fullMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  return pattern
    .replace('YYYY', d.getFullYear())
    .replace('YY', String(d.getFullYear()).slice(-2))
    .replace('MMMM', fullMonths[d.getMonth()])
    .replace('MMM', months[d.getMonth()])
    .replace('MM', String(d.getMonth() + 1).padStart(2, '0'))
    .replace('DD', String(d.getDate()).padStart(2, '0'))
    .replace('HH', String(d.getHours()).padStart(2, '0'))
    .replace('mm', String(d.getMinutes()).padStart(2, '0'));
}

// ============================================
// NUMBER FORMATTING
// ============================================

/**
 * Format file size
 * Usage: {{item.size | fileSize}}
 */
function fileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format duration in seconds to human readable
 * Usage: {{item.duration_seconds | duration}}
 */
function duration(seconds) {
  if (!seconds) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Format number as percentage
 * Usage: {{item.confidence | percentage}}
 */
function percentage(value, decimals = 1) {
  return (value * 100).toFixed(decimals) + '%';
}

/**
 * Format currency
 * Usage: {{item.amount | currency}}
 */
function currency(value, locale = 'en-US', currency = 'USD') {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency
  }).format(value);
}

// ============================================
// STRING FORMATTING
// ============================================

/**
 * Capitalize first letter
 * Usage: {{item.status | capitalize}}
 */
function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Truncate text with ellipsis
 * Usage: {{item.content | truncate:100}}
 */
function truncate(str, length = 50) {
  if (!str || str.length <= length) return str;
  return str.substring(0, length) + '...';
}

/**
 * Convert status to display label
 * Usage: {{item.status | statusLabel}}
 */
function statusLabel(status) {
  const labels = {
    'pending': 'Pending',
    'processing': 'Processing',
    'completed': 'Completed',
    'failed': 'Failed',
    'needs_review': 'Needs Review'
  };
  return labels[status] || status;
}

// ============================================
// STATUS BADGE CLASSES
// ============================================

/**
 * Get CSS class for status badge
 * Usage: class="status-badge {{item.status | statusClass}}"
 */
function statusClass(status) {
  const classes = {
    'pending': 'bg-yellow-100 text-yellow-800',
    'processing': 'bg-blue-100 text-blue-800',
    'completed': 'bg-green-100 text-green-800',
    'failed': 'bg-red-100 text-red-800',
    'needs_review': 'bg-orange-100 text-orange-800'
  };
  return classes[status] || 'bg-gray-100 text-gray-800';
}

/**
 * Get CSS class for severity badge
 * Usage: class="severity-badge {{item.severity | severityClass}}"
 */
function severityClass(severity) {
  const classes = {
    'INFO': 'bg-blue-100 text-blue-800',
    'WARNING': 'bg-yellow-100 text-yellow-800',
    'ERROR': 'bg-red-100 text-red-800',
    'CRITICAL': 'bg-red-200 text-red-900'
  };
  return classes[severity] || 'bg-gray-100 text-gray-800';
}

/**
 * Get CSS class for sentiment badge
 * Usage: class="sentiment-badge {{item.sentiment | sentimentClass}}"
 */
function sentimentClass(sentiment) {
  const classes = {
    'positive': 'bg-green-100 text-green-800',
    'negative': 'bg-red-100 text-red-800',
    'neutral': 'bg-gray-100 text-gray-800'
  };
  return classes[sentiment] || 'bg-gray-100 text-gray-800';
}

// ============================================
// FILE HELPERS
// ============================================

/**
 * Convert file to base64
 * Use in custom code blocks
 */
async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Get file icon based on type
 * Usage: {{item.filename | fileIcon}}
 */
function fileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const icons = {
    'pdf': 'file-text',
    'png': 'image',
    'jpg': 'image',
    'jpeg': 'image',
    'mp3': 'music',
    'wav': 'music',
    'm4a': 'music'
  };
  return icons[ext] || 'file';
}

/**
 * Get document type color
 * Usage: {{item.type | typeColor}}
 */
function typeColor(type) {
  const colors = {
    'W-2': 'blue',
    '1099': 'purple',
    'Invoice': 'green',
    'Receipt': 'orange',
    'Contract': 'indigo'
  };
  return colors[type] || 'gray';
}

// ============================================
// ARRAY HELPERS
// ============================================

/**
 * Group array by key
 * Usage: {{items | groupBy:'status'}}
 */
function groupBy(array, key) {
  return array.reduce((result, item) => {
    const groupKey = item[key];
    if (!result[groupKey]) {
      result[groupKey] = [];
    }
    result[groupKey].push(item);
    return result;
  }, {});
}

/**
 * Count items by status
 * Usage: {{documents | countByStatus:'completed'}}
 */
function countByStatus(array, status) {
  return array.filter(item => item.status === status).length;
}

// ============================================
// VALIDATION HELPERS
// ============================================

/**
 * Validate email format
 */
function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

/**
 * Check if file type is supported
 */
function isSupportedFileType(filename) {
  const supported = ['pdf', 'png', 'jpg', 'jpeg', 'mp3', 'wav', 'm4a'];
  const ext = filename.split('.').pop().toLowerCase();
  return supported.includes(ext);
}

// ============================================
// SIMILARITY SCORE FORMATTING
// ============================================

/**
 * Format similarity score with color indicator
 * Usage: {{item.similarity | similarityDisplay}}
 */
function similarityDisplay(score) {
  const percent = (score * 100).toFixed(1);
  let color = 'text-red-500';
  if (score >= 0.9) color = 'text-green-500';
  else if (score >= 0.8) color = 'text-green-400';
  else if (score >= 0.7) color = 'text-yellow-500';
  else if (score >= 0.6) color = 'text-orange-500';

  return { percent, color };
}

// ============================================
// EXPORT FOR WEWEB
// ============================================

// In WeWeb, register these as custom formulas:
// 1. Go to Settings > Formulas
// 2. Add each function as a custom formula
// 3. Use with {{value | formulaName}} syntax

export {
  relativeTime,
  formatDate,
  fileSize,
  duration,
  percentage,
  currency,
  capitalize,
  truncate,
  statusLabel,
  statusClass,
  severityClass,
  sentimentClass,
  fileToBase64,
  fileIcon,
  typeColor,
  groupBy,
  countByStatus,
  isValidEmail,
  isSupportedFileType,
  similarityDisplay
};
