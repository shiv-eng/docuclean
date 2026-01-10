// Global state
let currentFile = null;
let userSessionId = null;

// DOM elements
const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const processingSection = document.getElementById('processingSection');
const uploadSection = document.getElementById('uploadSection');
const uploadedFileDisplay = document.getElementById('uploadedFileDisplay');
const uploadedFileName = document.getElementById('uploadedFileName');
const removeFileBtn = document.getElementById('removeFileBtn');
const keywordsInput = document.getElementById('keywords');
const matchCaseCheckbox = document.getElementById('matchCase');
const headerSlider = document.getElementById('headerHeight');
const footerSlider = document.getElementById('footerHeight');
const headerValue = document.getElementById('headerValue');
const footerValue = document.getElementById('footerValue');
const downloadBtn = document.getElementById('downloadBtn');
const previewImage = document.getElementById('previewImage');
const previewLoading = document.getElementById('previewLoading');
const loadingIndicator = document.getElementById('loadingIndicator');
const loadingText = document.getElementById('loadingText');
const loadingProgress = document.getElementById('loadingProgress');
const detectedText = document.getElementById('detectedText');
const helpBtn = document.getElementById('helpBtn');
const helpTooltip = document.getElementById('helpTooltip');
const footerVisitorCount = document.getElementById('footerVisitorCount');
const footerUploadCount = document.getElementById('footerUploadCount');
const headerVisitorCount = document.getElementById('headerVisitorCount');
const heroSection = document.getElementById('heroSection');
const featuresSection = document.getElementById('featuresSection');

// Help tooltip toggle
helpBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    helpTooltip.classList.toggle('hidden');
});

// Close tooltip when clicking outside
document.addEventListener('click', () => {
    if (!helpTooltip.classList.contains('hidden')) {
        helpTooltip.classList.add('hidden');
    }
});

// Persistent Session ID (localStorage for cross-session tracking)
function getSessionId() {
    // Try to get persistent user ID from localStorage
    let userId = localStorage.getItem('pdf_user_id');
    
    if (!userId) {
        // Create new persistent user ID
        userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('pdf_user_id', userId);
        console.log('✅ New user created:', userId);
    } else {
        console.log('✅ Returning user:', userId);
    }
    
    return userId;
}

// Track analytics
async function trackEvent(eventType, data = {}) {
    try {
        await fetch('/analytics/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: userSessionId,
                event_type: eventType,
                timestamp: new Date().toISOString(),
                ...data
            })
        });
        console.log('📊 Tracked event:', eventType);
    } catch (error) {
        console.error('Analytics error:', error);
    }
}

// Load stats
async function loadStats() {
    try {
        const response = await fetch('/analytics/stats');
        if (response.ok) {
            const stats = await response.json();
            const visitors = stats.unique_visitors.toLocaleString();
            const uploads = stats.total_uploads.toLocaleString();
            
            if (headerVisitorCount) headerVisitorCount.textContent = visitors;
            if (footerUploadCount) footerUploadCount.textContent = uploads;
        }
    } catch (error) {
        console.error('Stats error:', error);
    }
}

// Initialize
window.addEventListener('DOMContentLoaded', async () => {
    userSessionId = getSessionId();
    await trackEvent('page_visit');
    await loadStats();
    setInterval(loadStats, 30000);
});

// File upload handlers
dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('border-indigo-500', 'bg-indigo-50');
});

dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('border-indigo-500', 'bg-indigo-50');
});

dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('border-indigo-500', 'bg-indigo-50');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        const file = files[0];
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
            handleFileUpload(file);
        } else {
            alert('Please upload a PDF file');
        }
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFileUpload(e.target.files[0]);
    }
});

// ✅ FIXED: Remove file and reset to upload screen
removeFileBtn.addEventListener('click', () => {
    console.log('🔄 Resetting application...');
    
    // Reset file state
    currentFile = null;
    fileInput.value = '';
    
    // Reset form inputs
    keywordsInput.value = '';
    detectedText.textContent = '';
    previewImage.src = '';
    matchCaseCheckbox.checked = false;
    
    // Reset sliders to default
    headerSlider.value = 0;
    footerSlider.value = 25;
    headerValue.textContent = '0';
    footerValue.textContent = '25';
    updateSliderBackground(headerSlider, 0);
    updateSliderBackground(footerSlider, 25);
    
    // Hide uploaded file display and processing section
    uploadedFileDisplay.classList.add('hidden');
    processingSection.classList.add('hidden');
    
    // Show dropzone, hero and features
    dropzone.classList.remove('hidden');
    heroSection.classList.remove('hidden');
    featuresSection.classList.remove('hidden');
    uploadSection.classList.remove('hidden');
    uploadSection.style.display = 'block';
    
    console.log('✅ Reset complete - ready for new upload');
});

