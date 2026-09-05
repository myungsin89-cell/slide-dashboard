'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  initGoogleSDKs, 
  signInTeacher, 
  signOutTeacher,
  fetchClassRosters,
  saveClassRoster,
  deleteClassRoster,
  getGoogleConfig,
  saveGoogleConfig
} from '@/lib/googleApi';
import MadeByStamp from '@/components/MadeByStamp';

export default function Home() {
  const router = useRouter();
  
  // SDK & Auth States
  const [sdkStatus, setSdkStatus] = useState('loading'); // 'loading', 'ready', 'config_missing', 'error'
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Manual Google API Config Modal
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [inputClientId, setInputClientId] = useState('');
  const [inputApiKey, setInputApiKey] = useState('');
  
  // Class Rosters List
  const [rosterList, setRosterList] = useState([]);
  const [isLoadingList, setIsLoadingList] = useState(false);

  // Class Delete Modal state
  const [classToDelete, setClassToDelete] = useState(null);
  const [isDeletingClass, setIsDeletingClass] = useState(false);

  // New Class Form states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [studentListInput, setStudentListInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [uploadMethod, setUploadMethod] = useState('text'); // 'text' or 'csv'

  // Custom Alert Modal state
  const [alertConfig, setAlertConfig] = useState(null); // { isOpen, title, message, type }
  const showAlert = (message, title = '알림', type = 'info') => {
    setAlertConfig({ isOpen: true, title, message, type });
  };
  const closeAlert = () => setAlertConfig(null);

  // Initialize SDKs on mount using .env variables
  useEffect(() => {
    tryInitializeSDKs();
  }, []);

  const tryInitializeSDKs = () => {
    setSdkStatus('loading');
    initGoogleSDKs(
      (token) => {
        setSdkStatus('ready');
        if (token) {
          setIsAuthenticated(true);
          loadClassrooms();
        }
      },
      (err) => {
        if (err === 'config_missing') {
          setSdkStatus('config_missing');
        } else {
          setSdkStatus('error');
          console.error(err);
        }
      }
    );
  };

  // Load teacher's existing classroom rosters
  const loadClassrooms = async () => {
    setIsLoadingList(true);
    try {
      const rosters = await fetchClassRosters();
      setRosterList(rosters);
    } catch (err) {
      console.error('Failed to load class rosters:', err);
    } finally {
      setIsLoadingList(false);
    }
  };

  // Handle Login
  const handleLogin = async () => {
    try {
      const token = await signInTeacher();
      if (token) {
        setIsAuthenticated(true);
        loadClassrooms();
      }
    } catch (err) {
      showAlert(`구글 로그인에 실패했습니다: ${err.message || err}`, '로그인 오류', 'error');
    }
  };

  // Handle Logout
  const handleLogout = () => {
    signOutTeacher();
    setIsAuthenticated(false);
    setRosterList([]);
  };

  // Helper to parse student lists (supports linebreaks, numbers, spacing, or number-only inputs for privacy)
  const parseStudents = (text) => {
    return text.split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map((line, idx) => {
        // Case A: "1 홍길동" or "1. 홍길동" or "1번 홍길동"
        const matchWithText = line.match(/^(\d+)[\s.번]*\s+(.+)$/);
        if (matchWithText) {
          return { number: parseInt(matchWithText[1]), name: matchWithText[2].trim() };
        }
        // Case B: Number only like "1" or "1번"
        const matchNumOnly = line.match(/^(\d+)[\s.번]*$/);
        if (matchNumOnly) {
          const num = parseInt(matchNumOnly[1]);
          return { number: num, name: `${num}번 학생` };
        }
        // Case C: Name only without number
        return { number: idx + 1, name: line };
      });
  };

  // CSV File Uploader with EUC-KR Korean Encoding Guard
  const handleCSVUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const lines = text.split('\n')
        .map(line => line.trim())
        .filter(Boolean);
      
      const parsed = [];
      lines.forEach((line, idx) => {
        const cols = line.split(',').map(c => c.replace(/^["']|["']$/g, '').trim());
        if (cols.length >= 2) {
          if (idx === 0 && isNaN(cols[0])) return;
          parsed.push(`${cols[0]} ${cols[1]}`);
        }
      });

      if (parsed.length > 0) {
        setStudentListInput(parsed.join('\n'));
        showAlert(`CSV 파일에서 ${parsed.length}명의 학생 명단을 가져왔습니다!`, '가져오기 완료', 'success');
        setUploadMethod('text');
      } else {
        showAlert('올바른 CSV 형식이 아닙니다. 번호,이름 형식의 쉼표 구분 파일인지 확인해 주세요.', '형식 확인', 'warning');
      }
    };
    reader.readAsText(file, 'EUC-KR');
  };

  // Generate and trigger download of a sample CSV file
  const downloadCSVTemplate = () => {
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF번호,이름\n1,홍길동\n2,김철수\n3,이영희";
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "G배움로그_명단양식.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Handle saving new classroom roster to Google Spreadsheet DB
  const handleCreateClass = async (e) => {
    e.preventDefault();

    if (!newClassName.trim()) return showAlert('학급 이름을 입력해 주세요.', '입력 확인', 'warning');
    if (!studentListInput.trim()) return showAlert('학생 명단을 입력해 주세요.', '입력 확인', 'warning');

    setIsSaving(true);
    try {
      const parsedStudents = parseStudents(studentListInput);
      await saveClassRoster(newClassName.trim(), parsedStudents);
      
      showAlert(`'${newClassName}' 학급 명단이 구글 드라이브에 저장되었습니다!`, '생성 완료', 'success');
      setNewClassName('');
      setStudentListInput('');
      setShowCreateModal(false);
      await loadClassrooms();
    } catch (err) {
      console.error(err);
      showAlert(`학급 생성에 실패했습니다: ${getErrorMessage(err)}`, '생성 오류', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle deleting class roster from Google Spreadsheet DB
  const handleConfirmDeleteClass = async () => {
    if (!classToDelete) return;
    setIsDeletingClass(true);
    try {
      await deleteClassRoster(classToDelete);
      setClassToDelete(null);
      await loadClassrooms();
      showAlert('학급이 성공적으로 삭제되었습니다.', '삭제 완료', 'success');
    } catch (err) {
      console.error('Failed to delete class:', err);
      showAlert(`학급 삭제에 실패했습니다: ${getErrorMessage(err)}`, '삭제 오류', 'error');
    } finally {
      setIsDeletingClass(false);
    }
  };

  // Helper to extract detailed Google API error message
  const getErrorMessage = (err) => {
    if (!err) return '알 수 없는 오류가 발생했습니다.';
    if (typeof err === 'string') return err;
    if (err.result && err.result.error && err.result.error.message) {
      return err.result.error.message;
    }
    if (err.message) return err.message;
    try {
      return JSON.stringify(err);
    } catch (e) {
      return String(err);
    }
  };

  // Render Clean Minimal Centered Login Page (Single Viewport Layout)
  if (sdkStatus === 'ready' && !isAuthenticated) {
    return (
      <div style={{ 
        minHeight: '100vh', 
        width: '100%', 
        backgroundColor: '#f8fafc', 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        justifyContent: 'center', 
        padding: '2rem 1.5rem',
        position: 'relative'
      }}>
        {/* Subtle Brand Background Accent */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '280px',
          background: 'linear-gradient(180deg, #ecfdf5 0%, rgba(248, 250, 252, 0) 100%)',
          pointerEvents: 'none'
        }} />

        {/* Main Centered Login Card */}
        <div style={{ 
          position: 'relative',
          zIndex: 1,
          maxWidth: '460px', 
          width: '100%', 
          backgroundColor: '#ffffff',
          borderRadius: '24px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.07), 0 0 0 1px rgba(0, 0, 0, 0.02)',
          padding: '3rem 2.5rem',
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center',
          gap: '2rem'
        }}>
          
          {/* Logo and Title (Google 4-Color G + 배움 로그) */}
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h1 style={{ 
              fontSize: '2.6rem', 
              fontWeight: 900, 
              color: '#0f172a', 
              letterSpacing: '-0.03em', 
              lineHeight: '1.2',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.45rem',
              marginBottom: '0.6rem'
            }}>
              {/* Google 4-Color G */}
              <svg width="40" height="40" viewBox="0 0 48 48" style={{ display: 'block', flexShrink: 0 }}>
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <span>배움 로그</span>
                {/* Sleek Footprint Motif */}
                <svg width="28" height="28" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0, opacity: 0.85, transform: 'rotate(5deg)' }}>
                  <ellipse cx="16" cy="30" rx="6.5" ry="9.5" transform="rotate(-15 16 30)" fill="#0f172a"/>
                  <circle cx="10" cy="16.5" r="2" fill="#0f172a"/>
                  <circle cx="14" cy="14.5" r="2.2" fill="#0f172a"/>
                  <circle cx="18.5" cy="15" r="2" fill="#0f172a"/>
                  <circle cx="22.5" cy="17" r="1.8" fill="#0f172a"/>
                  <ellipse cx="32" cy="20" rx="6.5" ry="9.5" transform="rotate(15 32 20)" fill="#334155"/>
                  <circle cx="26" cy="6.5" r="2" fill="#334155"/>
                  <circle cx="30.5" cy="4.5" r="2.2" fill="#334155"/>
                  <circle cx="35" cy="5" r="2" fill="#334155"/>
                  <circle cx="39" cy="7" r="1.8" fill="#334155"/>
                </svg>
              </span>
            </h1>
            <p style={{ color: '#64748b', fontSize: '0.95rem', fontWeight: 600, letterSpacing: '-0.01em' }}>
              구글 워크스페이스 실시간 과정평가 대시보드
            </p>
          </div>

          {/* Google Sign-in Button */}
          <button 
            className="btn-google-login" 
            onClick={handleLogin} 
            style={{ 
              width: '100%',
              padding: '0.95rem 1.5rem',
              fontSize: '1rem',
              fontWeight: 800,
              borderRadius: '12px',
              backgroundColor: '#ffffff',
              border: '1.5px solid #cbd5e1',
              color: '#1e293b',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.75rem',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
          >
            <svg width="20" height="20" viewBox="0 0 18 18">
              <path fill="#4285F4" d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.47h4.84c-.21 1.12-.84 2.07-1.79 2.7l2.76 2.13c1.62-1.49 2.53-3.69 2.53-6.46z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.76-2.13c-.76.51-1.74.82-3.2.82-2.46 0-4.54-1.66-5.28-3.9L.96 12.75C2.43 15.89 5.5 18 9 18z"/>
              <path fill="#FBBC05" d="M3.72 10.6c-.19-.58-.3-1.2-.3-1.8s.11-1.22.3-1.8L.96 4.9C.32 6.18 0 7.6 0 9s.32 2.82.96 4.1l2.76-2.5z"/>
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.47.89 11.43 0 9 0 5.5 0 2.43 2.11.96 5.25L3.72 7.75C4.46 5.52 6.54 3.58 9 3.58z"/>
            </svg>
            Google 계정으로 로그인
          </button>

          {/* Google Workspace Integration Display */}
          <div style={{ 
            width: '100%',
            backgroundColor: '#f8fafc', 
            border: '1px solid #e2e8f0', 
            borderRadius: '14px', 
            padding: '1.25rem 0.85rem', 
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#64748b', marginBottom: '0.95rem', letterSpacing: '0.05em' }}>
              안전하게 연동되는 GOOGLE WORKSPACE
            </div>
            
            {/* 5 Workspace Apps Grid (Active 3 + Upcoming 2) */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', gap: '1.25rem', marginBottom: '0.85rem', flexWrap: 'nowrap' }}>
              
              {/* Google Drive (Active) */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem' }} title="구글 드라이브: 학급 명단 및 데이터 자동 저장">
                <div style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img src="/google-drive.svg" alt="Google Drive" style={{ width: '26px', height: '26px', objectFit: 'contain' }} />
                </div>
                <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#334155' }}>Drive</span>
              </div>

              {/* Google Sheets (Active) */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem' }} title="구글 스프레드시트: 학생별 타임라인 로그 DB">
                <div style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img src="/google-sheets.svg" alt="Google Sheets" style={{ width: '26px', height: '26px', objectFit: 'contain' }} />
                </div>
                <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#334155' }}>Sheets</span>
              </div>

              {/* Google Slides (Active) */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem' }} title="구글 슬라이드: 발표 및 모둠 협업 실시간 모니터링">
                <div style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img src="/google-slides.svg" alt="Google Slides" style={{ width: '26px', height: '26px', objectFit: 'contain' }} />
                </div>
                <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#334155' }}>Slides</span>
              </div>

              {/* Google Docs (Upcoming / Muted Grayscale) */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem', opacity: 0.55, filter: 'grayscale(0.65)' }} title="구글 문서: 글쓰기 및 개별 첨삭 과정 모니터링 (연동 준비 중)">
                <div style={{ position: 'relative', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img src="/google-docs.svg" alt="Google Docs" style={{ width: '26px', height: '26px', objectFit: 'contain' }} />
                  <span style={{ 
                    position: 'absolute', 
                    top: '-6px', 
                    right: '-10px', 
                    fontSize: '0.55rem', 
                    fontWeight: 900, 
                    backgroundColor: '#e2e8f0', 
                    color: '#475569', 
                    padding: '0.05rem 0.3rem', 
                    borderRadius: '4px',
                    lineHeight: '1.2'
                  }}>
                    예정
                  </span>
                </div>
                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b' }}>Docs</span>
              </div>

              {/* Google Forms (Upcoming / Muted Grayscale) */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem', opacity: 0.55, filter: 'grayscale(0.65)' }} title="구글 설문지: 설문 및 퀴즈 실시간 응답 분석 (연동 준비 중)">
                <div style={{ position: 'relative', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img src="/google-forms.svg" alt="Google Forms" style={{ width: '26px', height: '26px', objectFit: 'contain' }} />
                  <span style={{ 
                    position: 'absolute', 
                    top: '-6px', 
                    right: '-10px', 
                    fontSize: '0.55rem', 
                    fontWeight: 900, 
                    backgroundColor: '#e2e8f0', 
                    color: '#475569', 
                    padding: '0.05rem 0.3rem', 
                    borderRadius: '4px',
                    lineHeight: '1.2'
                  }}>
                    예정
                  </span>
                </div>
                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b' }}>Forms</span>
              </div>

            </div>

            <div style={{ fontSize: '0.74rem', color: '#94a3b8', lineHeight: '1.45' }}>
              기록은 개인 구글 시트에 기록되고,<br />
              파일은 구글 드라이브에 안전하게 저장됩니다.
            </div>
          </div>
          
        </div>

        {/* Subtle Signature Stamp */}
        <MadeByStamp style={{ position: 'relative', marginTop: '1rem', paddingBottom: '0.5rem' }} />
      </div>
    );
  }

  // Authorized Dashboard/Workspace flow (Aligned from top, no full-screen centering)
  return (
    <div style={{ width: '100%', minHeight: '100vh', backgroundColor: 'var(--bg-app)' }}>
      
      {/* Flush, modern borderless header navigation */}
      <header style={{ 
        width: '100%', 
        backgroundColor: 'var(--bg-card)', 
        borderBottom: '1px solid var(--border-card)', 
        padding: '0.85rem 2rem', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center' 
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <svg width="24" height="24" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            <span style={{ fontSize: '1.25rem', fontWeight: 900, color: 'var(--text-main)', letterSpacing: '-0.02em' }}>
              배움 로그
            </span>
          </div>
          <span style={{ 
            fontSize: '0.75rem', 
            fontWeight: 700, 
            backgroundColor: 'var(--bg-light-green)', 
            color: 'var(--text-light-green)', 
            padding: '0.15rem 0.5rem', 
            borderRadius: '4px',
            marginLeft: '0.25rem'
          }}>
            학급 선택
          </span>
        </div>
        <div>
          <button 
            style={{ 
              background: '#fef2f2', 
              color: '#991b1b', 
              border: '1px solid #fee2e2', 
              padding: '0.4rem 0.85rem', 
              borderRadius: '6px', 
              fontSize: '0.85rem', 
              fontWeight: 700,
              cursor: 'pointer'
            }} 
            onClick={handleLogout}
          >
            로그아웃
          </button>
        </div>
      </header>

      {/* Main content body (Full-width modern app layout: Left Sidebar + Right Workspace) */}
      <main style={{ width: '100%', maxWidth: '1600px', margin: '0 auto', padding: '1.75rem 2rem' }}>
        
        {sdkStatus === 'loading' && (
          <div style={{ textAlign: 'center', padding: '6rem 1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '52px', height: '52px', color: 'var(--brand-green-dark)', animation: 'spin 1s linear infinite', marginBottom: '1.25rem' }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="2" x2="12" y2="6" />
                <line x1="12" y1="18" x2="12" y2="22" />
                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
                <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                <line x1="2" y1="12" x2="6" y2="12" />
                <line x1="18" y1="12" x2="22" y2="12" />
                <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
                <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
              </svg>
            </div>
            <h3 style={{ fontWeight: 800, color: 'var(--text-main)', margin: 0, fontSize: '1.2rem' }}>구글 연결 모듈 초기화 중...</h3>
          </div>
        )}

        {sdkStatus === 'config_missing' && (
          <div className="card" style={{ textAlign: 'center', padding: '3rem', maxWidth: '520px', margin: '3rem auto', borderColor: '#fca5a5', backgroundColor: '#fff5f5' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '56px', height: '56px', borderRadius: '50%', backgroundColor: '#fee2e2', color: '#b91c1c', marginBottom: '1.25rem' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <h2 style={{ fontWeight: 800, fontSize: '1.4rem', color: '#b91c1c', margin: '0 0 0.5rem 0' }}>API 자격 증명이 필요합니다</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', lineHeight: '1.5', margin: '0 0 1.5rem 0' }}>
              Vercel 환경 변수가 로드되지 않았거나 설정되지 않았습니다.<br />
              아래 버튼을 눌러 구글 Client ID와 API Key를 직접 입력하시면 즉시 구동됩니다.
            </p>
            <button 
              type="button"
              className="btn-primary"
              style={{ padding: '0.65rem 1.25rem', fontSize: '0.9rem', fontWeight: 800 }}
              onClick={() => {
                const conf = getGoogleConfig();
                setInputClientId(conf.clientId || '');
                setInputApiKey(conf.apiKey || '');
                setShowConfigModal(true);
              }}
            >
              🔑 구글 API 자격 증명 직접 등록하기
            </button>
          </div>
        )}

        {sdkStatus === 'ready' && isAuthenticated && (
          <div style={{ width: '100%' }}>
            {isLoadingList ? (
              <div style={{ textAlign: 'center', padding: '6rem 1rem', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '48px', height: '48px', color: 'var(--brand-green-dark)', animation: 'spin 1s linear infinite', marginBottom: '1rem' }}>
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="2" x2="12" y2="6" />
                    <line x1="12" y1="18" x2="12" y2="22" />
                    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
                    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                    <line x1="2" y1="12" x2="6" y2="12" />
                    <line x1="18" y1="12" x2="22" y2="12" />
                    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
                    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
                  </svg>
                </div>
                <h3 style={{ fontWeight: 800, color: 'var(--text-main)', margin: 0, fontSize: '1.2rem' }}>학급 목록 불러오는 중...</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '0.45rem' }}>내 구글 드라이브의 학급 데이터를 안전하게 조회하고 있습니다.</p>
              </div>
            ) : (
              /* Modern 2-Column Dashboard (Left Guide/Action Card + Right Class Cards Grid) */
              <div style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                
                {/* Left Panel: Class Creation Guide & Action (320px fixed width) */}
                <div style={{ flex: '0 0 320px', width: '320px', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  
                  {/* Main Create Class Button */}
                  <button
                    type="button"
                    className="btn-primary"
                    style={{
                      width: '100%',
                      padding: '1rem 1.25rem',
                      fontSize: '1rem',
                      fontWeight: 800,
                      borderRadius: '14px',
                      boxShadow: '0 6px 16px rgba(22, 101, 52, 0.25)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.6rem',
                      cursor: 'pointer'
                    }}
                    onClick={() => setShowCreateModal(true)}
                  >
                    <span style={{ fontSize: '1.3rem', lineHeight: '1' }}>＋</span> 새 학급 등록하기
                  </button>

                  {/* Step-by-Step Registration Guide Card */}
                  <div className="card" style={{ padding: '1.5rem', borderRadius: '18px', backgroundColor: '#ffffff' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                      {/* Google 4-Color Footprints Emblem */}
                      <svg width="22" height="22" viewBox="0 0 48 48">
                        <ellipse cx="16" cy="30" rx="6.5" ry="9.5" transform="rotate(-15 16 30)" fill="#4285F4"/>
                        <circle cx="10" cy="16.5" r="2" fill="#4285F4"/>
                        <circle cx="14" cy="14.5" r="2.2" fill="#34A853"/>
                        <circle cx="18.5" cy="15" r="2" fill="#34A853"/>
                        <circle cx="22.5" cy="17" r="1.8" fill="#34A853"/>
                        <ellipse cx="32" cy="20" rx="6.5" ry="9.5" transform="rotate(15 32 20)" fill="#EA4335"/>
                        <circle cx="26" cy="6.5" r="2" fill="#FBBC05"/>
                        <circle cx="30.5" cy="4.5" r="2.2" fill="#FBBC05"/>
                        <circle cx="35" cy="5" r="2" fill="#EA4335"/>
                        <circle cx="39" cy="7" r="1.8" fill="#EA4335"/>
                      </svg>
                      <span style={{ fontSize: '0.95rem', fontWeight: 900, color: 'var(--text-main)' }}>
                        학급 등록 안내
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                      <div style={{ display: 'flex', gap: '0.65rem' }}>
                        <div style={{ width: '22px', height: '22px', borderRadius: '50%', backgroundColor: '#ecfdf5', color: '#15803d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 900, flexShrink: 0, marginTop: '2px' }}>
                          1
                        </div>
                        <div style={{ fontSize: '0.82rem', color: '#334155', lineHeight: '1.45' }}>
                          <strong>학급명 입력:</strong> 관리할 반 이름(예: <code>5학년 2반</code>)을 적습니다.
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '0.65rem' }}>
                        <div style={{ width: '22px', height: '22px', borderRadius: '50%', backgroundColor: '#ecfdf5', color: '#15803d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 900, flexShrink: 0, marginTop: '2px' }}>
                          2
                        </div>
                        <div style={{ fontSize: '0.82rem', color: '#334155', lineHeight: '1.45' }}>
                          <strong>명단 입력 (개인정보 안심):</strong> <code>번호 이름</code> 또는 개인정보 보호를 위해 <strong><code>번호(1~25)</code>만</strong> 등록해도 완벽하게 작동합니다.
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '0.65rem' }}>
                        <div style={{ width: '22px', height: '22px', borderRadius: '50%', backgroundColor: '#ecfdf5', color: '#15803d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 900, flexShrink: 0, marginTop: '2px' }}>
                          3
                        </div>
                        <div style={{ fontSize: '0.82rem', color: '#334155', lineHeight: '1.45' }}>
                          <strong>과제 1초 배부:</strong> 구글 슬라이드/독스 템플릿 링크를 넣으면 학생별 개인 사본이 즉시 완성됩니다.
                        </div>
                      </div>
                    </div>

                    <div style={{ marginTop: '1.25rem', paddingTop: '0.85rem', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700 }}>총 개설 학급</span>
                      <span style={{ fontSize: '0.85rem', fontWeight: 900, color: 'var(--brand-green-dark)', backgroundColor: '#f0fdf4', padding: '0.15rem 0.6rem', borderRadius: '6px' }}>
                        {rosterList.length}개
                      </span>
                    </div>
                  </div>

                  {/* CSV Template Download Pill Link */}
                  <div style={{ textAlign: 'center' }}>
                    <button
                      type="button"
                      onClick={downloadCSVTemplate}
                      style={{
                        background: 'none',
                        border: 'none',
                        fontSize: '0.8rem',
                        color: '#64748b',
                        fontWeight: 700,
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        padding: '0.3rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem'
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      <span>학생 명단 CSV 양식 다운로드</span>
                    </button>
                  </div>

                </div>

                {/* Right Main Area: Clean Class Grid (Fills 100% of remaining width) */}
                <div style={{ flex: 1, minWidth: '320px' }}>
                  
                  {rosterList.length === 0 ? (
                    /* Empty State */
                    <div 
                      className="card"
                      style={{ 
                        borderStyle: 'dashed', 
                        borderWidth: '2px', 
                        borderColor: '#a7f3d0', 
                        display: 'flex', 
                        flexDirection: 'column', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        padding: '4.5rem 2rem', 
                        cursor: 'pointer',
                        backgroundColor: '#f0fdf4',
                        borderRadius: '18px',
                        transition: 'all 0.2s ease'
                      }}
                      onClick={() => setShowCreateModal(true)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '56px', height: '56px', borderRadius: '50%', backgroundColor: 'rgba(16, 185, 129, 0.15)', color: 'var(--brand-green-dark)', marginBottom: '1rem' }}>
                        <span style={{ fontSize: '2.2rem', fontWeight: 900, lineHeight: 1 }}>＋</span>
                      </div>
                      <span style={{ fontWeight: 900, color: 'var(--brand-green-dark)', fontSize: '1.2rem' }}>첫 번째 학급을 등록해 보세요</span>
                      <span style={{ fontSize: '0.88rem', color: '#059669', marginTop: '0.45rem' }}>학생 명단을 등록하면 바로 슬라이드/독스 과제를 배부하고 실시간 모니터링을 시작할 수 있습니다.</span>
                    </div>
                  ) : (
                    /* Class Cards Grid - Soft Light Green Themed */
                    <div style={{ 
                      display: 'grid', 
                      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', 
                      gap: '1.25rem' 
                    }}>
                      {rosterList.map((className) => (
                        <div 
                          key={className}
                          className="card"
                          style={{ 
                            display: 'flex', 
                            flexDirection: 'column', 
                            justifyContent: 'space-between',
                            minHeight: '155px', 
                            cursor: 'pointer',
                            position: 'relative',
                            borderRadius: '18px',
                            padding: '1.5rem',
                            transition: 'all 0.2s ease',
                            backgroundColor: '#f0fdf4',
                            border: '1.5px solid #bbf7d0',
                            boxShadow: '0 2px 6px rgba(16, 185, 129, 0.05)'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateY(-3px)';
                            e.currentTarget.style.boxShadow = '0 12px 20px -4px rgba(16, 185, 129, 0.15)';
                            e.currentTarget.style.borderColor = '#86efac';
                            e.currentTarget.style.backgroundColor = '#ecfdf5';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = '0 2px 6px rgba(16, 185, 129, 0.05)';
                            e.currentTarget.style.borderColor = '#bbf7d0';
                            e.currentTarget.style.backgroundColor = '#f0fdf4';
                          }}
                          onClick={() => router.push(`/class/${encodeURIComponent(className)}`)}
                        >
                          {/* Delete (X) button */}
                          <button
                            type="button"
                            title="학급 삭제"
                            onClick={(e) => {
                              e.stopPropagation();
                              setClassToDelete(className);
                            }}
                            style={{
                              position: 'absolute',
                              top: '1rem',
                              right: '1rem',
                              width: '28px',
                              height: '28px',
                              borderRadius: '50%',
                              border: '1px solid transparent',
                              backgroundColor: 'rgba(255, 255, 255, 0.8)',
                              color: '#94a3b8',
                              fontSize: '1.15rem',
                              fontWeight: 900,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                              zIndex: 10
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = '#fee2e2';
                              e.currentTarget.style.color = '#ef4444';
                              e.currentTarget.style.borderColor = '#fca5a5';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
                              e.currentTarget.style.color = '#94a3b8';
                              e.currentTarget.style.borderColor = 'transparent';
                            }}
                          >
                            &times;
                          </button>

                          <div>
                            <div style={{ marginBottom: '0.4rem', paddingRight: '2rem' }}>
                              <h3 style={{ fontSize: '1.35rem', fontWeight: 900, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {className}
                              </h3>
                            </div>
                            <p style={{ color: '#047857', fontSize: '0.82rem', margin: 0, fontWeight: 600 }}>
                              구글 워크스페이스 실시간 연동
                            </p>
                          </div>

                          <div style={{ 
                            marginTop: '1.25rem', 
                            paddingTop: '0.85rem', 
                            borderTop: '1px solid rgba(187, 247, 208, 0.6)', 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            alignItems: 'center' 
                          }}>
                            <span style={{ 
                              fontSize: '0.82rem', 
                              fontWeight: 800, 
                              color: 'var(--brand-green-dark)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.35rem'
                            }}>
                              과제 목록 열기 ➔
                            </span>
                            <span style={{ 
                              fontSize: '0.72rem', 
                              backgroundColor: '#ffffff', 
                              color: '#15803d', 
                              padding: '0.2rem 0.55rem', 
                              borderRadius: '6px',
                              fontWeight: 800,
                              border: '1px solid #bbf7d0'
                            }}>
                              등록 완료
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                </div>

              </div>
            )}
          </div>
        )}

        {/* Subtle Signature Stamp */}
        <MadeByStamp />
      </main>

      {/* ➕ Create Class Modal */}
      {showCreateModal && (
        <div className="custom-modal-backdrop" onClick={() => !isSaving && setShowCreateModal(false)}>
          <div className="custom-modal-content" style={{ maxWidth: '550px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <svg width="24" height="24" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="16" cy="30" rx="6.5" ry="9.5" transform="rotate(-15 16 30)" fill="#4285F4"/>
                <circle cx="10" cy="16.5" r="2" fill="#4285F4"/>
                <circle cx="14" cy="14.5" r="2.2" fill="#34A853"/>
                <circle cx="18.5" cy="15" r="2" fill="#34A853"/>
                <circle cx="22.5" cy="17" r="1.8" fill="#34A853"/>
                <ellipse cx="32" cy="20" rx="6.5" ry="9.5" transform="rotate(15 32 20)" fill="#EA4335"/>
                <circle cx="26" cy="6.5" r="2" fill="#FBBC05"/>
                <circle cx="30.5" cy="4.5" r="2.2" fill="#FBBC05"/>
                <circle cx="35" cy="5" r="2" fill="#EA4335"/>
                <circle cx="39" cy="7" r="1.8" fill="#EA4335"/>
              </svg>
              새 학급 등록
            </div>
            
            <form onSubmit={handleCreateClass}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div className="horizontal-form-row">
                  <label className="horizontal-form-label">학급 이름</label>
                  <input 
                    type="text" 
                    className="horizontal-form-input" 
                    placeholder="예: 6학년 1반"
                    value={newClassName}
                    onChange={(e) => setNewClassName(e.target.value)}
                    required
                  />
                </div>

                {/* Upload method selector tabs */}
                <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid var(--border-card)', paddingBottom: '0.25rem' }}>
                  <button 
                    type="button" 
                    className="text-card-btn"
                    style={{ 
                      fontSize: '0.85rem', 
                      padding: '0.35rem 0.75rem', 
                      backgroundColor: uploadMethod === 'text' ? 'var(--brand-green-dark)' : 'transparent',
                      color: uploadMethod === 'text' ? 'white' : 'var(--brand-green-dark)'
                    }}
                    onClick={() => setUploadMethod('text')}
                  >
                    직접 쓰기 (복사 붙여넣기)
                  </button>
                  <button 
                    type="button" 
                    className="text-card-btn"
                    style={{ 
                      fontSize: '0.85rem', 
                      padding: '0.35rem 0.75rem', 
                      backgroundColor: uploadMethod === 'csv' ? 'var(--brand-green-dark)' : 'transparent',
                      color: uploadMethod === 'csv' ? 'white' : 'var(--brand-green-dark)'
                    }}
                    onClick={() => setUploadMethod('csv')}
                  >
                    엑셀(CSV) 업로드
                  </button>
                </div>

                {uploadMethod === 'text' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={{ fontWeight: 700, fontSize: '0.85rem' }}>학생 명단</label>
                      <span style={{ fontSize: '0.72rem', color: '#15803d', fontWeight: 700 }}>
                        💡 개인정보 보호: 번호만 입력해도 OK
                      </span>
                    </div>
                    <textarea 
                      className="horizontal-form-input" 
                      rows={6}
                      placeholder="한 줄에 '번호 이름' 또는 '번호만' 적어주세요.&#10;&#10;[예시 1 - 이름 포함]&#10;1 홍길동&#10;2 김철수&#10;&#10;[예시 2 - 개인정보 보호: 번호만]&#10;1&#10;2&#10;3"
                      value={studentListInput}
                      onChange={(e) => setStudentListInput(e.target.value)}
                      style={{ resize: 'vertical' }}
                      required
                    />
                  </div>
                ) : (
                  <div style={{ padding: '1.25rem', border: '1px dashed var(--border-card)', borderRadius: '8px', textAlign: 'center', backgroundColor: '#fdfdfd' }}>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                      엑셀에서 번호(A열), 이름(B열)로 입력하신 후 <strong>'CSV(쉼표로 분리)'</strong> 형식으로 저장하여 업로드하세요.
                    </p>
                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                      <input 
                        type="file" 
                        id="csv-file-input" 
                        accept=".csv" 
                        style={{ display: 'none' }} 
                        onChange={handleCSVUpload}
                      />
                      <label 
                        htmlFor="csv-file-input" 
                        className="btn-primary" 
                        style={{ cursor: 'pointer', fontSize: '0.9rem', padding: '0.5rem 1.25rem' }}
                      >
                        CSV 파일 선택
                      </label>
                      <button 
                        type="button" 
                        className="text-card-btn" 
                        style={{ fontSize: '0.85rem', padding: '0.5rem 1.25rem' }}
                        onClick={downloadCSVTemplate}
                      >
                        양식 다운로드
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="modal-actions" style={{ marginTop: '1.5rem' }}>
                <button 
                  type="button" 
                  className="text-card-btn" 
                  style={{ background: '#f1f5f9', color: '#475569', borderColor: '#cbd5e1' }}
                  onClick={() => setShowCreateModal(false)}
                  disabled={isSaving}
                >
                  취소
                </button>
                <button 
                  type="submit" 
                  className="btn-primary"
                  disabled={isSaving}
                >
                  {isSaving ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Distribution Progress Loader */}
      {isSaving && (
        <div className="custom-modal-backdrop">
          <div className="custom-modal-content" style={{ textAlign: 'center', padding: '2.5rem 1.5rem', maxWidth: '400px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '52px', height: '52px', color: 'var(--brand-green-dark)', animation: 'spin 1s linear infinite', marginBottom: '1.25rem' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="2" x2="12" y2="6" />
                <line x1="12" y1="18" x2="12" y2="22" />
                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
                <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                <line x1="2" y1="12" x2="6" y2="12" />
                <line x1="18" y1="12" x2="22" y2="12" />
                <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
                <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
              </svg>
            </div>
            <h3 style={{ fontWeight: 800, fontSize: '1.25rem', marginBottom: '0.5rem' }}>학급 데이터 등록 중...</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              선생님 구글 드라이브의 명단 시트 파일에 탭을 생성하고 학생 정보를 기입하고 있습니다.
            </p>
          </div>
        </div>
      )}

      {/* Delete Class Confirmation Modal */}
      {classToDelete && (
        <div className="custom-modal-backdrop" onClick={() => !isDeletingClass && setClassToDelete(null)}>
          <div className="custom-modal-content" style={{ maxWidth: '440px', padding: '2rem 1.75rem', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '56px', height: '56px', borderRadius: '50%', backgroundColor: '#fee2e2', color: '#dc2626', marginBottom: '1rem' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#b91c1c', margin: '0 0 0.5rem 0' }}>
              학급을 삭제하시겠습니까?
            </h3>
            <p style={{ fontSize: '0.9rem', color: '#475569', lineHeight: '1.5', margin: '0 0 1.5rem 0' }}>
              <strong>[{classToDelete}]</strong> 학급과 등록된 학생 명단 정보가 구글 드라이브에서 제거됩니다.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button 
                type="button" 
                className="text-card-btn" 
                style={{ flex: 1, justifyContent: 'center', background: '#f1f5f9', color: '#475569', borderColor: '#cbd5e1' }}
                onClick={() => setClassToDelete(null)}
                disabled={isDeletingClass}
              >
                취소
              </button>
              <button 
                type="button" 
                className="btn-primary"
                style={{ flex: 1, justifyContent: 'center', backgroundColor: '#dc2626', borderColor: '#b91c1c' }}
                onClick={handleConfirmDeleteClass}
                disabled={isDeletingClass}
              >
                {isDeletingClass ? '삭제 중...' : '학급 삭제'}
              </button>
            </div>
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

      {/* Direct Google API Config Modal */}
      {showConfigModal && (
        <div className="custom-modal-backdrop" onClick={() => setShowConfigModal(false)}>
          <div className="custom-modal-content" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              구글 API 자격 증명 직접 등록
            </div>
            <form onSubmit={(e) => {
              e.preventDefault();
              const cId = inputClientId.trim();
              const aKey = inputApiKey.trim();
              if (!cId || !aKey) {
                showAlert('Client ID와 API Key를 모두 입력해 주세요.', '입력 확인', 'warning');
                return;
              }
              saveGoogleConfig(cId, aKey);
              setShowConfigModal(false);
              showAlert('구글 API 자격 증명이 브라우저에 저장되었습니다! 연결을 시작합니다.', '저장 완료', 'success');
              tryInitializeSDKs();
            }}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.85rem', color: '#475569', margin: 0, lineHeight: '1.45' }}>
                  입력하신 키는 이 브라우저의 로컬 스토리지에 안전하게 보관되며, 즉시 구글 로그인 모듈이 활성화됩니다.
                </p>
                <div>
                  <label className="horizontal-form-label" style={{ marginBottom: '0.35rem', display: 'block', fontWeight: 800 }}>
                    Google Client ID
                  </label>
                  <input 
                    type="text" 
                    className="horizontal-form-input" 
                    placeholder="예: 10835...apps.googleusercontent.com"
                    value={inputClientId}
                    onChange={(e) => setInputClientId(e.target.value)}
                    required
                    style={{ width: '100%', fontSize: '0.82rem', fontFamily: 'monospace' }}
                  />
                </div>
                <div>
                  <label className="horizontal-form-label" style={{ marginBottom: '0.35rem', display: 'block', fontWeight: 800 }}>
                    Google API Key
                  </label>
                  <input 
                    type="text" 
                    className="horizontal-form-input" 
                    placeholder="예: AIzaSyDB..."
                    value={inputApiKey}
                    onChange={(e) => setInputApiKey(e.target.value)}
                    required
                    style={{ width: '100%', fontSize: '0.82rem', fontFamily: 'monospace' }}
                  />
                </div>
              </div>
              <div className="modal-footer" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
                <button 
                  type="button" 
                  className="text-card-btn" 
                  onClick={() => setShowConfigModal(false)}
                >
                  취소
                </button>
                <button 
                  type="submit" 
                  className="btn-primary"
                >
                  저장 및 연결하기
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
