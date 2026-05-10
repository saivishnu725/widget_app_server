"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const redisService_1 = require("../services/redisService");
const redis_1 = __importDefault(require("../config/redis"));
describe('Redis Service - Lua Script Atomic Toggle', () => {
    const testWidgetId = `test_widget_${Date.now()}`;
    const userA = `user_a_${Date.now()}`;
    const userB = `user_b_${Date.now()}`;
    beforeEach(async () => {
        // Reset state before each test
        await redis_1.default.del(`widget:${testWidgetId}:state`);
        await redis_1.default.del(`widget:${testWidgetId}:lastModifiedBy`);
        await redis_1.default.del(`widget:${testWidgetId}:lastModifiedAt`);
        await redis_1.default.set(`widget:${testWidgetId}:state`, 'OFF');
    });
    afterAll(async () => {
        await redis_1.default.quit();
    });
    it('should successfully turn ON and set user A as initiator', async () => {
        const result = await (0, redisService_1.toggleWidgetState)(testWidgetId, 'ON', userA);
        expect(result).toBe('SUCCESS');
        const cache = await (0, redisService_1.getWidgetStateCache)(testWidgetId);
        expect(cache.state).toBe('ON');
        expect(cache.lastModifiedBy).toBe(userA);
    });
    it('should return ALREADY_ON if user tries to turn ON an already ON widget', async () => {
        await (0, redisService_1.toggleWidgetState)(testWidgetId, 'ON', userA);
        const result = await (0, redisService_1.toggleWidgetState)(testWidgetId, 'ON', userB);
        expect(result).toBe('ALREADY_ON');
        // State should still point to userA as initiator
        const cache = await (0, redisService_1.getWidgetStateCache)(testWidgetId);
        expect(cache.lastModifiedBy).toBe(userA);
    });
    it('should allow initiator (user A) to turn OFF the widget', async () => {
        await (0, redisService_1.toggleWidgetState)(testWidgetId, 'ON', userA);
        const result = await (0, redisService_1.toggleWidgetState)(testWidgetId, 'OFF', userA);
        expect(result).toBe('SUCCESS');
        const cache = await (0, redisService_1.getWidgetStateCache)(testWidgetId);
        expect(cache.state).toBe('OFF');
        // It's acceptable for lastModifiedBy to stay as userA, tracking who turned it OFF
        expect(cache.lastModifiedBy).toBe(userA);
    });
    it('should FORBID user B from turning OFF a widget initiated by user A', async () => {
        await (0, redisService_1.toggleWidgetState)(testWidgetId, 'ON', userA);
        const result = await (0, redisService_1.toggleWidgetState)(testWidgetId, 'OFF', userB);
        expect(result).toBe('FORBIDDEN');
        // State should still be ON, with userA as initiator
        const cache = await (0, redisService_1.getWidgetStateCache)(testWidgetId);
        expect(cache.state).toBe('ON');
        expect(cache.lastModifiedBy).toBe(userA);
    });
    it('should return ALREADY_OFF if widget is already OFF', async () => {
        const result = await (0, redisService_1.toggleWidgetState)(testWidgetId, 'OFF', userA);
        expect(result).toBe('ALREADY_OFF');
    });
});
