
// ===== SUPABASE CONFIG =====
const SUPABASE_URL = 'https://zndlkrncigojiojqudxi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuZGxrcm5jaWdvamlvanF1ZHhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MjE5NzgsImV4cCI6MjA5MDQ5Nzk3OH0.T72h43ZUjyLvyYsDaA_sTzlgErZjQ9C2j_X7dtnsRuw';

async function sbFetch(path, options={}) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...options.headers
    },
    ...options
  });
  if (!res.ok) { const e = await res.text(); throw new Error(e); }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

async function normalizeImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const blobUrl = URL.createObjectURL(file);
    img.onload = function () {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(function (blob) {
        URL.revokeObjectURL(blobUrl);
        if (!blob) { reject(new Error('No se pudo convertir la imagen')); return; }
        const converted = new File(
          [blob],
          file.name.replace(/\.[^.]+$/, '') + '.jpg',
          { type: 'image/jpeg' }
        );
        resolve(converted);
      }, 'image/jpeg', 0.9);
    };
    img.onerror = function () {
      URL.revokeObjectURL(blobUrl);
      reject(new Error('Formato de imagen no compatible'));
    };
    img.src = blobUrl;
  });
}

async function uploadFoto(file, equipoId) {
  let fileToUpload, contentType, ext;
  try {
    fileToUpload = await normalizeImage(file);
    contentType = 'image/jpeg';
    ext = 'jpg';
  } catch(e) {
    fileToUpload = file;
    contentType = file.type || 'image/jpeg';
    ext = file.name.split('.').pop().toLowerCase() || 'jpg';
  }
  const path = equipoId + '/' + Date.now() + '.' + ext;
  const res = await fetch(SUPABASE_URL + '/storage/v1/object/fotos/' + path, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': contentType
    },
    body: fileToUpload
  });
  if (!res.ok) throw new Error('Error subiendo foto');
  return SUPABASE_URL + '/storage/v1/object/public/fotos/' + path;
}

// ===== STATE =====
let machines = [];
let novedades = [];
let currentPhotos = []; // File objects pending upload
let currentPhotoUrls = []; // Already uploaded URLs (existing in DB)
let removedPhotoUrls = []; // URLs to delete from DB on save
let currentVideos = [];
let currentVideoUrls = [];
let removedVideoUrls = [];
let editingId = null;
let currentNvFoto = null;

// ===== LOAD DATA =====
async function loadMachines() {
  try {
    const equipos = await sbFetch('equipos?select=*,fotos_equipos(url,orden),videos_equipos(url,orden)&order=created_at.desc');
    machines = equipos.map(e => ({
      id: e.id,
      nombre: e.nombre,
      categoria: e.categoria,
      marca: e.marca || '',
      anio: e.anio || '',
      precio: e.precio || '',
      desc: e.descripcion || '',
      specs: e.especificaciones || [],
      activo: e.activo,
      estado: e.estado || '',
      fotos: (e.fotos_equipos || []).sort((a,b) => a.orden - b.orden).map(f => f.url),
      videos: (e.videos_equipos || []).sort((a,b) => a.orden - b.orden).map(f => f.url)
    }));
  } catch(e) {
    console.error('Error cargando equipos:', e);
    machines = [];
  }
}

async function loadNovedades() {
  try {
    novedades = await sbFetch('novedades?order=created_at.desc');
  } catch(e) {
    console.error('Error cargando novedades:', e);
    novedades = [];
  }
}

// ===== NAVIGATION =====
function toggleMobileMenu() {
  var links = document.querySelector('.nav-links');
  if (links) links.classList.toggle('mobile-open');
}

function showSection(name) {
  try {
    var links = document.querySelector('.nav-links');
    if (links) links.classList.remove('mobile-open');
    document.querySelectorAll('section').forEach(function(s) { s.classList.remove('active'); });
    var el = document.getElementById('sec-' + name);
    if (el) el.classList.add('active');
    document.querySelectorAll('.nav-links a:not(.nav-btn-admin)').forEach(function(a) { a.classList.remove('active'); });
    var map = {'inicio':0,'equipos':1,'quienes-somos':2,'novedades':3,'contacto':4};
    var navLinks = document.querySelectorAll('.nav-links a:not(.nav-btn-admin)');
    if (navLinks[map[name]] !== undefined) navLinks[map[name]].classList.add('active');
    window.scrollTo(0,0);
    if (name === 'equipos') renderEquipos('Todos');
    if (name === 'novedades') renderNovedades();
  } catch(e) { console.error('showSection error:', e); }
}

// ===== SLIDER =====
var currentSlide = 0;
var totalSlides = 3;
var sliderTimer = null;
function goSlide(n) {
  document.querySelectorAll('.hero-slide').forEach(function(s,i) { s.classList.toggle('active', i===n); });
  document.querySelectorAll('.hero-dot').forEach(function(d,i) { d.classList.toggle('active', i===n); });
  currentSlide = n;
}
function nextSlide() { goSlide((currentSlide+1) % totalSlides); }
function prevSlide() { goSlide((currentSlide-1+totalSlides) % totalSlides); }
function startSlider() { sliderTimer = setInterval(nextSlide, 5000); }

