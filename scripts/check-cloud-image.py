import json
import os
import secrets
import subprocess
import sys
import time
import urllib.request


image = sys.argv[1]
name = "workmates-cloud-check-" + secrets.token_hex(6)
volume = name + "-data"
key = secrets.token_hex(32)
env = {**os.environ, "WORKMATES_SERVER_TOKEN": key}

try:
    subprocess.run(
        ["docker", "run", "-d", "--name", name, "-p", "127.0.0.1::8080",
         "-v", volume + ":/data", "-e", "WORKMATES_SERVER_TOKEN", image],
        env=env, check=True, stdout=subprocess.DEVNULL,
    )
    port = subprocess.check_output(
        ["docker", "port", name, "8080/tcp"], text=True,
    ).strip().rsplit(":", 1)[1]
    url = "http://127.0.0.1:" + port
    for attempt in range(60):
        try:
            with urllib.request.urlopen(url + "/api/health", timeout=2) as response:
                assert json.load(response)["app"] == "workmates"
            break
        except Exception:
            if attempt == 59:
                raise
            time.sleep(1)

    def get(path):
        request = urllib.request.Request(
            url + path, headers={"Authorization": "Bearer " + key},
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.load(response)

    bots = get("/api/bots")["bots"]
    assert len(bots) == 1 and bots[0]["name"] == "Nova"
    instances = get("/api/instances")
    if isinstance(instances, dict):
        instances = instances["instances"]
    assert all(item["snapshot"]["state"] != "available" for item in instances)
    with urllib.request.urlopen(url, timeout=10) as response:
        assert response.status == 200
        assert 'id="root"' in response.read().decode()
    subprocess.run(["docker", "exec", name, "test", "-f", "/app/LICENSE"], check=True)
    print("Container health, authenticated API, fresh workspace and web client passed")
finally:
    subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, check=False)
    subprocess.run(["docker", "volume", "rm", volume], stdout=subprocess.DEVNULL, check=False)
