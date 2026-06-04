# YAWA Academic System — Documentation

---

## 2. System Architecture

### 2.1. High-Level Architecture Diagram

```
                         ┌─────────────────────────────────────┐
                         │         React SPA (Vite 8)          │
                         │   UserDashboard — Recharts Charts   │
                         │   EventSource (SSE Client)          │
                         │   Theme Toggle (localStorage)       │
                         └────────────┬────────────────────────┘
                                      │ HTTP POST /graphql
                                      │ Content-Type: application/json
                                      ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│                            Apollo Server 4 (:4000)                                  │
│                                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │  Schema (gradeDefs.js): 8 Queries + 2 Mutations + 9 Types                  │   │
│  │  Resolvers (gradeResolvers.js): Cache-Aware, Write-Through, Instrumented    │   │
│  │  Context Injection: { db: MongoClient.db, redis: RedisClient }              │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                     │
│  ┌────────────────────────────┐  ┌──────────────────────────┐  ┌────────────────┐  │
│  │  getGrades                 │  │  updateStudentGrade       │  │  getDepartment │  │
│  │  → Cursor Pagination      │  │  → findOneAndUpdate       │  │  Analytics     │  │
│  │  → Multi-Field Filtering  │  │  → Redis Eviction         │  │  → Cache-Aside │  │
│  │  → Sort & Limit           │  │  → Kafka Publish          │  │  → 60s TTL     │  │
│  └────────────────────────────┘  └──────────────────────────┘  └────────────────┘  │
└──────────┬──────────────────────────────────────┬───────────────────────────────────┘
           │                                      │
           ▼                                      ▼
┌─────────────────────────────┐    ┌──────────────────────────────────┐
│  Mongos Router (:27016)     │    │  Redis Cache (:6379)              │
│  Sharded MongoDB Cluster    │    │  ┌──────────────────────────┐    │
│                             │    │  │ Cache-Aside (Lazy Load)  │    │
│  ┌───────────────────────┐  │    │  │ TTL: 60 seconds          │    │
│  │  Config Server        │  │    │  │ Key: analytics:dept:*    │    │
│  │  (configReplSet)      │  │    │  │ Eviction: on write       │    │
│  │  Metadata & Routing   │  │    │  └──────────────────────────┘    │
│  └───────────────────────┘  │    └──────────────────────────────────┘
│         │                    │
│  ┌──────┴────────┐          │
│  │               │          │
│  ▼               ▼          │
│  ┌────────┐  ┌────────┐     │
│  │Shard 1 │  │Shard 2 │     │
│  │ReplSet │  │ReplSet │     │
│  │:27018  │  │:27017  │     │
│  └────────┘  └────────┘     │
└─────────────────────────────┘    ┌──────────────────────────────────┐
                                   │  Apache Kafka (:9092)             │
                                   │  Topic: grade-mutations           │
                                   │  Partition Key: department       │
                                   │  ┌──────────────────────────┐    │
                                   │  │ Producer (fire-and-forget)│    │
                                   │  │ Consumer (group:          │    │
                                   │  │  academic-analytics)     │    │
                                   │  │ → Bridge to SSE          │    │
                                   │  └──────────────────────────┘    │
                                   │         │                        │
                                   │  ┌──────┴────────┐               │
                                   │  │  Zookeeper     │               │
                                   │  │  (:2181)       │               │
                                   │  │  Broker State  │               │
                                   │  └───────────────┘               │
                                   └──────────────────────────────────┘
                                             │
                                             ▼
                                   ┌──────────────────────────────────┐
                                   │  SSE Stream Server (:4001)       │
                                   │  ┌──────────────────────────┐    │
                                   │  │ eventBuffer[MAX=100]     │    │
                                   │  │ → unshift new events     │    │
                                   │  │ → pop oldest at 101      │    │
                                   │  │ → broadcast to all       │    │
                                   │  │   connected clients      │    │
                                   │  │ → replay last 10 on      │    │
                                   │  │   new client connect     │    │
                                   │  └──────────────────────────┘    │
                                   └────────────┬─────────────────────┘
                                                │ text/event-stream
                                                │ SSE protocol
                                                ▼
                                   ┌──────────────────────────────────┐
                                   │  Connected Browser Clients       │
                                   │  ┌──────────────────────────┐    │
                                   │  │ streamLog (client-side)   │    │
                                   │  │ → prepend each event      │    │
                                   │  │ → cap at 50 entries       │    │
                                   │  │ → display in Streams tab  │    │
                                   │  └──────────────────────────┘    │
                                   └──────────────────────────────────┘
```

### 2.2. Component Descriptions & Transactions

Apollo Server 4 serves as the single entry point for all data operations. It is started via `startStandaloneServer` in `server/src/index.js` on port 4000. The GraphQL schema is defined in `server/src/graphql/typeDefs/gradeDefs.js` and implemented by resolvers in `server/src/graphql/resolvers/gradeResolvers.js`.

#### Request Flow

1. The client sends an HTTP POST request to `/graphql` with a JSON body containing the query string and optional variables.
2. Apollo parses the query against the schema defined in `gradeDefs.js`, validates it, and delegates execution to the corresponding resolver function in `gradeResolvers.js`.
3. Each resolver receives a context object injected at startup containing `{ db, redis }` — the MongoDB database handle and Redis client instance.
4. The resolver executes the appropriate data-fetching logic:
   - For **queries**: MongoDB cursor-based pagination, aggregation pipelines, Redis cache lookups, or direct point queries via compound shard key.
   - For **mutations**: MongoDB writes followed by Redis cache eviction and Kafka event publication.
5. Apollo serializes the resolver's return value into the GraphQL response shape and sends the JSON response back to the client, including timing metadata for observability.

#### Resolver Delegation Pattern

