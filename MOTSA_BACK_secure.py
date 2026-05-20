"""
MOTSA API — backend local Flask
Tourne sur http://localhost:5001

Rôles :
  GET  /health              → status check depuis le dashboard
  GET  /chrome-downloads    → liste les PDF récents depuis l'historique Chrome
  POST /certify             → génère le PDF certifié, calcule le hash, uploade sur Supabase
  POST /verify-upload       → compare le hash du PDF uploadé avec Supabase

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



def format_birth_date(value: str) -> str:
    """Convertit YYYY-MM-DD en JJ/MM/AAAA quand possible."""
    if not value:
        return "—"
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").strftime("%d/%m/%Y")
    except Exception:
        return str(value)


def source_host(value: str) -> str:
    """Extrait le domaine d'une URL pour le certificat et les messages publics."""
    if not value:
        return "la source d’origine"
    try:
        from urllib.parse import urlparse
        return urlparse(value).hostname or value
    except Exception:
        return str(value)


def get_profile_for_user(user_id: str) -> dict:
    """Récupère le profil Supabase si le dashboard ne l'a pas transmis."""
    if not user_id:
        return {}
    try:
        res = sb.table("profiles").select("first_name,last_name,birth_date,full_name").eq("id", user_id).single().execute()
        return res.data or {}
    except Exception:
        return {}


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

    # ── Auth : valider le token Supabase ──────────────────────────────────────
    access_token = body.get("access_token", "")
    if not access_token:
        return jsonify({"error": "Token d'authentification manquant."}), 401
    try:
        user_res = sb.auth.get_user(access_token)
        if not user_res.user or user_res.user.id != user_id:
            return jsonify({"error": "Non autorisé : token invalide ou user_id incohérent."}), 401
    except Exception as e:
        return jsonify({"error": f"Échec de vérification du token : {e}"}), 401
    # ─────────────────────────────────────────────────────────────────────────

    profile = body.get("profile") or {}
    if not profile and user_id:
        profile = get_profile_for_user(user_id)

    first_name = str(profile.get("first_name", "") or "").strip()
    last_name  = str(profile.get("last_name", "") or "").strip()
    full_name  = str(profile.get("full_name", "") or "").strip()
    birth_date = str(profile.get("birth_date", "") or "").strip()

    if not full_name:
        full_name = f"{first_name} {last_name}".strip()

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
        "full_name": full_name,
        "birth_date": birth_date,
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



# ── PUBLIC VERIFY UPLOAD ──────────────────────────────────────────────────────

