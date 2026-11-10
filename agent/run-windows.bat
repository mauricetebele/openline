@echo off
cd /d "%~dp0"
python -m pip install --quiet --upgrade -r requirements.txt
python openline_device_agent.py %*
pause
