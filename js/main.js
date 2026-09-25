'use strict';
// ==================================================================
// eFootball Championship — public site
// ==================================================================

const $ = (id) => document.getElementById(id);
const DEVICE_KEY = 'ef_device_team';          // this phone's saved team + code
const PLAY_WINDOW_MIN = 45;                   // how long a match shows as "In play"

const STATUS_LABEL = {
  pending_teams:     { text: 'TBD',              cls: 'badge-eliminated' },
  awaiting_schedule: { text: 'Awaiting time',    cls: 'badge-pending' },
  scheduled:         { text: 'Scheduled',        cls: 'badge-live' },
  awaiting_opponent: { text: 'Result pending',   cls: 'badge-pending' },
  pending_approval:  { text: 'Result pending',   cls: 'badge-pending' },
  disputed:          { text: 'Result pending',   cls: 'badge-pending' },   // disputes stay private to the admin
  approved:          { text: 'Full-Time',        cls: 'badge-approved' }
};

const NAV = [
  { id: 'homeView',    label: 'Home',    icon: '<path d="M3.5 11.2 12 4l8.5 7.2"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>' },
  { id: 'groupsView',  label: 'Groups',  icon: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8.5 4.5v15"/>', needsGroups: true },
  { id: 'bracketView', label: 'Bracket', icon: '<path d="M4 5h4v4H4zM4 15h4v4H4zM16 10h4v4h-4z"/><path d="M8 7h4a2 2 0 0 1 2 2v1M8 17h4a2 2 0 0 1 2-2v-1"/>' },
  { id: 'teamsView',   label: 'Teams',   icon: '<circle cx="9" cy="8" r="3"/><path d="M2 20c0-3.3 3-5.5 7-5.5s7 2.2 7 5.5"/><circle cx="17" cy="7" r="2.4"/><path d="M16.5 14.6c2.9.4 5 2.4 5 5.4"/>' },
  { id: 'meView',      label: 'My Team', icon: '<path d="M12 3.5 19 6v5.5c0 4.2-2.9 7.4-7 9-4.1-1.6-7-4.8-7-9V6z"/><path d="M8.8 12.2l2.2 2.2 4.2-4.4"/>' }
];

let allTeams = [];
let teamsById = {};
let allMatches = [];
let allGroups = [];
let groupStandings = [];
let settings = null;
let teamsLoaded = false;
let device = readDevice();
let meKey = '';
let staleDeviceNotice = false;
let currentView = 'homeView';
const myFx = { list: [], sig: '' };
const drafts = {};            // typed-but-unsent scores, so live refreshes never wipe them
const editing = new Set();    // fixtures where the player chose "change my score"

// ---------------------------------------------------------------- utilities
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
const safeLogo = (k) => (/^logo-\d{2}$/.test(k || '') ? k : 'logo-01');
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDayTime = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtDate = (iso) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
const dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sameDay = (a, b) => dayStart(a).getTime() === dayStart(b).getTime();
const teamName = (id) => (teamsById[id] ? teamsById[id].team_name : 'TBD');

function crest(team, cls = '') {
  const key = safeLogo(team && (team.logo || team.opponent_logo));
  return `<img class="crest ${cls}" src="logos/${key}.svg" alt="" width="28" height="28" loading="lazy">`;
}

// Saved team on THIS phone (feature: no need to type the code again)
function readDevice() {
  try {
    const v = JSON.parse(localStorage.getItem(DEVICE_KEY) || 'null');
    if (v && v.team_id && v.code) return v;
  } catch (e) { /* storage blocked or corrupt — treat as not saved */ }
  return null;
}
function saveDevice(obj) {
  device = obj;
  try { localStorage.setItem(DEVICE_KEY, JSON.stringify(obj)); return true; } catch (e) { return false; }
}
function clearDevice() {
  device = null; myFx.list = []; myFx.sig = '';
  try { localStorage.removeItem(DEVICE_KEY); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- boot
document.addEventListener('DOMContentLoaded', () => {
  buildNav();
  initModals();
  initInstallPrompt();
  document.addEventListener('click', onGlobalClick);
  $('teamsSearch').addEventListener('input', renderTeams);
  $('championName').addEventListener('click', () => { if (settings && settings.champion_id) openTeamProfile(settings.champion_id); });

  const hash = location.hash.slice(1);
  showView(NAV.some((n) => n.id === hash) ? hash : 'homeView');

  refreshAll();
  subscribeRealtime();

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (currentView === 'bracketView') renderBracket(); }, 200);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshAll(); } });
  setInterval(tick, 60000);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

function tick() {
  if (document.hidden) return;
  renderHome();
  if (device) loadMyFixtures();
}

// ---------------------------------------------------------------- navigation
function buildNav() {
  const btn = (n, extra) => `<button type="button" class="tab-btn nav-tab ${extra}" data-target="${n.id}" ${n.needsGroups ? 'data-needs-groups="1" hidden' : ''}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${n.icon}</svg><span>${n.label}</span></button>`;
  $('topTabs').innerHTML = NAV.map((n) => btn(n, '')).join('');
  $('bottomTabs').innerHTML = NAV.map((n) => btn(n, 'bottom-tab')).join('');
  document.querySelectorAll('.nav-tab').forEach((b) => b.addEventListener('click', () => showView(b.dataset.target)));
}

function showView(id) {
  currentView = id;
  document.querySelectorAll('.nav-tab').forEach((b) => b.classList.toggle('active', b.dataset.target === id));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === id));
  try { history.replaceState(null, '', '#' + id); } catch (e) { /* ignore */ }
  window.scrollTo({ top: 0 });
  if (id === 'bracketView') renderBracket();
  if (id === 'meView') { renderMe(); if (device) loadMyFixtures(); }
}

function updateGroupsTab() {
  const has = allGroups.length > 0;
  document.querySelectorAll('[data-needs-groups]').forEach((b) => { b.hidden = !has; });
  if (!has && currentView === 'groupsView') showView('homeView');
}

