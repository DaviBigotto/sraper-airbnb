// Global Application State
let appState = {
  currentUrl: '',
  title: '',
  photos: [],
  selectedPhotos: new Set(),
  lightboxIndex: 0
};

// Paste from Clipboard helper
async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (text && text.trim()) {
      const input = document.getElementById('airbnb-url-input');
      input.value = text.trim();
      input.focus();
    }
  } catch (err) {
    console.warn('Clipboard access denied or unavailable:', err);
  }
}

// Handle Search Form Submission
async function handleFormSubmit(event) {
  event.preventDefault();
  const inputEl = document.getElementById('airbnb-url-input');
  const rawUrl = inputEl.value.trim();

  if (!rawUrl) return;

  appState.currentUrl = rawUrl;
  appState.selectedPhotos.clear();

  // Show Loading View
  showState('loading');
  updateLoadingProgress('Conectando ao Airbnb...', 'Extraindo galeria original em alta definição.');

  try {
    const response = await fetch(`/api/scrape?url=${encodeURIComponent(rawUrl)}`);
    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Não foi possível extrair as fotos do imóvel.');
    }

    if (!data.photos || data.photos.length === 0) {
      throw new Error('Nenhuma foto foi encontrada neste link. Verifique se o anúncio está ativo.');
    }

    appState.title = data.title;
    appState.photos = data.photos;

    // Select all photos by default
    data.photos.forEach(photo => appState.selectedPhotos.add(photo));

    renderResults();
    showState('results');

  } catch (err) {
    console.error('Fetch Error:', err);
    document.getElementById('error-message-text').innerText = err.message;
    showState('error');
  }
}

// Render Results Grid & Info
function renderResults() {
  document.getElementById('property-title').innerText = appState.title;
  document.getElementById('photo-count-badge').innerText = appState.photos.length;

  const gridEl = document.getElementById('photos-grid');
  gridEl.innerHTML = '';

  appState.photos.forEach((photoUrl, idx) => {
    const isSelected = appState.selectedPhotos.has(photoUrl);

    const card = document.createElement('div');
    card.className = `photo-card ${isSelected ? 'selected' : ''}`;
    card.id = `photo-card-${idx}`;

    // Proxy image URL for safe rendering & download
    const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(photoUrl)}`;

    card.innerHTML = `
      <div class="photo-img-wrapper" onclick="openLightbox(${idx})">
        <img src="${proxyUrl}" alt="Foto ${idx + 1}" loading="lazy" />
        <div class="photo-hover-overlay">
          <button class="btn-icon-action" onclick="event.stopPropagation(); openLightbox(${idx})" title="Ampliar">
            <i class="fa-solid fa-expand"></i>
          </button>
          <a class="btn-icon-action" href="${proxyUrl}" download="foto_${idx + 1}.jpg" onclick="event.stopPropagation()" title="Baixar foto individual">
            <i class="fa-solid fa-download"></i>
          </a>
        </div>
      </div>
      <div class="photo-checkbox-wrapper" onclick="event.stopPropagation()">
        <input 
          type="checkbox" 
          class="photo-checkbox" 
          id="chk-${idx}" 
          ${isSelected ? 'checked' : ''} 
          onchange="togglePhotoSelection(${idx})"
        />
      </div>
      <div class="photo-index-badge">#${idx + 1}</div>
    `;

    gridEl.appendChild(card);
  });

  updateSelectedCountUI();
}

// Toggle individual photo checkbox
function togglePhotoSelection(index) {
  const photoUrl = appState.photos[index];
  const cardEl = document.getElementById(`photo-card-${index}`);
  const chkEl = document.getElementById(`chk-${index}`);

  if (chkEl.checked) {
    appState.selectedPhotos.add(photoUrl);
    cardEl.classList.add('selected');
  } else {
    appState.selectedPhotos.delete(photoUrl);
    cardEl.classList.remove('selected');
  }

  updateSelectedCountUI();
}

// Select All / Deselect All
function selectAllPhotos(select) {
  appState.selectedPhotos.clear();

  appState.photos.forEach((photoUrl, idx) => {
    const cardEl = document.getElementById(`photo-card-${idx}`);
    const chkEl = document.getElementById(`chk-${idx}`);

    if (select) {
      appState.selectedPhotos.add(photoUrl);
      chkEl.checked = true;
      cardEl.classList.add('selected');
    } else {
      chkEl.checked = false;
      cardEl.classList.remove('selected');
    }
  });

  updateSelectedCountUI();
}

// Update Download Button Count Badge
function updateSelectedCountUI() {
  const count = appState.selectedPhotos.size;
  const tagEl = document.getElementById('selected-count-tag');
  const btnZip = document.getElementById('btn-download-zip');

  tagEl.innerText = count;
  btnZip.disabled = count === 0;
}

// Download Selected Photos as ZIP
async function downloadSelectedZip() {
  const selectedArr = Array.from(appState.selectedPhotos);
  if (selectedArr.length === 0) return;

  const btnZip = document.getElementById('btn-download-zip');
  const originalText = btnZip.innerHTML;

  btnZip.disabled = true;
  btnZip.innerHTML = `<i class="fa-solid fa-spinner spinner"></i> Gerando ZIP (${selectedArr.length} fotos)...`;

  try {
    const response = await fetch('/api/download-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        photos: selectedArr,
        title: appState.title
      })
    });

    if (!response.ok) throw new Error('Erro ao empacotar arquivo ZIP.');

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');

    const safeTitle = (appState.title || 'airbnb_fotos').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 30);
    a.href = downloadUrl;
    a.download = `${safeTitle}_fotos.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(downloadUrl);

  } catch (err) {
    alert('Ops! Ocorreu um erro ao baixar o arquivo ZIP: ' + err.message);
  } finally {
    btnZip.disabled = false;
    btnZip.innerHTML = originalText;
  }
}

