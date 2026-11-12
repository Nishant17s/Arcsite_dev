// project-app.js - Project-specific logic with persistent storage

const projectId = window.location.pathname.split('/')[2];
const hotspotLayer = document.getElementById('hotspot-layer');
const popup = document.getElementById('popup');
const assetListEl = document.getElementById('asset-list');
const searchInput = document.getElementById('search');
const siteMap = document.getElementById('site-map');
const mapUpload = document.getElementById('map-upload');
const toggleEditBtn = document.getElementById('toggle-edit');
const exportJsonBtn = document.getElementById('export-json');
const editorPanel = document.getElementById('editor-panel');
const edTitle = document.getElementById('ed-title');
const edX = document.getElementById('ed-x');
const edY = document.getElementById('ed-y');
const edW = document.getElementById('ed-w');
const edH = document.getElementById('ed-h');
const edSave = document.getElementById('ed-save');
const edNudgeLeft = document.getElementById('ed-nudge-left');
const edNudgeRight = document.getElementById('ed-nudge-right');
const edNudgeUp = document.getElementById('ed-nudge-up');
const edNudgeDown = document.getElementById('ed-nudge-down');

let projectData = null;
let assets = [];
let activeAssetId = null;
let editMode = false;
const hotspotMap = new Map();

async function init(){
  try{
    // Load project data from server
    const res = await fetch(`/api/projects/${projectId}/data`);
    if(!res.ok) throw new Error('Project not found');
    
    projectData = await res.json();
    assets = projectData.assets || [];
    
    // Update UI with project name
    document.getElementById('project-name-display').textContent = `Project: ${projectData.projectName}`;
    document.title = `${projectData.projectName} - ArcSite`;
    
    // Load custom map if exists
    const mapPath = `/projects/${projectId}/assets/site-map.svg`;
    const mapCheck = await fetch(mapPath, {method: 'HEAD'});
    if(mapCheck.ok) {
      siteMap.src = mapPath;
    } else {
      // Check for other image formats
      const formats = ['png', 'jpg', 'jpeg'];
      for(const fmt of formats){
        const p = `/projects/${projectId}/assets/site-map.${fmt}`;
        const c = await fetch(p, {method: 'HEAD'});
        if(c.ok){
          siteMap.src = p;
          break;
        }
      }
    }
    
    buildHotspots();
    renderAssetList(assets);
    setupDocumentHandlers();
    setupSearch();
    setupUpload();
    setupEditorControls();
  }catch(err){
    console.error(err);
    popup.classList.remove('hidden');
    popup.innerHTML = `<h3>Error</h3><div>Could not load project data.</div>`;
  }
}

// Auto-save project data
async function saveProjectData(){
  try{
    await fetch(`/api/projects/${projectId}/data`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(projectData)
    });
  }catch(err){
    console.error('Auto-save failed:', err);
  }
}

function buildHotspots(){
  hotspotLayer.innerHTML = '';

  assets.forEach(asset =>{
    const el = document.createElement('div');
    el.className = 'hotspot';
    el.style.left = asset.x;
    el.style.top = asset.y;
    if(asset.w) el.style.width = asset.w;
    if(asset.h) el.style.height = asset.h;
    el.setAttribute('data-id', asset.id);
    el.setAttribute('tabindex', '0');

    const hit = document.createElement('div');
    hit.className = 'hitarea';
    el.appendChild(hit);

    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = asset.title;
    el.appendChild(label);

    // resize handle for direct manipulation
    const resizer = document.createElement('div');
    resizer.className = 'resize-handle';
    el.appendChild(resizer);

    // small move hint label when in edit mode
    const moveHint = document.createElement('div');
    moveHint.className = 'move-hint';
    moveHint.textContent = 'drag';
    el.appendChild(moveHint);

    el.addEventListener('click', (e)=>{
      e.stopPropagation();
      openPopupForAssetAtPointer(asset, e.clientX, e.clientY);
      setActiveAsset(asset.id);
    });

    el.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter' || e.key === ' '){
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        openPopupForAssetAtPointer(asset, rect.left + rect.width/2, rect.top + rect.height/2);
        setActiveAsset(asset.id);
      } else if(e.key === 'Escape'){
        closePopup();
      }
    });

    // drag to move (only in edit mode)
    hit.addEventListener('mousedown', (e)=>{
      if(!editMode) return;
      e.preventDefault();
      startDrag(asset.id, e.clientX, e.clientY);
    });

    // resize using resizer (only in edit mode)
    resizer.addEventListener('mousedown', (e)=>{
      if(!editMode) return;
      e.stopPropagation();
      e.preventDefault();
      startResize(asset.id, e.clientX, e.clientY);
    });

    hotspotLayer.appendChild(el);
    hotspotMap.set(asset.id, el);
  });
}