// ===== MACHINE CARD =====
function machineCardHTML(m) {
  var fotoHTML = (m.fotos && m.fotos.length > 0)
    ? '<img src="' + m.fotos[0] + '" alt="' + m.nombre + '" style="width:100%;height:100%;object-fit:cover;">'
    : '<div class="machine-card-img-placeholder"><svg width="56" height="42" viewBox="0 0 64 48" fill="none"><rect x="2" y="16" width="44" height="26" rx="3" stroke="#8a8a82" stroke-width="2"/><circle cx="14" cy="42" r="6" stroke="#8a8a82" stroke-width="2"/><circle cx="38" cy="42" r="6" stroke="#8a8a82" stroke-width="2"/></svg><span>Sin foto</span></div>';
  var badge = m.estado === 'nuevo' ? 'badge-nuevo' : 'badge-usado';
  var specs = (m.specs||[]).slice(0,4).map(function(s) { return '<span class="spec-tag">'+s+'</span>'; }).join('');
  return '<div class="machine-card" onclick="openFotoModal(\''+m.id+'\')">'
    + '<div class="machine-card-img">'+fotoHTML+(m.estado==='vendido'?'<div class="badge-vendido">Vendido</div>':m.estado==='proximamente'?'<div class="badge-proximamente">Próximamente</div>':'')+'</div>'
    + '<div class="machine-card-body">'
    + '<div class="machine-card-model">'+m.categoria+(m.marca?' · '+m.marca:'')+'</div>'
    + '<div class="machine-card-name">'+m.nombre+'</div>'
    + '<div class="machine-card-desc">'+m.desc+'</div>'
    + '<div class="machine-card-specs">'+specs+'</div>'
    + '<div class="machine-card-footer">'
    + '<div class="machine-card-price">'+(m.precio ? 'USD '+m.precio : '')+'</div>'
    + '</div></div></div>';
}

function renderEquipos(cat) {
  var el = document.getElementById('equipos-list');
  if (!el) return;
  if (machines.length === 0) {
    el.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--text-light);">Cargando equipos...</div>';
    loadMachines().then(function() { renderEquipos(cat); });
    return;
  }
  var filtered = cat === 'Todos' ? machines.filter(function(m) { return m.activo; }) : machines.filter(function(m) { return m.activo && m.categoria === cat; });
  el.innerHTML = filtered.length > 0 ? filtered.map(machineCardHTML).join('') : '<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--text-light);">No hay equipos en esta categoría</div>';
}

function filterCat(el, cat) {
  document.querySelectorAll('.cat-tab').forEach(function(t) { t.classList.remove('active'); });
  el.classList.add('active');
  renderEquipos(cat);
}

function filterCatDirect(cat) {
  document.querySelectorAll('.cat-tab').forEach(function(t) {
    t.classList.toggle('active', t.textContent.trim() === cat || (cat==='Todos' && t.textContent.trim()==='Todos'));
  });
  renderEquipos(cat);
}

function consultMachine(nombre) {
  showSection('contacto');
  setTimeout(function() {
    var msg = document.getElementById('ct-mensaje');
    if (msg) msg.value = 'Consulta sobre: ' + nombre;
  }, 200);
}

function renderNovedades() {
  var grid = document.getElementById('novedades-grid');
  var empty = document.getElementById('novedades-empty');
  if (!grid) return;
  if (novedades.length === 0) { grid.style.display='none'; empty.style.display='block'; return; }
  grid.style.display='grid'; empty.style.display='none';
  grid.innerHTML = novedades.map(function(n) {
    return '<div class="novedad-card">'
      + '<div class="novedad-img">'+(n.foto_url?'<img src="'+n.foto_url+'" alt="">':'📰')+'</div>'
      + '<div class="novedad-body">'
      + '<div class="novedad-cat">'+(n.fecha||'')+' · '+(n.categoria||'Novedad')+'</div>'
      + '<div class="novedad-title">'+n.titulo+'</div>'
      + '<div class="novedad-desc">'+n.resumen+'</div>'
      + '</div></div>';
  }).join('');
}

// ===== CONTACT =====
function submitQS() {
  var n = document.getElementById('qs-nombre').value.trim();
  if (!n) { showToast('⚠ Ingresá tu nombre'); return; }
  showToast('✓ Mensaje enviado. Te contactamos pronto.');
  ['qs-nombre','qs-tel','qs-email','qs-msg'].forEach(function(id) { document.getElementById(id).value=''; });
}
function submitContacto() {
  var n = document.getElementById('ct-nombre').value.trim();
  if (!n) { showToast('⚠ Ingresá tu nombre'); return; }
  showToast('✓ Mensaje enviado. Te contactamos pronto.');
  ['ct-nombre','ct-tel','ct-email','ct-mensaje'].forEach(function(id) { document.getElementById(id).value=''; });
}

