(() => {
  'use strict';

  let page = document.body.dataset.page;
  const DAY = 864e5;
  const TZ = 'Europe/Paris';
  const REFRESH_MS = 5 * 60 * 1000;
  const WEATHER_MS = 15 * 60 * 1000;
  const IDLE_RETURN_MS = 3 * 60 * 1000;
  const SW_CHECK_MS = 30 * 60 * 1000; // cherche une nouvelle version de l'appli
  const PAGES = { 'index.html': 'home', 'veille.html': 'veille', 'infos.html': 'infos', 'reglages.html': 'reglages' };
  const STALE_HOURS = 3;
  const APP_VERSION = '2.4.1';
  const ROTATION = ['index.html', 'veille.html', 'infos.html'];
  const ROTATE_CHOICES = [[0, 'Désactivé'], [30, '30 s'], [60, '1 min'], [120, '2 min']];
  const PULL_PX = 90;
  // Passerelle fournie par l'appli Android (absente dans un navigateur).
  const APP = window.VeilleApp || null;
  const PLACE = { name: 'Alençon', lat: 48.4329, lon: 0.0918 };

  const TYPES = {
    alerte: 'Alerte CERT-FR',
    kev: 'Faille exploitée',
    cve: 'CVE critique',
    avis: 'Avis CERT-FR',
    cti: 'Menace / incident',
    vuln: 'Vulnérabilité',
    actualite: 'Actualité CERT-FR',
  };
  const TYPE_WEIGHT = { alerte: 50, kev: 40, cti: 25, avis: 20, cve: 18, vuln: 15, actualite: 10 };

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
      const rotate = ROTATE_CHOICES.some(([v]) => v === Number(s.rotate)) ? Number(s.rotate) : 0;
      return { title: (s.title || '').trim() || DEFAULT_TITLE, watch, theme: s.theme === 'dark' ? 'dark' : 'light', rotate };
    } catch (e) {
      return { title: DEFAULT_TITLE, watch: DEFAULT_WATCH, theme: 'light', rotate: 0 };
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

  let SETTINGS = loadSettings();

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

  let WATCH = compileWatch(SETTINGS.watch);

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

  // Faille activement exploitée (CISA KEV) qui touche un logiciel suivi : la priorité absolue.
  const isHot = (it) => it.type === 'kev' && it.matches && it.matches.length > 0;

  function scoreOf(it) {
    let s = TYPE_WEIGHT[it.type] || 10;
    if (it.matches.length) s += 35;
    if (isHot(it)) s += 20;
    if (it.ransomware) s += 10;
    const ageDays = Math.max(0, (Date.now() - it._d) / DAY);
    return s - Math.min(ageDays * 3, 30);
  }

  /* ---------- données ---------- */

  let DATA = null;
  let SEC = [];
  let NEWS = [];
  let LOAD_ERROR = {};

  // Les données sont publiées sur la branche « data » du dépôt (mise à jour toutes les 5 min,
  // sans reconstruire le site). Si elle n'existe pas encore, on se rabat sur data.json du site.
  function dataUrls() {
    const urls = [];
    const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
    const repo = location.pathname.split('/')[1];
    if (m && repo && !repo.includes('.')) urls.push(`https://raw.githubusercontent.com/${m[1]}/${repo}/data/data.json`);
    urls.push('data.json');
    return urls;
  }

  async function fetchData() {
    let last = {};
    for (const u of dataUrls()) {
      try {
        const res = await fetch(u + '?t=' + Date.now(), { cache: 'no-store' });
        if (res.ok) { LOAD_ERROR = {}; return await res.json(); }
        last = { status: res.status };
      } catch (e) {
        last = {};
      }
    }
    LOAD_ERROR = last;
    return null;
  }

  function prepare() {
    DATA.items.forEach((i) => { i._d = new Date(i.date); i.matches = i.type === 'news' ? [] : findMatches(i); });
    SEC = DATA.items.filter((i) => i.type !== 'news');
    NEWS = DATA.items.filter((i) => i.type === 'news').sort((a, b) => b._d - a._d);
  }

  async function load() {
    const d = await fetchData();
    if (d && Array.isArray(d.items)) {
      DATA = d;
      prepare();
    } // sinon : on garde les dernières données déjà affichées
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
        'Sur GitHub : onglet Actions → « Mise à jour des données de veille » → Run workflow (crée la branche data).',
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
    const li = el('li', 'item t-' + it.type + (isHot(it) ? ' hot' : ''));
    li.tabIndex = 0;
    li.append(el('div', 'title', tTitle(it)));
    const meta = el('div', 'meta');
    if (isHot(it)) meta.append(badge('⚠ Exploitée · nos logiciels', 'b-hot'));
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

  // Pastille « Mis à jour il y a X min » : verte < 30 min, orange ensuite, rouge au-delà de STALE_HOURS.
  function renderFresh() {
    const top = $('.top');
    if (!top) return;
    let f = $('#fresh');
    if (!f) {
      f = el('div', 'fresh');
      f.id = 'fresh';
      f.setAttribute('role', 'status');
      top.insertBefore(f, $('#stale'));
    }
    if (!DATA || !DATA.generated) { f.hidden = true; return; }
    const last = new Date(DATA.generated);
    const min = (Date.now() - last) / 60000;
    f.hidden = false;
    f.className = 'fresh ' + (min < 30 ? 'ok' : min < STALE_HOURS * 60 ? 'warn' : 'bad');
    f.textContent = 'Mis à jour ' + ago(last);
    f.title = 'Dernière collecte des sources : ' + fmtDateTime(last);
  }

  function renderStatusBar() {
    const stale = $('#stale');
    const foot = $('#foot');
    renderFresh();
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


  /* ---------- conseils de protection ---------- */

  const has = (re, t) => re.test(t);
  const CATS = [
    { re: /windows|microsoft|exchange|sharepoint|active directory|hyper-v|\.net|outlook|office 365|microsoft 365/,
      it: ["Déployer les mises à jour de sécurité Microsoft (WSUS / Windows Update) en commençant par les serveurs exposés.", "Vérifier que les postes et serveurs concernés sont bien redémarrés après l'installation du correctif."],
      user: ["Accepter les mises à jour Windows et redémarrer l'ordinateur quand il le demande.", "Ne pas ouvrir de pièce jointe Office ni activer les macros sans raison claire."] },
    { re: /chrome|chromium|firefox|safari|webkit|navigateur|browser|edge\b/,
      it: ["Mettre à jour le navigateur sur tous les postes (version corrigée indiquée par l'éditeur).", "Vérifier que le navigateur se met à jour automatiquement."],
      user: ["Redémarrer le navigateur dès qu'il propose une mise à jour.", "Éviter les sites inconnus et ne pas installer d'extension non validée."] },
    { re: /thunderbird|messagerie|zimbra|postfix|webmail|mail server/,
      it: ["Mettre à jour le client ou le serveur de messagerie concerné.", "Renforcer le filtrage des pièces jointes et des liens côté passerelle de messagerie."],
      user: ["Se méfier des messages inattendus : vérifier l'expéditeur avant d'ouvrir un lien ou une pièce jointe.", "Signaler tout message suspect au lieu de le transférer."] },
    { re: /fortinet|fortigate|fortios|cisco|palo alto|pan-os|juniper|big-ip|sonicwall|ivanti|citrix|netscaler|pulse secure|vpn|firewall|pare-feu|routeur|router|switch|opnsense|pfsense|check point|watchguard|ssl-vpn/,
      it: ["Mettre à jour le firmware de l'équipement réseau concerné (VPN, pare-feu, routeur) vers la version corrigée.", "Si le correctif n'est pas disponible : limiter l'exposition (administration depuis le réseau interne seulement) et appliquer le contournement de l'éditeur.", "Contrôler les journaux d'accès et les comptes de l'équipement à la recherche d'activité inhabituelle."],
      user: ["Utiliser uniquement les accès VPN fournis par le service informatique.", "Signaler toute coupure ou lenteur anormale de la connexion."] },
    { re: /vmware|esxi|vcenter|proxmox|veeam|synology|qnap|nutanix|\bnas\b|sauvegarde|backup|virtualis/,
      it: ["Mettre à jour l'hyperviseur, la plateforme de sauvegarde ou le NAS concerné et n'exposer ses interfaces d'administration qu'au réseau interne.", "Vérifier qu'une sauvegarde récente, hors ligne ou isolée, existe et qu'elle peut être restaurée."],
      user: ["Ne pas stocker de fichiers importants uniquement sur son poste : utiliser les espaces de stockage prévus."] },
    { re: /linux|kernel|noyau|apache|nginx|openssl|openssh|tomcat|\bphp\b|java|jenkins|gitlab|docker|kubernetes|redis|mysql|postgres|wordpress|drupal|ubuntu|debian|red hat|rhel/,
      it: ["Appliquer les correctifs de la distribution ou du logiciel serveur concerné, puis redémarrer le service.", "Vérifier les versions installées (gestionnaire de paquets) et retirer les composants inutilisés."],
      user: ["Pas d'action particulière côté utilisateur : signaler tout service indisponible au service informatique."] },
    { re: /adobe|acrobat|reader|libreoffice|7-zip|winrar|pdf/,
      it: ["Mettre à jour le logiciel de lecture ou de compression concerné sur le parc."],
      user: ["Ouvrir uniquement les documents et archives reçus d'une source connue.", "Mettre à jour le logiciel quand il le propose."] },
    { re: /putty|winscp|filezilla|teamviewer|anydesk|connectwise|screenconnect|manageengine|zabbix|centreon|glpi|\bvnc\b|\brdp\b|remote desktop|bureau à distance/,
      it: ["Mettre à jour l'outil d'administration ou de prise en main à distance, et ne jamais l'exposer directement sur Internet.", "Limiter les comptes autorisés et activer l'authentification à deux facteurs quand c'est possible."],
      user: ["N'accepter une prise en main à distance que si elle a été demandée au service informatique."] },
    { re: /android|\bios\b|iphone|ipad|samsung|mobile/,
      it: ["Mettre à jour les appareils mobiles concernés (gestion centralisée si elle existe)."],
      user: ["Installer la dernière mise à jour du téléphone ou de la tablette.", "Installer des applications uniquement depuis la boutique officielle."] },
    { re: /okta|keycloak|ldap|saml|oauth|\bsso\b|kerberos|entra|authentification|authentication|identity|identité/,
      it: ["Mettre à jour le service d'authentification et envisager la rotation des secrets et sessions s'il a été exposé.", "Surveiller les connexions inhabituelles (horaires, provenances)."],
      user: ["Utiliser un mot de passe unique et robuste, et changer le mot de passe si le service informatique le demande."] },
    { re: /scada|siemens|schneider|industrial|industriel|automate/,
      it: ["Isoler les équipements industriels du réseau général et appliquer les consignes de l'éditeur."],
      user: ["Pas d'action particulière côté utilisateur."] },
  ];
  const CLASSES = [
    { re: /remote code|code arbitraire|exécution de code|execute arbitrary|exécution à distance|rce\b/,
      it: ["Faille permettant d'exécuter du code à distance : traiter en priorité les systèmes accessibles depuis Internet."],
      user: ["Ne pas cliquer sur un lien ou une pièce jointe inattendu : c'est le moyen le plus courant d'exploiter ce type de faille."] },
    { re: /privilege|élévation de privilèges|escalation/,
      it: ["Faille d'élévation de privilèges : limiter les droits administrateur et vérifier les comptes à privilèges."],
      user: ["Travailler avec un compte sans droits d'administrateur au quotidien."] },
    { re: /denial of service|déni de service|\bdos\b/,
      it: ["Risque d'indisponibilité du service : prévoir le correctif et surveiller la charge et les plantages."],
      user: ["En cas d'indisponibilité du service, prévenir le service informatique plutôt que de réessayer en boucle."] },
    { re: /bypass|contournement|auth.{0,15}(bypass|contourn)|authentification/,
      it: ["Faille de contournement de protection ou d'authentification : vérifier les accès récents et renforcer l'authentification (double facteur)."],
      user: ["Activer la double authentification quand elle est proposée."] },
    { re: /information disclosure|divulgation|atteinte à la confidentialité|exposure|fuite|leak/,
      it: ["Risque de fuite d'informations : limiter l'accès aux données sensibles et vérifier les journaux."],
      user: ["Ne pas partager d'informations sensibles par des canaux non validés."] },
    { re: /injection|\bsql\b|xss|cross-site|path traversal|traversée|deserializ|désérialis/,
      it: ["Faille d'injection ou de script : mettre à jour l'application web et filtrer les accès par un pare-feu applicatif si possible."],
      user: ["Éviter de cliquer sur des liens longs ou étranges menant à un site connu."] },
    { re: /phishing|hameçonnage|usurpation|spoof/,
      it: ["Rappeler les consignes anti-hameçonnage et renforcer le filtrage des messages."],
      user: ["Vérifier l'adresse de l'expéditeur et ne jamais saisir son mot de passe depuis un lien reçu par message."] },
  ];

  function adviceFor(it) {
    const text = `${it.title} ${it.summary || ''} ${it.title_fr || ''} ${it.summary_fr || ''} ${it.action || ''}`.toLowerCase();
    const itTips = [];
    const userTips = [];
    if (it.type === 'kev' || it.ransomware) {
      itTips.push("Priorité maximale : cette faille est déjà exploitée par des attaquants. Appliquer le correctif ou la mesure de contournement sans attendre.");
    } else if (it.type === 'alerte') {
      itTips.push("Alerte officielle : vérifier si le produit est présent dans le parc et appliquer le correctif en priorité.");
    } else {
      itTips.push("Vérifier si le produit concerné est utilisé, puis planifier le correctif de l'éditeur.");
    }
    if (it.ransomware) itTips.push("Utilisée dans des attaques par rançongiciel : contrôler les sauvegardes et leur isolement.");
    let matched = false;
    CATS.forEach((c) => { if (has(c.re, text) && itTips.length < 6) { matched = true; itTips.push(...c.it); userTips.push(...c.user); } });
    CLASSES.forEach((c) => { if (has(c.re, text)) { itTips.push(...c.it); userTips.push(...c.user); } });
    if (!matched) itTips.push("Consulter l'avis de l'éditeur (bouton Lien) pour connaître les versions corrigées et les mesures de contournement.");
    userTips.push("Garder son système et ses logiciels à jour.");
    userTips.push("En cas de comportement inhabituel (lenteur, message étrange, fenêtre inattendue), arrêter et prévenir le service informatique.");
    const uniq = (a, n) => Array.from(new Set(a)).slice(0, n);
    return { it: uniq(itTips, 5), user: uniq(userTips, 5) };
  }

  function addAdvice(body, it) {
    const a = adviceFor(it);
    body.append(el('h4', '', 'Comment se protéger'));
    [['Équipe informatique', a.it], ['Utilisateurs', a.user]].forEach(([who, tips]) => {
      if (!tips.length) return;
      body.append(el('div', 'audience', who));
      const ul = el('ul', 'tips');
      tips.forEach((t) => ul.append(el('li', '', t)));
      body.append(ul);
    });
    body.append(el('div', 'note', "Conseils généraux déduits du type de faille et du produit. Suivez toujours l'avis officiel (bouton Lien)."));
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
    if (it.type !== 'news') addAdvice(body, it);
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

  const closeModal = () => { const m = $('#modal'); if (m) m.hidden = true; };

  /* ---------- météo (Open-Meteo, direct depuis la tablette) ---------- */

  let WX = null;
  let wxTried = false;
  const WX_KEY = 'veille.wx';

  async function loadWeather() {
    if (!$('#weather') && !$('#wx-full')) return;
    if (WX && WX.fetched && Date.now() - WX.fetched < 10 * 60 * 1000) { renderWeather(); return; }
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
    wxTried = true;
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

  // Vigilance Météo-France (via Meteoalarm, collectée par GitHub Actions).
  function vigiNode(full) {
    const list = (DATA && DATA.vigilance) || [];
    if (!list.length) return null;
    const box = el('div', 'vigi');
    list.slice(0, full ? 6 : 2).forEach((v) => {
      const row = el('div', 'vigi-item v-' + v.level);
      row.append(el('span', 'vigi-dot'), el('b', '', `Vigilance ${v.level}`), el('span', '', v.event));
      if (full && v.expires) {
        row.append(el('span', 'vigi-when', "jusqu'au " + new Date(v.expires).toLocaleString('fr-FR',
          { weekday: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ })));
      }
      box.append(row);
    });
    return box;
  }

  function renderWeather() {
    const compact = $('#weather');
    const full = $('#wx-full');
    [compact, full].forEach((b) => b && b.replaceChildren());
    if (!WX) {
      if (compact) compact.append(el('div', 'meta', 'Météo indisponible'));
      if (full) full.append(el('h2', '', 'Météo indisponible'));
      const v = vigiNode(!!full);
      if (v) (full || compact).append(v);
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
      compact.append(now);
      const vigi = vigiNode(false);
      if (vigi) compact.append(vigi);
      compact.append(hours);
      const note = staleNote();
      if (note) compact.append(note);
    }

    if (full) {
      full.append(el('h2', '', `Météo · ${PLACE.name}`));
      const vigi = vigiNode(true);
      if (vigi) full.append(vigi);
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
    if (!$('#time')) return;
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
    if (WX || wxTried) renderWeather(); // affiche la vigilance dès l'arrivée des données
    renderDeadlines();
    renderServices();
    renderNews();
  }

  /* ---------- veille ---------- */

  let state = null;
  function initState() {
    const params = new URLSearchParams(location.search);
    state = {
      type: params.get('type') || 'all',
      period: params.get('period') || '30',
      group: params.get('group') || 'all',
      match: params.get('match') === '1',
      q: '',
    };
  }

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

  /* ---------- tendance sur 30 jours (barres empilées par jour) ---------- */

  const TREND_DAYS = 30;
  const TREND_SERIES = [
    { key: 'alerte', label: 'Alertes CERT-FR', color: 'var(--red)', test: (t) => t === 'alerte' },
    { key: 'avis', label: 'Avis CERT-FR', color: 'var(--accent)', test: (t) => t === 'avis' },
    { key: 'kev', label: 'Failles exploitées', color: 'var(--orange)', test: (t) => t === 'kev' },
    { key: 'cve', label: 'CVE critiques', color: 'var(--rose)', test: (t) => t === 'cve' },
    { key: 'other', label: 'Autres', color: 'var(--gray)', test: () => true },
  ];
  const parisDay = (d) => d.toLocaleDateString('en-CA', { timeZone: TZ });

  function svgEl(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    return n;
  }

  // Rectangle à coins supérieurs arrondis (extrémité de la barre), base droite sur l'axe.
  function topRounded(x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  function renderTrend() {
    const box = $('#trend');
    if (!box) return;
    box.replaceChildren(el('h2', '', `Tendance sur ${TREND_DAYS} jours`));
    if (!DATA) return;

    const today = parisToday();
    const days = [];
    for (let i = TREND_DAYS - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * DAY);
      days.push({ key: d.toISOString().slice(0, 10), date: d, counts: TREND_SERIES.map(() => 0), total: 0 });
    }
    const byKey = Object.fromEntries(days.map((d) => [d.key, d]));
    const totals = TREND_SERIES.map(() => 0);
    SEC.forEach((it) => {
      const d = byKey[parisDay(it._d)];
      if (!d) return;
      const s = TREND_SERIES.findIndex((x) => x.test(it.type));
      d.counts[s]++; d.total++; totals[s]++;
    });

    // Légende (avec total 30 jours) : l'identité n'est jamais portée par la couleur seule.
    const legend = el('div', 'legend');
    TREND_SERIES.forEach((s, i) => {
      const k = el('span', 'key');
      const sw = el('span', 'sw');
      sw.style.background = s.color;
      k.append(sw, el('span', '', s.label), el('b', '', String(totals[i])));
      legend.append(k);
    });
    box.append(legend);

    const W = 1000, H = 190, L = 34, R = 6, T = 8, B = 26;
    const pw = W - L - R, ph = H - T - B;
    const max = Math.max(4, ...days.map((d) => d.total));
    const step = Math.ceil(max / 4);
    const top = step * 4;
    const y = (v) => T + ph - (v / top) * ph;
    const slot = pw / TREND_DAYS;
    const bw = Math.max(6, slot - 6);

    const wrap = el('div', 'trend-wrap');
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Publications par jour sur ${TREND_DAYS} jours` });
    for (let v = 0; v <= top; v += step) {
      svg.append(svgEl('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v ? 'grid' : 'axis' }));
      const t = svgEl('text', { x: L - 8, y: y(v) + 4, class: 'tick', 'text-anchor': 'end' });
      t.textContent = String(v);
      svg.append(t);
    }
    const tip = el('div', 'tip');
    tip.hidden = true;

    days.forEach((d, i) => {
      const x = L + i * slot + (slot - bw) / 2;
      let base = y(0);
      const visible = TREND_SERIES.map((s, j) => j).filter((j) => d.counts[j]);
      visible.forEach((j, n) => {
        const h = (d.counts[j] / top) * ph;
        const gap = n ? 2 : 0;                    // 2 px de fond entre segments
        const isTop = n === visible.length - 1;
        const hh = Math.max(1, h - gap);
        const p = svgEl('path', { d: isTop ? topRounded(x, base - h, bw, hh, 4) : `M${x},${base - h}h${bw}v${hh}h${-bw}Z` });
        p.style.fill = TREND_SERIES[j].color;
        svg.append(p);
        base -= h;
      });
      if (i % 7 === (TREND_DAYS - 1) % 7) {
        const t = svgEl('text', { x: x + bw / 2, y: H - 6, class: 'tick', 'text-anchor': 'middle' });
        t.textContent = d.date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
        svg.append(t);
      }
      // Zone de survol plus large que la barre.
      const hit = svgEl('rect', { x: L + i * slot, y: T, width: slot, height: ph, class: 'hit' });
      const show = () => {
        tip.replaceChildren(el('div', 'tip-h', cap(d.date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }))));
        TREND_SERIES.forEach((s, j) => {
          if (!d.counts[j]) return;
          const r = el('div', 'tip-r');
          const sw = el('span', 'sw');
          sw.style.background = s.color;
          r.append(sw, el('span', '', s.label), el('b', '', String(d.counts[j])));
          tip.append(r);
        });
        tip.append(el('div', 'tip-t', d.total ? `Total : ${d.total}` : 'Aucune publication'));
        tip.hidden = false;
        const frac = (i + 0.5) / TREND_DAYS;
        tip.style.left = `${(L + frac * pw) / W * 100}%`;
        tip.classList.toggle('left', frac > 0.6);
      };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('click', show);
      svg.append(hit);
    });
    svg.addEventListener('pointerleave', () => { tip.hidden = true; });
    wrap.append(svg, tip);
    box.append(wrap);

    // Vue tableau (accessibilité).
    const det = el('details', 'trend-table');
    det.append(el('summary', '', 'Voir les chiffres'));
    const table = el('table');
    const head = el('tr');
    ['Jour', ...TREND_SERIES.map((s) => s.label), 'Total'].forEach((h) => head.append(el('th', '', h)));
    table.append(head);
    days.slice().reverse().filter((d) => d.total).forEach((d) => {
      const tr = el('tr');
      tr.append(el('td', '', d.date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })));
      d.counts.forEach((c) => tr.append(el('td', '', String(c))));
      tr.append(el('td', '', String(d.total)));
      table.append(tr);
    });
    det.append(table);
    box.append(det);
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
    let rotate = SETTINGS.rotate;
    const drawRotate = () => {
      const box = $('#set-rotate');
      box.replaceChildren();
      ROTATE_CHOICES.forEach(([v, label]) => {
        box.append(chip(label, rotate === v, () => {
          rotate = v;
          patchSettings({ rotate: v });
          SETTINGS.rotate = v;
          drawRotate();
        }));
      });
    };
    drawRotate();
    $('#save').addEventListener('click', () => {
      const watch = parseWatch($('#set-watch').value);
      if (!Object.keys(watch).length) { saved.textContent = 'Au moins un groupe est nécessaire (Nom: mot1, mot2).'; return; }
      const ok = patchSettings({ title: $('#set-title').value.trim(), watch });
      saved.textContent = ok ? 'Enregistré.' : "Impossible d'enregistrer sur cet appareil.";
      if (ok) $('#brand').textContent = $('#set-title').value.trim() || DEFAULT_TITLE;
      if (ok) shareWatch(watch);
    });
    initAppSettings();
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

  /* ---------- appli Android : réglages propres à la tablette ---------- */

  // La liste des logiciels suivis est transmise à l'appli (sur la tablette uniquement)
  // pour repérer les alertes en arrière-plan.
  function shareWatch(watch) {
    if (!APP) return;
    try { APP.setWatch(JSON.stringify(watch)); } catch (e) { /* ignoré */ }
  }

  function initAppSettings() {
    const panel = $('#app-panel');
    if (!panel || !APP) return;
    let cfg;
    try { cfg = JSON.parse(APP.getConfig()); } catch (e) { return; }
    panel.hidden = false;
    const save = () => { try { APP.setConfig(JSON.stringify(cfg)); } catch (e) { /* ignoré */ } };
    const draw = () => {
      panel.querySelectorAll('[data-opt]').forEach((box) => {
        const key = box.dataset.opt;
        box.replaceChildren();
        [[true, 'Oui'], [false, 'Non']].forEach(([v, label]) => {
          box.append(chip(label, !!cfg[key] === v, () => { cfg[key] = v; save(); draw(); }));
        });
      });
      $('#night-times').hidden = !cfg.night;
    };
    $('#night-start').value = cfg.nightStart || '20:00';
    $('#night-end').value = cfg.nightEnd || '07:00';
    ['night-start', 'night-end'].forEach((id) => {
      $('#' + id).addEventListener('change', () => {
        cfg.nightStart = $('#night-start').value || '20:00';
        cfg.nightEnd = $('#night-end').value || '07:00';
        save();
      });
    });
    $('#notif-test').addEventListener('click', () => { try { APP.testNotification(); } catch (e) { /* ignoré */ } });

    // Jeton GitHub : envoyé une seule fois à l'appli (qui le teste), jamais relu par la page.
    const tokenState = () => {
      const st = $('#gh-token-state');
      $('#gh-token-del').hidden = !cfg.hasToken;
      if (!cfg.hasToken) { st.textContent = 'Aucun jeton : la collecte dépend du planificateur de GitHub.'; return; }
      const when = cfg.trigAt ? ago(new Date(cfg.trigAt)) : 'jamais';
      st.textContent = cfg.trigStatus && cfg.trigStatus !== 'ok'
        ? `Jeton enregistré · dernier essai ${when} : ${cfg.trigStatus}`
        : `Jeton enregistré · dernière relance de la collecte : ${when}`;
    };
    const sendToken = (value) => {
      const st = $('#gh-token-state');
      st.textContent = 'Vérification auprès de GitHub…';
      setTimeout(() => {
        let res = '';
        try { res = APP.setToken(value); } catch (e) { res = 'erreur'; }
        $('#gh-token').value = '';
        try { cfg = JSON.parse(APP.getConfig()); } catch (e) { /* ignoré */ }
        if (res === 'ok' || res === 'removed') tokenState();
        else st.textContent = 'Jeton non enregistré : ' + res;
      }, 50);
    };
    $('#gh-token-save').addEventListener('click', () => {
      const v = $('#gh-token').value.trim();
      if (v) sendToken(v);
    });
    $('#gh-token-del').addEventListener('click', () => sendToken(''));
    tokenState();
    $('#app-version').textContent = 'Appli Android ' + (cfg.version || '');
    draw();
  }

  /* ---------- actualiser en tirant vers le bas ---------- */

  async function refreshAll() {
    if (WX) WX.fetched = 0;
    await Promise.all([load(), loadWeather()]);
  }

  function initPull() {
    const ind = el('div', 'ptr');
    ind.setAttribute('aria-hidden', 'true');
    document.documentElement.append(ind);   // hors du <body> : survit à la navigation douce
    let y0 = null, dy = 0, busy = false;
    const hide = () => { ind.classList.remove('show'); ind.style.transform = ''; };
    document.addEventListener('touchstart', (e) => {
      const modal = $('#modal');
      y0 = (!busy && window.scrollY <= 0 && (!modal || modal.hidden) && e.touches.length === 1) ? e.touches[0].clientY : null;
      dy = 0;
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (y0 === null) return;
      dy = e.touches[0].clientY - y0;
      if (dy <= 10) { hide(); return; }
      ind.classList.add('show');
      ind.style.transform = `translate(-50%, ${Math.min(dy, PULL_PX * 1.4) * 0.6}px)`;
      ind.textContent = dy > PULL_PX ? '↻ Relâcher pour actualiser' : '↓ Tirer pour actualiser';
    }, { passive: true });
    document.addEventListener('touchend', async () => {
      if (y0 === null) return;
      y0 = null;
      if (dy <= PULL_PX) { hide(); return; }
      busy = true;
      ind.textContent = 'Actualisation…';
      try { await refreshAll(); } finally { busy = false; setTimeout(hide, 400); }
    });
  }

  /* ---------- démarrage ---------- */

  function render() {
    if (!$('#stale')) return;
    renderStatusBar();
    if (page === 'home') renderHome();
    else if (page === 'veille') { renderTrend(); renderVeille(); }
    else if (page === 'infos') renderInfos();
    else if (page === 'reglages') renderSettings();
  }

  /* ---------- plein écran ---------- */

  const NS = 'http://www.w3.org/2000/svg';
  const FS_IN = 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5';
  const FS_OUT = 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5';

  function fsSync() {
    const b = $('.fsbtn');
    if (!b) return;
    const on = !!document.fullscreenElement;
    const label = on ? 'Quitter le plein écran' : 'Plein écran';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.querySelector('path').setAttribute('d', on ? FS_OUT : FS_IN);
    b.querySelector('span').textContent = label;
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  }

  function initFullscreen() {
    if (APP || !document.documentElement.requestFullscreen) return; // l'appli Android est déjà en plein écran
    if (window.matchMedia && matchMedia('(display-mode: fullscreen)').matches) return; // appli installée déjà en plein écran
    const top = $('.top');
    if (!top) return;
    const b = el('button', 'fsbtn');
    b.type = 'button';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path');
    svg.append(path);
    b.append(svg, el('span', '', ''));
    b.addEventListener('click', toggleFullscreen);
    top.insertBefore(b, $('#stale'));
    fsSync();
  }

  /* ---------- navigation sans rechargement (garde le plein écran) ---------- */

  const pageFile = (u) => u.pathname.split('/').pop() || 'index.html';
  let navigating = false;

  async function navigate(href, push) {
    if (navigating) return;
    navigating = true;
    let url = null;
    try {
      url = new URL(href, location.href);
      const r = await fetch(url.href);
      if (!r.ok) throw new Error(r.status);
      const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
      const next = doc.body && doc.body.dataset.page;
      if (!next) throw new Error('page');
      doc.body.querySelectorAll('script').forEach((n) => n.remove());
      document.body.replaceChildren(...Array.from(doc.body.childNodes).map((n) => document.adoptNode(n)));
      document.body.dataset.page = next;
      page = next;
      document.title = doc.title;
      if (push === 'replace') history.replaceState(null, '', url.href);
      else if (push) history.pushState(null, '', url.href);
      window.scrollTo(0, 0);
      boot();
    } catch (e) {
      location.href = url ? url.href : href;
    } finally {
      navigating = false;
    }
  }

  /* ---------- démarrage ---------- */

  let idle;
  // Sans interaction : défilement automatique Accueil → Veille → Infos (si activé),
  // sinon retour à l'accueil après IDLE_RETURN_MS. Jamais pendant la lecture d'un détail.
  function resetIdle() {
    clearTimeout(idle);
    const rotate = SETTINGS.rotate;
    if (rotate && page !== 'reglages') {
      idle = setTimeout(() => {
        const modal = $('#modal');
        if (modal && !modal.hidden) { resetIdle(); return; }
        const cur = Object.keys(PAGES).find((k) => PAGES[k] === page);
        navigate(ROTATION[(ROTATION.indexOf(cur) + 1) % ROTATION.length], 'replace');
      }, rotate * 1000);
    } else if (page !== 'home') {
      idle = setTimeout(() => navigate('index.html', true), IDLE_RETURN_MS);
    }
  }

  // À chaque affichage d'une page.
  function boot() {
    SETTINGS = loadSettings();
    WATCH = compileWatch(SETTINGS.watch);
    if (DATA) DATA.items.forEach((i) => { i.matches = i.type === 'news' ? [] : findMatches(i); });
    $('#brand').textContent = SETTINGS.title;
    document.documentElement.dataset.theme = SETTINGS.theme;
    shareWatch(SETTINGS.watch);
    $('#close').addEventListener('click', closeModal);
    $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
    initFullscreen();
    tick();
    if (page === 'veille') {
      initState();
      $('#q').addEventListener('input', (e) => { state.q = e.target.value; renderVeille(); });
    }
    if (page === 'reglages') initSettings();
    render();
    loadWeather();
    resetIdle();
  }

  // Une seule fois.
  function setup() {
    document.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const u = new URL(a.href, location.href);
      if (u.origin !== location.origin || !PAGES[pageFile(u)]) return;
      e.preventDefault();
      navigate(u.href, true);
    });
    window.addEventListener('popstate', () => navigate(location.href, false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
    document.addEventListener('fullscreenchange', fsSync);
    ['touchstart', 'click', 'keydown', 'scroll'].forEach((ev) => document.addEventListener(ev, resetIdle, { passive: true }));

    setInterval(tick, 1000);
    setInterval(renderFresh, 30 * 1000);
    setInterval(load, REFRESH_MS);
    setInterval(loadWeather, WEATHER_MS);
    initPull();
    // L'appli Android signale la fin du mode nuit : on rafraîchit tout de suite.
    window.addEventListener('veilleapp:wake', () => { refreshAll(); });

    // Écran toujours allumé (quand le navigateur le permet).
    const keepAwake = async () => {
      try { if ('wakeLock' in navigator) await navigator.wakeLock.request('screen'); } catch (e) { /* ignoré */ }
    };
    keepAwake();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { keepAwake(); load(); }
    });

    // Fonctionnement hors connexion + mise à jour automatique de l'appli.
    if ('serviceWorker' in navigator) {
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('sw.js').then((reg) => {
        setInterval(() => { reg.update().catch(() => {}); }, SW_CHECK_MS);
      }).catch(() => {});
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController && !reloaded) { reloaded = true; location.reload(); }
      });
    }
  }

  setup();
  boot();
  load();
})();
