# PetCare Cloud Demo

基于云服务与 LLM 的多宠物智能管理平台 demo。项目来自《PetCare Cloud 项目想法可行性说明》，用于课程实践作业的演示环节。

## 已实现功能

- 模拟登录：默认账号 `demo`，密码 `123456`
- 多宠物档案：新增宠物、查看基础资料、上传头像
- 聊天式记录：输入自然语言后自动生成结构化 JSON
- 健康日志：自动保存饮食、用药、健康异常、疫苗、驱虫等记录
- 提醒任务：自动生成观察、用药、疫苗或驱虫提醒
- 养宠推荐：根据居住空间、预算、陪伴时间生成推荐结果
- 云架构展示：ECS、数据库、OBS、AI Worker、提醒任务的状态面板
- 云端部署：已支持华为云 ECS + Docker 容器化运行，头像可选上传到华为云 OBS
- 云函数：支持华为云 FunctionGraph 触发每日护理摘要，并在云架构页展示执行结果
- 消息队列：内置 SQLite 本地队列模拟，用于演示 DMS/RocketMQ 的入队和 Worker 消费链路

## 本地运行

```powershell
python server.py --host 127.0.0.1 --port 8000
```

浏览器访问：

```text
http://127.0.0.1:8000
```

如果本机没有 `python` 命令，可使用系统安装的 Python 3.10+。不启用 OBS 时，本 demo 后端仅依赖 Python 标准库；启用 OBS 时需要安装 `requirements.txt` 中的华为云 OBS SDK。

## LLM 接入方式

默认情况下，系统使用规则解析器兜底，保证课堂演示稳定。如果要接入 OpenAI 兼容接口，设置环境变量后重启服务：

```powershell
$env:OPENAI_API_KEY="你的 API Key"
$env:OPENAI_BASE_URL="https://api.openai.com/v1"
$env:PETCARE_LLM_MODEL="gpt-4.1-mini"
python server.py --host 127.0.0.1 --port 8000
```

后端 LLM 请求默认忽略系统代理，避免被无效的 `HTTP_PROXY` / `HTTPS_PROXY` 拦截。如果确实需要走系统代理，可额外设置：

```powershell
$env:PETCARE_USE_SYSTEM_PROXY="1"
```

不同 LLM 任务可单独调整超时时间，单位为秒：

```powershell
$env:PETCARE_LLM_CHAT_TIMEOUT="30"
$env:PETCARE_LLM_RECOMMEND_TIMEOUT="60"
$env:PETCARE_LLM_SUMMARY_TIMEOUT="45"
$env:PETCARE_LLM_TEST_TIMEOUT="20"
```

模型输出被约束为固定 JSON，后端再写入 `ChatMessage`、`HealthLog` 和 `Reminder`。

## Docker 部署

```powershell
docker compose up --build
```

部署到云服务器时，可将端口 `8000` 交给 Nginx 反向代理。当前项目已支持通过环境变量开启华为云 OBS：

```env
PETCARE_STORAGE=obs
OBS_BUCKET=cloudhw2
OBS_ENDPOINT=https://obs.cn-north-4.myhuaweicloud.com
OBS_ACCESS_KEY_ID=你的 OBS AK
OBS_SECRET_ACCESS_KEY=你的 OBS SK
OBS_PREFIX=petcare-uploads
```

完整部署步骤见 `docs/cloud-deployment.md`。

## 演示路径

1. 登录 `demo / 123456`
2. 在宠物档案页查看“小橘”和“豆豆”，可新增一只宠物
3. 给宠物上传头像，说明 demo 本地保存，云端可替换为 OBS
4. 进入聊天式记录页，发送：`小橘今天晚上吐了一次，没怎么吃饭，明天早上提醒我观察一下`
5. 展示结构化 JSON、健康日志和自动提醒
6. 再发送：`豆豆今晚八点吃了药，明晚还要再吃一次`
7. 展示首页待办、提醒管理、云架构页面

## 项目结构

```text
PetCare_Cloud_Demo/
  server.py              # Python 标准库后端 + SQLite + 规则/LLM 解析
  static/
    index.html           # 单页 Web UI
    styles.css           # 界面样式
    app.js               # 前端交互逻辑
  data/                  # SQLite 数据库目录，首次运行自动生成
  uploads/               # 头像和证明文件目录
  docs/
    cloud-deployment.md  # 云部署说明
    demo-report-notes.md # 汇报要点
  Dockerfile
  docker-compose.yml
```
