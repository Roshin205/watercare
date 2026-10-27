"""Turn a filled PowerPoint or Word certificate into a PDF using software installed on the machine.

Order tried: LibreOffice (any platform), then Microsoft PowerPoint / Word on Windows.
"""
import os
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

TIMEOUT_SECONDS = 120
_lock = threading.Lock()  # Office programs convert one file at a time
WINDOWS_APPS = {
    "pptx": ("PowerPoint.Application", "$d=$app.Presentations.Open($env:WC_IN,-1,0,0); $d.SaveAs($env:WC_OUT,32); $d.Close()"),
    "docx": ("Word.Application", "$d=$app.Documents.Open($env:WC_IN,$false,$true); $d.SaveAs([ref]$env:WC_OUT,[ref]17); $d.Close()"),
}


class PdfUnavailable(Exception):
    """No converter is installed, or it failed."""


def _libreoffice():
    found = shutil.which("soffice") or shutil.which("libreoffice")
    if found:
        return found
    for base in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)")):
        candidate = Path(base or "", "LibreOffice", "program", "soffice.exe")
        if base and candidate.is_file():
            return str(candidate)
    return None


def _run(command, **extra):
    return subprocess.run(
        command, stdin=subprocess.DEVNULL, capture_output=True, timeout=TIMEOUT_SECONDS, **extra
    )


def _with_libreoffice(office, source, folder):
    profile = Path(folder, "profile").as_uri()
    _run([office, f"-env:UserInstallation={profile}", "--headless", "--convert-to", "pdf", "--outdir", str(folder), str(source)])


def _with_windows_office(extension, source, target):
    if os.name != "nt":
        return
    program, steps = WINDOWS_APPS[extension]
    script = f"$app=New-Object -ComObject {program}; try {{ {steps} }} finally {{ $app.Quit() }}"
    env = {**os.environ, "WC_IN": str(source), "WC_OUT": str(target)}
    _run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], env=env)


def convert_to_pdf(data, extension):
    with _lock, tempfile.TemporaryDirectory() as folder:
        source = Path(folder, f"certificate.{extension}")
        target = Path(folder, "certificate.pdf")
        source.write_bytes(data)
        office = _libreoffice()
        try:
            if office:
                _with_libreoffice(office, source, folder)
            if not target.is_file():
                _with_windows_office(extension, source, target)
        except (OSError, subprocess.SubprocessError) as error:
            raise PdfUnavailable(str(error))
        if not target.is_file() or not target.read_bytes().startswith(b"%PDF"):
            raise PdfUnavailable("No PDF converter (LibreOffice or Microsoft Office) is available on this computer.")
        return target.read_bytes()
