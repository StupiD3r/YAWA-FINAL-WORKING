// server/src/graphql/resolvers/gradeResolvers.js
const { ObjectId } = require('mongodb');
const { streamLogEvent } = require('../../kafka');

const resolvers = {
  Query: {
    // 1. Paginated retrieval to cleanly handle large datasets safely
    getGrades: async (_, { limit = 20, nextCursor, semester, studentId, studentName, department }, { db }) => {
      const startTime = performance.now();
      const query = {};
      if (nextCursor) {
        try {
          query._id = { $lt: new ObjectId(nextCursor) };
        } catch {
          throw new Error('Invalid cursor format provided for pagination.');
        }
      }
      if (semester) {
        query.semester = semester;
      }
      if (studentId) {
        query.student_id = { $regex: `^${studentId}`, $options: 'i' };
      }
      if (studentName) {
        query.student_name = { $regex: studentName, $options: 'i' };
      }
      if (department) {
        query.department = department;
      }

      // Sort by descending ObjectId for predictable scrolling pagination
      const records = await db.collection('grades')
        .find(query)
        .sort({ _id: -1 })
        .limit(limit + 1)
        .toArray();

      const hasMore = records.length > limit;
      if (hasMore) records.pop(); // Remove extra record used for evaluation

      const nextCursorStr = hasMore ? records[records.length - 1]._id.toString() : null;
      const endTime = performance.now();
      const executionTime = (endTime - startTime).toFixed(2);

      return {
        records: records.map(r => ({ ...r, id: r._id.toString() })),
        nextCursor: nextCursorStr,
        hasMore,
        timing: {
          textField: "Total Time in Milliseconds",
          totalTimeMs: parseFloat(executionTime), 
          dbQueryTimeMs: parseFloat(executionTime),
          cacheHit: false
        }
      };
    },

    // 2. High-performance Cached & Targeted Shard Analytics Query
    getDepartmentAnalytics: async (_, { department }, { db, redis }) => {
      const startTime = performance.now();
      const cacheKey = `analytics:dept:${department.toLowerCase().replace(/ /g, '_')}`;

      try {
        // Step A: Check Redis Cache First
        if (redis) {
          const cachedData = await redis.get(cacheKey);
          if (cachedData) {
            console.log(`🎯 Cache HIT for key: ${cacheKey}`);
            const cacheResult = JSON.parse(cachedData);
            const endTime = performance.now();
            return {
              ...cacheResult,
              timing: {
                totalTimeMs: (endTime - startTime).toFixed(2),
                dbQueryTimeMs: 0,
                cacheHit: true
              }
            };
          }
        }

        console.log(`❌ Cache MISS for key: ${cacheKey}. Querying MongoDB Shards...`);

        // Step B: Fetch from MongoDB Shards on a Cache Miss
        const queryStartTime = performance.now();
        const pipeline = [
          { $match: { department: department } },
          {
            $group: {
              _id: "$department",
              totalCount: { $sum: 1 },
              averageGrade: { $avg: "$grade" }
            }
          }
        ];

        const result = await db.collection('grades').aggregate(pipeline).toArray();
        const queryEndTime = performance.now();
        
        let responseData = { totalCount: 0, averageGrade: 0.0 };
        if (result.length > 0) {
          responseData = {
            totalCount: result[0].totalCount,
            averageGrade: Math.round(result[0].averageGrade * 100) / 100
          };
        }

        // Step C: Save the result to Redis with an automatic 60-second expiration (TTL)
        if (redis) {
          await redis.setEx(cacheKey, 60, JSON.stringify(responseData));
        }

        const endTime = performance.now();
        return {
          ...responseData,
          timing: {
            totalTimeMs: (endTime - startTime).toFixed(2),
            dbQueryTimeMs: (queryEndTime - queryStartTime).toFixed(2),
            cacheHit: false
          }
        };
      } catch (error) {
        console.error('Redis Cache Error encountered:', error);
        
        const queryStartTime = performance.now();
        const pipeline = [{ $match: { department } }, { $group: { _id: "$department", totalCount: { $sum: 1 }, averageGrade: { $avg: "$grade" } } }];
        const result = await db.collection('grades').aggregate(pipeline).toArray();
        const queryEndTime = performance.now();
        const endTime = performance.now();
        
        if (result.length === 0) {
          return {
            totalCount: 0,
            averageGrade: 0.0,
            timing: {
              totalTimeMs: (endTime - startTime).toFixed(2),
              dbQueryTimeMs: (queryEndTime - queryStartTime).toFixed(2),
              cacheHit: false
            }
          };
        }
        return {
          totalCount: result[0].totalCount,
          averageGrade: Math.round(result[0].averageGrade * 100) / 100,
          timing: {
            totalTimeMs: (endTime - startTime).toFixed(2),
            dbQueryTimeMs: (queryEndTime - queryStartTime).toFixed(2),
            cacheHit: false
          }
        };
      }
    },

    // 3. Direct Student Point Query matching full compound Shard Key
    getStudentGrades: async (_, { student_id, department }, { db }) => {
      const records = await db.collection('grades')
        .find({ department, student_id })
        .toArray();
      return records.map(r => ({ ...r, id: r._id.toString() }));
    },

    // 4. Search by student ID prefix across all departments (progressive filtering)
    searchStudentById: async (_, { student_id, limit = 100, nextCursor }, { db }) => {
      const startTime = performance.now();
      const query = { student_id: { $regex: `^${student_id}`, $options: 'i' } };
      if (nextCursor) {
        try {
          query._id = { $lt: new ObjectId(nextCursor) };
        } catch {
          throw new Error('Invalid cursor format provided for pagination.');
        }
      }
      const records = await db.collection('grades')
        .find(query)
        .sort({ _id: -1 })
        .limit(limit + 1)
        .toArray();
      const hasMore = records.length > limit;
      if (hasMore) records.pop();
      const nextCursorStr = hasMore ? records[records.length - 1]._id.toString() : null;
      const endTime = performance.now();
      return {
        records: records.map(r => ({ ...r, id: r._id.toString() })),
        nextCursor: nextCursorStr,
        hasMore,
        timing: {
          textField: "Total Time in Milliseconds",
          totalTimeMs: parseFloat((endTime - startTime).toFixed(2)),
          dbQueryTimeMs: parseFloat((endTime - startTime).toFixed(2)),
          cacheHit: false
        }
      };
    },

    // 5. Semester-level analytics for trend visualization
    getSemesterAnalytics: async (_, __, { db }) => {
      const pipeline = [
        {
          $group: {
            _id: "$semester",
            totalCount: { $sum: 1 },
            averageGrade: { $avg: "$grade" }
          }
        },
        { $sort: { _id: 1 } }
      ];
      const results = await db.collection('grades').aggregate(pipeline).toArray();
      return results.map(r => ({
        semester: r._id,
        totalCount: r.totalCount,
        averageGrade: Math.round(r.averageGrade * 100) / 100
      }));
    },

    // 6. Count at-risk students, optionally filtered by semester
    getAtRiskCount: async (_, { semester }, { db }) => {
      const query = { grade: { $in: [3.0, 5.0] } };
      if (semester) {
        query.semester = semester;
      }
      return await db.collection('grades').countDocuments(query);
    },

    // 7. Grade distribution histogram
    getGradeDistribution: async (_, __, { db }) => {
      const pipeline = [
        { $group: { _id: "$grade", count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ];
      const results = await db.collection('grades').aggregate(pipeline).toArray();
      return results.map(r => ({ grade: r._id, count: r.count }));
    },

    // 8. Per-department semester trends for multi-line chart
    getDepartmentSemesterTrends: async (_, __, { db }) => {
      const pipeline = [
        {
          $group: {
            _id: { department: "$department", semester: "$semester" },
            averageGrade: { $avg: "$grade" },
            totalCount: { $sum: 1 }
          }
        },
        { $sort: { "_id.semester": 1, "_id.department": 1 } }
      ];
      const results = await db.collection('grades').aggregate(pipeline).toArray();
      return results.map(r => ({
        department: r._id.department,
        semester: r._id.semester,
        averageGrade: Math.round(r.averageGrade * 100) / 100,
        totalCount: r.totalCount
      }));
    }
  },

  // ------------------------------------------------------------------
  // Added Mutation Block: Synchronized for Sharding, Cache, and Kafka
  // ------------------------------------------------------------------
  Mutation: {
    updateStudentGrade: async (_, { student_id, department, course_code, newGrade }, { db, redis }) => {
      console.log(`📝 Processing grade update request for Student: ${student_id} | Dept: ${department}`);

      // 1. Update document in MongoDB (targets specific shard via compound shard key fields)
      const result = await db.collection('grades').findOneAndUpdate(
        { student_id, department, course_code },
        { 
          $set: { 
            grade: parseFloat(newGrade),
            updated_at: new Date().toISOString()
          } 
        },
        { returnDocument: 'after' }
      );

      // Extract raw document reference across different mongodb driver iterations safely
      const updatedDocument = result.value || result;

      if (!updatedDocument) {
        throw new Error(`Grade record for course ${course_code} under Student ID ${student_id} was not found.`);
      }

      // 2. Cache Eviction: Purge the department cache key from Redis to eliminate stale reads
      if (redis) {
        const cacheKey = `analytics:dept:${department.toLowerCase().replace(/ /g, '_')}`;
        await redis.del(cacheKey);
        console.log(`🧹 Cache cleared for key: ${cacheKey} due to update mutation.`);
      }

      // 3. Event Streaming: Build structural payload and push out over Apache Kafka
      const cleanRecord = {
        ...updatedDocument,
        id: updatedDocument._id.toString()
      };
      
      await streamLogEvent('grade-mutations', 'GRADE_UPDATED', cleanRecord);

      return cleanRecord;
    }
  }
};

module.exports = resolvers;