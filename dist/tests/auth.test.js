"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const app_1 = __importDefault(require("../app"));
const db_1 = __importDefault(require("../config/db"));
describe('Auth Routes', () => {
    const testUser = {
        email: `test_${Date.now()}@example.com`,
        password: 'password123',
        name: 'Test User'
    };
    afterAll(async () => {
        // Clean up the test user from the database
        await db_1.default.user.deleteMany({
            where: { email: testUser.email }
        });
        // Disconnect prisma
        await db_1.default.$disconnect();
    });
    describe('POST /auth/register', () => {
        it('should register a new user successfully', async () => {
            const response = await (0, supertest_1.default)(app_1.default)
                .post('/auth/register')
                .send(testUser);
            expect(response.status).toBe(201);
            expect(response.body.message).toBe('User registered successfully');
            expect(response.body.token).toBeDefined();
            expect(response.body.user.email).toBe(testUser.email);
        });
        it('should fail if email already exists', async () => {
            const response = await (0, supertest_1.default)(app_1.default)
                .post('/auth/register')
                .send(testUser);
            expect(response.status).toBe(409);
            expect(response.body.error).toBe('User with this email already exists');
        });
        it('should fail if missing required fields', async () => {
            const response = await (0, supertest_1.default)(app_1.default)
                .post('/auth/register')
                .send({ email: 'incomplete@example.com' });
            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Email, password, and name are required');
        });
    });
    describe('POST /auth/login', () => {
        it('should log in successfully with correct credentials', async () => {
            const response = await (0, supertest_1.default)(app_1.default)
                .post('/auth/login')
                .send({
                email: testUser.email,
                password: testUser.password
            });
            expect(response.status).toBe(200);
            expect(response.body.message).toBe('Login successful');
            expect(response.body.token).toBeDefined();
        });
        it('should fail with incorrect password', async () => {
            const response = await (0, supertest_1.default)(app_1.default)
                .post('/auth/login')
                .send({
                email: testUser.email,
                password: 'wrongpassword'
            });
            expect(response.status).toBe(401);
            expect(response.body.error).toBe('Invalid credentials');
        });
        it('should fail with non-existent email', async () => {
            const response = await (0, supertest_1.default)(app_1.default)
                .post('/auth/login')
                .send({
                email: 'doesnotexist@example.com',
                password: 'password123'
            });
            expect(response.status).toBe(401);
            expect(response.body.error).toBe('Invalid credentials');
        });
    });
});
