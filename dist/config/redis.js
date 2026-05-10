"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ioredis_1 = require("ioredis");
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = new ioredis_1.Redis(redisUrl);
redisClient.on('error', (err) => {
    console.error('Redis connection error:', err);
});
redisClient.on('connect', () => {
    console.log('Successfully connected to Redis');
});
exports.default = redisClient;
