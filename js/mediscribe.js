/* ======================================================
   Health AI — MediScribe: lógica de grabación y SOAP
   ====================================================== */

const N8N_BASE = (window.HEALTHAI_CONFIG?.N8N_BASE_URL || 'http://192.168.40.3:5678');
const WEBHOOK_URL = N8N_BASE + '/webhook/consulta-medica';
const HISTORIAL_LISTAR_URL = N8N_BASE + '/webhook/historial-listar';
const HISTORIAL_DECISION_URL = N8N_BASE + '/webhook/historial-decision';

let mediaRecorder = null;
let audioChunks   = [];
let audioBlob     = null;
let timerInterval = null;
let segundos      = 0;
let grabando      = false;
let inputMode     = 'record'; // 'record' | 'upload'
let lastSOAPData  = null;
let lastPaciente  = '';
let lastMedico    = '';
let cie10Catalogo = null; // catálogo oficial Minsalud (cargado de forma diferida)
let cie10Cargando = null;
let lastValidacionCIE10 = null;
let lastConsultaId  = null; // id de la consulta actual, usado para guardar la decisión de remisión

// ── Helpers ───────────────────────────────────────────
const $ = id => document.getElementById(id);

function fmt(s) {
  return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;
}

function showAlert(msg) {
  const el = $('ms-alert');
  el.textContent = msg;
  el.classList.add('visible');
}

function hideAlert() { $('ms-alert')?.classList.remove('visible'); }

// ── Toggle modo: grabar vs subir archivo ──────────────
function switchInputMode(mode) {
  inputMode = mode;
  hideAlert();

  $('mode-btn-record').classList.toggle('active', mode === 'record');
  $('mode-btn-upload').classList.toggle('active', mode === 'upload');
  $('ms-record-panel').style.display = mode === 'record' ? 'block' : 'none';
  $('ms-upload-panel').style.display = mode === 'upload' ? 'block' : 'none';

  // Limpiar audio previo al cambiar de modo
  audioBlob = null;
  $('ms-audio-preview').classList.remove('visible');
  $('ms-file-input').value = '';
}

