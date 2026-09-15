#!/bin/bash
# TeamTracker Stop
# Stops the running TeamTracker server

echo "🛑 Stopping TeamTracker..."

# Find and kill the server process
PID=$(lsof -ti:3001 2>/dev/null)
if [ ! -z "$PID" ]; then
    kill $PID 2>/dev/null
    echo "✅ Server stopped"
else
    echo "ℹ️  Server was not running"
fi