function renderAssetList(list){
  assetListEl.innerHTML = '';
  if(!list.length){
    assetListEl.innerHTML = '<div style="color:#666;padding:8px">No assets found</div>';
    return;
  }

  list.forEach(asset=>{
    const item = document.createElement('div');
    item.className = 'asset-item';
    item.setAttribute('role','listitem');
    item.dataset.id = asset.id;

    const left = document.createElement('div');
    const docCount = countDocs(asset);
    left.innerHTML = `<div class="asset-title">${asset.title}</div><div class="asset-sub">${docCount} docs</div>`;
    item.appendChild(left);

    const right = document.createElement('div');
    const openBtn = document.createElement('button');
    openBtn.className = 'btn';
    openBtn.textContent = 'Open';
    openBtn.addEventListener('click', (e)=>{
      e.stopPropagation();
      focusAssetOnMap(asset.id);
      setActiveAsset(asset.id);
    });
    right.appendChild(openBtn);
    item.appendChild(right);

    item.addEventListener('click', ()=>{
      focusAssetOnMap(asset.id);
      setActiveAsset(asset.id);
    });

    assetListEl.appendChild(item);
  });
}

function countDocs(asset){
  if(asset.links) return asset.links.length;
  if(asset.categories){
    return Object.values(asset.categories).reduce((sum, cat)=> sum + cat.length, 0);
  }
  return 0;
}

function setActiveAsset(id){
  activeAssetId = id;
  document.querySelectorAll('.asset-item').forEach(el=>{
    el.classList.toggle('active', el.dataset.id === id);
  });
  // if edit mode show editor panel for this asset
  if(editMode){
    const asset = assets.find(a=>a.id === id);
    if(asset) showEditorForAsset(asset);
  } else {
    hideEditor();
  }
}

function focusAssetOnMap(id){
  const asset = assets.find(a=>a.id === id);
  if(!asset) return;
  // compute center coords in client space
  const containerRect = hotspotLayer.getBoundingClientRect();
  const left = percentToPx(asset.x, containerRect.width);
  const top = percentToPx(asset.y, containerRect.height);
  const w = asset.w ? percentToPx(asset.w, containerRect.width) : 0;
  const h = asset.h ? percentToPx(asset.h, containerRect.height) : 0;
  const cx = containerRect.left + left + (w/2);
  const cy = containerRect.top + top + (h/2);
  openPopupForAssetAtPointer(asset, cx, cy);
}

function percentToPx(value, total){
  if(!value) return 0;
  if(typeof value === 'string' && value.trim().endsWith('%')){
    return (parseFloat(value) / 100) * total;
  }
  return parseFloat(value) || 0;
}