| Resolver | Category | Responsibility | Data Sources |
|----------|----------|---------------|--------------|
| **getGrades** | Query | Builds a dynamic MongoDB query from optional filters (`semester`, `studentId`, `studentName`, `department`); performs cursor-based pagination using `ObjectId` comparison (`$lt`) with descending sort (`_id: -1`); fetches `limit+1` records to determine `hasMore` | MongoDB `grades` collection |
| **getDepartmentAnalytics** | Query | Implements cache-aside pattern: checks Redis key `analytics:dept:<department>` first; on cache hit, returns immediately with `cacheHit: true`; on cache miss, runs a MongoDB aggregation pipeline (`$match` → `$group` for `totalCount` and `averageGrade`), caches the result with a 60-second TTL (`setEx`), and returns | Redis cache + MongoDB aggregation |
| **getStudentGrades** | Query | Direct MongoDB point query using the compound shard key `{ department, student_id }` — targets a specific shard without scatter-gather overhead, returning all grade records for a given student in a department | MongoDB `grades` collection |
| **searchStudentById** | Query | Performs a prefix regex search (`$regex: ^<student_id>`) across all departments with cursor-based pagination; supports progressive search-as-you-type | MongoDB `grades` collection |
| **getSemesterAnalytics** | Query | Aggregation pipeline grouping by `semester` field to compute `totalCount` and `averageGrade` per semester, sorted chronologically | MongoDB aggregation |
| **getAtRiskCount** | Query | `countDocuments` with filter `{ grade: { $in: [3.0, 5.0] } }` — counts students flagged as at-risk; optionally filtered by `semester` | MongoDB `grades` collection |
| **getGradeDistribution** | Query | Aggregation pipeline grouping by `grade` value to produce a histogram of all grade occurrences (`grade` → `count`) | MongoDB aggregation |
| **getDepartmentSemesterTrends** | Query | Aggregation pipeline grouping by composite key `{ department, semester }` to produce per-department grade trajectories over time for multi-line chart visualization | MongoDB aggregation |
| **updateStudentGrade** | Mutation | Three-step write-through pattern: (1) `findOneAndUpdate` on MongoDB matching `{ student_id, department, course_code }` with the new grade and timestamp; (2) Redis cache eviction via `del` on the department analytics key; (3) Kafka event publication via `streamLogEvent('grade-mutations', 'GRADE_UPDATED', cleanRecord)` | MongoDB + Redis + Kafka |
| **addGradeRecord** | Mutation | Four-step pattern: (1) Duplicate check — `findOne` for existing `{ student_id, course_code }` combo, throws if found; (2) `insertOne` on MongoDB with the complete grade document; (3) Redis cache eviction on the department analytics key; (4) Kafka event publication `('grade-mutations', 'GRADE_ADDED', inserted)` | MongoDB + Redis + Kafka |

---

## 3. GraphQL API Design

### 3.1. Schema Overview

The GraphQL schema is defined in `server/src/graphql/typeDefs/gradeDefs.js` using Apollo's `#graphql` template literal syntax. It declares 9 custom types, 8 queries, and 2 mutations.

#### Core Types

```graphql
type GradeRecord {
  id: ID!
  student_id: String!
  student_name: String!
  department: String!
  course_code: String!
  semester: String!
  grade: Float!
  credits: Int!
  updated_at: String
}

type GradeResponse {
  records: [GradeRecord!]!
  nextCursor: String
  hasMore: Boolean!
  timing: QueryTiming
}

type ShardStats {
  totalCount: Int!
  averageGrade: Float!
  timing: TimingDetails
}

type QueryTiming {
  textField: String
  totalTimeMs: Float
  dbQueryTimeMs: Float
  cacheHit: Boolean
}

type SemesterStats {
  semester: String!
  totalCount: Int!
  averageGrade: Float!
}

type GradeDistribution {
  grade: Float!
  count: Int!
}

type DepartmentTrend {
  department: String!
  semester: String!
  averageGrade: Float!
  totalCount: Int!
}
```

#### Input Type

```graphql
input AddGradeInput {
  student_id: String!
  student_name: String!
  department: String!
  course_code: String!
  semester: String!
  grade: Float!
  credits: Int!
}
```

#### Design Decisions

- **`GradeRecord` uses `id: ID!`** at the schema level mapped from MongoDB's `_id` via `r._id.toString()` in resolvers, providing a cache-friendly opaque identifier.
- **`QueryTiming`** is embedded in paginated responses for observability — tracks `totalTimeMs`, `dbQueryTimeMs`, and `cacheHit` flag.
- **`nextCursor` is a String** (MongoDB ObjectId hex string), never exposing internal database structure to the client.

### 3.2. Queries

| Query | Arguments | Return Type | Resolver Responsibility |
|-------|-----------|-------------|------------------------|
| **getGrades** | `limit: Int`, `nextCursor: String`, `semester: String`, `studentId: String`, `studentName: String`, `department: String` | `GradeResponse!` | Builds dynamic MongoDB query from optional filter parameters; performs cursor-based pagination using `_id: { $lt: ObjectId(nextCursor) }` with descending sort; fetches `limit + 1` records to determine `hasMore`; populates `timing` metadata |
| **getDepartmentAnalytics** | `department: String!` | `ShardStats!` | Implements cache-aside pattern: checks Redis key `analytics:dept:<department>` first; on cache hit returns immediately; on cache miss runs MongoDB aggregation pipeline (`$match` → `$group` for `totalCount` + `averageGrade`), caches result with 60s TTL, returns |
| **getStudentGrades** | `student_id: String!`, `department: String!` | `[GradeRecord!]!` | Direct MongoDB point query using compound shard key `{ department, student_id }` — routes to a single shard without scatter-gather overhead |
| **searchStudentById** | `student_id: String!`, `limit: Int`, `nextCursor: String` | `GradeResponse!` | Prefix regex search (`$regex: ^<student_id>`) across all departments with cursor-based pagination; enables progressive search-as-you-type |
| **getSemesterAnalytics** | — | `[SemesterStats!]!` | MongoDB aggregation pipeline grouping by `semester` field; returns `totalCount` and `averageGrade` sorted chronologically |
| **getAtRiskCount** | `semester: String` | `Int!` | `countDocuments` with filter `{ grade: { $in: [3.0, 5.0] } }` returning count of flagged students; optionally filtered by semester |
| **getGradeDistribution** | — | `[GradeDistribution!]!` | Aggregation pipeline grouping by `grade` value to produce a histogram of grade occurrences |
| **getDepartmentSemesterTrends** | — | `[DepartmentTrend!]!` | Aggregation pipeline grouping by composite key `{ department, semester }` producing per-department grade trajectories for multi-line chart visualization |

### 3.3. Mutations