@app.route("/verify-upload", methods=["POST"])
def verify_upload():
    """
    Vérification publique : l'utilisateur dépose un PDF certifié.
    Le backend calcule le SHA-256 du fichier uploadé et le compare à Supabase.

    - Si un token est fourni dans l'URL QR, on compare d'abord avec le document lié à ce certificat.
    - Sans token, on cherche simplement si ce hash existe dans la base documents.
    """
    uploaded = request.files.get("file")
    token = (request.form.get("token") or "").strip()

    if not uploaded:
        return jsonify({"ok": False, "status": "missing_file", "message": "Aucun fichier reçu."}), 400

    # Calcul hash directement en mémoire, sans stocker le document uploadé
    h = hashlib.sha256()
    uploaded.stream.seek(0)
    for chunk in iter(lambda: uploaded.stream.read(8192), b""):
        h.update(chunk)
    uploaded_hash = h.hexdigest()

    try:
        # Cas QR : on vérifie le certificat précis lié au token
        if token:
            cert_res = sb.table("certificates").select("document_id,verification_token,certificate_url,created_at").eq("verification_token", token).single().execute()
            cert = cert_res.data
            if not cert:
                return jsonify({
                    "ok": False,
                    "status": "unknown_certificate",
                    "uploaded_hash": uploaded_hash,
                    "message": "Certificat introuvable."
                }), 404

            doc_res = sb.table("documents").select("id,user_id,file_name,file_url,sha256,source_url,created_at").eq("id", cert["document_id"]).single().execute()
            doc = doc_res.data
            if not doc:
                return jsonify({
                    "ok": False,
                    "status": "unknown_document",
                    "uploaded_hash": uploaded_hash,
                    "message": "Document lié au certificat introuvable."
                }), 404

            profile = get_profile_for_user(doc.get("user_id"))
            expected_hash = doc.get("sha256") or ""
            match = uploaded_hash == expected_hash
            host = source_host(doc.get("source_url"))
            return jsonify({
                "ok": match,
                "status": "match" if match else "mismatch",
                "message": f"Document authentique : il n’a pas été modifié depuis son téléchargement depuis {host}." if match else "Document probablement modifié : le hash ne correspond pas au certificat MOTSA.",
                "uploaded_hash": uploaded_hash,
                "expected_hash": expected_hash,
                "document": {
                    "file_name": doc.get("file_name"),
                    "file_url": doc.get("file_url"),
                    "source_url": doc.get("source_url"),
                    "created_at": doc.get("created_at"),
                },
                "certificate": {
                    "verification_token": cert.get("verification_token"),
                    "certificate_url": cert.get("certificate_url"),
                    "created_at": cert.get("created_at"),
                },
                "profile": {
                     "full_name": (
                         profile.get("full_name")
                         or f"{profile.get('first_name','')} {profile.get('last_name','')}".strip() 
                         or "Titulaire inconnu"),
            } })

        # Cas sans token : on cherche le hash dans toute la base
        doc_res = sb.table("documents").select("id,user_id,file_name,file_url,sha256,source_url,created_at").eq("sha256", uploaded_hash).limit(1).execute()
        docs = doc_res.data or []
        if not docs:
            return jsonify({
                "ok": False,
                "status": "not_found",
                "uploaded_hash": uploaded_hash,
                "message": "Document probablement modifié ou jamais certifié par MOTSA. Aucun hash correspondant dans la base."
            }), 200

        doc = docs[0]
        cert_res = sb.table("certificates").select("verification_token,certificate_url,created_at").eq("document_id", doc["id"]).limit(1).execute()
        certs = cert_res.data or []
        cert = certs[0] if certs else {}
        profile = get_profile_for_user(doc.get("user_id"))

        return jsonify({
            "ok": True,
            "status": "match",
            "message": f"Document authentique : il n’a pas été modifié depuis son téléchargement depuis {source_host(doc.get('source_url'))}.",
            "uploaded_hash": uploaded_hash,
            "expected_hash": doc.get("sha256"),
            "document": {
                "file_name": doc.get("file_name"),
                "file_url": doc.get("file_url"),
                "source_url": doc.get("source_url"),
                "created_at": doc.get("created_at"),
            },
            "certificate": {
                "verification_token": cert.get("verification_token"),
                "certificate_url": cert.get("certificate_url"),
                "created_at": cert.get("created_at"),
            },
            "profile": {
                "full_name": profile.get("full_name") or f"{profile.get('first_name','')} {profile.get('last_name','')}".strip(),
                "first_name": profile.get("first_name"),
                "last_name": profile.get("last_name"),
            }
        })

    except Exception as e:
        return jsonify({
            "ok": False,
            "status": "server_error",
            "uploaded_hash": uploaded_hash,
            "message": str(e)
        }), 500

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
    host = source_host(info.get("source_url"))
    c.drawString(40, h - 105, "This certificate was generated at the moment of document capture.")
    c.drawString(40, h - 122, f"Integrity statement: this PDF has not been modified since its download from {host}.")

    # Séparateur
    c.setStrokeColorRGB(.88, .88, .87)
    c.line(40, h - 138, w - 40, h - 138)

    # Champs
    y = h - 170
    fields = [
        ("File name",        info["name"]),
        ("Certified holder", info.get("full_name") or "—"),
        ("Source URL",       info["source_url"] or "—"),
        ("Capture time",     info["date"]),
        ("Verification URL", info["verify_url"]),
        ("Token",            info["token"]),
        ("Integrity", f"Not modified since download from {host}."),
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