#!/usr/bin/env python3
"""
Open Line Device Agent — iPhone battery-health scanner.

Reads a USB-connected iPhone's lockdown info + battery diagnostics via
pymobiledevice3 (Apple's usbmux/lockdown protocol — which browsers can't do), and
posts the raw scan to the Open Line site, where it's enriched and shown on the
Device Diagnostics page.

No browser bridge / certificates needed: the agent talks straight to the site over
HTTPS using an Agent Token you copy from the Device Diagnostics page.

Usage:
    python openline_device_agent.py            # watch mode: scans each iPhone as it's plugged in
    python openline_device_agent.py --once     # scan whatever is connected once, then exit

Config (first run creates ./agent_config.json, or use env vars):
    OPENLINE_SITE_URL   e.g. https://openlinemobility.vercel.app
    OPENLINE_AGENT_TOKEN   the token from the Device Diagnostics page
"""
import argparse
import asyncio
import inspect
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
import urllib.error

# Default "skip Setup Assistant → home screen" command (Apple Configurator's cfgutil).
# cfgutil acts on the connected device; supervising + skipping all setup panes sends
# a clean (iCloud-OFF) device straight to the home screen — the same mechanism tools
# like PhoneCheck use. The exact invocation depends on your supervision identity, so
# override it in agent_config.json → "prepareCommand" if needed. Requires Apple
# Configurator (Automation Tools) installed; does NOT bypass Activation Lock.
DEFAULT_PREPARE_CMD = "cfgutil prepare --skip-all"


def _resolve(value):
    """pymobiledevice3 4.x made several calls async; 3.x is sync. Support both:
    if a call returns a coroutine, run it to completion."""
    if inspect.iscoroutine(value):
        return asyncio.new_event_loop().run_until_complete(value)
    return value

AGENT_VERSION = "1.0.0"
CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent_config.json")
POLL_SECONDS = 2.0

try:
    from pymobiledevice3 import usbmux
    from pymobiledevice3.lockdown import create_using_usbmux
    from pymobiledevice3.services.diagnostics import DiagnosticsService
except Exception:  # pragma: no cover
    print("ERROR: pymobiledevice3 is not installed. Run:  pip install -r requirements.txt", file=sys.stderr)
    raise


# ── Config ────────────────────────────────────────────────────────────────────
def load_config():
    cfg = {}
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH) as f:
                cfg = json.load(f)
        except Exception:
            cfg = {}
    site = (os.environ.get("OPENLINE_SITE_URL") or cfg.get("siteUrl") or "").strip()
    token = (os.environ.get("OPENLINE_AGENT_TOKEN") or cfg.get("agentToken") or "").strip()
    # A valid site URL must look like a URL — re-prompt otherwise (guards against a
    # stray value getting saved).
    if not site.startswith("http"):
        while True:
            site = input("Site URL (e.g. https://openlinemobility.vercel.app): ").strip()
            if site.startswith("http"):
                break
            print("  → must start with http(s)://")
    if not token:
        token = input("Agent Token (from the Device Diagnostics page): ").strip()
    site = site.rstrip("/")
    # Always persist the resolved values (also repairs a previously-bad config).
    if cfg.get("siteUrl") != site or cfg.get("agentToken") != token:
        try:
            with open(CONFIG_PATH, "w") as f:
                json.dump({"siteUrl": site, "agentToken": token}, f, indent=2)
            print(f"Saved config → {CONFIG_PATH}")
        except Exception as e:
            print(f"(could not save config: {e})")
    return site, token


# ── Device read ───────────────────────────────────────────────────────────────
def connected_udids():
    try:
        devices = _resolve(usbmux.list_devices())
        return [d.serial for d in devices]
    except Exception as e:
        print(f"  (device list failed: {e})")
        return []


def _read_battery(diag):
    """AppleSmartBattery IORegistry (DesignCapacity, AppleRawMaxCapacity,
    NominalChargeCapacity, CycleCount, BatteryCurrentCapacity, …). Try the known
    method names across pymobiledevice3 versions."""
    for attempt in (
        lambda: diag.ioregistry(entry_class="AppleSmartBattery"),
        lambda: diag.get_battery(),
    ):
        try:
            result = _resolve(attempt())
            if result:
                return result
        except Exception:
            continue
    return {}


def scan_device(udid):
    """Return a RawAppleScan dict the site understands, or None on failure."""
    lockdown = _resolve(create_using_usbmux(serial=udid))
    try:
        lockdown_info = dict(_resolve(lockdown.all_values))
    except Exception:
        try:
            lockdown_info = dict(lockdown.all_values)
        except Exception:
            lockdown_info = {}
    ioreg_battery = {}
    try:
        ioreg_battery = _read_battery(DiagnosticsService(lockdown=lockdown)) or {}
    except Exception as e:
        print(f"  (battery read failed: {e})")
    return {
        "udid": udid,
        "agentVersion": AGENT_VERSION,
        "lockdown": _jsonable(lockdown_info),
        "ioregBattery": _jsonable(ioreg_battery),
    }