| Mutation | Arguments | Return Type | Resolver Responsibility |
|----------|-----------|-------------|------------------------|
| **updateStudentGrade** | `student_id: String!`, `department: String!`, `course_code: String!`, `newGrade: Float!` | `GradeRecord!` | Three-step write-through: (1) `findOneAndUpdate` on MongoDB matching `{ student_id, department, course_code }` with `$set: { grade, updated_at }`; (2) Redis cache eviction via `del` on `analytics:dept:<department>`; (3) Kafka event publish `('grade-mutations', 'GRADE_UPDATED', cleanRecord)` |
| **addGradeRecord** | `input: AddGradeInput!` | `GradeRecord!` | Four-step pattern: (1) Duplicate check — `findOne` for existing `{ student_id, course_code }` combo, throws if found; (2) `insertOne` on MongoDB with the complete document; (3) Redis cache eviction; (4) Kafka event publish `('grade-mutations', 'GRADE_ADDED', inserted)` |

#### Write-Through Mutation Flow

```
Client → GraphQL Mutation
         │
         ├─ Step 1: MongoDB write (findOneAndUpdate / insertOne)
         ├─ Step 2: Redis cache eviction (del analytics:dept:*)
         ├─ Step 3: Kafka event publish (streamLogEvent)
         │
         └─ Response returned to client
```

### 3.4. Apollo Server Integration

#### Context-Based Dependency Injection

The database handle and Redis client are injected into every resolver through Apollo's context factory:

```javascript
const { url } = await startStandaloneServer(server, {
  listen: { port: 4000 },
  context: async () => ({ db, redis: redisClient }),
});
```

This eliminates global state, making resolvers testable and infrastructure-swappable.

#### Resolver Delegation Flow

1. The client sends an HTTP POST request to `/graphql` with a JSON body containing the query string and optional variables.
2. Apollo parses the query against the schema defined in `gradeDefs.js`, validates it against the type system, and delegates execution to the corresponding resolver function in `gradeResolvers.js`.
3. Each resolver receives the `{ db, redis }` context, executes the appropriate data-fetching logic, and returns the result.
4. Apollo serializes the resolver's return value into the GraphQL response shape and sends it back to the client as JSON.

#### Performance Instrumentation

Every query and mutation tracks execution timing via `performance.now()`:

```javascript
const startTime = performance.now();
// ... data fetching logic ...
const endTime = performance.now();
return {
  ...responseData,
  timing: {
    totalTimeMs: (endTime - startTime).toFixed(2),
    dbQueryTimeMs: (queryEndTime - queryStartTime).toFixed(2),
    cacheHit: false
  }
};
```

### 3.5. Error Handling Strategies

| Strategy | Location | Description |
|----------|----------|-------------|
| **Redis Graceful Degradation** | `gradeResolvers.js:122-151` | The `getDepartmentAnalytics` resolver wraps its entire cache logic in a `try/catch`. If Redis is unavailable, the resolver falls back to querying MongoDB directly. The server also logs a warning on Redis connection failure at startup (`index.js:29-31`) and continues in database-only mode. |
| **Duplicate Insert Guard** | `gradeResolvers.js:303-309` | `addGradeRecord` performs a `findOne` check for existing `{ student_id, course_code }` before inserting. If a duplicate is found, it throws a descriptive `GraphQLError`. |
| **Invalid Cursor Guard** | `gradeResolvers.js:12-16, 167-171` | Paginated resolvers wrap `new ObjectId(nextCursor)` in a `try/catch`. Invalid cursor strings produce: "Invalid cursor format provided for pagination." |
| **Kafka Error Isolation** | `kafka.js:17-24, 26-45, 32-38` | Kafka connection and consumer failures are caught and logged individually. The server continues running without event streaming. Malformed messages are skipped without crashing the consumer loop. |
| **SSE Client Cleanup** | `stream.js:19` | Failed `res.write()` calls are caught silently and the client ID is removed from the `clients` Map, preventing memory leaks from disconnected clients. |

### 3.6. Security Measures

| Measure | Implementation |
|---------|---------------|
| **Type Validation** | GraphQL's built-in type system enforces argument types (non-null `String!`, `Float!`, `Int!`) and validates inputs at the schema level before resolvers execute. |
| **CORS** | Enabled on both Apollo Server (`cors()` middleware) and the SSE Express server (`sseApp.use(cors())`) to restrict cross-origin requests. |
| **Input Sanitization** | Regex patterns used in `searchStudentById` and `getGrades` are prefix-anchored (`^<input>`) to prevent injection; MongoDB driver parameterizes all queries via `$regex`, `$match`, and `$group` pipeline operators. |

#### Limitations and Future Improvements

- **Authentication:** The API currently has no authentication layer. All queries and mutations are publicly accessible from any origin with CORS access. A future enhancement would integrate JWT-based authentication via Apollo's context or Express middleware.
- **Rate Limiting:** No rate limiting is implemented. Production deployment should add rate limiting (e.g., `express-rate-limit`) to prevent abuse of the GraphQL endpoint.
- **Query Depth Limiting:** Apollo Server's built-in query depth limiting is not configured. Malicious deeply nested queries could cause resource exhaustion.

### 3.7. Algorithms — Request Batching

#### Current Implementation (Parallel Requests via `Promise.all`)

Instead of Apollo Server-level request batching (e.g., DataLoader), the client implements request parallelism at the application layer. When loading the Dashboard Overview tab, the frontend fires 9 independent GraphQL queries simultaneously:

```javascript
const [deptData, semData, distData, trendsData] = await Promise.all([
  Promise.all(DEPARTMENTS.map(dept =>
    gql(`{ getDepartmentAnalytics(department: "${dept}") { ... } }`)
  )),
  gql(`{ getSemesterAnalytics { ... } }`),
  gql(`{ getGradeDistribution { ... } }`),
  gql(`{ getDepartmentSemesterTrends { ... } }`),
]);
```

This pattern dispatches 6 department analytics queries + 3 aggregate queries in parallel, reducing overall dashboard load time to the latency of the slowest single query.

#### Comparison with DataLoader Batching

| Aspect | Current Approach (`Promise.all`) | DataLoader (Not Implemented) |
|--------|--------------------------------|------------------------------|
| Mechanism | Fires N independent HTTP requests | Coalesces N requests into 1 batched DB query |
| Network | N round-trips to Apollo Server | 1 round-trip |
| Use Case | Independent queries (different departments) | Same query with different arguments (e.g., batch `getStudentGrades`) |
| Caching | Per-request browser cache | In-memory per-request cache with deduplication |

#### Recommendation for Future Enhancement

If the system adds a feature that requires fetching grade data for N students simultaneously (e.g., a "Compare Students" report), `DataLoader` should be introduced to batch those lookups into a single MongoDB `$in` query.

