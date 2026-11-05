/* Private Empty Leg - production app (Supabase auth + data). Publishable key only; all authorization enforced server-side by RLS. */
const SUPA_URL = 'https://usrtbyplmjujjygwdspv.supabase.co';
const SUPA_KEY = 'sb_publishable_vzULSs99gbDl1ml4awAaRQ_v540O5a7';
const sb = window.supabase.createClient(SUPA_URL, SUPA_KEY);

const state = { session: null, profile: null, membership: null, listings: [], selected: null, modal: null, requestLeg: null,
  fFrom: '', fTo: '', fDate: '', fPax: '', fPrice: '' };
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
function splitRoute(s) { if (!s) return { code: '', city: '' }; const m = s.match(/^([A-Z0-9]{3,4}) - (.*)$/); return m ? { code: m[1], city: m[2] } : { code: '', city: s }; }
function isUpcoming(l) { return !l.dep_end || l.dep_end >= todayISO(); }

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  state.session = session;
  sb.auth.onAuthStateChange((_e, s) => { state.session = s; loadPrivate().then(render); });
  await Promise.all([loadListings(), loadPrivate()]);
  render();
}
async function loadListings() {
  const { data, error } = await sb.from('listings').select('id,status,route_from,route_to,aircraft,departure_text,dep_start,dep_end,price_text,price_min,price_max,tail_notes').order('dep_start', { ascending: true });
  if (!error && data) state.listings = data;
}
async function loadPrivate() {
  state.profile = null; state.membership = null;
  if (!state.session) return;
  const uid = state.session.user.id;
  const [p, m] = await Promise.all([
    sb.from('profiles').select('role,email').eq('id', uid).maybeSingle(),
    sb.from('memberships').select('status,plan,current_period_end').eq('user_id', uid).maybeSingle(),
  ]);
  state.profile = p.data; state.membership = m.data;
}

function visibleListings() {
  const q = (s) => s.trim().toLowerCase();
  return state.listings.filter((l) => {
    if (!isUpcoming(l)) return false;
    if (q(state.fFrom) && !l.route_from.toLowerCase().includes(q(state.fFrom))) return false;
    if (q(state.fTo) && !l.route_to.toLowerCase().includes(q(state.fTo))) return false;
    if (state.fDate) { if (!l.dep_start || l.dep_start > state.fDate || (l.dep_end && l.dep_end < state.fDate)) return false; }
    if (state.fPrice) { if (l.price_min == null || l.price_min > Number(state.fPrice)) return false; }
    return true;
  });
}

function cardHtml(l) {
  const f = splitRoute(l.route_from), t = splitRoute(l.route_to);
  const quoted = l.status === 'quoted';
  const flags = (l.tail_notes || '').includes('REVIEW:') ? [] : [];
  return `<div class="card">
    <div class="card-photo"><span class="rep">Representative image</span></div>
    <div class="card-body">
      <div class="chip-row">${quoted ? '<span class="chip chip-quoted">Quoted price</span>' : '<span class="chip chip-quote">Request a quote</span>'}</div>
      <div class="card-route">${esc(f.code || f.city)} <span>&rarr;</span> ${esc(t.code || t.city)}</div>
      <div class="card-cities">${esc(f.city)}${t.city ? ' &rarr; ' + esc(t.city) : ''}</div>
      <div class="card-meta">${esc(l.aircraft || '')}<br/>${esc(l.departure_text || '')}</div>
      <div class="card-price"><div>
        <span class="p">${esc(l.price_text || 'Request a quote')}</span>
        <span class="u">${l.price_text ? 'Posted price - basis unverified' : 'Price not stated in source'}</span>
      </div>
      <button class="btn btn-accent btn-sm" data-open="${esc(l.id)}">Details</button></div>
    </div>
  </div>`;
}

