const { Kafka, Partitioners } = require('kafkajs');

const kafka = new Kafka({
  clientId: 'academic-analytics-server',
  brokers: ['localhost:9092'],
});

const producer = kafka.producer({ createPartitioner: Partitioners.LegacyPartitioner });
const consumer = kafka.consumer({ groupId: 'academic-analytics-group' });

let onEventCallback = null;

function onGradeEvent(callback) {
  onEventCallback = callback;
}

async function connectKafka() {
  try {
    await producer.connect();
    console.log('🚀 Connected to Real-Time Apache Kafka Broker...');
  } catch (error) {
    console.error('❌ Failed to establish link to Apache Kafka:', error);
  }
}

async function startConsumer() {
  try {
    await consumer.connect();
    await consumer.subscribe({ topic: 'grade-mutations', fromBeginning: false });
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const parsed = JSON.parse(message.value.toString());
          console.log(`📥 Kafka Consumed -> Topic: [${topic}] | Type: [${parsed.eventType}]`);
          if (onEventCallback) onEventCallback(parsed);
        } catch (err) {
          console.error('⚠️ Failed to parse Kafka message:', err.message);
        }
      },
    });
    console.log('👂 Listening for grade-mutation events from Kafka...');
  } catch (error) {
    console.error('❌ Failed to start Kafka consumer:', error.message);
  }
}

async function streamLogEvent(topic, eventType, data) {
  try {
    await producer.send({
      topic,
      messages: [
        {
          key: data.department || 'general',
          value: JSON.stringify({
            eventType,
            timestamp: new Date().toISOString(),
            payload: data,
          }),
        },
      ],
    });
    console.log(`📡 Kafka Event Streamed -> Topic: [${topic}] | Type: [${eventType}]`);
  } catch (err) {
    console.error('⚠️ Failed to broadcast event message over Kafka stream:', err.message);
  }
}

module.exports = { connectKafka, startConsumer, streamLogEvent, onGradeEvent };
