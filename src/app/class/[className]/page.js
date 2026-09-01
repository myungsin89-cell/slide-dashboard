'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { 
  initGoogleSDKs, 
  loadClassRoster, 
  saveClassRoster,
  deleteClassRoster,
  fetchAssignmentsList,
  createDatabaseSpreadsheet,
  duplicateSlideForStudents,
  deleteAssignment
} from '@/lib/googleApi';

export default function ClassWorkspace() {
  const params = useParams();
  const router = useRouter();
  
  // Class name from URL dynamic path
  const className = decodeURIComponent(params.className);

  // SDK & Auth states
  const [sdkStatus, setSdkStatus] = useState('loading'); // 'loading', 'ready', 'unauthorized', 'error'
  const [isLoading, setIsLoading] = useState(true);
  
  // Data states
  const [students, setStudents] = useState([]);
  const [assignments, setAssignments] = useState([]);

  // Roster Slide Drawer state
  const [showRosterDrawer, setShowRosterDrawer] = useState(false);

  // Custom Alert / Confirm Modal state
  const [alertConfig, setAlertConfig] = useState(null); // { isOpen, title, message, type, isConfirm, onConfirm }

  const showAlert = (message, title = '알림', type = 'info') => {
    setAlertConfig({ isOpen: true, title, message, type, isConfirm: false });
  };

  const showConfirm = (message, onConfirm, title = '확인') => {
    setAlertConfig({ isOpen: true, title, message, type: 'warning', isConfirm: true, onConfirm });
  };

  const closeAlert = () => setAlertConfig(null);

  // Delete Assignment Modal state
  const [assignmentToDelete, setAssignmentToDelete] = useState(null);
  const [isDeletingAssignment, setIsDeletingAssignment] = useState(false);

  // Edit Class Roster Modal States
  const [showEditRosterModal, setShowEditRosterModal] = useState(false);
  const [rosterEditText, setRosterEditText] = useState('');
  const [isUpdatingRoster, setIsUpdatingRoster] = useState(false);

  // Create Assignment Modal States
  const [showCreateAssignmentModal, setShowCreateAssignmentModal] = useState(false);
  const [assignmentName, setAssignmentName] = useState('');
  const [templateInput, setTemplateInput] = useState('');
  const [keywordsInput, setKeywordsInput] = useState('');
  const [isCreatingAssignment, setIsCreatingAssignment] = useState(false);
  const [creationStep, setCreationStep] = useState(''); // 'db_creation', 'slide_duplication', 'done'
  const [duplicationProgress, setDuplicationProgress] = useState(null); // { current, total, studentName, studentNumber, percent }
  const [selectedStudentNames, setSelectedStudentNames] = useState([]);

  // Auto-populate target recipients when assignment modal opens
  useEffect(() => {
    if (showCreateAssignmentModal && students.length > 0) {
      setSelectedStudentNames(students.map(s => s.name));
    }
  }, [showCreateAssignmentModal, students]);

  // Initialize
  useEffect(() => {
    initGoogleSDKs(
      (token) => {
        if (token) {
          setSdkStatus('ready');
          loadClassData();
        } else {
          setSdkStatus('unauthorized');
        }
      },
      (err) => {
        setSdkStatus('error');
        console.error(err);
      }
    );
  }, [className]);

  // Load classroom rosters and existing assignments list
  const loadClassData = async () => {
    setIsLoading(true);
    try {
      const roster = await loadClassRoster(className);
      setStudents(roster);

      const list = await fetchAssignmentsList(className);
      setAssignments(list);
    } catch (err) {
      console.error('Error loading classroom data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Helper to extract Google Slide ID from share link
  const extractSlideId = (urlOrId) => {
    if (!urlOrId) return '';
    const match = urlOrId.match(/\/presentation\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : urlOrId;
  };

  // Helper to parse student lists (supports linebreaks, numbers, spacing)
  const parseStudents = (text) => {
    return text.split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map((line, idx) => {
        const match = line.match(/^(\d+)[\s.번]*\s+(.+)$/);
        if (match) {
          return { number: parseInt(match[1]), name: match[2].trim() };
        }
        return { number: idx + 1, name: line };
      });
  };

  // Helper to parse keywords (comma or line separated)
  const parseKeywords = (text) => {
    return text.split(/[\n,]+/)
      .map(k => k.trim())
      .filter(Boolean);
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

  // Action: Open roster edit modal with prefilled data
  const handleOpenEditRoster = () => {
    const formatted = students.map(s => `${s.number} ${s.name}`).join('\n');
    setRosterEditText(formatted);
    setShowEditRosterModal(true);
  };

  // Action: Save updated class roster
  const handleSaveRoster = async (e) => {
    e.preventDefault();
    if (!rosterEditText.trim()) return showAlert('명단을 입력해 주세요.', '입력 확인', 'warning');

    setIsUpdatingRoster(true);
    try {
      const parsed = parseStudents(rosterEditText);
      await saveClassRoster(className, parsed);
      setShowEditRosterModal(false);
      await loadClassData();
      showAlert('학급 명단이 성공적으로 수정되었습니다.', '수정 완료', 'success');
    } catch (err) {
      console.error(err);
      showAlert('명단 수정에 실패했습니다: ' + getErrorMessage(err), '오류', 'error');
    } finally {
      setIsUpdatingRoster(false);
    }
  };

  // Action: Delete classroom roster
  const handleDeleteClass = () => {
    showConfirm(
      `정말로 '${className}' 학급을 삭제하시겠습니까?\n저장된 학급 명단 데이터가 구글 드라이브에서 제거됩니다 (배부된 개별 과제는 유지됩니다).`,
      async () => {
        setIsLoading(true);
        try {
          await deleteClassRoster(className);
          showAlert('학급이 성공적으로 삭제되었습니다.', '삭제 완료', 'success');
          setTimeout(() => router.push('/'), 1200);
        } catch (err) {
          console.error(err);
          showAlert('학급 삭제에 실패했습니다: ' + getErrorMessage(err), '오류', 'error');
          setIsLoading(false);
        }
      },
      '학급 삭제 확인'
    );
  };

  // Action: Delete assignment (move database spreadsheet to trash)
  const handleConfirmDeleteAssignment = async () => {
    if (!assignmentToDelete) return;
    setIsDeletingAssignment(true);
    try {
      await deleteAssignment(assignmentToDelete.id);
      setAssignmentToDelete(null);
      await loadClassData();
      showAlert('과제가 성공적으로 삭제되었습니다.', '삭제 완료', 'success');
    } catch (err) {
      console.error('Failed to delete assignment:', err);
      showAlert('과제 삭제에 실패했습니다: ' + getErrorMessage(err), '오류', 'error');
    } finally {
      setIsDeletingAssignment(false);
    }
  };

  // Action: Distribute new assignment slides and create DB sheets
  const handleCreateAssignment = async (e) => {
    e.preventDefault();

    if (!assignmentName.trim()) return showAlert('과제 이름을 입력해 주세요.', '입력 확인', 'warning');
    if (!templateInput.trim()) return showAlert('구글 슬라이드 템플릿 주소 또는 파일 ID를 입력해 주세요.', '입력 확인', 'warning');
    if (students.length === 0) return showAlert('학급에 등록된 학생이 없습니다. 명단을 먼저 등록해 주세요.', '명단 확인', 'warning');
    if (selectedStudentNames.length === 0) return showAlert('과제를 배부할 학생을 최소 1명 이상 선택해 주세요.', '대상 확인', 'warning');

    const templateId = extractSlideId(templateInput);
    if (!templateId) return showAlert('올바른 구글 슬라이드 주소가 아닙니다. 링크를 다시 확인해 주세요.', '입력 확인', 'warning');

    const parsedKeywords = parseKeywords(keywordsInput);
    
    // Filter down to checked students
    const targetStudents = students.filter(s => selectedStudentNames.includes(s.name));

    setIsCreatingAssignment(true);
    setCreationStep('db_creation');
    setDuplicationProgress({ current: 0, total: targetStudents.length, studentName: '', studentNumber: '', percent: 0 });

    try {
      const spreadsheetId = await createDatabaseSpreadsheet(className, assignmentName.trim());
      
      setCreationStep('slide_duplication');
      await duplicateSlideForStudents(templateId, targetStudents, spreadsheetId, (prog) => {
        setDuplicationProgress(prog);
      });

      if (parsedKeywords.length > 0) {
        localStorage.setItem(`keywords_${spreadsheetId}`, JSON.stringify(parsedKeywords));
      }

      setCreationStep('done');
      router.push(`/dashboard/${spreadsheetId}`);
    } catch (err) {
      console.error(err);
      showAlert(`과제 생성 중 에러가 발생했습니다: ${getErrorMessage(err)}`, '생성 오류', 'error');
      setIsCreatingAssignment(false);
    }
  };

  if (sdkStatus === 'loading') {
    return (
      <div style={{ textAlign: 'center', padding: '5rem 0' }}>
        <div style={{ fontSize: '3rem', animation: 'spin 2s linear infinite' }}>⏳</div>
        <h2 style={{ marginTop: '1.5rem', fontWeight: 800 }}>학급 정보 불러오는 중...</h2>
      </div>
    );
  }

  if (sdkStatus === 'unauthorized') {
    return (
      <div className="card" style={{ maxWidth: '500px', margin: '5rem auto', textAlign: 'center' }}>
        <h2>권한인증이 필요합니다</h2>
        <p style={{ margin: '1rem 0 1.5rem 0', color: 'var(--text-muted)' }}>구글 로그인 권한 토큰이 만료되었거나 연결되지 않았습니다. 메인 화면으로 돌아가 로그인해 주세요.</p>
        <button className="btn-primary" style={{ margin: '0 auto' }} onClick={() => router.push('/')}>홈으로 가기</button>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', minHeight: '100vh', backgroundColor: 'var(--bg-app)' }}>
      {/* 1. Flush modern top navigation header */}
      <header style={{ 
        width: '100%', 
        backgroundColor: 'var(--bg-card)', 
        borderBottom: '1px solid var(--border-card)', 
        padding: '0.85rem 2rem', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '0.75rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <button 
            style={{ 
              background: 'none', 
              border: 'none', 
              color: 'var(--text-muted)', 
              cursor: 'pointer', 
              fontWeight: 800,
              fontSize: '0.9rem',
              paddingRight: '0.75rem',
              borderRight: '1px solid var(--border-card)',
              outline: 'none'
            }}
            onClick={() => router.push('/')}
          >
            ◀ 학급 목록
          </button>
          <svg width="28" height="28" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginLeft: '0.5rem' }}>
            <path d="M38 14H30V6H10C8.9 6 8 6.9 8 8V40C8 41.1 8.9 42 10 42H38C39.1 42 40 41.1 40 40V16C40 14.9 39.1 14 38 14Z" fill="#F4B400"/>
            <path d="M40 14L30 6V14H40Z" fill="#DB9A00"/>
            <rect x="14" y="20" width="20" height="14" rx="2" fill="white"/>
            <rect x="16" y="22" width="16" height="10" fill="#F4B400"/>
            <rect x="18" y="24" width="8" height="2" fill="white"/>
            <rect x="18" y="28" width="12" height="2" fill="white"/>
          </svg>
          <span style={{ fontSize: '1.15rem', fontWeight: 900, color: 'var(--text-main)', letterSpacing: '-0.02em' }}>
            {className}
          </span>
          
          {/* Compact Student Count Pill with Slide Drawer Toggle */}
          <button
            type="button"
            title="클릭하여 학생 명단 서랍(사이드바)을 엽니다"
            onClick={() => setShowRosterDrawer(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              backgroundColor: '#f8fafc',
              border: '1px solid #cbd5e1',
              color: '#334155',
              fontSize: '0.82rem',
              fontWeight: 700,
              padding: '0.35rem 0.75rem',
              borderRadius: '8px',
              cursor: 'pointer',
              marginLeft: '0.5rem',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#ecfdf5';
              e.currentTarget.style.borderColor = '#10b981';
              e.currentTarget.style.color = '#065f46';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#f8fafc';
              e.currentTarget.style.borderColor = '#cbd5e1';
              e.currentTarget.style.color = '#334155';
            }}
          >
            {/* Left Sidebar / Drawer Icon */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--brand-green-dark)' }}>
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
            
            <span>학생 <strong>{students.length}명</strong></span>
            
            <span style={{ 
              fontSize: '0.72rem', 
              fontWeight: 800, 
              backgroundColor: 'var(--brand-green-dark)', 
              color: 'white', 
              padding: '0.15rem 0.5rem', 
              borderRadius: '4px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.2rem'
            }}>
              명단 보기
            </span>
          </button>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <button 
            className="btn-primary"
            style={{ padding: '0.45rem 1.1rem', fontSize: '0.85rem' }}
            onClick={() => setShowCreateAssignmentModal(true)}
          >
            + 새 수업 과제 만들기
          </button>
        </div>
      </header>

      {/* 2. Full-width Main container for Assignments */}
      <main style={{ maxWidth: '1400px', margin: '0 auto', padding: '2rem 2rem' }}>
        <div>
          {/* Header row with assignment title */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-card)', paddingBottom: '0.75rem' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              이 학급의 수업 과제 목록 <span style={{ color: 'var(--brand-green-dark)', fontSize: '1rem' }}>({assignments.length}개)</span>
            </h2>
          </div>

          <div style={{ width: '100%' }}>

            {isLoading ? (
              <div className="card" style={{ padding: '4rem 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                과제 목록을 불러오는 중...
              </div>
            ) : assignments.length === 0 ? (
              <div 
                className="card" 
                style={{ 
                  padding: '4rem 2rem', 
                  textAlign: 'center', 
                  borderStyle: 'dashed', 
                  borderWidth: '2px', 
                  borderColor: 'var(--border-card)',
                  backgroundColor: 'transparent',
                  cursor: 'pointer'
                }}
                onClick={() => setShowCreateAssignmentModal(true)}
              >
                <strong style={{ display: 'block', fontSize: '1.1rem', color: 'var(--text-main)' }}>아직 등록된 수업 과제가 없습니다.</strong>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'block' }}>
                  클릭하여 첫 번째 구글 슬라이드 과제를 배부해 보세요.
                </span>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.25rem' }}>
                {/* Add assignment card */}
                <div 
                  className="card"
                  style={{ 
                    borderStyle: 'dashed', 
                    borderWidth: '2px', 
                    borderColor: 'var(--brand-green-dark)', 
                    display: 'flex', 
                    flexDirection: 'column', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    minHeight: '160px', 
                    cursor: 'pointer',
                    backgroundColor: 'transparent'
                  }}
                  onClick={() => setShowCreateAssignmentModal(true)}
                >
                  <span style={{ fontSize: '2rem', color: 'var(--brand-green-dark)', fontWeight: '300' }}>＋</span>
                  <span style={{ fontWeight: 800, color: 'var(--brand-green-dark)', marginTop: '0.5rem' }}>새 과제 만들어 배부하기</span>
                </div>

                {/* Assignment item list */}
                {assignments.map(ass => {
                  const isClosed = typeof window !== 'undefined' ? (localStorage.getItem(`closed_${ass.id}`) === 'true') : false;

                  return (
                    <div 
                      key={ass.id}
                      className="card"
                      style={{ 
                        display: 'flex', 
                        flexDirection: 'column', 
                        justifyContent: 'space-between',
                        minHeight: '160px', 
                        cursor: 'pointer',
                        position: 'relative',
                        borderColor: isClosed ? '#cbd5e1' : 'var(--border-card)',
                        backgroundColor: isClosed ? '#fafafa' : 'white'
                      }}
                      onClick={() => router.push(`/dashboard/${ass.id}`)}
                    >
                      {/* Delete (X) button */}
                      <button
                        type="button"
                        title="과제 삭제"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAssignmentToDelete(ass);
                        }}
                        style={{
                          position: 'absolute',
                          top: '0.65rem',
                          right: '0.65rem',
                          width: '24px',
                          height: '24px',
                          borderRadius: '50%',
                          border: '1px solid transparent',
                          backgroundColor: 'transparent',
                          color: '#94a3b8',
                          fontSize: '1.1rem',
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
                          e.currentTarget.style.backgroundColor = 'transparent';
                          e.currentTarget.style.color = '#94a3b8';
                          e.currentTarget.style.borderColor = 'transparent';
                        }}
                      >
                        &times;
                      </button>

                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem', paddingRight: '1.5rem' }}>
                          <svg width="24" height="24" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M38 14H30V6H10C8.9 6 8 6.9 8 8V40C8 41.1 8.9 42 10 42H38C39.1 42 40 41.1 40 40V16C40 14.9 39.1 14 38 14Z" fill={isClosed ? '#94a3b8' : '#F4B400'}/>
                            <path d="M40 14L30 6V14H40Z" fill={isClosed ? '#64748b' : '#DB9A00'}/>
                            <rect x="14" y="20" width="20" height="14" rx="2" fill="white"/>
                            <rect x="16" y="22" width="16" height="10" fill={isClosed ? '#94a3b8' : '#F4B400'}/>
                            <rect x="18" y="24" width="8" height="2" fill="white"/>
                            <rect x="18" y="28" width="12" height="2" fill="white"/>
                          </svg>
                          <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: isClosed ? '#475569' : 'var(--text-main)' }}>{ass.name}</h3>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.35rem' }}>
                          {isClosed ? (
                            <span style={{ 
                              fontSize: '0.72rem', 
                              fontWeight: 800, 
                              color: '#475569', 
                              backgroundColor: '#f1f5f9', 
                              border: '1px solid #cbd5e1', 
                              padding: '0.15rem 0.45rem', 
                              borderRadius: '4px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem'
                            }}>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                              </svg>
                              모니터링 종료됨
                            </span>
                          ) : (
                            <span style={{ 
                              fontSize: '0.72rem', 
                              fontWeight: 800, 
                              color: 'var(--brand-green-dark)', 
                              backgroundColor: 'var(--bg-light-green)', 
                              padding: '0.15rem 0.45rem', 
                              borderRadius: '4px'
                            }}>
                              ● 실시간 진행 중
                            </span>
                          )}

                          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            {new Date(ass.createdTime).toLocaleDateString('ko-KR')}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: '0.82rem', color: isClosed ? '#64748b' : 'var(--brand-green-dark)', fontWeight: 'bold', marginTop: '1rem' }}>
                        {isClosed ? '기록 및 리포트 열람 ➔' : '실시간 현황 보기 ➔'}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Roster Edit Modal */}
      {showEditRosterModal && (
        <div className="custom-modal-backdrop" onClick={() => !isUpdatingRoster && setShowEditRosterModal(false)}>
          <div className="custom-modal-content" style={{ maxWidth: '500px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              학급 명단 수정 - {className}
            </div>
            <form onSubmit={handleSaveRoster}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  번호와 이름을 한 줄에 하나씩 수정하여 저장하세요.
                </p>
                <textarea 
                  className="horizontal-form-input" 
                  rows={10}
                  value={rosterEditText}
                  onChange={(e) => setRosterEditText(e.target.value)}
                  style={{ resize: 'vertical', width: '100%' }}
                  required
                />
              </div>
              <div className="modal-actions" style={{ marginTop: '1.5rem' }}>
                <button 
                  type="button" 
                  className="text-card-btn" 
                  style={{ background: '#f1f5f9', color: '#475569', borderColor: '#cbd5e1' }}
                  onClick={() => setShowEditRosterModal(false)}
                  disabled={isUpdatingRoster}
                >
                  취소
                </button>
                <button 
                  type="submit" 
                  className="btn-primary"
                  disabled={isUpdatingRoster}
                >
                  저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Assignment Modal */}
      {showCreateAssignmentModal && (
        <div className="custom-modal-backdrop" onClick={() => !isCreatingAssignment && setShowCreateAssignmentModal(false)}>
          <div className="custom-modal-content" style={{ maxWidth: '550px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <svg width="24" height="24" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M38 14H30V6H10C8.9 6 8 6.9 8 8V40C8 41.1 8.9 42 10 42H38C39.1 42 40 41.1 40 40V16C40 14.9 39.1 14 38 14Z" fill="#F4B400"/>
                <path d="M40 14L30 6V14H40Z" fill="#DB9A00"/>
                <rect x="14" y="20" width="20" height="14" rx="2" fill="white"/>
                <rect x="16" y="22" width="16" height="10" fill="#F4B400"/>
                <rect x="18" y="24" width="8" height="2" fill="white"/>
                <rect x="18" y="28" width="12" height="2" fill="white"/>
              </svg>
              새 수업 과제 만들기
            </div>
            
            <form onSubmit={handleCreateAssignment}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  현재 학급(<strong>{className}</strong>)의 학생 <strong>{students.length}명</strong>에게 구글 슬라이드를 일괄 복사해 배부합니다.
                </p>
                
                <div className="horizontal-form-row">
                  <label className="horizontal-form-label">과제 이름</label>
                  <input 
                    type="text" 
                    className="horizontal-form-input" 
                    placeholder="예: 기후 변화와 탄소 배출 조사"
                    value={assignmentName}
                    onChange={(e) => setAssignmentName(e.target.value)}
                    required
                  />
                </div>

                <div className="horizontal-form-row">
                  <label className="horizontal-form-label">템플릿 링크</label>
                  <input 
                    type="text" 
                    className="horizontal-form-input" 
                    placeholder="구글 슬라이드 공유 링크 또는 ID 붙여넣기"
                    value={templateInput}
                    onChange={(e) => setTemplateInput(e.target.value)}
                    required
                  />
                </div>

                <div className="horizontal-form-row" style={{ alignItems: 'flex-start' }}>
                  <label className="horizontal-form-label" style={{ paddingTop: '0.25rem' }}>배부 대상</label>
                  <div style={{ flex: 1, maxHeight: '150px', overflowY: 'auto', border: '1px solid var(--border-card)', borderRadius: '8px', padding: '0.75rem', backgroundColor: '#fafafa' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-card)', paddingBottom: '0.35rem', marginBottom: '0.5rem' }}>
                      <button 
                        type="button" 
                        style={{ background: 'none', border: 'none', color: 'var(--brand-green-dark)', fontWeight: 800, fontSize: '0.75rem', cursor: 'pointer', padding: 0 }}
                        onClick={() => setSelectedStudentNames(students.map(s => s.name))}
                      >
                        전체 선택
                      </button>
                      <button 
                        type="button" 
                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontWeight: 800, fontSize: '0.75rem', cursor: 'pointer', padding: 0 }}
                        onClick={() => setSelectedStudentNames([])}
                      >
                        전체 해제
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
                      {students.map(s => (
                        <label key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                          <input 
                            type="checkbox" 
                            checked={selectedStudentNames.includes(s.name)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedStudentNames([...selectedStudentNames, s.name]);
                              } else {
                                setSelectedStudentNames(selectedStudentNames.filter(name => name !== s.name));
                              }
                            }}
                          />
                          <span>{s.number ? `${s.number}번 ` : ''}{s.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="horizontal-form-row" style={{ alignItems: 'flex-start' }}>
                  <label className="horizontal-form-label" style={{ paddingTop: '0.5rem' }}>핵심 키워드</label>
                  <textarea 
                    className="horizontal-form-input" 
                    rows={3}
                    placeholder="과제에 꼭 포함되어야 할 핵심 단어들을 쉼표(,)나 엔터로 적어주세요. (선택사항)&#10;예) 탄소중립, 지구온난화, 신재생에너지"
                    value={keywordsInput}
                    onChange={(e) => setKeywordsInput(e.target.value)}
                    style={{ resize: 'vertical' }}
                  />
                </div>
              </div>

              <div className="modal-actions" style={{ marginTop: '1.5rem' }}>
                <button 
                  type="button" 
                  className="text-card-btn" 
                  style={{ background: '#f1f5f9', color: '#475569', borderColor: '#cbd5e1' }}
                  onClick={() => setShowCreateAssignmentModal(false)}
                  disabled={isCreatingAssignment}
                >
                  취소
                </button>
                <button 
                  type="submit" 
                  className="btn-primary"
                  disabled={isCreatingAssignment}
                >
                  과제 생성 및 자동 배부
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assignment Distribution Loader with Live Student Progress */}
      {isCreatingAssignment && (
        <div className="custom-modal-backdrop">
          <div className="custom-modal-content" style={{ textAlign: 'center', padding: '2.5rem 1.75rem', maxWidth: '440px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '56px', height: '56px', borderRadius: '50%', color: 'var(--brand-green-dark)', animation: 'spin 1.5s linear infinite', marginBottom: '1.25rem' }}>
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
            <h3 style={{ fontWeight: 900, fontSize: '1.3rem', color: 'var(--text-main)', margin: '0 0 0.5rem 0' }}>
              수업 과제 배부 중...
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: '1.5', margin: '0 0 1.25rem 0' }}>
              구글 드라이브 내에 데이터베이스를 구축하고 학생별 개인 슬라이드를 복사하고 있습니다.
            </p>

            {/* Live Progress Bar */}
            {creationStep === 'slide_duplication' && duplicationProgress && (
              <div style={{ marginBottom: '1.25rem', textAlign: 'left' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', fontWeight: 800, color: 'var(--brand-green-dark)', marginBottom: '0.35rem' }}>
                  <span>
                    [{duplicationProgress.current} / {duplicationProgress.total}명] {duplicationProgress.studentNumber ? `${duplicationProgress.studentNumber}번 ` : ''}{duplicationProgress.studentName} 복사 중
                  </span>
                  <span>{duplicationProgress.percent}%</span>
                </div>
                <div style={{ width: '100%', height: '8px', backgroundColor: '#e2e8f0', borderRadius: '999px', overflow: 'hidden' }}>
                  <div 
                    style={{ 
                      width: `${duplicationProgress.percent}%`, 
                      height: '100%', 
                      backgroundColor: 'var(--brand-green-dark)', 
                      borderRadius: '999px',
                      transition: 'width 0.25s ease-out' 
                    }} 
                  />
                </div>
              </div>
            )}

            <div style={{ backgroundColor: '#ecfdf5', borderRadius: '8px', padding: '0.65rem 0.85rem', border: '1px solid #a7f3d0', fontSize: '0.85rem', fontWeight: 800, color: '#065f46' }}>
              {creationStep === 'db_creation' && '1단계: 구글 스프레드시트 데이터베이스 생성 중...'}
              {creationStep === 'slide_duplication' && (
                duplicationProgress?.studentName 
                  ? `2단계: ${duplicationProgress.studentNumber ? `${duplicationProgress.studentNumber}번 ` : ''}${duplicationProgress.studentName} 학생 슬라이드 사본 배부 중...`
                  : '2단계: 학생별 개인 구글 슬라이드 사본 배부 및 공유 설정 중...'
              )}
              {creationStep === 'done' && '3단계: 생성 완료! 대시보드로 이동합니다.'}
            </div>
          </div>
        </div>
      )}

      {/* Delete Assignment Confirmation Modal */}
      {assignmentToDelete && (
        <div className="custom-modal-backdrop" onClick={() => !isDeletingAssignment && setAssignmentToDelete(null)}>
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
              과제를 삭제하시겠습니까?
            </h3>
            <p style={{ fontSize: '0.92rem', color: '#475569', lineHeight: '1.6', margin: '0 0 1.5rem 0' }}>
              <strong>[{assignmentToDelete.name}]</strong> 과제가 삭제되며,<br />
              학생들에게 배부된 구글 슬라이드도 함께 삭제됩니다.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button 
                type="button" 
                className="text-card-btn" 
                style={{ flex: 1, justifyContent: 'center', background: '#f1f5f9', color: '#475569', borderColor: '#cbd5e1' }}
                onClick={() => setAssignmentToDelete(null)}
                disabled={isDeletingAssignment}
              >
                취소
              </button>
              <button 
                type="button" 
                className="btn-primary"
                style={{ flex: 1, justifyContent: 'center', backgroundColor: '#dc2626', borderColor: '#b91c1c' }}
                onClick={handleConfirmDeleteAssignment}
                disabled={isDeletingAssignment}
              >
                {isDeletingAssignment ? '삭제 중...' : '과제 삭제'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Student Roster Slide Drawer (좌측 슬라이드바) */}
      {showRosterDrawer && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.45)',
            backdropFilter: 'blur(3px)',
            zIndex: 2500,
            display: 'flex',
            justifyContent: 'flex-start',
            animation: 'fadeIn 0.2s ease-out'
          }}
          onClick={() => setShowRosterDrawer(false)}
        >
          <div 
            style={{
              width: '100%',
              maxWidth: '380px',
              height: '100%',
              backgroundColor: 'white',
              boxShadow: '8px 0 25px rgba(0,0,0,0.15)',
              display: 'flex',
              flexDirection: 'column',
              padding: '1.5rem',
              animation: 'slideInLeft 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.85rem', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 900, color: 'var(--brand-green-dark)', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  {className} 학생 명단
                </h3>
                <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 700 }}>총 {students.length}명의 학생 등록됨</span>
              </div>
              <button 
                onClick={() => setShowRosterDrawer(false)}
                style={{ 
                  background: '#f1f5f9', 
                  border: 'none', 
                  borderRadius: '50%', 
                  width: '32px', 
                  height: '32px', 
                  fontSize: '1.2rem', 
                  cursor: 'pointer', 
                  color: '#64748b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                &times;
              </button>
            </div>

            {/* Student List */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.45rem', paddingRight: '0.25rem' }}>
              {students.length === 0 ? (
                <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textAlign: 'center', padding: '3rem 1rem' }}>
                  등록된 학생이 없습니다.<br />아래 명단 수정 버튼을 눌러 학생을 등록해 주세요.
                </div>
              ) : (
                students.map(s => (
                  <div 
                    key={s.name}
                    style={{ 
                      display: 'flex', 
                      gap: '0.65rem', 
                      alignItems: 'center', 
                      padding: '0.55rem 0.85rem', 
                      backgroundColor: '#f8fafc', 
                      border: '1px solid #e2e8f0', 
                      borderRadius: '8px',
                      fontSize: '0.92rem'
                    }}
                  >
                    <span style={{ 
                      fontWeight: 900, 
                      color: 'var(--brand-green-dark)', 
                      backgroundColor: 'var(--bg-light-green)', 
                      width: '28px', 
                      height: '28px', 
                      borderRadius: '50%', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      fontSize: '0.82rem'
                    }}>
                      {s.number}
                    </span>
                    <strong style={{ fontWeight: 800, color: '#1e293b' }}>{s.name}</strong>
                  </div>
                ))
              )}
            </div>

            {/* Drawer Bottom Actions */}
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1.25rem', marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              <button 
                className="btn-primary" 
                style={{ justifyContent: 'center', width: '100%', padding: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                onClick={() => {
                  setShowRosterDrawer(false);
                  handleOpenEditRoster();
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                학급 명단 수정하기
              </button>
              <button 
                className="text-card-btn" 
                style={{ justifyContent: 'center', width: '100%', background: '#fee2e2', color: '#b91c1c', borderColor: '#fca5a5', padding: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                onClick={() => {
                  setShowRosterDrawer(false);
                  handleDeleteClass();
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                학급 삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Custom Alert / Confirm Modal */}
      {alertConfig && alertConfig.isOpen && (
        <div className="custom-modal-backdrop" onClick={() => !alertConfig.isConfirm && closeAlert()}>
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
              {alertConfig.isConfirm && (
                <button 
                  type="button" 
                  className="text-card-btn" 
                  style={{ flex: 1, justifyContent: 'center', background: '#f1f5f9', color: '#475569', borderColor: '#cbd5e1' }}
                  onClick={closeAlert}
                >
                  취소
                </button>
              )}
              <button 
                type="button" 
                className="btn-primary"
                style={{ 
                  flex: 1, 
                  justifyContent: 'center',
                  backgroundColor: alertConfig.type === 'error' ? '#dc2626' : 'var(--brand-green-dark)'
                }}
                onClick={() => {
                  if (alertConfig.isConfirm && alertConfig.onConfirm) {
                    alertConfig.onConfirm();
                  }
                  closeAlert();
                }}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideInLeft {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