function drawerHtml(l) {
  const f = splitRoute(l.route_from), t = splitRoute(l.route_to);
  const notes = (l.tail_notes || '').split(' | ').filter(Boolean).map((n) => `<li>${esc(n)}</li>`).join('');
  return `<div class="drawer-back" data-close="1"></div>
  <div class="drawer">
    <button class="drawer-x" data-close="1">&times;</button>
    <div class="card-photo" style="height:180px"><span class="rep">Representative image</span></div>
    <h3>${esc(f.city)} &rarr; ${esc(t.city)}</h3>
    <p class="sub">${esc(f.code)}${f.code && t.code ? ' &rarr; ' : ''}${esc(t.code)} - ${esc(l.aircraft || 'Aircraft as posted')}</p>
    <table class="dt">
      <tr><td>Departure</td><td>${esc(l.departure_text || 'As posted')}</td></tr>
      <tr><td>Price</td><td>${esc(l.price_text || 'Request a quote')}${l.price_text ? ' (posted price - whole aircraft vs per seat not yet verified)' : ''}</td></tr>
      <tr><td>Taxes and fees</td><td>Not stated in source - confirmed with the supplier before booking</td></tr>
      <tr><td>Availability</td><td>Unconfirmed - checked with the supplier on request</td></tr>
    </table>
    ${notes ? `<ul class="notes">${notes}</ul>` : ''}
    <button class="btn btn-accent" data-request="${esc(l.id)}">Request availability</button>
    <p class="fine">A request does not reserve the aircraft and does not confirm a booking. Flights are paid separately from membership.</p>
  </div>`;
}

function authModalHtml(mode, notice) {
  return `<div class="modal-back" data-close="1"><div class="modal">
    <h3>${mode === 'signup' ? 'Create your account' : 'Log in'}</h3>
    <p class="sub">${notice ? esc(notice) : (mode === 'signup' ? 'Membership and booking requests need an account.' : 'Welcome back.')}</p>
    <label class="field">Email<input id="au-email" type="email" placeholder="you@example.com" autocomplete="email" /></label>
    <label class="field">Password<input id="au-pass" type="password" placeholder="Password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" /></label>
    <div class="form-actions">
      <button class="btn btn-accent" id="au-submit">${mode === 'signup' ? 'Create account' : 'Log in'}</button>
      <button class="btn btn-outline" id="au-switch">${mode === 'signup' ? 'Have an account? Log in' : 'New here? Create one'}</button>
    </div>
    <p class="form-msg" id="au-msg"></p>
  </div></div>`;
}

function joinModalHtml() {
  return `<div class="modal-back" data-close="1"><div class="modal">
    <h3>Membership - $98/month</h3>
    <p class="sub">Flight access, personalized route alerts, and booking assistance. Flights are purchased separately.</p>
    <div class="notice">Billing is not connected yet. Secure checkout (test mode first, live only after approval) is being wired now. Your account is ready - membership activation opens as soon as billing is enabled.</div>
    <div class="form-actions"><button class="btn btn-accent" data-close="1">Got it</button></div>
    <p class="form-msg">Renews monthly. Cancel anytime from your account's billing page. Refund terms are being finalized and will be published before launch.</p>
  </div></div>`;
}

function requestModalHtml(l) {
  const f = splitRoute(l.route_from), t = splitRoute(l.route_to);
  return `<div class="modal-back" data-close="1"><div class="modal">
    <h3>Request availability</h3>
    <p class="sub">${esc(l.aircraft || '')} - ${esc(f.city)} &rarr; ${esc(t.city)} - ${esc(l.departure_text || '')}</p>
    <div class="notice">This sends a request to the team. It does not reserve the aircraft and does not confirm a booking. Availability and the final quote are confirmed with the supplier first. Flights are paid separately from membership.</div>
    <label class="field">Passengers<input id="rq-pax" type="number" min="1" placeholder="How many passengers?" /></label>
    <label class="field">Preferred timing<input id="rq-time" placeholder="e.g. morning, within the posted window" /></label>
    <label class="field">Contact details<input id="rq-contact" placeholder="Phone or email for follow-up" /></label>
    <label class="field">Notes (optional)<textarea id="rq-notes" rows="3"></textarea></label>
    <div class="form-actions">
      <button class="btn btn-accent" id="rq-submit">Submit request</button>
      <button class="btn btn-outline" data-close="1">Cancel</button>
    </div>
    <p class="form-msg" id="rq-msg"></p>
  </div></div>`;
}

function accountModalHtml() {
  const email = state.session ? state.session.user.email : '';
  const mem = state.membership;
  const memLine = mem && mem.status === 'active'
    ? `Active (${esc(mem.plan)} plan${mem.current_period_end ? ', renews ' + esc(mem.current_period_end.slice(0,10)) : ''})`
    : 'Not active yet - billing is being connected. No charge has been made.';
  return `<div class="modal-back" data-close="1"><div class="modal">
    <h3>Your account</h3>
    <table class="dt">
      <tr><td>Email</td><td>${esc(email)}</td></tr>
      <tr><td>Membership</td><td>${memLine}</td></tr>
    </table>
    <div id="acct-requests"><p class="sub">Loading your requests...</p></div>
    <div class="form-actions"><button class="btn btn-outline" id="acct-logout">Log out</button><button class="btn btn-accent" data-close="1">Close</button></div>
  </div></div>`;
}

