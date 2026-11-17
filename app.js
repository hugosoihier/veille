(() => {
  'use strict';

  const page = document.body.dataset.page;
  const DAY = 864e5;
  const TZ = 'Europe/Paris';
  const REFRESH_MS = 5 * 60 * 1000;
  const WEATHER_MS = 15 * 60 * 1000;
  const IDLE_RETURN_MS = 3 * 60 * 1000;
  const RELOAD_HOME_MS = 6 * 3600 * 1000; // récupère les nouvelles versions de l'appli
  const STALE_HOURS = 3;
  const APP_VERSION = '2.2';
  const PLACE = { name: 'Alençon', lat: 48.4329, lon: 0.0918 };

  const TYPES = {
    alerte: 'Alerte CERT-FR',
    kev: 'Faille exploitée',
    avis: 'Avis CERT-FR',
    cti: 'Menace / incident',
    vuln: 'Vulnérabilité',
    actualite: 'Actualité CERT-FR',
  };
  const TYPE_WEIGHT = { alerte: 50, kev: 40, cti: 25, avis: 20, vuln: 15, actualite: 10 };

  const DEFAULT_TITLE = 'Tableau de bord · Veille';
  // Liste de départ volontairement générique : à adapter dans Réglages (reste sur la tablette).
  const DEFAULT_WATCH = {
    'Postes et bureautique': ['Windows', 'Microsoft Office', 'Office', 'Microsoft 365', 'Outlook', 'Edge', 'Adobe Acrobat', '7-Zip'],
    'Navigateurs et messagerie': ['Firefox', 'Thunderbird', 'Mozilla', 'Chrome', 'Chromium'],
    'Serveurs et annuaire': ['Windows Server', 'Active Directory', 'Exchange', 'SharePoint', 'Hyper-V', 'Apache', 'nginx', 'OpenSSL', 'OpenSSH', 'Samba'],
    'Réseau et sécurité': ['Fortinet', 'FortiGate', 'FortiOS', 'Cisco', 'Palo Alto', 'Ivanti', 'Citrix', 'NetScaler', 'SonicWall', 'pfSense', 'OPNsense', 'OpenVPN'],
    'Virtualisation et sauvegarde': ['VMware', 'ESXi', 'vCenter', 'Proxmox', 'Veeam', 'Synology', 'QNAP'],
    'Supervision et outils': ['Centreon', 'Zabbix', 'Nagios', 'GLPI', 'Grafana', 'TeamViewer', 'AnyDesk'],
  };

  const WMO = {
    0: ['Ciel dégagé', '☀️'], 1: ['Plutôt dégagé', '🌤️'], 2: ['Partiellement nuageux', '⛅'], 3: ['Couvert', '☁️'],
    45: ['Brouillard', '🌫️'], 48: ['Brouillard givrant', '🌫️'],
    51: ['Bruine légère', '🌦️'], 53: ['Bruine', '🌦️'], 55: ['Bruine dense', '🌦️'], 56: ['Bruine verglaçante', '🌧️'], 57: ['Bruine verglaçante', '🌧️'],
    61: ['Pluie faible', '🌧️'], 63: ['Pluie', '🌧️'], 65: ['Pluie forte', '🌧️'], 66: ['Pluie verglaçante', '🌧️'], 67: ['Pluie verglaçante', '🌧️'],
    71: ['Neige faible', '🌨️'], 73: ['Neige', '🌨️'], 75: ['Neige forte', '🌨️'], 77: ['Grains de neige', '🌨️'],
    80: ['Averses', '🌦️'], 81: ['Averses', '🌦️'], 82: ['Fortes averses', '🌧️'], 85: ['Averses de neige', '🌨️'], 86: ['Averses de neige', '🌨️'],
    95: ['Orage', '⛈️'], 96: ['Orage et grêle', '⛈️'], 99: ['Orage et grêle', '⛈️'],
  };
  const wmo = (code) => WMO[code] || ['—', '🌡️'];

  const $ = (sel) => document.querySelector(sel);

  // Tout le texte venant des flux passe par textContent : aucune injection HTML possible.
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const fmtDateTime = (d) => d.toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ });
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function ago(d) {
    const min = Math.round((Date.now() - d) / 60000);
    if (min < 1) return "à l'instant";
    if (min < 60) return `il y a ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `il y a ${h} h`;
    return `il y a ${Math.round(h / 24)} j`;
  }

  /* ---------- réglages (stockés sur la tablette uniquement) ---------- */

  const SETTINGS_KEY = 'veille.settings';

  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      const watch = s.watch && typeof s.watch === 'object' && Object.keys(s.watch).length ? s.watch : DEFAULT_WATCH;
      return { title: (s.title || '').trim() || DEFAULT_TITLE, watch, theme: s.theme === 'dark' ? 'dark' : 'light' };
    } catch (e) {
      return { title: DEFAULT_TITLE, watch: DEFAULT_WATCH, theme: 'light' };
    }
  }

  // Ne modifie que les clés données : les autres réglages restent tels quels.
  function patchSettings(patch) {
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch (e) { raw = {}; }
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...raw, ...patch })); return true; } catch (e) { return false; }
  }

  function parseWatch(text) {
    const watch = {};
    text.split('\n').forEach((line) => {
      const i = line.indexOf(':');
      if (i < 1) return;
      const words = line.slice(i + 1).split(',').map((w) => w.trim()).filter(Boolean);
      if (words.length) watch[line.slice(0, i).trim()] = words;
    });
    return watch;
  }

  const watchToText = (watch) => Object.entries(watch).map(([g, w]) => `${g}: ${w.join(', ')}`).join('\n');

  const SETTINGS = loadSettings();
  $('#brand').textContent = SETTINGS.title;
  document.documentElement.dataset.theme = SETTINGS.theme;

  /* ---------- repérage du périmètre ---------- */

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function compileWatch(watch) {
    const out = [];
    Object.entries(watch).forEach(([group, words]) => {
      words.forEach((word) => {
        out.push({ group, word, re: new RegExp('(?<![\\p{L}\\p{N}_])' + escapeRe(word) + '(?![\\p{L}\\p{N}_])', 'iu') });
      });
    });
    return out;
  }

  const WATCH = compileWatch(SETTINGS.watch);

  function findMatches(it) {
    const text = `${it.title} ${it.summary} ${it.title_fr || ''} ${it.summary_fr || ''}`;
    const seen = new Set();
    const out = [];
    WATCH.forEach((w) => {
      const key = w.group + '|' + w.word.toLowerCase();
      if (!seen.has(key) && w.re.test(text)) { seen.add(key); out.push({ group: w.group, keyword: w.word }); }
    });
    return out;
  }

  function scoreOf(it) {
    let s = TYPE_WEIGHT[it.type] || 10;
    if (it.matches.length) s += 35;
    if (it.ransomware) s += 10;
    const ageDays = Math.max(0, (Date.now() - it._d) / DAY);
    return s - Math.min(ageDays * 3, 30);
  }

  /* ---------- données ---------- */

  let DATA = null;
  let SEC = [];
  let NEWS = [];
  let LOAD_ERROR = {};

  async function load() {
    try {
      const res = await fetch('data.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) { LOAD_ERROR = { status: res.status }; throw new Error('http'); }
      LOAD_ERROR = {};
      const d = await res.json();
      d.items.forEach((i) => { i._d = new Date(i.date); i.matches = i.type === 'news' ? [] : findMatches(i); });
      DATA = d;
      SEC = d.items.filter((i) => i.type !== 'news');
      NEWS = d.items.filter((i) => i.type === 'news').sort((a, b) => b._d - a._d);
    } catch (e) {
      // on garde les dernières données déjà affichées
    }
    render();
  }

  /* ---------- messages quand il n'y a rien à afficher ---------- */

  function notice(title, lines) {
    const li = el('li', 'notice');
    li.append(el('div', 'n-title', title));
    lines.forEach((l) => li.append(el('div', 'n-line', l)));
    return li;
  }

  function noDataNode() {
    if (location.protocol === 'file:') {
      return notice('Page ouverte comme un fichier local', [
        "Ouvrez l'adresse https://…github.io/… dans Chrome. Une page ouverte depuis le disque ne peut pas charger les données.",
      ]);
    }
    if (LOAD_ERROR.status === 404) {
      return notice('Fichier de données introuvable (data.json)', [
        "La première collecte n'a pas encore eu lieu, ou elle a échoué.",
        'Sur GitHub : onglet Actions → « Mise à jour des données de veille » → Run workflow.',
        'Vérifiez aussi Settings → Actions → General → Workflow permissions : « Read and write permissions ».',
        'Attendez une minute, puis rouvrez l’appli.',
      ]);
    }
    return notice('Données non chargées', [
      'Vérifiez la connexion de la tablette (Wi-Fi ou carte SIM).',
      LOAD_ERROR.status ? `Réponse du serveur : ${LOAD_ERROR.status}` : 'Aucune réponse du serveur.',
    ]);
  }

  function noItemsNode() {
    const failed = Object.entries((DATA && DATA.status) || {}).filter(([, s]) => !s.ok).slice(0, 4);
    const lines = failed.map(([n, s]) => `${n} : ${s.error || 'échec'}`);
    lines.push('Détail de chaque source : Réglages → Données et application.');
    return notice('Aucun article reçu des sources', lines);
  }

  /* ---------- briques communes ---------- */

  const within = (it, days) => Date.now() - it._d < days * DAY;
  const tTitle = (it) => it.title_fr || it.title;
  const tSummary = (it) => it.summary_fr || it.summary;
  const tAction = (it) => it.action_fr || it.action;
  const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);
  const badge = (text, cls) => el('span', 'badge ' + cls, text);

  function itemNode(it) {
    const li = el('li', 'item t-' + it.type);
    li.tabIndex = 0;
    li.append(el('div', 'title', tTitle(it)));
    const meta = el('div', 'meta');
    meta.append(badge(it.type === 'news' ? it.source : (TYPES[it.type] || it.type), 'b-' + it.type));
    if (it.ransomware) meta.append(badge('Rançongiciel connu', 'b-ransom'));
    if (it.lang === 'en' && !it.title_fr) meta.append(badge('En anglais', 'b-actualite'));
    if (it.matches && it.matches.length) {
      const names = [...new Set(it.matches.map((m) => m.keyword))].slice(0, 3).join(', ');
      meta.append(badge('Périmètre : ' + names, 'b-match'));
    }
    meta.append(el('span', '', ago(it._d)));
    li.append(meta);
    li.addEventListener('click', () => openModal(it));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') openModal(it); });
    return li;
  }

  function fillList(ul, items, emptyText, kind) {
    if (!ul) return;
    ul.replaceChildren();
    if (!items.length) {
      if (kind === 'sec' && !DATA) ul.append(noDataNode());
      else if (kind === 'sec' && !SEC.length) ul.append(noItemsNode());
      else ul.append(el('li', 'empty', emptyText));
      return;
    }
    items.forEach((it) => ul.append(itemNode(it)));
  }

  function renderStatusBar() {
    const stale = $('#stale');
    const foot = $('#foot');
    foot.replaceChildren();
    if (!DATA) {
      stale.hidden = false;
      stale.textContent = 'Données indisponibles · vérifier la connexion';
      return;
    }
    const last = new Date(DATA.last_success || DATA.generated);
    const hours = (Date.now() - last) / 36e5;
    stale.hidden = hours < STALE_HOURS;
    if (!stale.hidden) stale.textContent = `Données vieilles de ${Math.round(hours)} h · vérifier la connexion`;
    foot.append(el('span', '', 'Dernière mise à jour : ' + fmtDateTime(last)));
    const entries = Object.entries(DATA.status || {});
    const bad = entries.filter(([, s]) => !s.ok);
    foot.append(el('span', bad.length ? 'bad' : '', bad.length
      ? `Sources en échec : ${bad.map(([n]) => n).join(' · ')}`
      : `${entries.length} sources actives`));
  }

  /* ---------- fenêtre de détail ---------- */

  function openModal(it) {
    const body = $('#modal-body');
    body.replaceChildren();
    body.append(el('h3', '', tTitle(it)));
    const row = el('div', 'row');
    row.append(badge(it.type === 'news' ? it.source : (TYPES[it.type] || it.type), 'b-' + it.type));
    if (it.ransomware) row.append(badge('Utilisée par des rançongiciels', 'b-ransom'));
    row.append(el('span', '', fmtDateTime(it._d)));
    if (it.type !== 'news') row.append(el('span', '', '· ' + it.source));
    body.append(row);
    if (it.title_fr && it.title_fr !== it.title) body.append(el('div', 'orig', 'Titre original : ' + it.title));
    if (it.matches && it.matches.length) {
      const m = el('div', 'row');
      it.matches.forEach((x) => m.append(badge(`${x.keyword} · ${x.group}`, 'b-match')));
      body.append(m);
    }
    body.append(el('h4', '', 'Résumé'));
    body.append(el('p', '', tSummary(it) || 'Pas de résumé fourni par la source.'));
    if (it.action) {
      body.append(el('h4', '', 'Action recommandée'));
      body.append(el('p', '', tAction(it)));
    }
    if (it.cve && it.cve.length) {
      const c = el('div', 'cves');
      it.cve.slice(0, 12).forEach((id) => c.append(el('span', '', id)));
      body.append(c);
    }
    if (it.title_fr || it.summary_fr) {
      body.append(el('div', 'note', "Traduit automatiquement de l'anglais : la traduction peut être imparfaite."));
    } else if (it.lang === 'en') {
      body.append(el('div', 'note', 'Texte en anglais : la traduction arrive à la prochaine mise à jour.'));
    }
    if (isHttp(it.link)) {
      const actions = el('div', 'modal-actions');
      const a = el('a', 'btn primary linkbtn', 'Lien');
      a.href = it.link;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      actions.append(a);
      body.append(actions);
    }
    $('#modal').hidden = false;
  }

  const closeModal = () => { $('#modal').hidden = true; };
  $('#close').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  /* ---------- météo (Open-Meteo, direct depuis la tablette) ---------- */

  let WX = null;
  const WX_KEY = 'veille.wx';

  async function loadWeather() {
    if (!$('#weather') && !$('#wx-full')) return;
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${PLACE.lat}&longitude=${PLACE.lon}`
      + '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,precipitation'
      + '&hourly=temperature_2m,weather_code,precipitation_probability'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset,uv_index_max'
      + '&timezone=Europe%2FParis&forecast_days=6&wind_speed_unit=kmh';
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(r.status);
      WX = await r.json();
      WX.fetched = Date.now();
      try { localStorage.setItem(WX_KEY, JSON.stringify(WX)); } catch (e) { /* ignoré */ }
    } catch (e) {
      try { WX = JSON.parse(localStorage.getItem(WX_KEY) || 'null'); } catch (e2) { WX = null; }
    }
    renderWeather();
  }

  function hourIndex() {
    const key = WX.current.time.slice(0, 13) + ':00';
    const i = WX.hourly.time.findIndex((t) => t >= key);
    return i < 0 ? 0 : i;
  }

  const hh = (t) => t.slice(11, 13) + ' h';
  const dayName = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', timeZone: TZ });

  function hourCell(i) {
    const c = el('div', 'hour');
    c.append(el('b', '', hh(WX.hourly.time[i])), el('div', 'ic', wmo(WX.hourly.weather_code[i])[1]),
      document.createTextNode(`${Math.round(WX.hourly.temperature_2m[i])}°`));
    const p = WX.hourly.precipitation_probability[i];
    if (p >= 20) c.append(el('div', 'pp', `${p} %`));
    return c;
  }

  function staleNote() {
    const h = (Date.now() - (WX.fetched || 0)) / 36e5;
    return h > STALE_HOURS ? el('div', 'stale-note', `Météo mise à jour il y a ${Math.round(h)} h`) : null;
  }

  function renderWeather() {
    const compact = $('#weather');
    const full = $('#wx-full');
    [compact, full].forEach((b) => b && b.replaceChildren());
    if (!WX) {
      if (compact) compact.append(el('div', 'meta', 'Météo indisponible'));
      if (full) full.append(el('h2', '', 'Météo indisponible'));
      return;
    }
    const cur = WX.current;
    const [label, icon] = wmo(cur.weather_code);
    const start = hourIndex();

    if (compact) {
      const now = el('div', 'now');
      const info = el('div');
      info.append(el('div', 'temp', `${Math.round(cur.temperature_2m)}°C`),
        el('div', 'meta', `${PLACE.name} · ${label} · vent ${Math.round(cur.wind_speed_10m)} km/h`));
      now.append(el('div', 'icon', icon), info);
      const hours = el('div', 'hours');
      for (let i = start + 1; i <= start + 6 && i < WX.hourly.time.length; i++) hours.append(hourCell(i));
      compact.append(now, hours);
      const note = staleNote();
      if (note) compact.append(note);
    }

    if (full) {
      full.append(el('h2', '', `Météo · ${PLACE.name}`));
      const grid = el('div', 'wx-grid');
      const left = el('div');
      const now = el('div', 'wx-now');
      const info = el('div');
      info.append(el('div', 'temp', `${Math.round(cur.temperature_2m)}°C`), el('div', 'meta', label));
      now.append(el('div', 'icon', icon), info);
      const facts = el('div', 'wx-facts');
      const add = (k, v) => { const f = el('div', 'fact'); f.append(el('div', 'k', k), el('div', 'v', v)); facts.append(f); };
      add('Ressenti', `${Math.round(cur.apparent_temperature)}°C`);
      add('Vent', `${Math.round(cur.wind_speed_10m)} km/h`);
      add('Rafales', `${Math.round(cur.wind_gusts_10m)} km/h`);
      add('Précipitations', `${cur.precipitation} mm`);
      add('Lever du soleil', WX.daily.sunrise[0].slice(11, 16));
      add('Coucher du soleil', WX.daily.sunset[0].slice(11, 16));
      add('Indice UV max', String(Math.round(WX.daily.uv_index_max[0])));
      add("Pluie aujourd'hui", `${WX.daily.precipitation_sum[0]} mm`);
      left.append(now, facts);

      const right = el('div');
      right.append(el('div', 'hint', 'Prochaines 24 heures'));
      const sc = el('div', 'scroller');
      for (let i = start; i < start + 24 && i < WX.hourly.time.length; i++) sc.append(hourCell(i));
      right.append(sc);
      const days = el('div', 'days');
      WX.daily.time.forEach((d, i) => {
        const row = el('div', 'day');
        row.append(el('span', 'd', i === 0 ? "Aujourd'hui" : dayName(d)), el('span', '', wmo(WX.daily.weather_code[i])[1]),
          el('span', 'r', wmo(WX.daily.weather_code[i])[0] + (WX.daily.precipitation_sum[i] >= 0.5 ? ` · ${WX.daily.precipitation_sum[i]} mm` : '')),
          el('span', '', `${Math.round(WX.daily.temperature_2m_min[i])}° / ${Math.round(WX.daily.temperature_2m_max[i])}°`));
        days.append(row);
      });
      right.append(days);
      grid.append(left, right);
      full.append(grid);
      const note = staleNote();
      if (note) full.append(note);
    }
  }

  /* ---------- calendrier : jours fériés, Patch Tuesday ---------- */

  function parisToday() {
    const [y, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: TZ }).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(y, month - 1, day));
  }

  function holidays(y) {
    const e = easter(y);
    const add = (n) => new Date(e.getTime() + n * DAY);
    const fixed = (m, d) => new Date(Date.UTC(y, m - 1, d));
    return [
      ['Jour de l’An', fixed(1, 1)], ['Lundi de Pâques', add(1)], ['Fête du Travail', fixed(5, 1)],
      ['Victoire 1945', fixed(5, 8)], ['Ascension', add(39)], ['Lundi de Pentecôte', add(50)],
      ['Fête nationale', fixed(7, 14)], ['Assomption', fixed(8, 15)], ['Toussaint', fixed(11, 1)],
      ['Armistice 1918', fixed(11, 11)], ['Noël', fixed(12, 25)],
    ];
  }

  function secondTuesday(y, m) {
    const dow = new Date(Date.UTC(y, m, 1)).getUTCDay();
    return new Date(Date.UTC(y, m, 1 + ((2 - dow + 7) % 7) + 7));
  }

  function nextPatchTuesday(today) {
    let y = today.getUTCFullYear(), m = today.getUTCMonth();
    let d = secondTuesday(y, m);
    if (d < today) { m += 1; if (m > 11) { m = 0; y += 1; } d = secondTuesday(y, m); }
    return d;
  }

  function whenText(date, today) {
    const n = Math.round((date - today) / DAY);
    if (n === 0) return "aujourd'hui";
    if (n === 1) return 'demain';
    return `dans ${n} j`;
  }

  function renderDeadlines() {
    const ul = $('#deadlines');
    if (!ul) return;
    ul.replaceChildren();
    const today = parisToday();
    const y = today.getUTCFullYear();
    const events = [['Patch Tuesday Microsoft', nextPatchTuesday(today), 'Correctifs mensuels']];
    [...holidays(y), ...holidays(y + 1)].filter(([, d]) => d >= today).slice(0, 3)
      .forEach(([n, d]) => events.push([n, d, 'Jour férié']));
    events.sort((a, b) => a[1] - b[1]).forEach(([name, date, sub]) => {
      const li = el('li');
      const grow = el('div', 'grow');
      grow.append(el('div', '', name), el('div', 'sub', cap(date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })) + ' · ' + sub));
      li.append(grow, el('span', 'when', whenText(date, today)));
      ul.append(li);
    });
  }

  /* ---------- état des services ---------- */

  const SERVICE_TEXT = {
    none: 'Tous les systèmes sont opérationnels',
    minor: 'Perturbation mineure',
    major: 'Panne majeure',
    critical: 'Panne critique',
    maintenance: 'Maintenance en cours',
  };

  function renderServices() {
    const ul = $('#services');
    if (!ul) return;
    ul.replaceChildren();
    const list = (DATA && DATA.services) || [];
    if (!list.length) { ul.append(el('li', 'empty', 'Aucune donnée.')); return; }
    list.forEach((s) => {
      const cls = s.indicator === 'none' ? 'ok' : (s.indicator === 'minor' || s.indicator === 'maintenance') ? 'warn' : (s.indicator === 'major' || s.indicator === 'critical') ? 'bad' : '';
      const li = el('li');
      const grow = el('div', 'grow');
      grow.append(el('div', '', s.name), el('div', 'sub', SERVICE_TEXT[s.indicator] || 'Statut inconnu'));
      li.append(el('span', 'dot ' + cls), grow);
      ul.append(li);
    });
  }

  /* ---------- actualités ---------- */

  function renderNews() {
    const strip = $('#news');
    if (!strip) return;
    if (page === 'home') {
      strip.replaceChildren();
      if (!NEWS.length) { strip.append(el('li', 'empty', 'Aucune actualité.')); return; }
      NEWS.slice(0, 6).forEach((it) => {
        const li = el('li', 'news');
        li.tabIndex = 0;
        li.append(el('div', 'src', it.source), el('div', 't', tTitle(it)), el('div', 'ago', ago(it._d)));
        li.addEventListener('click', () => openModal(it));
        strip.append(li);
      });
    } else {
      fillList(strip, NEWS.slice(0, 40), 'Aucune actualité.');
    }
  }

  /* ---------- accueil ---------- */

  function tick() {
    const now = new Date();
    $('#time').textContent = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
    $('#date').textContent = cap(now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }));
  }

  function renderLevel() {
    const box = $('#level');
    box.replaceChildren();
    let cls = 'ok', label = 'Rien à signaler', why = 'Aucune alerte récente ne concerne les logiciels suivis.';
    if (!DATA || !SEC.length) {
      cls = 'warn'; label = 'Pas de données';
      why = DATA ? "Aucune source n'a répondu : voir le détail plus bas." : 'Connexion ou première mise à jour en attente.';
    }
    const critical = SEC.filter((i) => i.type === 'alerte' && i.matches.length && within(i, 2));
    const recentAlert = SEC.filter((i) => i.type === 'alerte' && within(i, 3));
    const kevHits = SEC.filter((i) => i.type === 'kev' && i.matches.length && within(i, 7));
    if (critical.length) {
      cls = 'crit'; label = 'Alerte sur le périmètre';
      why = `${plural(critical.length, 'alerte CERT-FR', 'alertes CERT-FR')} de moins de 48 h concerne des logiciels suivis.`;
    } else if (recentAlert.length || kevHits.length) {
      cls = 'warn'; label = 'Vigilance';
      why = recentAlert.length
        ? `${plural(recentAlert.length, 'alerte CERT-FR', 'alertes CERT-FR')} ces 3 derniers jours.`
        : `${plural(kevHits.length, 'faille exploitée', 'failles exploitées')} touche des logiciels suivis.`;
    }
    box.className = 'level ' + cls;
    box.append(el('div', 'tag', 'Niveau de veille'), el('div', 'label', label), el('div', 'why', why));
  }

  function renderKpis() {
    const box = $('#kpis');
    box.replaceChildren();
    const week = SEC.filter((i) => within(i, 7));
    [
      ['k-alerte', week.filter((i) => i.type === 'alerte').length, 'Alertes CERT-FR · 7 jours', 'veille.html?type=alerte&period=7'],
      ['k-avis', week.filter((i) => i.type === 'avis').length, 'Avis de sécurité · 7 jours', 'veille.html?type=avis&period=7'],
      ['k-kev', week.filter((i) => i.type === 'kev').length, 'Failles exploitées ajoutées · 7 jours', 'veille.html?type=kev&period=7'],
      ['k-match', week.filter((i) => i.matches.length).length, 'Concernent nos logiciels · 7 jours', 'veille.html?match=1&period=7'],
    ].forEach(([cls, n, label, href]) => {
      const a = el('a', 'kpi ' + cls);
      a.href = href;
      a.append(el('div', 'n', String(n)), el('div', 'l', label));
      box.append(a);
    });
  }

  function renderHome() {
    renderLevel();
    renderKpis();
    const top = SEC.filter((i) => within(i, 7)).sort((a, b) => scoreOf(b) - scoreOf(a)).slice(0, 6);
    fillList($('#top'), top, 'Rien de marquant cette semaine.', 'sec');
    renderDeadlines();
    renderServices();
    renderNews();
  }

  /* ---------- veille ---------- */

  const params = new URLSearchParams(location.search);
  const state = {
    type: params.get('type') || 'all',
    period: params.get('period') || '30',
    group: params.get('group') || 'all',
    match: params.get('match') === '1',
    q: '',
  };

  function chip(label, pressed, onClick) {
    const b = el('button', 'chip', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(pressed));
    b.addEventListener('click', onClick);
    return b;
  }

  function renderFilters() {
    const types = $('#f-type');
    types.replaceChildren(chip('Tout', state.type === 'all', () => { state.type = 'all'; renderVeille(); }));
    Object.entries(TYPES).forEach(([key, label]) => {
      types.append(chip(label, state.type === key, () => { state.type = key; renderVeille(); }));
    });
    const periods = $('#f-period');
    periods.replaceChildren();
    [['7', '7 jours'], ['30', '30 jours'], ['all', 'Tout']].forEach(([v, l]) => {
      periods.append(chip(l, state.period === v, () => { state.period = v; renderVeille(); }));
    });
    const groups = $('#f-group');
    groups.className = 'chips groups';
    groups.replaceChildren(chip('Tout notre périmètre', state.match && state.group === 'all', () => {
      state.match = !state.match; state.group = 'all'; renderVeille();
    }));
    Object.keys(SETTINGS.watch).forEach((g) => {
      groups.append(chip(g, state.group === g, () => {
        state.group = state.group === g ? 'all' : g; state.match = false; renderVeille();
      }));
    });
  }

  function filtered() {
    const q = state.q.trim().toLowerCase();
    return SEC.filter((i) => {
      if (state.type !== 'all' && i.type !== state.type) return false;
      if (state.period !== 'all' && !within(i, Number(state.period))) return false;
      if (state.match && !i.matches.length) return false;
      if (state.group !== 'all' && !i.matches.some((m) => m.group === state.group)) return false;
      if (q && !`${i.title} ${i.summary} ${i.title_fr || ''} ${i.summary_fr || ''} ${(i.cve || []).join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => b._d - a._d);
  }

  function renderVeille() {
    renderFilters();
    const list = $('#results');
    if (!DATA) { fillList(list, [], '', 'sec'); $('#count').textContent = ''; return; }
    const rows = filtered();
    $('#count').textContent = plural(rows.length, 'résultat', 'résultats') + (rows.length > 150 ? ' · 150 affichés' : '');
    fillList(list, rows.slice(0, 150), 'Aucun résultat avec ces filtres.', 'sec');
  }

  /* ---------- infos ---------- */

  function renderInfos() {
    renderWeather();
    renderDeadlines();
    renderServices();
    renderNews();
  }

  /* ---------- réglages ---------- */

  function renderSettings() {
    const ul = $('#sources');
    ul.replaceChildren();
    const entries = Object.entries((DATA && DATA.status) || {});
    if (!entries.length) ul.append(el('li', 'empty', 'Aucune donnée reçue pour le moment.'));
    entries.forEach(([name, s]) => {
      const li = el('li');
      const grow = el('div', 'grow');
      grow.append(el('div', '', name), el('div', 'sub', s.ok ? `${s.count} élément(s)` : `Échec : ${s.error || 'inconnu'}`));
      li.append(el('span', 'dot ' + (s.ok ? 'ok' : 'bad')), grow);
      ul.append(li);
    });
    $('#version').textContent = 'Version ' + APP_VERSION;
  }

  function initSettings() {
    $('#set-title').value = SETTINGS.title;
    $('#set-watch').value = watchToText(SETTINGS.watch);
    const saved = $('#saved');
    let theme = SETTINGS.theme;
    const drawTheme = () => {
      const box = $('#set-theme');
      box.replaceChildren();
      [['light', 'Clair'], ['dark', 'Soir']].forEach(([v, label]) => {
        box.append(chip(label, theme === v, () => {
          theme = v;
          document.documentElement.dataset.theme = v;
          patchSettings({ theme: v });
          drawTheme();
        }));
      });
    };
    drawTheme();
    $('#save').addEventListener('click', () => {
      const watch = parseWatch($('#set-watch').value);
      if (!Object.keys(watch).length) { saved.textContent = 'Au moins un groupe est nécessaire (Nom: mot1, mot2).'; return; }
      const ok = patchSettings({ title: $('#set-title').value.trim(), watch });
      saved.textContent = ok ? 'Enregistré.' : "Impossible d'enregistrer sur cet appareil.";
      if (ok) $('#brand').textContent = $('#set-title').value.trim() || DEFAULT_TITLE;
    });
    $('#reset').addEventListener('click', () => {
      $('#set-title').value = DEFAULT_TITLE;
      $('#set-watch').value = watchToText(DEFAULT_WATCH);
      saved.textContent = 'Valeurs par défaut chargées : appuyer sur Enregistrer pour les appliquer.';
    });
    $('#refresh').addEventListener('click', async () => {
      const keys = window.caches ? await caches.keys() : [];
      await Promise.all(keys.map((k) => caches.delete(k)));
      location.reload();
    });
  }

  /* ---------- démarrage ---------- */

  function render() {
    renderStatusBar();
    if (page === 'home') renderHome();
    else if (page === 'veille') renderVeille();
    else if (page === 'infos') renderInfos();
    else if (page === 'reglages') renderSettings();
  }

  if (page === 'home') {
    tick();
    setInterval(tick, 1000);
    setInterval(() => { if (!$('#modal') || $('#modal').hidden) location.reload(); }, RELOAD_HOME_MS);
  }
  if (page === 'veille') $('#q').addEventListener('input', (e) => { state.q = e.target.value; renderVeille(); });
  if (page === 'reglages') initSettings();
  if (page !== 'home') {
    let idle;
    const resetIdle = () => { clearTimeout(idle); idle = setTimeout(() => { location.href = 'index.html'; }, IDLE_RETURN_MS); };
    ['touchstart', 'click', 'keydown', 'scroll'].forEach((ev) => document.addEventListener(ev, resetIdle, { passive: true }));
    resetIdle();
  }

  // Écran toujours allumé (quand le navigateur le permet).
  async function keepAwake() {
    try { if ('wakeLock' in navigator) await navigator.wakeLock.request('screen'); } catch (e) { /* ignoré */ }
  }
  keepAwake();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });

  // Fonctionnement hors connexion + mise à jour automatique de l'appli.
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded) { reloaded = true; location.reload(); }
    });
  }

  load();
  setInterval(load, REFRESH_MS);
  loadWeather();
  setInterval(loadWeather, WEATHER_MS);
})();
