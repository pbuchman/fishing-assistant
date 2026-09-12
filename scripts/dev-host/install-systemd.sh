#!/usr/bin/env bash
set -euo pipefail
# Run only after reviewing rendered units and pausing the existing webhook.
unit_dir="${1:?Usage: install-systemd.sh <reviewed-unit-directory>}"
[[ "${EUID}" == 0 ]] || { echo 'Systemd installation requires root' >&2; exit 1; }
systemctl is-active --quiet fa-webhook-handler.service && {
  echo 'Stop fa-webhook-handler.service before installing units' >&2
  exit 1
}
systemd-analyze verify "${unit_dir}/fa-pm2.service" "${unit_dir}/fa-webhook-handler.service"
backup_dir="/var/backups/fishing-assistant/systemd-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 700 "${backup_dir}"
for name in fka-pm2.service fa-pm2.service fa-webhook-handler.service; do
  if [[ -f "/etc/systemd/system/${name}" ]]; then
    cp -p "/etc/systemd/system/${name}" "${backup_dir}/${name}"
  fi
done
install -m 644 "${unit_dir}/fa-pm2.service" /etc/systemd/system/fa-pm2.service
install -m 644 "${unit_dir}/fa-webhook-handler.service" /etc/systemd/system/fa-webhook-handler.service
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
install -d -o pbuchman -g pbuchman -m 700 /home/pbuchman/.local/state/fishing-assistant/deploy
install -d -o pbuchman -g pbuchman -m 700 /home/pbuchman/tools/fa-webhook-handler
for name in webhook-handler.mjs deployment-queue.mjs; do
  install -o pbuchman -g pbuchman -m 644 "${source_dir}/${name}" "/home/pbuchman/tools/fa-webhook-handler/${name}"
done
systemctl daemon-reload
printf 'Units installed; no application was stopped or started. Backup: %s\n' "${backup_dir}"
