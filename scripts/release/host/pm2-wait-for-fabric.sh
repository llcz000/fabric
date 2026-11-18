#!/bin/sh
set -eu

main_ready() {
    /usr/bin/curl --noproxy '*' -fsS --max-time 1 http://127.0.0.1:3008/api/health |
        /usr/bin/grep -q '"status":"ok"'
}

recovery_ready() {
    /usr/bin/curl --noproxy '*' -fsS --max-time 1 http://127.0.0.1:3009/api/runtime |
        /usr/bin/grep -q '"readOnly":true'
}

wait_for() {
    attempts=0
    until "$1"; do
        attempts=$((attempts + 1))
        if [ "$attempts" -ge 60 ]; then
            echo "Fabric did not reach $1 during PM2 startup" >&2
            return 1
        fi
        sleep 0.5
    done
}

wait_for main_ready
if ! recovery_ready; then
    /usr/lib/node_modules/pm2/bin/pm2 restart fabric-readonly
fi
wait_for recovery_ready
