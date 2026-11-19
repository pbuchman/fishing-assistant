#!/bin/bash
# Install DEV-only reader isolation from a reviewed, root-owned staging copy.
set -euo pipefail
mode=${1:-}
logs=${2:-}
if [[ $# != 2 || ! $logs =~ ^/[a-zA-Z0-9._/-]+/logs$ || $logs == *'//'* ||
      $logs == *'/../'* || $logs == *'/./'* ]]; then
  echo 'Expected --render or --install and an absolute PM2 logs directory' >&2
  exit 2
fi
render() {
  cat <<UNIT
[Service]
User=fa-alloy
Group=fa-alloy
StateDirectory=fa-alloy
StateDirectoryMode=0750
UMask=0027
ExecStart=
ExecStart=/usr/bin/alloy run --storage.path=/var/lib/fa-alloy --server.http.listen-addr=127.0.0.1:12346 /etc/fa/alloy/fa.alloy
ProtectHome=tmpfs
BindReadOnlyPaths=$logs
ProtectSystem=strict
InaccessiblePaths=-/run/docker.sock
NoNewPrivileges=yes
PrivateTmp=yes
UNIT
}
if [[ $mode == --render ]]; then render; exit 0; fi
[[ $mode == --install && $EUID == 0 && -d $logs && $(realpath -e -- "$logs") == "$logs" ]]
owner=$(stat -c '%U' "$logs")
[[ $owner != root && $owner != UNKNOWN ]]
echo 'u fa-alloy - "Fishing Assistant DEV log reader" /nonexistent /usr/sbin/nologin' |
  systemd-sysusers -
[[ $(id -Gn fa-alloy) == fa-alloy ]] || { echo 'Review DEV reader groups before installation' >&2; exit 1; }
# Grant the log owner permission to share its own files; systemd exposes just
# this subtree inside the service's private /home.
runuser -u "$owner" -- setfacl -m u:fa-alloy:rx,d:u:fa-alloy:r-- "$logs"
runuser -u "$owner" -- find "$logs" -maxdepth 1 -type f -name 'fa-*.log' -exec setfacl -m u:fa-alloy:r-- {} +
dropin=/etc/systemd/system/fa-alloy.service.d/30-dev-reader.conf
install -d -o root -g root -m 0755 "${dropin%/*}"
ready() {
  curl --retry 12 --retry-delay 1 --retry-connrefused --max-time 2 -fsS -o /dev/null http://127.0.0.1:12346/-/ready
}
if [[ -e $dropin || -L $dropin ]]; then
  [[ -f $dropin && ! -L $dropin ]]
  if ! cmp -s "$dropin" <(render); then
    # Replace only the known earlier override, removing its broad journal group.
    cmp -s "$dropin" <(render | sed '/^Group=fa-alloy$/a SupplementaryGroups=systemd-journal') ||
      { echo 'Existing DEV reader override differs' >&2; exit 1; }
    next=$(mktemp "${dropin%/*}/.dev-reader.XXXXXXXX")
    render > "$next"
    chmod 0644 "$next"
    mv -T "$next" "$dropin"
  fi
  systemctl daemon-reload
  systemctl restart fa-alloy.service
  ready
  exit 0
fi
state=/var/lib/fa-alloy
[[ ! -L $state && ! -e $state ]] || { echo 'Review existing unclaimed DEV state directory' >&2; exit 1; }
was_active=false
if systemctl is-active --quiet fa-alloy.service; then was_active=true; fi
staging=$(mktemp -d /var/lib/.fa-alloy-state.XXXXXXXX)
next=$(mktemp "${dropin%/*}/.dev-reader.XXXXXXXX")
published_state=false
render > "$next"
chmod 0644 "$next"
rollback() {
  rm -f -- "$dropin" "$next"
  if [[ $published_state == true ]]; then
    systemctl stop fa-alloy.service || true
    mv -T "$state" "$staging" || true
  fi
  systemctl daemon-reload
  if [[ $was_active == true ]]; then systemctl restart fa-alloy.service; fi
  echo 'DEV reader cutover failed; prior reader restored. Inspect private state staging before retry.' >&2
}
trap rollback ERR
if [[ $was_active == true ]]; then systemctl stop fa-alloy.service; fi
# Preserve acknowledged file/journal positions; the old state stays intact.
legacy=/data-alloy
if [[ -d $legacy ]]; then
  [[ ! -L $legacy && $(stat -c '%u:%a' "$legacy") =~ ^0:(700|750|755)$ ]]
  for component in loki.source.file.pm2 loki.source.journal.dev_host_services loki.source.journal.alert_router; do
    source="$legacy/$component/positions.yml"
    if [[ -e $source ]]; then
      [[ ! -L $legacy/$component && ! -L $source && -f $source && $(stat -c %u "$source") == 0 ]]
      install -d -o fa-alloy -g fa-alloy -m 0750 "$staging/$component"
      install -o fa-alloy -g fa-alloy -m 0640 "$source" "$staging/$component/positions.yml"
    fi
  done
fi
chown fa-alloy:fa-alloy "$staging"
chmod 0750 "$staging"
mv -T "$staging" "$state"
published_state=true
mv -T "$next" "$dropin"
systemctl daemon-reload
systemctl start fa-alloy.service
ready
trap - ERR
