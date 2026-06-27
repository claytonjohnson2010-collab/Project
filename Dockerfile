FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Vendor Chart.js so the app works without outbound CDN access
RUN curl -fsSL https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js \
    -o /app/frontend/static/chart.min.js

ENV FRONTEND_DIR=/app/frontend
ENV DB_PATH=/data/metals.db
ENV PRICE_CACHE_TTL_MINUTES=15

VOLUME ["/data"]

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