// ===== ADMIN LOGIN =====
function openAdmin() { document.getElementById('admin-overlay').classList.add('active'); }
function closeAdmin() { document.getElementById('admin-overlay').classList.remove('active'); }
function doLogin() {
  var u = document.getElementById('login-user').value;
  var p = document.getElementById('login-pass').value;
  if (u==='admin' && p==='campo2025') {
    document.getElementById('admin-overlay').classList.remove('active');
    document.getElementById('admin-panel').classList.add('active');
    loadMachines().then(function() { renderAdminTable(); });
  } else {
    document.getElementById('login-error').style.display='block';
  }
}
document.addEventListener('DOMContentLoaded', function() {
  var lp = document.getElementById('login-pass');
  if (lp) lp.addEventListener('keydown', function(e) { if(e.key==='Enter') doLogin(); });
});
function closeAdminPanel() {
  document.getElementById('admin-panel').classList.remove('active');
}
function adminTab(tab, el) {
  document.querySelectorAll('.admin-card').forEach(function(c) { c.style.display='none'; });
  document.querySelectorAll('.admin-menu-item').forEach(function(i) { i.classList.remove('active'); });
  var t = document.getElementById('tab-'+tab);
  if (t) t.style.display='block';
  if (el) el.classList.add('active');
  if (tab==='catalogo') loadMachines().then(renderAdminTable);
  if (tab==='novedades-admin') loadNovedades().then(renderNvList);
  if (tab==='equipo') loadEquipoPersonas().then(function() { renderEquipoListAdmin(); });
}

// ===== PHOTO UPLOAD (pending files) =====
async function handleFiles(files) {
  for (const file of Array.from(files)) {
    if (!file.type.startsWith('image/')) {
      showToast('⚠ Solo se pueden subir imágenes.');
      continue;
    }
    currentPhotos.push(file);
    var url = URL.createObjectURL(file);
    currentPhotoUrls.push({ url: url, existing: false });
  }
  renderPreviews();
}
function handleDrop(e) { e.preventDefault(); handleFiles(e.dataTransfer.files); }
function renderPreviews() {
  document.getElementById('photo-previews').innerHTML = currentPhotoUrls.map(function(item, i) {
    var url = typeof item === 'string' ? item : item.url;
    return '<div class="photo-preview-item"><img src="'+url+'"><button class="photo-preview-remove" onclick="event.stopPropagation();removePhoto('+i+')">✕</button></div>';
  }).join('');
}
function removePhoto(i) {
  var item = currentPhotoUrls[i];
  // Si es una URL existente en la BD, la marcamos para eliminar al guardar
  if (item && (typeof item === 'string' || item.existing)) {
    var url = typeof item === 'string' ? item : item.url;
    removedPhotoUrls.push(url);
  } else {
    // Es un archivo nuevo pendiente de subir, solo quitarlo del array de archivos
    // Encontrar el índice correspondiente en currentPhotos
    var newIdx = 0;
    for (var j = 0; j < i; j++) {
      if (currentPhotoUrls[j] && !currentPhotoUrls[j].existing) newIdx++;
    }
    currentPhotos.splice(newIdx, 1);
  }
  currentPhotoUrls.splice(i, 1);
  renderPreviews();
}

// ===== VIDEO UPLOAD =====
function handleVideoFiles(files) {
  Array.from(files).forEach(function(file) {
    currentVideos.push(file);
    var url = URL.createObjectURL(file);
    currentVideoUrls.push({ url: url, existing: false });
    renderVideoPreviews();
  });
}
function handleVideoDrop(e) { e.preventDefault(); handleVideoFiles(e.dataTransfer.files); }
function renderVideoPreviews() {
  document.getElementById('video-previews').innerHTML = currentVideoUrls.map(function(item, i) {
    var url = typeof item === 'string' ? item : item.url;
    return '<div class="photo-preview-item"><video src="'+url+'" style="width:100%;height:100%;object-fit:cover;"></video><button class="photo-preview-remove" onclick="event.stopPropagation();removeVideo('+i+')">✕</button></div>';
  }).join('');
}
function removeVideo(i) {
  var item = currentVideoUrls[i];
  if (item && (typeof item === 'string' || item.existing)) {
    removedVideoUrls.push(typeof item === 'string' ? item : item.url);
  } else {
    var newIdx = 0;
    for (var j = 0; j < i; j++) {
      if (currentVideoUrls[j] && !currentVideoUrls[j].existing) newIdx++;
    }
    currentVideos.splice(newIdx, 1);
  }
  currentVideoUrls.splice(i, 1);
  renderVideoPreviews();
}
async function uploadVideo(file, equipoId) {
  var ext = file.name.split('.').pop();
  var path = 'equipo_' + equipoId + '_' + Date.now() + '.' + ext;
  var res = await fetch(SUPABASE_URL + '/storage/v1/object/videos/' + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': file.type },
    body: file
  });
  if (!res.ok) throw new Error('Error subiendo video');
  return SUPABASE_URL + '/storage/v1/object/public/videos/' + path;
}

