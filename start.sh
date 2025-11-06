#!/bin/bash
# Map Render PORT to SERVER_PORT if PORT is set (Render automatically sets PORT)
if [ -n "$PORT" ]; then
  export SERVER_PORT=$PORT
fi
# Start elizaos
exec /app/node_modules/.bin/elizaos start
