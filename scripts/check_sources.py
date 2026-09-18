#!/usr/bin/env python3
"""Проверка ссылок и структуры источников матрицы.

По умолчанию скрипт пытается открыть все URL и для ошибок ищет Wayback-снапшот.
Флаг ``--syntax-only`` запускает локальную проверку без сети: у каждой строки
матрицы и каталога должен быть полный URL конкретной страницы, а не ``-``,
пустое значение или один домен. Наличие полного URL не означает, что источник
подтверждает утверждение — это проверяется редактором по цитате и уровню
атрибуции.

Запуск:
  python3 scripts/check_sources.py --syntax-only
  python3 scripts/check_sources.py
"""
import csv
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
GOOD = (200, 301, 302, 303, 307, 308)
PLACEHOLDERS = {"", "-", "—", "не найдено", "не установлен"}


def is_direct_url(value: str) -> bool:
    """Разрешает http(s) URL с непустым путём, но не домен/корень сайта."""
    if value in PLACEHOLDERS:
        return False
    try:
        parsed = urllib.parse.urlparse(value)
    except ValueError:
        return False
    return (
        parsed.scheme in {"http", "https"}
        and bool(parsed.netloc)
        and parsed.path not in {"", "/"}
        and " " not in value
    )


def validate_local_files() -> list[str]:
    errors = []
    checks = (
        ("data/matriks.csv", "source_url"),
        ("data/sources_catalog.csv", "url"),
    )
    for rel, field in checks:
        path = ROOT / rel
        if not path.exists():
            errors.append(f"{rel}: файл не найден")
            continue
        with path.open(encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            if field not in (reader.fieldnames or []):
                errors.append(f"{rel}: отсутствует колонка {field}")
                continue
            for number, row in enumerate(reader, start=2):
                value = (row.get(field) or "").strip()
                if not is_direct_url(value):
                    errors.append(f"{rel}:{number}: недопустимый полный URL: {value!r}")
    return errors


def http_status(url: str, timeout: int = 20) -> int:
    req = urllib.request.Request(url, headers={"User-Agent": UA,
                                               "Accept-Language": "ru,en;q=0.8"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0


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
    urls = {}
    for rel, field in (("data/matriks.csv", "source_url"),
                       ("data/sources_catalog.csv", "url")):
        path = ROOT / rel
        if not path.exists():
            continue
        with path.open(encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f):
                value = (row.get(field) or "").strip()
                if value:
                    urls.setdefault(value, []).append(rel)
    return urls


def main():
    errors = validate_local_files()
    if errors:
        print("Локальная проверка: ОШИБКИ")
        print("\n".join(errors))
        return 2
    print("Локальная проверка: OK — все строки матрицы и каталога имеют полный URL")
    if "--syntax-only" in sys.argv:
        return 0

    urls = collect_urls()
    print(f"Всего уникальных ссылок: {len(urls)}\n")
    print(f"{'код':<6} {'wayback':<10} URL")
    ok = broken = 0
    for url in sorted(urls):
        code = http_status(url)
        snap = ""
        if code not in GOOD:
            snap = wayback_snapshot(url)
            time.sleep(1)
        if code in GOOD:
            ok += 1
        else:
            broken += 1
        print(f"{code:<6} {'да' if snap else '—':<10} {url}")
        if snap:
            print(f"{'':<6} {'снапшот':<10} {snap}")
        time.sleep(0.5)
    print(f"\nДоступно: {ok}, проблемно/мёртво: {broken}")
    if broken:
        print("Для проблемных ссылок используйте снапшоты Wayback или проверку "
              "в обычном браузере: бот-защита избиркомов/VK часто срабатывает "
              "на скрипты.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