// ===== SAVE MACHINE =====
async function saveMachine() {
  var nombre = document.getElementById('f-nombre').value.trim();
  var categoria = document.getElementById('f-categoria').value;
  if (!nombre || !categoria) { showToast('⚠ Completá nombre y categoría'); return; }

  var specs = document.getElementById('f-specs').value
    ? document.getElementById('f-specs').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean)
    : [];

  var btn = document.querySelector('#tab-agregar .admin-submit');
  btn.textContent = 'Guardando...'; btn.disabled = true;

  try {
    var equipoData = {
      nombre: nombre,
      categoria: categoria,
      marca: document.getElementById('f-marca').value,
      anio: document.getElementById('f-anio').value,
      precio: document.getElementById('f-precio').value,
      descripcion: document.getElementById('f-desc').value,
      estado: document.getElementById('f-estado').value,
      especificaciones: specs,
      activo: true
    };

    var equipo;
    if (editingId) {
      var result = await sbFetch('equipos?id=eq.' + editingId, {
        method: 'PATCH',
        body: JSON.stringify(equipoData)
      });
      equipo = result[0];
    } else {
      var result = await sbFetch('equipos', {
        method: 'POST',
        body: JSON.stringify(equipoData)
      });
      equipo = result[0];
    }

    // Delete removed photos from DB
    if (removedPhotoUrls.length > 0) {
      for (var r = 0; r < removedPhotoUrls.length; r++) {
        try {
          await sbFetch('fotos_equipos?url=eq.' + encodeURIComponent(removedPhotoUrls[r]), { method: 'DELETE' });
        } catch(e2) { console.warn('No se pudo eliminar foto:', e2); }
      }
    }

    // Upload new photos
    if (currentPhotos.length > 0) {
      var existingCount = currentPhotoUrls.filter(function(x){ return x && x.existing; }).length;
      for (var i = 0; i < currentPhotos.length; i++) {
        var url = await uploadFoto(currentPhotos[i], equipo.id);
        await sbFetch('fotos_equipos', {
          method: 'POST',
          body: JSON.stringify({ equipo_id: equipo.id, url: url, orden: existingCount + i })
        });
      }
    }

    // Delete removed videos from DB
    if (removedVideoUrls.length > 0) {
      for (var rv = 0; rv < removedVideoUrls.length; rv++) {
        try {
          await sbFetch('videos_equipos?url=eq.' + encodeURIComponent(removedVideoUrls[rv]), { method: 'DELETE' });
        } catch(e2) { console.warn('No se pudo eliminar video:', e2); }
      }
    }

    // Upload new videos
    if (currentVideos.length > 0) {
      var existingVideoCount = currentVideoUrls.filter(function(x){ return x && x.existing; }).length;
      for (var vi = 0; vi < currentVideos.length; vi++) {
        var vurl = await uploadVideo(currentVideos[vi], equipo.id);
        await sbFetch('videos_equipos', {
          method: 'POST',
          body: JSON.stringify({ equipo_id: equipo.id, url: vurl, orden: existingVideoCount + vi })
        });
      }
    }

    showToast('✓ Equipo guardado correctamente');
    clearForm();
    await loadMachines();

  } catch(e) {
    console.error(e);
    showToast('✗ Error guardando: ' + e.message);
  } finally {
    btn.textContent = 'Guardar equipo'; btn.disabled = false;
  }
}

function clearForm() {
  ['f-nombre','f-marca','f-anio','f-precio','f-desc','f-specs'].forEach(function(id) { document.getElementById(id).value=''; });
  document.getElementById('f-categoria').value='';
  document.getElementById('f-estado').value='usado';
  currentPhotos=[]; currentPhotoUrls=[]; removedPhotoUrls=[]; renderPreviews(); editingId=null;
  currentVideos=[]; currentVideoUrls=[]; removedVideoUrls=[]; renderVideoPreviews();
  document.getElementById('form-title').textContent='➕ Agregar nuevo equipo';
}

