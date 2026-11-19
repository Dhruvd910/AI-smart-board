#!/bin/sh
# Serve the whiteboard to phones, laptops and smartboards on this network.
cd "$(dirname "$0")" || exit 1
PORT=${PORT:-8095}
for ip in $(hostname -I); do
  case $ip in *:*) ;; *) echo "Open on any device on this network: http://$ip:$PORT" ;; esac
done
exec .venv/bin/python -m uvicorn server:app --host 0.0.0.0 --port "$PORT" --workers 1
