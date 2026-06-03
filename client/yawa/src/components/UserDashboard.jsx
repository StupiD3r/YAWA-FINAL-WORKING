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
  const [reportLoading, setReportLoading] = useState(false);
  const [updating, setUpdating] = useState(null);
  const [updateSuccess, setUpdateSuccess] = useState(null);
  const [gradeInputs, setGradeInputs] = useState({});

  const [atRiskStudents, setAtRiskStudents] = useState([]);
  const [streamLog, setStreamLog] = useState([]);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('theme') === 'dark');
  const streamRef = useRef(null);

  const [gradePage, setGradePage] = useState(1);
  const [gradeNextCursor, setGradeNextCursor] = useState(null);
  const [gradeHasMore, setGradeHasMore] = useState(false);
  const gradeCursors = useRef({ 1: null });

  const [atRiskPage, setAtRiskPage] = useState(1);
  const [atRiskNextCursor, setAtRiskNextCursor] = useState(null);
  const [atRiskHasMore, setAtRiskHasMore] = useState(false);
  const atRiskCursors = useRef({ 1: null });

  const [reportResults, setReportResults] = useState(null);
  const [reportPage, setReportPage] = useState(1);
  const [reportNextCursor, setReportNextCursor] = useState(null);
  const [reportHasMore, setReportHasMore] = useState(false);
  const reportCursors = useRef({ 1: null });

  const [selectedSemester, setSelectedSemester] = useState('');
  const [semesters, setSemesters] = useState([]);
  const [totalAtRiskCount, setTotalAtRiskCount] = useState(0);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

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

  const fetchGrades = useCallback(async (cursor) => {
    setLoading(true); setError(null);
    try {
      const cursorArg = cursor ? `, nextCursor: "${cursor}"` : '';
      const data = await gql(`{ getGrades(limit: 100${cursorArg}) { records { student_id student_name department course_code semester grade } nextCursor hasMore } }`);
      setStudents(data.getGrades.records);
      setGradeNextCursor(data.getGrades.nextCursor);
      setGradeHasMore(data.getGrades.hasMore);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, []);

  const fetchAtRisk = useCallback(async (cursor, semester) => {
    setLoading(true); setError(null);
    try {
      const cursorArg = cursor ? `, nextCursor: "${cursor}"` : '';
      const semesterArg = semester ? `, semester: "${semester}"` : '';
      const data = await gql(`{ getGrades(limit: 100${cursorArg}${semesterArg}) { records { student_id student_name department course_code semester grade } nextCursor hasMore } }`);
      const filtered = data.getGrades.records.filter(r => r.grade === 3.0 || r.grade === 5.0).sort((a, b) => a.grade - b.grade);
      setAtRiskStudents(filtered);
      setAtRiskNextCursor(data.getGrades.nextCursor);
      setAtRiskHasMore(data.getGrades.hasMore);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, []);

  const fetchAtRiskCount = useCallback(async (semester) => {
    try {
      const semArg = semester ? `(semester: "${semester}")` : '';
      const data = await gql(`{ getAtRiskCount${semArg} }`);
      setTotalAtRiskCount(data.getAtRiskCount);
    } catch {}
  }, []);

  useEffect(() => {
    if (activeTab === 'overview') {
      fetchOverview();
    } else if (activeTab === 'subject_analytics') {
      setGradePage(1);
      gradeCursors.current = { 1: null };
      fetchGrades(null);
    } else if (activeTab === 'at_risk') {
      gql(`{ getSemesterAnalytics { semester } }`).then(d => {
        const list = d.getSemesterAnalytics.map(s => s.semester);
        setSemesters(list);
      }).catch(() => {});
      setAtRiskPage(1);
      atRiskCursors.current = { 1: null };
      setSelectedSemester('');
      fetchAtRiskCount(null);
      fetchAtRisk(null);
    } else {
      setLoading(false);
    }
  }, [activeTab, fetchOverview, fetchGrades, fetchAtRisk, fetchAtRiskCount]);

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

  const handleStudentSearch = async (cursor) => {
    if (!searchId.trim()) return;
    setReportLoading(true); setError(null);
    setReportResults(null);
    setUpdateSuccess(null);
    setGradeInputs({});
    try {
      const cursorArg = cursor ? `, nextCursor: "${cursor}"` : '';
      const data = await gql(`{ searchStudentById(student_id: "${searchId.trim()}", limit: 100${cursorArg}) { records { id student_id student_name department course_code semester grade credits } nextCursor hasMore } }`);
      setReportResults(data.searchStudentById.records);
      setReportNextCursor(data.searchStudentById.nextCursor);
      setReportHasMore(data.searchStudentById.hasMore);
      if (!cursor) { setReportPage(1); reportCursors.current = { 1: null }; }
    } catch (e) { setError(e.message); }
    setReportLoading(false);
  };

  const handleGradeUpdate = async (student_id, department, course_code) => {
    const key = `${course_code}-${department}`;
    const newGrade = gradeInputs[key];
    if (newGrade === undefined || newGrade === '') return;
    setUpdating(key);
    setUpdateSuccess(null);
    try {
      await gql(`mutation { updateStudentGrade(student_id: "${student_id}", department: "${department}", course_code: "${course_code}", newGrade: ${parseFloat(newGrade)}) { id grade } }`);
      setGradeInputs(prev => ({ ...prev, [key]: '' }));
      setUpdating(null);
      setUpdateSuccess(key);
      setTimeout(() => setUpdateSuccess(null), 2500);
      handleStudentSearch();
    } catch (e) { setError(e.message); setUpdating(null); }
  };

  const handleGradeNext = () => {
    const nextPage = gradePage + 1;
    gradeCursors.current[nextPage] = gradeNextCursor;
    setGradePage(nextPage);
    fetchGrades(gradeNextCursor);
  };

  const handleGradePrev = () => {
    const prevPage = gradePage - 1;
    setGradePage(prevPage);
    fetchGrades(gradeCursors.current[prevPage]);
  };

  const handleAtRiskNext = () => {
    const nextPage = atRiskPage + 1;
    atRiskCursors.current[nextPage] = atRiskNextCursor;
    setAtRiskPage(nextPage);
    fetchAtRisk(atRiskNextCursor, selectedSemester);
  };

  const handleAtRiskPrev = () => {
    const prevPage = atRiskPage - 1;
    setAtRiskPage(prevPage);
    fetchAtRisk(atRiskCursors.current[prevPage], selectedSemester);
  };

  const handleSemesterChange = (semester) => {
    setSelectedSemester(semester);
    setAtRiskPage(1);
    atRiskCursors.current = { 1: null };
    fetchAtRiskCount(semester || null);
    fetchAtRisk(null, semester || null);
  };

  const handleReportNext = () => {
    const nextPage = reportPage + 1;
    reportCursors.current[nextPage] = reportNextCursor;
    setReportPage(nextPage);
    handleStudentSearch(reportNextCursor);
  };

  const handleReportPrev = () => {
    const prevPage = reportPage - 1;
    setReportPage(prevPage);
    handleStudentSearch(reportCursors.current[prevPage]);
  };

  const PaginationBar = ({ page, hasMore, onPrev, onNext, of }) => (
    <div className="pagination-bar">
      <button className="page-btn" disabled={page <= 1} onClick={onPrev}>← Previous</button>
      <span className="page-info">Page {page}{of ? ` of ${of}` : ''}</span>
      <button className="page-btn" disabled={!hasMore} onClick={onNext}>Next →</button>
    </div>
  );

  const renderOverview = () => (
    <div className="content-pane">
      <h2>Dashboard Overview</h2>
      <p className="pane-desc">Department analytics and semester trends across all records.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        {deptStats.map(d => (
          <div key={d.department} className="kpi-card" style={{ padding: '1.25rem' }}>
            <h3>{d.department}</h3>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0d9488' }}>{d.averageGrade.toFixed(2)}</div>
            <div style={{ color: '#64748b', fontSize: '0.85rem' }}>{d.totalCount} records</div>
            <div style={{ color: '#64748b', fontSize: '0.8rem', marginTop: '0.25rem' }}>
              {d.timing.cacheHit ? '⚡ Cached' : `⏱ ${d.timing.totalTimeMs}ms`}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        <div style={{ background: '#fff', border: '1px solid var(--border-color)', borderRadius: 12, padding: '1.5rem' }}>
          <h3 style={{ margin: '0 0 1rem', color: '#0d9488' }}>Average Grade by Department</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={deptStats}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="department" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={60} />
              <YAxis domain={[0, 4]} />
              <Tooltip />
              <Bar dataKey="averageGrade" fill="#0d9488" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ background: '#fff', border: '1px solid var(--border-color)', borderRadius: 12, padding: '1.5rem' }}>
          <h3 style={{ margin: '0 0 1rem', color: '#0d9488' }}>Grade Trend by Semester</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={semesterStats}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="semester" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={60} />
              <YAxis domain={[0, 4]} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="averageGrade" stroke="#14b8a6" strokeWidth={2} dot={{ fill: '#14b8a6' }} />
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
        {error && <div className="showcase-empty-state" style={{ color: '#f87171' }}>Error: {error}</div>}
        {!loading && !error && students.length === 0 && <div className="showcase-empty-state">No student profiles found in MongoDB.</div>}
        {!loading && !error && students.map((s, i) => (
          <div key={s.id || i} className="showcase-table-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(0,0,0,0.1)' }}>
            <div style={{ color: '#99f6e4' }}>{s.student_id}</div>
            <div style={{ color: '#ffffff', fontWeight: 'bold' }}>{s.student_name}</div>
            <div style={{ color: '#cbd5e1' }}>{s.department} ({s.course_code})</div>
            <div style={{ color: '#cbd5e1' }}>{s.semester}</div>
            <div style={{ color: '#99f6e4', fontWeight: 'bold' }}>{s.grade}</div>
          </div>
        ))}
      </div>
      <PaginationBar page={gradePage} hasMore={gradeHasMore} onPrev={handleGradePrev} onNext={handleGradeNext} />
    </div>
  );

  const renderStudentReports = () => (
    <div className="content-pane">
      <h2>Student Reports</h2>
      <p className="pane-desc">Look up grades for a student by ID and update individual course grades.</p>

      <div className="student-search-section">
        <div className="search-input-wrap">
          <label className="search-label">Student ID</label>
          <div className="search-row">
            <input
              type="text"
              className="search-field"
              value={searchId}
              onChange={e => setSearchId(e.target.value)}
              placeholder="e.g. STU897762"
              onKeyDown={e => e.key === 'Enter' && handleStudentSearch()}
            />
            <button
              className="core-button search-button"
              onClick={() => handleStudentSearch()}
              disabled={reportLoading}
            >
              {reportLoading ? 'Searching...' : 'Search'}
            </button>
          </div>
          <span className="search-helper">Enter a student ID like STU897762 or STU451239</span>
        </div>
        {error && <div className="search-error-inline">{error}</div>}
      </div>

      {reportLoading && (
        <div className="dataset-showcase-box">
          <div className="showcase-loading">
            <div className="loading-spinner" />
            <span>Searching records…</span>
          </div>
        </div>
      )}

      {!reportLoading && reportResults !== null && (
        <>
        <div className="dataset-showcase-box">
          <div className="results-summary">
            {reportResults.length > 0
              ? `Found ${reportResults.length} course record${reportResults.length > 1 ? 's' : ''} for student ${searchId.trim()}`
              : `No records found for student ${searchId.trim()}`}
          </div>

          {reportResults.length === 0 ? (
            <div className="showcase-empty-state">
              <span className="empty-icon">📭</span>
              No records found for this student ID.
            </div>
          ) : (
            <>
              <div className="showcase-table-header student-table-header">
                <span className="header-col-label">Student</span>
                <span className="header-col-label">Department / Course</span>
                <span className="header-col-label">Semester</span>
                <span className="header-col-label">Grade</span>
                <span className="header-col-label">Credits</span>
                <span className="header-col-label">Update Grade</span>
              </div>
              {reportResults.map((s, i) => {
                const key = `${s.course_code}-${s.department}`;
                const isUpdating = updating === key;
                const justUpdated = updateSuccess === key;
                return (
                  <div key={s.id || i} className={`student-table-row ${justUpdated ? 'row-updated' : ''}`}>
                    <div className="student-cell">
                      <span className="student-id">{s.student_id}</span>
                      <span className="student-name">{s.student_name}</span>
                    </div>
                    <div className="dept-cell">
                      <span className="dept-name">{s.department}</span>
                      <span className="course-code">{s.course_code}</span>
                    </div>
                    <div className="sem-cell">{s.semester}</div>
                    <div className="grade-cell">{s.grade}</div>
                    <div className="credits-cell">{s.credits}</div>
                    <div className="update-cell">
                      <div className="update-controls">
                        <input
                          type="number"
                          step="0.25"
                          min="1.0"
                          max="5.0"
                          className="grade-input"
                          placeholder="New"
                          value={gradeInputs[key] || ''}
                          onChange={e => setGradeInputs(p => ({ ...p, [key]: e.target.value }))}
                          disabled={isUpdating}
                        />
                        <button
                          className="grade-set-btn"
                          onClick={() => handleGradeUpdate(s.student_id, s.department, s.course_code)}
                          disabled={isUpdating || !gradeInputs[key]}
                        >
                          {isUpdating ? '…' : justUpdated ? '✓' : 'Set'}
                        </button>
                      </div>
                      {justUpdated && <span className="update-toast">Updated!</span>}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
        <PaginationBar page={reportPage} hasMore={reportHasMore} onPrev={handleReportPrev} onNext={handleReportNext} />
        </>
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
          <div className="kpi-value" style={{ color: '#ef4444', fontSize: '1.5rem', fontWeight: 700 }}>{totalAtRiskCount}</div>
        </div>
      </div>
      <div className="filter-bar">
        <label className="filter-label">Semester:</label>
        <select className="filter-select" value={selectedSemester} onChange={e => handleSemesterChange(e.target.value)}>
          <option value="">All Semesters</option>
          {semesters.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
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
        {error && <div className="showcase-empty-state" style={{ color: '#f87171' }}>Error: {error}</div>}
        {!loading && !error && atRiskStudents.length === 0 && <div className="showcase-empty-state">No at-risk students found.</div>}
        {!loading && !error && atRiskStudents.map((s, i) => (
          <div key={s.id || i} className="showcase-table-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(0,0,0,0.1)' }}>
            <div style={{ color: '#99f6e4' }}>{s.student_id}</div>
            <div style={{ color: '#ffffff', fontWeight: 'bold' }}>{s.student_name}</div>
            <div style={{ color: '#cbd5e1' }}>{s.department}</div>
            <div style={{ color: '#cbd5e1' }}>{s.course_code}</div>
            <div style={{ color: '#cbd5e1' }}>{s.semester}</div>
            <div style={{ color: '#f87171', fontWeight: 'bold' }}>{s.grade}</div>
          </div>
        ))}
      </div>
      <PaginationBar page={atRiskPage} hasMore={atRiskHasMore} onPrev={handleAtRiskPrev} onNext={handleAtRiskNext} />
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
          <div key={i} style={{ color: '#cbd5e1', padding: '0.5rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.85rem' }}>
            <span style={{ color: '#99f6e4' }}>[{entry.time}]</span> {entry.msg}
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
          <div className="header-actions">
            <button className="theme-toggle" onClick={() => setDarkMode(p => !p)} aria-label="Toggle theme">
              {darkMode ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              )}
            </button>
            <div className="header-profile">
              <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80" alt="Profile" className="avatar-img" />
              <span>{user?.username || 'Guest'}</span>
            </div>
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
