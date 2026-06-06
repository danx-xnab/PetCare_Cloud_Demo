# PetCare Cloud 云端部署说明

本项目推荐采用“ECS + Docker + Nginx + HTTPS + LLM API”的方式部署。这个方案改动少、稳定，适合课程实践作业演示，也能清楚体现云计算架构。

## 部署拓扑

```text
用户浏览器
  -> 域名 / HTTPS
  -> Nginx 反向代理
  -> PetCare Cloud Docker 容器
  -> SQLite 数据库文件 / 后续可替换 RDS
  -> uploads 本地目录 / 后续可替换 OBS
  -> OpenAI 兼容 LLM API
```

## 云资源清单

| 云资源 | 当前部署方式 | 后续可扩展方式 |
| --- | --- | --- |
| ECS 云服务器 | 运行 Docker 容器和 Nginx | 横向扩容为多台 ECS |
| 数据库 | SQLite，挂载到 `./data` | 替换为 RDS MySQL/PostgreSQL |
| 对象存储 | 头像保存到 `./uploads` | 替换为 OBS/OSS/COS |
| LLM 服务 | 通过环境变量配置 OpenAI 兼容 API | 可切换通义千问、智谱、DeepSeek 等兼容接口 |
| HTTPS | Nginx + Certbot 证书 | 接入云厂商 SSL 证书服务 |
| CI/CD | 手动 `git pull` + `docker compose` | 后续可接 GitHub Actions |

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
sudo apt install -y git docker.io docker-compose-plugin nginx certbot python3-certbot-nginx
sudo systemctl enable --now docker
sudo systemctl enable --now nginx
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

## 5. 启动服务

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
2. Nginx 提供统一入口，并通过 HTTPS 保证浏览器语音输入和 API 调用安全。
3. SQLite 数据和 uploads 文件通过 volume 持久化，后续可平滑迁移到 RDS 和对象存储。
4. LLM API Key 通过环境变量注入，不进入 GitHub，符合密钥安全要求。
5. 当前同步调用 LLM，后续可扩展消息队列和异步 Worker，提升高并发下的稳定性。

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

### 可以换成云数据库吗

可以，但当前后端使用 SQLite 标准库。如果改 RDS，需要引入 MySQL/PostgreSQL 驱动并改造数据访问层。课程 demo 阶段建议先用 SQLite 持久化，汇报中说明 RDS 是后续扩展方向。