---

## 4. Database Design (MongoDB Sharded Cluster)

### 4.1. Database Schema Overview

The system uses a single MongoDB database `academic_analytics` with one collection: `grades`. All data resides in this collection, distributed across two shards.

```javascript
const MONGO_URI = 'mongodb://localhost:27016';
const DB_NAME = 'academic_analytics';
```

The connection targets the `mongos` router at port 27016, which abstracts the underlying sharded cluster topology from the application.

### 4.2. Collection Schema — `grades`

Each document in the `grades` collection represents a single student's grade record for one course in one semester.

#### Document Structure

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| `_id` | `ObjectId` | `507f1f77bcf86cd799439011` | MongoDB auto-generated primary key; used as pagination cursor |
| `student_id` | `String` | `STU584291` | Unique student identifier; part of compound shard key |
| `student_name` | `String` | `Jane Smith` | Student's full name (generated via faker) |
| `department` | `String` | `Computer Science` | Academic department; part of compound shard key |
| `course_code` | `String` | `CS301` | Department-specific course code |
| `semester` | `String` | `Fall 2024` | Academic term (4 semesters in seed data) |
| `grade` | `Float` | `1.75` | Grade value from allowed set: `[1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 5.0]` |
| `credits` | `Int` | `3` | Course credit hours (3 or 4) |
| `updated_at` | `String (ISO)` | `2026-06-04T12:00:00.000Z` | Timestamp of last update — set on insert and mutation |

#### Sample Document

```json
{
  "_id": ObjectId("665a1b2c3d4e5f6a7b8c9d0e"),
  "student_id": "STU584291",
  "student_name": "Jane Smith",
  "department": "Computer Science",
  "course_code": "CS301",
  "semester": "Fall 2024",
  "grade": 1.75,
  "credits": 3,
  "updated_at": "2026-06-04T12:00:00.000Z"
}
```

### 4.3. Sharding Configuration

#### Cluster Topology

```
┌─────────────────────────────────────────────────────┐
│                   mongos Router                      │
│              mongo-router:27016                      │
│         (Single entry point for all queries)         │
└──────────┬──────────────────────┬───────────────────┘
           │                      │
           ▼                      ▼
┌──────────────────┐   ┌──────────────────┐
│   Config Server   │   │   Shard 1         │   ┌──────────────────┐
│  configReplSet    │   │  shard1ReplSet    │   │   Shard 2         │
│  :27019           │   │  :27018           │   │  shard2ReplSet    │
│                   │   │                   │   │  :27017           │
│  Stores metadata  │   │  ~50% of data     │   │  ~50% of data     │
│  about shard      │   │                   │   │                   │
│  locations        │   │                   │   │                   │
└──────────────────┘   └──────────────────┘   └──────────────────┘
```

| Component | Container Name | Port | Purpose |
|-----------|---------------|------|---------|
| Config Server | `mongo-configsvr` | 27019 | Stores cluster metadata (which shard holds which chunk ranges) |
| Shard 1 | `mongo-shard1a` | 27018 | Primary data shard — replica set `shard1ReplSet` |
| Shard 2 | `mongo-shard2a` | 27017 | Secondary data shard — replica set `shard2ReplSet` |
| Mongos Router | `mongo-router` | 27016 | Query router — presents a single-node view to the application |

#### Docker Compose Configuration

```yaml
services:
  configsvr:
    image: mongo:6.0
    command: mongod --configsvr --replSet configReplSet --port 27019 --bind_ip_all
  shard1a:
    image: mongo:6.0
    command: mongod --shardsvr --replSet shard1ReplSet --port 27018 --bind_ip_all
  shard2a:
    image: mongo:6.0
    command: mongod --shardsvr --replSet shard2ReplSet --port 27017 --bind_ip_all
  mongos:
    image: mongo:6.0
    command: mongos --configdb configReplSet/configsvr:27019 --bind_ip_all --port 27016
```

#### Compound Shard Key Design

The shard key is `{ department: 1, student_id: 1 }` — a compound key chosen for query efficiency and even data distribution.

| Criterion | Evaluation |
|-----------|-----------|
| **Cardinality** | High — `department` (6 values) × `student_id` (5,000+ values) = 30,000+ unique combinations |
| **Query Coverage** | All point queries (`getStudentGrades`) include `department` and `student_id` — these route directly to one shard |
| **Write Distribution** | Random department + student selection in seed data distributes writes evenly across both shards |
| **Range Queries** | Aggregation queries (`getDepartmentAnalytics`) scatter across all shards but are optimized by prefixed `department` filter |

#### Targeted Shard Query

```javascript
const records = await db.collection('grades')
  .find({ department, student_id })  // Full shard key → 1 shard
  .toArray();
```

#### Scatter-Gather Query

```javascript
const pipeline = [
  { $group: { _id: "$semester", totalCount: { $sum: 1 }, averageGrade: { $avg: "$grade" } } }
];
const results = await db.collection('grades').aggregate(pipeline).toArray();
```

### 4.4. Data Seeding

The seed script (`server/src/scripts/seed.js`) populates the cluster with 350,000 realistic grade records.

#### Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| Total Records | 350,000 | Target document count |
| Batch Size | 10,000 | Documents per `bulkWrite` call |
| Unique Students | 5,000 | Pre-generated pool of student IDs and names |
| Departments | 6 | Computer Science, Data Science, Electrical Eng, Mechanical Eng, Mathematics, Physics |
| Semesters | 4 | Fall 2024, Spring 2025, Fall 2025, Spring 2026 |
| Allowed Grades | 10 | `[1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 5.0]` |
| Courses per Dept | 4 | e.g., CS101, CS201, CS301, CS401 |

#### Algorithm — Unordered Bulk Write

```javascript
operations.push({ insertOne: { document: gradeDocument } });
await collection.bulkWrite(operations, { ordered: false });
```

`{ ordered: false }` allows MongoDB to process all operations in parallel within a batch, maximizing throughput during seeding.

#### Progress Tracking

```
Progress: 25.00% | Total Processed: 87500 docs
Progress: 50.00% | Total Processed: 175000 docs
Progress: 75.00% | Total Processed: 262500 docs
Progress: 100.00% | Total Processed: 350000 docs

🎉 Seeding complete! Successfully added 350000 records in 42.37 seconds.
```

### 4.5. Aggregation Pipeline Optimization

