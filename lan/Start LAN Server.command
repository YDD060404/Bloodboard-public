#!/bin/bash
# Double-click on macOS to start the Bloodboard LAN match server (needs Node 22+: https://nodejs.org).
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then echo "Node.js (version 22 or newer) is required: https://nodejs.org"; read -r -p "Press Return to close"; exit 1; fi
node server.mjs "$@"
read -r -p "Server stopped. Press Return to close"
