#!/bin/bash
# Start Cloudflare Tunnel first and capture the domain
# Run tunnel in background, capture output
TUNNEL_OUTPUT=$(cloudflared tunnel --url http://localhost:3000 2>&1 | grep -o "https://[a-z0-9.-]*trycloudflare.com")

# Print the domain for easy access
echo "Public Tunnel URL: $TUNNEL_OUTPUT"

# Now start the Node.js server
exec /usr/bin/node /home/pi/gits/KKuBadmintonQueue/server.js
