# PetCare Cloud 云端部署说明

本项目推荐采用“ECS + Docker + Nginx + HTTPS + LLM API”的方式部署。这个方案改动少、稳定，适合课程实践作业演示，也能清楚体现云计算架构。

## 部署拓扑

```text
用户浏览器
  -> 公网 IP:8000 / 后续可升级为域名 HTTPS
  -> PetCare Cloud Docker 容器
  -> SQLite 数据库文件
  -> 华为云 OBS 对象存储
  -> OpenAI 兼容 LLM API
```

后续生产化拓扑：

```text
用户浏览器
  -> 域名 / HTTPS / Nginx 反向代理
  -> PetCare Cloud Docker 容器
  -> RDS 云数据库
  -> OBS 对象存储
  -> 消息队列 / 异步 Worker
  -> 云函数 / 定时任务
  -> OpenAI 兼容 LLM API
```

## 本次实际部署记录

| 项目 | 实际配置 |
| --- | --- |
| 云服务器 | 华为云 ECS |
| 系统 | Ubuntu 22.04 server 64bit |
| 规格 | 2 vCPU / 2 GiB |
| 访问方式 | 公网 IP + `8000` 端口 |
| 运行方式 | Docker 容器 `petcare-cloud-demo` |
| 数据库 | SQLite，挂载到 ECS 的 `/opt/PetCare_Cloud_Demo/data` |
| 对象存储 | 华为云 OBS 桶 `cloudhw2`，区域 `cn-north-4` |
| 上传路径 | `petcare-uploads/` |
| 密钥管理 | `.env` 环境变量注入，`.env` 不进入 GitHub |

## 云资源清单

| 云资源 | 当前部署方式 | 后续可扩展方式 |
| --- | --- | --- |
| ECS 云服务器 | 运行 Docker 容器 | 横向扩容为多台 ECS，并由负载均衡分发流量 |
| 数据库 | SQLite，挂载到 `./data` | 替换为 RDS MySQL/PostgreSQL |
| 对象存储 | 头像上传到华为云 OBS | 配置 CDN、生命周期规则和更细粒度权限 |
| LLM 服务 | 通过环境变量配置 OpenAI 兼容 API | 可切换通义千问、智谱、DeepSeek 等兼容接口 |
| 容器化 | Dockerfile 构建镜像，容器运行服务 | 可推送到 SWR 镜像仓库 |
| HTTPS | 当前使用公网 IP 测试 | 后续接入 Nginx + Certbot 或云厂商 SSL 证书 |
| CI/CD | 手动 `git pull` + `docker compose` | 后续可接 GitHub Actions |
| 消息队列 | 当前同步调用 LLM | 后续将聊天记录写入队列，由 Worker 异步解析 |
| 云函数 | 当前后端同步生成提醒 | 后续用定时云函数生成健康周报和每日提醒 |

## 1. 准备 ECS

建议配置：

- 操作系统：Ubuntu 22.04 LTS 或 Ubuntu 24.04 LTS
- 配置：2 vCPU / 2 GB 内存即可演示
- 安全组：开放 `22`、`80`、`443`
- 临时调试：如果不配 Nginx，可临时开放 `8000`

语音输入建议使用 HTTPS 访问。很多浏览器会限制非 HTTPS 页面使用麦克风或语音识别服务。

## 2. 安装基础环境

```bash
sudo apt update
sudo apt install -y git docker.io nginx certbot python3-certbot-nginx
sudo systemctl enable --now docker
sudo systemctl enable --now nginx
```

如果系统源中可以安装 Docker Compose 插件，也可以额外执行：

```bash
sudo apt install -y docker-compose-plugin
```

如果当前用户没有 Docker 权限，可以执行：

```bash
sudo usermod -aG docker $USER
```

然后重新登录服务器。

## 3. 拉取项目代码

```bash
git clone https://github.com/danx-xnab/PetCare_Cloud_Demo.git
cd PetCare_Cloud_Demo
```

后续更新代码：

```bash
git pull origin main
docker compose up -d --build
```

如果云服务器访问 GitHub 不稳定，可以先重试：

```bash
git config --global http.version HTTP/1.1
git clone --depth 1 https://github.com/danx-xnab/PetCare_Cloud_Demo.git
```

## 4. 配置 LLM API Key

不要把 API Key 写进代码或提交到 GitHub。云服务器上使用 `.env` 文件：

```bash
cp .env.example .env
nano .env
```

示例：

```env
OPENAI_API_KEY=你的 API Key
OPENAI_BASE_URL=https://api.openai.com/v1
PETCARE_LLM_MODEL=gpt-4.1-mini
PETCARE_USE_SYSTEM_PROXY=
```

如果使用其他 OpenAI 兼容接口，只需要替换 `OPENAI_BASE_URL` 和 `PETCARE_LLM_MODEL`。

## 4.1 配置 OBS 对象存储

头像默认保存到 ECS 本地 `uploads/` 目录。如果要接入华为云 OBS，在 `.env` 中增加：

