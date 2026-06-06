FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt \
    -i https://mirrors.huaweicloud.com/repository/pypi/simple \
    --trusted-host mirrors.huaweicloud.com

COPY . /app

ENV HOST=0.0.0.0
ENV PORT=8000

EXPOSE 8000
CMD ["python", "server.py", "--host", "0.0.0.0", "--port", "8000"]
