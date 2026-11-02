import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Trophy, Lock, Unlock, Search, Download, RotateCcw, ShieldCheck,
  Settings2, Users, CalendarDays, ChevronDown, ChevronUp, Check,
  X, AlertTriangle, LogOut, ListChecks, ClipboardList, RefreshCw,
  Upload, Plus, Trash2, BookUser
} from 'lucide-react';

// Passwords are checked by the server (stored scrambled there) — never written in this file.
const SIZES = [7, 8, 9, 10];
const MAX_CONTACTS = 32;

const PALETTE = {
  green: '#1C4A34',
  greenDark: '#123023',
  cream: '#F4EFE2',
  creamDark: '#E7DFC8',
  gold: '#B9944B',
  maroon: '#7A2E2E',
  ink: '#1B1B18',
};

/* ---------------- fixture / scoring helpers ---------------- */

function defaultTeams(size) {
  return Array.from({ length: size }, (_, i) => `Team ${i + 1}`);
}

function defaultDivision(id, name, size = 8) {
  return { id, name, enabled: id === 1, size, teams: defaultTeams(size), fixtures: [] };
}

function defaultData() {
  return {
    divisions: [
      defaultDivision(1, 'Division 1', 8),
      defaultDivision(2, 'Division 2', 8),
      defaultDivision(3, 'Division 3', 8),
    ],
    resultsLocked: false,
    lastBackup: null,
    contacts: [],
  };
}

/* ---------------- contacts helpers ---------------- */

function newContactId() {
  return Math.random().toString(36).slice(2, 10);
}

function blankContact() {
  return { id: newContactId(), name: '', club: '', email: '', phone: '' };
}

// Reads pasted lines. Each line can be separated by commas, or by tabs
// (which is what you get when copying rows out of Excel or Word tables).
// Order: Name, Club/Role, Email, Telephone.
// Email is spotted by the "@" and the phone by its digits, so those two
// can be in any position or left out.
function parseContactLines(text) {
  const contacts = [];
  const skipped = [];
  text.split(/\r?\n/).forEach(raw => {
    const line = raw.trim();
    if (!line) return;
    const parts = (line.includes('\t') ? line.split('\t') : line.split(','))
      .map(s => s.trim().replace(/^"(.*)"$/, '$1').trim())
      .filter(s => s !== '');
    if (parts.length === 0) return;
    const lower = line.toLowerCase();
    if (!line.includes('@') && (lower.includes('email') || lower.includes('e-mail')) && lower.includes('name')) {
      return; // heading row
    }
    let email = '';
    let phone = '';
    const words = [];
    parts.forEach(p => {
      const digits = p.replace(/\D/g, '');
      if (!email && p.includes('@')) email = p;
      else if (!phone && digits.length >= 6 && /^[+()\d\s.\-]+$/.test(p)) phone = p;
      else words.push(p);
    });
    const name = words[0] || '';
    const club = words.slice(1).join(', ');
    if (!name) { skipped.push(line); return; }
    contacts.push({ id: newContactId(), name, club, email, phone });
  });
  return { contacts, skipped };
}


function generateFixtures(teams) {
  let list = [...teams];
  let n = list.length;
  const hasBye = n % 2 !== 0;
  if (hasBye) { list.push('__BYE__'); n++; }
  const half = n / 2;
  let arr = list.slice();
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const roundMatches = [];
    for (let i = 0; i < half; i++) {
      const home = arr[i], away = arr[n - 1 - i];
      if (home !== '__BYE__' && away !== '__BYE__') roundMatches.push({ home, away });
    }
    rounds.push(roundMatches);
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop());
    arr = [fixed, ...rest];
  }
  let id = 1;
  const fixtures = [];
  rounds.forEach((round, ridx) => {
    round.forEach(m => fixtures.push({
      id: id++, round: ridx + 1, home: m.home, away: m.away,
      date: '', h1: '', a1: '', h2: '', a2: '',
    }));
  });
  const totalRounds = rounds.length;
  rounds.forEach((round, ridx) => {
    round.forEach(m => fixtures.push({
      id: id++, round: totalRounds + ridx + 1, home: m.away, away: m.home,
      date: '', h1: '', a1: '', h2: '', a2: '',
    }));
  });
  return fixtures;
}

function rinkPts(h, a) {
  if (h > a) return [2, 0];
  if (h < a) return [0, 2];
  return [1, 1];
}

function isPlayed(f) {
  return ['h1', 'a1', 'h2', 'a2'].every(k => f[k] !== '' && f[k] !== null && f[k] !== undefined);
}

function matchResult(f) {
  if (!isPlayed(f)) return null;
  const H1 = Number(f.h1), A1 = Number(f.a1), H2 = Number(f.h2), A2 = Number(f.a2);
  const [r1h, r1a] = rinkPts(H1, A1);
  const [r2h, r2a] = rinkPts(H2, A2);
  const aggH = H1 + H2, aggA = A1 + A2;
  let ovH, ovA, outcome;
  if (aggH > aggA) { ovH = 2; ovA = 0; outcome = 'H'; }
  else if (aggH < aggA) { ovH = 0; ovA = 2; outcome = 'A'; }
  else { ovH = 1; ovA = 1; outcome = 'D'; }
  return { homePts: r1h + r2h + ovH, awayPts: r1a + r2a + ovA, aggH, aggA, outcome };
}

function computeStandings(teams, fixtures) {
  const t = {};
  teams.forEach(name => { t[name] = { team: name, P: 0, W: 0, D: 0, L: 0, SF: 0, SA: 0, Pts: 0 }; });
  fixtures.forEach(f => {
    const res = matchResult(f);
    if (!res || !t[f.home] || !t[f.away]) return;
    t[f.home].P++; t[f.away].P++;
    t[f.home].SF += res.aggH; t[f.home].SA += res.aggA;
    t[f.away].SF += res.aggA; t[f.away].SA += res.aggH;
    t[f.home].Pts += res.homePts; t[f.away].Pts += res.awayPts;
    if (res.outcome === 'H') { t[f.home].W++; t[f.away].L++; }
    else if (res.outcome === 'A') { t[f.away].W++; t[f.home].L++; }
    else { t[f.home].D++; t[f.away].D++; }
  });
  return Object.values(t).sort((a, b) =>
    b.Pts - a.Pts || (b.SF - b.SA) - (a.SF - a.SA) || b.SF - a.SF || a.team.localeCompare(b.team)
  );
}

/* ---------------- storage helpers ---------------- */

const API_BASE = '/api';

// → { data, version }. Throws if the league can't be loaded (so a blip never looks like an empty league).
async function loadData() {
  const res = await fetch(`${API_BASE}/league`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`load failed (${res.status})`);
  return res.json();
}

// → { status, body }
async function putData(data, baseVersion, auth) {
  try {
    const res = await fetch(`${API_BASE}/league`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, baseVersion, auth }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } catch (e) {
    return { status: 0, body: {} };
  }
}

