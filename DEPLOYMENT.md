# Deploying Widget App to Your Home Server

This guide provides step-by-step instructions to securely deploy the Multi-Widget Shared Status backend to your home server using Docker. It leverages a production-ready `docker-compose.prod.yml` to build a lightweight, optimized image.

## Prerequisites

1. **Docker**: Ensure Docker is installed on your server (`sudo apt install docker.io`).
2. **Docker Compose**: Ensure Docker Compose plugin is installed.
3. **Git**: To clone the repository.
4. **Ports**: Ensure port **3000** is open/forwarded on your server router or firewall to access it from the outside world.

---

## Step 1: Clone the Repository

SSH into your home server and clone your project repository:

```bash
cd ~
git clone <YOUR_REPOSITORY_URL> widget_app
cd widget_app/widget_app_server
```

*(If you already have the files on your server, simply navigate to the `widget_app_server` directory.)*

---

## Step 2: Configure Environment Variables

For production, you must set secure passwords and secrets. Create a `.env.production` file:

```bash
touch .env.production
nano .env.production
```

Paste the following securely configured variables into the file:

```env
# Database Credentials
POSTGRES_USER=widget_admin
POSTGRES_PASSWORD=your_super_secret_db_password
POSTGRES_DB=widget_app_production

# JWT Authentication Secret (Must be long and random)
JWT_SECRET=generate_a_long_random_string_here_like_dj8923hdiu23hd923

# Optional Sentry Monitoring
SENTRY_DSN=
```
*(Tip: Replace `your_super_secret_db_password` and `generate_a_long_random_string_here...` with actual random values!)*

---

## Step 3: Build and Start the Containers

We will use the `docker-compose.prod.yml` file which uses our optimized multi-stage build. This command runs everything in detached mode (`-d`).

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### What happens in the background:
- **Node Container (`widget_app_prod`)**: Compiles the TypeScript, installs only production dependencies, and pushes your Prisma schema securely to the database.
- **Postgres (`widget_app_postgres_prod`)**: Starts your durable relational database.
- **Redis (`widget_app_redis_prod`)**: Starts your high-speed cache for WebSockets.

---

## Step 4: Verify the Deployment

Check that all containers are running successfully:

```bash
docker ps
```

You should see 3 containers marked as `Up`.

Check the application logs to ensure the server bound to the port correctly:

```bash
docker logs widget_app_prod
```
You should see: `Server listening on port 3000`.

---

## Step 5: Accessing Your Server

Your API and WebSockets are now live! You can connect to your server from any client using:

```text
http://<YOUR_SERVER_PUBLIC_IP>:3000
```
*(Or your custom domain name if you have mapped an A-record to your IP).*

### Best Practices for Public Servers:
- **Reverse Proxy**: It is highly recommended to run a reverse proxy like **Nginx** or **Traefik** in front of this container to handle SSL/TLS (HTTPS/WSS) certificates automatically via Let's Encrypt.
- **Firewall**: Lock down your server so only ports `80` and `443` are open to the world, and proxy them to port `3000` internally.

---

## Upgrading the App Later

If you make code changes and push them to Github, updating the server is simple:

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```
This rebuilding process will incur zero downtime for your persistent Postgres and Redis databases, as their data is stored safely in Docker Volumes.