function render() {
  const user = state.session ? state.session.user : null;
  const vis = visibleListings();
  const quoted = vis.filter((l) => l.status === 'quoted');
  const unpriced = vis.filter((l) => l.status === 'quote');
  $('#app').innerHTML = `
  <div class="preview-banner"><strong>Launch preview</strong> - listings are a snapshot from operator and broker posts. Availability is not confirmed for any flight. Billing and route alerts are being connected.</div>
  <nav class="nav"><div class="nav-inner">
    <div class="brand">PRIVATE <span>EMPTY LEG</span></div>
    <div class="nav-links">
      <a href="#flights" class="hide-m">Flights</a>
      <a href="#how" class="hide-m">How it works</a>
      <a href="#membership" class="hide-m">Membership</a>
      ${user ? `<a href="#account" id="nav-account">Account</a>` : `<a href="#login" id="nav-login">Log in</a>`}
      <button class="btn btn-accent btn-sm" id="nav-join">Join for $98/month</button>
    </div>
  </div></nav>

  <header class="hero">
    <div>
      <h1>Private flights. Smarter prices.</h1>
      <p class="lead">Discover empty-leg flights, get alerts for your preferred routes, and receive help coordinating your booking. Membership is $98/month. Flights are purchased separately.</p>
      <div class="hero-actions">
        <a class="btn btn-accent" href="#flights">Explore flights</a>
        <a class="btn btn-outline" href="#how">How it works</a>
      </div>
      <p class="member-note">Membership only - flights cost extra.</p>
    </div>
    <div>
      <img class="hero-photo" src="hero-jet.png" alt="Private jet on the ramp at dusk" />
      <div class="hero-photo-caption">Representative image.</div>
    </div>
  </header>

  <div class="trio">
    <div>Curated empty legs<small>Every leg we find from operators and brokers, in one place.</small></div>
    <div>Personalized route alerts<small>Save your routes and dates; hear first when a match appears.</small></div>
    <div>Booking assistance<small>We coordinate availability and the final quote with the supplier.</small></div>
  </div>

  <section class="section" id="flights">
    <h2>Find your next departure.</h2>
    <p class="sub">Browse current empty-leg offers and quoted member prices before joining. Membership unlocks booking requests, saved routes, and alerts. Availability is not confirmed until checked with the supplier.</p>
    <div class="filters">
      <label>From<input id="f-from" value="${esc(state.fFrom)}" placeholder="Airport or city" /></label>
      <label>Destination<input id="f-to" value="${esc(state.fTo)}" placeholder="Airport or city" /></label>
      <label>Date<input id="f-date" type="date" value="${esc(state.fDate)}" /></label>
      <label>Passengers<select id="f-pax"><option value="">Any</option><option value="4" ${state.fPax==='4'?'selected':''}>4+ (known capacity)</option><option value="8" ${state.fPax==='8'?'selected':''}>8+ (known capacity)</option><option value="12" ${state.fPax==='12'?'selected':''}>12+ (known capacity)</option></select></label>
      <label>Price<select id="f-price"><option value="">Any</option><option value="5000" ${state.fPrice==='5000'?'selected':''}>Up to $5,000</option><option value="10000" ${state.fPrice==='10000'?'selected':''}>Up to $10,000</option><option value="25000" ${state.fPrice==='25000'?'selected':''}>Up to $25,000</option><option value="200000" ${state.fPrice==='200000'?'selected':''}>Up to $200,000</option></select></label>
    </div>
    ${vis.length === 0 ? '<p class="empty">No flights match those filters. Try widening the search.</p>' : ''}
    ${quoted.length ? `<div class="grid">${quoted.map(cardHtml).join('')}</div>` : ''}
    ${unpriced.length ? `<h3 style="margin:34px 0 16px;font-size:19px">More legs - ask us for a price</h3><div class="grid">${unpriced.map(cardHtml).join('')}</div>` : ''}
  </section>

  <section class="section" id="how">
    <h2>How it works</h2>
    <div class="steps">
      <div class="step"><div class="n">1</div><h3>Find a flight</h3><p>Browse curated empty legs with routes, dates and quoted prices up front.</p></div>
      <div class="step"><div class="n">2</div><h3>Request availability</h3><p>Members send a request with passengers and timing. A request does not reserve the aircraft.</p></div>
      <div class="step"><div class="n">3</div><h3>Confirm your booking</h3><p>We confirm supplier availability and the final quote, then share booking instructions. Flights are paid separately.</p></div>
    </div>
  </section>

  <section class="membership" id="membership">
    <div class="membership-card">
      <div>
        <h2>Your next move starts here.</h2>
        <p>Flight access, personalized route alerts, and booking assistance.</p>
        <p>Flights purchased separately. No flight markup added by us.</p>
        <span class="sep">Renews monthly. Cancel anytime from your account. Refund terms finalized before launch.</span>
      </div>
      <div>
        <div class="price-tag">$98<span>/month</span></div>
        <div style="height:18px"></div>
        <button class="btn btn-accent" id="mem-join">Become a member</button>
      </div>
    </div>
  </section>

  <section class="section faq" id="faq">
    <h2>Questions, answered.</h2>
    <details><summary>What is an empty leg?</summary><p>When a private jet flies without passengers to reach its next charter, that repositioning flight is an empty leg. Operators and brokers offer these flights at lower prices because the jet is flying anyway.</p></details>
    <details><summary>What does membership include?</summary><p>Access to every empty leg we find, personalized alerts for your saved routes, and help coordinating your booking with the supplier. Membership is $98/month. Flights are purchased separately - the $98 membership is never payment toward a flight.</p></details>
    <details><summary>Is the posted price for the whole aircraft?</summary><p>Prices come from operator and broker posts. Whether a posted price covers the whole aircraft or a seat is verified with the supplier before you book, and shown as verified on the listing once confirmed. We never present aircraft capacity as individually available seats.</p></details>
    <details><summary>Why can timing or availability change?</summary><p>Empty legs depend on the charter that created them. If that trip moves, the empty leg moves or disappears. That is why every request is confirmed with the supplier before anything is booked.</p></details>
    <details><summary>What happens if a flight becomes unavailable?</summary><p>If the supplier cannot confirm the leg, your request is closed and you pay nothing for that flight. We will look for similar upcoming legs and let you know.</p></details>
    <details><summary>How do I cancel membership?</summary><p>Cancel anytime from your account's billing page; access stays active until the end of the paid month. Full cancellation and refund terms are being finalized and will be published before launch.</p></details>
  </section>

  <footer class="footer"><div class="footer-inner">
    <div class="brand">PRIVATE <span>EMPTY LEG</span></div>
    <div class="footer-links"><span>Contact: hello@privateemptyleg.com</span><span>Privacy and terms: being finalized with counsel before launch.</span></div>
    <p>Private Empty Leg is a proposed membership service that would surface empty-leg availability posted by aircraft operators and brokers. The exact booking and broker role - including who handles flight contracts, payments and cancellations - is being confirmed and will be disclosed here before any flight transactions are enabled.</p>
    <p>Listings come from operator and broker posts and may already be booked. Posted prices are supplier quotes, not verified operator cost. Final price, taxes, fees and availability are confirmed with the supplier before booking.</p>
  </div></footer>

  ${state.selected ? drawerHtml(state.selected) : ''}
  ${state.modal === 'login' ? authModalHtml('login') : ''}
  ${state.modal === 'signup' ? authModalHtml('signup') : ''}
  ${state.modal === 'join' ? joinModalHtml() : ''}
  ${state.modal === 'request' && state.requestLeg ? requestModalHtml(state.requestLeg) : ''}
  ${state.modal === 'account' ? accountModalHtml() : ''}
  `;
  bind();
}

