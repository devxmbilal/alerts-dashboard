const { Client } = require('ssh2'); 
const conn = new Client(); 
conn.on('ready', () => { 
  console.log('Connected to Hostinger'); 
  conn.exec('pm2 delete real-time-worker && pm2 restart alert-worker && pm2 save', (err, stream) => { 
    if (err) throw err; 
    stream.on('close', () => { 
      console.log('Worker deleted and alert-worker restarted'); 
      conn.end(); 
    }).on('data', (d) => process.stdout.write(d)).stderr.on('data', (d) => process.stderr.write(d)); 
  }); 
}).on('error', (err) => console.log('SSH Error:', err)).connect({ 
  host: '157.173.221.83', 
  port: 22, 
  username: 'root', 
  password: 'Arham@810000', 
  readyTimeout: 20000 
});
