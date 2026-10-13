"""Pull Junos configs for a list of devices from your config API into a Batfish snapshot folder.

Usage:
  export CONFIG_API_HOST=http://<host>:4000
  export CONFIG_API_EMAIL=...   CONFIG_API_PASSWORD=...
  python pull_configs.py nodes.txt          # nodes.txt = one device NAME per line

Writes snapshot/configs/<NAME>.cfg  (Batfish's required layout).
Configs contain secrets/hashes: keep this folder local, never commit it.
"""
import os
import sys
import pathlib
import requests

HOST = os.environ["CONFIG_API_HOST"].rstrip("/")
EMAIL = os.environ["CONFIG_API_EMAIL"]
PASSWORD = os.environ["CONFIG_API_PASSWORD"]

OUT = pathlib.Path(__file__).parent / "snapshot" / "configs"
OUT.mkdir(parents=True, exist_ok=True)

s = requests.Session()
r = s.post(f"{HOST}/users/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
r.raise_for_status()
s.headers["Authorization"] = f"Bearer {r.json()['token']}"


def device_ip(name):
    r = s.get(f"{HOST}/devices", params={"search": name}, timeout=30)
    r.raise_for_status()
    for d in r.json().get("devices", []):
        if d["name"].lower() == name.lower():
            return d["ip"]
    return None


def download_config(ip):
    r = s.get(f"{HOST}/switch-configurations", params={"search": ip}, timeout=30)
    r.raise_for_status()
    match = next((i for i in r.json().get("items", []) if i.get("ip") == ip), None)  # exact IP only
    if not match:
        return None
    r = s.get(f"{HOST}/switch-configurations/{match['id']}/download", timeout=60)
    r.raise_for_status()
    return r.text


names = [l.strip() for l in open(sys.argv[1]) if l.strip() and not l.startswith("#")]
for name in names:
    ip = device_ip(name)
    if not ip:
        print(f"[skip] {name}: not found in /devices")
        continue
    cfg = download_config(ip)
    if not cfg:
        print(f"[skip] {name} ({ip}): no config stored")
        continue
    (OUT / f"{name}.cfg").write_text(cfg)
    print(f"[ok]   {name}: {len(cfg.splitlines())} lines")