def _jsonable(obj):
    """Coerce plist values (bytes, nested) into JSON-safe types."""
    if isinstance(obj, dict):
        return {str(k): _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    if isinstance(obj, bytes):
        try:
            return obj.decode("utf-8", "replace")
        except Exception:
            return obj.hex()
    if isinstance(obj, (str, int, float, bool)) or obj is None:
        return obj
    return str(obj)


# ── Post to site ──────────────────────────────────────────────────────────────
def post_scan(site, token, raw):
    url = f"{site}/api/devices/agent-scan"
    body = json.dumps(raw).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            d = data.get("diagnostic", {})
            name = d.get("marketingName") or d.get("productType") or "device"
            health = d.get("batteryHealthPct")
            cyc = d.get("batteryCycleCount")
            print(f"  ✓ Posted: {name} — battery {health}% · {cyc} cycles")
            return True
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode("utf-8")).get("error", str(e))
        except Exception:
            msg = str(e)
        print(f"  ✗ Server rejected scan ({e.code}): {msg}")
    except Exception as e:
        print(f"  ✗ Could not reach site: {e}")
    return False


# ── Command queue (web-triggered actions, e.g. cfgutil prepare) ───────────────
def _api(site, token, body):
    req = urllib.request.Request(f"{site}/api/devices/agent-command", data=json.dumps(body).encode("utf-8"), method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def claim_command(site, token):
    try:
        return _api(site, token, {"action": "claim"}).get("command")
    except Exception:
        return None


def report_result(site, token, cmd_id, status, result="", error=""):
    try:
        _api(site, token, {"action": "result", "id": cmd_id, "status": status, "result": result, "error": error})
    except Exception as e:
        print(f"  (could not report command result: {e})")


def prepare_device(udid):
    """Run cfgutil to prepare/supervise the connected device and skip Setup Assistant.
    Returns (ok, output)."""
    if shutil.which("cfgutil") is None:
        return False, ("cfgutil not found. Install Apple Configurator from the Mac App Store, "
                       "then its menu → Install Automation Tools (provides cfgutil).")
    cfg = {}
    try:
        with open(CONFIG_PATH) as f:
            cfg = json.load(f)
    except Exception:
        pass
    cmd = cfg.get("prepareCommand") or DEFAULT_PREPARE_CMD
    print(f"  → preparing device via: {cmd}")
    try:
        proc = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=600)
        out = (proc.stdout + "\n" + proc.stderr).strip()
        ok = proc.returncode == 0
        print(f"  {'✓ prepare finished' if ok else '✗ prepare failed'} (exit {proc.returncode})")
        return ok, out[:8000]
    except Exception as e:
        return False, str(e)


def handle_commands(site, token, current_udid=None):
    cmd = claim_command(site, token)
    if not cmd:
        return
    if cmd.get("type") == "prepare":
        print(f"Command: prepare (skip setup) — running cfgutil …")
        ok, out = prepare_device(cmd.get("udid") or current_udid)
        report_result(site, token, cmd["id"], "DONE" if ok else "FAILED",
                      result=out if ok else "", error="" if ok else out)
    else:
        report_result(site, token, cmd["id"], "FAILED", error=f"Unknown command type: {cmd.get('type')}")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="Open Line Device Agent")
    ap.add_argument("--once", action="store_true", help="Scan connected device(s) once and exit")
    args = ap.parse_args()

    site, token = load_config()
    print(f"Open Line Device Agent v{AGENT_VERSION} → {site}")

    if args.once:
        udids = connected_udids()
        if not udids:
            print("No iPhone detected. Plug one in, unlock it, and tap Trust.")
            return
        for udid in udids:
            print(f"Scanning {udid} …")
            raw = scan_device(udid)
            post_scan(site, token, raw)
        return

    print("Watching for devices — plug in an iPhone (unlock + tap Trust). Ctrl-C to quit.")
    seen = set()
    while True:
        try:
            current = set(connected_udids())
            for udid in current - seen:
                print(f"Device connected: {udid} — scanning …")
                raw = scan_device(udid)
                post_scan(site, token, raw)
            seen = current
            # Pick up any web-queued commands (e.g. "Skip Setup" → cfgutil prepare).
            handle_commands(site, token, next(iter(current)) if current else None)
            time.sleep(POLL_SECONDS)
        except KeyboardInterrupt:
            print("\nBye.")
            return
        except Exception as e:
            print(f"(loop error: {e})")
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