// ── Carga de archivo de audio (m4a, mp3, wav, etc.) ───
function handleFileUpload(event) {
  hideAlert();
  const file = event.target.files?.[0];
  if (!file) return;

  audioBlob = file; // File extiende Blob, compatible con el resto del flujo

  const url = URL.createObjectURL(file);
  $('ms-audio-player').src = url;
  $('ms-audio-preview').classList.add('visible');

  // Mostrar nombre del archivo en el dropzone
  const dz = $('ms-dropzone');
  let nameEl = dz.querySelector('.upload-filename');
  if (!nameEl) {
    nameEl = document.createElement('div');
    nameEl.className = 'upload-filename';
    dz.appendChild(nameEl);
  }
  nameEl.textContent = `📎 ${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
}

// ── Drag & drop sobre la dropzone ──────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const dz = $('ms-dropzone');
  if (!dz) return;
  ['dragover', 'dragenter'].forEach(evt =>
    dz.addEventListener(evt, e => { e.preventDefault(); dz.classList.add('dragover'); })
  );
  ['dragleave', 'drop'].forEach(evt =>
    dz.addEventListener(evt, e => { e.preventDefault(); dz.classList.remove('dragover'); })
  );
  dz.addEventListener('drop', e => {
    const file = e.dataTransfer.files?.[0];
    if (file) {
      $('ms-file-input').files = e.dataTransfer.files;
      handleFileUpload({ target: { files: [file] } });
    }
  });
});

// ── Grabación ─────────────────────────────────────────
async function toggleGrabacion() {
  if (!grabando) {
    await iniciarGrabacion();
  } else {
    detenerGrabacion();
  }
}

async function iniciarGrabacion() {
  hideAlert();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];

    const mimeType = ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg']
      .find(t => MediaRecorder.isTypeSupported(t)) || '';

    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});

    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };

    mediaRecorder.onstop = () => {
      audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
      const url = URL.createObjectURL(audioBlob);
      $('ms-audio-player').src = url;
      $('ms-audio-preview').classList.add('visible');
      stream.getTracks().forEach(t => t.stop());
    };

    mediaRecorder.start(250);
    grabando = true;

    // UI
    $('ms-mic-btn').className = 'mic-btn recording';
    $('ms-mic-btn').textContent = '⏹';
    $('ms-rec-status').className = 'rec-status recording';
    $('ms-rec-status').textContent = 'Grabando... habla con claridad';
    $('ms-audio-preview').classList.remove('visible');

    segundos = 0;
    $('ms-timer').textContent = fmt(0);
    timerInterval = setInterval(() => {
      segundos++;
      $('ms-timer').textContent = fmt(segundos);
    }, 1000);

  } catch (e) {
    showAlert('No se pudo acceder al micrófono. Verifica los permisos del navegador.');
  }
}

function detenerGrabacion() {
  if (mediaRecorder?.state !== 'inactive') mediaRecorder.stop();
  grabando = false;
  clearInterval(timerInterval);

  $('ms-mic-btn').className = 'mic-btn idle';
  $('ms-mic-btn').textContent = '🎙️';
  $('ms-rec-status').className = 'rec-status ready';
  $('ms-rec-status').textContent = 'Grabación lista — revisa el audio y genera la nota';
}

// ── Envío y procesamiento ─────────────────────────────
async function enviarConsulta() {
  hideAlert();
  const paciente = $('ms-paciente').value.trim();
  const medico   = $('ms-medico').value.trim();

  if (!paciente) { showAlert('Ingresa el nombre del paciente.'); return; }
  if (!audioBlob) { showAlert('Primero graba el audio de la consulta.'); return; }

  // Mostrar loading, ocultar formulario
  $('ms-form-area').style.display = 'none';
  $('ms-loading').classList.add('visible');
  $('ms-resultado').style.display = 'none';

  const pasos = [
    'Enviando audio al servidor...',
    'Transcribiendo con Whisper (puede tardar ~20 seg)...',
    'Estructurando nota SOAP con GPT-4o...',
    'Aplicando formato Res. 1995/1999...',
  ];
  let paso = 0;
  const interval = setInterval(() => {
    paso = Math.min(paso + 1, pasos.length - 1);
    $('ms-loading-text').textContent = pasos[paso];
  }, 7000);

  try {
    const consultaId = uuid();
    const remisionActiva = !!$('ms-remision-toggle')?.checked;

    const fd = new FormData();
    fd.append('id', consultaId);
    fd.append('paciente', paciente);
    fd.append('medico', medico || 'No registrado');
    fd.append('remision', remisionActiva ? 'true' : 'false');
    // Si es un archivo subido, conserva su nombre original; si es grabación, usa un nombre genérico
    const fileName = audioBlob.name || 'consulta.webm';
    fd.append('audio', audioBlob, fileName);

    const resp = await fetch(WEBHOOK_URL, { method: 'POST', body: fd });

    clearInterval(interval);

    if (!resp.ok) throw new Error(`Error ${resp.status}: ${resp.statusText}`);

    const data = await resp.json();
    lastConsultaId = data.id || consultaId;
    renderSOAP(data, paciente, medico);

    // Guardar en historial
    guardarEnHistorial({ ...data, _paciente: paciente, _medico: medico, _ts: new Date().toISOString() });

  } catch (err) {
    clearInterval(interval);
    $('ms-form-area').style.display = 'block';
    $('ms-loading').classList.remove('visible');
    showAlert(`No se pudo conectar con n8n. Verifica que el workflow esté activo.\n${err.message}`);
  }
}

// ── Validación CIE-10 contra catálogo oficial Minsalud ─
// Fuente: Catálogo de patologías CIE-10 (Lista Tabular CIE-10 2018,
// actualizaciones OMS a 2020) — Ministerio de Salud y Protección Social.
// El catálogo se carga una sola vez de forma local (data/cie10.json),
// sin depender de ninguna API externa.

function cargarCatalogoCIE10() {
  if (cie10Catalogo) return Promise.resolve(cie10Catalogo);
  if (cie10Cargando) return cie10Cargando;

  cie10Cargando = fetch('data/cie10.json')
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(json => { cie10Catalogo = json; return json; })
    .catch(err => {
      console.warn('No se pudo cargar el catálogo oficial CIE-10:', err.message);
      cie10Catalogo = { codigos: {}, categorias: {} };
      return cie10Catalogo;
    });

  return cie10Cargando;
}

// Pre-carga el catálogo apenas se abre la app (no bloquea la UI)
document.addEventListener('DOMContentLoaded', cargarCatalogoCIE10);

/**
 * Valida un código CIE-10 generado por la IA contra el catálogo oficial.
 * Devuelve un objeto con:
 *   estado: 'validado'   -> el código de 4 caracteres existe tal cual en el catálogo
 *           'categoria'  -> no existe el código exacto, pero sí su categoría (3 car.)
 *           'no_encontrado' -> no existe ni el código ni su categoría
 *   descripcionOficial: texto oficial asociado (si se encontró algo)
 */
function validarCIE10(codigoIA) {
  const cat = cie10Catalogo || { codigos: {}, categorias: {} };
  const codigo = (codigoIA || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (!codigo || codigo === 'R69') {
    // R69 es el código de "causa desconocida" usado como fallback por la IA
    // cuando no hay suficiente información — no se valida, se marca aparte.
    return { estado: 'sin_codigo', descripcionOficial: null, codigo };
  }

  const exacto = cat.codigos?.[codigo];
  if (exacto) {
    return { estado: 'validado', descripcionOficial: exacto[0], codigo3: exacto[1], codigo };
  }

  const codigo3 = codigo.slice(0, 3);
  const categoria = cat.categorias?.[codigo3];
  if (categoria) {
    return { estado: 'categoria', descripcionOficial: categoria[0], capitulo: categoria[2], codigo };
  }

  return { estado: 'no_encontrado', descripcionOficial: null, codigo };
}

function renderBadgeCIE10(validacion) {
  const badge = $('res-cie10-badge');
  const desc  = $('res-cie10-desc');
  if (!badge || !desc) return;

  const variantes = {
    validado:      { clase: 'ok',   texto: '✅ Validado' },
    categoria:      { clase: 'warn', texto: '⚠️ Categoría aproximada' },
    no_encontrado: { clase: 'bad',  texto: '❌ No encontrado en catálogo oficial' },
    sin_codigo:    { clase: 'warn', texto: '⚠️ Sin código específico (revisar)' },
  };
  const v = variantes[validacion.estado] || variantes.no_encontrado;

  badge.className = 'cie10-badge ' + v.clase;
  badge.textContent = v.texto;
  desc.textContent = validacion.descripcionOficial
    ? `Catálogo oficial Minsalud: "${validacion.descripcionOficial}"`
    : 'Este código no aparece en el catálogo oficial CIE-10 de Minsalud — debe ser revisado por el médico.';
}

// ── Render SOAP ───────────────────────────────────────
function renderSOAP(d, paciente, medico) {
  $('ms-loading').classList.remove('visible');
  $('ms-resultado').style.display = 'block';

  // Guardar para exportación FHIR
  lastSOAPData = d;
  lastPaciente = paciente || d.paciente || '';
  lastMedico   = medico || '';

  const fecha = d.fecha || new Date().toLocaleDateString('es-CO', { year:'numeric', month:'long', day:'numeric' });

  $('res-paciente').textContent  = d.paciente || paciente || '—';
  $('res-fecha').textContent     = fecha;
  $('res-medico').textContent    = medico || 'No registrado';
  $('res-motivo').textContent    = d.subjetivo?.motivo_consulta   || '—';
  $('res-enfermedad').textContent= d.subjetivo?.enfermedad_actual  || '—';
  $('res-antecedentes').textContent = d.subjetivo?.antecedentes    || '—';
  $('res-signos').textContent    = d.objetivo?.signos_vitales      || '—';
  $('res-examen').textContent    = d.objetivo?.examen_fisico       || '—';
  $('res-diagnostico').textContent = d.analisis?.diagnostico       || '—';
  $('res-cie10').textContent     = d.analisis?.codigo_cie10        || '—';
  $('res-tratamiento').textContent = d.plan?.tratamiento           || '—';
  $('res-medicamentos').textContent = d.plan?.medicamentos         || '—';
  $('res-recomendaciones').textContent = d.plan?.recomendaciones   || '—';
  $('res-proxima').textContent   = d.plan?.proxima_cita            || '—';

  // Validar el código CIE-10 sugerido por la IA contra el catálogo oficial
  lastValidacionCIE10 = null;
  cargarCatalogoCIE10().then(() => {
    const validacion = validarCIE10(d.analisis?.codigo_cie10);
    lastValidacionCIE10 = validacion;
    renderBadgeCIE10(validacion);
  });

  // Bloque de remisión (solo si se solicitó al inicio de la consulta)
  renderRemision(d);
}

// ── Remisión a especialista ────────────────────────────
function renderRemision(d) {
  const bloque = $('res-remision-block');
  const r = d.remision;

  if (!bloque) return;
  if (!r || !r.aplica) {
    bloque.style.display = 'none';
    return;
  }

  bloque.style.display = 'block';
  $('res-remision-examenes').textContent = r.examenes_sugeridos || '—';
  $('res-remision-especialidad').textContent = r.especialidad_sugerida || '—';

  // Prellenar el formulario de decisión. Si ya existe una decisión previa
  // (ej. al ver un registro del historial), se respeta lo ya guardado.
  const decisionPrevia = r.decision_medica;
  $('ms-remision-decision').value = decisionPrevia?.estado || 'pendiente';
  $('ms-remision-especialidad-final').value =
    decisionPrevia?.especialidad_final || (r.especialidad_sugerida || '').replace(/^\(sugerido\)\s*/i, '');
  $('ms-remision-observacion').value = decisionPrevia?.observacion || '';
  $('ms-remision-guardado').style.display = 'none';
}

// Guarda en el servidor la decisión final del médico sobre la remisión
async function guardarDecisionRemision() {
  if (!lastConsultaId) {
    showAlert('No hay una consulta activa para guardar la decisión.');
    return;
  }

  const payload = {
    id: lastConsultaId,
    estado: $('ms-remision-decision').value,
    especialidad_final: $('ms-remision-especialidad-final').value.trim(),
    observacion: $('ms-remision-observacion').value.trim()
  };

  try {
    const resp = await fetch(HISTORIAL_DECISION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();

    if (data.error) throw new Error(data.error);

    lastSOAPData = data; // refleja la decisión guardada en los datos actuales (para FHIR)
    $('ms-remision-guardado').style.display = 'block';
  } catch (err) {
    showAlert(`No se pudo guardar la decisión de remisión. ${err.message}`);
  }
}

// ── Nueva consulta ────────────────────────────────────
function nuevaConsulta() {
  audioBlob = null; audioChunks = [];
  $('ms-audio-player').src = '';
  $('ms-audio-preview').classList.remove('visible');
  $('ms-rec-status').className = 'rec-status';
  $('ms-rec-status').textContent = 'Presiona el botón para iniciar la grabación';
  $('ms-timer').textContent = '';
  $('ms-mic-btn').className = 'mic-btn idle';
  $('ms-mic-btn').textContent = '🎙️';
  $('ms-form-area').style.display = 'block';
  $('ms-resultado').style.display = 'none';

  // Limpiar panel de archivo subido
  $('ms-file-input').value = '';
  const nameEl = $('ms-dropzone')?.querySelector('.upload-filename');
  if (nameEl) nameEl.remove();

  // Limpiar estado de remisión
  if ($('ms-remision-toggle')) $('ms-remision-toggle').checked = false;
  if ($('res-remision-block')) $('res-remision-block').style.display = 'none';
  lastConsultaId = null;

  hideAlert();
}

// ── Historial (localStorage) ──────────────────────────
function guardarEnHistorial(data) {
  try {
    const hist = JSON.parse(localStorage.getItem('healthai_historial') || '[]');
    hist.unshift(data);
    localStorage.setItem('healthai_historial', JSON.stringify(hist.slice(0, 100)));
    renderHistorial();
  } catch (_) {}
}

let historialCache = []; // último historial cargado (servidor o localStorage), usado por verDetalle

// Normaliza un registro venga del servidor (Guardar Historial en n8n) o de
// localStorage (guardado por el navegador) a una forma común para pintarlo.
function normalizarRegistro(item) {
  return {
    ...item,
    _paciente: item._paciente || item.paciente || 'Paciente',
    _medico: item._medico || item.medico || '',
    _ts: item._ts || item._creadoEn || new Date().toISOString()
  };
}

async function renderHistorial() {
  const container = $('hist-lista');
  if (!container) return;

  let hist = [];
  let fuenteServidor = false;

  // 1. Intenta traer el historial persistido en el servidor (volumen Docker)
  try {
    const resp = await fetch(HISTORIAL_LISTAR_URL, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data.registros)) {
        hist = data.registros.map(normalizarRegistro);
        fuenteServidor = true;
      }
    }
  } catch (_) { /* el servidor no respondió, usamos respaldo local */ }

  // 2. Si no hay servidor disponible, usa el respaldo guardado en este navegador
  if (!fuenteServidor) {
    try {
      hist = JSON.parse(localStorage.getItem('healthai_historial') || '[]').map(normalizarRegistro);
    } catch (_) { hist = []; }
  }

  historialCache = hist;

  if (hist.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <h3>Sin registros aún</h3>
        <p>Las notas SOAP generadas con MediScribe aparecerán aquí automáticamente.</p>
      </div>`;
    return;
  }

  container.innerHTML = hist.map((item, i) => `
    <div class="card mb-2" style="cursor:pointer" onclick="verDetalle(${i})">
      <div class="flex items-center justify-between">
        <div>
          <div class="font-bold">${item._paciente}</div>
          <div class="text-sm text-muted mt-1">
            ${item.analisis?.diagnostico || 'Sin diagnóstico'} · ${item.analisis?.codigo_cie10 || ''}
            ${item.remision?.aplica ? ' · 🏥 Remisión' : ''}
          </div>
        </div>
        <div class="text-sm text-muted">${new Date(item._ts).toLocaleDateString('es-CO')}</div>
      </div>
    </div>
  `).join('');
}

