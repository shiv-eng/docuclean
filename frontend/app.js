// ============================================
// PWA SERVICE WORKER REGISTRATION
// ============================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js');
            console.log('✅ ServiceWorker registered:', registration.scope);

            // Check for updates periodically
            setInterval(() => {
                registration.update();
            }, 60 * 60 * 1000); // Every hour
        } catch (error) {
            console.log('❌ ServiceWorker registration failed:', error);
        }
    });
}

// PWA Install Prompt
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('📱 PWA Install prompt available');

    // Show install button after a delay (less intrusive)
    setTimeout(() => {
        showInstallBanner();
    }, 10000); // Show after 10 seconds
});

function showInstallBanner() {
    if (!deferredPrompt) return;

    // Create install banner
    const banner = document.createElement('div');
    banner.id = 'pwaInstallBanner';
    banner.className = 'fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-80 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-2xl p-4 shadow-2xl z-50 transform transition-all duration-300';
    banner.innerHTML = `
        <div class="flex items-start gap-3">
            <div class="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/>
                </svg>
            </div>
            <div class="flex-1">
                <p class="font-bold text-sm mb-1">Install DocuClean</p>
                <p class="text-xs opacity-90 mb-3">Add to home screen for quick access & offline use</p>
                <div class="flex gap-2">
                    <button id="pwaInstallBtn" class="bg-white text-indigo-600 font-bold text-sm px-4 py-2 rounded-lg hover:bg-indigo-50 transition-colors">
                        Install
                    </button>
                    <button id="pwaDismissBtn" class="text-white/80 hover:text-white text-sm px-3 py-2 transition-colors">
                        Later
                    </button>
                </div>
            </div>
            <button id="pwaCloseBtn" class="text-white/60 hover:text-white transition-colors p-1">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
            </button>
        </div>
    `;

    document.body.appendChild(banner);

    // Animate in
    setTimeout(() => {
        banner.classList.add('translate-y-0', 'opacity-100');
    }, 100);

    // Install button click
    document.getElementById('pwaInstallBtn').addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log('📱 Install outcome:', outcome);
            deferredPrompt = null;
        }
        banner.remove();
    });

    // Dismiss buttons
    const dismissBanner = () => {
        banner.classList.add('translate-y-full', 'opacity-0');
        setTimeout(() => banner.remove(), 300);
    };

    document.getElementById('pwaDismissBtn').addEventListener('click', dismissBanner);
    document.getElementById('pwaCloseBtn').addEventListener('click', dismissBanner);
}

// Handle app installed event
window.addEventListener('appinstalled', () => {
    console.log('✅ PWA was installed');
    deferredPrompt = null;
    const banner = document.getElementById('pwaInstallBanner');
    if (banner) banner.remove();
});

// ============================================
// MAIN APPLICATION CODE
// ============================================

// Global state
let currentFile = null;
let userSessionId = null;
let selectedReaction = null;

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
const footerUploadCount = document.getElementById('footerUploadCount');
const headerVisitorCount = document.getElementById('headerVisitorCount');
const heroSection = document.getElementById('heroSection');
const featuresSection = document.getElementById('featuresSection');
const feedbackModal = document.getElementById('feedbackModal');
const feedbackEmail = document.getElementById('feedbackEmail');

// Persistent Session ID (localStorage for cross-session tracking)
function getSessionId() {
    let userId = localStorage.getItem('pdf_user_id');

    if (!userId) {
        userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('pdf_user_id', userId);
        console.log('✅ New user created:', userId);
    } else {
        console.log('✅ Returning user:', userId);
    }

    return userId;
}

