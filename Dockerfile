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
RUN sed -i 's/\r$//' start.sh

EXPOSE 10000
# start.sh runs the database upgrade and admin setup, then gunicorn (long timeout for PDF conversion).
CMD ["sh", "start.sh"]
