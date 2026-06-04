const GRAPHQL_API = 'http://localhost:4000/graphql';

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

async function gql(query) {
  const res = await fetch(GRAPHQL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  const data = await res.json();
  if (data.errors) throw new Error(data.errors[0].message);
  return data.data;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDelay() {
  return 15000 + Math.random() * 5000;
}

async function doUpdate() {
  const data = await gql(`{ getGrades(limit: 100) { records { student_id student_name department course_code semester grade credits } } }`);
  const records = data.getGrades.records;
  if (!records.length) return;

  const rec = pickRandom(records);
  let newGrade = pickRandom(ALLOWED_GRADES);
  while (newGrade === rec.grade) {
    newGrade = pickRandom(ALLOWED_GRADES);
  }

  await gql(`mutation { updateStudentGrade(student_id: "${rec.student_id}", department: "${rec.department}", course_code: "${rec.course_code}", newGrade: ${newGrade}) { id grade } }`);
  console.log(`[UPDATE] ${rec.student_id} | ${rec.department} ${rec.course_code} | ${rec.grade} → ${newGrade}`);
}

async function doInsert() {
  const data = await gql(`{ getGrades(limit: 100) { records { student_id student_name } } }`);
  const records = data.getGrades.records;
  if (!records.length) return;

  const candidate = pickRandom(records);

  const existingData = await gql(`{ searchStudentById(student_id: "${candidate.student_id}", limit: 200) { records { course_code } } }`);
  const takenCourses = existingData.searchStudentById.records.map(r => r.course_code);

  const dept = pickRandom(DEPARTMENTS);
  const available = COURSES[dept].filter(c => !takenCourses.includes(c));
  if (!available.length) {
    console.log(`[SKIP] ${candidate.student_id} — all courses in ${dept} already taken`);
    return;
  }

  const course = pickRandom(available);
  const semester = pickRandom(SEMESTERS);
  const grade = pickRandom(ALLOWED_GRADES);
  const credits = pickRandom([3, 4]);

  await gql(`mutation { addGradeRecord(input: { student_id: "${candidate.student_id}", student_name: "${candidate.student_name}", department: "${dept}", course_code: "${course}", semester: "${semester}", grade: ${grade}, credits: ${credits} }) { id } }`);
  console.log(`[INSERT] ${candidate.student_id} | ${dept} ${course} | ${semester} | Grade: ${grade}`);
}

async function runLoop() {
  console.log('🚀 Live simulator started — mutating records every 15-20s');
  console.log('   ~70% UPDATE | ~30% INSERT');
  console.log('');

  while (true) {
    try {
      if (Math.random() < 0.7) {
        await doUpdate();
      } else {
        await doInsert();
      }
    } catch (err) {
      console.error(`[ERROR] ${err.message}`);
    }

    await new Promise(r => setTimeout(r, randomDelay()));
  }
}

runLoop();
