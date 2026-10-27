FROM python:3.12-slim

# LibreOffice turns the filled certificate (.pptx / .docx) into a PDF.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libreoffice-impress libreoffice-writer fontconfig fonts-liberation fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HOME=/tmp
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

EXPOSE 10000
# Render sets PORT; the long timeout leaves room for PDF conversion.
CMD ["sh", "-c", "gunicorn main:app --bind 0.0.0.0:${PORT:-10000} --workers 2 --timeout 180"]
