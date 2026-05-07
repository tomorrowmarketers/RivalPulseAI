FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY apps/api/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY apps/api/src /app/src
COPY README.md /app/README.md
COPY .env.example /app/.env.example

ENV PYTHONPATH=/app/src

CMD ["uvicorn", "competitor_intel.main:app", "--host", "0.0.0.0", "--port", "8410"]
