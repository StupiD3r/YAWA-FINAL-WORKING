import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';

const API = 'http://localhost:4000/graphql';

const NAV = [
  { id: 'overview', label: 'Dashboard Overview' },
  { id: 'subject_analytics', label: 'Student Course Analytics' },
  { id: 'student_reports', label: 'Student Reports' },
  { id: 'at_risk', label: 'At-Risk & Trends' },
  { id: 'streams', label: 'Streams' }
];

const DEPARTMENTS = ['Computer Science', 'Data Science', 'Electrical Eng', 'Mechanical Eng', 'Mathematics', 'Physics'];

function gql(query) {
  return fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  }).then(r => r.json()).then(j => { if (j.errors) throw new Error(j.errors[0].message); return j.data; });
}

const UserDashboard = ({ user, onLogout }) => {
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [deptStats, setDeptStats] = useState([]);
  const [semesterStats, setSemesterStats] = useState([]);
  const [students, setStudents] = useState([]);

  const [searchId, setSearchId] = useState('');
  const [reportResults, setReportResults] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [updating, setUpdating] = useState(null);
  const [gradeInputs, setGradeInputs] = useState({});

  const [atRiskStudents, setAtRiskStudents] = useState([]);
  const [streamLog, setStreamLog] = useState([]);
  const streamRef = useRef(null);

  const fetchOverview = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [deptData, semData] = await Promise.all([
        Promise.all(DEPARTMENTS.map(dept =>
          gql(`{ getDepartmentAnalytics(department: "${dept}") { totalCount averageGrade timing { totalTimeMs cacheHit } } }`)
            .then(d => ({ department: dept, ...d.getDepartmentAnalytics }))
        )),
        gql(`{ getSemesterAnalytics { semester totalCount averageGrade } }`).then(d => d.getSemesterAnalytics)
      ]);
      setDeptStats(deptData);
      setSemesterStats(semData);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, []);

  const fetchGrades = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await gql(`{ getGrades(limit: 100) { records { student_id student_name department course_code semester grade } } }`);
      setStudents(data.getGrades.records);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, []);

  const fetchAtRisk = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await gql(`{ getGrades(limit: 200) { records { student_id student_name department course_code semester grade } } }`);
      const sorted = data.getGrades.records.filter(r => r.grade < 2.0).sort((a, b) => a.grade - b.grade);
      setAtRiskStudents(sorted);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (activeTab === 'overview') fetchOverview();
    else if (activeTab === 'subject_analytics') fetchGrades();
    else if (activeTab === 'at_risk') fetchAtRisk();
    else setLoading(false);
  }, [activeTab, fetchOverview, fetchGrades, fetchAtRisk]);

  useEffect(() => {
    if (activeTab === 'streams') {
      const evtSource = new EventSource('http://localhost:4001/stream');
      evtSource.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'connected') return;
          setStreamLog(prev => {
            const next = [{ time: new Date(data.timestamp).toLocaleTimeString(), msg: `${data.eventType} — ${data.data?.student_id} ${data.data?.course_code}` }, ...prev];
            return next.slice(0, 50);
          });
        } catch { }
      };
      evtSource.onerror = () => {};
      streamRef.current = evtSource;
      return () => evtSource.close();
    } else {
      if (streamRef.current) { streamRef.current.close(); streamRef.current = null; }
    }
  }, [activeTab]);

  const handleStudentSearch = async () => {
    if (!searchId.trim()) return;
    setReportLoading(true); setError(null);
    setReportResults(null);
    setGradeInputs({});
    try {
      const data = await gql(`{ searchStudentById(student_id: "${searchId.trim()}") { student_id student_name department course_code semester grade credits } }`);
      setReportResults(data.searchStudentById);
    } catch (e) { setError(e.message); }
    setReportLoading(false);
  };

  const handleGradeUpdate = async (student_id, department, course_code) => {
    const key = `${course_code}-${department}`;
    const newGrade = gradeInputs[key];
    if (newGrade === undefined || newGrade === '') return;
    setUpdating(key);
    try {
      await gql(`mutation { updateStudentGrade(student_id: "${student_id}", department: "${department}", course_code: "${course_code}", newGrade: ${parseFloat(newGrade)}) { id grade } }`);
      setGradeInputs(prev => ({ ...prev, [key]: '' }));
      handleStudentSearch();
    } catch (e) { setError(e.message); }
    setUpdating(null);
  };

  const renderOverview = () => (
    <div className="content-pane">
      <h2>Dashboard Overview</h2>
      <p className="pane-desc">Department analytics and semester trends across all records.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        {deptStats.map(d => (
          <div key={d.department} className="kpi-card" style={{ padding: '1.25rem' }}>
            <h3>{d.department}</h3>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#246343' }}>{d.averageGrade.toFixed(2)}</div>
            <div style={{ color: '#66756c', fontSize: '0.85rem' }}>{d.totalCount} records</div>
            <div style={{ color: '#66756c', fontSize: '0.8rem', marginTop: '0.25rem' }}>
              {d.timing.cacheHit ? '⚡ Cached' : `⏱ ${d.timing.totalTimeMs}ms`}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        <div style={{ background: '#fff', border: '1px solid var(--border-color)', borderRadius: 12, padding: '1.5rem' }}>
          <h3 style={{ margin: '0 0 1rem', color: '#246343' }}>Average Grade by Department</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={deptStats}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e6e0" />
              <XAxis dataKey="department" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={60} />
              <YAxis domain={[0, 4]} />
              <Tooltip />
              <Bar dataKey="averageGrade" fill="#246343" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ background: '#fff', border: '1px solid var(--border-color)', borderRadius: 12, padding: '1.5rem' }}>
          <h3 style={{ margin: '0 0 1rem', color: '#246343' }}>Grade Trend by Semester</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={semesterStats}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e6e0" />
              <XAxis dataKey="semester" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={60} />
              <YAxis domain={[0, 4]} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="averageGrade" stroke="#c59b27" strokeWidth={2} dot={{ fill: '#c59b27' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );

  const renderSubjectAnalytics = () => (
    <div className="content-pane">
      <div className="pane-meta-row">
        <div>
          <h2>Student Course Records</h2>
          <p className="pane-desc">Live streaming dataset populated from your MongoDB collection.</p>
        </div>
        <div className="kpi-card">
          <h3>Overall Grade Average:</h3>
          <div className="kpi-value">
            {students.length > 0
              ? (students.reduce((a, c) => a + Number(c.grade), 0) / students.length).toFixed(2)
              : '0.0'} GPA
          </div>
        </div>
      </div>
      <div className="dataset-showcase-box">
        <div className="showcase-table-header">
          <div className="header-col-label">ID</div>
          <div className="header-col-label">Student Name</div>
          <div className="header-col-label">Department / Course</div>
          <div className="header-col-label">Semester</div>
          <div className="header-col-label">Grade</div>
        </div>
        {loading && <div className="showcase-empty-state">Loading MongoDB matrices...</div>}
        {error && <div className="showcase-empty-state" style={{ color: '#ff8a8a' }}>Error: {error}</div>}
        {!loading && !error && students.length === 0 && <div className="showcase-empty-state">No student profiles found in MongoDB.</div>}
        {!loading && !error && students.map((s, i) => (
          <div key={s.id || i} className="showcase-table-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(0,0,0,0.1)' }}>
            <div style={{ color: '#c59b27' }}>{s.student_id}</div>
            <div style={{ color: '#ffffff', fontWeight: 'bold' }}>{s.student_name}</div>
            <div style={{ color: '#d8e3d8' }}>{s.department} ({s.course_code})</div>
            <div style={{ color: '#d8e3d8' }}>{s.semester}</div>
            <div style={{ color: '#c59b27', fontWeight: 'bold' }}>{s.grade}</div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderStudentReports = () => (
    <div className="content-pane">
      <h2>Student Reports</h2>
      <p className="pane-desc">Look up grades for a student by ID and update individual course grades.</p>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', marginBottom: '1.5rem' }}>
        <div className="input-group" style={{ flex: 1 }}>
          <label>Student ID</label>
          <input type="text" value={searchId} onChange={e => setSearchId(e.target.value)} placeholder="e.g. STU897762" onKeyDown={e => e.key === 'Enter' && handleStudentSearch()} />
        </div>
        <button className="core-button login-button" style={{ width: 'auto', padding: '0.75rem 1.5rem', marginTop: 0 }}
          onClick={handleStudentSearch} disabled={reportLoading}>
          {reportLoading ? 'Searching...' : 'Search'}
        </button>
      </div>
      {reportResults !== null && (
        <div className="dataset-showcase-box">
          <div className="showcase-table-header">
            <div className="header-col-label">ID</div>
            <div className="header-col-label">Student Name</div>
            <div className="header-col-label">Dept / Course</div>
            <div className="header-col-label">Semester</div>
            <div className="header-col-label">Grade</div>
            <div className="header-col-label">Credits</div>
            <div className="header-col-label">Update</div>
          </div>
          {reportResults.length === 0
            ? <div className="showcase-empty-state">No records found for this student.</div>
            : reportResults.map((s, i) => {
                const key = `${s.course_code}-${s.department}`;
                return (
                  <div key={s.id || i} className="showcase-table-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(0,0,0,0.1)', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 1fr' }}>
                    <div style={{ color: '#c59b27' }}>{s.student_id}</div>
                    <div style={{ color: '#ffffff', fontWeight: 'bold' }}>{s.student_name}</div>
                    <div style={{ color: '#d8e3d8' }}>{s.department} ({s.course_code})</div>
                    <div style={{ color: '#d8e3d8' }}>{s.semester}</div>
                    <div style={{ color: '#c59b27', fontWeight: 'bold' }}>{s.grade}</div>
                    <div style={{ color: '#d8e3d8' }}>{s.credits}</div>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      <input type="number" step="0.1" min="0" max="4" placeholder="New"
                        value={gradeInputs[key] || ''} onChange={e => setGradeInputs(p => ({ ...p, [key]: e.target.value }))}
                        style={{ width: 60, padding: '4px 6px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: '#fff', fontSize: '0.85rem' }} />
                      <button onClick={() => handleGradeUpdate(s.student_id, s.department, s.course_code)} disabled={updating === key}
                        style={{ padding: '4px 8px', borderRadius: 4, border: 'none', background: '#c59b27', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem' }}>
                        {updating === key ? '...' : 'Set'}
                      </button>
                    </div>
                  </div>
                );
              })}
        </div>
      )}
    </div>
  );

  const renderAtRisk = () => (
    <div className="content-pane">
      <div className="pane-meta-row">
        <div>
          <h2>At-Risk & Trends</h2>
          <p className="pane-desc">Students with grades below 2.0 — flagged for intervention.</p>
        </div>
        <div className="kpi-card">
          <h3>At-Risk Students:</h3>
          <div className="kpi-value" style={{ color: '#d9534f', fontSize: '1.5rem', fontWeight: 700 }}>{atRiskStudents.length}</div>
        </div>
      </div>
      <div className="dataset-showcase-box">
        <div className="showcase-table-header">
          <div className="header-col-label">ID</div>
          <div className="header-col-label">Student Name</div>
          <div className="header-col-label">Department</div>
          <div className="header-col-label">Course</div>
          <div className="header-col-label">Semester</div>
          <div className="header-col-label">Grade</div>
        </div>
        {loading && <div className="showcase-empty-state">Analyzing grade data...</div>}
        {error && <div className="showcase-empty-state" style={{ color: '#ff8a8a' }}>Error: {error}</div>}
        {!loading && !error && atRiskStudents.length === 0 && <div className="showcase-empty-state">No at-risk students found.</div>}
        {!loading && !error && atRiskStudents.map((s, i) => (
          <div key={s.id || i} className="showcase-table-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(0,0,0,0.1)' }}>
            <div style={{ color: '#c59b27' }}>{s.student_id}</div>
            <div style={{ color: '#ffffff', fontWeight: 'bold' }}>{s.student_name}</div>
            <div style={{ color: '#d8e3d8' }}>{s.department}</div>
            <div style={{ color: '#d8e3d8' }}>{s.course_code}</div>
            <div style={{ color: '#d8e3d8' }}>{s.semester}</div>
            <div style={{ color: '#ff8a8a', fontWeight: 'bold' }}>{s.grade}</div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderStreams = () => (
    <div className="content-pane">
      <h2>Event Streams</h2>
      <p className="pane-desc">Real-time grade mutation events broadcast over Apache Kafka.</p>
      <div className="dataset-showcase-box" style={{ minHeight: 300, padding: '1rem', fontFamily: 'monospace' }}>
        {streamLog.length === 0 && (
          <div style={{ color: 'rgba(255,255,255,0.4)', fontStyle: 'italic', padding: '2rem', textAlign: 'center' }}>
            Listening for grade mutation events via SSE...
          </div>
        )}
        {streamLog.map((entry, i) => (
          <div key={i} style={{ color: '#d8e3d8', padding: '0.5rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.85rem' }}>
            <span style={{ color: '#c59b27' }}>[{entry.time}]</span> {entry.msg}
          </div>
        ))}
      </div>
    </div>
  );

  const TAB_RENDER = {
    overview: renderOverview,
    subject_analytics: renderSubjectAnalytics,
    student_reports: renderStudentReports,
    at_risk: renderAtRisk,
    streams: renderStreams
  };

  return (
    <div className="dashboard-wrapper">
      <aside className="dash-sidebar">
        <div className="sidebar-logo">
          <div className="logo-svg-icon">C</div>
        </div>
        <nav className="sidebar-nav">
          {NAV.map(item => (
            <button key={item.id} className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => setActiveTab(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
        <button onClick={onLogout} className="logout-button">Log Out</button>
      </aside>
      <main className="dash-main">
        <header className="dash-header">
          <h1>Academic Performance Management</h1>
          <div className="header-profile">
            <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80" alt="Profile" className="avatar-img" />
            <span>{user?.username || 'Guest'}</span>
          </div>
        </header>
        <section className="dash-content">
          {(TAB_RENDER[activeTab] || renderOverview)()}
        </section>
      </main>
    </div>
  );
};

export default UserDashboard;