// ---------------------------------------------------------------- modals
function initModals() {
  document.querySelectorAll('.modal-backdrop').forEach((bd) => {
    bd.addEventListener('click', (e) => {
      if (e.target === bd || e.target.closest('[data-close-modal]')) bd.classList.remove('show');
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.modal-backdrop.show').forEach((m) => m.classList.remove('show'));
  });
  $('copyCodeBtn').addEventListener('click', () => {
    const code = $('revealedCode').dataset.raw || '';
    const done = () => { $('copyCodeBtn').textContent = 'Copied!'; setTimeout(() => { $('copyCodeBtn').textContent = 'Copy code'; }, 1400); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done).catch(() => {});
  });
}
const openModal = (id) => $(id).classList.add('show');
const closeModal = (id) => $(id).classList.remove('show');

function onGlobalClick(e) {
  const el = e.target.closest('[data-team-id]');
  if (el && el.dataset.teamId) openTeamProfile(el.dataset.teamId);
}

// ---------------------------------------------------------------- data
async function refreshAll() {
  await loadTeams();
  await Promise.all([loadSettings(), loadMatches(), loadGroups()]);
}

async function loadSettings() {
  const { data, error } = await sb.from('tournament_settings').select('*').eq('id', 1).single();
  if (error || !data) return;
  settings = data;
  $('tournamentName').textContent = data.tournament_name;
  document.title = data.tournament_name + ' — Live Fixtures & Bracket';
  renderHome();
  renderGroups();
  renderMe();
}

async function loadTeams() {
  const { data, error } = await sb.from('teams').select('id,team_name,logo,status,group_id,created_at').order('created_at', { ascending: true });
  if (error) { console.error(error); return; }
  allTeams = data || [];
  teamsById = {};
  allTeams.forEach((t) => { teamsById[t.id] = t; });
  teamsLoaded = true;

  // a saved team from an old tournament no longer exists → forget it
  if (device && !teamsById[device.team_id]) { clearDevice(); staleDeviceNotice = true; meKey = ''; }

  renderTeams();
  renderHome();
  renderGroups();
  renderBracket();
  renderMe();
  fillSignInTeams();
}

async function loadGroups() {
  const [g, s] = await Promise.all([
    sb.from('groups').select('*').order('name', { ascending: true }),
    sb.from('group_standings').select('*')
  ]);
  if (g.error) { console.error(g.error); return; }
  allGroups = g.data || [];
  groupStandings = s.error ? [] : (s.data || []);
  updateGroupsTab();
  renderGroups();
}

async function loadMatches() {
  const { data, error } = await sb.from('matches').select('*')
    .order('phase', { ascending: true }).order('round', { ascending: true }).order('match_index', { ascending: true });
  if (error) { console.error(error); return; }
  allMatches = data || [];
  renderHome();
  renderBracket();
  if (device) loadMyFixtures();
}

function subscribeRealtime() {
  const reMatches = debounce(() => { loadMatches(); loadGroups(); }, 500);
  const reTeams = debounce(() => loadTeams(), 500);
  const reSettings = debounce(() => loadSettings(), 300);
  const reGroups = debounce(() => loadGroups(), 500);
  sb.channel('public-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, reMatches)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, reTeams)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_settings' }, reSettings)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, reGroups)
    .subscribe();
}

// ---------------------------------------------------------------- match helpers
function isKnockout(m) { return m.phase === 'knockout'; }

function competitionLabel(m) {
  return m.round_name || (isKnockout(m) ? 'Round ' + m.round : 'Group stage');
}

function matchState(m) {
  if (m.status === 'approved') return STATUS_LABEL.approved;
  if (['awaiting_opponent', 'pending_approval', 'disputed'].includes(m.status)) return STATUS_LABEL.pending_approval;
  if (m.status === 'scheduled' && m.scheduled_time) {
    const t = new Date(m.scheduled_time).getTime();
    const now = Date.now();
    if (now >= t + PLAY_WINDOW_MIN * 60000) return { text: 'Awaiting result', cls: 'badge-pending' };
    if (now >= t) return { text: 'In play', cls: 'badge-live' };
  }
  return STATUS_LABEL[m.status] || { text: m.status, cls: '' };
}

function playable(m) {
  return !m.is_bye && m.team1_id && m.team2_id;
}
const byTime = (a, b) => new Date(a.scheduled_time) - new Date(b.scheduled_time);

function teamSide(team, win, right) {
  if (!team) return `<div class="fx-team ${right ? 'right' : ''}"><span class="tl-name muted">TBD</span></div>`;
  return `<button type="button" class="team-link fx-team ${right ? 'right' : ''} ${win ? 'is-win' : ''}" data-team-id="${team.id}">
    ${crest(team)}<span class="tl-name">${escapeHtml(team.team_name)}</span></button>`;
}

function fixtureRow(m, showDay) {
  const t1 = teamsById[m.team1_id];
  const t2 = teamsById[m.team2_id];
  const done = m.status === 'approved';
  const st = matchState(m);
  const pens = done && m.team1_penalties != null
    ? `<div class="fx-pens">${m.team1_penalties}–${m.team2_penalties} pens</div>` : '';
  const mid = done
    ? `<div class="fx-score">${m.team1_score}<i>–</i>${m.team2_score}</div>${pens}`
    : `<div class="fx-time">${m.scheduled_time ? fmtTime(m.scheduled_time) : 'vs'}</div>`;
  const foot = escapeHtml(competitionLabel(m)) + (showDay && m.scheduled_time ? ' · ' + escapeHtml(fmtDayTime(m.scheduled_time)) : '');
  return `<div class="glass fx-row">
    ${teamSide(t1, done && m.winner_id === m.team1_id, false)}
    <div class="fx-mid">${mid}<span class="badge ${st.cls}">${st.text}</span></div>
    ${teamSide(t2, done && m.winner_id === m.team2_id, true)}
    <div class="fx-foot">${foot}</div>
  </div>`;
}

// ---------------------------------------------------------------- HOME
function renderHome() {
  const statusMap = {
    registration: 'Registration open', group_stage: 'Group stage under way',
    knockout: 'Knockout stage live', completed: 'Champion crowned'
  };
  if (settings) $('tournamentStatus').textContent = statusMap[settings.status] || settings.status;

  const banner = $('championBanner');
  const champ = settings && settings.status === 'completed' && settings.champion_id ? teamsById[settings.champion_id] : null;
  banner.hidden = !champ;
  if (champ) $('championName').innerHTML = `${crest(champ, 'crest-sm')}<span>${escapeHtml(champ.team_name)}</span>`;

  renderHomeMine();
  renderHomeFeed();
}

