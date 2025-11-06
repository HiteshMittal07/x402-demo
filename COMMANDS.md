# Essential Commands Reference

This document contains all major commands for managing the x402-demo project with Docker and PostgreSQL.

## Table of Contents

- [Initial Setup](#initial-setup)
- [Docker Compose Operations](#docker-compose-operations)
- [Building and Rebuilding](#building-and-rebuilding)
- [Environment Variables](#environment-variables)
- [Database Operations](#database-operations)
- [Logs and Monitoring](#logs-and-monitoring)
- [Troubleshooting](#troubleshooting)
- [Development Workflow](#development-workflow)

---

## Initial Setup

### First-Time Setup

```bash
# Navigate to project directory
cd x402-demo

# Create .env file with required variables
cat > .env << EOF
POSTGRES_URL=postgresql://postgres:postgres@postgres:5432/eliza
PRIVATE_KEY=your-private-key-here
OPENAI_API_KEY=your-openai-key-here
# Add other environment variables as needed
EOF

# Build and start all services
docker-compose up -d

# Check service status
docker-compose ps
```

---

## Docker Compose Operations

### Start Services

```bash
# Start all services in detached mode
docker-compose up -d

# Start only PostgreSQL
docker-compose up -d postgres

# Start only the application
docker-compose up -d elizaos

# Start with logs visible
docker-compose up
```

### Stop Services

```bash
# Stop all services (keeps containers)
docker-compose stop

# Stop and remove containers (keeps volumes)
docker-compose down

# Stop and remove everything including volumes (⚠️ deletes data)
docker-compose down -v
```

### Restart Services

```bash
# Restart all services
docker-compose restart

# Restart specific service
docker-compose restart elizaos
docker-compose restart postgres

# Force recreate container (picks up new env vars)
docker-compose up -d --force-recreate elizaos
```

### Service Status

```bash
# Check running services
docker-compose ps

# Check service health
docker-compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
```

---

## Building and Rebuilding

### Build Docker Image

```bash
# Build the application image
docker-compose build elizaos

# Build without cache (clean build)
docker-compose build --no-cache elizaos

# Build and start
docker-compose up -d --build elizaos
```

### Rebuild After Code Changes

```bash
# When you modify source code, rebuild and restart:
docker-compose build elizaos
docker-compose up -d --force-recreate elizaos

# Or in one command:
docker-compose up -d --build --force-recreate elizaos
```

### View Built Images

```bash
# List all images
docker images

# List project-specific images
docker images | grep x402-demo

# Remove unused images
docker image prune
```

---

## Environment Variables

### View Environment Variables

```bash
# Check environment variables in container
docker-compose exec elizaos env

# Check specific variable
docker-compose exec elizaos env | grep PRIVATE_KEY
docker-compose exec elizaos env | grep POSTGRES_URL

# View .env file
cat .env
```

### Update Environment Variables

```bash
# Edit .env file
nano .env
# or
vim .env

# After updating .env, recreate container to pick up changes
docker-compose up -d --force-recreate elizaos
```

### Verify Environment Setup

```bash
# Verify PRIVATE_KEY is set
docker-compose exec elizaos env | grep PRIVATE_KEY

# Verify POSTGRES_URL is set
docker-compose exec elizaos env | grep POSTGRES_URL

# Verify all required variables
docker-compose exec elizaos env | grep -E "PRIVATE_KEY|POSTGRES_URL|OPENAI_API_KEY"
```

---

## Database Operations

### PostgreSQL Connection

```bash
# Connect to PostgreSQL database
docker-compose exec postgres psql -U postgres -d eliza

# Run SQL query
docker-compose exec postgres psql -U postgres -d eliza -c "SELECT version();"

# List all databases
docker-compose exec postgres psql -U postgres -c "\l"

# List all tables
docker-compose exec postgres psql -U postgres -d eliza -c "\dt"

# Check database size
docker-compose exec postgres psql -U postgres -d eliza -c "SELECT pg_size_pretty(pg_database_size('eliza'));"
```

### Database Backup and Restore

```bash
# Backup database
docker-compose exec postgres pg_dump -U postgres eliza > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore database
docker-compose exec -T postgres psql -U postgres eliza < backup_file.sql

# Backup with compression
docker-compose exec postgres pg_dump -U postgres -Fc eliza > backup_$(date +%Y%m%d_%H%M%S).dump
```

### Database Health Check

```bash
# Check if PostgreSQL is ready
docker-compose exec postgres pg_isready -U postgres

# Check PostgreSQL version
docker-compose exec postgres psql -U postgres -d eliza -c "SELECT version();"

# Check pgvector extension
docker-compose exec postgres psql -U postgres -d eliza -c "\dx"
```

---

## Logs and Monitoring

### View Logs

```bash
# View all service logs
docker-compose logs

# View logs for specific service
docker-compose logs elizaos
docker-compose logs postgres

# Follow logs in real-time
docker-compose logs -f elizaos
docker-compose logs -f postgres

# View last N lines
docker-compose logs --tail=50 elizaos

# View logs with timestamps
docker-compose logs -t elizaos

# View logs since specific time
docker-compose logs --since 10m elizaos
```

### Search Logs

```bash
# Search for errors
docker-compose logs elizaos | grep -i error

# Search for specific keyword
docker-compose logs elizaos | grep -i "PRIVATE_KEY"
docker-compose logs elizaos | grep -i "WALLET_INFO"

# Search across all services
docker-compose logs | grep -i "error"

# Count error occurrences
docker-compose logs elizaos | grep -i error | wc -l
```

### Container Stats

```bash
# View resource usage
docker stats

# View specific container stats
docker stats elizaos

# View disk usage
docker system df
```

---

## Troubleshooting

### Container Issues

```bash
# Check container logs for errors
docker-compose logs elizaos --tail=100

# Inspect container configuration
docker inspect elizaos

# Check container processes
docker-compose exec elizaos ps aux

# Access container shell
docker-compose exec elizaos /bin/bash
docker-compose exec elizaos sh

# Restart unhealthy container
docker-compose restart elizaos
```

### Network Issues

```bash
# Check network connectivity
docker-compose exec elizaos ping postgres

# Test database connection from app container
docker-compose exec elizaos psql postgresql://postgres:postgres@postgres:5432/eliza -c "SELECT 1;"

# List Docker networks
docker network ls

# Inspect network
docker network inspect x402-demo_eliza-network
```

### Port Conflicts

```bash
# Check if ports are in use
lsof -i :3000
lsof -i :5432

# Find process using port
lsof -i :3000 | grep LISTEN

# Kill process on port (if needed)
kill -9 $(lsof -t -i:3000)
```

### Clean Up

```bash
# Remove stopped containers
docker-compose rm

# Remove unused volumes
docker volume prune

# Remove unused networks
docker network prune

# Full system cleanup (⚠️ removes unused everything)
docker system prune -a
```

### Reset Everything

```bash
# Stop and remove all containers, networks, and volumes
docker-compose down -v

# Remove images
docker rmi x402-demo-elizaos

# Start fresh
docker-compose up -d --build
```

---

## Development Workflow

### Code Changes Workflow

```bash
# 1. Make code changes in src/
# 2. Rebuild image
docker-compose build elizaos

# 3. Restart container
docker-compose up -d --force-recreate elizaos

# 4. Monitor logs
docker-compose logs -f elizaos
```

### Quick Development Cycle

```bash
# Watch logs while developing
docker-compose logs -f elizaos &

# Make changes, then rebuild and restart
docker-compose build elizaos && docker-compose up -d --force-recreate elizaos
```

### Testing Commands

```bash
# Test database connection
docker-compose exec postgres psql -U postgres -d eliza -c "SELECT 1;"

# Test application health
curl http://localhost:3000

# Test environment variables
docker-compose exec elizaos env | grep PRIVATE_KEY
```

### Access Application

```bash
# Open in browser (macOS)
open http://localhost:3000

# Open in browser (Linux)
xdg-open http://localhost:3000

# Check if service is responding
curl http://localhost:3000
```

---

## Common Scenarios

### Scenario: Updated Environment Variables

```bash
# 1. Edit .env file
nano .env

# 2. Restart container to pick up changes
docker-compose up -d --force-recreate elizaos

# 3. Verify changes
docker-compose exec elizaos env | grep YOUR_VARIABLE
```

### Scenario: Code Changes

```bash
# 1. Make changes to source files
# 2. Rebuild image
docker-compose build elizaos

# 3. Restart with new image
docker-compose up -d --force-recreate elizaos

# 4. Check logs
docker-compose logs -f elizaos
```

### Scenario: Database Issues

```bash
# 1. Check PostgreSQL status
docker-compose ps postgres

# 2. Check logs
docker-compose logs postgres

# 3. Test connection
docker-compose exec postgres pg_isready -U postgres

# 4. Restart if needed
docker-compose restart postgres
```

### Scenario: Application Won't Start

```bash
# 1. Check logs for errors
docker-compose logs elizaos --tail=50

# 2. Verify environment variables
docker-compose exec elizaos env | grep -E "PRIVATE_KEY|POSTGRES_URL"

# 3. Check database connectivity
docker-compose exec elizaos ping postgres

# 4. Rebuild and restart
docker-compose build elizaos
docker-compose up -d --force-recreate elizaos
```

---

## Quick Reference Cheat Sheet

```bash
# Most Common Commands
docker-compose up -d                    # Start all services
docker-compose down                     # Stop all services
docker-compose ps                       # Check status
docker-compose logs -f elizaos          # Follow logs
docker-compose restart elizaos          # Restart app
docker-compose build elizaos            # Rebuild image
docker-compose up -d --force-recreate   # Recreate container

# Environment
docker-compose exec elizaos env         # View all env vars
cat .env                                # View .env file

# Database
docker-compose exec postgres psql -U postgres -d eliza  # Connect to DB

# Logs
docker-compose logs elizaos --tail=50   # Last 50 lines
docker-compose logs -f                  # Follow all logs
```

---

## Notes

- Always use `--force-recreate` when environment variables change
- Use `docker-compose build` after code changes
- PostgreSQL data persists in Docker volumes (use `docker-compose down -v` to remove)
- The application runs on `http://localhost:3000`
- PostgreSQL is accessible on `localhost:5432` from host machine
- Inside containers, use service name `postgres` instead of `localhost`

---

## Getting Help

```bash
# Docker Compose help
docker-compose --help

# Docker help
docker --help

# View service configuration
docker-compose config

# Validate configuration
docker-compose config --quiet
```


# RUNNING POSTGRES
brew services start postgresql@18 