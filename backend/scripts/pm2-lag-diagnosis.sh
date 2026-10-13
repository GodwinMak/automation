#!/usr/bin/env bash
set -euo pipefail

# PM2 lag diagnosis helper
# Usage:
#   ./scripts/pm2-lag-diagnosis.sh stop-all
#   ./scripts/pm2-lag-diagnosis.sh start-baseline
#   ./scripts/pm2-lag-diagnosis.sh add <pm2-process-name>
#   ./scripts/pm2-lag-diagnosis.sh remove <pm2-process-name>
#   ./scripts/pm2-lag-diagnosis.sh status
#   ./scripts/pm2-lag-diagnosis.sh runbook

ECOSYSTEM_FILE="${ECOSYSTEM_FILE:-./ecosystem.config.js}"

require_pm2() {
  if ! command -v pm2 >/dev/null 2>&1; then
    echo "pm2 is not installed or not in PATH"
    exit 1
  fi
}

stop_all() {
  echo "Stopping all PM2 processes..."
  pm2 stop all || true
  pm2 ls
}

start_baseline() {
  echo "Starting baseline: automation-server only..."
  pm2 start "$ECOSYSTEM_FILE" --only automation-server
  pm2 ls
}

add_process() {
  local name="${1:-}"
  if [[ -z "$name" ]]; then
    echo "Missing process name"
    exit 1
  fi
  echo "Starting process: $name"
  pm2 start "$ECOSYSTEM_FILE" --only "$name"
  pm2 ls
}

remove_process() {
  local name="${1:-}"
  if [[ -z "$name" ]]; then
    echo "Missing process name"
    exit 1
  fi
  echo "Stopping process: $name"
  pm2 stop "$name" || true
  pm2 ls
}

show_status() {
  pm2 ls
  echo
  echo "CPU/MEM snapshot:"
  pm2 monit
}

runbook() {
  cat <<'EOF'
Recommended lag isolation workflow:
1) Stop everything:
   ./scripts/pm2-lag-diagnosis.sh stop-all

2) Start baseline only:
   ./scripts/pm2-lag-diagnosis.sh start-baseline

3) Test UI/API latency for 3-5 minutes.

4) Add workers one-by-one and test after each:
   ./scripts/pm2-lag-diagnosis.sh add cron-worker-dia
   ./scripts/pm2-lag-diagnosis.sh add cron-worker-ipt
   ./scripts/pm2-lag-diagnosis.sh add cron-worker-shared
   ./scripts/pm2-lag-diagnosis.sh add cron-worker-l3vpn
   ./scripts/pm2-lag-diagnosis.sh add cron-worker-ftth
   ./scripts/pm2-lag-diagnosis.sh add cron-worker-isis-adjacent
   ...

5) When lag appears, the last added process is your top suspect.

6) Confirm by stopping only that suspect and re-testing:
   ./scripts/pm2-lag-diagnosis.sh remove <suspect-name>
EOF
}

main() {
  require_pm2
  local cmd="${1:-}"
  case "$cmd" in
    stop-all)
      stop_all
      ;;
    start-baseline)
      start_baseline
      ;;
    add)
      add_process "${2:-}"
      ;;
    remove)
      remove_process "${2:-}"
      ;;
    status)
      show_status
      ;;
    runbook)
      runbook
      ;;
    *)
      echo "Unknown command: ${cmd:-<none>}"
      echo "Use: stop-all | start-baseline | add <name> | remove <name> | status | runbook"
      exit 1
      ;;
  esac
}

main "$@"