function renderHomeMine() {
  const box = $('homeMine');
  if (!teamsLoaded) { box.innerHTML = ''; return; }
  if (!device) {
    box.innerHTML = settings && settings.status === 'registration'
      ? `<div class="glass glass-pad cta-card">
           <div><strong>Join the tournament</strong><div class="hint">Pick a logo, register once — this phone remembers your code.</div></div>
           <button type="button" class="btn btn-primary" data-go="meView">Register</button>
         </div>` : '';
    box.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.go)));
    return;
  }
  const mine = allMatches.filter((m) => playable(m) && (m.team1_id === device.team_id || m.team2_id === device.team_id));
  const next = mine.filter((m) => m.status !== 'approved' && m.scheduled_time).sort(byTime)[0]
            || mine.filter((m) => m.status !== 'approved')[0];
  const openMin = (settings && settings.submission_open_minutes) ?? 10;
  const canSubmit = next && next.scheduled_time && next.status !== 'pending_teams' &&
    Date.now() >= new Date(next.scheduled_time).getTime() - openMin * 60000;
  box.innerHTML = `<div class="feed-title"><span>Your next match</span></div>` + (next
    ? fixtureRow(next, true) + (canSubmit ? `<div style="margin:-2px 0 14px;"><button type="button" class="btn btn-primary btn-block" data-go="meView">Submit your result</button></div>` : '')
    : `<div class="glass glass-pad hint" style="margin-bottom:14px;">No upcoming match for ${escapeHtml(device.team_name)} yet — the admin will schedule it.</div>`);
  box.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.go)));
}

function renderHomeFeed() {
  const feed = $('homeFeed');
  if (!teamsLoaded) return;
  const now = new Date();
  const today0 = dayStart(now);
  const dayAfter = addDays(today0, 2);
  const timed = allMatches.filter((m) => playable(m) && m.scheduled_time);

  const today = timed.filter((m) => sameDay(m.scheduled_time, now)).sort(byTime);
  const tomorrow = timed.filter((m) => sameDay(m.scheduled_time, addDays(now, 1))).sort(byTime);
  const later = timed.filter((m) => new Date(m.scheduled_time) >= dayAfter && m.status !== 'approved').sort(byTime).slice(0, 8);
  const overdue = timed.filter((m) => new Date(m.scheduled_time) < today0 && m.status !== 'approved').sort(byTime);
  const shownIds = new Set(today.concat(tomorrow).map((m) => m.id));
  const results = allMatches.filter((m) => m.status === 'approved' && !m.is_bye && !shownIds.has(m.id))
    .sort((a, b) => new Date(b.approved_at || b.scheduled_time || 0) - new Date(a.approved_at || a.scheduled_time || 0)).slice(0, 8);

  const block = (title, sub, list, showDay) => list.length
    ? `<div class="feed-title"><span>${title}</span><span class="feed-sub">${sub}</span></div>${list.map((m) => fixtureRow(m, showDay)).join('')}` : '';

  let html = block('Today', now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }), today, false)
           + block('Tomorrow', addDays(now, 1).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }), tomorrow, false);

  if (!today.length && !tomorrow.length) {
    html += `<div class="glass glass-pad empty-inline"><div class="big">📅</div>No matches scheduled for today or tomorrow.</div>`;
  }
  html += block('Awaiting result', 'Played earlier — not yet confirmed', overdue, true)
       + block('Coming up', 'Next scheduled matches', later, true)
       + block('Latest results', 'Full-Time', results, true);

  feed.innerHTML = html;
}

// ---------------------------------------------------------------- TEAMS + PROFILE
function statusBadgeClass(s) {
  if (s === 'champion') return 'badge-champion';
  if (s === 'eliminated') return 'badge-eliminated';
  if (s === 'withdrawn') return 'badge-disputed';
  return 'badge-live';
}
const statusBadgeText = (s) => ({ active: 'Active', eliminated: 'Eliminated', champion: 'Champion', withdrawn: 'Withdrawn' }[s] || s);

function renderTeams() {
  const grid = $('teamsGrid');
  if (!allTeams.length) {
    grid.innerHTML = `<div class="empty-state"><div class="big">🎮</div>No teams registered yet — be the first.</div>`;
    return;
  }
  const q = ($('teamsSearch').value || '').trim().toLowerCase();
  const list = q ? allTeams.filter((t) => t.team_name.toLowerCase().includes(q)) : allTeams;
  if (!list.length) { grid.innerHTML = `<div class="empty-state">No team matches "${escapeHtml(q)}".</div>`; return; }
  grid.innerHTML = list.map((t) => `
    <div class="glass team-card" data-team-id="${t.id}" role="button" tabindex="0">
      <div class="tc-top">${crest(t, 'crest-lg')}<div class="name">${escapeHtml(t.team_name)}</div></div>
      <span class="badge ${statusBadgeClass(t.status)}">${statusBadgeText(t.status)}</span>
      <div class="meta">Joined ${fmtDate(t.created_at)}</div>
    </div>`).join('');
  grid.querySelectorAll('.team-card').forEach((c) => c.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTeamProfile(c.dataset.teamId); }
  }));
}

function teamRecord(teamId) {
  const played = allMatches
    .filter((m) => m.status === 'approved' && !m.is_bye && (m.team1_id === teamId || m.team2_id === teamId))
    .sort((a, b) => new Date(a.approved_at || a.scheduled_time || 0) - new Date(b.approved_at || b.scheduled_time || 0));
  const r = { played, W: 0, D: 0, L: 0, GF: 0, GA: 0 };
  played.forEach((m) => {
    const home = m.team1_id === teamId;
    r.GF += home ? m.team1_score : m.team2_score;
    r.GA += home ? m.team2_score : m.team1_score;
    if (m.winner_id === teamId) r.W++; else if (!m.winner_id) r.D++; else r.L++;
  });
  return r;
}

