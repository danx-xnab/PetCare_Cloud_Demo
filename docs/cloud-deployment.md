# 云部署说明

## 推荐部署拓扑

```text
用户浏览器
  -> Nginx / ECS 公网 IP
  -> PetCare API 容器
  -> PostgreSQL / MySQL
  -> OBS / MinIO 对象存储
  -> RocketMQ / AI Worker
  -> 定时任务 / FunctionGraph
```

## 与云计算技术的对应关系

| 云技术 | Demo 中的位置 | 上云后的替换方式 |
| --- | --- | --- |
| ECS | 本地 `server.py` | 部署到云服务器，Nginx 反向代理 |
| 数据库 | SQLite `data/petcare.db` | 替换为 MySQL 或 PostgreSQL |
| 对象存储 | `uploads/` 本地目录 | 替换为华为云 OBS 或 MinIO |
| Docker | `Dockerfile` + `docker-compose.yml` | 容器化部署，降低环境差异 |
| 消息队列 | 当前同步解析 | 接入 RocketMQ 后异步处理 LLM 任务 |
| 云函数 | 当前接口内生成提醒 | FunctionGraph 定时生成今日待办和健康周报 |
| LLM | OpenAI 兼容接口或规则兜底 | 接入 OpenAI、通义千问、智谱或 Ollama |

## ECS 演示命令

```bash
git clone <your-repo-url> PetCare_Cloud_Demo
cd PetCare_Cloud_Demo
docker compose up -d --build
```

Nginx 可反向代理到 `127.0.0.1:8000`，并配置 HTTPS。对象文件可迁移到 OBS：后端上传后保存 OBS URL 到 `pets.avatar_url`。
