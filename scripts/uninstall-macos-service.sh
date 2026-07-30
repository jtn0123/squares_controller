#!/bin/bash
set -euo pipefail

plist_path="${HOME}/Library/LaunchAgents/com.jtn0123.squares-controller.plist"

launchctl bootout "gui/${UID}" "${plist_path}" 2>/dev/null || true
rm -f "${plist_path}"

echo "Squares Controller LaunchAgent removed. Logs were left in place."
