const $ = selector => document.querySelector(selector);
const form = $('#form'), box = $('#message'), convo = $('#conversation'), status = $('#status'), send = $('#send'), interrupt = $('#interrupt');
const mic = $('#mic'), sound = $('#sound'), debate = $('#debate'), researchMode = $('#researchMode');
let history = [], speak = true, debating = false, activeChat = null, activeSpeech = null, currentAudio = null, requestSeq = 0, recognition = null;
function needsCurrentData(message, mode) {
  if (mode === 'Market Analysis') return true;
  if (mode === 'Historical Book Analysis') return false;
  return /\b(latest|current|currently|today|yesterday|this week|this month|this year|right now|recent|breaking|live|news|updates?|what(?:'s| is) happening|price|stock|shares|exchange rate|inflation|interest rates|GDP|oil price|gold price|crypto)\b/i.test(message);
}
function updateInterrupt() { interrupt.hidden = !(activeChat || activeSpeech || currentAudio || ('speechSynthesis' in window && speechSynthesis.speaking)); }
function appendBubbleMetadata(el, sources = [], truncated = false, cached = false) {
  if (sources.length) {
    const list = document.createElement('div'); list.className = 'source-list';
    const heading = document.createElement('b'); heading.textContent = 'Evidence and source access'; list.append(heading);
    let webSourceNumber = 0;
    sources.forEach(source => {
      if (source.url) {
        webSourceNumber += 1;
        const link = document.createElement('a'); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `[${webSourceNumber}] ${source.title || source.url}`; list.append(link);
        const detail = document.createElement('small');
        const published = source.published_at ? `Published ${new Date(source.published_at).toLocaleString()}.` : 'Publication date not identified.';
        const retrieved = source.retrieved_at ? `Retrieved ${new Date(source.retrieved_at).toLocaleString()}.` : '';
        const access = source.opened ? 'Page opened; extracted text may be partial.' : `Page not opened: ${source.open_error || 'search snippet only'}. Treat this as a lead, not checked article text.`;
        detail.textContent = [access, published, retrieved, source.snippet].filter(Boolean).join(' ');
        list.append(detail);
      } else {
        const detail = document.createElement('small'); detail.textContent = `Library passage: ${source.title}, chunk ${source.chunk_id}. Imported text is reference material, not independent verification.`; list.append(detail);
      }
    });
    el.append(list);
  }
  if (cached) { const note = document.createElement('small'); note.textContent = 'Reused from MERIDIAN’s local answer cache.'; el.append(note); }
  if (truncated) { const note = document.createElement('small'); note.textContent = 'Response reached its generation limit. Ask “continue” for the remainder.'; el.append(note); }
  convo.scrollTop = convo.scrollHeight;
}
function bubble(role, text, sources = [], truncated = false, cached = false) {
  $('#empty')?.remove();
  const el = document.createElement('div'); el.className = `msg ${role}`;
  const label = document.createElement('span'); label.className = 'role'; label.textContent = role === 'user' ? 'You' : 'Meridian';
  const answerText = document.createTextNode(text);
  el.append(label, answerText); el.answerText = answerText;
  appendBubbleMetadata(el, sources, truncated, cached);
  convo.append(el); convo.scrollTop = convo.scrollHeight; return el;
}
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
  if (!response.ok) throw Error(data.error || `Request failed (${response.status}).`);
  return data;
}
async function streamChat(payload, signal, onToken, endpoint = '/api/chat', onProgress = () => {}) {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(payload), signal
  });
  if (!response.ok) {
    const raw = await response.text(); let message = raw;
    try { message = JSON.parse(raw).error || raw; } catch {}
    if (response.status === 524) message = 'Cloudflare timed out before MERIDIAN finished. Reconnect or ask a shorter question.';
    throw Error(message || `Request failed (${response.status}).`);
  }
  if (!response.body) throw Error('This browser cannot read a streamed response.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', result = null;
  const consumeLine = line => {
    if (!line.startsWith('data:')) return;
    let event; try { event = JSON.parse(line.slice(5).trim()); } catch { return; }
    if (event.error) throw Error(event.error);
    if (typeof event.progress === 'string') onProgress(event.progress);
    if (typeof event.token === 'string') onToken(event.token);
    if (event.done) result = event.result;
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n'); buffer = lines.pop() || '';
    for (const line of lines) consumeLine(line.replace(/\r$/, ''));
  }
  buffer += decoder.decode();
  if (buffer) consumeLine(buffer.replace(/\r$/, ''));
  if (!result) throw Error('The connection closed before MERIDIAN completed its answer. Try again; partial text may be visible above.');
  return result;
}

