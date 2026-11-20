#!/bin/bash
# Scope DEV journal access to the webhook and alert router. Install from reviewed root-owned staging.
set -euo pipefail
umask 022
reader() {
  cat <<'UNIT'
[Unit]
Requires=systemd-journald@fa-dev.service
After=systemd-journald@fa-dev.service
[Service]
SupplementaryGroups=
TemporaryFileSystem=/var/log/journal:ro
BindReadOnlyPaths=/var/log/journal/%m.fa-dev:/var/log/journal/%m
InaccessiblePaths=-/run/log/journal
ProtectProc=invisible
UNIT
}
source_unit() {
  cat <<'UNIT'
[Service]
LogNamespace=fa-dev
UNIT
}
case ${1:-} in
  --render-reader) reader; exit 0 ;;
  --render-source) source_unit; exit 0 ;;
  --install) [[ $EUID == 0 ]] ;;
  *) exit 2 ;;
esac
# An existing broad account membership would survive SupplementaryGroups=.
[[ $(id -Gn fa-alloy) == fa-alloy ]] || { echo 'Review DEV reader groups before installation' >&2; exit 1; }
machine=$(cat /etc/machine-id)
[[ $machine =~ ^[0-9a-f]{32}$ ]]
directory=/var/log/journal/$machine.fa-dev
units=(fa-webhook-handler.service fa-alert-router.service fa-alloy.service)
added=()
active=()
for unit in "${units[@]}"; do
  if systemctl is-active --quiet "$unit"; then active+=("$unit"); fi
  p=/etc/systemd/system/$unit.d/40-fa-dev-journal.conf
  if [[ -e $p || -L $p ]]; then
    [[ -f $p && ! -L $p ]]
    if [[ $unit == fa-alloy.service ]]; then cmp -s "$p" <(reader); else cmp -s "$p" <(source_unit); fi
  fi
done
systemctl start systemd-journald@fa-dev.service
[[ -d $directory && $(realpath -e "$directory") == "$directory" && $(stat -c %u "$directory") == 0 ]]
# Journal rotation inherits this reader ACL. Other host journals keep their own permissions.
setfacl -m u:fa-alloy:rx,d:u:fa-alloy:r-x "$directory"
find "$directory" -maxdepth 1 -type f \( -name '*.journal' -o -name '*.journal~' \) -exec setfacl -m u:fa-alloy:r-- {} +
rollback() {
  trap - ERR
  for p in "${added[@]}"; do rm -f -- "$p"; done
  systemctl daemon-reload
  for unit in "${active[@]}"; do systemctl restart "$unit" || true; done
  echo 'DEV journal cutover failed; previous unit configuration restored.' >&2
}
trap rollback ERR
for unit in "${units[@]}"; do
  p=/etc/systemd/system/$unit.d/40-fa-dev-journal.conf
  if [[ ! -e $p ]]; then
    install -d -m 0755 "${p%/*}"
    temp=$(mktemp "${p%/*}/.fa-dev-journal.XXXXXXXX")
    if [[ $unit == fa-alloy.service ]]; then reader > "$temp"; else source_unit > "$temp"; fi
    chmod 0644 "$temp"
    mv -T "$temp" "$p"
    added+=("$p")
  fi
done
systemctl daemon-reload
for unit in "${active[@]}"; do
  if [[ $unit != fa-alloy.service ]]; then
    # A freshly installed optional source picks up the drop-in at its first start.
    pid=$(systemctl show "$unit" -p MainPID --value)
    if [[ $pid == 0 || $(stat -Lc '%d:%i' "/proc/$pid/root/run/systemd/journal/socket" 2>/dev/null) != "$(stat -Lc '%d:%i' /run/systemd/journal.fa-dev/socket)" ]]; then
      systemctl restart "$unit"
    fi
  fi
done
if systemctl is-active --quiet fa-alloy.service; then
  pid=$(systemctl show fa-alloy.service -p MainPID --value)
  if [[ $pid == 0 || $(stat -Lc '%d:%i' "/proc/$pid/root/var/log/journal/$machine" 2>/dev/null) != "$(stat -Lc '%d:%i' "$directory")" ]]; then
    systemctl restart fa-alloy.service
  fi
  curl --retry 12 --retry-delay 1 --retry-connrefused --max-time 2 -fsS -o /dev/null http://127.0.0.1:12346/-/ready
  pid=$(systemctl show fa-alloy.service -p MainPID --value)
  [[ $pid =~ ^[1-9][0-9]*$ ]]
  primary=$(id -g fa-alloy)
  awk -v own="$primary" '/^Groups:/{seen=1; for (i=2;i<=NF;i++) if ($i!=own) exit 1} END{if(!seen) exit 1}' "/proc/$pid/status"
  [[ $(stat -Lc '%d:%i' "/proc/$pid/root/var/log/journal/$machine") == "$(stat -Lc '%d:%i' "$directory")" ]]
fi
trap - ERR
