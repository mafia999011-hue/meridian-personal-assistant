const form = document.querySelector('#flightForm');
const scope = document.querySelector('#flightScope');
const query = document.querySelector('#flightQuery');
const status = document.querySelector('#flightStatus');
const results = document.querySelector('#flightResults');
const submit = document.querySelector('#fetchFlights');

function emptyResult(message) {
  const box = document.createElement('div');
  box.className = 'empty';
  box.textContent = message;
  results.replaceChildren(box);
}

function flightCard(flight) {
  const card = document.createElement('article');
  card.className = 'flight';
  const top = document.createElement('div');
  top.className = 'flight-top';
  const ident = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = flight.flight?.iata || flight.flight?.icao || flight.flight?.number || 'Flight';
  const airline = document.createElement('p');
  airline.className = 'airline';
  airline.textContent = flight.airline?.name || 'Airline unavailable';
  ident.append(title, airline);
  const state = document.createElement('span');
  state.className = 'state';
  state.textContent = flight.flight_status || 'Status unavailable';
  top.append(ident, state);
  const route = document.createElement('div');
  route.className = 'route';
  for (const endpoint of [flight.departure, flight.arrival]) {
    const airport = document.createElement('div');
    airport.className = 'airport';
    const code = document.createElement('strong');
    code.textContent = endpoint?.iata || endpoint?.icao || '—';
    const name = document.createElement('span');
    name.textContent = endpoint?.airport || 'Airport unavailable';
    airport.append(code, name);
    route.append(airport);
    if (endpoint === flight.departure) {
      const arrow = document.createElement('span');
      arrow.className = 'arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '→';
      route.append(arrow);
    }
  }
  card.append(top, route);
  const time = document.createElement('p');
  time.className = 'detail';
  time.textContent = `Departure ${flight.departure?.actual || flight.departure?.estimated || flight.departure?.scheduled || '—'} · Arrival ${flight.arrival?.actual || flight.arrival?.estimated || flight.arrival?.scheduled || '—'}`;
  card.append(time);
  if (flight.live && Number.isFinite(flight.live.latitude) && Number.isFinite(flight.live.longitude)) {
    const position = document.createElement('p');
    position.className = 'detail';
    position.textContent = `Position ${flight.live.latitude.toFixed(3)}, ${flight.live.longitude.toFixed(3)} · ${flight.live.altitude ?? '—'} m altitude`;
    card.append(position);
  }
  return card;
}

scope.addEventListener('change', () => {
  query.placeholder = scope.value === 'flight' ? 'Flight number, e.g. AI101' : scope.value === 'active' ? 'Optional for active flights' : 'Airport IATA code, e.g. DEL';
  query.setAttribute('aria-label', scope.value === 'flight' ? 'Flight number' : 'Airport IATA code');
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  const type = scope.value;
  const search = query.value.trim();
  if (type !== 'active' && !search) {
    status.textContent = 'ENTER A FLIGHT OR AIRPORT CODE';
    query.focus();
    return;
  }
  const params = new URLSearchParams({ type });
  if (search) params.set('q', search);
  status.textContent = 'FETCHING LIVE DATA…';
  emptyResult('Contacting Aviationstack…');
  submit.disabled = true;
  submit.textContent = 'Fetching…';
  try {
    const response = await fetch(`/api/flights?${params}`, { headers: { Accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    const flights = Array.isArray(data.flights) ? data.flights : [];
    if (!flights.length) emptyResult('No matching flights returned. Try another flight number or airport code.');
    else results.replaceChildren(...flights.map(flightCard));
    const retrieved = data.retrieved_at ? new Date(data.retrieved_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'time unavailable';
    status.textContent = `${flights.length} SHOWN · ${data.total} MATCHING · RETRIEVED ${retrieved}`;
  } catch (error) {
    emptyResult(error.message || 'Flight data is unavailable. Try again.');
    status.textContent = /AVIATIONSTACK_KEY_REJECTED|Aviationstack rejected its configured key/i.test(error.message) ? 'AVIATIONSTACK KEY REJECTED · CHECK SERVER CONFIGURATION' : 'FLIGHT DATA UNAVAILABLE';
  } finally {
    submit.disabled = false;
    submit.textContent = 'Fetch flights';
  }
});