function renderAdminTable() {
  var tbody = document.getElementById('admin-table-body');
  if (!tbody) return;
  if (machines.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-light);">No hay equipos cargados</td></tr>';
    return;
  }
  tbody.innerHTML = machines.map(function(m) {
    return '<tr>'
      +'<td>'+(m.fotos&&m.fotos.length>0?'<img src="'+m.fotos[0]+'" alt="" style="width:52px;height:38px;object-fit:cover;border-radius:3px;">':'<div style="width:52px;height:38px;background:var(--cream-dark);border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--text-light);">sin foto</div>')+'</td>'
      +'<td><strong>'+m.nombre+'</strong><br><span style="font-size:11px;color:var(--text-light);">'+(m.marca||'')+' '+(m.anio||'')+'</span></td>'
      +'<td>'+m.categoria+'</td>'
      +'<td>'+(m.precio?'USD '+m.precio:'—')+'</td>'
      +'<td><span class="status-pill '+(m.activo?'pill-active':'pill-inactive')+'">'+(m.activo?'Activo':'Oculto')+'</span></td>'
      +'<td>'
      +'<button class="tbl-btn tbl-edit" onclick="editMachine(\''+m.id+'\')">✏ Editar</button>'
      +'<button class="tbl-btn tbl-edit" style="background:'+(m.activo?'#fef3e2':'#e4f5ea')+';color:'+(m.activo?'#8b5e00':'#1d6e3f')+'" onclick="toggleActive(\''+m.id+'\','+(m.activo?'false':'true')+')">'+  (m.activo?'Ocultar':'Mostrar')+'</button>'
      +'<button class="tbl-btn tbl-del" onclick="deleteMachine(\''+m.id+'\')">🗑</button>'
      +'</td></tr>';
  }).join('');
}

function editMachine(id) {
  var m = machines.find(function(x) { return x.id===id; });
  if (!m) return;
  editingId = id;
  adminTab('agregar', document.querySelectorAll('.admin-menu-item')[0]);
  document.getElementById('f-nombre').value = m.nombre||'';
  document.getElementById('f-categoria').value = m.categoria||'';
  document.getElementById('f-marca').value = m.marca||'';
  document.getElementById('f-anio').value = m.anio||'';
  document.getElementById('f-precio').value = m.precio||'';
  document.getElementById('f-desc').value = m.desc||'';
  document.getElementById('f-specs').value = (m.specs||[]).join(', ');
  document.getElementById('f-estado').value = m.estado||'';
  currentPhotos=[]; currentPhotoUrls=m.fotos?m.fotos.map(function(u){return {url:u,existing:true};}):[];  removedPhotoUrls=[]; renderPreviews();
  currentVideos=[]; currentVideoUrls=m.videos?m.videos.map(function(u){return {url:u,existing:true};}):[];  removedVideoUrls=[]; renderVideoPreviews();
  document.getElementById('form-title').textContent='✏ Editando: '+m.nombre;
}

async function toggleActive(id, activo) {
  try {
    await sbFetch('equipos?id=eq.'+id, { method:'PATCH', body: JSON.stringify({activo: activo==='true'}) });
    await loadMachines(); renderAdminTable(); showToast('✓ Estado actualizado');
  } catch(e) { showToast('✗ Error: '+e.message); }
}

async function deleteMachine(id) {
  if (!confirm('¿Eliminar este equipo?')) return;
  try {
    await sbFetch('equipos?id=eq.'+id, { method:'DELETE' });
    await loadMachines(); renderAdminTable(); showToast('Equipo eliminado');
  } catch(e) { showToast('✗ Error: '+e.message); }
}

// ===== NOVEDADES =====
function handleNvFile(files) {
  if (!files[0]) return;
  currentNvFoto = files[0];
  var url = URL.createObjectURL(files[0]);
  document.getElementById('nv-preview').innerHTML='<div class="photo-preview-item" style="width:120px;height:80px;"><img src="'+url+'"><button class="photo-preview-remove" onclick="currentNvFoto=null;document.getElementById(\'nv-preview\').innerHTML=\'\'" >✕</button></div>';
}

async function saveNovedad() {
  var titulo = document.getElementById('nv-titulo').value.trim();
  var resumen = document.getElementById('nv-resumen').value.trim();
  if (!titulo||!resumen) { showToast('⚠ Completá título y descripción'); return; }

  var btn = document.querySelector('#tab-novedades-admin .admin-submit');
  btn.textContent='Publicando...'; btn.disabled=true;

  try {
    var fotoUrl = null;
    if (currentNvFoto) {
      var path = 'novedades/' + Date.now() + '.' + currentNvFoto.name.split('.').pop();
      var res = await fetch(SUPABASE_URL+'/storage/v1/object/fotos/'+path, {
        method:'POST',
        headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY,'Content-Type':currentNvFoto.type},
        body: currentNvFoto
      });
      if (res.ok) fotoUrl = SUPABASE_URL+'/storage/v1/object/public/fotos/'+path;
    }

    var fecha = document.getElementById('nv-fecha').value;
    var fechaFmt = fecha ? new Date(fecha).toLocaleDateString('es-UY',{day:'numeric',month:'long',year:'numeric'}) : new Date().toLocaleDateString('es-UY',{day:'numeric',month:'long',year:'numeric'});

    await sbFetch('novedades', {
      method:'POST',
      body: JSON.stringify({
        titulo: titulo,
        resumen: resumen,
        categoria: document.getElementById('nv-categoria').value,
        fecha: fechaFmt,
        foto_url: fotoUrl
      })
    });

    showToast('✓ Novedad publicada');
    clearNovedad();
    await loadNovedades(); renderNvList();
  } catch(e) {
    showToast('✗ Error: '+e.message);
  } finally {
    btn.textContent='Publicar'; btn.disabled=false;
  }
}

