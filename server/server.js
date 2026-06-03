const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = 5000;
const MONGO_URI = 'mongodb://127.0.0.1:27016';
const DB_NAME = 'academic_analytics';

app.use(cors());
app.use(express.json());

let db;

async function start() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);
  console.log('🎉 Connected to academic_analytics Database via Mongos Router!');

  app.get('/api/subjects', async (req, res) => {
    try {
      const data = await db.collection('grades').find().toArray();
      res.json(data);
    } catch (error) {
      console.error('❌ Error fetching from MongoDB:', error);
      res.status(500).json({ message: 'Server Error fetching data', error: error.message });
    }
  });

  app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('❌ Failed to start server:', err);
});