The system uses 4 aggregation pipelines for analytics queries.

**Pipeline 1 — Department Analytics (Cache-First):**
```javascript
[
  { $match: { department: department } },
  { $group: { _id: "$department", totalCount: { $sum: 1 }, averageGrade: { $avg: "$grade" } } }
]
```
Optimization: `$match` as the first stage reduces the document set before grouping. This pipeline benefits from Redis caching — on cache hit, the aggregation is skipped entirely.

**Pipeline 2 — Semester Trends:**
```javascript
[
  { $group: { _id: "$semester", totalCount: { $sum: 1 }, averageGrade: { $avg: "$grade" } } },
  { $sort: { _id: 1 } }
]
```

**Pipeline 3 — Grade Distribution:**
```javascript
[
  { $group: { _id: "$grade", count: { $sum: 1 } } },
  { $sort: { _id: 1 } }
]
```

**Pipeline 4 — Department-Semester Trends:**
```javascript
[
  {
    $group: {
      _id: { department: "$department", semester: "$semester" },
      averageGrade: { $avg: "$grade" },
      totalCount: { $sum: 1 }
    }
  },
  { $sort: { "_id.semester": 1, "_id.department": 1 } }
]
```

### 4.6. Cursor-Based Pagination Algorithm

For paginated list queries (`getGrades`, `searchStudentById`), the system uses keyset pagination (cursor-based) rather than offset-based pagination.

```javascript
const query = {};
if (nextCursor) {
  query._id = { $lt: new ObjectId(nextCursor) };
}
// ... additional filters ...

const records = await db.collection('grades')
  .find(query)
  .sort({ _id: -1 })
  .limit(limit + 1)
  .toArray();

const hasMore = records.length > limit;
if (hasMore) records.pop();

const nextCursorStr = hasMore ? records[records.length - 1]._id.toString() : null;
```

#### Why Cursor-Based Over Offset-Based

| Aspect | Cursor-Based (`_id: { $lt }`) | Offset-Based (`skip/limit`) |
|--------|-------------------------------|------------------------------|
| **Performance** | O(log n) per page — uses `_id` index | O(n) — must skip documents, becomes slower with depth |
| **Stability** | Stable — new documents don't shift results | Unstable — documents inserted at the start shift offsets |
| **Shard Support** | Works naturally with sharded clusters | Scatter-gather — must sort merged results on `mongos` |
| **Memory** | Minimal — indexed comparison | High — must materialize skipped documents |

---

## 5. Caching Strategy (Redis)

### 5.1. Redis Integration Overview

Redis 7 is deployed as a distributed caching layer running in a Docker container (`redis-cache:6379`). It serves as a soft dependency — the server initializes the connection at startup but continues in database-only fallback mode if Redis is unavailable.

```javascript
let redisClient = null;
try {
  const clientInstance = createClient({ url: 'redis://localhost:6379' });
  clientInstance.on('error', (err) => console.log('⚠️ Redis Client Error:', err.message));
  await clientInstance.connect();
  redisClient = clientInstance;
} catch (redisError) {
  console.log('❌ Redis connection failed. Running in database-only fallback mode.');
}
```

The `redisClient` is injected into every resolver via Apollo's context as `context.redis`. All resolvers guard Redis usage with `if (redis)` checks before any cache operation.

### 5.2. Cache-Aside Pattern (Lazy Loading)

The primary cache implementation is in the `getDepartmentAnalytics` resolver. It follows the cache-aside (lazy loading) pattern:

```
Request for Department Analytics
         │
         ▼
   ┌─────────────────┐
   │  Check Redis     │
   │  GET analytics:  │
   │  dept:<dept>     │
   └────────┬────────┘
            │
     ┌──────┴──────┐
     ▼              ▼
   HIT             MISS
     │              │
     │              ▼
     │         ┌─────────────────┐
     │         │  Query MongoDB   │
     │         │  Aggregation     │
     │         │  Pipeline        │
     │         └────────┬────────┘
     │                  │
     │                  ▼
     │         ┌─────────────────┐
     │         │  Store in Redis │
     │         │  SETEX 60s      │
     │         └────────┬────────┘
     │                  │
     └──────┬───────────┘
            ▼
   Return data with timing
```

#### Implementation

```javascript
if (redis) {
  const cachedData = await redis.get(cacheKey);
  if (cachedData) {
    return { ...cacheResult, timing: { cacheHit: true, totalTimeMs: ... } };
  }
}

const result = await db.collection('grades').aggregate(pipeline).toArray();

if (redis) {
  await redis.setEx(cacheKey, 60, JSON.stringify(responseData));
}
```

#### Cache Key Format

```
analytics:dept:<department>
```

Examples:
- `analytics:dept:computer_science`
- `analytics:dept:electrical_eng`
- `analytics:dept:data_science`

### 5.3. Cache Invalidation (Write-Invalidate)

Both mutations evict the affected department's cache key immediately after the MongoDB write:

```javascript
if (redis) {
  const cacheKey = `analytics:dept:${department.toLowerCase().replace(/ /g, '_')}`;
  await redis.del(cacheKey);
}
```

#### Cache Invalidation Policy

| Event | Action | Freshness After |
|-------|--------|-----------------|
| Dashboard load (overview tab) | Populate cache with fresh aggregation data | 60 seconds |
| Grade update mutation | Evict specific department cache | Next request re-populates |
| Grade insert mutation | Evict specific department cache | Next request re-populates |
| Cache TTL expiration | Automatic Redis eviction | Next request re-populates |
| Redis server restart | All keys lost | First request per department re-populates |

### 5.4. Performance Impact

| Scenario | Without Cache | With Cache (HIT) | With Cache (MISS) |
|----------|---------------|-------------------|-------------------|
| Single department analytics | ~50-150ms (aggregation across shards) | ~1-3ms (Redis GET) | ~50-150ms + 1ms SET |
| Dashboard load (6 departments) | ~300-900ms (6 sequential aggregations) | ~6-18ms (6 Redis GETs) | Only first load slow; subsequent loads are cache hits |
| 10 concurrent dashboard refreshes | ~3-9s total server load | ~10-30ms (all cache hits after first) | Only first batch triggers aggregation |

### 5.5. Graceful Degradation (Fallback Mode)

If Redis is unavailable, the system degrades gracefully:

```javascript
try {
  // ... cache-aside logic ...
} catch (error) {
  console.error('Redis Cache Error encountered:', error);
  const result = await db.collection('grades').aggregate(pipeline).toArray();
  return { ...responseData, timing: { cacheHit: false, ... } };
}
```

**What happens during Redis outage:**
- All analytics queries continue to work
- Every request hits MongoDB directly
- `cacheHit` is always `false`
- `totalTimeMs` reflects full DB query time
- No data is lost — only performance degrades
- When Redis recovers, the next mutation eviction will re-enable caching

---

## 6. Real-Time Data Processing (Apache Kafka)

### 6.1. Kafka Integration Overview

Apache Kafka 7.3 is deployed alongside ZooKeeper 7.3 as the event streaming backbone. It uses a single topic `grade-mutations` to propagate grade change events from mutations to the SSE broadcast layer.

```yaml
zookeeper:
  image: confluentinc/cp-zookeeper:7.3.0
  environment:
    ZOOKEEPER_CLIENT_PORT: 2181

kafka:
  image: confluentinc/cp-kafka:7.3.0
  depends_on: [zookeeper]
  environment:
    KAFKA_ZOOKEEPER_CONNECT: 'zookeeper:2181'
    KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092,PLAINTEXT_INTERNAL://kafka:29092
```

### 6.2. Topic Design

| Property | Value |
|----------|-------|
| Topic Name | `grade-mutations` |
| Partitions | Default (1 partition in single-broker setup) |
| Replication Factor | 1 (single broker) |
| Message Key | `data.department` (e.g., `"Computer Science"`) |
| Message Value | JSON: `{ eventType, timestamp, payload }` |

#### Message Format

```json
{
  "eventType": "GRADE_UPDATED",
  "timestamp": "2026-06-04T12:00:00.000Z",
  "payload": {
    "_id": "665a1b2c3d4e5f6a7b8c9d0e",
    "student_id": "STU584291",
    "student_name": "Jane Smith",
    "department": "Computer Science",
    "course_code": "CS301",
    "semester": "Fall 2024",
    "grade": 2.0,
    "credits": 3,
    "updated_at": "2026-06-04T12:00:00.000Z",
    "id": "665a1b2c3d4e5f6a7b8c9d0e"
  }
}
```

### 6.3. Producer — Fire-and-Forget Event Emission

Produced from both mutations via the shared `streamLogEvent` function. It follows a fire-and-forget pattern.

```javascript
async function streamLogEvent(topic, eventType, data) {
  try {
    await producer.send({
      topic,
      messages: [{
        key: data.department || 'general',
        value: JSON.stringify({
          eventType,
          timestamp: new Date().toISOString(),
          payload: data,
        }),
      }],
    });
  } catch (err) {
    console.error('⚠️ Failed to broadcast event message over Kafka stream:', err.message);
  }
}
```

#### Event Types Published

| Mutation | Event Type | When |
|----------|------------|------|
| `updateStudentGrade` | `GRADE_UPDATED` | After successful MongoDB update and Redis eviction |
| `addGradeRecord` | `GRADE_ADDED` | After successful MongoDB insert and Redis eviction |

### 6.4. Consumer — Event-Driven SSE Bridge

```javascript
async function startConsumer() {
  await consumer.connect();
  await consumer.subscribe({ topic: 'grade-mutations', fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const parsed = JSON.parse(message.value.toString());
      if (onEventCallback) onEventCallback(parsed);
    },
  });
}
```

#### Consumer Configuration

| Property | Value |
|----------|-------|
| Group ID | `academic-analytics-group` |
| Auto Offset Reset | `latest` (only new messages from join time) |
| Partition Assignment | Range assignor (default) |

### 6.5. Kafka-to-SSE Bridge

```javascript
onGradeEvent((event) => {
  addEvent(event.eventType, event.payload);
});
```

#### Complete Event Flow

```
Mutation → MongoDB Write → Redis Cache Eviction
                                  │
                                  ▼
                          Kafka Producer
                          (streamLogEvent)
                                  │
                                  ▼
                          Kafka Topic
                          (grade-mutations)
                                  │
                                  ▼
                          Kafka Consumer
                          (academic-analytics-group)
                                  │
                                  ▼
                          onGradeEvent Callback
                                  │
                                  ▼
                          stream.js addEvent()
                                  │
                          ┌───────┴───────┐
                          │               │
                          ▼               ▼
                    Event Buffer     SSE Broadcast
                    (100 entries)    (all clients)
```

### 6.6. SSE Server Implementation

```javascript
const eventBuffer = [];
const clients = new Map();

function addEvent(eventType, data) {
  const entry = { eventType, data, timestamp: new Date().toISOString() };
  eventBuffer.unshift(entry);
  if (eventBuffer.length > MAX_EVENTS) eventBuffer.pop();

  const payload = `data: ${JSON.stringify(entry)}\n\n`;
  for (const [id, res] of clients) {
    try { res.write(payload); } catch { clients.delete(id); }
  }
}

function sseHandler(req, res) {
  res.writeHead(200, SSE_HEADERS);
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  for (const event of eventBuffer.slice(0, 10).reverse()) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  const id = ++clientId;
  clients.set(id, res);
  req.on('close', () => clients.delete(id));
}
```

#### SSE Stream Properties

| Property | Value |
|----------|-------|
| URL | `http://localhost:4001/stream` |
| Buffer Size | 100 events (circular — newest pushed to front, oldest popped from back) |
| Replay on Connect | Last 10 events (in chronological order) |
| Cleanup | Failed `res.write()` calls remove disconnected clients |
| Headers | `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive` |

#### Client-Side Consumption

```javascript
const evtSource = new EventSource('http://localhost:4001/stream');
evtSource.onopen = () => setStreamConnected(true);
evtSource.onmessage = (e) => {
  const data = JSON.parse(e.data);
  if (data.type === 'connected') return;
  setStreamLog(prev => {
    const next = [{ time: ..., msg: `${data.eventType} — ${data.data?.student_id} ${data.data?.course_code}` }, ...prev];
    return next.slice(0, 50);
  });
};
```

### 6.7. Fault Tolerance Mechanisms