function clearNovedad() {
  document.getElementById('nv-titulo').value='';
  document.getElementById('nv-resumen').value='';
  document.getElementById('nv-fecha').value='';
  document.getElementById('nv-preview').innerHTML='';
  currentNvFoto=null;
}

function renderNvList() {
  var el=document.getElementById('nv-list');
  if(!el) return;
  if(novedades.length===0){ el.innerHTML='<p style="font-size:13px;color:var(--text-light);">No hay novedades.</p>'; return; }
  el.innerHTML=novedades.map(function(n) {
    return '<div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--cream);border-radius:4px;border:1px solid var(--cream-dark);margin-bottom:8px;">'
      +(n.foto_url?'<img src="'+n.foto_url+'" style="width:60px;height:42px;object-fit:cover;border-radius:3px;flex-shrink:0;">':'<div style="width:60px;height:42px;background:var(--cream-dark);border-radius:3px;flex-shrink:0;display:flex;align-items:center;justify-content:center;">📰</div>')
      +'<div style="flex:1;min-width:0;"><div style="font-size:14px;font-weight:600;color:var(--green);">'+n.titulo+'</div>'
      +'<div style="font-size:11px;color:var(--text-light);">'+n.fecha+' · '+n.categoria+'</div></div>'
      +'<button class="tbl-btn tbl-del" onclick="deleteNovedad(\''+n.id+'\')">🗑</button></div>';
  }).join('');
}

async function deleteNovedad(id) {
  if(!confirm('¿Eliminar esta novedad?')) return;
  try {
    await sbFetch('novedades?id=eq.'+id, {method:'DELETE'});
    await loadNovedades(); renderNvList(); showToast('Novedad eliminada');
  } catch(e) { showToast('✗ Error: '+e.message); }
}


