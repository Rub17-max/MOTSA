"""
MOTSA API — backend local Flask
Tourne sur http://localhost:5001

Rôles :
  GET  /health              → status check depuis le dashboard
  GET  /chrome-downloads    → liste les PDF récents depuis l'historique Chrome
  POST /certify             → génère le PDF certifié, calcule le hash, uploade sur Supabase

Démarrer :
  python3.12 api.py
"""

import os
import sqlite3
import shutil
import hashlib
import secrets
import json
import io

from pathlib import Path
from datetime import datetime, timedelta
from flask import Flask, jsonify, request
from flask_cors import CORS

import qrcode
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader

from supabase import create_client
from dotenv import load_dotenv
load_dotenv()
# ── CONFIG ────────────────────────────────────────────────────────────────────

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

CHROME_HISTORY = Path.home() / "Library/Application Support/Google/Chrome/Default/History"
TEMP_DB        = "/tmp/motsa_chrome.db"
MOTSA_FOLDER   = Path.home() / "Desktop" / "MOTSA_PDF"
MOTSA_FOLDER.mkdir(exist_ok=True)

VERIFY_BASE    = "https://motsa.tech/verify"

# ── APP ───────────────────────────────────────────────────────────────────────

app = Flask(__name__)
CORS(app)  # autorise les appels depuis le dashboard Vercel

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── UTILS ─────────────────────────────────────────────────────────────────────

def chrome_time(t):
    return datetime(1601, 1, 1) + timedelta(microseconds=t)


