#!/bin/bash
echo "=== PM2 STATUS ==="
pm2 ls 2>/dev/null | cat

echo ""
echo "=== ALERT WORKER ERROR LOG (last 50 lines) ==="
find /root/.pm2/logs /home/ubuntu/.pm2/logs /var/www/alerts-dashboard/logs -name "*alert*error*" -o -name "*alert*err*" 2>/dev/null | head -3 | xargs tail -50 2>/dev/null

echo ""
echo "=== ALERT WORKER OUT LOG (last 50 lines) ==="
find /root/.pm2/logs /home/ubuntu/.pm2/logs /var/www/alerts-dashboard/logs -name "*alert*out*" 2>/dev/null | head -3 | xargs tail -50 2>/dev/null

echo ""
echo "=== BINANCE WORKER ERROR LOG (last 30 lines) ==="
find /root/.pm2/logs /home/ubuntu/.pm2/logs /var/www/alerts-dashboard/logs -name "*binance*error*" -o -name "*binance*err*" 2>/dev/null | head -3 | xargs tail -30 2>/dev/null

echo ""
echo "=== NOTIFY WORKER ERROR LOG (last 30 lines) ==="
find /root/.pm2/logs /home/ubuntu/.pm2/logs /var/www/alerts-dashboard/logs -name "*notify*error*" -o -name "*notify*err*" 2>/dev/null | head -3 | xargs tail -30 2>/dev/null

echo ""
echo "=== ECOSYSTEM CONFIG (log paths) ==="
grep -A2 "out_file\|log_file\|error_file" /var/www/alerts-dashboard/ecosystem.config.cjs 2>/dev/null
