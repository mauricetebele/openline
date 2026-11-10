#!/bin/bash
cd "$(dirname "$0")"
python3 -m pip install --quiet --upgrade -r requirements.txt
exec python3 openline_device_agent.py "$@"