```env
PETCARE_STORAGE=obs
OBS_BUCKET=cloudhw2
OBS_ENDPOINT=https://obs.cn-north-4.myhuaweicloud.com
OBS_ACCESS_KEY_ID=你的 OBS AK
OBS_SECRET_ACCESS_KEY=你的 OBS SK
OBS_PREFIX=petcare-uploads
```

注意：

- AK/SK 不要提交到 GitHub。
- 当前桶如果设置为公开读，上传后的头像 URL 可以直接被浏览器访问。
- 华北-北京四对应区域为 `cn-north-4`，Endpoint 为 `https://obs.cn-north-4.myhuaweicloud.com`。
- 如果不想启用 OBS，把 `PETCARE_STORAGE` 改回 `local` 即可。

## 5. 启动服务

### 方式 A：Docker Compose

```bash
docker compose up -d --build
```

查看运行状态：

```bash
docker compose ps
docker compose logs -f
```

本机测试：

```bash
curl http://127.0.0.1:8000/api/state
```

如果返回 JSON，说明后端已启动。

### 方式 B：Docker 命令部署

如果服务器没有 `docker compose` 插件，可以直接使用 Docker 命令：

```bash
docker build -t petcare-cloud-demo .

docker rm -f petcare-cloud-demo 2>/dev/null || true

docker run -d \
  --name petcare-cloud-demo \
  --restart unless-stopped \
  -p 8000:8000 \
  --env-file /opt/PetCare_Cloud_Demo/.env \
  -v /opt/PetCare_Cloud_Demo/data:/app/data \
  -v /opt/PetCare_Cloud_Demo/uploads:/app/uploads \
  petcare-cloud-demo
```

检查：

```bash
docker ps
docker logs --tail 30 petcare-cloud-demo
curl -I http://127.0.0.1:8000/
```

如果 Docker Hub 拉取 `python:3.11-slim` 超时，可以先用华为云镜像源拉取基础镜像并打本地标签：

```bash
docker pull swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/python:3.11-slim
docker tag swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/python:3.11-slim python:3.11-slim
docker build -t petcare-cloud-demo .
```

## 6. 配置 Nginx 反向代理

创建配置：

```bash
sudo nano /etc/nginx/sites-available/petcare-cloud
```

写入以下内容，把 `your-domain.com` 换成自己的域名：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/petcare-cloud /etc/nginx/sites-enabled/petcare-cloud
sudo nginx -t
sudo systemctl reload nginx
```

如果暂时没有域名，可以先通过 `http://服务器公网IP:8000` 测试，但最终演示建议配置域名和 HTTPS。

## 7. 配置 HTTPS

域名解析到 ECS 公网 IP 后，执行：

```bash
sudo certbot --nginx -d your-domain.com
```

成功后访问：

```text
https://your-domain.com
```

## 8. 数据持久化与备份

`docker-compose.yml` 已经挂载：

```text
./data    -> SQLite 数据库
./uploads -> 宠物头像和上传文件
```

备份命令：

```bash
tar -czf petcare-backup-$(date +%F).tar.gz data uploads .env
```

恢复时解压到项目目录后重新启动容器：

```bash
docker compose up -d --build
```

## 9. 课堂演示讲法

可以这样介绍云计算部分：

1. 项目通过 Docker 容器部署到 ECS，解决本地环境差异问题。
2. 容器通过 `--restart unless-stopped` 自动重启，提升演示稳定性。
3. SQLite 数据通过 volume 挂载到 ECS，后续可平滑迁移到 RDS。
4. 用户上传宠物头像后，后端将图片上传到华为云 OBS，数据库保存对象 URL。
5. LLM API Key 和 OBS AK/SK 通过环境变量注入，不进入 GitHub，符合密钥安全要求。
6. 当前同步调用 LLM，后续可扩展消息队列和异步 Worker，提升高并发下的稳定性。
7. 后续可以加入 Nginx + HTTPS，保证公网访问安全，并解决浏览器麦克风权限限制。

## 10. 常见问题

### 页面能打开，但 AI 没有回复

检查 `.env` 是否填写 API Key，并重启容器：

```bash
docker compose restart
docker compose logs -f
```

也可以访问：

```text
/api/llm/status
```

查看当前 LLM 是否已连接。

### 语音识别报错

优先检查是否使用 HTTPS。浏览器语音识别依赖浏览器能力和网络环境，和后端 API Key 不是同一个东西。

### 上传头像后重启丢失吗

不会。`uploads/` 已挂载到宿主机目录，只要不删除服务器上的项目目录，文件会保留。

如果已配置 `PETCARE_STORAGE=obs`，新上传的头像会保存到 OBS 桶中，数据库保存的是 OBS 对象访问 URL。

### 可以换成云数据库吗

可以，但当前后端使用 SQLite 标准库。如果改 RDS，需要引入 MySQL/PostgreSQL 驱动并改造数据访问层。课程 demo 阶段建议先用 SQLite 持久化，汇报中说明 RDS 是后续扩展方向。
