# LibreOffice in a Cloudflare Container: turns filled certificate templates into PDFs for the WaterCare Worker.
FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends libreoffice-impress libreoffice-writer fontconfig fonts-liberation fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 HOME=/tmp
# Optional: put licensed font files (for example Trebuchet MS .ttf) in pdf-converter/fonts/ to match the templates.
COPY fonts/ /usr/share/fonts/truetype/watercare/
RUN fc-cache -f

COPY server.py /app/server.py
EXPOSE 8080
CMD ["python", "/app/server.py"]
