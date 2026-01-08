// Global state
let currentFile = null;
let userSessionId = null;

// DOM elements
const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const features = document.getElementById('features');
const processingSection = document.getElementById('processingSection');
const keywordsInput = document.getElementById('keywords');
const matchCaseCheckbox = document.getElementById('matchCase');
const headerSlider = document.getElementById('headerHeight');
const footerSlider = document.getElementById('footerHeight');
const headerValue = document.getElementById('headerValue');
const footerValue = document.getElementById('footerValue');
const downloadBtn = document.getElementById('downloadBtn');
const previewImage = document.getElementById('previewImage');
const previewPlaceholder = document.getElementById('previewPlaceholder');
const previewLoading = document.getElementById('previewLoading');
const loadingIndicator = document.getElementById('loadingIndicator');
const detectedText = document.getElementById('detectedText');

// Stats display elements (only visitor count now)
const visitorCount = document.getElementById('visitorCount');
const footerVisitorCount = document.getElementById('footerVisitorCount');

// Generate or retrieve session ID
function getSessionId() {
    let sessionId = sessionStorage.getItem('pdf_session_id');
    if (!sessionId) {
        sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        sessionStorage.setItem('pdf_session_id', sessionId);
    }
    return sessionId;
}

// Track analytics event
async function trackEvent(eventType, data = {}) {
    try {
        await fetch('/analytics/track', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                session_id: userSessionId,
                event_type: eventType,
                timestamp: new Date().toISOString(),
                ...data
            })
        });
    } catch (error) {
        console.error('Analytics tracking error:', error);
    }
}

// Load and update stats (only visitor count for public)
async function loadStats() {
    try {
        const response = await fetch('/analytics/stats');
        if (response.ok) {
            const stats = await response.json();
            
            // Update only visitor count for public view
            if (visitorCount) visitorCount.textContent = stats.unique_visitors.toLocaleString();
            if (footerVisitorCount) footerVisitorCount.textContent = stats.unique_visitors.toLocaleString();
        }
    } catch (error) {
        console.error('Failed to load stats:', error);
    }
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', async () => {
    userSessionId = getSessionId();
    
    // Track page visit
    await trackEvent('page_visit');
    
    // Load current stats
    await loadStats();
    
    // Update stats periodically
    setInterval(loadStats, 30000); // Every 30 seconds
});

// File upload handlers
dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('border-blue-500', 'bg-blue-50');
});

dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('border-blue-500', 'bg-blue-50');
});

dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('border-blue-500', 'bg-blue-50');
    
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type === 'application/pdf') {
        fileInput.files = files;
        handleFileUpload(files[0]);
    } else {
        alert('Please drop a valid PDF file');
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFileUpload(e.target.files[0]);
    }
});

// Debounce function to prevent too many preview requests
let previewTimeout = null;
function debouncePreview() {
    clearTimeout(previewTimeout);
    previewTimeout = setTimeout(() => {
        updatePreview();
    }, 800); // Wait 800ms after user stops changing settings
}

// Slider updates with auto-preview
headerSlider.addEventListener('input', (e) => {
    headerValue.textContent = e.target.value;
    debouncePreview();
});

footerSlider.addEventListener('input', (e) => {
    footerValue.textContent = e.target.value;
    debouncePreview();
});

// Keywords input with auto-preview
keywordsInput.addEventListener('input', () => {
    debouncePreview();
});

// Match case checkbox with auto-preview
matchCaseCheckbox.addEventListener('change', () => {
    updatePreview();
});

// Handle file upload and analysis
async function handleFileUpload(file) {
    currentFile = file;
    
    // Track upload event
    await trackEvent('file_upload', {
        file_size: file.size,
        file_name: file.name.substring(file.name.lastIndexOf('.'))
    });
    
    // Show loading
    loadingIndicator.classList.remove('hidden');
    
    try {
        // Analyze PDF for watermarks
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch('/analyze', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error('Analysis failed');
        }
        
        const data = await response.json();
        
        // Update UI
        keywordsInput.value = data.keywords;
        detectedText.textContent = data.keywords || 'None detected';
        
        // Hide features, show processing section
        features.classList.add('hidden');
        processingSection.classList.remove('hidden');
        
        // Auto-generate preview
        await updatePreview();
        
        // Reload stats after upload
        await loadStats();
        
    } catch (error) {
        console.error('Error analyzing PDF:', error);
        alert('Failed to analyze PDF. Please try again.');
    } finally {
        loadingIndicator.classList.add('hidden');
    }
}

// Update preview
async function updatePreview() {
    if (!currentFile) return;
    
    previewLoading.classList.remove('hidden');
    previewImage.classList.add('hidden');
    previewPlaceholder.classList.add('hidden');
    
    try {
        const formData = new FormData();
        formData.append('file', currentFile);
        formData.append('keywords', keywordsInput.value);
        formData.append('header_h', headerSlider.value);
        formData.append('footer_h', footerSlider.value);
        formData.append('match_case', matchCaseCheckbox.checked);
        
        const response = await fetch('/preview', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error('Preview generation failed');
        }
        
        const blob = await response.blob();
        const imageUrl = URL.createObjectURL(blob);
        
        previewImage.src = imageUrl;
        previewImage.classList.remove('hidden');
        
    } catch (error) {
        console.error('Error generating preview:', error);
        previewPlaceholder.classList.remove('hidden');
        previewPlaceholder.innerHTML = `
            <svg class="w-16 h-16 mx-auto text-slate-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <p class="text-slate-500 font-medium">Preview failed</p>
            <p class="text-sm text-slate-400 mt-2">Settings will still be applied to downloaded PDF</p>
        `;
    } finally {
        previewLoading.classList.add('hidden');
    }
}

// Download cleaned PDF
async function downloadPDF() {
    if (!currentFile) return;
    
    // Track download event
    await trackEvent('file_download');
    
    loadingIndicator.classList.remove('hidden');
    
    try {
        const formData = new FormData();
        formData.append('file', currentFile);
        formData.append('keywords', keywordsInput.value);
        formData.append('header_h', headerSlider.value);
        formData.append('footer_h', footerSlider.value);
        formData.append('match_case', matchCaseCheckbox.checked);
        
        const response = await fetch('/process', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error('PDF processing failed');
        }
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Clean_${currentFile.name}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        // Reload stats after download
        await loadStats();
        
    } catch (error) {
        console.error('Error processing PDF:', error);
        alert('Failed to process PDF. Please try again.');
    } finally {
        loadingIndicator.classList.add('hidden');
    }
}

// Event listeners
downloadBtn.addEventListener('click', downloadPDF);