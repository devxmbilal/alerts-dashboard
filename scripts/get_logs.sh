#!/bin/bash
echo "=== LOG FILES ==="
ls -la /var/www/alerts-dashboard/logs/

echo ""
echo "=== ALERT WORKER OUT (last 200 lines) ==="
tail -200 /var/www/alerts-dashboard/logs/alert-worker-out.log 2>/dev/null || echo "FILE NOT FOUND"
tail -200 /var/www/alerts-dashboard/logs/alert-worker.log 2>/dev/null || echo "FILE NOT FOUND"

echo ""
echo "=== ALERT WORKER ERRORS (last 50 lines) ==="
tail -50 /var/www/alerts-dashboard/logs/alert-worker-error.log 2>/dev/null || echo "FILE NOT FOUND"

echo ""
echo "=== DB-QUEUE WORKER OUT (last 50 lines) ==="
tail -50 /var/www/alerts-dashboard/logs/db-queue-worker-out.log 2>/dev/null || echo "FILE NOT FOUND"

echo ""
echo "=== DB-QUEUE WORKER ERRORS (last 50 lines) ==="
tail -50 /var/www/alerts-dashboard/logs/db-queue-worker-error.log 2>/dev/null || echo "FILE NOT FOUND"

echo ""
echo "=== NOTIFY WORKER OUT (last 30 lines) ==="
tail -30 /var/www/alerts-dashboard/logs/notify-worker-out.log 2>/dev/null || echo "FILE NOT FOUND"
