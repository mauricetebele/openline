Open Line Device Agent — iPhone Battery Health Scanner
======================================================

This small program reads a USB-connected iPhone's battery health (maximum
capacity, cycle count, etc.) and sends it to the Open Line site, where it shows
up on the Device Diagnostics page. It talks to the iPhone over Apple's USB
protocol — which a web browser cannot do on its own.

ONE-TIME SETUP
--------------
1. Install Python 3.9+ :  https://www.python.org/downloads/   (on macOS it's preinstalled)
2. Windows only: install "Apple Devices" (or iTunes) from the Microsoft Store /
   apple.com so Windows can see iPhones over USB.
3. Open a terminal / command prompt in this folder and run:

       Windows:   run-windows.bat
       Mac/Linux: ./run-mac.sh

   The first run installs the needed library and asks for:
     - Site URL      (e.g. https://openlinemobility.vercel.app)
     - Agent Token   (copy it from the Device Diagnostics page → "Agent Token")
   These are saved to agent_config.json so you won't be asked again.

EVERYDAY USE
------------
1. Run run-windows.bat / run-mac.sh (leave it running).
2. Plug an iPhone in with a data cable, UNLOCK it, and tap "Trust" on the phone.
3. The scan is sent automatically and appears on the Device Diagnostics page.
   (It scans each phone once when it's plugged in.)

To scan whatever is already connected once and exit:
       python openline_device_agent.py --once

TROUBLESHOOTING
---------------
- "No iPhone detected": use a DATA cable, unlock the phone, tap Trust. On Windows
  make sure Apple Devices/iTunes is installed.
- "Server rejected scan": your Agent Token is wrong or was regenerated — copy a
  fresh one from the Device Diagnostics page into agent_config.json.