def sha256_path(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


# ── CHROME DOWNLOADS ──────────────────────────────────────────────────────────

@app.route("/health")
def health():
    return jsonify({"status": "ok", "agent": "MOTSA API v1"})


@app.route("/chrome-downloads")
def chrome_downloads():
    if not CHROME_HISTORY.exists():
        return jsonify([])

    try:
        shutil.copy2(CHROME_HISTORY, TEMP_DB)
        conn   = sqlite3.connect(TEMP_DB)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, target_path, tab_url, referrer, start_time
            FROM downloads
            ORDER BY start_time DESC
            LIMIT 100
        """)
        rows = cursor.fetchall()
        conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    result = []
    for dl_id, target, tab_url, referrer, start_time in rows:
        if not (target and target.lower().endswith(".pdf")):
            continue
        p    = Path(target)
        size = ""
        if p.exists():
            sz = p.stat().st_size
            size = f"{sz//1024} Ko" if sz < 1_000_000 else f"{sz/1_000_000:.1f} Mo"

        dt   = chrome_time(start_time)
        src  = ""
        try:
            from urllib.parse import urlparse
            src = urlparse(tab_url or "").hostname or ""
        except Exception:
            pass

        result.append({
            "id":       dl_id,
            "name":     p.name,
            "path":     str(target),
            "source":   src,
            "date":     dt.strftime("%d %b %Y"),
            "size":     size,
            "exists":   p.exists(),
        })

    return jsonify(result)


# ── CERTIFY ───────────────────────────────────────────────────────────────────

@app.route("/certify", methods=["POST"])
def certify():
    body       = request.get_json()
    file_path  = Path(body.get("path", ""))
    file_name  = body.get("file_name", "")
    source_url = body.get("source_url", "")
    user_id    = body.get("user_id", "")

    if not file_path.exists():
        # Fichier supprimé entre la liste et la certification
        return jsonify({"error": f"Fichier introuvable : {file_path}"}), 400

    # 1. Token unique AVANT le certificat (QR code doit pointer vers la bonne URL)
    token      = secrets.token_urlsafe(16)
    verify_url = f"{VERIFY_BASE}?token={token}"

    # 2. Timestamp + chemin de sortie
    ts          = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_name = f"{file_path.stem}_MOTSA_{ts}.pdf"
    output_path = MOTSA_FOLDER / output_name

    # 3. Génère la page certificat (sans hash — il sera calculé après injection)
    cert_tmp = MOTSA_FOLDER / "tmp_cert.pdf"
    _make_cert_page(cert_tmp, {
        "name":       file_name or file_path.name,
        "source_url": source_url,
        "date":       datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "token":      token,
        "verify_url": verify_url,
    })

    # 4. Injection : original + page certificat → PDF certifié
    writer = PdfWriter()
    for page in PdfReader(str(file_path)).pages:
        writer.add_page(page)
    writer.add_page(PdfReader(str(cert_tmp)).pages[0])
    with open(output_path, "wb") as f:
        writer.write(f)
    cert_tmp.unlink(missing_ok=True)

    # 5. Hash calculé SUR le PDF certifié complet
    final_hash = sha256_path(output_path)

    # 6. Upload Supabase Storage
    storage_path = f"{user_id}/{output_name}"
    with open(output_path, "rb") as f:
        sb.storage.from_("documents").upload(
            storage_path, f,
            {"content-type": "application/pdf", "x-upsert": "true"}
        )
    file_url = sb.storage.from_("documents").get_public_url(storage_path)

    # 7. Insert documents
    doc = sb.table("documents").insert({
        "user_id":    user_id,
        "file_name":  file_name or file_path.name,
        "file_url":   file_url,
        "sha256":     final_hash,
        "source_url": source_url,
    }).execute()
    doc_id = doc.data[0]["id"]

    # 8. Insert certificates
    sb.table("certificates").insert({
        "document_id":        doc_id,
        "verification_token": token,
        "certificate_url":    verify_url,
    }).execute()

    return jsonify({
        "ok":         True,
        "hash":       final_hash,
        "token":      token,
        "verify_url": verify_url,
        "file_url":   file_url,
    })


# ── PAGE CERTIFICAT ───────────────────────────────────────────────────────────

def _make_cert_page(out_path: Path, info: dict):
    c = canvas.Canvas(str(out_path), pagesize=A4)
    w, h = A4

    # En-tête noir
    c.setFillColorRGB(.06, .06, .06)
    c.rect(0, h - 72, w, 72, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(40, h - 44, "MOTSA")
    c.setFont("Helvetica", 10)
    c.drawString(40, h - 62, "Certificate of Provenance · motsa.tech")

    # Intro
    c.setFillColorRGB(.06, .06, .06)
    c.setFont("Helvetica", 11)
    c.drawString(40, h - 105, "This certificate was generated at the moment of document capture.")
    c.drawString(40, h - 122, "It proves the origin and seals the integrity of the certified PDF.")

    # Séparateur
    c.setStrokeColorRGB(.88, .88, .87)
    c.line(40, h - 138, w - 40, h - 138)

    # Champs
    y = h - 170
    fields = [
        ("File name",        info["name"]),
        ("Source URL",       info["source_url"] or "—"),
        ("Capture time",     info["date"]),
        ("Verification URL", info["verify_url"]),
        ("Token",            info["token"]),
        ("Note", "SHA-256 computed on the complete certified PDF (original + this page)."),
    ]

    for label, value in fields:
        c.setFont("Helvetica-Bold", 9)
        c.setFillColorRGB(.55, .55, .55)
        c.drawString(40, y, label.upper())
        c.setFont("Helvetica", 10)
        c.setFillColorRGB(.06, .06, .06)
        display = str(value)
        if len(display) > 88:
            display = display[:85] + "..."
        c.drawString(170, y, display)
        c.setStrokeColorRGB(.92, .92, .91)
        c.line(40, y - 8, w - 40, y - 8)
        y -= 30

    # QR code
    qr_img  = qrcode.make(info["verify_url"])
    qr_buf  = io.BytesIO()
    qr_img.save(qr_buf, format="PNG")
    qr_buf.seek(0)
    c.drawImage(ImageReader(qr_buf), 40, 55, width=110, height=110)

    # Légende QR
    c.setFont("Helvetica-Bold", 11)
    c.setFillColorRGB(.06, .06, .06)
    c.drawString(168, 148, "Scan to verify provenance")
    c.setFont("Helvetica", 9)
    c.setFillColorRGB(.55, .55, .55)
    c.drawString(168, 132, "Any modification to this PDF invalidates the SHA-256.")
    c.drawString(168, 118, "The hash is stored on motsa.tech and cannot be altered.")

    # Pied
    c.setFont("Helvetica", 8)
    c.setFillColorRGB(.7, .7, .7)
    c.drawString(40, 30, f"MOTSA · motsa.tech · {info['date']}")

    c.save()


# ── MAIN ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("── MOTSA API ────────────────────────────────")
    print(f"  http://localhost:5001")
    print(f"  Dossier MOTSA : {MOTSA_FOLDER}")
    print("  CTRL+C pour arrêter")
    print("─────────────────────────────────────────────\n")
    app.run(host="127.0.0.1", port=5001, debug=False)