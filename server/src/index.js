import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { config } from './config.js';
import { connectDb } from './db.js';
import { errorHandler } from './middleware.js';
import routes from './routes.js';
import { configureSockets } from './socket.js';
import { startAuctionTimer } from './services/auction.js';
import { startSyncCron } from './services/cricheroes.js';

const app = express();
const origin = (value, callback) => !value || config.clientUrls.includes(value) ? callback(null, true) : callback(new Error('CORS blocked'));
app.use(cors({ origin, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use('/api', routes);
app.use((_req, res) => res.status(404).json({ message: 'Route not found' }));
app.use(errorHandler);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: config.clientUrls, credentials: true } });
configureSockets(io);

connectDb().then(() => {
  startAuctionTimer(); startSyncCron();
  server.listen(config.port, () => console.log(`ICL API listening on ${config.port}`));
}).catch((error) => { console.error('Startup failed:', error); process.exit(1); });

export { app, server };
