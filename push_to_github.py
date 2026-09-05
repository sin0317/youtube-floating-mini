import json, ssl, http.client, base64, sys, os, subprocess, socket
from urllib.parse import quote

# 1) 从 GCM 拿 token（不落盘）
def get_token():
    proc = subprocess.run(
        ["git", "credential", "fill"],
        input=b"protocol=https\nhost=github.com\n",
        capture_output=True, check=True,
    )
    for line in proc.stdout.splitlines():
        if line.startswith(b"password="):
            return line.split(b"=", 1)[1].decode()
    raise SystemExit("未拿到 GCM token")

token = get_token()
auth = "token " + token

# 2) 强制解析 GitHub 真实 IP（绕 hosts 劫持）
_real = socket.getaddrinfo
def fake(host, port, *a, **kw):
    table = {"api.github.com": "20.205.243.168",
             "uploads.github.com": "20.205.243.161",
             "raw.githubusercontent.com": "20.205.243.168"}
    if host in table and port in (443, 80):
        host = table[host]
    return _real(host, port, *a, **kw)
socket.getaddrinfo = fake

ctx = ssl.create_default_context()
ctx.check_hostname = True
ctx.verify_mode = ssl.CERT_REQUIRED

API = "api.github.com"
USER = "sin0317"
REPO = "youtube-floating-mini"

def req(method, path, body=None, host=API):
    c = http.client.HTTPSConnection(host, 443, context=ctx)
    headers = {"Authorization": auth, "User-Agent": "sin0317-scripts",
               "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    data = json.dumps(body).encode() if body is not None else None
    c.request(method, path, body=data, headers=headers)
    r = c.getresponse(); body = r.read()
    c.close()
    return r.status, json.loads(body) if body else {}

# 3) 建仓
print("[1/4] 创建仓库 ...")
st, resp = req("POST", f"/user/repos",
    {"name": REPO, "description": "YouTube 悬浮小窗播放器 — 自包含 Tampermonkey 脚本（拖拽/缩放/自动贴边/控制栏按钮）",
     "private": False, "auto_init": True})
if st == 201:
    print("  ✓ 已创建")
elif st == 422 and "name already exists" in json.dumps(resp):
    print("  · 仓库已存在，继续上传")
else:
    raise SystemExit(f"  ✗ {st}: {resp}")

# 4) 上传三个文件
files = {
    "README.md": open("D:/workspace/youtube-floating-mini/README.md","rb").read(),
    "LICENSE": open("D:/workspace/youtube-floating-mini/LICENSE","rb").read(),
    "YouTube悬浮小窗.user.js": open("D:/workspace/youtube-floating-mini/YouTube悬浮小窗.user.js","rb").read(),
    ".gitignore": open("D:/workspace/youtube-floating-mini/.gitignore","rb").read(),
}

def get_sha(path):
    st, resp = req("GET", f"/repos/{USER}/{REPO}/contents/{quote(path, safe='/')}")
    return resp.get("sha") if st == 200 else None

print("[2/4] 上传文件 ...")
for name, data in files.items():
    sha = get_sha(name)
    body = {"message": f"add {name}" if not sha else f"update {name}",
            "content": base64.b64encode(data).decode()}
    if sha: body["sha"] = sha
    st, resp = req("PUT", f"/repos/{USER}/{REPO}/contents/{quote(name, safe='/')}", body)
    ok = "✓" if st in (200, 201) else "✗"
    print(f"  {ok} {name}: {st}")
    if st not in (200, 201): print("    ", resp)

# 5) 设 topics
print("[3/4] 设置 topics ...")
st, resp = req("PUT", f"/repos/{USER}/{REPO}/topics",
    {"names": ["tampermonkey", "userscript", "youtube", "floating-player",
               "picture-in-picture", "self-contained"]})
print(f"  {'✓' if st==200 else '✗'} {st}")

# 6) 拉回仓库信息
print("[4/4] 确认 ...")
st, repo = req("GET", f"/repos/{USER}/{REPO}")
print(f"  仓库：https://github.com/{USER}/{REPO}")
print(f"  描述：{repo.get('description')}")
print(f"  topics：{repo.get('topics')}")
print(f"  star：{repo.get('stargazers_count')}  fork：{repo.get('forks_count')}")