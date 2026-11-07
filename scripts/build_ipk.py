#!/usr/bin/env python3
"""Package the webOS app folder into an .ipk (same layout ares-package produces).

Usage: python3 scripts/build_ipk.py [webos_dir] [out_dir]
"""
import io
import json
import os
import sys
import tarfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "webos"))
OUT = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "dist"))
EXCLUDE = {".gitignore", ".DS_Store"}


def tar_gz(entries):
    """entries: list of (arcname, bytes or None for directory)."""
    buf = io.BytesIO()
    now = int(time.time())
    with tarfile.open(fileobj=buf, mode="w:gz", format=tarfile.GNU_FORMAT) as tf:
        for name, data in entries:
            info = tarfile.TarInfo(name)
            info.mtime = now
            info.uid = info.gid = 0
            info.uname = info.gname = "root"
            if data is None:
                info.type = tarfile.DIRTYPE
                info.mode = 0o755
                tf.addfile(info)
            else:
                info.mode = 0o644
                info.size = len(data)
                tf.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def ar_archive(members):
    out = io.BytesIO()
    out.write(b"!<arch>\n")
    now = int(time.time())
    for name, data in members:
        header = (
            f"{name:<16}{now:<12}{0:<6}{0:<6}{'100644':<8}{len(data):<10}`\n"
        ).encode()
        assert len(header) == 60
        out.write(header)
        out.write(data)
        if len(data) % 2:
            out.write(b"\n")
    return out.getvalue()


def main():
    with open(os.path.join(SRC, "appinfo.json"), encoding="utf-8") as f:
        info = json.load(f)
    app_id, version = info["id"], info["version"]

    app_dir = f"./usr/palm/applications/{app_id}"
    pkg_dir = f"./usr/palm/packages/{app_id}"
    entries = [(d, None) for d in ("./usr", "./usr/palm", "./usr/palm/applications",
                                   app_dir, "./usr/palm/packages", pkg_dir)]
    total = 0
    for dirpath, dirnames, filenames in os.walk(SRC):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith(".") and d != "node_modules")
        rel = os.path.relpath(dirpath, SRC)
        if rel != ".":
            entries.append((f"{app_dir}/{rel}", None))
        for fn in sorted(filenames):
            if fn in EXCLUDE or fn.endswith(".ipk"):
                continue
            with open(os.path.join(dirpath, fn), "rb") as f:
                data = f.read()
            total += len(data)
            arc = f"{app_dir}/{fn}" if rel == "." else f"{app_dir}/{rel}/{fn}"
            entries.append((arc, data))

    packageinfo = json.dumps({"app": app_id, "id": app_id, "loc_name": info.get("title", app_id),
                              "package_format_version": 2, "vendor": info.get("vendor", ""),
                              "version": version}, indent=2).encode()
    entries.append((f"{pkg_dir}/packageinfo.json", packageinfo))

    control = (
        f"Package: {app_id}\n"
        f"Version: {version}\n"
        "Section: misc\n"
        "Priority: optional\n"
        "Architecture: all\n"
        f"Installed-Size: {total // 1024 + 1}\n"
        f"Maintainer: {info.get('vendor', 'N/A')}\n"
        f"Description: {info.get('title', app_id)}\n"
        "webOS-Package-Format-Version: 2\n"
        "webOS-Packager-Version: x.y.x\n"
    ).encode()

    ipk = ar_archive([
        ("debian-binary", b"2.0\n"),
        ("control.tar.gz", tar_gz([(".", None), ("./control", control)])),
        ("data.tar.gz", tar_gz(entries)),
    ])
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{app_id}_{version}_all.ipk")
    with open(path, "wb") as f:
        f.write(ipk)
    print(path, len(ipk), "bytes")


if __name__ == "__main__":
    main()