// Lightbox Modal Controls
function openLightbox(index) {
  appState.lightboxIndex = index;
  updateLightboxView();
  document.getElementById('lightbox-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  document.getElementById('lightbox-modal').classList.add('hidden');
  document.body.style.overflow = 'auto';
}

function closeLightboxOnBackdrop(e) {
  if (e.target.id === 'lightbox-modal') {
    closeLightbox();
  }
}

function navigateLightbox(dir) {
  const total = appState.photos.length;
  appState.lightboxIndex = (appState.lightboxIndex + dir + total) % total;
  updateLightboxView();
}

function updateLightboxView() {
  const idx = appState.lightboxIndex;
  const photoUrl = appState.photos[idx];
  const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(photoUrl)}`;

  document.getElementById('lightbox-img').src = proxyUrl;
  document.getElementById('lightbox-counter').innerText = `Foto ${idx + 1} de ${appState.photos.length}`;
  
  const dlLink = document.getElementById('lightbox-download-link');
  dlLink.href = proxyUrl;
  dlLink.download = `foto_${idx + 1}.jpg`;
}

// Keyboard shortcuts for Lightbox & UX
document.addEventListener('keydown', (e) => {
  const modal = document.getElementById('lightbox-modal');
  if (!modal.classList.contains('hidden')) {
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') navigateLightbox(-1);
    if (e.key === 'ArrowRight') navigateLightbox(1);
  }
});

// UI State Switcher
function showState(stateName) {
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('error-state').classList.add('hidden');
  document.getElementById('results-state').classList.add('hidden');

  if (stateName === 'loading') document.getElementById('loading-state').classList.remove('hidden');
  if (stateName === 'error') document.getElementById('error-state').classList.remove('hidden');
  if (stateName === 'results') document.getElementById('results-state').classList.remove('hidden');
}

function updateLoadingProgress(title, desc) {
  document.getElementById('loading-status-title').innerText = title;
  document.getElementById('loading-status-desc').innerText = desc;
}

function resetApp() {
  showState('');
  document.getElementById('airbnb-url-input').focus();
}
