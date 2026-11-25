#!/bin/bash
# Publish the whiteboard to its own AWS server (Lightsail, Mumbai).
#
#   WB_AWS_HOST=<static ip> bash tools/deploy_aws.sh
#
# Copies server.py, backend/, public/ and the keys in .env into build/aws, sends
# it over and rebuilds. Uses nothing outside this folder.
set -euo pipefail

WB="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$WB/build/aws"
HOST="${WB_AWS_HOST:?set WB_AWS_HOST to the server static IP}"
KEY="${WB_AWS_KEY:-$HOME/.ssh/liza-web-whiteboard.pem}"
SITE="${WB_SITE:-${HOST//./-}.sslip.io}"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "ubuntu@$HOST")

rm -rf "$OUT"
mkdir -p "$OUT/app"
cp "$WB/server.py" "$WB/access.py" "$WB/boards.py" "$WB/classroom.py" "$WB/backups.py" "$WB/requirements.txt" "$OUT/app/"
rsync -a --exclude __pycache__ "$WB/backend" "$WB/public" "$OUT/app/"
cp "$WB"/aws/{Dockerfile,docker-compose.yml,Caddyfile} "$OUT/"
# The keys, never printed; Caddy's site name added.
{ cat "$WB/.env"; echo "SITE=$SITE"; echo "ADDRESS=$HOST"; } > "$OUT/.env"
chmod 600 "$OUT/.env"

if [ -n "${WB_BUILD_ONLY:-}" ]; then echo "Built $OUT ($(du -shL "$OUT" | cut -f1))"; exit 0; fi
echo "Copying $(du -shL "$OUT" | cut -f1) to $HOST (compressed on the way)"
rsync -az --delete --exclude /data/ -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" "$OUT/" "ubuntu@$HOST:whiteboard/"
"${SSH[@]}" "cd whiteboard && sudo docker compose up -d --build --remove-orphans && sudo docker image prune -f >/dev/null"
echo "Live: https://$SITE"
