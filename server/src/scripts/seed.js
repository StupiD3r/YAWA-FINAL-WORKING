const { MongoClient } = require('mongodb');
const { faker } = require('@faker-js/faker');

const URL = 'mongodb://localhost:27016'; // Points straight to your running Docker Mongos Router
const DB_NAME = 'academic_analytics';
const COLLECTION_NAME = 'grades';

const TOTAL_RECORDS = 350000;
const BATCH_SIZE = 10000;
const NUM_STUDENTS = 5000; // Unique students; each gets multiple records with a consistent name

const DEPARTMENTS = ['Computer Science', 'Data Science', 'Electrical Eng', 'Mechanical Eng', 'Mathematics', 'Physics'];
const SEMESTERS = ['Fall 2024', 'Spring 2025', 'Fall 2025', 'Spring 2026'];
const ALLOWED_GRADES = [1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 5.0];
const COURSES = {
  'Computer Science': ['CS101', 'CS201', 'CS301', 'CS401'],
  'Data Science': ['DS101', 'DS201', 'DS301', 'DS401'],
  'Electrical Eng': ['EE101', 'EE201', 'EE301', 'EE401'],
  'Mechanical Eng': ['ME101', 'ME201', 'ME301', 'ME401'],
  'Mathematics': ['MATH101', 'MATH201', 'MATH301', 'MATH401'],
  'Physics': ['PHYS101', 'PHYS201', 'PHYS301', 'PHYS401']
};

async function seedDatabase() {
  const client = new MongoClient(URL);
  try {
    await client.connect();
    console.log('Successfully connected to Mongos Router...');
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    // Pre-generate a pool of unique students with fixed names
    const students = Array.from({ length: NUM_STUDENTS }, () => ({
      student_id: `STU${faker.number.int({ min: 100000, max: 999999 })}`,
      student_name: faker.person.fullName(),
    }));

    let insertedCount = 0;
    const startTime = Date.now();

    while (insertedCount < TOTAL_RECORDS) {
      const operations = [];
      const currentBatchSize = Math.min(BATCH_SIZE, TOTAL_RECORDS - insertedCount);

      for (let i = 0; i < currentBatchSize; i++) {
        const { student_id, student_name } = students[Math.floor(Math.random() * students.length)];
        const dept = DEPARTMENTS[Math.floor(Math.random() * DEPARTMENTS.length)];
        const courseList = COURSES[dept];
        const course = courseList[Math.floor(Math.random() * courseList.length)];

        const gradeDocument = {
          student_id,
          student_name,
          department: dept,
          course_code: course,
          semester: SEMESTERS[Math.floor(Math.random() * SEMESTERS.length)],
          grade: faker.helpers.arrayElement(ALLOWED_GRADES),
          credits: faker.helpers.arrayElement([3, 4]),
          updated_at: new Date()
        };

        operations.push({ insertOne: { document: gradeDocument } });
      }

      await collection.bulkWrite(operations, { ordered: false });

      insertedCount += currentBatchSize;
      const progress = ((insertedCount / TOTAL_RECORDS) * 100).toFixed(2);
      console.log(`Progress: ${progress}% | Total Processed: ${insertedCount} docs`);
    }

    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n🎉 Seeding complete! Successfully added ${TOTAL_RECORDS} records in ${elapsedSeconds} seconds.`);
  } catch (error) {
    console.error('Seeding process failed:', error);
  } finally {
    await client.close();
  }
}

seedDatabase();