function openPopupForAssetAtPointer(asset, clientX, clientY){
  popup.innerHTML = '';
  
  // Add visual building icon/shape
  const visual = document.createElement('div');
  visual.className = `popup-visual shape-${asset.shape || 'rect'}`;
  visual.textContent = asset.icon || '🏢';
  popup.appendChild(visual);
  
  const title = document.createElement('h3');
  title.textContent = asset.title;
  popup.appendChild(title);

  // Check if asset uses categories or simple links
  if(asset.categories){
    // Render expandable categories
    Object.keys(asset.categories).forEach(catName=>{
      const catSection = document.createElement('div');
      catSection.className = 'category-section';

      const catHeader = document.createElement('div');
      catHeader.className = 'category-header';
      catHeader.innerHTML = `<span class="category-icon">▶</span> <strong>${catName}</strong> (${asset.categories[catName].length})`;
      catSection.appendChild(catHeader);

      const catList = document.createElement('ul');
      catList.className = 'category-list collapsed';
      asset.categories[catName].forEach(link=>{
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = link.href;
        a.textContent = link.label;
        li.appendChild(a);
        catList.appendChild(li);
      });
      catSection.appendChild(catList);

      // toggle expand/collapse
      catHeader.addEventListener('click', ()=>{
        const isCollapsed = catList.classList.toggle('collapsed');
        catHeader.querySelector('.category-icon').textContent = isCollapsed ? '▶' : '▼';
      });

      popup.appendChild(catSection);
    });
  } else if(asset.links){
    // fallback: simple flat list
    const list = document.createElement('ul');
    asset.links.forEach(link=>{
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = link.href;
      a.textContent = link.label;
      li.appendChild(a);
      list.appendChild(li);
    });
    popup.appendChild(list);
  }

  // position popup relative to hotspot layer with smart arrow placement
  const containerRect = hotspotLayer.getBoundingClientRect();
  const x = clientX - containerRect.left;
  const y = clientY - containerRect.top;
  const pad = 20;
  
  // Determine optimal position (avoid edges)
  const popupWidth = 320; // approximate
  const popupHeight = 400; // approximate
  
  let finalX = x + 20;
  let finalY = y - 40;
  let arrowClass = 'arrow-left';
  
  // Check right edge
  if(finalX + popupWidth > containerRect.width - pad){
    finalX = x - popupWidth - 20;
    arrowClass = 'arrow-right';
  }
  
  // Check bottom edge
  if(finalY + popupHeight > containerRect.height - pad){
    finalY = containerRect.height - popupHeight - pad;
  }
  
  // Check top edge
  if(finalY < pad + 60){ // 60px for visual icon
    finalY = pad + 60;
  }
  
  popup.style.left = Math.max(pad, finalX) + 'px';
  popup.style.top = Math.max(pad + 60, finalY) + 'px';
  
  // Set arrow direction
  popup.className = arrowClass;
  popup.classList.remove('hidden');
}

function closePopup(){
  popup.classList.add('hidden');
}

