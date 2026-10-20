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
    const heading = document.createElement('b'); heading.textContent = 'Sources and retrieved library passages'; list.append(heading);
    for (const source of sources) {
      if (source.url) {
        const link = document.createElement('a'); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = source.title || source.url; list.append(link);
        const detail = document.createElement('small');
        const published = source.published_at ? `Published ${new Date(source.published_at).toLocaleDateString()}.` : 'Publication date not identified.';
        const retrieved = source.retrieved_at ? `Retrieved ${new Date(source.retrieved_at).toLocaleString()}.` : '';
        detail.textContent = `${source.opened ? 'Page opened; retrieved text may be partial.' : `Page unavailable: ${source.open_error || 'snippet only'}.`} ${published} ${retrieved} ${source.snippet || ''}`;
        list.append(detail);
      } else {
        const detail = document.createElement('small'); detail.textContent = `${source.title}, chunk ${source.chunk_id}`; list.append(detail);
      }
    }
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
async function loadHealth() {
  try {
    const data = await api('/api/health'), ollama = data.ollama;
    $('#serviceBadge').textContent = `● LOCAL INTERFACE · ${String(data.provider).toUpperCase()}${ollama.available ? (ollama.models.length ? ` · OLLAMA ${ollama.selected_model}` : ' · OLLAMA HAS NO MODEL') : ''}`;
    $('#ollamaStatus').textContent = ollama.available ? (ollama.models.length ? `Local Ollama ready: ${ollama.models.join(', ')}` : 'Ollama API responds, but no model is installed.') : ollama.message;
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
loadHealth(); loadHistory(); loadLibrary(); loadReports();

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
$('#clearChat')?.addEventListener('click', () => {
  if (activeChat || activeSpeech || currentAudio) interruptAll();
  convo.replaceChildren();
  const empty = document.createElement('div'); empty.className = 'empty'; empty.id = 'empty';
  const title = document.createElement('strong'); title.textContent = 'Your analysis will appear here.';
  empty.append(title, document.createTextNode('Responses use the configured local model. Web sources are shown when research is requested or current information is needed.'));
  convo.append(empty); history = [];
});
