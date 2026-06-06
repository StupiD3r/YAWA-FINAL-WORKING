# YAWA — Setup Guide

## Prerequisites

- **Docker Desktop** (with WSL2 backend on Windows)
- **Node.js** v18+
- **npm**

---

## Step 1: Start Infrastructure (Docker)

From the project root:

```
docker-compose up -d
```

This spins up:
- MongoDB config server + 2 shards + mongos router (port **27016**)
- Redis cache (port **6379**)
- ZooKeeper (port **2181**)
- Kafka broker (port **9092**)

---

## Step 2: Initialize MongoDB Replica Sets

**This step is critical.** The mongos router will not work until the config server replica set is initialized.

Wait ~15 seconds for containers to be ready, then run:

```
docker exec mongo-configsvr mongosh --port 27019 --eval "rs.initiate({_id: 'configReplSet', configsvr: true, members: [{_id: 0, host: 'configsvr:27019'}]})"
docker exec mongo-shard1a mongosh --port 27018 --eval "rs.initiate({_id: 'shard1ReplSet', members: [{_id: 0, host: 'shard1a:27018'}]})"
docker exec mongo-shard2a mongosh --port 27017 --eval "rs.initiate({_id: 'shard2ReplSet', members: [{_id: 0, host: 'shard2a:27017'}]})"
```

**Note:** On Windows PowerShell, omit the `-it` flag from `docker exec` — it will fail with _"cannot attach stdin to a TTY-enabled container"_.

Wait ~60 seconds for replica set primaries to be elected, then proceed.

---

## Step 3: Restart Mongos Router

The mongos container may not automatically detect the newly initialized config replica set. Restart it:

```
docker restart mongo-router
```

Wait ~10 seconds for it to come back up.

---

## Step 4: Add Shards to Mongos Router

```
docker exec mongo-router mongosh --port 27016 --eval "sh.addShard('shard1ReplSet/shard1a:27018')"
docker exec mongo-router mongosh --port 27016 --eval "sh.addShard('shard2ReplSet/shard2a:27017')"
```

---

## Step 5: Install Dependencies

Three separate locations require `npm install`:

```
npm install                          # root
cd server && npm install && cd ..    # server dependencies
cd client\yawa && npm install        # client dependencies
```

---

## Step 6: Seed the Database

```
cd server
node src/scripts/seed.js
cd ..
```

This creates the `academic_analytics` database with 350,000 grade records across 6 departments and 4 semesters.

### (Optional) Enable Sharding on the Collection

If the collection was not automatically sharded:

```
docker exec mongo-router mongosh --port 27016 --eval "sh.enableSharding('academic_analytics')"
docker exec mongo-router mongosh --port 27016 --eval "sh.shardCollection('academic_analytics.grades', { department: 1, student_id: 1 })"
```

---

## Step 7: Start the Backend

```
cd server
npm start
```

This launches:
- **Apollo GraphQL API** on `http://localhost:4000`
- **SSE Stream** on `http://localhost:4001/stream`

Expected output:
```
🚀 Connected to Sharded MongoDB Cluster Router...
⚡ Connected to Distributed Redis Cache Engine...
🚀 Connected to Real-Time Apache Kafka Broker...
📊 GraphQL Engine ready at: http://localhost:4000/
📡 SSE Stream ready at: http://localhost:4001/stream
```

> A Kafka _"negative timeout"_ warning may appear — this is harmless and resolves on its own.

---

## Step 8: Start the Frontend

In a **separate terminal**:

```
cd client\yawa
npm run dev
```

Open the URL shown in the terminal (typically `http://localhost:5173`).

---

## Step 9 (Optional): Live Mutation Simulator

In a **third terminal**, to see real-time grade mutations streaming into the dashboard:

```
cd server
node src/scripts/live-simulator.js
```

---

## Port Reference

| Service | Port |
|---|---|
| Vite Dev Server (Frontend) | 5173 |
| Apollo GraphQL API | 4000 |
| SSE Stream | 4001 |
| Legacy Express REST | 5000 |
| Mongos Router (MongoDB) | 27016 |
| Redis Cache | 6379 |
| Kafka Broker | 9092 |
| ZooKeeper | 2181 |