function standingsTable(rows, qualifiers, highlightId) {
  return `<div class="table-wrap" style="box-shadow:none; padding:0;">
    <table class="standings-table">
      <thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr data-team-id="${r.team_id}" class="${r.position <= qualifiers ? 'qualified' : ''} ${r.team_id === highlightId ? 'is-me' : ''}">
          <td><span class="pos-cell">${r.position}</span></td>
          <td><div class="st-team">${crest(r, 'crest-sm')}<span>${escapeHtml(r.team_name)}</span></div></td>
          <td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td>
          <td>${r.goals_for}</td><td>${r.goals_against}</td>
          <td>${r.goal_diff > 0 ? '+' : ''}${r.goal_diff}</td>
          <td class="pts">${r.points}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
}

const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : (n % 10 < 4 ? n % 10 : 0)]);

function openTeamProfile(teamId) {
  const team = teamsById[teamId];
  if (!team) return;
  const rec = teamRecord(teamId);
  const group = allGroups.find((g) => g.id === team.group_id);
  const groupRows = group ? groupStandings.filter((r) => r.group_id === group.id).sort((a, b) => a.position - b.position) : [];
  const myRow = groupRows.find((r) => r.team_id === teamId);
  const qualifiers = (settings && settings.qualifiers_per_group) || 2;

  const form = rec.played.slice(-5).map((m) => {
    const c = m.winner_id === teamId ? ['W', 'chip-w'] : (!m.winner_id ? ['D', 'chip-d'] : ['L', 'chip-l']);
    return `<span class="form-chip ${c[1]}">${c[0]}</span>`;
  }).join('') || '<span class="hint">No matches played yet</span>';

  const upcoming = allMatches.filter((m) => playable(m) && m.status !== 'approved' && (m.team1_id === teamId || m.team2_id === teamId))
    .sort((a, b) => (a.scheduled_time ? new Date(a.scheduled_time) : Infinity) - (b.scheduled_time ? new Date(b.scheduled_time) : Infinity))[0];

  const results = rec.played.slice().reverse().map((m) => {
    const home = m.team1_id === teamId;
    const oppId = home ? m.team2_id : m.team1_id;
    const opp = teamsById[oppId];
    const my = home ? m.team1_score : m.team2_score;
    const their = home ? m.team2_score : m.team1_score;
    const myPen = home ? m.team1_penalties : m.team2_penalties;
    const theirPen = home ? m.team2_penalties : m.team1_penalties;
    const res = m.winner_id === teamId ? ['W', 'chip-w'] : (!m.winner_id ? ['D', 'chip-d'] : ['L', 'chip-l']);
    return `<div class="list-item res-item">
      <div class="res-left">
        <span class="form-chip ${res[1]}">${res[0]}</span>
        <button type="button" class="team-link" data-team-id="${oppId}">${crest(opp, 'crest-sm')}<span class="tl-name">vs ${escapeHtml(opp ? opp.team_name : 'Unknown')}</span></button>
      </div>
      <div class="res-right">
        <div class="mono res-score">${my} – ${their}</div>
        <div class="hint mono">${escapeHtml(competitionLabel(m))}${myPen != null ? ` · pens ${myPen}–${theirPen}` : ''}</div>
      </div>
    </div>`;
  }).join('');

  let tableBlock = '';
  if (group && groupRows.length) {
    tableBlock = `<h4 class="tp-h">${escapeHtml(group.name)} table${myRow ? ` · <span class="tp-pos">${ordinal(myRow.position)}</span>` : ''}</h4>${standingsTable(groupRows, qualifiers, teamId)}`;
  } else {
    const last = rec.played.filter((m) => isKnockout(m)).pop();
    tableBlock = `<h4 class="tp-h">Tournament run</h4><div class="hint" style="margin-top:0;">${last ? 'Latest knockout match: ' + escapeHtml(competitionLabel(last)) : 'Knockout tournament — no league table. Results below show the run so far.'}</div>`;
  }

  $('teamProfileBody').innerHTML = `
    <div class="tp-head">
      ${crest(team, 'crest-xl')}
      <div>
        <h3 style="margin:0 0 6px;">${escapeHtml(team.team_name)}</h3>
        <div class="pill-row">
          <span class="badge ${statusBadgeClass(team.status)}">${statusBadgeText(team.status)}</span>
          ${group ? `<span class="badge badge-approved">${escapeHtml(group.name)}${myRow ? ' · ' + ordinal(myRow.position) : ''}</span>` : ''}
        </div>
      </div>
    </div>
    <div class="stat-tiles">
      ${[['P', rec.played.length], ['W', rec.W], ['D', rec.D], ['L', rec.L], ['GF', rec.GF], ['GA', rec.GA]]
        .map(([k, v]) => `<div class="stat-tile"><div class="num">${v}</div><div class="lbl">${k}</div></div>`).join('')}
    </div>
    <h4 class="tp-h">Form</h4><div class="pill-row">${form}</div>
    ${upcoming ? `<h4 class="tp-h">Next match</h4>${fixtureRow(upcoming, true)}` : ''}
    ${tableBlock}
    <h4 class="tp-h">Results &amp; opponents</h4>
    ${results || '<div class="empty-state" style="padding:18px;">No matches played yet.</div>'}`;
  openModal('teamProfileModal');
  $('teamProfileBody').parentElement.scrollTop = 0;
}

// ---------------------------------------------------------------- GROUPS
function renderGroups() {
  const wrap = $('groupsWrap');
  const sub = $('groupsSub');
  if (!allGroups.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="big">🗂️</div>No groups yet — the admin sets these up before the group stage begins.</div>`;
    return;
  }
  const qualifiers = (settings && settings.qualifiers_per_group) || 2;
  sub.textContent = `Top ${qualifiers} from each group advance to the knockouts · tap a team for details`;
  wrap.innerHTML = `<div class="groups-grid">${allGroups.map((g) => {
    const rows = groupStandings.filter((r) => r.group_id === g.id).sort((a, b) => a.position - b.position);
    if (!rows.length) return `<div class="glass group-card"><h3>${escapeHtml(g.name)}</h3><div class="group-hint">No teams assigned yet.</div></div>`;
    return `<div class="glass group-card"><h3>${escapeHtml(g.name)}</h3>
      <div class="group-hint">${rows.length} team${rows.length === 1 ? '' : 's'}</div>
      ${standingsTable(rows, qualifiers, null)}
      <div class="standings-legend"><span class="dot"></span> Qualifies for the knockouts</div></div>`;
  }).join('')}</div>`;
}

