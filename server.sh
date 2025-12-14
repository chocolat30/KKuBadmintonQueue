#!/bin/bash
cd /home/pi/gits/KKuBadmintonQueue


# Start Node.js server
/usr/bin/node server.js &

sleep 3
echo -n "Public domain at: "
cloudflared tunnel --url http://localhost:3000 2>&1 | grep -o "https://[a-z0-9.-]*trycloudflare.com"


