# WeWeb Integration Guide

This guide covers setting up the WeWeb client portal for the Tax Document Processing System.

## Prerequisites

- WeWeb account
- Supabase project configured
- API deployed to Vercel

## Project Setup

### 1. Create WeWeb Project

1. Go to WeWeb dashboard and create a new project
2. Name it "Tax Document Portal"
3. Choose a responsive template or start blank

### 2. Install Supabase Plugin

1. Go to Plugins > Add Plugin
2. Search for "Supabase"
3. Install and configure with your credentials:
   - **Supabase URL**: `https://your-project.supabase.co`
   - **Supabase Anon Key**: Your public anon key

### 3. Configure Authentication

In the Supabase plugin settings:

1. Enable Authentication
2. Set up Email/Password provider
3. Configure redirect URLs:
   - Login redirect: `/dashboard`
   - Logout redirect: `/login`

## Page Structure

```
/
├── login           # User authentication
├── register        # New user registration
├── dashboard       # Main dashboard
├── upload          # Document upload
├── documents       # Document list
├── documents/:id   # Document details
├── search          # Search interface
├── audio           # Audio transcriptions
├── text            # Text extractions
└── profile         # User profile
```

## Authentication Pages

### Login Page (`/login`)

**Components:**
- Email input
- Password input
- Login button
- "Forgot password" link
- "Register" link

**Workflow:**
```javascript
// On login button click
const { data, error } = await ww.plugins.supabase.auth.signInWithPassword({
  email: emailInput.value,
  password: passwordInput.value
});

if (error) {
  showError(error.message);
} else {
  navigateTo('/dashboard');
}
```

### Register Page (`/register`)

**Components:**
- Name input
- Email input
- Password input
- Confirm password input
- Register button

**Workflow:**
```javascript
// On register button click
const { data, error } = await ww.plugins.supabase.auth.signUp({
  email: emailInput.value,
  password: passwordInput.value,
  options: {
    data: {
      full_name: nameInput.value
    }
  }
});

if (error) {
  showError(error.message);
} else {
  showSuccess('Check your email for verification link');
}
```

## Dashboard Page (`/dashboard`)

### Data Bindings

Create collections for real-time data:

```javascript
// Documents collection
const documents = await ww.plugins.supabase
  .from('documents')
  .select('*')
  .eq('user_id', currentUser.id)
  .order('created_at', { ascending: false })
  .limit(10);

// Processing stats
const stats = await fetch('/api/v1/stats?user_id=' + currentUser.id)
  .then(r => r.json());
```

### Components

1. **Stats Cards**
   - Total documents
   - Processing status breakdown
   - Recent activity

2. **Recent Documents Table**
   - Filename
   - Type
   - Status badge
   - Created date
   - Actions (view, reprocess, delete)

3. **Activity Timeline**
   - Recent processing events
   - Notifications

### Real-time Updates

```javascript
// Subscribe to document changes
const subscription = ww.plugins.supabase
  .channel('documents')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'documents',
    filter: `user_id=eq.${currentUser.id}`
  }, (payload) => {
    // Refresh documents list
    refreshDocuments();
  })
  .subscribe();
```

## Document Upload Page (`/upload`)

### File Upload Component

```html
<div class="upload-zone" @dragover.prevent @drop="handleDrop">
  <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.mp3,.wav" />
  <p>Drag and drop files here or click to browse</p>
  <p class="supported">Supported: PDF, PNG, JPG, MP3, WAV</p>
</div>
```

### Upload Workflow

```javascript
async function uploadFiles(files) {
  const items = [];

  for (const file of files) {
    const base64 = await fileToBase64(file);
    const type = file.type.startsWith('audio/') ? 'audio' : 'document';

    items.push({
      type,
      data: {
        filename: file.name,
        mime_type: file.type,
        base64_content: base64,
        user_id: currentUser.id
      }
    });
  }

  // Create batch job
  const response = await fetch('/api/v1/batch/process', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({ items, user_id: currentUser.id })
  });

  const job = await response.json();

  // Poll for status
  pollJobStatus(job.data.job_id);
}

async function pollJobStatus(jobId) {
  const interval = setInterval(async () => {
    const response = await fetch(`/api/v1/batch/jobs/${jobId}`);
    const status = await response.json();

    if (status.data.status === 'completed' || status.data.status === 'failed') {
      clearInterval(interval);
      showResults(status.data);
    } else {
      updateProgress(status.data);
    }
  }, 2000);
}
```