// ---------------------------------------------------------------- BRACKET
function renderBracket() {
  if (currentView !== 'bracketView') return;
  const wrap = $('bracketWrap');
  const pill = $('bracketRoundPill');
  const ko = allMatches.filter(isKnockout);

  if (!ko.length) {
    const msg = settings && settings.status === 'group_stage'
      ? `Group stage is under way — check the Groups tab. The bracket opens once it's finalized.`
      : `The bracket will appear here once the admin schedules Round 1.`;
    wrap.innerHTML = `<div class="empty-state"><div class="big">🏆</div>${msg}</div>`;
    pill.innerHTML = '';
    return;
  }

  const rounds = {};
  ko.forEach((m) => { (rounds[m.round] = rounds[m.round] || []).push(m); });
  const roundNums = Object.keys(rounds).map(Number).sort((a, b) => a - b);
  const lastRound = roundNums[roundNums.length - 1];
  pill.innerHTML = currentRoundPillHtml(rounds, roundNums);

  const finalMatch = rounds[lastRound] && rounds[lastRound][0];
  const champion = settings && settings.status === 'completed' && settings.champion_id ? teamsById[settings.champion_id] : null;

  wrap.innerHTML = `<div class="bracket" id="bracketTrack">
    ${roundNums.map((r) => `
      <div class="bracket-round" data-round="${r}">
        <div class="bracket-round-title">${escapeHtml(rounds[r][0].round_name || ('Round ' + r))}</div>
        ${rounds[r].sort((a, b) => a.match_index - b.match_index).map(matchCardHtml).join('')}
      </div>`).join('')}
    <div class="bracket-trophy">
      <div class="cup ${champion ? '' : 'is-pending'}">🏆</div>
      <div class="champ-label">${champion ? 'Champion' : escapeHtml((finalMatch && finalMatch.round_name) || 'Final')}</div>
      ${champion ? `<div class="champ-name">${escapeHtml(champion.team_name)}</div>` : ''}
    </div>
    <svg class="bracket-svg" id="bracketSvg"></svg>
  </div>`;
  drawBracketConnectors(rounds, roundNums);
}

function currentRoundPillHtml(rounds, roundNums) {
  for (const r of roundNums) {
    if (rounds[r].some((m) => m.status !== 'approved')) {
      return `<span class="round-pill">Now playing · ${escapeHtml(rounds[r][0].round_name || ('Round ' + r))}</span>`;
    }
  }
  const last = roundNums[roundNums.length - 1];
  return `<span class="round-pill">🏆 ${escapeHtml((rounds[last] && rounds[last][0].round_name) || 'Final')} decided</span>`;
}

function drawBracketConnectors(rounds, roundNums) {
  requestAnimationFrame(() => {
    const track = $('bracketTrack');
    const svg = $('bracketSvg');
    if (!track || !svg) return;
    const trackRect = track.getBoundingClientRect();
    const width = track.scrollWidth;
    const height = track.scrollHeight;
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    let html = `<defs>
      <marker id="arrowHead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><polygon points="0 0, 7 3, 0 6"></polygon></marker>
      <marker id="arrowHeadDecided" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><polygon class="is-decided" points="0 0, 7 3, 0 6"></polygon></marker>
    </defs>`;

    roundNums.forEach((r, ri) => {
      if (ri === roundNums.length - 1) return;
      const nextCards = (rounds[roundNums[ri + 1]] || []).slice().sort((a, b) => a.match_index - b.match_index);
      rounds[r].slice().sort((a, b) => a.match_index - b.match_index).forEach((m) => {
        const el = track.querySelector(`[data-match-id="${m.id}"]`);
        const nextMatch = nextCards.find((n) => n.match_index === Math.floor(m.match_index / 2));
        const nextEl = nextMatch && track.querySelector(`[data-match-id="${nextMatch.id}"]`);
        if (!el || !nextEl) return;
        const a = el.getBoundingClientRect();
        const b = nextEl.getBoundingClientRect();
        const x1 = a.right - trackRect.left + track.scrollLeft;
        const y1 = a.top + a.height / 2 - trackRect.top + track.scrollTop;
        const x2 = b.left - trackRect.left + track.scrollLeft;
        const y2 = b.top + b.height / 2 - trackRect.top + track.scrollTop;
        const midX = x1 + (x2 - x1) / 2;
        const decided = !!m.winner_id;
        html += `<path class="${decided ? 'is-decided' : ''}" marker-end="url(#${decided ? 'arrowHeadDecided' : 'arrowHead'})"
          d="M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2 - 6} ${y2}"></path>`;
      });
    });
    svg.innerHTML = html;
  });
}

function bracketSlot(team, isBye, score, win) {
  const name = team ? escapeHtml(team.team_name) : (isBye ? 'BYE' : 'TBD');
  const inner = `${team ? crest(team, 'crest-sm') : '<span class="crest crest-sm crest-empty"></span>'}<span class="team">${name}</span>`;
  return `<div class="match-slot ${win ? 'winner' : ''}">
    ${team ? `<button type="button" class="team-link slot-link" data-team-id="${team.id}">${inner}</button>` : `<span class="slot-link muted">${inner}</span>`}
    <span class="score">${score ?? ''}</span></div>`;
}

