"""Inside the container: POST a .pptx or .docx body (header X-File-Type) to /convert and get the PDF back.

Only the WaterCare Worker can reach this, through the watercare-pdf Worker's service binding; it is not public.
"""
import os
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MAX_BYTES = 15 * 1024 * 1024
TIMEOUT_SECONDS = 120


def convert(data, extension):
    with tempfile.TemporaryDirectory() as folder:
        source = Path(folder, f"certificate.{extension}")
        source.write_bytes(data)
        profile = Path(folder, "profile").as_uri()
        subprocess.run(
            ["soffice", f"-env:UserInstallation={profile}", "--headless", "--convert-to", "pdf", "--outdir", folder, str(source)],
            stdin=subprocess.DEVNULL, capture_output=True, timeout=TIMEOUT_SECONDS, check=False,
        )
        target = Path(folder, "certificate.pdf")
        return target.read_bytes() if target.is_file() else None


class Handler(BaseHTTPRequestHandler):
    def _reply(self, status, body, content_type="text/plain"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._reply(200, b"ok")

    def do_POST(self):
        extension = self.headers.get("X-File-Type", "")
        length = int(self.headers.get("Content-Length") or 0)
        if self.path != "/convert" or extension not in {"pptx", "docx"}:
            return self._reply(400, b"POST a .pptx or .docx to /convert with X-File-Type.")
        if not 0 < length <= MAX_BYTES:
            return self._reply(413, b"The file must be between 1 byte and 15 MB.")
        pdf = convert(self.rfile.read(length), extension)
        if not pdf or not pdf.startswith(b"%PDF"):
            return self._reply(422, b"LibreOffice could not convert this file.")
        self._reply(200, pdf, "application/pdf")

    def log_message(self, fmt, *args):
        print("pdf-converter:", fmt % args, flush=True)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), Handler).serve_forever()
