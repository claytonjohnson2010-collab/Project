FROM python:3.12-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY frontend/ ./frontend/

ENV FRONTEND_DIR=/app/frontend
ENV DB_PATH=/data/metals.db
ENV PRICE_CACHE_TTL_MINUTES=15

VOLUME ["/data"]

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