| Mechanism | Location | Description |
|-----------|----------|-------------|
| **Kafka Connection Error Isolation** | `kafka.js:17-24, 26-45` | Producer and consumer connection failures are caught and logged independently. A failed Kafka connection does not crash the server — the GraphQL API continues to function without event streaming. |
| **Message Parsing Guard** | `kafka.js:32-38` | Each Kafka message's JSON is parsed in a try/catch. Malformed or corrupt messages are logged and skipped without terminating the consumer. |
| **SSE Write Failure Cleanup** | `stream.js:19` | When broadcasting to clients, failed `res.write()` calls silently remove the client ID from the Map, preventing memory leaks from stale connections. |
| **Client-Side EventSource Management** | `UserDashboard.jsx:213-218` | SSE connection is properly closed (`evtSource.close()`) on tab switch or component unmount to prevent resource leaks. |

---

## 7. Sample Reports and Outputs

### 7.1. Dashboard Overview

The landing dashboard displays six KPI cards (one per department) showing average grade, record count, and query timing. Below are four interactive charts.

#### KPI Cards (Department Analytics)

```
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│ Computer Science    │  │ Data Science        │  │ Electrical Eng      │
│ 2.15                │  │ 2.08                │  │ 2.22                │
│ 58,342 records      │  │ 58,120 records      │  │ 58,891 records      │
│ 1.23ms (Cached)     │  │ 89.45ms (DB Query)  │  │ 1.10ms (Cached)     │
└─────────────────────┘  └─────────────────────┘  └─────────────────────┘
```

#### Charts
- **Bar Chart** — Average Grade by Department (6 bars)
- **Area Chart** — Grade Trend by Semester (4 semesters)
- **Bar Chart** — Grade Distribution (histogram of 10 grade values)
- **Pie/Donut Chart** — Records per Department (6 segments)
- **Multi-Line Chart** — Department Grade Trends by Semester (6 lines, 4 semesters)

### 7.2. Student Course Records (Subject Analytics Tab)

A paginated, sortable, filterable table showing all grade records.

| Student ID | Student Name | Department / Course | Semester | Grade |
|------------|-------------|-------------------|----------|-------|
| STU123456 | John Doe | Computer Science (CS301) | Fall 2024 | 1.75 |
| STU789012 | Jane Smith | Data Science (DS201) | Spring 2025 | 2.50 |

**Filters:** Student ID (text), Student Name (text), Department (dropdown), Semester (dropdown)

**Sorting:** Click any column header to toggle ascending/descending sort.

**Pagination:** Cursor-based navigation with Previous/Next buttons and current page indicator.

### 7.3. Student Reports (Student Reports Tab)

A progressive search interface for looking up a student's complete academic record by student ID.

```
Found 4 course records for student STU123456

Student       │ Department/Course │ Semester      │ Grade │ Credits │ Update
──────────────┼───────────────────┼───────────────┼───────┼─────────┼──────
STU123456     │ Computer Science  │ Fall 2024     │ 1.75  │ 3       │ [New]│[Set]
John Doe      │ CS301             │               │       │         │
──────────────┼───────────────────┼───────────────┼───────┼─────────┼──────
STU123456     │ Mathematics       │ Spring 2025   │ 2.50  │ 4       │ [New]│[Set]
John Doe      │ MATH201           │               │       │         │
```

Each row includes an inline grade editor with a number input and "Set" button. After a grade update, the row shows a green "Updated!" confirmation toast.

### 7.4. At-Risk Student List (At-Risk & Trends Tab)

Identifies students with grades of 3.0 or 5.0 — values considered "at-risk" in the Philippine academic grading system.

```
At-Risk Students: 45,230                              Semester: [All ▼]

ID          │ Student Name     │ Department        │ Course │ Semester  │ G
────────────┼──────────────────┼───────────────────┼────────┼──────────────
STU584291   │ Jane Smith       │ Computer Science  │ CS101  │ Fall 2024 │5.0
STU123456   │ John Doe         │ Physics           │ PHYS101│ Fall 2025 │3.0
STU789012   │ Alice Johnson    │ Mechanical Eng    │ ME301  │ Spring    │5.0
            │                  │                    │        │ 2026     │

                                  Page 1 of 45    ← Previous  Next →
```

### 7.5. Real-Time Grade Update Stream (Streams Tab)

A live feed of grade mutation events consumed from Kafka and broadcast via SSE.

```
═════════════════════════════════════════════════════════════════════
  Event Streams — Real-time grade mutation events broadcast over
  Apache Kafka.                                          ● Connected
═════════════════════════════════════════════════════════════════════

  [12:00:05] GRADE_UPDATED — STU584291 CS301
  [12:00:03] GRADE_UPDATED — STU123456 MATH201
  [11:59:48] GRADE_ADDED — STU789012 DS101
  [11:59:30] GRADE_UPDATED — STU456789 EE401
  [11:59:15] GRADE_UPDATED — STU654321 PHYS201
```

Connected/disconnected status indicator (green/red dot). The feed caps at 50 entries client-side and displays timestamps in local time format.

### 7.6. Interactive Dashboard Summary

| Tab | Primary Function | Key Visual Elements |
|-----|-----------------|---------------------|
| Dashboard Overview | High-level analytics across all departments | 6 KPI cards, Bar chart, Area chart, Pie chart, Multi-line chart |
| Student Course Analytics | Filtered, paginated grade record browsing | Sortable table, 4 filter controls, cursor-based pagination |
| Student Reports | Progressive student ID search with inline editing | Search input with live results, inline grade editor, update toast |
| At-Risk & Trends | Flagged student identification | KPI counter, semester filter, paginated table with grade highlighting |
| Streams | Real-time event monitoring | SSE connection indicator, auto-updating event log |

---

## 8. Source Code with Explanation

### 8.1. Project Structure

```
YAWA-FINAL-WORKING/
├── client/
│   └── yawa/                          # React 19 + Vite 8 frontend
│       └── src/
│           ├── App.jsx                # Root component with splash/landing/dashboard
│           ├── App.css                # Dashboard styling
│           ├── index.css              # Global styles + theme variables
│           ├── main.jsx               # ReactDOM entry point
│           └── components/
│               └── UserDashboard.jsx  # Main dashboard (787 lines)
├── server/
│   ├── server.js                      # Express REST fallback (port 5000)
│   └── src/
│       ├── index.js                   # Apollo Server bootstrap + SSE server
│       ├── kafka.js                   # Kafka producer/consumer client
│       ├── stream.js                  # SSE event buffer + handler
│       ├── graphql/
│       │   ├── typeDefs/
│       │   │   └── gradeDefs.js       # GraphQL schema (8 queries, 2 mutations)
│       │   └── resolvers/
│       │       └── gradeResolvers.js   # All resolver implementations (339 lines)
│       └── scripts/
│           ├── seed.js                # 350K record data seeder
│           └── live-simulator.js      # 70/30 update/insert mutation simulator
├── docker-compose.yml                 # MongoDB cluster, Redis, Kafka, Zookeeper
├── config-init.js                     # MongoDB config replica set initialization
├── package.json                       # Shared root dependencies
└── architecture.drawio                # System architecture diagram
```