function matchCardHtml(m) {
  const t1 = teamsById[m.team1_id];
  const t2 = m.is_bye ? null : teamsById[m.team2_id];
  const st = matchState(m);
  const done = m.status === 'approved';
  const pens = done && m.team1_penalties != null ? `<div class="pens-line">Pens ${m.team1_penalties}–${m.team2_penalties}</div>` : '';
  return `<div class="glass match-card ${m.status === 'scheduled' ? 'is-live' : ''}" data-match-id="${m.id}">
    ${bracketSlot(t1, false, m.team1_score, m.winner_id && m.winner_id === m.team1_id)}
    <div class="vs-divider"></div>
    ${bracketSlot(t2, m.is_bye, m.team2_score, m.winner_id && m.winner_id === m.team2_id)}
    ${pens}
    <div class="meta-row">
      <span class="badge ${st.cls}">${m.is_bye ? 'Bye' : st.text}</span>
      <span class="time">${m.scheduled_time ? escapeHtml(fmtDayTime(m.scheduled_time)) : ''}</span>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- MY TEAM
function renderMe(force) {
  const body = $('meBody');
  if (!body || !teamsLoaded) return;
  const closed = settings && settings.status !== 'registration';
  const key = device ? 'in:' + device.team_id : (closed ? 'guest-closed' : 'guest-open');
  if (!force && key === meKey) return;
  meKey = key;
  if (device) renderMeRegistered(body); else renderMeGuest(body, closed);
}

function logoPickerHtml() {
  let html = '';
  for (let i = 1; i <= LOGO_COUNT; i++) {
    const k = 'logo-' + String(i).padStart(2, '0');
    html += `<label class="logo-opt"><input type="radio" name="regLogo" value="${k}" ${i === 1 ? 'required' : ''}><img src="logos/${k}.svg" alt="Logo ${i}" loading="lazy"></label>`;
  }
  return html;
}

function registerFormHtml() {
  return `<div class="grid-2">
    <form id="registerForm" class="glass glass-pad" autocomplete="off">
      <div class="field"><label for="regTeamName">eFootball team name</label>
        <input id="regTeamName" type="text" placeholder="e.g. FC Nightfall" required minlength="2" maxlength="40"></div>
      <div class="field"><label for="regOwnerName">Your name (optional)</label>
        <input id="regOwnerName" type="text" placeholder="Who's playing" maxlength="60"></div>
      <div class="field"><label for="regPhone">Phone number</label>
        <input id="regPhone" type="tel" placeholder="e.g. 080XXXXXXXX" required maxlength="20" inputmode="tel">
        <div class="hint">Only the admin can see this. It is never shown on the site.</div></div>
      <div class="field"><label for="regPreferredTime">Best time for your matches</label>
        <input id="regPreferredTime" type="text" placeholder="e.g. Weekday evenings after 7pm" maxlength="120">
        <div class="hint">The admin uses this to pair you with opponents free at the same time.</div></div>
      <div class="field"><label>Choose your team logo</label>
        <div class="logo-grid" role="radiogroup" aria-label="Team logo">${logoPickerHtml()}</div></div>
      <input type="text" id="regHp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" class="hp-field">
      <button type="submit" class="btn btn-primary btn-block">Register team</button>
      <div id="registerMsg" class="msg"></div>
    </form>
    <div class="glass glass-pad">
      <h3>How it works</h3>
      <ol class="how-list">
        <li>Register your team name, phone number and logo.</li>
        <li>You get a secret code — <strong>it is saved on this phone automatically</strong>, no typing later.</li>
        <li>The admin schedules your fixtures.</li>
        <li>When it's your kick-off time, your match appears under <em>My Team</em>. Both players submit the score.</li>
        <li>If both scores match, the admin approves and the bracket updates.</li>
      </ol>
    </div>
  </div>`;
}

function renderMeGuest(body, closed) {
  const notice = staleDeviceNotice
    ? `<div class="msg show msg-err" style="margin:0 0 16px;">The team saved on this phone belongs to an earlier tournament, so it was removed.</div>` : '';
  staleDeviceNotice = false;

  body.innerHTML = `
    <div class="section-head"><h2>My team</h2><span class="sub">Register once — this phone remembers your code</span></div>
    ${notice}
    <div class="pill-row" style="margin-bottom:18px;">
      <button type="button" class="tab-btn seg-btn ${closed ? '' : 'active'}" data-seg="segRegister">Register a team</button>
      <button type="button" class="tab-btn seg-btn ${closed ? 'active' : ''}" data-seg="segSignin">Already registered</button>
    </div>

    <div id="segRegister" ${closed ? 'hidden' : ''}>
      ${closed ? `<div class="glass glass-pad hint" style="max-width:480px;">Registration is closed — the tournament has already started.</div>` : registerFormHtml()}
    </div>

    <div id="segSignin" ${closed ? '' : 'hidden'}>
      <form id="signinForm" class="glass glass-pad" style="max-width:480px;" autocomplete="off">
        <p class="hint" style="margin-top:0;">New phone, or cleared your browser? Pick your team and enter your code once.</p>
        <div class="field"><label for="signinTeam">Your team</label><select id="signinTeam" required></select></div>
        <div class="field"><label for="signinCode">Your team code</label>
          <input id="signinCode" type="text" class="mono code-input" placeholder="e.g. AB3K-9XQ2" required maxlength="16" autocapitalize="characters" autocomplete="off" spellcheck="false">
          <button type="button" class="link-btn" id="forgotBtn" style="margin-top:6px;">Lost your code?</button></div>
        <button type="submit" class="btn btn-primary btn-block">Save this team on my phone</button>
        <div id="signinMsg" class="msg"></div>
      </form>
    </div>`;

  body.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
    body.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    ['segRegister', 'segSignin'].forEach((id) => { const el = $(id); if (el) el.hidden = id !== b.dataset.seg; });
  }));
  $('forgotBtn').addEventListener('click', () => openModal('forgotModal'));
  if (!closed) $('registerForm').addEventListener('submit', onRegisterSubmit);
  $('signinForm').addEventListener('submit', onSigninSubmit);
  fillSignInTeams();
}

function fillSignInTeams() {
  const sel = $('signinTeam');
  if (!sel) return;
  const keep = sel.value;
  sel.innerHTML = `<option value="">Select your team…</option>` +
    allTeams.map((t) => `<option value="${t.id}">${escapeHtml(t.team_name)}</option>`).join('');
  sel.value = keep;
}

function formatCode(c) { return c && c.length === 8 ? c.slice(0, 4) + '-' + c.slice(4) : (c || ''); }

async function onRegisterSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const msg = $('registerMsg');
  msg.className = 'msg';
  if ($('regHp').value) return;                      // honeypot: bots fill hidden fields
  const logo = form.querySelector('input[name="regLogo"]:checked');
  if (!logo) { msg.classList.add('show', 'msg-err'); msg.textContent = 'Please choose a team logo.'; return; }

  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Registering…';
  const teamNameVal = $('regTeamName').value.trim();
  const { data, error } = await sb.rpc('register_team', {
    p_team_name: teamNameVal,
    p_owner_name: $('regOwnerName').value.trim(),
    p_phone: $('regPhone').value.trim(),
    p_preferred_time: $('regPreferredTime').value.trim(),
    p_logo: logo.value
  });
  btn.disabled = false; btn.textContent = 'Register team';

  if (error || !data) { msg.classList.add('show', 'msg-err'); msg.textContent = 'Registration failed — check your connection and try again.'; return; }
  if (!data.ok) { msg.classList.add('show', 'msg-err'); msg.textContent = data.error; return; }

  const stored = saveDevice({ team_id: data.team_id, team_name: data.team_name, logo: data.logo, code: data.code });
  $('revealedTeamName').textContent = data.team_name;
  $('revealedCode').textContent = formatCode(data.code);
  $('revealedCode').dataset.raw = data.code;
  $('revealedNote').textContent = stored
    ? 'This code is already saved on this phone — you won\'t need to type it when submitting results.'
    : 'Your browser blocked saving, so write this code down — you\'ll need it to submit results.';
  openModal('codeModal');
  meKey = '';
  await loadTeams();
  showView('meView');
}

async function onSigninSubmit(e) {
  e.preventDefault();
  const msg = $('signinMsg');
  msg.className = 'msg';
  const btn = e.currentTarget.querySelector('button[type=submit]');
  btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Checking…';
  const teamId = $('signinTeam').value;
  const code = $('signinCode').value.trim();
  const { data, error } = await sb.rpc('my_fixtures', { p_team_id: teamId, p_code: code });
  btn.disabled = false; btn.textContent = 'Save this team on my phone';
  if (error || !data) { msg.classList.add('show', 'msg-err'); msg.textContent = 'Could not check your code — try again.'; return; }
  if (!data.ok) { msg.classList.add('show', 'msg-err'); msg.textContent = data.error; return; }
  saveDevice({ team_id: data.team.id, team_name: data.team.name, logo: data.team.logo, code: code.toUpperCase().replace(/[^A-Z0-9]/g, '') });
  meKey = '';
  renderMe(true);
  loadMyFixtures();
}

function renderMeRegistered(body) {
  const t = teamsById[device.team_id] || { team_name: device.team_name, logo: device.logo, status: 'active' };
  body.innerHTML = `
    <div class="section-head"><h2>My team</h2><span class="sub">Saved on this phone</span></div>
    <div class="glass glass-pad me-card">
      <button type="button" class="team-link" data-team-id="${device.team_id}" aria-label="Open team profile">${crest(t, 'crest-xl')}</button>
      <div style="flex:1; min-width:0;">
        <h3 style="margin:0 0 6px;">${escapeHtml(t.team_name)}</h3>
        <span class="badge ${statusBadgeClass(t.status)}">${statusBadgeText(t.status)}</span>
        <div style="margin-top:10px;"><button type="button" class="link-btn" id="forgetDeviceBtn">Not you? Remove this team from this phone</button></div>
      </div>
    </div>
    <div class="section-head"><h2 style="font-size:1.25rem;">Submit a result</h2><span class="sub">Your match appears here at kick-off time</span></div>
    <div id="myFixtures"><div class="empty-state"><span class="loader"></span></div></div>`;
  $('forgetDeviceBtn').addEventListener('click', () => {
    if (!confirm('Remove this team from this phone? You will need your code to add it back.')) return;
    clearDevice(); meKey = ''; renderMe(true); renderHome();
  });
  const box = $('myFixtures');
  box.addEventListener('input', onFxInput);
  box.addEventListener('submit', onFxSubmit);
  box.addEventListener('click', onFxClick);
  if (myFx.sig) renderMyFixtures();
}

async function loadMyFixtures() {
  if (!device) return;
  const box = $('myFixtures');
  if (!box) return;
  const { data, error } = await sb.rpc('my_fixtures', { p_team_id: device.team_id, p_code: device.code });
  if (!device || !$('myFixtures')) return;
  if (error || !data) {
    if (!myFx.sig) box.innerHTML = `<div class="msg show msg-err">Couldn't load your match — check your connection.</div>`;
    return;
  }
  if (!data.ok) { renderReauth(data.error); return; }
  const sig = JSON.stringify(data.fixtures);
  if (sig === myFx.sig && box.dataset.rendered === '1') return;
  myFx.sig = sig; myFx.list = data.fixtures;
  renderMyFixtures();
}

