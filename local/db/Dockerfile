FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1
RUN pip install --no-cache-dir boto3

WORKDIR /app
COPY local_db.py .

CMD ["python", "local_db.py"]
