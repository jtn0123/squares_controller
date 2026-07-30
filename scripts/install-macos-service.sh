#!/bin/bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python_bin="$(command -v python3)"
launch_agents_dir="${HOME}/Library/LaunchAgents"
log_dir="${HOME}/Library/Logs/SquaresController"
plist_path="${launch_agents_dir}/com.jtn0123.squares-controller.plist"

mkdir -p "${launch_agents_dir}" "${log_dir}"

"${python_bin}" - "${plist_path}" "${project_dir}" "${python_bin}" "${log_dir}" <<'PY'
import plistlib
import sys
from pathlib import Path

plist_path, project_dir, python_bin, log_dir = sys.argv[1:]
payload = {
    "Label": "com.jtn0123.squares-controller",
    "ProgramArguments": [python_bin, str(Path(project_dir) / "server.py")],
    "WorkingDirectory": project_dir,
    "RunAtLoad": True,
    "KeepAlive": True,
    "StandardOutPath": str(Path(log_dir) / "stdout.log"),
    "StandardErrorPath": str(Path(log_dir) / "stderr.log"),
}
with Path(plist_path).open("wb") as output:
    plistlib.dump(payload, output)
PY

launchctl bootout "gui/${UID}" "${plist_path}" 2>/dev/null || true
launchctl bootstrap "gui/${UID}" "${plist_path}"
launchctl kickstart -k "gui/${UID}/com.jtn0123.squares-controller"

echo "Squares Controller is running at http://127.0.0.1:4312"