// Track analytics with proper data structure
async function trackEvent(eventType, data = {}) {
    try {
        const payload = {
            session_id: userSessionId,
            event_type: eventType,
            timestamp: new Date().toISOString(),
            ...data
        };

        console.log('📊 Tracking event:', payload);

        await fetch('/analytics/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        console.log('✅ Event tracked:', eventType);
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

// Remove file and reset to upload screen
removeFileBtn.addEventListener('click', () => {
    console.log('🔄 Resetting application...');

    currentFile = null;
    fileInput.value = '';

    keywordsInput.value = '';
    detectedText.textContent = '';
    previewImage.src = '';
    matchCaseCheckbox.checked = false;

    headerSlider.value = 0;
    footerSlider.value = 25;
    headerValue.textContent = '0';
    footerValue.textContent = '25';
    updateSliderBackground(headerSlider, 0);
    updateSliderBackground(footerSlider, 25);

    uploadedFileDisplay.classList.add('hidden');
    processingSection.classList.add('hidden');

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

updateSliderBackground(headerSlider, 0);
updateSliderBackground(footerSlider, 25);

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

        let cleanKeywords = '';
        if (keywords && keywords.trim() && !keywords.includes('<image:')) {
            cleanKeywords = keywords;
            keywordsInput.value = cleanKeywords;
            detectedText.textContent = cleanKeywords;
        } else {
            keywordsInput.value = '';
            detectedText.textContent = 'None detected';
        }

        console.log('Detected keywords:', cleanKeywords);

        uploadedFileName.textContent = file.name;
        uploadedFileName.title = file.name;
        uploadedFileDisplay.classList.remove('hidden');

        const processingFileName = document.getElementById('processingFileName');
        if (processingFileName) {
            processingFileName.textContent = file.name;
        }

        const detectedBadge = document.getElementById('detectedBadge');
        if (detectedBadge && cleanKeywords) {
            detectedBadge.classList.remove('hidden');
        }
        dropzone.classList.add('hidden');
        heroSection.classList.add('hidden');
        featuresSection.classList.add('hidden');

        uploadSection.style.display = 'block';
        processingSection.classList.remove('hidden');

        await updatePreview();
        await loadStats();

    } catch (error) {
        console.error('Upload error:', error);
        alert(`Failed to analyze PDF: ${error.message}`);
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

        let downloadCount = parseInt(localStorage.getItem('pdf_download_count') || '0');
        downloadCount++;
        localStorage.setItem('pdf_download_count', downloadCount.toString());

        setTimeout(() => showFeedbackModal(), 500);

    } catch (error) {
        console.error('Download error:', error);
        alert(`Failed to process PDF: ${error.message}`);
    } finally {
        hideLoading();
    }
}

downloadBtn.addEventListener('click', downloadFile);

// ============================================
// FEEDBACK MODAL FUNCTIONS - FIXED VERSION
// ============================================

function showFeedbackModal() {
    selectedReaction = null;
    if (feedbackEmail) feedbackEmail.value = '';

    document.querySelectorAll('.reaction-btn').forEach(btn => {
        btn.classList.remove('ring-2', 'ring-indigo-500', 'bg-indigo-50');
    });

    feedbackModal.classList.remove('hidden');
}

function closeFeedbackModal() {
    feedbackModal.classList.add('hidden');
    trackEvent('feedback_skipped');
}

// Quick Feedback - Click smiley = instant feedback + reset
async function quickFeedback(reaction) {
    console.log('✅ Quick feedback:', reaction);

    // Track the reaction with proper data
    await trackEvent(`reaction_${reaction}`, {
        reaction: reaction
    });

    feedbackModal.classList.add('hidden');

    if (removeFileBtn) {
        removeFileBtn.click();
    }
}

// Skip Feedback - Just reset without tracking
function skipFeedback() {
    trackEvent('feedback_skipped');
    feedbackModal.classList.add('hidden');

    if (removeFileBtn) {
        removeFileBtn.click();
    }
}

// Submit with email (if you add email field back)
async function submitFeedback() {
    const email = feedbackEmail ? feedbackEmail.value.trim() : '';

    // Track email submission if provided
    if (email && email.includes('@')) {
        await trackEvent('email_pdf_requested', {
            email: email
        });
    }

    // Track final feedback submission
    await trackEvent('feedback_submitted', {
        reaction: selectedReaction,
        has_email: !!email
    });

    feedbackModal.classList.add('hidden');

    console.log('✅ Feedback submitted:', { reaction: selectedReaction, email: email ? '(provided)' : '(skipped)' });

    if (removeFileBtn) {
        removeFileBtn.click();
    }
}

// Close modal on outside click
if (feedbackModal) {
    feedbackModal.addEventListener('click', function (e) {
        if (e.target === this) {
            skipFeedback();
        }
    });
}

// Change File Button
const changeFileBtn = document.getElementById('changeFileBtn');
if (changeFileBtn) {
    changeFileBtn.addEventListener('click', () => {
        if (removeFileBtn) {
            removeFileBtn.click();
        }
    });
}