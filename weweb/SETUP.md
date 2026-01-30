# WeWeb Portal Setup Guide

Complete step-by-step guide to set up the Tax Document Processing Portal in WeWeb.

## Prerequisites

- WeWeb account (https://www.weweb.io)
- Supabase project configured (from Part 1)
- API deployed to Vercel (from Part 3)
- Credentials ready:
  - Supabase URL: `https://lkyixaippdmtjyiztuzw.supabase.co`
  - Supabase Anon Key: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxreWl4YWlwcGRtdGp5aXp0dXp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3MDI2ODksImV4cCI6MjA4NTI3ODY4OX0.LHSVwZSvnKBKX0qdxJAULu7salECJvJxs5G5i-pzKCE`
  - API URL: `https://accodal-gustavo.vercel.app`

## Step 1: Create WeWeb Project

1. Log in to WeWeb (https://editor.weweb.io)
2. Click **"New project"**
3. Name: `Tax Document Portal`
4. Choose **"Blank project"** or a dashboard template
5. Click **Create**

## Step 2: Install and Configure Supabase Plugin

### Install Plugin

1. Go to **Plugins** (puzzle icon in left sidebar)
2. Click **"Add a plugin"**
3. Search for **"Supabase"**
4. Click **Install**

### Configure Supabase

1. In the Supabase plugin settings, enter:
   - **Project URL**: `https://lkyixaippdmtjyiztuzw.supabase.co`
   - **Public API Key (anon)**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxreWl4YWlwcGRtdGp5aXp0dXp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3MDI2ODksImV4cCI6MjA4NTI3ODY4OX0.LHSVwZSvnKBKX0qdxJAULu7salECJvJxs5G5i-pzKCE`

2. Enable **Authentication**:
   - Check "Enable Authentication"
   - Login redirect: `/dashboard`
   - Logout redirect: `/login`

3. Click **Save**

## Step 3: Install REST API Plugin

1. Go to **Plugins**
2. Click **"Add a plugin"**
3. Search for **"REST API"**
4. Click **Install**

### Configure REST API

1. Add a new API configuration:
   - **Name**: `Tax API`
   - **Base URL**: `https://accodal-gustavo.vercel.app`
   - **Headers**:
     - `Content-Type`: `application/json`

## Step 4: Add Global Variables

1. Go to **Data** > **Variables**
2. Add the following variables:

| Name | Type | Default |
|------|------|---------|
| `searchQuery` | Text | (empty) |
| `documentType` | Text | (empty) |
| `uploadFiles` | Array | [] |
| `uploadProgress` | Number | 0 |
| `isUploading` | Boolean | false |
| `currentJobId` | Text | null |
| `showNotifications` | Boolean | false |

## Step 5: Create Collections

Go to **Data** > **Collections** and create:

### 1. User Documents Collection

- **Name**: `User Documents`
- **Plugin**: Supabase
- **Mode**: Real-time
- **Table**: `documents`
- **Select**: `id, filename, type, status, ocr_confidence, extracted_data, storage_path, created_at, updated_at`
- **Filter**: Add filter `user_id` equals `{{supabase.auth.user.id}}`
- **Order**: `created_at` descending
- **Limit**: 50

### 2. Audio Transcriptions Collection

- **Name**: `Audio Transcriptions`
- **Plugin**: Supabase
- **Mode**: Real-time
- **Table**: `audio_transcriptions`
- **Select**: `id, filename, transcription, language, duration_seconds, speaker_count, status, created_at`
- **Filter**: `user_id` equals `{{supabase.auth.user.id}}`
- **Order**: `created_at` descending

### 3. Text Extractions Collection

- **Name**: `Text Extractions`
- **Plugin**: Supabase
- **Table**: `text_extractions`
- **Select**: `id, source, subject, extracted_content, entities, sentiment, status, created_at`
- **Filter**: `user_id` equals `{{supabase.auth.user.id}}`
- **Order**: `created_at` descending

### 4. Notifications Collection

- **Name**: `Notifications`
- **Plugin**: Supabase
- **Mode**: Real-time
- **Table**: `error_notifications`
- **Select**: `id, severity, message, details, sent_at, created_at`
- **Filter**: `user_id` equals `{{supabase.auth.user.id}}`
- **Order**: `created_at` descending
- **Limit**: 50

### 5. Processing Logs Collection

- **Name**: `Processing Logs`
- **Plugin**: Supabase
- **Table**: `processing_logs`
- **Select**: `id, resource_type, action, status, details, created_at`
- **Filter**: `user_id` equals `{{supabase.auth.user.id}}`
- **Order**: `created_at` descending
- **Limit**: 20

## Step 6: Create Pages

Create the following pages:

### Public Pages (no auth required)

| Page | Path | Layout |
|------|------|--------|
| Login | `/login` | Auth |
| Register | `/register` | Auth |

### Protected Pages (auth required)

| Page | Path | Layout |
|------|------|--------|
| Dashboard | `/dashboard` | App |
| Upload | `/upload` | App |
| Documents | `/documents` | App |
| Document Details | `/documents/:id` | App |
| Search | `/search` | App |
| Audio | `/audio` | App |
| Text | `/text` | App |
| Profile | `/profile` | App |

## Step 7: Create Layouts

### Auth Layout

1. Go to **Layouts**
2. Create new layout: `Auth`
3. Add components:
   - Container (centered, min-height: 100vh, background: gray-50)
   - Page content slot

### App Layout

1. Create new layout: `App`
2. Add components:
   - **Sidebar** (fixed left, 256px width):
     - Logo
     - Navigation links
     - User menu
   - **Main content area** (margin-left: 256px):
     - Header with notification bell
     - Page content slot

## Step 8: Build Login Page

1. Go to `/login` page
2. Add components:
   - **Card container** (max-width: 400px, centered)
   - **Logo image**
   - **Heading**: "Welcome Back"
   - **Form**:
     - Email input (required, email validation)
     - Password input (required, min 8 chars)
     - Submit button: "Sign In"
   - **Links**: "Forgot password?", "Create account"

3. Add **Login Workflow**:
   ```
   On button click:
   1. Call supabase.auth.signInWithPassword(email, password)
   2. If error: Show toast error
   3. If success: Navigate to /dashboard
   ```

## Step 9: Build Dashboard Page

1. Go to `/dashboard` page
2. Add components:

### Stats Grid (4 columns)
- Total Documents: `{{collections['User Documents'].length}}`
- Completed: `{{collections['User Documents'].filter(d => d.status === 'completed').length}}`
- Processing: `{{collections['User Documents'].filter(d => d.status === 'processing').length}}`
- Needs Review: `{{collections['User Documents'].filter(d => d.status === 'needs_review').length}}`

### Recent Documents Table
- Bind to `User Documents` collection (limit 10)
- Columns: Filename, Type (badge), Status (badge), Date
- Row click: Navigate to `/documents/{{item.id}}`

### Activity Timeline
- Bind to `Processing Logs` collection
- Show action, status, timestamp

## Step 10: Build Upload Page

1. Go to `/upload` page
2. Add components:

### Dropzone
- Accept: `.pdf,.png,.jpg,.jpeg,.mp3,.wav,.m4a`
- Max size: 10MB
- On drop: Add files to `uploadFiles` variable

### Selected Files List
- Show when `uploadFiles.length > 0`
- Display filename, size, remove button

### Upload Button
- Text: "Upload {{uploadFiles.length}} file(s)"
- Loading state: `isUploading`
- On click: Trigger upload workflow

### Upload Workflow
```javascript
// 1. Convert files to base64
const items = [];
for (const file of uploadFiles) {
  const base64 = await fileToBase64(file);
  items.push({
    type: file.type.startsWith('audio/') ? 'audio' : 'document',
    data: {
      filename: file.name,
      mime_type: file.type,
      base64_content: base64,
      user_id: supabase.auth.user.id
    }
  });
}

// 2. Call batch API
const response = await fetch('{{API_URL}}/api/v1/batch/process', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + supabase.auth.session.access_token
  },
  body: JSON.stringify({ items, user_id: supabase.auth.user.id })
});

// 3. Poll for status
const job = await response.json();
// Poll every 2 seconds until completed
```

## Step 11: Build Search Page

1. Go to `/search` page
2. Add components:

### Search Form
- Text input for query (debounced)
- Document type dropdown
- Search button

### Results Grid
- Display when results exist
- Show document name, similarity score, content preview
- Click to navigate to document

### Search Workflow
```javascript
// Call search API
const response = await fetch('{{API_URL}}/api/v1/search', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + supabase.auth.session.access_token
  },
  body: JSON.stringify({
    query: searchQuery,
    user_id: supabase.auth.user.id,
    document_type: documentType || undefined,
    threshold: 0.7,
    limit: 20
  })
});
```

## Step 12: Build Document Details Page

1. Go to `/documents/:id` page
2. Create collection for single document:
   - Table: `documents`
   - Filter: `id` equals `{{routeParams.id}}`
   - Single: true

3. Add components:
   - Breadcrumb navigation
   - Document info card (filename, type, status, confidence)
   - Extracted data viewer (JSON display)
   - Similar documents list (from API)
   - Inconsistencies warnings (from API)
   - Action buttons (download, reprocess, delete)

## Step 13: Add Custom CSS

1. Go to **Settings** > **Custom Code** > **CSS**
2. Copy contents from `styles.css` file
3. Save

## Step 14: Add Custom Formulas

1. Go to **Settings** > **Formulas**
2. Add custom formulas from `formulas.js`:
   - `relativeTime` - Format dates as "2 hours ago"
   - `fileSize` - Format bytes as "1.5 MB"
   - `statusClass` - Get CSS class for status
   - `percentage` - Format decimal as percentage

## Step 15: Configure Authentication

1. Go to **Settings** > **Authentication**
2. Enable page protection:
   - Public pages: `/login`, `/register`
   - Protected pages: All others
3. Set redirect rules:
   - Unauthenticated users → `/login`
   - Authenticated on login page → `/dashboard`

## Step 16: Test the Application

1. Click **Preview** in WeWeb
2. Test user registration
3. Test login
4. Test document upload
5. Test search functionality
6. Test document details view

## Step 17: Deploy

1. Go to **Settings** > **Publish**
2. Configure domain (custom or WeWeb subdomain)
3. Click **Publish**

## Troubleshooting

### Authentication Issues
- Verify Supabase credentials are correct
- Check that RLS policies allow access
- Ensure auth headers are included in API calls

### API Errors
- Check CORS configuration on Vercel
- Verify API URL is correct
- Check browser console for detailed errors

### Real-time Not Working
- Verify Supabase real-time is enabled
- Check collection is set to real-time mode
- Ensure user has permission to subscribe

### File Upload Fails
- Check file size limits
- Verify file type is supported
- Check API endpoint is accessible

## Files Reference

| File | Description |
|------|-------------|
| `collections.json` | Data source configurations |
| `pages.json` | Page structure and components |
| `workflows.json` | Workflow definitions |
| `formulas.js` | Custom formula functions |
| `styles.css` | Custom CSS styles |

## Support

For issues:
1. Check WeWeb documentation: https://docs.weweb.io
2. Check Supabase documentation: https://supabase.com/docs
3. Review API logs in Vercel dashboard