var modalFotos = [];
var modalIdx = 0;
function openFotoModal(id) {
  var m = machines.find(function(x) { return x.id == id; });
  if (!m) return;
  var fotos = (m.fotos || []).map(function(u){ return {url:u, type:'foto'}; });
  var videos = (m.videos || []).map(function(u){ return {url:u, type:'video'}; });
  modalFotos = fotos.concat(videos);
  modalIdx = 0;
  document.getElementById('modal-title').textContent = m.nombre + (m.marca ? ' · ' + m.marca : '') + (m.anio ? ' ' + m.anio : '');
  document.getElementById('foto-modal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  renderModal();
}
function renderModal() {
  var container = document.getElementById('modal-media-container');
  var counter = document.getElementById('modal-counter');
  var thumbs = document.getElementById('modal-thumbs');
  var arrows = document.querySelectorAll('.modal-nav-btn');
  arrows.forEach(function(a){ a.style.display = modalFotos.length > 1 ? '' : 'none'; });
  if (modalFotos.length === 0) { container.innerHTML=''; counter.textContent='Sin fotos'; thumbs.innerHTML=''; return; }
  var item = modalFotos[modalIdx];
  container.innerHTML = '';
  var el = document.createElement(item.type === 'video' ? 'video' : 'img');
  el.style.cssText = 'width:auto;height:auto;max-width:94vw;max-height:68vh;object-fit:contain;border-radius:6px;display:block;';
  if (item.type === 'video') {
    el.controls = true;
    el.src = item.url;
  } else {
    el.alt = '';
    el.loading = 'eager';
    el.decoding = 'async';
    el.onerror = function() {
      container.innerHTML = '<div style="color:#fff;text-align:center;padding:30px;">No se pudo cargar esta imagen</div>';
    };
    el.src = item.url;
  }
  container.appendChild(el);
  counter.textContent = (modalIdx+1) + ' / ' + modalFotos.length;
  thumbs.innerHTML = modalFotos.map(function(it,i) {
    var border = 'border:2px solid '+(i===modalIdx?'var(--gold)':'transparent');
    var opacity = 'opacity:'+(i===modalIdx?'1':'0.6');
    if (it.type === 'video') {
      return '<div onclick="goModalFoto('+i+')" style="width:64px;height:48px;border-radius:4px;cursor:pointer;'+border+';'+opacity+';background:#111;display:flex;align-items:center;justify-content:center;font-size:22px;">▶</div>';
    }
    return '<img src="'+it.url+'" onclick="goModalFoto('+i+')" style="width:64px;height:48px;object-fit:cover;border-radius:4px;cursor:pointer;'+border+';'+opacity+';">';
  }).join('');
}
function goModalFoto(i) { modalIdx=i; renderModal(); }
function modalNav(dir) { modalIdx=(modalIdx+dir+modalFotos.length)%modalFotos.length; renderModal(); }
function closeFotoModal() {
  document.getElementById('foto-modal').style.display='none';
  document.body.style.overflow='';
  document.getElementById('modal-media-container').innerHTML='';
}
document.addEventListener('keydown', function(e) {
  if(document.getElementById('foto-modal').style.display!=='flex') return;
  if(e.key==='Escape') closeFotoModal();
  if(e.key==='ArrowRight') modalNav(1);
  if(e.key==='ArrowLeft') modalNav(-1);
});

// ===== EQUIPO (QUIENES SOMOS) =====
let equipoPersonas = [];
let editingPersonaId = null;
let currentEqFoto = null;

async function loadEquipoPersonas() {
  try {
    equipoPersonas = await sbFetch('equipo_personas?order=orden.asc,created_at.asc');
  } catch(e) {
    console.error('Error cargando equipo:', e);
    equipoPersonas = [];
  }
}

function handleEqFile(files) {
  if (!files[0]) return;
  currentEqFoto = files[0];
  var url = URL.createObjectURL(files[0]);
  document.getElementById('eq-preview').innerHTML = '<div class="photo-preview-item" style="width:80px;height:80px;border-radius:50%;overflow:hidden;"><img src="'+url+'" style="width:100%;height:100%;object-fit:cover;"></div>';
}

async function savePersona() {
  var nombre = document.getElementById('eq-nombre').value.trim();
  if (!nombre) { showToast('⚠ Ingresá el nombre'); return; }

  var btn = document.querySelector('#tab-equipo .admin-submit');
  btn.textContent = 'Guardando...'; btn.disabled = true;

  try {
    var fotoUrl = null;

    // Si hay foto nueva, subirla
    if (currentEqFoto) {
      var path = 'equipo/' + Date.now() + '.' + currentEqFoto.name.split('.').pop();
      var res = await fetch(SUPABASE_URL + '/storage/v1/object/fotos/' + path, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': currentEqFoto.type },
        body: currentEqFoto
      });
      if (res.ok) {
        fotoUrl = SUPABASE_URL + '/storage/v1/object/public/fotos/' + path;
      } else {
        var errBody = await res.text();
        console.error('Error subiendo foto equipo:', res.status, errBody);
        showToast('Error al subir la foto (' + res.status + '). Revisá la consola para más detalles.');
        btn.textContent = 'Guardar'; btn.disabled = false;
        return;
      }
    }

    var data = {
      nombre: nombre,
      rol: document.getElementById('eq-rol').value.trim(),
      telefono: document.getElementById('eq-tel').value.trim(),
      orden: parseInt(document.getElementById('eq-orden').value) || 99
    };

    if (fotoUrl) {
      // Foto nueva subida con exito
      data.foto_url = fotoUrl;
    } else if (editingPersonaId) {
      // Editando sin cambiar foto: preservar la foto_url existente
      var existing = equipoPersonas.find(function(p) { return p.id === editingPersonaId; });
      if (existing && existing.foto_url) data.foto_url = existing.foto_url;
    }

    if (editingPersonaId) {
      await sbFetch('equipo_personas?id=eq.' + editingPersonaId, { method: 'PATCH', body: JSON.stringify(data) });
    } else {
      await sbFetch('equipo_personas', { method: 'POST', body: JSON.stringify(data) });
    }

    showToast('✓ Persona guardada');
    clearPersonaForm();
    await loadEquipoPersonas();
    renderEquipoListAdmin();
    renderEquipoPublico();
  } catch(e) {
    showToast('✗ Error: ' + e.message);
  } finally {
    btn.textContent = 'Guardar'; btn.disabled = false;
  }
}

function clearPersonaForm() {
  document.getElementById('eq-nombre').value = '';
  document.getElementById('eq-rol').value = '';
  document.getElementById('eq-tel').value = '';
  document.getElementById('eq-orden').value = '';
  document.getElementById('eq-preview').innerHTML = '';
  currentEqFoto = null;
  editingPersonaId = null;
  document.getElementById('equipo-form-title').textContent = '➕ Agregar persona';
}

