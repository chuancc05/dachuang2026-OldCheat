# OldCheat 启动说明

## 启动项目

在 PowerShell 中进入项目根目录：

```powershell
cd "C:\Users\22852\OneDrive\Desktop\Program\dachuang2026-Oldcheat\Old_cheat_github_link"
```

运行项目内置兼容启动器：

```powershell
D:\develop\python3.12\python.exe .\run_oldcheat.py
```

启动成功后访问：

```text
http://127.0.0.1:7860/
```

## 端口被占用时

查询 7860 端口占用：

```powershell
netstat -ano | findstr :7860
```

结束对应进程：

```powershell
taskkill /PID 进程号 /F
```

然后重新运行启动命令。

## 说明

`run_oldcheat.py` 用于兼容当前 Gradio 与 HuggingFace Hub 版本差异，避免直接启动时出现 `HfFolder` 或 API schema 相关报错。