## Search Page (`/search`)

### Search Interface

```html
<div class="search-container">
  <input type="text" placeholder="Search documents..." v-model="searchQuery" />
  <select v-model="documentType">
    <option value="">All Types</option>
    <option value="W-2">W-2</option>
    <option value="1099">1099</option>
    <option value="Invoice">Invoice</option>
  </select>
  <button @click="performSearch">Search</button>
</div>

<div class="results" v-if="results.length">
  <div v-for="result in results" class="result-card">
    <h3>{{ result.document.filename }}</h3>
    <span class="similarity">{{ (result.similarity * 100).toFixed(1) }}% match</span>
    <p class="preview">{{ result.content.substring(0, 200) }}...</p>
  </div>
</div>
```

### Search Workflow

```javascript
async function performSearch() {
  const response = await fetch('/api/v1/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: searchQuery,
      user_id: currentUser.id,
      document_type: documentType || undefined,
      threshold: 0.7,
      limit: 20
    })
  });

  const data = await response.json();
  results = data.data.results;
}
```

## Document Details Page (`/documents/:id`)

### Data Binding

```javascript
// Fetch document
const document = await ww.plugins.supabase
  .from('documents')
  .select('*')
  .eq('id', routeParams.id)
  .single();

// Fetch similar documents
const similar = await fetch(`/api/v1/documents/${routeParams.id}/similar`)
  .then(r => r.json());

// Check inconsistencies
const inconsistencies = await fetch(`/api/v1/documents/${routeParams.id}/inconsistencies`)
  .then(r => r.json());
```

### Components

1. **Document Preview**
   - File preview (image/PDF viewer)
   - Download link

2. **Extracted Data Display**
   - Formatted key-value pairs
   - Confidence indicators

3. **Similar Documents**
   - List of related documents
   - Similarity scores

4. **Actions**
   - Reprocess button
   - Delete button
   - Download button

## Notifications

### Real-time Notifications

```javascript
// Subscribe to notifications
const notificationSubscription = ww.plugins.supabase
  .channel('notifications')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'error_notifications',
    filter: `user_id=eq.${currentUser.id}`
  }, (payload) => {
    showNotification(payload.new);
  })
  .subscribe();
```

### Notification Bell Component

```html
<div class="notification-bell">
  <button @click="toggleNotifications">
    <i class="bell-icon"></i>
    <span v-if="unreadCount" class="badge">{{ unreadCount }}</span>
  </button>
  <div v-if="showNotifications" class="notification-panel">
    <div v-for="notification in notifications" class="notification-item">
      <span :class="['severity', notification.severity.toLowerCase()]">
        {{ notification.severity }}
      </span>
      <p>{{ notification.message }}</p>
      <time>{{ formatDate(notification.created_at) }}</time>
    </div>
  </div>
</div>
```

## Styling Guidelines

### Color Palette

```css
:root {
  --primary: #3B82F6;
  --secondary: #10B981;
  --warning: #F59E0B;
  --error: #EF4444;
  --background: #F9FAFB;
  --surface: #FFFFFF;
  --text: #1F2937;
  --text-secondary: #6B7280;
}
```

### Status Badges

```css
.status-badge {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.status-pending { background: #FEF3C7; color: #92400E; }
.status-processing { background: #DBEAFE; color: #1E40AF; }
.status-completed { background: #D1FAE5; color: #065F46; }
.status-failed { background: #FEE2E2; color: #991B1B; }
.status-needs_review { background: #FED7AA; color: #9A3412; }
```

## Security Considerations

1. **Row Level Security**: Ensure RLS is enabled on all tables
2. **API Authentication**: Use JWT tokens for API calls
3. **File Validation**: Validate file types and sizes client-side
4. **Input Sanitization**: Sanitize all user inputs
5. **Error Handling**: Don't expose sensitive error details

## Performance Tips

1. **Pagination**: Use pagination for large lists
2. **Caching**: Cache frequently accessed data
3. **Lazy Loading**: Load images and data on scroll
4. **Debounce**: Debounce search inputs
5. **Optimistic Updates**: Update UI before API response

## Troubleshooting

### Common Issues

1. **Authentication errors**: Check Supabase credentials
2. **CORS errors**: Verify API CORS configuration
3. **Real-time not working**: Check Supabase subscription limits
4. **File upload fails**: Check file size limits

### Debug Mode

Enable debug mode in development:

```javascript
ww.debug = true;
console.log('Current user:', ww.plugins.supabase.auth.user());
```
