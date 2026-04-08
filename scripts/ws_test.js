const WebSocket = require('ws');
console.log("Connecting...");
const ws = new WebSocket('wss://stream.binance.com:9443/ws/!ticker@arr');
ws.on('open', () => console.log('OPENED'));
ws.on('message', d => { console.log('GOT DATA:', d.toString().substring(0, 100)); process.exit(0); });
ws.on('error', e => console.error(e));
setTimeout(() => { console.error('TIMEOUT'); process.exit(1); }, 5000);