### 8.2. Key Source Files Explanation

#### `server/src/index.js` — Server Bootstrap (61 lines)

The entry point that initializes all infrastructure and starts both Apollo Server and the SSE server.

```javascript
// Connect to MongoDB and Redis
const client = new MongoClient(MONGO_URI);
await client.connect();
const db = client.db(DB_NAME);

// Redis with graceful fallback
let redisClient = null;
try {
  const clientInstance = createClient({ url: 'redis://localhost:6379' });
  await clientInstance.connect();
  redisClient = clientInstance;
} catch { /* DB-only fallback */ }

// Initialize Kafka bridge
await connectKafka();
await startConsumer();
onGradeEvent((event) => {
  addEvent(event.eventType, event.payload);
});

// Start Apollo Server with context injection
const server = new ApolloServer({ typeDefs, resolvers });
const { url } = await startStandaloneServer(server, {
  listen: { port: 4000 },
  context: async () => ({ db, redis: redisClient }),
});

// Start SSE stream server on port 4001
const sseApp = express();
sseApp.get('/stream', sseHandler);
sseApp.listen(4001);
```

#### `server/src/kafka.js` — Kafka Client (68 lines)

Wraps all Kafka operations in a single module.

| Function | Purpose |
|----------|---------|
| `connectKafka()` | Initializes producer connection to broker |
| `startConsumer()` | Subscribes to `grade-mutations` topic and registers a message handler that invokes `onEventCallback` |
| `streamLogEvent(topic, eventType, data)` | Fire-and-forget producer that sends a JSON message with `department` as partition key |
| `onGradeEvent(callback)` | Registers the callback used to bridge Kafka to SSE |

#### `server/src/stream.js` — SSE Event Stream (40 lines)

Manages the Server-Sent Events buffer and client connections.

| Component | Description |
|-----------|-------------|
| `eventBuffer` | Array capped at 100 entries (newest first via `unshift`) |
| `clients` | Map of connected SSE response objects |
| `addEvent(eventType, data)` | Appends to buffer and broadcasts to all clients |
| `sseHandler(req, res)` | Handles new SSE connections, sends `connected` event, replays last 10 buffered events |

#### `server/src/graphql/typeDefs/gradeDefs.js` — GraphQL Schema (91 lines)

Defines the complete GraphQL schema:
- 9 types: `GradeRecord`, `ShardStats`, `TimingDetails`, `QueryTiming`, `GradeResponse`, `SemesterStats`, `GradeDistribution`, `DepartmentTrend`, `AddGradeInput`
- 8 queries and 2 mutations

#### `server/src/graphql/resolvers/gradeResolvers.js` — Resolvers (339 lines)

The core business logic implementing all 10 resolvers.

| Resolver | Lines | Key Pattern |
|----------|-------|-------------|
| `getGrades` | 8-56 | Cursor-based pagination with dynamic filters |
| `getDepartmentAnalytics` | 59-152 | Cache-aside pattern with Redis + MongoDB fallback |
| `getStudentGrades` | 155-160 | Direct shard key point query |
| `searchStudentById` | 163-193 | Prefix regex with cursor-based pagination |
| `getSemesterAnalytics` | 196-213 | Aggregation pipeline grouped by semester |
| `getAtRiskCount` | 216-222 | Count with grade filter |
| `getGradeDistribution` | 225-232 | Aggregation pipeline grouped by grade |
| `getDepartmentSemesterTrends` | 235-253 | Aggregation by composite key |
| `updateStudentGrade` | 260-298 | Write-through: MongoDB → Redis → Kafka |
| `addGradeRecord` | 300-335 | Duplicate guard → MongoDB insert → Redis → Kafka |

#### `server/src/scripts/seed.js` — Data Seeder (81 lines)

Generates 350,000 realistic grade records in batches of 10,000 using unordered `bulkWrite`. Uses `@faker-js/faker` for realistic student names and random data distribution.

#### `server/src/scripts/live-simulator.js` — Mutation Simulator (95 lines)

A perpetual loop that generates random grade mutations every 15-20 seconds. 70% probability of `doUpdate()` (modifies an existing record's grade) and 30% probability of `doInsert()` (adds a new course for an existing student).

#### `client/yawa/src/components/UserDashboard.jsx` — Dashboard UI (787 lines)

The single largest file in the codebase, containing:
- **State management**: 20+ `useState` hooks, 6 `useRef` hooks, 3 pagination state machines
- **Data fetching**: Custom `gql()` helper wrapping `fetch()`, 4 `useCallback` data fetchers
- **5 render functions**: `renderOverview`, `renderSubjectAnalytics`, `renderStudentReports`, `renderAtRisk`, `renderStreams`
- **Client-side features**: Multi-column sort, race condition guard (version ref), SSE consumer, dark mode toggle, inline grade editing

#### `client/yawa/src/App.jsx` — Root Component (55 lines)

Entry component with splash screen animation and landing page. Handles theme initialization from `localStorage`.

### 8.3. Key Code Patterns

#### Cursor-Based Pagination (Server)

```javascript
const records = await db.collection('grades')
  .find(query)
  .sort({ _id: -1 })
  .limit(limit + 1)
  .toArray();

const hasMore = records.length > limit;
if (hasMore) records.pop();
```

#### Client-Side Progressive Search with Race Condition Guard

```javascript
const filterVersionRef = useRef(0);

const fetchGrades = useCallback(async (cursor, ...) => {
  const version = ++filterVersionRef.current;
  // ... async fetch ...
  if (version !== filterVersionRef.current) return; // Stale response discarded
  setStudents(data.getGrades.records);
}, []);
```

#### Write-Through Mutation Pattern

```javascript
// 1. MongoDB write
const result = await db.collection('grades').findOneAndUpdate(filter, update, options);
// 2. Redis cache eviction
if (redis) { await redis.del(cacheKey); }
// 3. Kafka event publish
await streamLogEvent('grade-mutations', 'GRADE_UPDATED', cleanRecord);
```