// Update slider backgrounds dynamically
function updateSliderBackground(slider, value) {
    const percent = (value / slider.max) * 100;
    slider.style.background = `linear-gradient(to right, #6366f1 0%, #6366f1 ${percent}%, #e5e7eb ${percent}%, #e5e7eb 100%)`;
}

// Slider updates
headerSlider.addEventListener('input', (e) => {
    const value = e.target.value;
    headerValue.textContent = value;
    updateSliderBackground(headerSlider, value);
    debouncePreview();
});

footerSlider.addEventListener('input', (e) => {
    const value = e.target.value;
    footerValue.textContent = value;
    updateSliderBackground(footerSlider, value);
    debouncePreview();
});

// Initialize slider backgrounds
updateSliderBackground(headerSlider, 0);
updateSliderBackground(footerSlider, 25);

// Keywords and checkbox
keywordsInput.addEventListener('input', () => debouncePreview());
matchCaseCheckbox.addEventListener('change', () => updatePreview());

// Debounce preview
let previewTimeout = null;
function debouncePreview() {
    clearTimeout(previewTimeout);
    previewTimeout = setTimeout(() => updatePreview(), 800);
}

// Show loading with progress simulation
function showLoading(text, simulateProgress = false) {
    loadingIndicator.classList.remove('hidden');
    loadingText.textContent = text;
    loadingProgress.textContent = '0%';
    
    if (simulateProgress) {
        let progress = 0;
        const interval = setInterval(() => {
            progress += Math.random() * 15;
            if (progress >= 95) {
                progress = 95;
                clearInterval(interval);
            }
            loadingProgress.textContent = Math.round(progress) + '%';
        }, 200);
        
        // Store interval to clear later
        loadingIndicator.dataset.interval = interval;
    }
}

function hideLoading() {
    if (loadingIndicator.dataset.interval) {
        clearInterval(loadingIndicator.dataset.interval);
        delete loadingIndicator.dataset.interval;
    }
    loadingProgress.textContent = '100%';
    setTimeout(() => {
        loadingIndicator.classList.add('hidden');
    }, 300);
}

// Handle file upload
async function handleFileUpload(file) {
    if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
        alert('Please upload a PDF file');
        return;
    }
    
    if (file.size > 50 * 1024 * 1024) {
        alert('File size exceeds 50MB limit');
        return;
    }
    
    currentFile = file;
    
    await trackEvent('file_upload', {
        file_size: file.size,
        file_name: file.name.substring(file.name.lastIndexOf('.'))
    });
    
    showLoading('Analyzing PDF...', true);
    
    try {
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch('/analyze', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: 'Analysis failed' }));
            throw new Error(errorData.detail);
        }
        
        const data = await response.json();
        const keywords = data.keywords || '';
        
        // Update keywords input and detected text
        if (keywords && keywords.trim()) {
            keywordsInput.value = keywords;
            detectedText.textContent = keywords;
        } else {
            keywordsInput.value = '';
            detectedText.textContent = 'None detected';
        }
        
        console.log('Detected keywords:', keywords);
        
        // ✅ Show uploaded file card in upload section
        uploadedFileName.textContent = file.name;
        uploadedFileDisplay.classList.remove('hidden');
        dropzone.classList.add('hidden');
        heroSection.classList.add('hidden');
        featuresSection.classList.add('hidden');
        
        // Keep upload section visible but show processing section
        uploadSection.style.display = 'block';
        processingSection.classList.remove('hidden');
        
        await updatePreview();
        await loadStats();
        
    } catch (error) {
        console.error('Upload error:', error);
        alert(`Failed to analyze PDF: ${error.message}`);
        // Reset on error
        removeFileBtn.click();
    } finally {
        hideLoading();
    }
}

// Update preview
async function updatePreview() {
    if (!currentFile) return;
    
    previewLoading.classList.remove('hidden');
    previewImage.classList.add('hidden');
    
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
            throw new Error('Preview failed');
        }
        
        const blob = await response.blob();
        const imageUrl = URL.createObjectURL(blob);
        
        previewImage.src = imageUrl;
        previewImage.classList.remove('hidden');
        
    } catch (error) {
        console.error('Preview error:', error);
    } finally {
        previewLoading.classList.add('hidden');
    }
}

// Download file
async function downloadFile() {
    if (!currentFile) return;
    
    await trackEvent('file_download');
    
    showLoading('Processing PDF...', true);
    
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
            const errorData = await response.json().catch(() => ({ detail: 'Processing failed' }));
            throw new Error(errorData.detail);
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
        
        await loadStats();
        
    } catch (error) {
        console.error('Download error:', error);
        alert(`Failed to process PDF: ${error.message}`);
    } finally {
        hideLoading();
    }
}

downloadBtn.addEventListener('click', downloadFile);