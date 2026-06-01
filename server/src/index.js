const { ApolloServer } = require('@apollo/server');
const { startStandaloneServer } = require('@apollo/server/standalone');
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const { createClient } = require('redis');
const { connectKafka, startConsumer, onGradeEvent } = require('./kafka');
const { addEvent, sseHandler } = require('./stream');

const typeDefs = require('./graphql/typeDefs/gradeDefs');
const resolvers = require('./graphql/resolvers/gradeResolvers');

const MONGO_URI = 'mongodb://localhost:27016';
const DB_NAME = 'academic_analytics';

async function startServer() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  console.log('🚀 Connected to Sharded MongoDB Cluster Router...');
  const db = client.db(DB_NAME);

  let redisClient = null;
  try {
    const clientInstance = createClient({ url: 'redis://localhost:6379' });
    clientInstance.on('error', (err) => console.log('⚠️ Redis Client Error:', err.message));
    await clientInstance.connect();
    console.log('⚡ Connected to Distributed Redis Cache Engine...');
    redisClient = clientInstance;
  } catch (redisError) {
    console.log('❌ Redis connection failed. Running in database-only fallback mode.');
  }

  await connectKafka();
  await startConsumer();

  onGradeEvent((event) => {
    addEvent(event.eventType, event.payload);
  });

  const server = new ApolloServer({
    typeDefs,
    resolvers,
  });

  const { url } = await startStandaloneServer(server, {
    listen: { port: 4000 },
    context: async () => ({ db, redis: redisClient }),
  });
  console.log(`📊 GraphQL Engine ready at: ${url}`);

  const sseApp = express();
  sseApp.use(cors());
  sseApp.get('/stream', sseHandler);
  sseApp.listen(4001, () => {
    console.log(`📡 SSE Stream ready at: http://localhost:4001/stream`);
  });
}

startServer().catch(err => {
  console.error('Failed to launch GraphQL backend engine:', err);
});