function bind() {
  document.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', () => { state.modal = null; state.selected = null; render(); }));
  document.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', () => { state.selected = state.listings.find((l) => l.id === el.dataset.open); render(); }));
  document.querySelectorAll('[data-request]').forEach((el) => el.addEventListener('click', () => {
    const leg = state.listings.find((l) => l.id === el.dataset.request);
    state.selected = null;
    if (!state.session) { state.modal = 'login'; state.requestLeg = leg; }
    else { state.modal = 'request'; state.requestLeg = leg; }
    render();
  }));
  const navLogin = $('#nav-login'); if (navLogin) navLogin.addEventListener('click', (e) => { e.preventDefault(); state.modal = 'login'; render(); });
  const navAcct = $('#nav-account'); if (navAcct) navAcct.addEventListener('click', (e) => { e.preventDefault(); state.modal = 'account'; render(); loadRequests(); });
  const nj = $('#nav-join'); if (nj) nj.addEventListener('click', () => { state.modal = 'join'; render(); });
  const mj = $('#mem-join'); if (mj) mj.addEventListener('click', () => { state.modal = 'join'; render(); });
  const ff = $('#f-from'); if (ff) ff.addEventListener('input', (e) => { state.fFrom = e.target.value; render(); ffFocus('f-from'); });
  const ft = $('#f-to'); if (ft) ft.addEventListener('input', (e) => { state.fTo = e.target.value; render(); ffFocus('f-to'); });
  const fd = $('#f-date'); if (fd) fd.addEventListener('change', (e) => { state.fDate = e.target.value; render(); });
  const fp = $('#f-pax'); if (fp) fp.addEventListener('change', (e) => { state.fPax = e.target.value; render(); });
  const fr = $('#f-price'); if (fr) fr.addEventListener('change', (e) => { state.fPrice = e.target.value; render(); });
  const asub = $('#au-submit'); if (asub) asub.addEventListener('click', submitAuth);
  const asw = $('#au-switch'); if (asw) asw.addEventListener('click', () => { state.modal = state.modal === 'signup' ? 'login' : 'signup'; render(); });
  const rq = $('#rq-submit'); if (rq) rq.addEventListener('click', submitRequest);
  const lo = $('#acct-logout'); if (lo) lo.addEventListener('click', async () => { await sb.auth.signOut(); state.modal = null; render(); });
}
function ffFocus(id) { const el = document.getElementById(id); if (el) { el.focus(); const v = el.value; el.value = ''; el.value = v; } }