function renderReauth(errorText) {
  const box = $('myFixtures');
  if (!box) return;
  const rejected = /^Invalid/.test(errorText);
  box.dataset.rendered = '0'; myFx.sig = '';
  box.innerHTML = `<div class="glass glass-pad">
    <p style="margin-top:0;">${rejected ? 'The code saved on this phone was rejected — the admin may have issued you a new one. Enter it once:' : escapeHtml(errorText)}</p>
    ${rejected ? `<form id="reauthForm">
      <div class="field"><input id="reauthCode" type="text" class="mono code-input" placeholder="e.g. AB3K-9XQ2" required maxlength="16" autocapitalize="characters" autocomplete="off" spellcheck="false"></div>
      <button type="submit" class="btn btn-primary btn-block">Update code</button><div id="reauthMsg" class="msg"></div></form>` : ''}
    <button type="button" class="link-btn" id="forgotBtn2" style="margin-top:8px;">Lost your code?</button></div>`;
  $('forgotBtn2').addEventListener('click', () => openModal('forgotModal'));
  const f = $('reauthForm');
  if (f) f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('reauthCode').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const { data, error } = await sb.rpc('my_fixtures', { p_team_id: device.team_id, p_code: code });
    const m = $('reauthMsg');
    if (error || !data || !data.ok) { m.className = 'msg show msg-err'; m.textContent = (data && data.error) || 'Could not check the code.'; return; }
    saveDevice({ ...device, code });
    myFx.sig = ''; loadMyFixtures();
  });
}