/* Upload handling */
function setupUpload(){
  if(!mapUpload) return;
  mapUpload.addEventListener('change', async (e)=>{
    const file = e.target.files && e.target.files[0];
    if(!file) return;
    
    // Upload to server
    const formData = new FormData();
    formData.append('map', file);
    
    try{
      const res = await fetch(`/api/projects/${projectId}/upload-map`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      
      if(data.success){
        siteMap.src = data.path + '?' + Date.now(); // cache bust
      }
    }catch(err){
      console.error('Upload failed:', err);
      alert('Failed to upload map');
    }
  });
}

/* Edit mode and inline editor */
function setupEditorControls(){
  if(!toggleEditBtn) return;
  toggleEditBtn.addEventListener('click', ()=>{
    editMode = !editMode;
    toggleEditBtn.classList.toggle('active', editMode);
    document.body.classList.toggle('editing', editMode);
    if(editMode){
      toggleEditBtn.textContent = 'Editing: ON';
      // if an asset is active show editor
      if(activeAssetId){
        const asset = assets.find(a=>a.id===activeAssetId);
        if(asset) showEditorForAsset(asset);
      }
    } else {
      toggleEditBtn.textContent = 'Edit Mode';
      hideEditor();
    }
  });

  if(exportJsonBtn){
    exportJsonBtn.addEventListener('click', ()=>{
      exportUpdatedJSON();
    });
  }

  edSave.addEventListener('click', ()=>{
    if(!activeAssetId) return;
    const asset = assets.find(a=>a.id===activeAssetId);
    if(!asset) return;
    // simple validation
    asset.x = sanitizePercent(edX.value) || asset.x;
    asset.y = sanitizePercent(edY.value) || asset.y;
    asset.w = sanitizePercent(edW.value) || asset.w;
    asset.h = sanitizePercent(edH.value) || asset.h;
    applyAssetToHotspot(asset);
    renderAssetList(assets);
    saveProjectData(); // Auto-save
  });

  edNudgeLeft.addEventListener('click', ()=>{nudgeActive(-1,0)});
  edNudgeRight.addEventListener('click', ()=>{nudgeActive(1,0)});
  edNudgeUp.addEventListener('click', ()=>{nudgeActive(0,-1)});
  edNudgeDown.addEventListener('click', ()=>{nudgeActive(0,1)});
}

function sanitizePercent(value){
  if(!value) return null;
  value = value.trim();
  if(value.endsWith('%')) return value;
  const num = parseFloat(value);
  if(isNaN(num)) return null;
  return num + '%';
}

function showEditorForAsset(asset){
  edTitle.textContent = asset.title;
  edX.value = asset.x || '';
  edY.value = asset.y || '';
  edW.value = asset.w || '';
  edH.value = asset.h || '';
  editorPanel.classList.remove('hidden');
  editorPanel.setAttribute('aria-hidden','false');
}

function hideEditor(){
  editorPanel.classList.add('hidden');
  editorPanel.setAttribute('aria-hidden','true');
}

function nudgeActive(dxPercent, dyPercent){
  if(!activeAssetId) return;
  const asset = assets.find(a=>a.id===activeAssetId);
  if(!asset) return;
  // convert x,y strings to numbers
  const xNum = parseFloat(asset.x) || 0;
  const yNum = parseFloat(asset.y) || 0;
  asset.x = (xNum + dxPercent) + '%';
  asset.y = (yNum + dyPercent) + '%';
  // update inputs and hotspot
  edX.value = asset.x;
  edY.value = asset.y;
  applyAssetToHotspot(asset);
  saveProjectData(); // Auto-save
}

function applyAssetToHotspot(asset){
  const el = hotspotMap.get(asset.id);
  if(!el) return;
  if(asset.x) el.style.left = asset.x;
  if(asset.y) el.style.top = asset.y;
  if(asset.w) el.style.width = asset.w; else el.style.width = '';
  if(asset.h) el.style.height = asset.h; else el.style.height = '';
}

function exportUpdatedJSON(){
  const out = {
    projectName: projectData.projectName,
    createdAt: projectData.createdAt,
    assets
  };
  const blob = new Blob([JSON.stringify(out, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${projectData.projectName.replace(/\s+/g, '-')}-data.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* Drag & Resize implementation */
let currentDrag = null;
let currentResize = null;

function startDrag(id, clientX, clientY){
  const el = hotspotMap.get(id);
  if(!el) return;
  const rect = hotspotLayer.getBoundingClientRect();
  const leftPx = rect.width * (parseFloat(el.style.left || '0')/100);
  const topPx = rect.height * (parseFloat(el.style.top || '0')/100);
  currentDrag = {id, startX: clientX, startY: clientY, startLeftPx: leftPx, startTopPx: topPx};
  document.body.classList.add('dragging');
}

function startResize(id, clientX, clientY){
  const el = hotspotMap.get(id);
  if(!el) return;
  const rect = hotspotLayer.getBoundingClientRect();
  const leftPx = rect.width * (parseFloat(el.style.left || '0')/100);
  const topPx = rect.height * (parseFloat(el.style.top || '0')/100);
  const wpx = parseFloat(el.style.width || '0') ? rect.width * (parseFloat(el.style.width)/100) : (el.getBoundingClientRect().width || 0);
  const hpx = parseFloat(el.style.height || '0') ? rect.height * (parseFloat(el.style.height)/100) : (el.getBoundingClientRect().height || 0);
  currentResize = {id, startX: clientX, startY: clientY, startWpx: wpx, startHpx: hpx, startLeftPx: leftPx, startTopPx: topPx};
  document.body.classList.add('resizing');
}

function onPointerMove(e){
  if(currentDrag){
    const rect = hotspotLayer.getBoundingClientRect();
    const dx = e.clientX - currentDrag.startX;
    const dy = e.clientY - currentDrag.startY;
    let newLeftPx = currentDrag.startLeftPx + dx;
    let newTopPx = currentDrag.startTopPx + dy;
    // clamp inside container
    newLeftPx = Math.max(0, Math.min(rect.width - 4, newLeftPx));
    newTopPx = Math.max(0, Math.min(rect.height - 4, newTopPx));
    const newLeftPct = (newLeftPx / rect.width) * 100;
    const newTopPct = (newTopPx / rect.height) * 100;
    const asset = assets.find(a=>a.id === currentDrag.id);
    if(asset){
      asset.x = newLeftPct.toFixed(2) + '%';
      asset.y = newTopPct.toFixed(2) + '%';
      applyAssetToHotspot(asset);
      // update editor inputs if visible
      if(activeAssetId === asset.id) {
        edX.value = asset.x; edY.value = asset.y;
      }
    }
  }
  if(currentResize){
    const rect = hotspotLayer.getBoundingClientRect();
    const dx = e.clientX - currentResize.startX;
    const dy = e.clientY - currentResize.startY;
    let newWpx = Math.max(8, currentResize.startWpx + dx);
    let newHpx = Math.max(8, currentResize.startHpx + dy);
    // clamp to container
    newWpx = Math.min(newWpx, rect.width - currentResize.startLeftPx);
    newHpx = Math.min(newHpx, rect.height - currentResize.startTopPx);
    const newWPct = (newWpx / rect.width) * 100;
    const newHPct = (newHpx / rect.height) * 100;
    const asset = assets.find(a=>a.id === currentResize.id);
    if(asset){
      asset.w = newWPct.toFixed(2) + '%';
      asset.h = newHPct.toFixed(2) + '%';
      applyAssetToHotspot(asset);
      if(activeAssetId === asset.id){
        edW.value = asset.w; edH.value = asset.h;
      }
    }
  }
}

function onPointerUp(e){
  if(currentDrag){
    currentDrag = null;
    document.body.classList.remove('dragging');
    renderAssetList(assets);
    saveProjectData(); // Auto-save after drag
  }
  if(currentResize){
    currentResize = null;
    document.body.classList.remove('resizing');
    renderAssetList(assets);
    saveProjectData(); // Auto-save after resize
  }
}

document.addEventListener('mousemove', onPointerMove);
document.addEventListener('mouseup', onPointerUp);

function setupSearch(){
  if(!searchInput) return;
  let timer = null;
  searchInput.addEventListener('input', (e)=>{
    clearTimeout(timer);
    const q = e.target.value.trim().toLowerCase();
    timer = setTimeout(()=>{
      const filtered = assets.filter(a=>a.title.toLowerCase().includes(q));
      renderAssetList(filtered);
    }, 120);
  });
}

function setupDocumentHandlers(){
  // close popup when clicking outside
  document.addEventListener('click', (e)=>{
    if(!popup.classList.contains('hidden')){
      const path = e.composedPath ? e.composedPath() : (e.path || []);
      if(!path.includes(popup)) closePopup();
    }
  });
  // close with Esc
  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape') closePopup();
  });
}

// Start
init();