function verDetalle(idx) {
  const item = historialCache[idx];
  if (!item) return;

  lastConsultaId = item.id || null;

  // Navegar a MediScribe y mostrar el resultado
  navigateTo('sec-mediscribe');
  $('ms-form-area').style.display = 'none';
  $('ms-loading').classList.remove('visible');
  renderSOAP(item, item._paciente, item._medico);
}

// ── Exportación HL7 FHIR R4 ────────────────────────────
// Estructura usada por el Resumen Digital de Atención (RDA) de la
// Resolución 1888/2025: Bundle con Patient, Encounter, Condition,
// Observation (subjetivo/objetivo) y MedicationRequest.

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function buildFHIRBundle(d, paciente, medico) {
  const now = new Date().toISOString();
  const patientId   = uuid();
  const encounterId = uuid();
  const conditionId = uuid();

  const entries = [];

  // ── Patient ──
  entries.push({
    fullUrl: `urn:uuid:${patientId}`,
    resource: {
      resourceType: 'Patient',
      id: patientId,
      name: [{ text: paciente || d.paciente || 'No registrado' }],
      meta: { profile: ['http://hl7.org/fhir/StructureDefinition/Patient'] }
    }
  });

  // ── Encounter ──
  entries.push({
    fullUrl: `urn:uuid:${encounterId}`,
    resource: {
      resourceType: 'Encounter',
      id: encounterId,
      status: 'finished',
      class: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
          code: 'AMB',
          display: 'ambulatory'
        }]
      }],
      subject: { reference: `urn:uuid:${patientId}` },
      participant: medico ? [{
        individual: { display: medico }
      }] : [],
      period: { start: now },
      reasonCode: [{ text: d.subjetivo?.motivo_consulta || 'No registrado' }]
    }
  });

  // ── Condition (diagnóstico + CIE-10) ──
  const cie10 = (d.analisis?.codigo_cie10 || '').trim();
  const validacion = lastValidacionCIE10 || validarCIE10(cie10);
  const notasValidacion = {
    validado:      'Código CIE-10 validado contra el catálogo oficial del Ministerio de Salud (Colombia).',
    categoria:     'Código CIE-10 sugerido por IA: solo se encontró coincidencia a nivel de categoría (3 caracteres) en el catálogo oficial. Requiere revisión médica.',
    no_encontrado: 'Código CIE-10 sugerido por IA: NO se encontró en el catálogo oficial del Ministerio de Salud. Requiere revisión médica antes de su uso clínico.',
    sin_codigo:    'No se asignó un código CIE-10 específico. Requiere revisión médica.'
  };
  entries.push({
    fullUrl: `urn:uuid:${conditionId}`,
    resource: {
      resourceType: 'Condition',
      id: conditionId,
      subject: { reference: `urn:uuid:${patientId}` },
      encounter: { reference: `urn:uuid:${encounterId}` },
      code: {
        text: d.analisis?.diagnostico || 'No registrado',
        coding: (cie10 && cie10 !== 'No registrado') ? [{
          system: 'http://hl7.org/fhir/sid/icd-10',
          code: cie10,
          display: validacion.descripcionOficial || d.analisis?.diagnostico || ''
        }] : []
      },
      note: [{ text: notasValidacion[validacion.estado] || notasValidacion.no_encontrado }],
      recordedDate: now
    }
  });

  // ── Observation: Subjetivo (enfermedad actual + antecedentes) ──
  entries.push({
    fullUrl: `urn:uuid:${uuid()}`,
    resource: {
      resourceType: 'Observation',
      status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'social-history' }] }],
      code: { text: 'Historia clínica - Subjetivo' },
      subject: { reference: `urn:uuid:${patientId}` },
      encounter: { reference: `urn:uuid:${encounterId}` },
      effectiveDateTime: now,
      valueString: `Enfermedad actual: ${d.subjetivo?.enfermedad_actual || 'No registrado'}. Antecedentes: ${d.subjetivo?.antecedentes || 'No registrado'}.`
    }
  });

  // ── Observation: Signos vitales ──
  entries.push({
    fullUrl: `urn:uuid:${uuid()}`,
    resource: {
      resourceType: 'Observation',
      status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] }],
      code: { text: 'Signos vitales' },
      subject: { reference: `urn:uuid:${patientId}` },
      encounter: { reference: `urn:uuid:${encounterId}` },
      effectiveDateTime: now,
      valueString: d.objetivo?.signos_vitales || 'No registrado'
    }
  });

  // ── Observation: Examen físico ──
  entries.push({
    fullUrl: `urn:uuid:${uuid()}`,
    resource: {
      resourceType: 'Observation',
      status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'exam' }] }],
      code: { text: 'Examen físico' },
      subject: { reference: `urn:uuid:${patientId}` },
      encounter: { reference: `urn:uuid:${encounterId}` },
      effectiveDateTime: now,
      valueString: d.objetivo?.examen_fisico || 'No registrado'
    }
  });

  // ── MedicationRequest (medicamentos del plan) ──
  if (d.plan?.medicamentos && d.plan.medicamentos !== 'No registrado') {
    entries.push({
      fullUrl: `urn:uuid:${uuid()}`,
      resource: {
        resourceType: 'MedicationRequest',
        status: 'active',
        intent: 'order',
        subject: { reference: `urn:uuid:${patientId}` },
        encounter: { reference: `urn:uuid:${encounterId}` },
        authoredOn: now,
        medicationCodeableConcept: { text: d.plan.medicamentos },
        note: [{ text: d.plan?.tratamiento || '' }]
      }
    });
  }

  // ── CarePlan (recomendaciones + próxima cita) ──
  entries.push({
    fullUrl: `urn:uuid:${uuid()}`,
    resource: {
      resourceType: 'CarePlan',
      status: 'active',
      intent: 'plan',
      subject: { reference: `urn:uuid:${patientId}` },
      encounter: { reference: `urn:uuid:${encounterId}` },
      description: d.plan?.recomendaciones || 'No registrado',
      note: [{ text: `Próxima cita: ${d.plan?.proxima_cita || 'No registrado'}` }]
    }
  });

  // ── ServiceRequest (remisión a especialista, solo si se solicitó) ──
  if (d.remision?.aplica) {
    const dec = d.remision.decision_medica;
    const estadoFHIR = { remitir: 'active', no_remitir: 'revoked', pendiente: 'draft' }[dec?.estado] || 'draft';
    const notas = [{ text: `Especialidad sugerida por IA: ${d.remision.especialidad_sugerida || 'No registrado'}` }];
    if (dec) {
      notas.push({
        text: `Decisión médica: ${dec.estado} — Especialidad final: ${dec.especialidad_final || 'No registrado'}${dec.observacion ? ' — Observación: ' + dec.observacion : ''}`
      });
    } else {
      notas.push({ text: 'Decisión médica: pendiente de confirmar por el médico tratante.' });
    }

    entries.push({
      fullUrl: `urn:uuid:${uuid()}`,
      resource: {
        resourceType: 'ServiceRequest',
        status: estadoFHIR,
        intent: 'plan',
        subject: { reference: `urn:uuid:${patientId}` },
        encounter: { reference: `urn:uuid:${encounterId}` },
        code: { text: d.remision.examenes_sugeridos || 'No registrado' },
        authoredOn: now,
        note: notas
      }
    });
  }

  return {
    resourceType: 'Bundle',
    type: 'collection',
    timestamp: now,
    meta: {
      profile: ['https://www.minsalud.gov.co/ihc/fhir/StructureDefinition/RDA-Bundle']
    },
    entry: entries
  };
}

function downloadFHIR() {
  if (!lastSOAPData) {
    showAlert('No hay ninguna nota generada todavía.');
    return;
  }

  const bundle = buildFHIRBundle(lastSOAPData, lastPaciente, lastMedico);
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/fhir+json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  const nombreArchivo = (lastPaciente || 'paciente').replace(/\s+/g, '_').toLowerCase();
  const fechaArchivo = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `FHIR_${nombreArchivo}_${fechaArchivo}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Exponer funciones globalmente
window.toggleGrabacion  = toggleGrabacion;
window.enviarConsulta   = enviarConsulta;
window.nuevaConsulta    = nuevaConsulta;
window.renderHistorial  = renderHistorial;
window.verDetalle       = verDetalle;
window.switchInputMode  = switchInputMode;
window.handleFileUpload = handleFileUpload;
window.downloadFHIR     = downloadFHIR;
window.validarCIE10     = validarCIE10;
window.guardarDecisionRemision = guardarDecisionRemision;