function renderMyFixtures() {
  const box = $('myFixtures');
  if (!box) return;
  box.dataset.rendered = '1';
  if (!myFx.list.length) {
    const t = device.team_id;
    const next = allMatches.filter((m) => playable(m) && m.status !== 'approved' && m.scheduled_time && (m.team1_id === t || m.team2_id === t)).sort(byTime)[0];
    box.innerHTML = `<div class="glass glass-pad empty-inline">
      <div class="big">⏳</div>
      <strong>No match is open for you right now.</strong>
      <div class="hint">Result submission opens when your kick-off time arrives.</div>
      ${next ? `<div style="margin-top:14px;text-align:left;">${fixtureRow(next, true)}</div>` : ''}
    </div>`;
    return;
  }
  box.innerHTML = myFx.list.map(fxCardHtml).join('');
}

function fxCardHtml(f) {
  const my = escapeHtml(device.team_name);
  const opp = escapeHtml(f.opponent_name);
  const d = drafts[f.match_id] || {};
  const isEditing = editing.has(f.match_id);
  const head = `<div class="fx-card-head">
      <button type="button" class="team-link" data-team-id="${f.opponent_id}">${crest({ logo: f.opponent_logo }, 'crest-lg')}</button>
      <div><div class="sub-vs">${my} <span class="muted">vs</span> ${opp}</div>
      <div class="hint mono" style="margin-top:2px;">${escapeHtml(f.round_name || '')} · ${escapeHtml(fmtDayTime(f.kickoff))}</div></div></div>`;

  if (f.i_submitted && !isEditing) {
    const statusText = {
      awaiting_opponent: `Waiting for ${opp} to submit their score too.`,
      pending_approval: '✅ Both scores match. Waiting for the admin to approve.',
      disputed: '⚠️ The two scores don\'t match. Change yours if it\'s wrong — otherwise the admin will decide.'
    }[f.status] || 'Submitted.';
    const pens = f.my_pen != null ? ` <span class="hint mono">(pens ${f.my_pen}–${f.opp_pen})</span>` : '';
    return `<div class="glass glass-pad fx-card">${head}
      <div class="sub-summary">You submitted <strong class="mono">${f.my_score} – ${f.opp_score}</strong>${pens}</div>
      <div class="hint" style="margin:8px 0 14px;">${statusText}</div>
      <button type="button" class="btn btn-sm" data-edit="${f.match_id}">Change my score</button></div>`;
  }

  const s1 = d.s1 ?? (f.my_score ?? ''), s2 = d.s2 ?? (f.opp_score ?? '');
  const p1 = d.p1 ?? (f.my_pen ?? ''), p2 = d.p2 ?? (f.opp_pen ?? '');
  const level = s1 !== '' && s2 !== '' && String(s1) === String(s2);
  return `<div class="glass glass-pad fx-card">${head}
    <form class="fx-form" data-match-id="${f.match_id}" data-knockout="${f.knockout ? 1 : 0}">
      <div class="field-row">
        <div class="field"><label>${my} (you)</label><input type="number" inputmode="numeric" min="0" max="99" required data-f="s1" class="score-input" value="${s1}"></div>
        <div class="field"><label>${opp}</label><input type="number" inputmode="numeric" min="0" max="99" required data-f="s2" class="score-input" value="${s2}"></div>
      </div>
      <div class="field-row pen-wrap" ${f.knockout && level ? '' : 'hidden'}>
        <div class="field"><label>${my} penalties</label><input type="number" inputmode="numeric" min="0" max="99" data-f="p1" class="score-input" value="${p1}"></div>
        <div class="field"><label>${opp} penalties</label><input type="number" inputmode="numeric" min="0" max="99" data-f="p2" class="score-input" value="${p2}"></div>
      </div>
      <div class="hint" style="margin:-6px 0 14px;">Enter the final score from your own point of view. Your opponent submits theirs too.${f.knockout ? ' Level scores need a penalty result.' : ''}</div>
      <button type="submit" class="btn btn-primary btn-block">Submit result</button>
      <div class="msg"></div>
    </form></div>`;
}

function onFxInput(e) {
  const form = e.target.closest('.fx-form');
  if (!form) return;
  const id = form.dataset.matchId;
  const val = (k) => { const el = form.querySelector(`[data-f="${k}"]`); return el ? el.value : ''; };
  drafts[id] = { s1: val('s1'), s2: val('s2'), p1: val('p1'), p2: val('p2') };
  const level = val('s1') !== '' && val('s2') !== '' && val('s1') === val('s2');
  const pw = form.querySelector('.pen-wrap');
  if (pw) pw.hidden = !(form.dataset.knockout === '1' && level);
}

function onFxClick(e) {
  const b = e.target.closest('[data-edit]');
  if (!b) return;
  editing.add(b.dataset.edit);
  renderMyFixtures();
}

async function onFxSubmit(e) {
  e.preventDefault();
  const form = e.target.closest('.fx-form');
  if (!form || !device) return;
  const msg = form.querySelector('.msg');
  msg.className = 'msg';
  const num = (k) => { const el = form.querySelector(`[data-f="${k}"]`); return el && el.value !== '' ? parseInt(el.value, 10) : null; };
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Submitting…';
  const { data, error } = await sb.rpc('submit_match_result', {
    p_team_id: device.team_id, p_code: device.code, p_match_id: form.dataset.matchId,
    p_my_score: num('s1'), p_opp_score: num('s2'), p_my_pen: num('p1'), p_opp_pen: num('p2')
  });
  btn.disabled = false; btn.textContent = 'Submit result';
  if (error || !data) { msg.classList.add('show', 'msg-err'); msg.textContent = 'Could not submit — check your connection.'; return; }
  if (!data.ok) {
    msg.classList.add('show', 'msg-err'); msg.textContent = data.error;
    if (/^Invalid/.test(data.error)) renderReauth(data.error);
    return;
  }
  delete drafts[form.dataset.matchId];
  editing.delete(form.dataset.matchId);
  myFx.sig = '';
  await loadMyFixtures();
}

// ---------------------------------------------------------------- PWA install prompt
function initInstallPrompt() {
  let deferred = null;
  const banner = $('installBanner');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    if (!sessionStorage.getItem('installBannerDismissed')) banner.hidden = false;
  });
  window.addEventListener('appinstalled', () => { deferred = null; banner.hidden = true; });
  $('installBtn').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null; banner.hidden = true;
  });
  $('installDismiss').addEventListener('click', () => {
    sessionStorage.setItem('installBannerDismissed', '1');
    banner.hidden = true;
  });
}
