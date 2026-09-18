#!/usr/bin/env python3
"""Проверка доступности источников из data/matriks.csv и data/sources_catalog.csv.

Для каждой ссылки:
  1. пробуем открыть (HEAD, затем GET) с обычным браузерным UA;
  2. если недоступна — ищем снапшот в Wayback Machine (CDX API) и печатаем его URL;
  3. итог — таблица + сводка.

Запуск:  python3 scripts/check_sources.py
Требования: только стандартная библиотека. Работает на машине с обычным
интернет-доступом (из песочницы агента исходящий трафик отрезан).
"""
import csv
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")


def http_status(url: str, timeout: int = 20) -> int:
    req = urllib.request.Request(url, headers={"User-Agent": UA,
                                               "Accept-Language": "ru,en;q=0.8"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0  # network error / blocked


def wayback_snapshot(url: str, timeout: int = 20) -> str:
    q = urllib.parse.quote(url, safe="")
    api = f"http://archive.org/wayback/available?url={q}"
    try:
        req = urllib.request.Request(api, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read().decode("utf-8", "replace"))
        snap = data.get("archived_snapshots", {}).get("closest", {})
        return snap.get("url", "")
    except Exception:
        return ""


def collect_urls():
    urls = {}  # url -> где встречается
    for rel in ("data/matriks.csv", "data/sources_catalog.csv"):
        p = ROOT / rel
        if not p.exists():
            continue
        with p.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                for field in ("url", "istochnik_url"):
                    v = (row.get(field) or "").strip()
                    if v.startswith("http"):
                        urls.setdefault(v, []).append(rel)
    # дубль из матрицы: некоторые строки держат URL в нескольких полях
    return urls


def main():
    urls = collect_urls()
    print(f"Всего уникальных ссылок: {len(urls)}\n")
    print(f"{'код':<6} {'wayback':<10} URL")
    ok = broken = 0
    for url, where in sorted(urls.items()):
        code = http_status(url)
        snap = ""
        if code not in (200, 301, 302, 303, 307, 308):
            snap = wayback_snapshot(url)
            time.sleep(1)  # вежливая пауза к archive.org
        if code in (200, 301, 302, 303, 307, 308):
            ok += 1
        else:
            broken += 1
        wb = ("да" if snap else "—")
        print(f"{code:<6} {wb:<10} {url}")
        if snap:
            print(f"{'':<6} {'снапшот':<10} {snap}")
        time.sleep(0.5)
    print(f"\nДоступно: {ok}, проблемно/мёртво: {broken}")
    if broken:
        print("Для проблемных ссылок используйте снапшоты Wayback "
              "(столбец wayback) — либо открывайте в обычном браузере "
              "(бот-защита избиркомов/VK часто срабатывает на скрипты).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