async function submitAuth() {
  const email = $('#au-email').value.trim(), pass = $('#au-pass').value;
  const msg = $('#au-msg'); msg.className = 'form-msg';
  if (!email || !pass) { msg.textContent = 'Email and password are required.'; msg.classList.add('err'); return; }
  asubmit(true);
  if (state.modal === 'signup') {
    const { error } = await sb.auth.signUp({ email, password: pass });
    asubmit(false);
    if (error) { msg.textContent = error.message; msg.classList.add('err'); return; }
    if (state.requestLeg) { state.modal = 'request'; render(); return; }
    state.modal = null; render();
  } else {
    const { error } = await sb.auth.signInWithPassword({ email, password: pass });
    asubmit(false);
    if (error) { msg.textContent = error.message; msg.classList.add('err'); return; }
    if (state.requestLeg) { state.modal = 'request'; render(); return; }
    state.modal = null; render();
  }
}
function asubmit(busy) { const b = $('#au-submit'); if (b) { b.disabled = busy; b.textContent = busy ? 'One moment...' : (state.modal === 'signup' ? 'Create account' : 'Log in'); } }

async function submitRequest() {
  const msg = $('#rq-msg'); msg.className = 'form-msg';
  const pax = $('#rq-pax').value, time = $('#rq-time').value, contact = $('#rq-contact').value, notes = $('#rq-notes').value;
  if (!contact.trim()) { msg.textContent = 'Please add a phone or email so the team can follow up.'; msg.classList.add('err'); return; }
  const body = [`Passengers: ${pax || 'not stated'}`, `Preferred timing: ${time || 'not stated'}`, `Contact: ${contact}`, notes ? `Notes: ${notes}` : null].filter(Boolean).join('\n');
  const { error } = await sb.from('booking_requests').insert({ user_id: state.session.user.id, listing_id: state.requestLeg.id, message: body });
  if (error) { msg.textContent = error.message; msg.classList.add('err'); return; }
  state.modal = null; state.requestLeg = null; render();
  alert('Request sent. The team confirms availability and the final quote with the supplier before anything is booked.');
}

async function loadRequests() {
  const box = $('#acct-requests'); if (!box || !state.session) return;
  const { data } = await sb.from('booking_requests').select('created_at,listing_id,status').order('created_at', { ascending: false }).limit(10);
  if (!data || !data.length) { box.innerHTML = '<p class="sub">No booking requests yet.</p>'; return; }
  box.innerHTML = '<h4>Your requests</h4>' + data.map((r) => `<p class="sub">${esc(r.created_at.slice(0,10))} - ${esc(r.listing_id || 'general')} - ${esc(r.status)}</p>`).join('');
}

boot();
