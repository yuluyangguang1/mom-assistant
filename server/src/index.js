'use strict';
const http = require('node:http');
const cfg = require('./config');
const log = require('./log');
const db = require('./db');
const push = require('./push');
const { createApp } = require('./app');

log.init(cfg.logDir);
push.init(cfg);
const database = db.open(cfg.dataDir);
const app = createApp(cfg, database);

const server = http.createServer((req, res) => { app.handle(req, res); });
server.headersTimeout = 15e3;
server.requestTimeout = 30e3;
server.keepAliveTimeout = 65e3;

server.listen(cfg.port, cfg.host, () => {
  log.info('listening', { host: cfg.host, port: cfg.port, node: process.version, pid: process.pid });
  if (process.send) process.send('ready');
});

app.gc();
const gcTimer = setInterval(app.gc, 10 * 60e3);
gcTimer.unref();

function shutdown(sig) {
  log.info('shutdown', { sig });
  server.close(() => { try { database.close(); } catch {} process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', e => { log.error('uncaught', { err: String(e && e.stack || e).slice(0, 800) }); process.exit(1); });
process.on('unhandledRejection', e => { log.error('unhandledRejection', { err: String(e && e.stack || e).slice(0, 800) }); });
