import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { User } from './models.js';

let io;
export const setIO = (instance) => { io = instance; };
export const getIO = () => io;

export function configureSockets(instance) {
  setIO(instance);
  instance.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(); // public viewers may receive updates
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      socket.user = await User.findById(payload.sub).select('-passwordHash');
      return next();
    } catch {
      return next(new Error('Invalid authentication token'));
    }
  });
  instance.on('connection', (socket) => {
    socket.on('auction:join', (auctionId) => socket.join(`auction:${auctionId}`));
    socket.on('disconnect', () => {});
  });
}

export function emitAuction(auctionId, event, payload) {
  if (!io) return;
  io.to(`auction:${auctionId}`).emit(event, payload);
  io.emit(event, payload); // projector/public clients need no room setup
}
