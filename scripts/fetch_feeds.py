#!/usr/bin/env python3
"""Collecte les flux publics (CERT-FR, CISA KEV, actualités, état des services) et écrit data.json.

Lancé par GitHub Actions toutes les 30 minutes. Bibliothèque standard uniquement.
Le repérage « ce qui concerne nos logiciels » n'est PAS fait ici : il se fait sur la tablette,
pour que la liste des logiciels utilisés ne soit jamais publiée dans le dépôt.

Usage : python scripts/fetch_feeds.py
"""
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "config.json")
OUTPUT = os.path.join(ROOT, "data.json")

UA = "Mozilla/5.0 (X11; Linux) VeilleTableauDeBord/2.0"
TIMEOUT = 25
MAX_BYTES = 8 * 1024 * 1024

CVE_RE = re.compile(r"CVE-\d{4}-\d{4,7}", re.I)
TAG_RE = re.compile(r"<[^>]+>")
SPACE_RE = re.compile(r"\s+")


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def fetch_bytes(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        data = resp.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("réponse trop volumineuse")
    return data


def local(tag):
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def child_text(node, *names):
    for child in node:
        if local(child.tag) in names:
            text = "".join(child.itertext()).strip()
            if text:
                return text
    return ""


def atom_link(node):
    fallback = ""
    for child in node:
        if local(child.tag) == "link":
            href = child.get("href")
            if href:
                if child.get("rel") in (None, "alternate"):
                    return href
                fallback = fallback or href
    return fallback


def clean(text, limit=500):
    text = html.unescape(TAG_RE.sub(" ", text or ""))
    text = SPACE_RE.sub(" ", text).strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def parse_date(value):
    if not value:
        return None
    value = value.strip()
    try:
        dt = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        dt = None
    if dt is None:
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def safe_url(url):
    return url if isinstance(url, str) and url.startswith(("http://", "https://")) else ""


def resolve_type(feed_type, link):
    """Type « auto » : déduit du chemin de l'URL CERT-FR (/avis/, /alerte/, /cti/…)."""
    if feed_type != "auto":
        return feed_type
    path = (link or "").lower()
    for key, kind in (("alerte", "alerte"), ("avis", "avis"), ("cti", "cti"), ("ioc", "cti"), ("actualite", "actualite"), ("dur", "actualite")):
        if f"/{key}/" in path:
            return kind
    return "actualite"


def parse_feed(raw, feed):
    root = ET.fromstring(raw)
    out = []
    for node in root.iter():
        if local(node.tag) not in ("item", "entry"):
            continue
        title = clean(child_text(node, "title"), 300)
        if not title:
            continue
        link = child_text(node, "link") if local(node.tag) == "item" else atom_link(node)
        link = safe_url(link or atom_link(node))
        out.append({
            "source": feed["name"],
            "type": resolve_type(feed["type"], link),
            "title": title,
            "link": link,
            "date": parse_date(child_text(node, "pubDate", "published", "updated", "date")),
            "summary": clean(child_text(node, "description", "summary", "content", "encoded")),
        })
    return out[: feed.get("max", 100)]


def collect_feeds(cfg, status):
    items = []
    for feed in cfg.get("feeds", []):
        if not feed.get("enabled", True):
            continue
        name = feed["name"]
        try:
            got = parse_feed(fetch_bytes(feed["url"]), feed)
            items.extend(got)
            status[name] = {"ok": True, "count": len(got)}
            log(f"OK    {name}: {len(got)} éléments")
        except Exception as exc:  # un flux en panne ne doit pas bloquer les autres
            status[name] = {"ok": False, "count": 0, "error": str(exc)[:160]}
            log(f"ECHEC {name}: {exc}")
    return items


def collect_kev(cfg, status):
    kev = cfg.get("kev", {})
    if not kev.get("enabled"):
        return []
    name = "CISA · Failles exploitées (KEV)"
    try:
        data = json.loads(fetch_bytes(kev["url"]))
        limit = datetime.now(timezone.utc) - timedelta(days=kev.get("days", 90))
        items = []
        for v in data.get("vulnerabilities", []):
            date = parse_date(v.get("dateAdded", "") + "T00:00:00+00:00")
            if not date or date < limit:
                continue
            cve = v.get("cveID", "")
            items.append({
                "source": name,
                "type": "kev",
                "title": f'{cve} — {v.get("vendorProject", "")} {v.get("product", "")} : {v.get("vulnerabilityName", "")}'.strip(),
                "link": f"https://nvd.nist.gov/vuln/detail/{cve}" if cve else "",
                "date": date,
                "summary": clean(f'{v.get("shortDescription", "")} Action requise : {v.get("requiredAction", "")}'),
                "ransomware": v.get("knownRansomwareCampaignUse") == "Known",
            })
        items.sort(key=lambda i: i["date"], reverse=True)
        items = items[: kev.get("max", 80)]
        status[name] = {"ok": True, "count": len(items)}
        log(f"OK    {name}: {len(items)} éléments")
        return items
    except Exception as exc:
        status[name] = {"ok": False, "count": 0, "error": str(exc)[:160]}
        log(f"ECHEC {name}: {exc}")
        return []


def collect_services(cfg, status, previous):
    """Pages d'état au format Statuspage (api/v2/status.json)."""
    out = []
    old = {s["name"]: s for s in previous.get("services", [])}
    for svc in cfg.get("services", []):
        name = svc["name"]
        try:
            d = json.loads(fetch_bytes(svc["url"]))
            st = d.get("status", {})
            out.append({
                "name": name,
                "indicator": st.get("indicator", "unknown"),
                "description": clean(st.get("description", ""), 120),
                "checked": datetime.now(timezone.utc).isoformat(),
            })
            status[f"État · {name}"] = {"ok": True, "count": 1}
        except Exception as exc:
            status[f"État · {name}"] = {"ok": False, "count": 0, "error": str(exc)[:160]}
            log(f"ECHEC État {name}: {exc}")
            if name in old:
                out.append(old[name])
    log(f"OK    État des services: {len(out)}")
    return out


def item_id(item):
    key = item.get("link") or item["title"]
    return hashlib.sha1(key.encode()).hexdigest()[:12]


def load_previous():
    try:
        with open(OUTPUT, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def main():
    with open(CONFIG, encoding="utf-8") as fh:
        cfg = json.load(fh)
    now = datetime.now(timezone.utc)
    status = {}
    previous = load_previous()

    fresh = collect_feeds(cfg, status) + collect_kev(cfg, status)
    for it in fresh:
        it["date"] = (it["date"] or now).isoformat()
        it["cve"] = sorted({c.upper() for c in CVE_RE.findall(f'{it["title"]} {it["summary"]}')})
        it["id"] = item_id(it)

    # Fusion avec la collecte précédente : un flux en panne ne vide pas l'écran.
    merged = {i["id"]: i for i in previous.get("items", []) if "id" in i}
    for it in fresh:
        merged[it["id"]] = it

    keep_sec = now - timedelta(days=cfg.get("retention_days", 60))
    keep_news = now - timedelta(days=cfg.get("news_retention_days", 3))
    items = []
    for it in merged.values():
        limit = keep_news if it["type"] == "news" else keep_sec
        d = parse_date(it["date"])
        if d and d >= limit:
            items.append(it)
    items.sort(key=lambda i: i["date"], reverse=True)
    items = items[: cfg.get("max_items", 400)]

    services = collect_services(cfg, status, previous)
    ok_count = sum(1 for s in status.values() if s["ok"])
    out = {
        "generated": now.isoformat(),
        "last_success": now.isoformat() if ok_count else previous.get("last_success"),
        "status": status,
        "services": services,
        "items": items,
    }
    tmp = OUTPUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, OUTPUT)
    log(f"data.json écrit : {len(items)} éléments, {ok_count}/{len(status)} sources OK")
    # Si aucune source n'a répondu, on fait échouer le job pour que GitHub le signale.
    return 0 if ok_count else 1


if __name__ == "__main__":
    sys.exit(main())
