// server/src/graphql/typeDefs/gradeDefs.js
const typeDefs = `#graphql
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

  type ShardStats {
    totalCount: Int!
    averageGrade: Float!
    timing: TimingDetails
  }

  type TimingDetails {
    totalTimeMs: Float
    dbQueryTimeMs: Float
    cacheHit: Boolean
  }

  type QueryTiming {
    textField: String
    totalTimeMs: Float
    dbQueryTimeMs: Float
    cacheHit: Boolean
  }

  type GradeResponse {
    records: [GradeRecord!]!
    nextCursor: String
    hasMore: Boolean!
    timing: QueryTiming
  }

  type SemesterStats {
    semester: String!
    totalCount: Int!
    averageGrade: Float!
  }

  type Query {
    getGrades(limit: Int, nextCursor: String, semester: String, studentId: String, studentName: String, department: String): GradeResponse!
    getDepartmentAnalytics(department: String!): ShardStats!
    getStudentGrades(student_id: String!, department: String!): [GradeRecord!]!
    searchStudentById(student_id: String!, limit: Int, nextCursor: String): GradeResponse!
    getSemesterAnalytics: [SemesterStats!]!
    getAtRiskCount(semester: String): Int!
  }

  # This is the missing piece Apollo is looking for!
  type Mutation {
    updateStudentGrade(
      student_id: String!
      department: String!
      course_code: String!
      newGrade: Float!
    ): GradeRecord!
  }
`;

module.exports = typeDefs;