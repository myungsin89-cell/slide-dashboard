'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

export default function StudentPortal() {
  const params = useParams();
  const spreadsheetId = params.spreadsheetId;

  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Authentication & Flow state
  const [isCodeVerified, setIsCodeVerified] = useState(false);
  const [inputCode, setInputCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);

  // Custom Alert Modal state
  const [alertConfig, setAlertConfig] = useState(null); // { isOpen, title, message, type }
  const showAlert = (message, title = '알림', type = 'info') => {
    setAlertConfig({ isOpen: true, title, message, type });
  };
  const closeAlert = () => setAlertConfig(null);

  useEffect(() => {
    fetchStudentList();
  }, [spreadsheetId]);

  // Deterministic 4-digit numeric code generation (same as teacher dashboard)
  const generateNumericCode = (id) => {
    if (!id) return '0000';
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    const code = Math.abs(hash % 10000);
    return code.toString().padStart(4, '0');
  };

  // Read public spreadsheet table using Google Visualization API (Zero API key needed)
  const fetchStudentList = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&sheet=students`;
      const response = await fetch(url);
      const text = await response.text();
      
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) {
        throw new Error('스프레드시트 응답 형식이 올바르지 않습니다.');
      }

      const jsonStr = text.substring(jsonStart, jsonEnd + 1);
      const data = JSON.parse(jsonStr);

      const rows = data.table.rows || [];
      if (rows.length === 0) {
        throw new Error('배부된 학생 명단 데이터를 찾을 수 없습니다.');
      }

      const parsedStudents = rows.map((row) => {
        const cells = row.c || [];
        return {
          number: cells[0] ? cells[0].v : '',
          name: cells[1] ? cells[1].v : '',
          slideId: cells[2] ? cells[2].v : '',
          slideUrl: cells[3] ? cells[3].v : '',
          status: cells[4] ? cells[4].v : 'idle'
        };
      });

      const filtered = parsedStudents.filter(s => s.name && s.name !== 'student_name');
      setStudents(filtered);
    } catch (err) {
      console.error('Error fetching public student list:', err);
      setError('과제 데이터베이스에 접속할 수 없습니다. 교사 대시보드가 활성화되어 있고 드라이브에 시트가 생성되어 있는지 확인해 주세요.');
    } finally {
      setLoading(false);
    }
  };

  // Handle 4-digit code verification
  const handleVerifyCode = (e) => {
    e.preventDefault();
    setCodeError('');

    const correctCode = generateNumericCode(spreadsheetId);
    if (inputCode.trim() === correctCode) {
      setIsCodeVerified(true);
    } else {
      setCodeError('접속 코드가 일치하지 않습니다. 선생님이 칠판에 적어주신 4자리 숫자를 확인해 주세요.');
    }
  };

  // Handle student name selection
  const handleSelectStudent = (student) => {
    if (!student.slideUrl) {
      showAlert('슬라이드 과제 링크가 아직 생성되지 않았습니다. 선생님께 문의해 주세요.', '과제 준비 중', 'warning');
      return;
    }

    setSelectedStudent(student);
    window.open(student.slideUrl, '_blank');
  };

  return (
    <main style={{ maxWidth: '650px', margin: '0 auto', padding: '2rem 1.5rem', minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      
      {/* STEP 1: 4-digit Access Code Gateway */}
      {!isCodeVerified ? (
        <div className="card" style={{ padding: '2.5rem 2rem', textAlign: 'center', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.08)' }}>
          <div style={{ display: 'inline-flex', marginBottom: '1rem' }}>
            <svg width="60" height="60" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M38 14H30V6H10C8.9 6 8 6.9 8 8V40C8 41.1 8.9 42 10 42H38C39.1 42 40 41.1 40 40V16C40 14.9 39.1 14 38 14Z" fill="#F4B400"/>
              <path d="M40 14L30 6V14H40Z" fill="#DB9A00"/>
              <rect x="14" y="20" width="20" height="14" rx="2" fill="white"/>
              <rect x="16" y="22" width="16" height="10" fill="#F4B400"/>
              <rect x="18" y="24" width="8" height="2" fill="white"/>
              <rect x="18" y="28" width="12" height="2" fill="white"/>
            </svg>
          </div>

          <h1 style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--brand-green-dark)', margin: '0 0 0.5rem 0' }}>
            수업 과제 접속
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem', margin: '0 0 1.75rem 0', lineHeight: '1.5' }}>
            선생님이 안내해 주신 <strong>숫자 4자리 접속 코드</strong>를 입력하세요.
          </p>

          <form onSubmit={handleVerifyCode} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: '280px' }}>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                autoFocus
                placeholder="• • • •"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value.replace(/[^0-9]/g, ''))}
                style={{
                  width: '100%',
                  fontSize: '2rem',
                  fontWeight: 900,
                  textAlign: 'center',
                  letterSpacing: '0.6rem',
                  padding: '0.85rem 1rem',
                  borderRadius: '12px',
                  border: codeError ? '2px solid #ef4444' : '2px solid var(--border-card)',
                  backgroundColor: '#f8fafc',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                  color: 'var(--brand-green-dark)'
                }}
              />
            </div>

            {codeError && (
              <div style={{ color: '#dc2626', fontSize: '0.85rem', fontWeight: 700, animation: 'shake 0.3s ease-in-out' }}>
                ⚠️ {codeError}
              </div>
            )}

            <button
              type="submit"
              className="btn-primary"
              disabled={inputCode.length < 4}
              style={{
                width: '100%',
                maxWidth: '280px',
                padding: '0.9rem',
                fontSize: '1.05rem',
                fontWeight: 800,
                borderRadius: '10px',
                border: 'none',
                cursor: inputCode.length >= 4 ? 'pointer' : 'not-allowed',
                opacity: inputCode.length >= 4 ? 1 : 0.6,
                marginTop: '0.5rem'
              }}
            >
              과제 입장하기 ➔
            </button>
          </form>
        </div>
      ) : !selectedStudent ? (
        // STEP 2: Select Student Name Card
        <div className="card" style={{ padding: '2.5rem 1.75rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <button
                onClick={() => { setIsCodeVerified(false); setInputCode(''); }}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '0.82rem',
                  color: '#64748b',
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: '0.35rem 0.6rem',
                  borderRadius: '6px',
                  backgroundColor: '#f1f5f9'
                }}
              >
                ◀ 코드 다시 입력
              </button>
              <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--brand-green-dark)', backgroundColor: 'var(--bg-light-green)', padding: '0.25rem 0.6rem', borderRadius: '20px' }}>
                ✓ 인증 완료
              </span>
            </div>
            
            <h1 style={{ fontSize: '1.6rem', fontWeight: 900, color: 'var(--brand-green-dark)', margin: '0 0 0.35rem 0' }}>
              내 이름 선택하기
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
              본인의 번호와 이름을 클릭하면 개인 슬라이드로 자동 이동합니다.
            </p>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
              학생 명단을 불러오고 있습니다...
            </div>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: '2rem 0', color: '#b91c1c', backgroundColor: '#fee2e2', borderRadius: '12px', border: '1px solid #fca5a5' }}>
              <p style={{ fontWeight: 700 }}>접속 에러</p>
              <p style={{ fontSize: '0.85rem', marginTop: '0.25rem', padding: '0 1rem' }}>{error}</p>
            </div>
          ) : students.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
              등록된 학생 명단이 없습니다.
            </div>
          ) : (
            <div 
              style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', 
                gap: '0.75rem', 
                maxHeight: '420px', 
                overflowY: 'auto',
                padding: '0.5rem'
              }}
            >
              {students.map((student) => (
                <div
                  key={student.name}
                  className="student-card active"
                  style={{ padding: '1.1rem 0.5rem', minHeight: '90px', cursor: 'pointer', transition: 'transform 0.15s' }}
                  onClick={() => handleSelectStudent(student)}
                >
                  <span className="student-number-badge" style={{ marginBottom: '0.35rem' }}>
                    {student.number ? `${student.number}번` : '학생'}
                  </span>
                  <strong style={{ fontSize: '1.15rem', fontWeight: 900 }}>{student.name}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        // STEP 3: Slide Connected Success State
        <div className="card" style={{ padding: '3rem 2rem', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--brand-green-dark)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'float 3s ease-in-out infinite' }}>
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--brand-green-dark)', marginBottom: '0.5rem' }}>
            과제 연결 완료!
          </h2>
          <p style={{ fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', margin: '0.5rem 0' }}>
            <span style={{ color: 'var(--brand-green-dark)' }}>[{selectedStudent.name}]</span> 학생의 구글 슬라이드가 새 창으로 실행되었습니다.
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.5rem', marginBottom: '2rem' }}>
            만약 새 창이 열리지 않았다면, 아래의 [내 슬라이드 열기] 버튼을 눌러주세요.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '320px', margin: '0 auto' }}>
            <a 
              href={selectedStudent.slideUrl} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="btn-primary"
              style={{ textDecoration: 'none', padding: '0.85rem', fontSize: '1rem', fontWeight: 800, borderRadius: '10px' }}
            >
              내 슬라이드 열기 ➔
            </a>
            <button 
              className="text-card-btn" 
              style={{ justifyContent: 'center', padding: '0.65rem' }} 
              onClick={() => setSelectedStudent(null)}
            >
              다른 학생 선택하기
            </button>
          </div>
        </div>
      )}

      {/* Global Custom Alert Modal */}
      {alertConfig && alertConfig.isOpen && (
        <div className="custom-modal-backdrop" onClick={closeAlert}>
          <div 
            className="custom-modal-content" 
            style={{ maxWidth: '420px', padding: '2rem 1.75rem', textAlign: 'center' }} 
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '56px', height: '56px', borderRadius: '50%', marginBottom: '1rem', backgroundColor: alertConfig.type === 'error' ? '#fee2e2' : (alertConfig.type === 'warning' ? '#fef3c7' : '#ecfdf5') }}>
              {alertConfig.type === 'success' && (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              )}
              {alertConfig.type === 'warning' && (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              )}
              {alertConfig.type === 'error' && (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              )}
              {alertConfig.type === 'info' && (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              )}
            </div>
            
            <h3 style={{ 
              fontSize: '1.2rem', 
              fontWeight: 900, 
              color: alertConfig.type === 'error' ? '#dc2626' : (alertConfig.type === 'warning' ? '#d97706' : 'var(--brand-green-dark)'), 
              margin: '0 0 0.5rem 0' 
            }}>
              {alertConfig.title || '알림'}
            </h3>

            <p style={{ fontSize: '0.92rem', color: '#475569', lineHeight: '1.55', margin: '0 0 1.5rem 0', whiteSpace: 'pre-wrap' }}>
              {alertConfig.message}
            </p>

            <div style={{ display: 'flex', gap: '0.65rem', justifyContent: 'center' }}>
              <button 
                type="button" 
                className="btn-primary"
                style={{ 
                  minWidth: '120px',
                  justifyContent: 'center',
                  backgroundColor: alertConfig.type === 'error' ? '#dc2626' : 'var(--brand-green-dark)'
                }}
                onClick={closeAlert}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-6px); }
          40%, 80% { transform: translateX(6px); }
        }
      `}</style>
    </main>
  );
}