async function stopSpeech() {
  activeSpeech?.abort(); activeSpeech = null;
  if (currentAudio) { currentAudio.pause(); currentAudio.removeAttribute('src'); currentAudio.load(); currentAudio = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel(); updateInterrupt();
}
function interruptAll() {
  const hadWork = !!(activeChat || activeSpeech || currentAudio || ('speechSynthesis' in window && speechSynthesis.speaking));
  if (!hadWork) return;
  activeChat?.abort(); activeChat = null; requestSeq++; stopSpeech(); send.textContent = 'Ask →';
  status.textContent = 'Interrupted. Ask a follow-up or redirect the analysis.'; box.focus(); updateInterrupt();
}
async function speakAnswer(text, container) {
  if (!speak) return;
  const controller = new AbortController(); activeSpeech = controller; updateInterrupt(); status.textContent = 'Generating speech…';
  try {
    const response = await fetch('/api/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: controller.signal });
    if (!response.ok) { const data = await response.json(); throw Error(data.error || 'Fish Audio unavailable'); }
    if (controller.signal.aborted) return;
    const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'metadata'; audio.src = URL.createObjectURL(await response.blob());
    audio.setAttribute('aria-label', 'Meridian answer audio'); currentAudio = audio;
    audio.onplay = () => { status.textContent = 'Speaking · Stop or press Esc to interrupt.'; updateInterrupt(); };
    audio.onended = () => { if (currentAudio === audio) currentAudio = null; status.textContent = ''; updateInterrupt(); };
    audio.onerror = () => { if (currentAudio === audio) currentAudio = null; status.textContent = 'Audio playback failed.'; updateInterrupt(); };
    container.append(audio); audio.play().catch(() => { status.textContent = 'Audio ready · Tap play or Stop to interrupt.'; updateInterrupt(); });
  } catch (error) {
    if (controller.signal.aborted) return;
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text); utterance.rate = .96;
      utterance.onstart = () => { status.textContent = 'Speaking · Stop or press Esc to interrupt.'; updateInterrupt(); };
      utterance.onend = () => { status.textContent = ''; updateInterrupt(); }; utterance.onerror = () => { status.textContent = ''; updateInterrupt(); };
      speechSynthesis.cancel(); speechSynthesis.speak(utterance); status.textContent = 'Fish Audio unavailable; using your browser voice.';
    } else status.textContent = error.message;
  } finally { if (activeSpeech === controller) activeSpeech = null; updateInterrupt(); }
}
async function ask(text) {
  if (!text.trim()) return;
  if (activeChat || activeSpeech || currentAudio || ('speechSynthesis' in window && speechSynthesis.speaking)) interruptAll();
  const prompt = text.trim(), id = ++requestSeq, controller = new AbortController(); activeChat = controller;
  if (recognition) recognition.stop(); bubble('user', prompt); box.value = '';
  const isResearch = researchMode.getAttribute('aria-pressed') === 'true';
  const mode = debating ? 'Geopolitical Debate' : $('#mode').value;
  const autoLive = !isResearch && needsCurrentData(prompt, mode);
  send.textContent = 'Stop';
  status.textContent = isResearch ? 'Searching sources and preparing a report…' : autoLive ? 'Checking current web sources…' : 'Meridian is thinking…';
  updateInterrupt();
  let liveAnswer = null;
  try {
    const payload = isResearch ? { question: prompt } : { message: prompt, history, mode };
    liveAnswer = bubble('assistant', '');
    const data = await streamChat(payload, controller.signal, token => {
      if (id !== requestSeq || !liveAnswer) return;
      liveAnswer.answerText.data += token; convo.scrollTop = convo.scrollHeight;
    }, isResearch ? '/api/research' : '/api/chat', progress => {
      if (id === requestSeq) status.textContent = progress;
    });
    if (id !== requestSeq) return;
    let answer;
    if (isResearch) {
      liveAnswer.answerText.data = data.report;
      appendBubbleMetadata(liveAnswer, data.sources || [], Boolean(data.truncated));
      answer = liveAnswer;
    } else {
      liveAnswer.answerText.data = data.answer;
      appendBubbleMetadata(liveAnswer, data.sources || [], Boolean(data.truncated), Boolean(data.cached));
      answer = liveAnswer;
      history.push({ role: 'user', content: prompt }, { role: 'assistant', content: data.answer }); if (history.length > 16) history = history.slice(-16);
    }
    if (speak) await speakAnswer(isResearch ? data.report : data.answer, answer); else status.textContent = '';
    if (isResearch) loadReports();
  } catch (error) {
    if (controller.signal.aborted || id !== requestSeq) return;
    if (liveAnswer && !liveAnswer.answerText.data) liveAnswer.remove();
    bubble('assistant', `I hit a problem: ${error.message}`); status.textContent = error.message;
  } finally {
    if (id === requestSeq) { if (activeChat === controller) activeChat = null; send.textContent = 'Ask →'; if (!activeSpeech && !currentAudio && !('speechSynthesis' in window && speechSynthesis.speaking) && !status.textContent.startsWith('Interrupted')) status.textContent = ''; updateInterrupt(); box.focus(); }
  }
}
async function loadHistory() {
  try { const data = await api('/api/history'); history = data.messages.filter(x => x.role === 'user' || x.role === 'assistant').slice(-16).map(x => ({ role: x.role, content: x.content })); for (const item of history) bubble(item.role, item.content); }
  catch (error) { status.textContent = `Conversation history unavailable: ${error.message}`; }
}
async function loadFlights(event) {
  event?.preventDefault();
  const status = $('#flightStatus'), results = $('#flightResults'), type = $('#flightScope').value;
  const query = $('#flightQuery').value.trim();
  if (type !== 'active' && !query) { status.textContent = 'ENTER A FLIGHT OR AIRPORT CODE'; $('#flightQuery').focus(); return; }
  status.textContent = 'FETCHING LIVE DATA…';
  results.textContent = 'Contacting Aviationstack…';
  try {
    const params = new URLSearchParams({ type }); if (query) params.set('q', query);
    const data = await api(`/api/flights?${params}`);
    results.replaceChildren();
    for (const flight of data.flights) {
      const card = document.createElement('article'); card.className = 'flight-card';
      const label = flight.flight?.iata || flight.flight?.icao || flight.flight?.number || 'Flight';
      const title = document.createElement('h3'); title.textContent = `${label} · ${flight.airline?.name || 'Airline unavailable'}`;
      const state = document.createElement('p'); state.className = 'flight-state'; state.textContent = flight.flight_status || 'Status unavailable';
      const route = document.createElement('p'); route.textContent = `${flight.departure?.airport || flight.departure?.iata || 'Unknown'} (${flight.departure?.iata || '—'}) → ${flight.arrival?.airport || flight.arrival?.iata || 'Unknown'} (${flight.arrival?.iata || '—'})`;
      const times = document.createElement('p'); times.textContent = `Departure ${flight.departure?.actual || flight.departure?.estimated || flight.departure?.scheduled || '—'} · Arrival ${flight.arrival?.actual || flight.arrival?.estimated || flight.arrival?.scheduled || '—'}`;
      card.append(title, state, route, times);
      if (flight.live && Number.isFinite(flight.live.latitude) && Number.isFinite(flight.live.longitude)) {
        const position = document.createElement('p');
        position.textContent = `Position ${flight.live.latitude.toFixed(3)}, ${flight.live.longitude.toFixed(3)} · ${flight.live.altitude ?? '—'} m · ${flight.live.speed_horizontal ?? '—'} km/h`;
        card.append(position);
      }
      results.append(card);
    }
    if (!data.flights.length) results.textContent = 'No matching flights returned. Try a different flight or airport code.';
    status.textContent = `${data.flights.length} SHOWN · ${data.total} MATCHING · RETRIEVED ${new Date(data.retrieved_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
  } catch (error) {
    results.textContent = error.message;
    status.textContent = /AVIATIONSTACK_KEY_REJECTED|Aviationstack rejected its configured key/i.test(error.message) ? 'AVIATIONSTACK KEY REJECTED · CHECK .ENV' : 'FLIGHT DATA UNAVAILABLE';
  }
}
async function loadSignals() {
  const status = $('#signalsStatus'), list = $('#signals');
  status.textContent = 'UPDATING';
  try {
    const data = await api('/api/signals');
    list.replaceChildren();
    for (const signal of data.signals) {
      const row = document.createElement('article'); row.className = 'signal';
      const body = document.createElement('div');
      const title = document.createElement('h3');
      const link = document.createElement('a'); link.href = signal.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = signal.title || signal.url;
      title.append(link);
      const summary = document.createElement('p'); summary.textContent = signal.snippet || 'Search result has no summary.';
      const meta = document.createElement('p'); meta.className = 'signal-meta'; meta.textContent = `${signal.source ? `${signal.source} · ` : ''}${signal.published_at ? `Published ${new Date(signal.published_at).toLocaleString()}` : 'Publication time unavailable'} · Retrieved ${new Date(signal.retrieved_at).toLocaleString()}`;
      body.append(title, summary, meta); row.append(body); list.append(row);
    }
    if (!data.signals.length) list.textContent = 'No current headlines returned.';
    status.textContent = `UPDATED ${new Date(data.retrieved_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} · ${data.provider}`;
  } catch (error) {
    list.replaceChildren(); const row = document.createElement('div'); row.className = 'signal';
    const message = document.createElement('p'); message.textContent = `${error.message}. Use Refresh to try again.`; row.append(message); list.append(row);
    status.textContent = 'UNAVAILABLE';
  }
}
async function loadHealth() {
  try {
    const data = await api('/api/health'), ollama = data.ollama;
    $('#serviceBadge').textContent = `● LOCAL INTERFACE · ${String(data.provider).toUpperCase()}${ollama.available ? (ollama.models.length ? ` · OLLAMA ${ollama.selected_model}` : ' · OLLAMA HAS NO MODEL') : ''}`;
    $('#ollamaStatus').textContent = ollama.available ? (ollama.models.length ? `Local Ollama ready: ${ollama.models.join(', ')}` : 'Ollama API responds, but no model is installed.') : ollama.message;
    if (!data.mediastack) $('#signalsStatus').textContent = 'KEY NEEDED · MEDIASTACK_ACCESS_KEY';
    $('#flightStatus').textContent = data.aviationstack ? 'KEY SET · VERIFIED WHEN FETCHED' : 'KEY NEEDED · AVIATIONSTACK_ACCESS_KEY';
  } catch (error) { $('#serviceBadge').textContent = '● BACKEND STATUS UNAVAILABLE'; $('#ollamaStatus').textContent = error.message; }
}
async function loadLibrary() {
  try { const data = await api('/api/library'); $('#libraryList').replaceChildren(); for (const doc of data.documents) { const item = document.createElement('div'); item.className = 'tool-item'; item.textContent = `${doc.title} · ${new Date(doc.created).toLocaleDateString()}`; $('#libraryList').append(item); } if (!data.documents.length) $('#libraryList').textContent = 'No personal texts imported yet.'; }
  catch (error) { $('#libraryList').textContent = error.message; }
}
async function loadReports() {
  try { const data = await api('/api/reports'); $('#reportList').replaceChildren(); for (const report of data.reports) { const item = document.createElement('button'); item.type = 'button'; item.className = 'tool-item'; item.textContent = `${report.question} · ${new Date(report.created).toLocaleDateString()}`; item.onclick = () => openReport(report.id); $('#reportList').append(item); } if (!data.reports.length) $('#reportList').textContent = 'No saved research reports yet.'; }
  catch (error) { $('#reportList').textContent = error.message; }
}
async function openReport(id) {
  try { const data = await api(`/api/reports/${id}`); $('#reportTitle').textContent = data.question; $('#reportText').textContent = data.result; const links = $('#reportSources'); links.replaceChildren(); for (const source of data.sources) { const a = document.createElement('a'); a.href = source.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = source.title; links.append(a, document.createElement('br')); } $('#reportDialog').showModal(); }
  catch (error) { status.textContent = error.message; }
}
form.addEventListener('submit', event => { event.preventDefault(); ask(box.value); });
box.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } });
interrupt.addEventListener('click', interruptAll); document.addEventListener('keydown', event => { if (event.key === 'Escape' && $('#reportDialog').open) $('#reportDialog').close(); else if (event.key === 'Escape') interruptAll(); });
$('#closeReport').addEventListener('click', () => $('#reportDialog').close());
$('#refreshReports').addEventListener('click', loadReports);
debate.addEventListener('click', () => { debating = !debating; debate.textContent = debating ? '⚖ Debate: on' : '⚖ Debate: off'; debate.classList.toggle('debate-on', debating); debate.setAttribute('aria-pressed', String(debating)); if (debating) $('#mode').value = 'Geopolitical Debate'; status.textContent = debating ? 'Debate mode: state a position or name a topic.' : 'Debate mode off.'; });
researchMode.addEventListener('click', () => { const on = researchMode.getAttribute('aria-pressed') !== 'true'; researchMode.setAttribute('aria-pressed', String(on)); researchMode.classList.toggle('research-on', on); researchMode.textContent = on ? '⌕ Research: on' : '⌕ Research: off'; status.textContent = on ? 'Web research will search and attempt to open public sources.' : 'Web research off.'; });
sound.addEventListener('click', () => { speak = !speak; if (!speak) stopSpeech(); sound.textContent = speak ? '🔊 Sound on' : '🔇 Sound off'; sound.setAttribute('aria-pressed', String(speak)); });
$('#uploadForm').addEventListener('submit', async event => { event.preventDefault(); const file = $('#fileInput').files[0]; if (!file) { status.textContent = 'Choose a TXT file first.'; return; } if (file.size > 1_000_000) { status.textContent = 'Text files are limited to 1 MB.'; return; } try { const result = await api('/api/library/ingest', { method: 'POST', body: JSON.stringify({ filename: file.name, text: await file.text() }) }); status.textContent = `Imported ${result.title} · ${result.chunks} chunks.`; event.target.reset(); loadLibrary(); } catch (error) { status.textContent = error.message; } });
$('#interrupt').addEventListener('click', interruptAll);
document.querySelectorAll('.chip').forEach(button => button.addEventListener('click', () => { if (button.dataset.mode === 'debate' && !debating) debate.click(); box.value = button.dataset.mode === 'simulation' ? `START SIMULATION: ${button.textContent}` : button.textContent; box.focus(); }));
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SR) { recognition = new SR(); recognition.lang = navigator.language || 'en-US'; recognition.interimResults = false; recognition.onstart = () => { mic.textContent = '⏹ Listening…'; status.textContent = 'Listening — speak your question.'; }; recognition.onresult = e => { box.value = `${box.value} ${e.results[0][0].transcript}`.trim(); box.focus(); status.textContent = ''; }; recognition.onerror = () => { status.textContent = 'Voice input unavailable. You can type your question.'; }; recognition.onend = () => { mic.textContent = '🎙 Speak'; if (status.textContent.startsWith('Listening')) status.textContent = ''; }; mic.onclick = () => { if (activeChat || activeSpeech || currentAudio || ('speechSynthesis' in window && speechSynthesis.speaking)) interruptAll(); try { recognition.start(); } catch { recognition.stop(); } }; }
else { mic.disabled = true; mic.title = 'Speech recognition is not available in this browser'; }
function initDepthMotion() {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.querySelectorAll('.map-panel, .command').forEach(panel => {
    let frame = 0, point = null;
    panel.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse') return;
      const rect = panel.getBoundingClientRect();
      point = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0; if (!point) return;
        const x = Math.max(0, Math.min(1, point.x)), y = Math.max(0, Math.min(1, point.y));
        panel.style.setProperty('--depth-x', `${((.5 - y) * 3.2).toFixed(2)}deg`);
        panel.style.setProperty('--depth-y', `${((x - .5) * 3.2).toFixed(2)}deg`);
        panel.style.setProperty('--light-x', `${(x * 100).toFixed(1)}%`);
        panel.style.setProperty('--light-y', `${(y * 100).toFixed(1)}%`);
      });
    }, { passive: true });
    panel.addEventListener('pointerleave', () => {
      point = null;
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      panel.style.setProperty('--depth-x', '0deg'); panel.style.setProperty('--depth-y', '0deg');
      panel.style.setProperty('--light-x', '50%'); panel.style.setProperty('--light-y', '50%');
    });
  });
}
initDepthMotion();
loadHealth(); loadHistory(); loadLibrary(); loadReports(); loadSignals();
$('#flightForm')?.addEventListener('submit', loadFlights);
$('#flightScope')?.addEventListener('change', () => { $('#flightQuery').placeholder = $('#flightScope').value === 'flight' ? 'Flight number, e.g. AI101' : $('#flightScope').value === 'active' ? 'Optional' : 'Airport IATA code, e.g. DEL'; });
$('#refreshSignals')?.addEventListener('click', loadSignals);

// Dashboard interactions: keep the command categories mapped to the existing backend modes.
const category = $('#category');
const categoryModes = {
  'Personal Assistant': 'General Analysis',
  Geopolitics: 'General Analysis',
  Markets: 'Market Analysis',
  History: 'Historical Book Analysis',
  Economics: 'General Analysis',
  Cybersecurity: 'Intelligence Assessment'
};
category?.addEventListener('change', () => {
  if (category.value === 'Cybersecurity') box.placeholder = 'Ask about cyber policy, resilience, or international norms…';
  else if (category.value === 'Personal Assistant') box.placeholder = 'Ask MERIDIAN anything — a question, plan, draft, or analysis...';
  else box.placeholder = `Ask MERIDIAN about ${category.value.toLowerCase()}...`;
  if (!debating) $('#mode').value = categoryModes[category.value] || 'General Analysis';
});
$('#mode')?.addEventListener('change', () => {
  const reverse = Object.entries(categoryModes).find(([, mode]) => mode === $('#mode').value);
  if (reverse && category) category.value = reverse[0];
});

document.querySelectorAll('.region-pin').forEach(pin => pin.addEventListener('click', () => {
  const region = pin.dataset.region;
  const detail = $('#mapDetail');
  detail.textContent = `${region} selected · ask for an assessment of its interests, alignments, economic links, and uncertainties.`;
  detail.classList.add('show');
  box.value = `Give me a geopolitical overview of ${region}. Separate established context, current claims that need verification, competing interpretations, and key uncertainties.`;
  box.focus();
  window.setTimeout(() => detail.classList.remove('show'), 5000);
}));

document.querySelectorAll('.summary-card[data-prompt]').forEach(card => card.addEventListener('click', () => {
  box.value = card.dataset.prompt;
  if (card.id === 'markets') { category.value = 'Markets'; category.dispatchEvent(new Event('change')); }
  if (card.id === 'history') { category.value = 'History'; category.dispatchEvent(new Event('change')); }
  box.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}));

const sidebar = $('#sidebar'), scrim = $('#drawerScrim');
function closeDrawer() { sidebar?.classList.remove('open'); scrim?.classList.remove('show'); }
$('#menuToggle')?.addEventListener('click', () => { sidebar.classList.toggle('open'); scrim.classList.toggle('show'); });
scrim?.addEventListener('click', closeDrawer);
document.querySelectorAll('.nav a').forEach(link => link.addEventListener('click', () => {
  document.querySelectorAll('.nav a').forEach(item => item.classList.toggle('active', item === link));
  closeDrawer();
}));

function updateClock() {
  const now = new Date();
  $('#clock').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  $('#date').textContent = now.toLocaleDateString([], { weekday: 'short', year: 'numeric', month: 'short', day: '2-digit' }).toUpperCase();
}
updateClock(); window.setInterval(updateClock, 1000);
$('#clearChat')?.addEventListener('click', async () => {
  if (activeChat || activeSpeech || currentAudio) interruptAll();
  const button = $('#clearChat'); button.disabled = true;
  try {
    await api('/api/history', { method: 'DELETE' });
    convo.replaceChildren();
    const empty = document.createElement('div'); empty.className = 'empty'; empty.id = 'empty';
    const title = document.createElement('strong'); title.textContent = 'Your analysis will appear here.';
    empty.append(title, document.createTextNode('Responses use the configured local model. Web sources are shown when research is requested or current information is needed.'));
    convo.append(empty); history = []; status.textContent = 'Conversation cleared.';
  } catch (error) { status.textContent = `Could not clear saved conversation: ${error.message}`; }
  finally { button.disabled = false; }
});
