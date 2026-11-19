# The whiteboard on its own AWS server. deploy_aws.sh copies server.py, backend/
# and public/ into app/.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LIZA_STORE=0

WORKDIR /app
COPY app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ .

# One worker: her drawing code shares one picture file between requests (board._lock).
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8095", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*"]