async function postJson(path, body) {
  try {
    const res = await fetch(`${API_BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, ...(await res.json().catch(() => ({}))) };
  } catch (e) {
    return { ok: false, status: 0, error: "Can't reach the server — check your connection." };
  }
}

const login = (auth) => postJson('auth', { action: 'login', auth });
const changePassword = (auth, target, newPassword) => postJson('auth', { action: 'setPassword', auth, target, newPassword });
const backupAction = (auth, body) => postJson('backup', { ...body, auth });

/* ---------------- small UI atoms ---------------- */

function RinkDivider({ tight }) {
  return (
    <div className={`flex items-center gap-2 ${tight ? 'my-3' : 'my-6'}`} aria-hidden="true">
      <div className="h-px flex-1" style={{ backgroundColor: PALETTE.gold, opacity: 0.5 }} />
      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: PALETTE.gold }} />
      <div className="h-px flex-1" style={{ backgroundColor: PALETTE.gold, opacity: 0.5 }} />
    </div>
  );
}

function Logo({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="16" cy="30" r="9" fill={PALETTE.maroon} />
      <circle cx="30" cy="16" r="9" fill={PALETTE.green} stroke={PALETTE.cream} strokeWidth="1" />
      <circle cx="34" cy="34" r="4.5" fill={PALETTE.cream} />
    </svg>
  );
}

function Pill({ children, tone = 'gold' }) {
  const bg = tone === 'gold' ? PALETTE.gold : tone === 'maroon' ? PALETTE.maroon : PALETTE.green;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold tracking-wide"
      style={{ backgroundColor: bg, color: PALETTE.cream }}
    >
      {children}
    </span>
  );
}

/* ---------------- Standings table ---------------- */

function StandingsTable({ division }) {
  const rows = computeStandings(division.teams, division.fixtures);
  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: PALETTE.creamDark }}>
      <table className="w-full text-sm min-w-[560px]">
        <thead>
          <tr style={{ backgroundColor: PALETTE.green, color: PALETTE.cream }}>
            <th className="text-left font-semibold py-2 pl-3 pr-2 w-8">#</th>
            <th className="text-left font-semibold py-2 px-2">Team</th>
            <th className="text-center font-semibold py-2 px-2">P</th>
            <th className="text-center font-semibold py-2 px-2">W</th>
            <th className="text-center font-semibold py-2 px-2">D</th>
            <th className="text-center font-semibold py-2 px-2">L</th>
            <th className="text-center font-semibold py-2 px-2">Shots F</th>
            <th className="text-center font-semibold py-2 px-2">Shots A</th>
            <th className="text-center font-semibold py-2 px-2">Diff</th>
            <th className="text-center font-semibold py-2 pr-3 pl-2">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.team}
              className="border-t"
              style={{
                borderColor: PALETTE.creamDark,
                backgroundColor: i % 2 === 0 ? '#FFFFFF' : PALETTE.cream,
              }}
            >
              <td className="py-2 pl-3 pr-2 font-medium" style={{ color: PALETTE.gold }}>{i + 1}</td>
              <td className="py-2 px-2 font-semibold" style={{ color: PALETTE.ink }}>{r.team}</td>
              <td className="py-2 px-2 text-center">{r.P}</td>
              <td className="py-2 px-2 text-center">{r.W}</td>
              <td className="py-2 px-2 text-center">{r.D}</td>
              <td className="py-2 px-2 text-center">{r.L}</td>
              <td className="py-2 px-2 text-center">{r.SF}</td>
              <td className="py-2 px-2 text-center">{r.SA}</td>
              <td className="py-2 px-2 text-center">{r.SF - r.SA > 0 ? `+${r.SF - r.SA}` : r.SF - r.SA}</td>
              <td className="py-2 pr-3 pl-2 text-center font-bold" style={{ color: PALETTE.maroon }}>{r.Pts}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={10} className="text-center py-6 text-gray-500">No teams yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function FixturesList({ division, readOnly, editable }) {
  const [open, setOpen] = useState(false);
  const list = editable || division.fixtures;
  const played = list.filter(isPlayed).length;
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-sm font-semibold"
        style={{ color: PALETTE.green }}
      >
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        Fixtures &amp; results ({played}/{list.length} played)
      </button>
      {open && (
        <div className="mt-2 overflow-x-auto rounded-lg border" style={{ borderColor: PALETTE.creamDark }}>
          <table className="w-full text-xs min-w-[500px]">
            <thead>
              <tr style={{ backgroundColor: PALETTE.creamDark }}>
                <th className="text-left py-1.5 px-2">Date</th>
                <th className="text-left py-1.5 px-2">Home</th>
                <th className="text-center py-1.5 px-2">Rink 1</th>
                <th className="text-center py-1.5 px-2">Rink 2</th>
                <th className="text-left py-1.5 px-2">Away</th>
              </tr>
            </thead>
            <tbody>
              {list.map(f => {
                const res = matchResult(f);
                return (
                  <tr key={f.id} className="border-t" style={{ borderColor: PALETTE.creamDark }}>
                    <td className="py-1.5 px-2 whitespace-nowrap">{f.date || '—'}</td>
                    <td className="py-1.5 px-2 font-medium">{f.home}</td>
                    <td className="py-1.5 px-2 text-center">{f.h1 !== '' && f.a1 !== '' ? `${f.h1}-${f.a1}` : '–'}</td>
                    <td className="py-1.5 px-2 text-center">{f.h2 !== '' && f.a2 !== '' ? `${f.h2}-${f.a2}` : '–'}</td>
                    <td className="py-1.5 px-2 font-medium">
                      {f.away}
                      {res && (
                        <span className="ml-2">
                          <Pill tone={res.outcome === 'D' ? 'green' : 'maroon'}>
                            {res.outcome === 'H' ? `${f.home.split(' ').pop()} won` : res.outcome === 'A' ? `${f.away.split(' ').pop()} won` : 'Draw'}
                          </Pill>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------- Public page ---------------- */

function PublicPage({ data }) {
  const enabledDivisions = data.divisions.filter(d => d.enabled && d.fixtures.length > 0);
  return (
    <div>
      <div className="rounded-xl p-4 mb-6" style={{ backgroundColor: PALETTE.cream, border: `1px solid ${PALETTE.creamDark}` }}>
        <p className="text-sm" style={{ color: PALETTE.ink }}>
          <strong>How points work:</strong> each match is played over 2 rinks. A rink win earns 2 points (1 each for a draw).
          The team with the higher combined shot score across both rinks wins the match overall, earning a further 2 points
          (1 each for a tie) — up to <strong>6 points</strong> available per match.
        </p>
      </div>
      {enabledDivisions.length === 0 && (
        <div className="text-center py-16 rounded-xl" style={{ backgroundColor: PALETTE.cream }}>
          <Trophy size={32} className="mx-auto mb-3" style={{ color: PALETTE.gold }} />
          <p className="font-semibold" style={{ color: PALETTE.green }}>No fixtures published yet</p>
          <p className="text-sm text-gray-600 mt-1">Check back once the league admin has set up this season's divisions.</p>
        </div>
      )}
      {enabledDivisions.map(div => (
        <div key={div.id} className="mb-10">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-6 rounded-full" style={{ backgroundColor: PALETTE.maroon }} />
            <h2 className="text-xl font-bold" style={{ color: PALETTE.green, fontFamily: "'Fraunces', serif" }}>{div.name}</h2>
            <Pill>{div.teams.length} teams</Pill>
          </div>
          <StandingsTable division={div} />
          <FixturesList division={div} />
        </div>
      ))}
    </div>
  );
}

/* ---------------- Admin: password gate ---------------- */

function PasswordGate({ onSuccess, role, title, helpText }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!pw || busy) return;
    setBusy(true);
    const auth = { role, password: pw };
    const r = await login(auth);
    setBusy(false);
    if (r.ok) { setError(''); onSuccess(auth); }
    else setError(r.status === 401 ? 'Incorrect password. Please try again.' : (r.error || 'Could not sign in — please try again.'));
  };
  return (
    <div className="max-w-sm mx-auto mt-16 rounded-xl p-6 border" style={{ borderColor: PALETTE.creamDark, backgroundColor: '#fff' }}>
      <div className="flex items-center gap-2 mb-4">
        <ShieldCheck size={22} style={{ color: PALETTE.green }} />
        <h2 className="font-bold text-lg" style={{ color: PALETTE.green }}>{title}</h2>
      </div>
      <label className="block text-sm font-medium mb-1" style={{ color: PALETTE.ink }}>Password</label>
      <input
        type="password"
        value={pw}
        onChange={e => setPw(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        className="w-full border rounded-md px-3 py-2 text-sm mb-2"
        style={{ borderColor: PALETTE.creamDark }}
        placeholder="Enter password"
        autoFocus
      />
      {error && <p className="text-sm mb-2" style={{ color: PALETTE.maroon }}>{error}</p>}
      <button
        onClick={submit}
        className="w-full rounded-md py-2 text-sm font-semibold mt-2"
        style={{ backgroundColor: PALETTE.green, color: PALETTE.cream }}
      >
        {busy ? 'Checking…' : 'Sign in'}
      </button>
      <p className="text-xs text-gray-500 mt-3">{helpText}</p>
    </div>
  );
}

function TeamLeaderPage({ data, resultsLocked, onUpdateFixture }) {
  const [view, setView] = useState('results');
  const contactCount = (data.contacts || []).length;
  const VIEWS = [
    { id: 'results', label: 'Enter results', icon: ClipboardList },
    { id: 'contacts', label: `Contacts${contactCount ? ` (${contactCount})` : ''}`, icon: BookUser },
  ];
  return (
    <div>
      <div className="flex gap-2 flex-wrap mb-4">
        {VIEWS.map(v => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold"
            style={{
              backgroundColor: view === v.id ? PALETTE.maroon : PALETTE.cream,
              color: view === v.id ? '#fff' : PALETTE.ink,
            }}
          >
            <v.icon size={14} /> {v.label}
          </button>
        ))}
      </div>

      {view === 'results' && (
        <>
          <div className="rounded-lg p-3 mb-4 text-sm" style={{ backgroundColor: PALETTE.cream, color: PALETTE.ink }}>
            Find your match below, then enter the shots scored on each rink and the date it was played. Changes save automatically.
          </div>
          <ResultsEntry divisions={data.divisions} resultsLocked={resultsLocked} onUpdateFixture={onUpdateFixture} />
        </>
      )}

      {view === 'contacts' && <ContactsDirectory contacts={data.contacts || []} />}
    </div>
  );
}

/* ---------------- Contacts: read-only directory for team leaders ---------------- */

function ContactsDirectory({ contacts, title }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const list = contacts.filter(c =>
    !q || [c.name, c.club, c.role, c.email, c.phone].some(v => (v || '').toLowerCase().includes(q))
  );

  if (contacts.length === 0) {
    return (
      <div className="text-center py-12 rounded-xl" style={{ backgroundColor: PALETTE.cream }}>
        <BookUser size={28} className="mx-auto mb-2" style={{ color: PALETTE.gold }} />
        <p className="font-semibold" style={{ color: PALETTE.green }}>No contacts yet</p>
        <p className="text-sm text-gray-600 mt-1">The league admin hasn't added the contacts list yet.</p>
      </div>
    );
  }

  return (
    <div>
      {title && (
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1.5 h-6 rounded-full" style={{ backgroundColor: PALETTE.maroon }} />
          <h2 className="text-xl font-bold" style={{ color: PALETTE.green, fontFamily: "'Fraunces', serif" }}>{title}</h2>
        </div>
      )}
      <div className="flex items-center gap-1.5 border rounded-md px-2.5 py-1.5 mb-3 bg-white max-w-md" style={{ borderColor: PALETTE.creamDark }}>
        <Search size={15} className="text-gray-400" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by name, club or role…"
          className="flex-1 text-sm focus:outline-none"
        />
        {query && <button onClick={() => setQuery('')}><X size={14} className="text-gray-400" /></button>}
      </div>

      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: PALETTE.creamDark }}>
        <table className="w-full text-sm min-w-[620px]">
          <thead>
            <tr style={{ backgroundColor: PALETTE.green, color: PALETTE.cream }}>
              <th className="text-left font-semibold py-2 pl-3 pr-2">Name</th>
              <th className="text-left font-semibold py-2 px-2">Club/Role</th>
              <th className="text-left font-semibold py-2 px-2">Email</th>
              <th className="text-left font-semibold py-2 pr-3 pl-2">Telephone</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c, i) => (
              <tr
                key={c.id}
                className="border-t"
                style={{ borderColor: PALETTE.creamDark, backgroundColor: i % 2 === 0 ? '#FFFFFF' : PALETTE.cream }}
              >
                <td className="py-2 pl-3 pr-2 font-semibold" style={{ color: PALETTE.ink }}>{c.name}</td>
                <td className="py-2 px-2" style={{ color: PALETTE.green }}>{c.club || c.role || '—'}</td>
                <td className="py-2 px-2 break-all">{c.email || '—'}</td>
                <td className="py-2 pr-3 pl-2 whitespace-nowrap">{c.phone || '—'}</td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={4} className="text-center py-6 text-gray-500">No contacts match your search.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Contacts: admin editor ---------------- */

function ContactsAdmin({ contacts, onChange }) {
  const [pasteText, setPasteText] = useState('');
  const [mode, setMode] = useState('add');
  const [message, setMessage] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const spacesLeft = MAX_CONTACTS - contacts.length;

  const doUpload = () => {
    const { contacts: parsed, skipped } = parseContactLines(pasteText);
    if (parsed.length === 0) {
      setMessage({ tone: 'warn', text: 'No contacts found. Check there is one person per line, with a name on each line.' });
      return;
    }
    const base = mode === 'replace' ? [] : contacts;
    const room = MAX_CONTACTS - base.length;
    const toAdd = parsed.slice(0, Math.max(room, 0));
    const leftOver = parsed.length - toAdd.length;
    onChange([...base, ...toAdd]);

    const bits = [`${mode === 'replace' ? 'Replaced the list with' : 'Added'} ${toAdd.length} contact${toAdd.length === 1 ? '' : 's'}.`];
    if (leftOver > 0) bits.push(`${leftOver} not added because the list is limited to ${MAX_CONTACTS}.`);
    if (skipped.length > 0) bits.push(`${skipped.length} line${skipped.length === 1 ? '' : 's'} skipped (no name found): ${skipped.slice(0, 3).join(' | ')}${skipped.length > 3 ? ' …' : ''}`);
    setMessage({ tone: leftOver || skipped.length ? 'warn' : 'ok', text: bits.join(' ') });
    if (!leftOver && !skipped.length) setPasteText('');
  };

  const updateOne = (id, field, value) => {
    onChange(contacts.map(c => c.id === id ? { ...c, [field]: value } : c));
  };
  const removeOne = (id) => onChange(contacts.filter(c => c.id !== id));
  const addOne = () => { if (spacesLeft > 0) onChange([...contacts, blankContact()]); };
  const move = (idx, dir) => {
    const to = idx + dir;
    if (to < 0 || to >= contacts.length) return;
    const next = contacts.slice();
    [next[idx], next[to]] = [next[to], next[idx]];
    onChange(next);
  };

  const cell = (c, field, placeholder, type = 'text') => (
    <input
      type={type}
      value={c[field] || ''}
      onChange={e => updateOne(c.id, field, e.target.value)}
      placeholder={placeholder}
      className="w-full border rounded-md px-2 py-1 text-sm"
      style={{ borderColor: PALETTE.creamDark }}
    />
  );

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">
        This list is shown on the <strong>Team leaders</strong> page, underneath the sign-in box, so anyone visiting the site can look people up without a password.
      </p>

      {/* Block upload */}
      <div className="rounded-xl border p-4" style={{ borderColor: PALETTE.creamDark, backgroundColor: '#fff' }}>
        <h3 className="font-bold mb-2 flex items-center gap-2" style={{ color: PALETTE.green }}>
          <Upload size={16} /> Block upload
        </h3>
        <p className="text-sm text-gray-600 mb-2">
          Paste one person per line. You can copy rows straight from an Excel or Word table, or type them with commas, in this order:
        </p>
        <p className="text-sm font-mono rounded-md px-2 py-1.5 mb-1" style={{ backgroundColor: PALETTE.cream }}>
          Name, Club/Role, Email, Telephone
        </p>
        <p className="text-xs text-gray-500 mb-3">
          Example: <span className="font-mono">John Smith, Hatfield, john@example.com, 07700 900123</span><br />
          Committee example: <span className="font-mono">Mary Jones, Secretary, mary@example.com, 01707 123456</span><br />
          Email or telephone can be left blank. A heading row is ignored.
        </p>
        <textarea
          value={pasteText}
          onChange={e => setPasteText(e.target.value)}
          rows={8}
          className="w-full border rounded-md px-3 py-2 text-sm font-mono"
          style={{ borderColor: PALETTE.creamDark }}
          placeholder={'John Smith, Hatfield, john@example.com, 07700 900123\nMary Jones, Secretary, mary@example.com, 01707 123456'}
        />
        <div className="flex flex-wrap items-center gap-4 mt-2">
          <label className="flex items-center gap-1.5 text-sm">
            <input type="radio" name="contact-mode" checked={mode === 'add'} onChange={() => setMode('add')} />
            Add to the current list
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="radio" name="contact-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
            Replace the whole list
          </label>
          <button
            onClick={doUpload}
            disabled={!pasteText.trim()}
            className="rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            style={{ backgroundColor: PALETTE.green, color: '#fff' }}
          >
            Upload
          </button>
        </div>
        {message && (
          <p className="text-sm mt-3 rounded-md p-2" style={{
            backgroundColor: message.tone === 'ok' ? '#EAF3EC' : '#FBEFE9',
            color: message.tone === 'ok' ? PALETTE.green : PALETTE.maroon,
          }}>
            {message.text}
          </p>
        )}
      </div>

      {/* Editable table */}
      <div className="rounded-xl border p-4" style={{ borderColor: PALETTE.creamDark, backgroundColor: '#fff' }}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="font-bold flex items-center gap-2" style={{ color: PALETTE.green }}>
            <BookUser size={16} /> Contacts list
          </h3>
          <Pill tone={spacesLeft === 0 ? 'maroon' : 'gold'}>{contacts.length} of {MAX_CONTACTS} spaces used</Pill>
        </div>

        {contacts.length === 0 ? (
          <p className="text-sm text-gray-500 py-2">No contacts yet. Use Block upload above, or add people one at a time below.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="py-1 pr-2 w-8">#</th>
                  <th className="py-1 pr-2">Name</th>
                  <th className="py-1 pr-2">Club/Role</th>
                  <th className="py-1 pr-2">Email</th>
                  <th className="py-1 pr-2">Telephone</th>
                  <th className="py-1 w-24"></th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c, idx) => (
                  <tr key={c.id} className="border-t" style={{ borderColor: PALETTE.creamDark }}>
                    <td className="py-1.5 pr-2 text-xs" style={{ color: PALETTE.gold }}>{idx + 1}</td>
                    <td className="py-1.5 pr-2">{cell(c, 'name', 'Name')}</td>
                    <td className="py-1.5 pr-2">{cell(c, 'club', 'e.g. Hatfield or Secretary')}</td>
                    <td className="py-1.5 pr-2">{cell(c, 'email', 'Email', 'email')}</td>
                    <td className="py-1.5 pr-2">{cell(c, 'phone', 'Telephone', 'tel')}</td>
                    <td className="py-1.5 whitespace-nowrap text-right">
                      <button onClick={() => move(idx, -1)} disabled={idx === 0} title="Move up" className="p-1 disabled:opacity-30"><ChevronUp size={15} /></button>
                      <button onClick={() => move(idx, 1)} disabled={idx === contacts.length - 1} title="Move down" className="p-1 disabled:opacity-30"><ChevronDown size={15} /></button>
                      <button onClick={() => removeOne(c.id)} title="Remove" className="p-1" style={{ color: PALETTE.maroon }}><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 mt-3">
          <button
            onClick={addOne}
            disabled={spacesLeft === 0}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            style={{ backgroundColor: PALETTE.maroon, color: PALETTE.cream }}
          >
            <Plus size={14} /> Add a contact
          </button>
          {spacesLeft === 0 && <span className="text-xs" style={{ color: PALETTE.maroon }}>The list is full ({MAX_CONTACTS}). Remove someone to add another.</span>}
          {contacts.length > 0 && !confirmClear && (
            <button onClick={() => setConfirmClear(true)} className="text-sm font-semibold ml-auto" style={{ color: PALETTE.maroon }}>
              Clear whole list…
            </button>
          )}
          {confirmClear && (
            <span className="flex flex-wrap items-center gap-2 ml-auto">
              <span className="text-sm font-semibold" style={{ color: PALETTE.maroon }}>Delete all {contacts.length} contacts?</span>
              <button onClick={() => { onChange([]); setConfirmClear(false); }} className="rounded-md px-3 py-1 text-sm font-semibold" style={{ backgroundColor: PALETTE.maroon, color: '#fff' }}>Yes, clear</button>
              <button onClick={() => setConfirmClear(false)} className="rounded-md px-3 py-1 text-sm font-semibold border" style={{ borderColor: PALETTE.creamDark }}>Cancel</button>
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-2">Changes save automatically.</p>
      </div>
    </div>
  );
}

/* ---------------- Admin: division setup ---------------- */

function DivisionSetup({ division, onChange, onGenerate }) {
  const isMain = division.id === 1;

  const setSize = (size) => {
    const newTeams = defaultTeams(size).map((t, i) => division.teams[i] || t);
    onChange({ ...division, size, teams: newTeams });
  };

  const renameTeam = (idx, value) => {
    const oldName = division.teams[idx];
    const teams = division.teams.slice();
    teams[idx] = value;
    const fixtures = division.fixtures.map(f => ({
      ...f,
      home: f.home === oldName ? value : f.home,
      away: f.away === oldName ? value : f.away,
    }));
    onChange({ ...division, teams, fixtures });
  };

  const dupes = division.teams.filter((t, i) => t.trim() && division.teams.findIndex(x => x.trim().toLowerCase() === t.trim().toLowerCase()) !== i);

  return (
    <div className="rounded-xl border p-4 mb-5" style={{ borderColor: PALETTE.creamDark, backgroundColor: '#fff' }}>
      {dupes.length > 0 && (
        <p className="text-sm mb-3 rounded-md p-2" style={{ backgroundColor: '#FBEFE9', color: PALETTE.maroon }}>
          Two teams have the same name ({[...new Set(dupes)].join(', ')}). Give every team a different name, or the table won't add up.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <input
            value={division.name}
            onChange={e => onChange({ ...division, name: e.target.value })}
            className="font-bold text-base border-b bg-transparent focus:outline-none px-1"
            style={{ borderColor: PALETTE.creamDark, color: PALETTE.green }}
          />
          {!isMain && (
            <label className="flex items-center gap-1.5 text-sm ml-2">
              <input type="checkbox" checked={division.enabled} onChange={e => onChange({ ...division, enabled: e.target.checked })} />
              Active this season
            </label>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Teams:</label>
          <select
            value={division.size}
            onChange={e => setSize(Number(e.target.value))}
            className="border rounded-md px-2 py-1 text-sm"
            style={{ borderColor: PALETTE.creamDark }}
          >
            {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {(isMain || division.enabled) && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
            {division.teams.map((t, idx) => (
              <input
                key={idx}
                value={t}
                onChange={e => renameTeam(idx, e.target.value)}
                className="border rounded-md px-2 py-1.5 text-sm"
                style={{ borderColor: PALETTE.creamDark }}
              />
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onGenerate(division.id)}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold"
              style={{ backgroundColor: PALETTE.maroon, color: PALETTE.cream }}
            >
              <RefreshCw size={14} />
              {division.fixtures.length ? 'Regenerate fixtures' : 'Generate fixtures'}
            </button>
            {division.fixtures.length > 0 && (
              <span className="text-xs text-gray-500">{division.fixtures.length} matches scheduled (home &amp; away). Regenerating will erase existing dates and scores for this division.</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- Admin: results entry ---------------- */

function ResultRow({ fixture, locked, onUpdate }) {
  const res = matchResult(fixture);
  const field = (key, label) => (
    <input
      type="number"
      value={fixture[key]}
      disabled={locked}
      onChange={e => onUpdate({ ...fixture, [key]: e.target.value === '' ? '' : e.target.value })}
      placeholder={label}
      className="w-14 border rounded-md px-1.5 py-1 text-sm text-center disabled:bg-gray-100 disabled:text-gray-400"
      style={{ borderColor: PALETTE.creamDark }}
    />
  );
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr,auto] gap-2 items-center py-3 border-t" style={{ borderColor: PALETTE.creamDark }}>
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold" style={{ color: PALETTE.ink }}>{fixture.home}</span>
          <span className="text-xs text-gray-400">v</span>
          <span className="font-semibold" style={{ color: PALETTE.ink }}>{fixture.away}</span>
          {res && (
            <Pill tone={res.outcome === 'D' ? 'green' : 'maroon'}>
              {res.outcome === 'D' ? `Draw · ${res.homePts}-${res.awayPts}` : `${res.homePts}-${res.awayPts}`}
            </Pill>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-1.5">
          <CalendarDays size={14} className="text-gray-400" />
          <input
            type="date"
            value={fixture.date}
            disabled={locked}
            onChange={e => onUpdate({ ...fixture, date: e.target.value })}
            className="border rounded-md px-2 py-1 text-sm disabled:bg-gray-100 disabled:text-gray-400"
            style={{ borderColor: PALETTE.creamDark }}
          />
        </div>
      </div>
      <div className="flex items-center gap-4 flex-wrap">
        <div className="text-center">
          <div className="text-[11px] text-gray-500 mb-1">Rink 1 (Home – Away)</div>
          <div className="flex items-center gap-1">{field('h1', 'H')}<span className="text-gray-400">–</span>{field('a1', 'A')}</div>
        </div>
        <div className="text-center">
          <div className="text-[11px] text-gray-500 mb-1">Rink 2 (Home – Away)</div>
          <div className="flex items-center gap-1">{field('h2', 'H')}<span className="text-gray-400">–</span>{field('a2', 'A')}</div>
        </div>
      </div>
    </div>
  );
}

function ResultsEntry({ divisions, resultsLocked, onUpdateFixture }) {
  const activeDivisions = divisions.filter(d => d.enabled && d.fixtures.length > 0);
  const [divId, setDivId] = useState(activeDivisions[0]?.id ?? null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (!activeDivisions.find(d => d.id === divId)) setDivId(activeDivisions[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [divisions.length]);

  if (activeDivisions.length === 0) {
    return <p className="text-sm text-gray-500">Generate fixtures for a division first, then results can be entered here.</p>;
  }

  const division = activeDivisions.find(d => d.id === divId) || activeDivisions[0];
  const q = query.trim().toLowerCase();
  let list = division.fixtures.filter(f => {
    if (!q) return true;
    return f.home.toLowerCase().includes(q);
  });
  if (filter === 'unplayed') list = list.filter(f => !isPlayed(f));

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        {activeDivisions.map(d => (
          <button
            key={d.id}
            onClick={() => setDivId(d.id)}
            className="px-3 py-1.5 rounded-full text-sm font-semibold"
            style={{
              backgroundColor: d.id === division.id ? PALETTE.green : PALETTE.cream,
              color: d.id === division.id ? PALETTE.cream : PALETTE.green,
            }}
          >
            {d.name}
          </button>
        ))}
      </div>

      {resultsLocked && (
        <div className="flex items-center gap-2 rounded-md p-2.5 mb-3 text-sm" style={{ backgroundColor: '#FBEFE9', color: PALETTE.maroon }}>
          <Lock size={16} /> Results are locked. Unlock them from Settings to make changes.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex items-center gap-1.5 border rounded-md px-2.5 py-1.5 flex-1 min-w-[220px]" style={{ borderColor: PALETTE.creamDark }}>
          <Search size={15} className="text-gray-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by home team…"
            className="flex-1 text-sm focus:outline-none"
          />
          {query && <button onClick={() => setQuery('')}><X size={14} className="text-gray-400" /></button>}
        </div>
        <div className="flex gap-1.5">
          {['all', 'unplayed'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="px-2.5 py-1.5 rounded-md text-xs font-semibold capitalize"
              style={{
                backgroundColor: filter === f ? PALETTE.gold : PALETTE.cream,
                color: filter === f ? '#fff' : PALETTE.ink,
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border px-3" style={{ borderColor: PALETTE.creamDark, backgroundColor: '#fff' }}>
        {list.length === 0 && <p className="text-sm text-gray-500 py-4">No matches found.</p>}
        {list.map(f => (
          <ResultRow
            key={f.id}
            fixture={f}
            locked={resultsLocked}
            onUpdate={updated => onUpdateFixture(division.id, updated)}
          />
        ))}
      </div>
    </div>
  );
}

/* ---------------- Admin: settings ---------------- */

function PasswordSettings({ title, intro, onSave, doneText }) {
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const a = pw1.trim();
    if (a.length < 4) { setMsg({ ok: false, text: 'The new password must be at least 4 characters.' }); return; }
    if (a !== pw2.trim()) { setMsg({ ok: false, text: 'The two passwords do not match. Please type them again.' }); return; }
    setBusy(true);
    const ok = await onSave(a);
    setBusy(false);
    if (ok) { setPw1(''); setPw2(''); setMsg({ ok: true, text: doneText }); }
    else setMsg({ ok: false, text: 'Could not change the password — please try again.' });
  };

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: PALETTE.creamDark, backgroundColor: '#fff' }}>
      <h3 className="font-bold mb-2 flex items-center gap-2" style={{ color: PALETTE.green }}>
        <ShieldCheck size={16} /> {title}
      </h3>
      <p className="text-sm text-gray-600 mb-3">{intro}</p>
      <div className="grid sm:grid-cols-2 gap-2 max-w-lg">
        <div>
          <label className="block text-xs text-gray-500 mb-1">New password</label>
          <input
            type="text"
            value={pw1}
            onChange={e => { setPw1(e.target.value); setMsg(null); }}
            className="w-full border rounded-md px-2 py-1.5 text-sm"
            style={{ borderColor: PALETTE.creamDark }}
            autoComplete="off"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Type it again</label>
          <input
            type="text"
            value={pw2}
            onChange={e => { setPw2(e.target.value); setMsg(null); }}
            onKeyDown={e => { if (e.key === 'Enter') save(); }}
            className="w-full border rounded-md px-2 py-1.5 text-sm"
            style={{ borderColor: PALETTE.creamDark }}
            autoComplete="off"
          />
        </div>
      </div>
      <button
        onClick={save}
        disabled={!pw1 || !pw2 || busy}
        className="rounded-md px-3 py-1.5 text-sm font-semibold mt-3 disabled:opacity-50"
        style={{ backgroundColor: PALETTE.green, color: '#fff' }}
      >
        {busy ? 'Saving…' : 'Change password'}
      </button>
      {msg && (
        <p className="text-sm mt-3 rounded-md p-2" style={{
          backgroundColor: msg.ok ? '#EAF3EC' : '#FBEFE9',
          color: msg.ok ? PALETTE.green : PALETTE.maroon,
        }}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

function BackupsPanel({ data, auth, onBackup, onRestored, statusMsg }) {
  const [list, setList] = useState(null);
  const [restoring, setRestoring] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const [msg, setMsg] = useState(null);

  const refresh = useCallback(async () => {
    const r = await backupAction(auth, { action: 'list' });
    setList(r.ok ? r.backups : []);
  }, [auth]);

  useEffect(() => { refresh(); }, [refresh, statusMsg]);

  const label = (name) => {
    const m = name.match(/backup-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/);
    const when = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z`).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : name;
    return `${when}${name.includes('-weekly') ? ' (weekly)' : ''}`;
  };

  const restore = async () => {
    const r = await backupAction(auth, { action: 'restore', name: restoring, confirm: confirmText });
    if (r.ok) {
      setMsg({ ok: true, text: 'Backup restored. The league is now as it was at that time.' });
      setRestoring(null); setConfirmText('');
      onRestored(r.data, r.version);
    } else setMsg({ ok: false, text: r.error || 'Could not restore that backup.' });
  };

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: PALETTE.creamDark, backgroundColor: '#fff' }}>
      <h3 className="font-bold mb-2 flex items-center gap-2" style={{ color: PALETTE.green }}>
        <Download size={16} /> Backups
      </h3>
      <p className="text-sm text-gray-600 mb-1">
        Last backup: <strong>{data.lastBackup ? new Date(data.lastBackup).toLocaleString() : 'never'}</strong>
      </p>
      <p className="text-sm text-gray-600 mb-3">
        Take a backup before big changes. It keeps a copy on the server (the newest 5 are kept) and downloads one to your device.
      </p>
      <button
        onClick={onBackup}
        className="rounded-md px-3 py-1.5 text-sm font-semibold"
        style={{ backgroundColor: PALETTE.green, color: '#fff' }}
      >
        Create backup now
      </button>
      {statusMsg && <span className="ml-3 text-sm inline-flex items-center gap-1" style={{ color: PALETTE.green }}><Check size={14} /> {statusMsg}</span>}

      <div className="mt-4">
        <div className="text-sm font-semibold mb-1" style={{ color: PALETTE.ink }}>Backups on the server</div>
        {list === null && <p className="text-sm text-gray-500">Loading…</p>}
        {list && list.length === 0 && <p className="text-sm text-gray-500">None yet.</p>}
        {list && list.length > 0 && (
          <ul className="text-sm divide-y" style={{ borderColor: PALETTE.creamDark }}>
            {list.map(b => (
              <li key={b.name} className="py-1.5 flex items-center justify-between gap-2">
                <span>{label(b.name)}</span>
                <button
                  onClick={() => { setRestoring(b.name); setConfirmText(''); setMsg(null); }}
                  className="text-xs font-semibold underline"
                  style={{ color: PALETTE.maroon }}
                >
                  Restore…
                </button>
              </li>
            ))}
          </ul>
        )}
        {restoring && (
          <div className="mt-3 rounded-md p-3" style={{ backgroundColor: '#FBEFE9' }}>
            <p className="text-sm mb-2" style={{ color: PALETTE.maroon }}>
              Restoring puts the whole league back to <strong>{label(restoring)}</strong>. Anything entered since then is lost
              (take a backup first if unsure). Type RESTORE to confirm.
            </p>
            <div className="flex gap-2 flex-wrap">
              <input
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder="Type RESTORE"
                className="border rounded-md px-2 py-1 text-sm"
                style={{ borderColor: PALETTE.creamDark }}
              />
              <button
                onClick={restore}
                disabled={confirmText !== 'RESTORE'}
                className="rounded-md px-3 py-1 text-sm font-semibold disabled:opacity-50"
                style={{ backgroundColor: PALETTE.maroon, color: '#fff' }}
              >
                Restore this backup
              </button>
              <button onClick={() => setRestoring(null)} className="rounded-md px-3 py-1 text-sm font-semibold border" style={{ borderColor: PALETTE.creamDark }}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {msg && (
          <p className="text-sm mt-3 rounded-md p-2" style={{ backgroundColor: msg.ok ? '#EAF3EC' : '#FBEFE9', color: msg.ok ? PALETTE.green : PALETTE.maroon }}>
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}

function AdminSettings({ data, auth, onToggleLock, onBackup, onRestored, onReset, statusMsg, onChangeTeamPassword, onChangeAdminPassword }) {
  const [confirmStep, setConfirmStep] = useState(0);

  const startReset = () => setConfirmStep(1);
  const cancelReset = () => setConfirmStep(0);
  const confirmReset = () => { onReset(); setConfirmStep(0); };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border p-4" style={{ borderColor: PALETTE.creamDark, backgroundColor: '#fff' }}>
        <h3 className="font-bold mb-2 flex items-center gap-2" style={{ color: PALETTE.green }}>
          {data.resultsLocked ? <Lock size={16} /> : <Unlock size={16} />} Results lock
        </h3>
        <p className="text-sm text-gray-600 mb-3">
          Locking prevents any scores or dates being changed — useful once a round is finalised. You can unlock at any time.
        </p>
        <button
          onClick={onToggleLock}
          className="rounded-md px-3 py-1.5 text-sm font-semibold"
          style={{ backgroundColor: data.resultsLocked ? PALETTE.gold : PALETTE.green, color: '#fff' }}
        >
          {data.resultsLocked ? 'Unlock results' : 'Lock results'}
        </button>
      </div>

      <PasswordSettings
        title="Team leader password"
        intro="Team leaders use this to enter scores and dates. Changing it signs everyone out — remember to tell the team leaders the new one."
        onSave={onChangeTeamPassword}
        doneText="Team leader password changed. Remember to tell the team leaders the new password."
      />

      <PasswordSettings
        title="Admin password"
        intro="The password for this admin area."
        onSave={onChangeAdminPassword}
        doneText="Admin password changed."
      />

      <BackupsPanel data={data} auth={auth} onBackup={onBackup} onRestored={onRestored} statusMsg={statusMsg} />

      <div className="rounded-xl border p-4" style={{ borderColor: PALETTE.maroon, backgroundColor: '#FBEFE9' }}>
        <h3 className="font-bold mb-2 flex items-center gap-2" style={{ color: PALETTE.maroon }}>
          <AlertTriangle size={16} /> Reset for a new season
        </h3>
        <p className="text-sm mb-3" style={{ color: PALETTE.ink }}>
          This clears every fixture, date and score in all three divisions, and renames every team back to "Team 1", "Team 2"
          and so on. Division sizes, the contacts list and the passwords are kept. This cannot be undone — take a backup first.
        </p>
        {confirmStep === 0 && (
          <button onClick={startReset} className="rounded-md px-3 py-1.5 text-sm font-semibold" style={{ backgroundColor: PALETTE.maroon, color: '#fff' }}>
            <RotateCcw size={14} className="inline mr-1.5 -mt-0.5" /> Reset for new season
          </button>
        )}
        {confirmStep === 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold" style={{ color: PALETTE.maroon }}>Are you sure? This deletes all results.</span>
            <button onClick={confirmReset} className="rounded-md px-3 py-1.5 text-sm font-semibold" style={{ backgroundColor: PALETTE.maroon, color: '#fff' }}>Yes, reset everything</button>
            <button onClick={cancelReset} className="rounded-md px-3 py-1.5 text-sm font-semibold border" style={{ borderColor: PALETTE.creamDark }}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Admin shell ---------------- */

function AdminPage({ data, setData, auth, setAuth, onExit, updateFixture, onRestored }) {
  const [tab, setTab] = useState('setup');
  const [statusMsg, setStatusMsg] = useState('');

  const flash = (msg) => { setStatusMsg(msg); setTimeout(() => setStatusMsg(''), 3000); };

  // Keeps scores and dates from the latest copy of the league, so a team leader's
  // result entered at the same moment isn't overwritten by the admin's edit.
  const updateDivision = (updated) => {
    setData(d => ({
      ...d,
      divisions: d.divisions.map(x => {
        if (x.id !== updated.id) return x;
        const fixtures = updated.fixtures.map(f => {
          const cur = x.fixtures.find(c => c.id === f.id);
          return cur ? { ...cur, home: f.home, away: f.away } : f;
        });
        return { ...updated, fixtures };
      }),
    }));
  };

  const generateForDivision = (id) => {
    const div = data.divisions.find(x => x.id === id);
    if (div.fixtures.length > 0 && !window.confirm('This will erase existing dates and scores for this division. Continue?')) return;
    const fixtures = generateFixtures(div.teams);
    setData(d => ({ ...d, divisions: d.divisions.map(x => x.id === id ? { ...x, fixtures } : x) }));
    flash('Fixtures generated');
  };

  const toggleLock = () => setData(d => ({ ...d, resultsLocked: !d.resultsLocked }));

  const backupNow = async () => {
    const stamp = new Date().toISOString();
    const r = await backupAction(auth, { action: 'run' });
    if (!r.ok) { flash('Backup failed on the server — your download below is still a copy'); }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `welwyn-hatfield-bowls-backup-${stamp.slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setData(d => ({ ...d, lastBackup: stamp }));
    flash('Backup created and downloaded');
  };

  const resetForNewYear = () => {
    setData(d => ({
      ...d,
      resultsLocked: false,
      divisions: d.divisions.map(div => ({ ...div, teams: defaultTeams(div.size), fixtures: [] })),
    }));
    flash('League reset for the new season');
  };

  const TABS = [
    { id: 'setup', label: 'Divisions & teams', icon: Users },
    { id: 'results', label: 'Enter results', icon: ClipboardList },
    { id: 'contacts', label: 'Contacts', icon: BookUser },
    { id: 'settings', label: 'Settings', icon: Settings2 },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex gap-2 flex-wrap">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold"
              style={{
                backgroundColor: tab === t.id ? PALETTE.maroon : PALETTE.cream,
                color: tab === t.id ? '#fff' : PALETTE.ink,
              }}
            >
              <t.icon size={14} /> {t.label}
            </button>
          ))}
        </div>
        <button onClick={onExit} className="inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: PALETTE.green }}>
          <LogOut size={14} /> Exit admin
        </button>
      </div>

      {tab === 'setup' && (
        <div>
          <p className="text-sm text-gray-600 mb-4">Set the number of teams and enter team names for each division, then generate the fixture list. You can rename a team at any time — its past results move with it.</p>
          {data.divisions.map(div => (
            <DivisionSetup key={div.id} division={div} onChange={updateDivision} onGenerate={generateForDivision} />
          ))}
        </div>
      )}

      {tab === 'results' && (
        <ResultsEntry divisions={data.divisions} resultsLocked={data.resultsLocked} onUpdateFixture={updateFixture} />
      )}

      {tab === 'contacts' && (
        <ContactsAdmin contacts={data.contacts || []} onChange={contacts => setData(d => ({ ...d, contacts }))} />
      )}

      {tab === 'settings' && (
        <AdminSettings
          data={data}
          onToggleLock={toggleLock}
          onBackup={backupNow}
          onReset={resetForNewYear}
          statusMsg={statusMsg}
          auth={auth}
          onRestored={onRestored}
          onChangeTeamPassword={async pw => (await changePassword(auth, 'team', pw)).ok}
          onChangeAdminPassword={async pw => {
            const ok = (await changePassword(auth, 'admin', pw)).ok;
            if (ok) setAuth({ role: 'admin', password: pw });
            return ok;
          }}
        />
      )}
    </div>
  );
}

/* ---------------- App root ---------------- */

export default function App() {
  const [data, setDataRaw] = useState(null);
  const [page, setPage] = useState('public');
  const [adminAuth, setAdminAuth] = useState(null);
  const [teamAuth, setTeamAuth] = useState(null);
  const authed = !!adminAuth;
  const teamAuthed = !!teamAuth;
  const [loadError, setLoadError] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const editingRef = useRef(false);

  // How saving works: `server` is the last copy of the league the server confirmed
  // (with its version). Each change is kept as a small step ("put this score in")
  // and sent on top of the latest server copy. If someone else saved in between,
  // the server says so, and the steps are simply re-applied to their newer copy —
  // so two people entering different results never wipe each other out.
  const server = useRef({ data: null, version: null });
  const pending = useRef([]);
  const flushTimer = useRef(null);
  const flushing = useRef(false);
  const authRef = useRef(null);
  authRef.current = adminAuth || teamAuth;

  const applyPending = (base) => pending.current.reduce((d, step) => step(d), base);

  const flush = useCallback(async () => {
    if (flushing.current || pending.current.length === 0) return;
    flushing.current = true;
    try {
      for (let attempt = 0; attempt < 4 && pending.current.length; attempt++) {
        const steps = pending.current.slice();
        const next = steps.reduce((d, step) => step(d), server.current.data);
        const r = await putData(next, server.current.version, authRef.current);
        if (r.status === 200) {
          server.current = { data: next, version: r.body.version };
          pending.current = pending.current.slice(steps.length);
          setSyncMsg('');
          continue;
        }
        if (r.status === 409) {
          // Someone else saved first: build on their copy and try again.
          server.current = { data: r.body.data, version: r.body.version };
          setDataRaw(applyPending(r.body.data));
          continue;
        }
        // Refused or failed: drop these changes and show the league as the server has it.
        pending.current = [];
        setDataRaw(server.current.data);
        setSyncMsg(
          r.status === 423 ? 'Results are locked — your change was not saved.'
          : r.status === 403 ? 'Team leaders can only enter scores and dates — that change was not saved.'
          : r.status === 401 ? 'The password has changed — please sign in again. Your change was not saved.'
          : 'Could not save — check your connection. Your last change was not saved.'
        );
        if (r.status === 401) { setAdminAuth(null); setTeamAuth(null); }
        break;
      }
    } finally {
      flushing.current = false;
      if (pending.current.length) flushTimer.current = setTimeout(flush, 300);
    }
  }, []);

  const setData = useCallback((updater) => {
    const step = typeof updater === 'function' ? updater : () => updater;
    pending.current.push(step);
    setDataRaw(prev => step(prev));
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(flush, 400);
  }, [flush]);

  const load = useCallback(async () => {
    try {
      const { data: loaded, version } = await loadData();
      // Nothing saved yet: start from a blank league (saved once the admin makes a change).
      const d = loaded || defaultData();
      server.current = { data: d, version };
      setDataRaw(d);
      setLoadError(false);
    } catch (e) {
      // Never treat a failed load as an empty league.
      setLoadError(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const interval = setInterval(async () => {
      if (editingRef.current || pending.current.length || flushing.current) return;
      try {
        const { data: fresh, version } = await loadData();
        if (fresh && version !== server.current.version && !pending.current.length) {
          server.current = { data: fresh, version };
          setDataRaw(fresh);
        }
      } catch (e) {
        // try again next time
      }
    }, 7000);
    return () => clearInterval(interval);
  }, []);

  const onRestored = useCallback((restored, version) => {
    pending.current = [];
    server.current = { data: restored, version };
    setDataRaw(restored);
  }, []);

  const updateFixture = useCallback((divId, updatedFixture) => {
    // Only this match's scores and date are carried over, onto the latest copy.
    const { date, h1, a1, h2, a2 } = updatedFixture;
    setData(d => ({
      ...d,
      divisions: d.divisions.map(div => div.id !== divId ? div : {
        ...div,
        fixtures: div.fixtures.map(f => f.id === updatedFixture.id ? { ...f, date, h1, a1, h2, a2 } : f),
      }),
    }));
  }, [setData]);

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: PALETTE.creamDark, fontFamily: "'Inter', system-ui, sans-serif" }}
      onFocusCapture={() => { editingRef.current = true; }}
      onBlurCapture={() => { setTimeout(() => { editingRef.current = false; }, 300); }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700;9..144,900&family=Inter:wght@400;500;600;700&display=swap');
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { opacity: 1; }
      `}</style>

      <header style={{ backgroundColor: PALETTE.green }}>
        <div className="max-w-5xl mx-auto px-4 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo />
            <div>
              <h1
                className="text-xl sm:text-2xl font-bold leading-tight"
                style={{ color: PALETTE.cream, fontFamily: "'Fraunces', serif" }}
              >
                Welwyn Hatfield Bowls League
              </h1>
            </div>
          </div>
          <nav className="flex gap-2">
            <button
              onClick={() => setPage('public')}
              className="px-3 py-1.5 rounded-full text-sm font-semibold"
              style={{
                backgroundColor: page === 'public' ? PALETTE.cream : 'transparent',
                color: page === 'public' ? PALETTE.green : PALETTE.cream,
                border: `1px solid ${PALETTE.cream}`,
              }}
            >
              League tables
            </button>
            <button
              onClick={() => setPage('scores')}
              className="px-3 py-1.5 rounded-full text-sm font-semibold"
              style={{
                backgroundColor: page === 'scores' ? PALETTE.cream : 'transparent',
                color: page === 'scores' ? PALETTE.green : PALETTE.cream,
                border: `1px solid ${PALETTE.cream}`,
              }}
            >
              Team leaders
            </button>
            <button
              onClick={() => setPage('admin')}
              className="px-3 py-1.5 rounded-full text-sm font-semibold"
              style={{
                backgroundColor: page === 'admin' ? PALETTE.cream : 'transparent',
                color: page === 'admin' ? PALETTE.green : PALETTE.cream,
                border: `1px solid ${PALETTE.cream}`,
              }}
            >
              Admin
            </button>
          </nav>
        </div>
      </header>
      <RinkDivider />

      <main className="max-w-5xl mx-auto px-4 pb-16">
        {syncMsg && (
          <div className="rounded-md p-3 mb-4 text-sm flex items-center justify-between gap-2" style={{ backgroundColor: '#FBEFE9', color: PALETTE.maroon }}>
            <span><AlertTriangle size={14} className="inline mr-1 -mt-0.5" /> {syncMsg}</span>
            <button onClick={() => setSyncMsg('')} aria-label="Dismiss"><X size={14} /></button>
          </div>
        )}
        {!data && !loadError && (
          <p className="text-center py-20 text-gray-500">Loading league data…</p>
        )}
        {!data && loadError && (
          <div className="text-center py-20">
            <p className="text-gray-600 mb-3">The league tables couldn't be loaded just now.</p>
            <button onClick={load} className="rounded-md px-3 py-1.5 text-sm font-semibold" style={{ backgroundColor: PALETTE.green, color: '#fff' }}>
              <RefreshCw size={14} className="inline mr-1.5 -mt-0.5" /> Try again
            </button>
          </div>
        )}
        {data && page === 'public' && <PublicPage data={data} />}
        {data && page === 'scores' && (
          teamAuthed
            ? <TeamLeaderPage data={data} resultsLocked={data.resultsLocked} onUpdateFixture={updateFixture} />
            : <>
                <PasswordGate
                  onSuccess={setTeamAuth}
                  role="team"
                  title="Team leader sign-in"
                  helpText="Share this password with team leaders so they can enter their own rink scores and match dates. It doesn't allow access to team setup, locking or backups."
                />
                {(data.contacts || []).length > 0 && (
                  <div className="mt-10">
                    <ContactsDirectory contacts={data.contacts} title="Team leaders & committee contacts" />
                  </div>
                )}
              </>
        )}
        {data && page === 'admin' && (
          authed
            ? <AdminPage data={data} setData={setData} auth={adminAuth} setAuth={setAdminAuth} onRestored={onRestored}
                onExit={() => { setAdminAuth(null); setPage('public'); }} updateFixture={updateFixture} />
            : <PasswordGate
                onSuccess={setAdminAuth}
                role="admin"
                title="Admin sign-in"
                helpText="Only the league admin can change teams, fixtures, contacts, the lock and backups."
              />
        )}
      </main>

      <footer className="text-center text-xs py-6" style={{ color: PALETTE.green, opacity: 0.7 }}>
        Welwyn Hatfield Bowls League · tables update automatically as results are entered
      </footer>
    </div>
  );
}