function renderEquipoListAdmin() {
  var el = document.getElementById('equipo-list-admin');
  if (!el) return;
  if (equipoPersonas.length === 0) {
    el.innerHTML = '<p style="font-size:13px;color:var(--text-light);">No hay personas cargadas.</p>';
    return;
  }
  var html = '';
  for (var i = 0; i < equipoPersonas.length; i++) {
    var p = equipoPersonas[i];
    html += '<div style="display:flex;align-items:center;gap:8px;padding:12px;background:var(--cream);border-radius:4px;border:1px solid var(--cream-dark);margin-bottom:8px;">';
    // Flechas orden
    html += '<div style="display:flex;flex-direction:column;gap:2px;">';
    html += '<button onclick="moverPersona('+i+',-1)" '+(i===0?'disabled style="opacity:0.3;"':'')+' style="background:var(--green);color:#fff;border:none;border-radius:3px;width:24px;height:24px;cursor:pointer;font-size:14px;line-height:1;">▲</button>';
    html += '<button onclick="moverPersona('+i+',1)" '+(i===equipoPersonas.length-1?'disabled style="opacity:0.3;"':'')+' style="background:var(--green);color:#fff;border:none;border-radius:3px;width:24px;height:24px;cursor:pointer;font-size:14px;line-height:1;">▼</button>';
    html += '</div>';
    // Foto
    html += p.foto_url ? '<img src="'+p.foto_url+'" style="width:48px;height:48px;object-fit:cover;border-radius:50%;flex-shrink:0;">' : '<div style="width:48px;height:48px;background:var(--cream-dark);border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;">👤</div>';
    // Info
    html += '<div style="flex:1;"><div style="font-size:14px;font-weight:700;color:var(--green);">'+p.nombre+'</div>';
    if (p.rol) html += '<div style="font-size:11px;color:var(--gold);">'+p.rol+'</div>';
    if (p.telefono) html += '<div style="font-size:12px;color:var(--text-mid);">'+p.telefono+'</div>';
    html += '</div>';
    // Botones
    html += '<button class="tbl-btn tbl-edit" onclick="editPersonaByIdx('+i+')">✏ Editar</button>';
    html += '<button class="tbl-btn tbl-del" onclick="deletePersonaByIdx('+i+')">🗑</button>';
    html += '</div>';
  }
  el.innerHTML = html;
}


async function moverPersona(idx, dir) {
  var newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= equipoPersonas.length) return;

  // Swap orden values
  var p1 = equipoPersonas[idx];
  var p2 = equipoPersonas[newIdx];
  var tempOrden = p1.orden;

  try {
    await sbFetch('equipo_personas?id=eq.' + p1.id, { method: 'PATCH', body: JSON.stringify({ orden: p2.orden }) });
    await sbFetch('equipo_personas?id=eq.' + p2.id, { method: 'PATCH', body: JSON.stringify({ orden: tempOrden }) });
    await loadEquipoPersonas();
    renderEquipoListAdmin();
    renderEquipoPublico();
    showToast('✓ Orden actualizado');
  } catch(e) {
    showToast('✗ Error: ' + e.message);
  }
}

function editPersonaByIdx(i) { editPersona(equipoPersonas[i].id); }
function deletePersonaByIdx(i) { deletePersona(equipoPersonas[i].id); }

function editPersona(id) {
  var p = equipoPersonas.find(function(x) { return x.id === id; });
  if (!p) return;
  editingPersonaId = id;
  document.getElementById('eq-nombre').value = p.nombre || '';
  document.getElementById('eq-rol').value = p.rol || '';
  document.getElementById('eq-tel').value = p.telefono || '';
  document.getElementById('eq-orden').value = p.orden || '';
  document.getElementById('equipo-form-title').textContent = '✏ Editando: ' + p.nombre;
  if (p.foto_url) {
    document.getElementById('eq-preview').innerHTML = '<div class="photo-preview-item" style="width:80px;height:80px;border-radius:50%;overflow:hidden;"><img src="'+p.foto_url+'" style="width:100%;height:100%;object-fit:cover;"></div>';
  }
  var form = document.getElementById("equipo-form-title");
  if (form) form.scrollIntoView({behavior:"smooth"});
}

async function deletePersona(id) {
  if (!confirm('¿Eliminar esta persona?')) return;
  try {
    await sbFetch('equipo_personas?id=eq.' + id, { method: 'DELETE' });
    await loadEquipoPersonas();
    renderEquipoListAdmin();
    renderEquipoPublico();
    showToast('Persona eliminada');
  } catch(e) { showToast('✗ Error: ' + e.message); }
}

function renderEquipoPublico() {
  var container = document.querySelector('#sec-quienes-somos .team-cards-container');
  if (!container) return;
  if (equipoPersonas.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-light);">Sin personas cargadas.</div>';
    return;
  }
  container.innerHTML = equipoPersonas.map(function(p) {
    return '<div class="team-card">'
      + '<div class="team-photo">' + (p.foto_url ? '<img src="'+p.foto_url+'" alt="'+p.nombre+'">' : '<div class="team-photo-placeholder">👤</div>') + '</div>'
      + '<div class="team-info">'
      + (p.rol ? '<div class="team-role">'+p.rol+'</div>' : '')
      + '<div class="team-name">'+p.nombre+'</div>'
      + (p.telefono ? '<div class="team-phone">📞 '+p.telefono+'</div>' : '')
      + '</div></div>';
  }).join('');
}

// ===== TOAST =====
function showToast(msg) {
  var t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(function(){ t.classList.remove('show'); },3000);
}

// ===== INIT =====
startSlider();
loadMachines();
loadNovedades();
loadEquipoPersonas().then(renderEquipoPublico);
