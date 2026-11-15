"""ApplyMate Word helper (Chrome native messaging host).

Chrome starts this only when ApplyMate asks for an exact PDF. It receives a .docx, has Microsoft Word
convert it to PDF (read-only, invisible), and sends the PDF back. Nothing else: no network, no other files.
Protocol: 4-byte little-endian length + UTF-8 JSON, both directions (Chrome native messaging).
"""
import base64
import json
import os
import struct
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CHUNK = 600_000  # Chrome accepts at most 1 MB per message from a host; send big PDFs in pieces


def read_message():
    head = sys.stdin.buffer.read(4)
    if len(head) < 4:
        return None
    (n,) = struct.unpack("<I", head)
    data = b""
    while len(data) < n:
        part = sys.stdin.buffer.read(n - len(data))
        if not part:
            return None
        data += part
    return json.loads(data.decode("utf-8"))


def send(obj):
    b = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(b)))
    sys.stdout.buffer.write(b)
    sys.stdout.buffer.flush()


def run_word(src, out):
    """Convert with Word through PowerShell COM. Returns (ok, error)."""
    ps = os.path.join(HERE, "word2pdf.ps1")
    p = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ps, "-Src", src, "-Out", out],
        capture_output=True, text=True, timeout=120, creationflags=0x08000000,  # CREATE_NO_WINDOW
    )
    if p.returncode != 0 or not os.path.exists(out):
        return False, (p.stderr or p.stdout or "Word conversion failed").strip()[-500:]
    return True, ""


def main():
    msg = read_message()
    if msg is None:
        return
    action = msg.get("action")
    if action == "ping":
        send({"ok": True, "version": 1})
        return
    if action != "docx2pdf":
        send({"ok": False, "error": "unknown action"})
        return
    tmp = tempfile.mkdtemp(prefix="applymate_")
    src = os.path.join(tmp, "resume.docx")
    out = os.path.join(tmp, "resume.pdf")
    try:
        with open(src, "wb") as f:
            f.write(base64.b64decode(msg["data"]))
        ok, err = run_word(src, out)
        if not ok:
            send({"ok": False, "error": err})
            return
        with open(out, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("ascii")
        parts = [b64[i:i + CHUNK] for i in range(0, len(b64), CHUNK)] or [""]
        for i, part in enumerate(parts):
            send({"ok": True, "index": i, "total": len(parts), "data": part})
    except Exception as e:  # report, never hang Chrome
        send({"ok": False, "error": str(e)[-500:]})
    finally:
        for name in ("resume.docx", "resume.pdf"):
            try:
                os.remove(os.path.join(tmp, name))
            except OSError:
                pass
        try:
            os.rmdir(tmp)
        except OSError:
            pass


if __name__ == "__main__":
    main()
