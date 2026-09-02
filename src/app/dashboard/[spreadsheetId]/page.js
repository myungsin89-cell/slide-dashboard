'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { 
  initGoogleSDKs, 
  signInTeacher,
  loadSpreadsheetData, 
  fetchSlideStats, 
  saveStudentsStatus, 
  appendActivityLogs
} from '@/lib/googleApi';

// Helper to extract new text inserted/pasted by comparing snapshot strings
function extractDiffText(prev = '', curr = '') {
  if (!prev) return curr.trim();
  const cleanedPrev = prev.replace(/\r\n/g, '\n').trim();
  const cleanedCurr = curr.replace(/\r\n/g, '\n').trim();
  
  if (cleanedCurr === cleanedPrev) return '';
  
  if (cleanedCurr.includes(cleanedPrev)) {
    return cleanedCurr.replace(cleanedPrev, '').trim();
  }
  
  if (cleanedCurr.length > cleanedPrev.length) {
    return cleanedCurr.substring(cleanedPrev.length).trim();
  }
  return '';
}

// Multi-layered behavioral diagnosis engine
function diagnoseStudentBehavior(student, personalLogs = [], keywords = []) {
  const now = new Date();
  const sortedLogs = [...personalLogs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const totalLogs = sortedLogs.length;

  const charCount = student.charCount || 0;
  const slideCount = student.slideCount || 0;
  const imageCount = student.imageCount || 0;
  const keywordCount = student.keywordCount || 0;
  const status = student.status; // 'active', 'idle', 'suspicious', 'disconnected'

  const startTime = totalLogs > 0 ? new Date(sortedLogs[0].timestamp).getTime() : now.getTime();
  const elapsedMinutes = (now.getTime() - startTime) / (1000 * 60);

  // 1) Disconnected
  if (status === 'disconnected') {
    return {
      badge: '⚪ 미접속 상태',
      color: '#64748b',
      bgColor: '#f1f5f9',
      borderColor: '#cbd5e1',
      desc: '아직 슬라이드에 진입하지 않았거나 인터넷 연결이 원활하지 않습니다. 접속 링크 또는 QR 코드를 다시 확인하도록 지도해 주세요.'
    };
  }

  // 2) Suspicious Clipboard Copy-Paste
  if (status === 'suspicious') {
    return {
      badge: '🔴 복붙 의심 적발',
      color: '#ef4444',
      bgColor: '#fef2f2',
      borderColor: '#fecaca',
      desc: '짧은 시간 동안 다량의 텍스트가 한 번에 입력(붙여넣기)되었습니다. 아래에 백업된 텍스트 원본을 토대로 본인의 언어로 재작성했는지 확인이 시급합니다.'
    };
  }

  // 3) Struggling at Start (3+ minutes, fewer than 15 chars, no images)
  if (elapsedMinutes >= 3 && charCount < 15 && imageCount === 0) {
    return {
      badge: '🧭 시작 단계 방황',
      color: '#f97316',
      bgColor: '#fff7ed',
      borderColor: '#ffedd5',
      desc: '과제가 시작된 지 시간이 지났으나 글 상자 입력이나 이미지 추가가 거의 없는 상태입니다. 주제 선정이나 첫 슬라이드 작성 방향에 어려움을 겪고 있을 수 있으니 가벼운 힌트 제공이 필요합니다.'
    };
  }

  // 4) Idle (no edits for 5+ minutes)
  if (status === 'idle') {
    return {
      badge: '💤 주의 산만 / 정체 의심',
      color: '#eab308',
      bgColor: '#fef9c3',
      borderColor: '#fef08a',
      desc: '슬라이드는 켜져 있으나 최근 5분 동안 단 한 번의 마우스/키보드 움직임(Revision)도 없었습니다. 창을 닫아두고 딴짓을 하거나 작업 동기를 잃고 방치된 상태일 수 있으니 즉시 개별 점검이 권장됩니다.'
    };
  }

  // 5) Active deliberation / fixing layout & sentences
  if (totalLogs >= 3) {
    const recentLogs = sortedLogs.slice(-3);
    const charDiffRecent = recentLogs[2].charCount - recentLogs[0].charCount;
    if (Math.abs(charDiffRecent) < 20) {
      return {
        badge: '🧠 탐구 고민 및 문장 교정',
        color: '#2563eb',
        bgColor: '#eff6ff',
        borderColor: '#bfdbfe',
        desc: '글자 수는 정체되어 있으나 슬라이드 조작(개체 조절, 서식 수정, 입력 취소 등)이 계속 감지됩니다. 자료 배치를 고민하거나 작성한 문장을 정교하게 다듬고 있는 진지한 성찰/고민 상태입니다.'
      };
    }
  }

  // 6) Visual Layout planner
  if (imageCount >= 2 && charCount < 100) {
    return {
      badge: '🎨 시각화 및 구조 기획',
      color: '#0891b2',
      bgColor: '#ecfeff',
      borderColor: '#c5f6fa',
      desc: '텍스트 서술에 앞서 다양한 이미지 자료를 배치하고 전체적인 발표의 구조(슬라이드 분량 구성)를 먼저 다듬고 있습니다. 시각적 기획력이 우수한 상태입니다.'
    };
  }

  // 7) Deep Focus typing
  return {
    badge: '✍️ 자료 정리 및 서술 몰입',
    color: '#16a34a',
    bgColor: '#f0fdf4',
    borderColor: '#bbf7d0',
    desc: '글자 수가 안정적으로 상승하며 탐구 자료를 텍스트화하여 기입하는 데 집중하고 있습니다. 지속적으로 과제 해결에 에너지를 쏟고 있는 바람직한 몰입 상태입니다.'
  };
}

// Generate 4-digit numeric code from spreadsheetId
export function generateNumericCode(id) {
  if (!id) return '0000';
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const code = Math.abs(hash % 10000);
  return code.toString().padStart(4, '0');
}

export default function Dashboard() {
  const params = useParams();
  const router = useRouter();
  const spreadsheetId = params.spreadsheetId;

  // Authentication & Loading states
  const [sdkStatus, setSdkStatus] = useState('loading'); // 'loading', 'ready', 'unauthorized', 'error'
  const [isLoading, setIsLoading] = useState(true);
  const [classTitle, setClassTitle] = useState('수업 대시보드');

  // Real-time student & log data
  const [students, setStudents] = useState([]);
  const [logs, setLogs] = useState([]);
  const [keywords, setKeywords] = useState([]);
  const [newKeywordInput, setNewKeywordInput] = useState('');

  const handleAddKeyword = () => {
    const trimmed = newKeywordInput.trim();
    if (!trimmed) return;
    if (keywords.includes(trimmed)) {
      showAlert('이미 등록된 키워드입니다.', '키워드 중복', 'warning');
      return;
    }
    const updated = [...keywords, trimmed];
    setKeywords(updated);
    localStorage.setItem(`keywords_${spreadsheetId}`, JSON.stringify(updated));
    setNewKeywordInput('');
  };

  const handleRemoveKeyword = (kw) => {
    const updated = keywords.filter(k => k !== kw);
    setKeywords(updated);
    localStorage.setItem(`keywords_${spreadsheetId}`, JSON.stringify(updated));
  };

  // Live Polling Control
  const [isPolling, setIsPolling] = useState(true);
  const [isAutoPaused, setIsAutoPaused] = useState(false);
  const [lastPollTime, setLastPollTime] = useState(null);

  // Auto-pause (sleep mode) after 40 minutes of idle browser time to protect Google API quotas
  useEffect(() => {
    if (!isPolling && !isAutoPaused) return;

    let idleTimer;
    const idleLimit = 40 * 60 * 1000; // 40 minutes

    const resetIdleTimer = () => {
      if (isAutoPaused) {
        setIsAutoPaused(false);
        setIsPolling(true);
      }
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        setIsPolling(false);
        setIsAutoPaused(true);
      }, idleLimit);
    };

    window.addEventListener('mousemove', resetIdleTimer);
    window.addEventListener('keydown', resetIdleTimer);
    window.addEventListener('click', resetIdleTimer);
    window.addEventListener('scroll', resetIdleTimer);

    resetIdleTimer();

    return () => {
      clearTimeout(idleTimer);
      window.removeEventListener('mousemove', resetIdleTimer);
      window.removeEventListener('keydown', resetIdleTimer);
      window.removeEventListener('click', resetIdleTimer);
      window.removeEventListener('scroll', resetIdleTimer);
    };
  }, [isPolling, isAutoPaused]);
  const [pollingTick, setPollingTick] = useState(0); 
  const pollingRef = useRef(null);
  const studentsRef = useRef([]);

  useEffect(() => {
    studentsRef.current = students;
  }, [students]);
  
  // UI states
  const [activeStudent, setActiveStudent] = useState(null);
  const [showCopyPasteModal, setShowCopyPasteModal] = useState(false);
  const [showTimelineModal, setShowTimelineModal] = useState(false);
  const [showChartModal, setShowChartModal] = useState(false);
  const [chartTimeFilter, setChartTimeFilter] = useState('all');
  const [chartSelectedDate, setChartSelectedDate] = useState('all');
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [teacherFeedback, setTeacherFeedback] = useState('');
  const [isReportMode, setIsReportMode] = useState(false);
  const [studentSearch, setStudentSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all'); // 'all', 'idle', 'suspicious', 'active', 'disconnected'

  // Custom Alert / Confirm Modal state
  const [alertConfig, setAlertConfig] = useState(null); // { isOpen, title, message, type, isConfirm, onConfirm }
  const showAlert = (message, title = '알림', type = 'info') => {
    setAlertConfig({ isOpen: true, title, message, type, isConfirm: false });
  };
  const showConfirm = (message, onConfirm, title = '확인') => {
    setAlertConfig({ isOpen: true, title, message, type: 'warning', isConfirm: true, onConfirm });
  };
  const closeAlert = () => setAlertConfig(null);

  // Assignment Monitoring Status (Active Live vs. Closed Archive)
  const [isMonitoringClosed, setIsMonitoringClosed] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const closed = localStorage.getItem(`closed_${spreadsheetId}`) === 'true';
      setIsMonitoringClosed(closed);
      if (closed) {
        setIsPolling(false);
      }
    }
  }, [spreadsheetId]);

  const handleCloseMonitoring = () => {
    showConfirm(
      '이 수업 과제의 모니터링을 종료하시겠습니까?\n\n• 실시간 슬라이드 감지 및 자동 폴링이 중단됩니다.\n• 지금까지 축적된 학생 활동 기록, 분석 그래프, 종합 평가 리포트는 그대로 보존되어 언제든지 열람하실 수 있습니다.',
      () => {
        setIsMonitoringClosed(true);
        setIsPolling(false);
        if (typeof window !== 'undefined') {
          localStorage.setItem(`closed_${spreadsheetId}`, 'true');
        }
      },
      '모니터링 종료 확인'
    );
  };

  const handleResumeMonitoring = () => {
    setIsMonitoringClosed(false);
    setIsPolling(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem(`closed_${spreadsheetId}`, 'false');
    }
  };

  // Student QR join URL & Copy state
  const [studentJoinUrl, setStudentJoinUrl] = useState('');
  const [copiedLinkSuccess, setCopiedLinkSuccess] = useState(false);

  const handleCopyJoinLink = () => {
    if (!studentJoinUrl) return;
    navigator.clipboard.writeText(studentJoinUrl);
    setCopiedLinkSuccess(true);
    setTimeout(() => {
      setCopiedLinkSuccess(false);
    }, 2000);
  };

  // Initialize
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const joinLink = `${window.location.protocol}//${window.location.host}/student/${spreadsheetId}`;
      setStudentJoinUrl(joinLink);

      const cachedKeywords = localStorage.getItem(`keywords_${spreadsheetId}`);
      if (cachedKeywords) {
        setKeywords(JSON.parse(cachedKeywords));
      }
    }

    initGoogleSDKs(
      (token) => {
        if (token) {
          setSdkStatus('ready');
          loadData();
        } else {
          setSdkStatus('unauthorized');
        }
      },
      (err) => {
        setSdkStatus('error');
        console.error(err);
      }
    );
  }, [spreadsheetId]);

  // Polling loop
  useEffect(() => {
    if (sdkStatus === 'ready' && isPolling && students.length > 0) {
      pollingRef.current = setInterval(() => {
        pollStudentSlides();
      }, 25000);
    } else {
      if (pollingRef.current) clearInterval(pollingRef.current);
    }

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [sdkStatus, isPolling, students, keywords]);

  const [loadErrorMsg, setLoadErrorMsg] = useState('');

  // Handle Re-login when OAuth token expires
  const handleReLogin = async () => {
    try {
      setIsLoading(true);
      setLoadErrorMsg('');
      const token = await signInTeacher();
      if (token) {
        setSdkStatus('ready');
        await loadData();
      }
    } catch (err) {
      console.error('Re-login failed:', err);
      showAlert('구글 로그인에 실패했습니다. 팝업이 차단되었는지 확인해 주세요.', '로그인 실패', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Load initial sheet data
  const loadData = async () => {
    setIsLoading(true);
    setLoadErrorMsg('');
    try {
      const fileMeta = await window.gapi.client.drive.files.get({
        fileId: spreadsheetId,
        fields: 'name'
      });
      const rawName = fileMeta.result.name;
      const match = rawName.match(/SlideSight_DB_\[(.*?)\]/);
      setClassTitle(match ? match[1] : rawName.replace('SlideSight_DB_', ''));

      const { students: loadedStudents, logs: loadedLogs } = await loadSpreadsheetData(spreadsheetId);
      
      const now = new Date();
      const missingLogs = [];
      let studentsDataUpdated = false;

      // Check current live slide stats and revision history for each student (chunked concurrency)
      const CONCURRENCY = 5;
      for (let i = 0; i < loadedStudents.length; i += CONCURRENCY) {
        const chunk = loadedStudents.slice(i, i + CONCURRENCY);
        await Promise.all(
          chunk.map(async (student) => {
            if (!student.slideId) return;

            try {
              // 1) Fetch current slide stats
              const stats = await fetchSlideStats(student.slideId, keywords);

              // 2) Fetch revision history from Google Drive
              let revisions = [];
              try {
                const revResp = await window.gapi.client.drive.revisions.list({
                  fileId: student.slideId,
                  fields: 'revisions(id,modifiedTime)'
                });
                revisions = revResp.result.revisions || [];
              } catch (revErr) {
                console.warn(`Failed to check revisions for ${student.name}:`, revErr);
              }

              // Revisions index 0 is initial template copy creation.
              // index 1+ are actual user edit revisions.
              const userRevisions = revisions.slice(1);
              const studentLogs = loadedLogs.filter(l => l.name === student.name);

              // Determine if student has ever worked
              const hasWorked = 
                userRevisions.length > 0 || 
                studentLogs.length > 0 || 
                stats.charCount > 0 || 
                stats.imageCount > 0 ||
                student.status !== 'disconnected';

              let nextStatus = student.status || 'disconnected';
              let latestTime = student.lastActiveAt;

              if (!hasWorked) {
                nextStatus = 'disconnected';
              } else {
                // Determine latest active time
                if (userRevisions.length > 0) {
                  latestTime = userRevisions[userRevisions.length - 1].modifiedTime;
                } else if (!latestTime) {
                  latestTime = now.toISOString();
                }

                // If user edited within 5 minutes, status is 'active', otherwise 'idle'
                const minutesSinceLastActive = (now.getTime() - new Date(latestTime).getTime()) / (1000 * 60);
                if (student.status === 'suspicious') {
                  nextStatus = 'suspicious';
                } else if (minutesSinceLastActive <= 5) {
                  nextStatus = 'active';
                } else {
                  nextStatus = 'idle';
                }
              }

              // Detect changes compared to existing spreadsheet record
              if (
                student.status !== nextStatus ||
                student.charCount !== stats.charCount ||
                student.slideCount !== stats.slideCount ||
                student.imageCount !== stats.imageCount
              ) {
                studentsDataUpdated = true;
              }

              // Update student object with actual live slide metrics
              student.charCount = stats.charCount;
              student.slideCount = stats.slideCount;
              student.imageCount = stats.imageCount;
              student.blankSlideCount = stats.blankSlideCount;
              student.keywordsUsed = stats.keywordsUsed;
              student.keywordCount = stats.keywordsUsed.length;
              student.status = nextStatus;
              if (latestTime) student.lastActiveAt = latestTime;
              student.revisionId = stats.revisionId;
              student.fullText = stats.fullText;

              // 3) Backfill offline activities from userRevisions if missing from spreadsheet logs
              if (userRevisions.length > 0) {
                const existingTimes = studentLogs.map(l => Math.round(new Date(l.timestamp).getTime() / (60 * 1000)));

                const newRevisions = userRevisions.filter(rev => {
                  const revTimeMinutes = Math.round(new Date(rev.modifiedTime).getTime() / (60 * 1000));
                  return !existingTimes.some(et => Math.abs(et - revTimeMinutes) <= 3);
                });

                if (newRevisions.length > 0) {
                  const startChar = studentLogs.length > 0 ? studentLogs[studentLogs.length - 1].charCount : 0;
                  const endChar = stats.charCount;
                  const charDiff = Math.max(endChar - startChar, 0);
                  const step = newRevisions.length > 0 ? charDiff / newRevisions.length : 0;

                  newRevisions.forEach((rev, idx) => {
                    const estimatedChar = Math.round(startChar + step * (idx + 1));
                    const prevEstimatedChar = Math.round(startChar + step * idx);
                    const diff = Math.max(estimatedChar - prevEstimatedChar, 0);

                    missingLogs.push({
                      name: student.name,
                      timestamp: rev.modifiedTime,
                      charCount: estimatedChar,
                      slideCount: stats.slideCount,
                      imageCount: stats.imageCount,
                      keywordCount: stats.keywordsUsed.length,
                      copiedText: diff >= 100 ? `[의심] 오프라인 대량 입력 감지 (+${diff}자)` : (diff > 0 ? `[추가] 교사 부재중 오프라인 작업 감지 (+${diff}자)` : '')
                    });
                  });
                }
              }
            } catch (studentErr) {
              console.error(`Error analyzing live slide for ${student.name}:`, studentErr);
            }
          })
        );
      }

      // Persist updated students and missing offline logs to Google Spreadsheet DB
      if (missingLogs.length > 0) {
        console.log(`Backfilling ${missingLogs.length} missing offline activity points to spreadsheet DB...`);
        try {
          await appendActivityLogs(spreadsheetId, missingLogs);
        } catch (appendErr) {
          console.error('Failed to append missing logs:', appendErr);
        }
      }

      if (studentsDataUpdated || missingLogs.length > 0) {
        try {
          await saveStudentsStatus(spreadsheetId, loadedStudents);
        } catch (saveErr) {
          console.error('Failed to sync updated student statuses to sheet:', saveErr);
        }
      }

      // Merge existing logs and missing offline logs, sort chronologically and restore charDiff
      const mergedLogs = [...loadedLogs, ...missingLogs];
      const timeSortedLogs = [...mergedLogs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      
      const restoredLogs = [];
      const studentLastChars = {};

      timeSortedLogs.forEach(log => {
        const prevChar = studentLastChars[log.name] || 0;
        const diff = log.charCount - prevChar;
        restoredLogs.push({
          ...log,
          charDiff: diff
        });
        studentLastChars[log.name] = log.charCount;
      });

      setStudents(loadedStudents);
      setLogs(restoredLogs);
      
      // Restore pollingTick to keep focusRatio scaling smooth after dashboard refresh
      const avgTicks = loadedStudents.length > 0 ? Math.round(restoredLogs.length / loadedStudents.length) : 0;
      setPollingTick(avgTicks);
    } catch (err) {
      console.error('Failed to load spreadsheet data:', err);
      const isAuthError = 
        err?.status === 401 || 
        err?.result?.error?.code === 401 || 
        err?.result?.error?.status === 'UNAUTHENTICATED' ||
        err?.message?.includes('401') || 
        err?.message?.includes('auth') || 
        err?.message?.includes('Not authenticated');

      if (isAuthError) {
        setSdkStatus('unauthorized');
        setLoadErrorMsg('구글 로그인 인증 토큰이 만료되었습니다. 아래 버튼을 눌러 다시 로그인해 주세요.');
      } else {
        const errorDetail = err?.result?.error?.message || err?.message || '스프레드시트 DB 연결에 실패했습니다.';
        setLoadErrorMsg(errorDetail);
        alert(`스프레드시트 DB 데이터를 불러오는데 실패했습니다: ${errorDetail}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Poll Slide API
  const pollStudentSlides = async () => {
    console.log('Polling student slides...');
    const now = new Date();
    const updatedStudents = [...studentsRef.current];
    const newLogs = [];
    let stateChanged = false;

    setPollingTick(prev => prev + 1);

    await Promise.all(
      updatedStudents.map(async (student) => {
        if (!student.slideId) return;

        try {
          const stats = await fetchSlideStats(student.slideId, keywords);
          
          const prevCharCount = student.charCount || 0;
          const prevSlideCount = student.slideCount || 0;
          const prevImageCount = student.imageCount || 0;
          const prevRevisionId = student.revisionId || '';
          const prevText = student.fullText || '';
          const prevStatus = student.status;

          const charDiff = stats.charCount - prevCharCount;
          const slideDiff = stats.slideCount - prevSlideCount;
          const isRevisionChanged = stats.revisionId && stats.revisionId !== prevRevisionId;
          const isContentChanged = isRevisionChanged || charDiff !== 0 || slideDiff !== 0 || stats.imageCount !== prevImageCount;

          let nextStatus = prevStatus;
          let nextLastActive = student.lastActiveAt || now.toISOString();

          // 1) Actual interaction/content edit detected
          if (isContentChanged) {
            nextStatus = 'active';
            nextLastActive = now.toISOString();
            stateChanged = true;

            let diffTextSegment = '';
            if (charDiff >= 100) {
              nextStatus = 'suspicious';
              diffTextSegment = extractDiffText(prevText, stats.fullText);
            }

            const addedTextSnippet = charDiff > 0 ? extractDiffText(prevText, stats.fullText).substring(0, 100) : '';

            // Record log only when previous baseline exists and there is an actual delta
            if (prevRevisionId && (charDiff !== 0 || slideDiff !== 0 || stats.imageCount !== prevImageCount)) {
              newLogs.push({
                name: student.name,
                timestamp: now.toISOString(),
                charCount: stats.charCount,
                charDiff: charDiff,
                slideCount: stats.slideCount,
                imageCount: stats.imageCount,
                keywordCount: stats.keywordsUsed.length,
                copiedText: diffTextSegment || (charDiff > 0 ? `[추가] ${addedTextSnippet}` : '')
              });
            }
          } else {
            // 2) Content unchanged during this tick
            const hasWorked = prevStatus !== 'disconnected' || stats.charCount > 0 || stats.imageCount > 0;

            if (!hasWorked) {
              // Never interacted and no content -> stay disconnected
              nextStatus = 'disconnected';
            } else {
              // Interacted in the past -> active or idle based on idle time
              const lastActiveTime = new Date(nextLastActive);
              const minutesIdle = (now.getTime() - lastActiveTime.getTime()) / (1000 * 60);

              if (minutesIdle >= 5) {
                if (prevStatus !== 'idle') {
                  nextStatus = 'idle';
                  stateChanged = true;
                }
              } else if (prevStatus === 'suspicious') {
                nextStatus = 'suspicious';
              } else {
                nextStatus = 'active';
              }
            }
          }

          if (
            nextStatus !== prevStatus || 
            stats.charCount !== prevCharCount || 
            stats.slideCount !== prevSlideCount || 
            stats.imageCount !== prevImageCount
          ) {
            stateChanged = true;
          }

          let currentTickFocus = nextStatus === 'active' ? 100 : (nextStatus === 'idle' ? 30 : 0);
          const accumulatedFocus = student.focusRatio || 100;
          const currentTick = pollingTick + 1;
          const nextFocusRatio = Math.round(((accumulatedFocus * (currentTick - 1)) + currentTickFocus) / currentTick);

          student.charCount = stats.charCount;
          student.slideCount = stats.slideCount;
          student.imageCount = stats.imageCount;
          student.blankSlideCount = stats.blankSlideCount;
          student.keywordsUsed = stats.keywordsUsed;
          student.keywordCount = stats.keywordsUsed.length;
          student.status = nextStatus;
          student.lastActiveAt = nextLastActive;
          student.focusRatio = nextFocusRatio;
          
          // Cache in memory for delta comparison on next tick
          student.revisionId = stats.revisionId;
          student.fullText = stats.fullText;

        } catch (err) {
          console.error(`Error polling slide for ${student.name}:`, err);
          if (student.status !== 'disconnected' && !student.charCount) {
            student.status = 'disconnected';
            stateChanged = true;
          }
        }
      })
    );

    if (stateChanged || newLogs.length > 0) {
      setStudents(updatedStudents);
      setLastPollTime(now);
      
      try {
        await saveStudentsStatus(spreadsheetId, updatedStudents);
        if (newLogs.length > 0) {
          setLogs(prev => [...prev, ...newLogs]);
          await appendActivityLogs(spreadsheetId, newLogs);
        }
      } catch (err) {
        console.error('Error writing polling updates to Spreadsheet DB:', err);
      }
    } else {
      setLastPollTime(now);
    }
  };

  // Manual Trigger Poll
  const handleManualRefresh = async () => {
    setIsLoading(true);
    await pollStudentSlides();
    setIsLoading(false);
  };

  // Handle saving feedback notes
  const handleSaveFeedback = async () => {
    if (!activeStudent) return;
    
    setIsLoading(true);
    try {
      const updated = students.map(s => {
        if (s.name === activeStudent.name) {
          return { ...s, teacherFeedback: teacherFeedback };
        }
        return s;
      });

      setStudents(updated);
      await saveStudentsStatus(spreadsheetId, updated);
      setActiveStudent(prev => ({ ...prev, teacherFeedback }));
    } catch (err) {
      console.error(err);
      alert('피드백을 저장하는데 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  // Student Profile categorizer
  const getStudentProfile = (student, studentLogs) => {
    if (student.status === 'disconnected' && student.charCount === 0) {
      return { label: '미참여형', color: '#64748b', desc: '슬라이드에 진입하지 않았거나 미작성 상태입니다.' };
    }
    
    if (student.focusRatio < 50) {
      return { label: '도움 필요형', color: '#d97706', desc: '정체 시간 비율이 높아, 개별 피드백이 권장됩니다.' };
    }

    if (student.status === 'suspicious') {
      return { label: '주의 요망형', color: '#ef4444', desc: '짧은 시간 동안 다량의 텍스트 붙여넣기가 감지되었습니다.' };
    }

    const personalLogs = studentLogs.filter(l => l.name === student.name);
    if (personalLogs.length >= 3) {
      const firstLog = personalLogs[0];
      const midLog = personalLogs[Math.floor(personalLogs.length / 2)];
      const lastLog = personalLogs[personalLogs.length - 1];

      const firstHalfText = midLog.charCount - firstLog.charCount;
      const secondHalfText = lastLog.charCount - midLog.charCount;

      if (secondHalfText > firstHalfText * 3 && lastLog.charCount > 100) {
        return { label: '후반 몰입형', color: '#8b5cf6', desc: '수업 후반에 작성량이 급증한 집중형 탐구 태도를 보입니다.' };
      }
    }

    if (student.imageCount >= 3) {
      return { label: '다감각 표현형', color: '#0284c7', desc: '이미지와 텍스트를 고루 조화시켜 시각 자료를 활발히 구성합니다.' };
    }

    return { label: '꾸준한 참여형', color: '#16a34a', desc: '수업 전반에 걸쳐 점진적이고 성실하게 탐구를 수행하고 있습니다.' };
  };

  // SVG Chart Renderer: 학생 활동 분석 그래프 (15일~30일 장기 프로젝트 완벽 대응: 날짜별 딥다이브 & 순간 활동 펄스)
  const renderSVGChart = (studentName, isLarge = false, onPointClick = null, selectedLogTimestamp = null, timeRangeFilter = 'all', selectedDate = 'all', onSelectDate = null) => {
    const personalLogs = logs.filter(l => l.name === studentName);
    if (personalLogs.length === 0) {
      return <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', padding: '2.5rem 0' }}>수집된 활동 로그 데이터가 아직 없습니다.</div>;
    }

    const sortedLogs = [...personalLogs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // 1. Group logs by date to support long-term (15~30 days) multi-day projects
    const dateGroupMap = {};
    sortedLogs.forEach(log => {
      const dStr = new Date(log.timestamp).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short' });
      if (!dateGroupMap[dStr]) dateGroupMap[dStr] = [];
      dateGroupMap[dStr].push(log);
    });
    const activeDateKeys = Object.keys(dateGroupMap);

    // Calculate maximum activity diff across all logs for proportional scaling
    const allDiffs = logs.map(l => Math.abs(l.charDiff !== undefined ? l.charDiff : 0));
    const maxDiff = Math.max(...allDiffs, 50);

    const width = isLarge ? 880 : 400;
    const height = isLarge ? 220 : 150;
    const padding = 28;

    const nowTime = new Date();
    const rawStartTime = new Date(sortedLogs[0].timestamp).getTime();
    const rawEndTime = nowTime.getTime();

    let startTime = rawStartTime;
    let endTime = rawEndTime;
    let targetLogs = sortedLogs;

    // Handle Specific Date Selection (Drill-down mode for multi-day projects)
    if (selectedDate !== 'all' && dateGroupMap[selectedDate]) {
      targetLogs = dateGroupMap[selectedDate];
      const dateLogsTimestamps = targetLogs.map(l => new Date(l.timestamp).getTime());
      const firstLogTime = Math.min(...dateLogsTimestamps);
      const lastLogTime = Math.max(...dateLogsTimestamps);

      // Buffer 10 minutes before and after
      startTime = Math.max(firstLogTime - 1000 * 60 * 10, 0);
      
      const isToday = new Date(targetLogs[0].timestamp).toDateString() === nowTime.toDateString();
      endTime = isToday 
        ? Math.max(nowTime.getTime(), lastLogTime + 1000 * 60 * 10) 
        : lastLogTime + 1000 * 60 * 10;
    } else {
      // Time range filter relative to NOW (e.g. 15m, 30m, 60m)
      if (timeRangeFilter === '15m') {
        startTime = Math.max(endTime - 15 * 60 * 1000, rawStartTime);
      } else if (timeRangeFilter === '30m') {
        startTime = Math.max(endTime - 30 * 60 * 1000, rawStartTime);
      } else if (timeRangeFilter === '60m') {
        startTime = Math.max(endTime - 60 * 60 * 1000, rawStartTime);
      }
    }

    const totalDurationMs = Math.max(endTime - startTime, 1000 * 60); // Minimum 1 min
    const isMultiDayProject = (rawEndTime - rawStartTime) > 2 * 24 * 60 * 60 * 1000;

    // Width of peak spread in ms (scaled with duration)
    const peakSpreadMs = Math.max(totalDurationMs * 0.025, 1000 * 30);

    // Build activity pulse line points
    const pulsePoints = [];

    // Start at bottom baseline (0 activity)
    pulsePoints.push({ time: startTime, diff: 0 });

    // Include only logs within the visible range (plus slight buffer)
    const visibleLogs = targetLogs.filter(l => {
      const t = new Date(l.timestamp).getTime();
      return t >= startTime - 1000 * 45 && t <= endTime + 1000 * 45;
    });

    visibleLogs.forEach((log) => {
      const logTime = new Date(log.timestamp).getTime();
      const diff = Math.max(log.charDiff !== undefined ? log.charDiff : 0, 0);

      // Pre-spike base point
      const preTime = Math.max(logTime - peakSpreadMs, startTime);
      pulsePoints.push({ time: preTime, diff: 0 });

      // Peak summit point
      pulsePoints.push({ time: logTime, diff: diff > 0 ? diff : 8, log: log });

      // Post-spike base point
      const postTime = Math.min(logTime + peakSpreadMs, endTime);
      pulsePoints.push({ time: postTime, diff: 0 });
    });

    // Trailing base line to NOW (if idle, flat at 0)
    pulsePoints.push({ time: endTime, diff: 0 });

    // Deduplicate and sort chronologically
    pulsePoints.sort((a, b) => a.time - b.time);

    // Convert time & diff to SVG coordinates
    const coordinates = pulsePoints.map((pt) => {
      const xRatio = (pt.time - startTime) / totalDurationMs;
      const x = padding + xRatio * (width - padding * 2);

      const yRatio = Math.min(pt.diff / maxDiff, 1);
      const y = height - padding - yRatio * (height - padding * 2);

      return { x, y, pt };
    });

    let polylineStr = '';
    coordinates.forEach(c => {
      polylineStr += `${c.x},${c.y} `;
    });

    // Closed polygon path string for gradient area under the pulse peaks
    const areaStr = `${padding},${height - padding} ` + polylineStr + ` ${width - padding},${height - padding}`;

    // Generate periodic time or date grid ticks
    const ticks = [];
    if (totalDurationMs > 3 * 24 * 60 * 60 * 1000) {
      // Multi-day ticks (every day or every few days)
      const dayIntervalMs = 24 * 60 * 60 * 1000;
      let curTick = Math.ceil(startTime / dayIntervalMs) * dayIntervalMs;
      while (curTick < endTime) {
        const tickXRatio = (curTick - startTime) / totalDurationMs;
        const tickX = padding + tickXRatio * (width - padding * 2);
        ticks.push({ 
          time: curTick, 
          x: tickX, 
          label: new Date(curTick).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) 
        });
        curTick += dayIntervalMs;
      }
    } else {
      // Sub-day minute ticks (every 5~15 mins)
      const tickIntervalMs = totalDurationMs > 60 * 60 * 1000 
        ? 15 * 60 * 1000 
        : (totalDurationMs > 30 * 60 * 1000 ? 10 * 60 * 1000 : 5 * 60 * 1000);
      
      let curTick = Math.ceil(startTime / tickIntervalMs) * tickIntervalMs;
      while (curTick < endTime) {
        const tickXRatio = (curTick - startTime) / totalDurationMs;
        const tickX = padding + tickXRatio * (width - padding * 2);
        ticks.push({ 
          time: curTick, 
          x: tickX, 
          label: new Date(curTick).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
        });
        curTick += tickIntervalMs;
      }
    }

    const chartSvg = (
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
        <defs>
          <linearGradient id={`pulseGrad_${studentName.replace(/[^a-zA-Z0-9]/g, '_')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Horizontal grid lines */}
        <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="#e2e8f0" strokeDasharray="4" />
        <line x1={padding} y1={(padding + height - padding) / 2} x2={width - padding} y2={(padding + height - padding) / 2} stroke="#f1f5f9" strokeDasharray="4" />
        
        {/* Baseline Y=0 line (Thick slate line representing idle 0 state) */}
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#cbd5e1" strokeWidth="2" />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#cbd5e1" strokeWidth="1.5" />

        {/* Vertical Time/Date Ticks & Grid Lines */}
        {ticks.map((tick, tIdx) => (
          <g key={tIdx}>
            <line x1={tick.x} y1={padding} x2={tick.x} y2={height - padding} stroke="#f1f5f9" strokeWidth="1" strokeDasharray="3,3" />
            <text x={tick.x} y={height - 10} fontSize="8.5" fill="#94a3b8" textAnchor="middle">
              {tick.label}
            </text>
          </g>
        ))}

        {/* 1) Shaded area under activity pulses */}
        <polygon points={areaStr} fill={`url(#pulseGrad_${studentName.replace(/[^a-zA-Z0-9]/g, '_')})`} />

        {/* 2) Real-time Activity Pulse Line */}
        <polyline fill="none" stroke="#16a34a" strokeWidth="2.5" points={polylineStr} strokeLinecap="round" strokeLinejoin="round" />

        {/* 3) Interactive Summit Nodes and Vertical Guides */}
        {visibleLogs.map((log, index) => {
          const logTime = new Date(log.timestamp).getTime();
          if (logTime < startTime || logTime > endTime) return null;

          const xRatio = (logTime - startTime) / totalDurationMs;
          const x = padding + xRatio * (width - padding * 2);
          
          const diff = Math.max(log.charDiff !== undefined ? log.charDiff : 0, 0);
          const yRatio = Math.min((diff > 0 ? diff : 8) / maxDiff, 1);
          const y = height - padding - yRatio * (height - padding * 2);
          
          const isSuspicious = log.copiedText && !log.copiedText.startsWith('[추가]');
          const isSelected = selectedLogTimestamp === log.timestamp;
          
          const formattedTime = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const dateSnippet = new Date(log.timestamp).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
          
          let labelText = '';
          let labelColor = '#475569';
          if (isSuspicious) {
            labelText = `${selectedDate === 'all' && isMultiDayProject ? dateSnippet + ' ' : ''}${formattedTime} (붙여넣기 +${diff}자)`;
            labelColor = '#ef4444';
          } else if (diff > 0) {
            labelText = `${selectedDate === 'all' && isMultiDayProject ? dateSnippet + ' ' : ''}${formattedTime} (+${diff}자)`;
            labelColor = '#16a34a';
          } else {
            labelText = `${selectedDate === 'all' && isMultiDayProject ? dateSnippet + ' ' : ''}${formattedTime} (구조수정)`;
            labelColor = '#0284c7';
          }
          
          return (
            <g 
              key={index} 
              style={{ cursor: onPointClick ? 'pointer' : 'default' }}
              onClick={() => onPointClick && onPointClick(log)}
            >
              {/* Vertical grid line helper down to baseline */}
              <line 
                x1={x} 
                y1={y} 
                x2={x} 
                y2={height - padding} 
                stroke={isSelected ? '#2563eb' : (isSuspicious ? '#fca5a5' : '#cbd5e1')} 
                strokeWidth={isSelected ? 2 : 1} 
                strokeDasharray={isSelected ? 'none' : '2,2'} 
              />

              {/* Summit Circle Node */}
              <circle 
                cx={x} 
                cy={y} 
                r={isSelected ? 6 : (isSuspicious ? 5 : 4)} 
                fill={isSelected ? '#2563eb' : (isSuspicious ? '#ef4444' : '#16a34a')}
                stroke="#ffffff"
                strokeWidth={isSelected ? 2 : 1.5}
              >
                <title>{`[${new Date(log.timestamp).toLocaleString()}] ${isSuspicious ? '외부 텍스트 붙여넣기 의심' : '작업 활동'} (+${diff}자)\n누적 ${log.charCount}자\n클릭하여 상세 내용 확인`}</title>
              </circle>

              {/* Show detailed timestamp + delta label in large mode */}
              {isLarge && labelText && (
                <text 
                  x={x} 
                  y={y - 10} 
                  fontSize="8.5" 
                  fontWeight={isSelected ? '900' : '800'} 
                  fill={isSelected ? '#2563eb' : labelColor} 
                  textAnchor="middle"
                >
                  {labelText}
                </text>
              )}
            </g>
          );
        })}
        
        {/* Axis Labels */}
        <text x={padding} y={height - 4} fontSize="9" fill="#94a3b8">
          시작 ({new Date(startTime).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })} {new Date(startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
        </text>
        <text x={width - padding} y={height - 4} textAnchor="end" fontSize="9" fill="#94a3b8" fontWeight="bold">
          끝 ({new Date(endTime).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })} {new Date(endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
        </text>
        <text x={padding + 5} y={padding + 10} fontSize="9" fill="#94a3b8" fontWeight="bold">
          {selectedDate !== 'all' ? `[${selectedDate}] 당일 활동 펄스` : '순간 활동량 (피크 = 집중 작성 / 바닥 = 정체)'}
        </text>
      </svg>
    );

    return (
      <div style={{ marginTop: '0.5rem', backgroundColor: '#f8fafc', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-card)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem', color: '#64748b', marginBottom: '0.35rem', fontWeight: 800 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            학생 활동 분석 그래프 {selectedDate !== 'all' && <span style={{ color: '#2563eb' }}>({selectedDate} 수업 포커스)</span>}
          </span>
          <span style={{ color: 'var(--brand-green-dark)' }}>최대 작업량 기준: +{maxDiff}자</span>
        </div>
        
        {chartSvg}

        <div style={{ marginTop: '0.45rem', fontSize: '0.72rem', color: '#64748b', lineHeight: '1.45', borderTop: '1px solid #e2e8f0', paddingTop: '0.45rem' }}>
          <strong>안내:</strong> 15~30일 이상 진행된 프로젝트는 상단의 <strong>[활동 일자별 바로가기]</strong>를 클릭하시면 해당 날짜의 수업 활동을 1분 단위로 확대하여 볼 수 있습니다.
        </div>
      </div>
    );
  };

  // Render Competency Analytics Bar Gauges
  const renderCompetencyGauges = (student, keywordList) => {
    const isDisconnected = student.status === 'disconnected' || (student.charCount === 0 && student.slideCount === 0);
    
    const focusScore = isDisconnected ? 0 : (student.focusRatio || 0);
    const coreScore = isDisconnected ? 0 : (keywordList.length > 0 ? Math.round((student.keywordCount / keywordList.length) * 100) : 0);

    const gauges = [
      { label: '⏳ 과제 몰입 지속성', score: focusScore, color: '#16a34a' },
      { label: '🔑 핵심 키워드 성취도', score: coreScore, color: '#f59e0b' }
    ];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }}>
        {gauges.map(g => (
          <div key={g.label} style={{ fontSize: '0.8rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.15rem', fontWeight: 700 }}>
              <span style={{ color: '#475569' }}>{g.label}</span>
              <span style={{ color: g.color }}>{g.score}점</span>
            </div>
            <div style={{ width: '100%', height: '8px', backgroundColor: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ width: `${g.score}%`, height: '100%', backgroundColor: g.color, borderRadius: '4px', transition: 'width 0.5s ease-in-out' }} />
            </div>
          </div>
        ))}

        {/* 역량 산출 가이드 (교사용 참고 기준 안내 - 아코디언 적용) */}
        <details style={{ 
          marginTop: '0.5rem', 
          backgroundColor: '#f8fafc', 
          border: '1px solid var(--border-card)', 
          borderRadius: '8px', 
          padding: '0.5rem 0.75rem', 
          fontSize: '0.7rem', 
          color: 'var(--text-muted)',
          lineHeight: '1.4'
        }}>
          <summary style={{ fontWeight: 800, color: '#475569', cursor: 'pointer', outline: 'none', listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>📊 역량 지표 산출 세부 기준 (클릭하여 펼치기)</span>
            <span style={{ fontSize: '0.65rem', color: 'var(--brand-green-dark)' }}>▼</span>
          </summary>
          <div style={{ marginTop: '0.5rem', borderTop: '1px solid var(--border-card)', paddingTop: '0.5rem' }}>
            • <strong>과제 몰입 지속성:</strong> 전체 모니터링 시간 중 딴짓/정체 없이 슬라이드를 만지고 편집한 시간의 백분율<br />
            • <strong>핵심 키워드 성취도:</strong> 사전 설정된 과제 핵심 키워드 목록 대비 실제 슬라이드 내 언급 비율
          </div>
        </details>
      </div>
    );
  };

  const totalCount = students.length;
  const connectedCount = students.filter(s => s.status !== 'disconnected').length;
  const idleCount = students.filter(s => s.status === 'idle').length;
  const suspiciousCount = students.filter(s => s.status === 'suspicious').length;
  
  const avgChars = totalCount > 0 ? Math.round(students.reduce((acc, s) => acc + s.charCount, 0) / totalCount) : 0;
  const avgSlides = totalCount > 0 ? (students.reduce((acc, s) => acc + s.slideCount, 0) / totalCount).toFixed(1) : '0.0';
  const avgImages = totalCount > 0 ? (students.reduce((acc, s) => acc + s.imageCount, 0) / totalCount).toFixed(1) : '0.0';
  const avgKeywords = totalCount > 0 && keywords.length > 0 
    ? Math.round((students.reduce((acc, s) => acc + s.keywordCount, 0) / (totalCount * keywords.length)) * 100) 
    : 0;

  const filteredStudents = students.filter(student => {
    const matchesSearch = student.name.includes(studentSearch) || (student.number && student.number.toString().includes(studentSearch));
    if (typeFilter === 'all') return matchesSearch;
    return matchesSearch && student.status === typeFilter;
  });

  const priorityAlerts = students.map(student => {
    const reasons = [];
    if (student.status === 'suspicious') {
      reasons.push({ type: 'warning', text: '🔴 복붙 의심 적발' });
    }
    if (student.status === 'idle') {
      const personalLogs = logs.filter(l => l.name === student.name);
      const sortedLogs = [...personalLogs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const totalLogs = sortedLogs.length;
      const lastActive = student.lastActiveAt ? new Date(student.lastActiveAt) : null;
      const idleMinutes = lastActive ? Math.round((new Date() - lastActive) / (1000 * 60)) : 5;
      reasons.push({ type: 'idle', text: `🟡 ${idleMinutes}분째 정체 중` });
    }
    if (keywords.length > 0 && student.charCount >= 100 && student.keywordCount === 0) {
      reasons.push({ type: 'keyword', text: '⚠️ 키워드 누락' });
    }
    if (student.status === 'disconnected') {
      reasons.push({ type: 'disconnected', text: '⚪ 미접속' });
    }
    return { student, reasons };
  }).filter(item => item.reasons.length > 0);

  // Sorting priorities by danger level: suspicious(1) > idle(2) > keyword(3) > disconnected(4)
  const getAlertWeight = (reasons) => {
    if (reasons.some(r => r.type === 'warning')) return 1;
    if (reasons.some(r => r.type === 'idle')) return 2;
    if (reasons.some(r => r.type === 'keyword')) return 3;
    return 4;
  };

  const sortedPriorityAlerts = [...priorityAlerts].sort((a, b) => {
    return getAlertWeight(a.reasons) - getAlertWeight(b.reasons);
  });

  if (sdkStatus === 'loading') {
    return (
      <div style={{ textAlign: 'center', padding: '5rem 0' }}>
        <div style={{ fontSize: '3rem', animation: 'spin 2s linear infinite' }}>⏳</div>
        <h2 style={{ marginTop: '1.5rem', fontWeight: 800 }}>대시보드 불러오는 중...</h2>
      </div>
    );
  }

  if (sdkStatus === 'unauthorized') {
    return (
      <div className="card" style={{ maxWidth: '520px', margin: '5rem auto', textAlign: 'center', padding: '2.5rem 2rem' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔑</div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--brand-green-dark)', margin: '0 0 0.5rem 0' }}>
          구글 계정 인증 필요
        </h2>
        <p style={{ margin: '0 0 1.5rem 0', color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: '1.5' }}>
          {loadErrorMsg || '구글 로그인 인증 토큰이 만료되었거나 연결되지 않았습니다. 아래 버튼을 눌러 다시 로그인하시면 즉시 대시보드가 로드됩니다.'}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '300px', margin: '0 auto' }}>
          <button 
            className="btn-primary" 
            style={{ width: '100%', padding: '0.85rem', fontSize: '0.95rem', fontWeight: 800, border: 'none', borderRadius: '8px', cursor: 'pointer' }}
            onClick={handleReLogin}
            disabled={isLoading}
          >
            {isLoading ? '인증 진행 중...' : '🔑 구글 계정으로 다시 로그인'}
          </button>
          <button 
            className="text-card-btn" 
            style={{ justifyContent: 'center', padding: '0.65rem' }} 
            onClick={() => router.push('/')}
          >
            홈으로 가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', minHeight: '100vh', backgroundColor: 'var(--bg-app)' }}>
      {/* 1. Flush modern top navigation header */}
      <header className="no-print" style={{ 
        width: '100%', 
        backgroundColor: 'var(--bg-card)', 
        borderBottom: '1px solid var(--border-card)', 
        padding: '0.85rem 2rem', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center' 
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
            onClick={() => router.back()}
          >
            ◀ 돌아가기
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
            {classTitle}
          </span>
          {isMonitoringClosed ? (
            <span style={{ 
              fontSize: '0.75rem', 
              fontWeight: 800, 
              backgroundColor: '#f1f5f9', 
              color: '#475569', 
              border: '1px solid #cbd5e1',
              padding: '0.15rem 0.55rem', 
              borderRadius: '4px',
              marginLeft: '0.25rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem'
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              모니터링 종료됨 (기록 열람 모드)
            </span>
          ) : (
            <span style={{ 
              fontSize: '0.75rem', 
              fontWeight: 700, 
              backgroundColor: 'var(--bg-light-green)', 
              color: 'var(--text-light-green)', 
              padding: '0.15rem 0.5rem', 
              borderRadius: '4px',
              marginLeft: '0.25rem'
            }}>
              ● 실시간 감지 중
            </span>
          )}
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          {isMonitoringClosed ? (
            <button 
              className="btn-primary" 
              style={{ 
                fontSize: '0.82rem', 
                padding: '0.45rem 1rem', 
                backgroundColor: 'var(--brand-green-dark)',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontWeight: 800,
                boxShadow: '0 2px 5px rgba(22, 101, 52, 0.25)'
              }} 
              onClick={handleResumeMonitoring}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              모니터링 다시 시작 (라이브 켜기)
            </button>
          ) : (
            <>
              {/* Polling Switch */}
              <div className="green-toggle-wrapper">
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)' }}>실시간 감지</span>
                <div 
                  className={`green-toggle-pill ${isPolling ? 'active' : ''}`}
                  onClick={() => setIsPolling(!isPolling)}
                >
                  <div className="pill-thumb" />
                </div>
                <span className={`switch-state-badge ${isPolling ? 'on' : 'off'}`}>
                  {isPolling ? 'ON' : 'OFF'}
                </span>
              </div>

              <button className="text-card-btn" style={{ fontSize: '0.85rem', padding: '0.45rem 0.85rem' }} onClick={handleManualRefresh} disabled={isLoading}>
                즉시 갱신
              </button>

              <button 
                className="text-card-btn" 
                style={{ 
                  fontSize: '0.82rem', 
                  padding: '0.45rem 0.85rem', 
                  color: '#b91c1c', 
                  borderColor: '#fca5a5', 
                  backgroundColor: '#fff5f5',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontWeight: 800
                }} 
                onClick={handleCloseMonitoring}
                title="실시간 슬라이드 감지를 중단하고 과제를 기록 보관 모드로 전환합니다."
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
                모니터링 종료
              </button>
            </>
          )}

          <button 
            className="btn-primary" 
            style={{ padding: '0.45rem 1rem', fontSize: '0.85rem' }}
            onClick={() => setIsReportMode(!isReportMode)}
          >
            {isReportMode ? (isMonitoringClosed ? '활동 기록 대시보드' : '실시간 대시보드') : '종합 평가 리포트'}
          </button>
        </div>
      </header>

      {/* 1-1. Closed Monitoring Notification Banner Bar */}
      {isMonitoringClosed && (
        <div className="no-print" style={{
          backgroundColor: '#f8fafc',
          borderBottom: '1px solid #cbd5e1',
          padding: '0.65rem 2rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.85rem',
          color: '#334155',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ 
              display: 'inline-flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              backgroundColor: '#e2e8f0', 
              color: '#475569', 
              width: '24px', 
              height: '24px', 
              borderRadius: '50%' 
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </span>
            <span>
              <strong>수업 과제 모니터링이 종료되었습니다.</strong> 실시간 감지가 멈춘 <u>기록 보관 및 열람 모드</u>입니다.
            </span>
          </div>
          <button
            type="button"
            className="btn-primary"
            style={{ padding: '0.3rem 0.85rem', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            onClick={handleResumeMonitoring}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            모니터링 다시 시작
          </button>
        </div>
      )}

      {/* 2. Main Dashboard Panel (Starts from top, aligned cleanly) */}
      {!isReportMode ? (
        <main className="dashboard-layout">
          {/* LEFT COLUMN: Overview, QR joining, Alerts Feed */}
          <div className="dashboard-sidebar no-print">
            <div className="sidebar-panel">
              {/* Class summary */}
              <div>
                <h3 style={{ fontWeight: 800, fontSize: '1.05rem', color: '#475569', marginBottom: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  {isMonitoringClosed ? '학급 최종 활동 요약' : '학급 실시간 활동 요약'}
                  {isMonitoringClosed && (
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, backgroundColor: '#f1f5f9', color: '#64748b', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                      기록 보관
                    </span>
                  )}
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                    <span>접속 인원</span>
                    <span style={{ fontWeight: 700 }}>{connectedCount} / {totalCount}명</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                    <span>학급 평균 글자 수</span>
                    <span style={{ fontWeight: 700 }}>{avgChars}자</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                    <span>평균 슬라이드 장수</span>
                    <span style={{ fontWeight: 700 }}>{avgSlides}장</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                    <span>평균 이미지 수</span>
                    <span style={{ fontWeight: 700 }}>{avgImages}개</span>
                  </div>
                  {keywords.length > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                      <span>핵심 키워드 도달률</span>
                      <span style={{ fontWeight: 700, color: 'var(--brand-green-dark)' }}>{avgKeywords}%</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 🔑 핵심 키워드 실시간 관리 */}
              <div style={{ borderTop: '1px solid var(--border-card)', paddingTop: '1.25rem' }}>
                <h3 style={{ fontWeight: 800, fontSize: '1.05rem', color: '#475569', marginBottom: '0.85rem' }}>
                  🔑 탐구 핵심 키워드 관리
                </h3>
                
                {/* 키워드 칩 목록 */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.75rem' }}>
                  {keywords.length === 0 ? (
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>등록된 핵심 키워드가 없습니다.</span>
                  ) : (
                    keywords.map(kw => (
                      <span 
                        key={kw} 
                        style={{
                          fontSize: '0.75rem',
                          fontWeight: 800,
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          border: '1px solid var(--border-light-green)',
                          backgroundColor: 'var(--bg-light-green)',
                          color: 'var(--text-light-green)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem'
                        }}
                      >
                        {kw}
                        <button 
                          onClick={() => handleRemoveKeyword(kw)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--text-light-green)',
                            fontWeight: '900',
                            cursor: 'pointer',
                            fontSize: '0.8rem',
                            padding: '0 2px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                          title="키워드 삭제"
                        >
                          ×
                        </button>
                      </span>
                    ))
                  )}
                </div>

                {/* 키워드 입력 폼 */}
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  <input 
                    type="text" 
                    placeholder="새 키워드 입력"
                    value={newKeywordInput}
                    onChange={(e) => setNewKeywordInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddKeyword();
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: '0.35rem 0.5rem',
                      fontSize: '0.8rem',
                      border: '1px solid var(--border-card)',
                      borderRadius: '6px',
                      outline: 'none'
                    }}
                  />
                  <button 
                    onClick={handleAddKeyword}
                    style={{
                      padding: '0.35rem 0.75rem',
                      fontSize: '0.8rem',
                      fontWeight: 800,
                      backgroundColor: 'var(--brand-green-dark)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer'
                    }}
                  >
                    추가
                  </button>
                </div>
              </div>

              {/* Priority Alerts Feed (AI live warning chips list - sorted by risk level) */}
              <div style={{ borderTop: '1px solid var(--border-card)', paddingTop: '1.25rem' }}>
                <h3 style={{ fontWeight: 800, fontSize: '1.05rem', color: '#b91c1c', marginBottom: '0.85rem' }}>
                  🚨 우선 피드백/지도 대상 ({sortedPriorityAlerts.length}명)
                </h3>
                {sortedPriorityAlerts.length === 0 ? (
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem 0' }}>
                    현재 모든 학생이 원활하게 탐구에 참여하고 있습니다.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxHeight: '320px', overflowY: 'auto', paddingRight: '0.25rem' }}>
                    {sortedPriorityAlerts.map(item => (
                      <div 
                        key={item.student.name}
                        className="card"
                        style={{ 
                          padding: '0.65rem 0.85rem', 
                          borderLeft: `4px solid ${item.student.status === 'suspicious' ? '#ef4444' : (item.student.status === 'idle' ? '#f59e0b' : '#64748b')}`,
                          backgroundColor: '#fff8f8',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.35rem',
                          transition: 'transform 0.15s ease'
                        }}
                        onClick={() => {
                          setActiveStudent(item.student);
                          setTeacherFeedback(item.student.teacherFeedback || '');
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <strong style={{ fontSize: '0.85rem', color: '#1e293b' }}>
                            {item.student.number ? `${item.student.number}번 ` : ''}{item.student.name}
                          </strong>
                          <span style={{ fontSize: '0.7rem', color: 'var(--brand-green-dark)', fontWeight: 800 }}>지도하기 ➔</span>
                        </div>
                        
                        {/* 현상황 사유 배지들 */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                          {item.reasons.map((r, i) => (
                            <span 
                              key={i} 
                              style={{ 
                                fontSize: '0.68rem', 
                                fontWeight: 800, 
                                backgroundColor: r.type === 'warning' ? '#fef2f2' : (r.type === 'idle' ? '#fffbeb' : '#f1f5f9'), 
                                color: r.type === 'warning' ? '#ef4444' : (r.type === 'idle' ? '#b45309' : '#475569'), 
                                padding: '0.1rem 0.35rem', 
                                borderRadius: '4px' 
                              }}
                            >
                              {r.text}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Student join Access Code, Link Copier & QR Downloader */}
              <div style={{ borderTop: '1px solid var(--border-card)', paddingTop: '1.25rem' }}>
                <h3 style={{ fontWeight: 900, fontSize: '1rem', color: '#334155', marginBottom: '0.35rem', textAlign: 'center' }}>
                  📱 학생 과제 접속 안내
                </h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1rem', textAlign: 'center', lineHeight: '1.4' }}>
                  학생은 링크나 QR로 들어와 4자리 접속 코드를 입력한 후 본인 슬라이드를 받습니다.
                </p>
                
                {/* 1. 🔑 학생 4자리 접속 코드 */}
                <div style={{ backgroundColor: '#f8fafc', border: '1px solid var(--border-card)', borderRadius: '10px', padding: '0.75rem', marginBottom: '0.75rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#64748b', marginBottom: '0.2rem' }}>
                    🔑 칠판 안내용 4자리 접속 코드
                  </div>
                  <div style={{ 
                    fontSize: '1.6rem', 
                    fontWeight: 950, 
                    color: 'var(--brand-green-dark)', 
                    letterSpacing: '3px',
                    fontFamily: 'monospace'
                  }}>
                    {generateNumericCode(spreadsheetId)}
                  </div>
                </div>

                {/* 2. 🔗 링크 복사 위젯 */}
                <div style={{ backgroundColor: '#f8fafc', border: '1px solid var(--border-card)', borderRadius: '10px', padding: '0.75rem', marginBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#64748b' }}>🔗 접속 링크</span>
                    <button
                      onClick={handleCopyJoinLink}
                      style={{
                        padding: '0.25rem 0.55rem',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        backgroundColor: copiedLinkSuccess ? '#16a34a' : 'var(--brand-green-dark)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        transition: 'background-color 0.2s',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.25rem'
                      }}
                    >
                      {copiedLinkSuccess ? '✅ 복사 완료!' : '📋 링크 복사'}
                    </button>
                  </div>
                  <div style={{ 
                    wordBreak: 'break-all', 
                    fontSize: '0.7rem', 
                    color: '#475569', 
                    backgroundColor: 'white', 
                    padding: '0.4rem 0.5rem', 
                    borderRadius: '6px', 
                    border: '1px solid #e2e8f0',
                    fontFamily: 'monospace'
                  }}>
                    {studentJoinUrl}
                  </div>
                </div>

                {/* 3. 📱 QR코드 다운로드 / 뷰어 */}
                {studentJoinUrl && (
                  <div style={{ textAlign: 'center' }}>
                    <a 
                      href={`https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(studentJoinUrl)}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      download="student_join_qr.png"
                      className="text-card-btn" 
                      style={{ 
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.35rem',
                        padding: '0.55rem 0.85rem', 
                        fontSize: '0.78rem', 
                        width: '100%',
                        textDecoration: 'none',
                        fontWeight: 800,
                        backgroundColor: 'white',
                        color: 'var(--brand-green-dark)',
                        border: '1.5px solid var(--border-light-green)',
                        borderRadius: '8px',
                        transition: 'all 0.2s'
                      }}
                    >
                      📷 학생용 QR코드 다운받기 / 크게보기
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Grid list of students */}
          <div className="dashboard-main">
            {isAutoPaused && (
              <div className="no-print" style={{ 
                backgroundColor: '#fffbeb', 
                border: '1px solid #f59e0b', 
                color: '#b45309', 
                padding: '0.65rem 1.25rem', 
                borderRadius: '8px', 
                marginBottom: '0.5rem', 
                textAlign: 'center', 
                fontSize: '0.82rem',
                fontWeight: 800
              }}>
                💤 40분간 미조작으로 인해 [실시간 감지 절전 모드]가 가동되었습니다. 화면을 클릭하거나 마우스를 흔들면 감지가 재개됩니다.
              </div>
            )}

            {/* Status Legend Bar */}
            <div className="card no-print" style={{ 
              padding: '0.65rem 1.25rem', 
              marginBottom: '0.5rem', 
              display: 'flex', 
              flexWrap: 'wrap',
              alignItems: 'center', 
              justifyContent: 'space-between',
              gap: '1rem', 
              backgroundColor: isMonitoringClosed ? '#f8fafc' : '#f8fafc',
              border: `1px solid ${isMonitoringClosed ? '#cbd5e1' : 'var(--border-card)'}`
            }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1.25rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-muted)' }}>
                  {isMonitoringClosed ? '🔒 최종 상태 기록:' : '상태 가이드:'}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
                  <span className="status-dot active" style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#22c55e' }}></span>
                  <strong>활동 완료</strong>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
                  <span className="status-dot idle" style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#eab308' }}></span>
                  <strong>정체 기록</strong>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
                  <span className="status-dot suspicious" style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#ef4444' }}></span>
                  <strong>복붙 감지</strong>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
                  <span className="status-dot disconnected" style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#cbd5e1' }}></span>
                  <strong>미진입</strong>
                </div>
              </div>

              {isMonitoringClosed && (
                <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b' }}>
                  ※ 실시간 감지 정지됨 (학생 카드를 클릭하여 상세 활동 그래프 및 리포트를 조회할 수 있습니다)
                </span>
              )}
            </div>


            {/* Filter Tool controls */}
            <div className="card no-print" style={{ padding: '0.85rem 1.25rem', marginBottom: '1rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-muted)' }}>필터:</span>
                {['all', 'active', 'idle', 'suspicious', 'disconnected'].map(type => (
                  <button 
                    key={type}
                    onClick={() => setTypeFilter(type)}
                    className="text-card-btn"
                    style={{ 
                      fontSize: '0.8rem', 
                      padding: '0.35rem 0.75rem', 
                      backgroundColor: typeFilter === type ? 'var(--brand-green-dark)' : '', 
                      color: typeFilter === type ? 'white' : ''
                    }}
                  >
                    {type === 'all' && '전체'}
                    {type === 'active' && '활동'}
                    {type === 'idle' && '정체'}
                    {type === 'suspicious' && '의심'}
                    {type === 'disconnected' && '미진입'}
                  </button>
                ))}
              </div>

              <div>
                <input 
                  type="text" 
                  className="horizontal-form-input" 
                  placeholder="이름 또는 번호 검색"
                  style={{ padding: '0.4rem 0.85rem', width: '200px', fontSize: '0.85rem' }}
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                />
              </div>
            </div>

            {/* Students 바둑판 그리드 */}
            {isLoading ? (
              <div className="card" style={{ padding: '4rem 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                데이터 동기화 및 갱신 중...
              </div>
            ) : filteredStudents.length === 0 ? (
              <div className="card" style={{ padding: '4rem 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                필터 조건에 부합하는 학생이 없습니다.
              </div>
            ) : (
              <div className="tv-presentation-grid">
                {filteredStudents.map(student => (
                  <div 
                    key={student.name}
                    className={`student-card ${student.status}`}
                    onClick={() => {
                      setActiveStudent(student);
                      setTeacherFeedback(student.teacherFeedback || '');
                    }}
                  >
                    <span className="student-number-badge">
                      {student.number ? `${student.number}번` : '이름'}
                    </span>
                    <h3 className="student-name">{student.name}</h3>
                    
                    <div className="student-stats-row">
                      <span>{student.slideCount}장</span>
                      <span>{student.charCount}자</span>
                      <span>이미지 {student.imageCount}개</span>
                    </div>

                    <div className="status-indicator-icon">
                      <span className={`status-dot ${student.status}`} />
                    </div>

                    {student.focusRatio < 60 && student.status !== 'disconnected' && (
                      <span style={{ fontSize: '0.75rem', color: '#b45309', fontWeight: 700, backgroundColor: '#fef3c7', padding: '0.1rem 0.35rem', borderRadius: '4px', marginTop: '0.4rem' }}>
                        집중도: {student.focusRatio}%
                      </span>
                    )}

                    {/* AI 실시간 학습 행동 진단 요약 배지 */}
                    {(() => {
                      const diag = diagnoseStudentBehavior(student, logs.filter(l => l.name === student.name), keywords);
                      return (
                        <div style={{ 
                          fontSize: '0.7rem', 
                          fontWeight: 800, 
                          color: diag.color, 
                          backgroundColor: diag.bgColor, 
                          border: `1px solid ${diag.borderColor}`, 
                          padding: '0.2rem 0.45rem', 
                          borderRadius: '4px',
                          marginTop: '0.45rem',
                          textAlign: 'center',
                          width: '100%',
                          boxSizing: 'border-box',
                          textOverflow: 'ellipsis',
                          overflow: 'hidden',
                          whiteSpace: 'nowrap'
                        }} title={diag.badge}>
                          {diag.badge}
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      ) : (
        /* 3. Report View Mode */
        <main style={{ maxWidth: '1100px', margin: '0 auto', padding: '2.5rem 1.5rem' }}>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid var(--border-card)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--brand-green-dark)' }}>
                {classTitle} 과정 중심 평가 종합 리포트
              </h2>
              <button 
                className="text-card-btn no-print" 
                onClick={() => window.print()}
              >
                리포트 인쇄하기
              </button>
            </div>
            
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              본 리포트는 수업 중 실시간으로 수집된 활동량(글자 수, 슬라이드 다양성, 표현 이미지 수, 키워드 달성도, 정체 시간)에 기반하여 작성된 객관적 과정 평가 참고 자료입니다.
            </p>

            {/* Table 일람표 */}
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-card)', backgroundColor: '#f8fafc' }}>
                  <th style={{ padding: '0.75rem' }}>번호</th>
                  <th style={{ padding: '0.75rem' }}>성명</th>
                  <th style={{ padding: '0.75rem' }}>최종 글자 수</th>
                  <th style={{ padding: '0.75rem' }}>작성 장수 (빈 장수)</th>
                  <th style={{ padding: '0.75rem' }}>이미지 수</th>
                  <th style={{ padding: '0.75rem' }}>키워드 도달률</th>
                  <th style={{ padding: '0.75rem' }}>집중도</th>
                  <th style={{ padding: '0.75rem' }}>과정 참여 유형</th>
                  <th style={{ padding: '0.75rem' }} className="no-print">교사 의견</th>
                </tr>
              </thead>
              <tbody>
                {students.map(student => {
                  const profile = getStudentProfile(student, logs);
                  return (
                    <tr key={student.name} style={{ borderBottom: '1px solid var(--border-card)' }}>
                      <td style={{ padding: '0.75rem', fontWeight: 700 }}>{student.number || '-'}</td>
                      <td style={{ padding: '0.75rem', fontWeight: 800 }}>{student.name}</td>
                      <td style={{ padding: '0.75rem' }}>{student.charCount}자</td>
                      <td style={{ padding: '0.75rem' }}>
                        {student.slideCount}장 {student.blankSlideCount > 0 ? `(${student.blankSlideCount}장 빈 슬라이드)` : ''}
                      </td>
                      <td style={{ padding: '0.75rem' }}>{student.imageCount}개</td>
                      <td style={{ padding: '0.75rem' }}>
                        {keywords.length > 0 ? `${student.keywordCount} / ${keywords.length} (${Math.round((student.keywordCount/keywords.length)*100)}%)` : '-'}
                      </td>
                      <td style={{ padding: '0.75rem', color: student.focusRatio < 60 ? '#b45309' : 'inherit' }}>
                        {student.focusRatio}%
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        <span style={{ 
                          backgroundColor: `${profile.color}15`, 
                          color: profile.color, 
                          padding: '0.2rem 0.5rem', 
                          borderRadius: '4px',
                          fontWeight: 700,
                          fontSize: '0.8rem'
                        }}>
                          {profile.label}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem', color: 'var(--text-muted)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} className="no-print">
                        {student.teacherFeedback || '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </main>
      )}

      {/* 4. Student Individual Detail Modal (Side drawer) */}
      {activeStudent && (() => {
        // 편차 배지 산출 헬퍼 함수
        const renderDeviationBadge = (diff, unit) => {
          const isPositive = diff > 0;
          const isZero = diff === 0;
          const absDiff = Math.abs(Number(diff));
          
          let text = '';
          if (isZero) text = `평균 수준`;
          else text = `${isPositive ? '▲' : '▼'} ${isPositive ? '+' : '-'}${absDiff.toFixed(unit === '자' ? 0 : 1)}${unit}`;
          
          let color = '#64748b';
          let bgColor = '#f1f5f9';
          if (!isZero) {
            color = isPositive ? '#16a34a' : '#dc2626';
            bgColor = isPositive ? '#f0fdf4' : '#fef2f2';
          }

          return (
            <span style={{ 
              display: 'inline-block', 
              fontSize: '0.65rem', 
              fontWeight: 800, 
              color: color, 
              backgroundColor: bgColor, 
              padding: '0.12rem 0.35rem', 
              borderRadius: '4px',
              marginTop: '0.25rem'
            }}>
              {text}
            </span>
          );
        };

        return (
          <div className="custom-modal-backdrop" onClick={() => setActiveStudent(null)}>
            <div 
              className="custom-modal-content" 
              style={{ 
                position: 'fixed', 
                right: 0, 
                top: 0, 
                height: '100vh', 
                borderRadius: 0, 
                maxWidth: '460px', 
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                padding: '1.5rem',
                justifyContent: 'space-between',
                animation: 'slideIn 0.25s ease-out'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header (Fixed at top) */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-card)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
                <h2 style={{ fontSize: '1.3rem', fontWeight: 800, margin: 0 }}>
                  {activeStudent.number ? activeStudent.number + '번 ' : ''}{activeStudent.name} 상세 정보
                </h2>
                <button className="text-card-btn" style={{ padding: '0.25rem 0.5rem' }} onClick={() => setActiveStudent(null)}>
                  닫기
                </button>
              </div>

              {/* Scrollable Content Body */}
              <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.35rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                
                {/* Status & Connection indicators */}
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span className={`switch-state-badge ${activeStudent.status === 'active' ? 'on' : 'off'}`} style={{ 
                    backgroundColor: activeStudent.status === 'suspicious' ? '#fef2f2' : (activeStudent.status === 'idle' ? '#fffbeb' : ''),
                    color: activeStudent.status === 'suspicious' ? '#ef4444' : (activeStudent.status === 'idle' ? '#b45309' : ''),
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem'
                  }}>
                    <span className={`status-dot ${activeStudent.status}`} style={{ width: '8px', height: '8px' }} />
                    {activeStudent.status === 'active' && '정상 탐구 중'}
                    {activeStudent.status === 'idle' && '5분 이상 작성 없음'}
                    {activeStudent.status === 'suspicious' && '단시간 복붙 감지'}
                    {activeStudent.status === 'disconnected' && '접속 대기 중'}
                  </span>

                  <span style={{ fontSize: '0.8rem', backgroundColor: '#f1f5f9', color: '#475569', padding: '0.15rem 0.5rem', borderRadius: '4px', fontWeight: 700 }}>
                    집중도: {activeStudent.focusRatio}%
                  </span>
                </div>

                {/* AI 다면적 학습 행동/심리 진단 카드 */}
                {(() => {
                  const diag = diagnoseStudentBehavior(activeStudent, logs.filter(l => l.name === activeStudent.name), keywords);
                  return (
                    <div style={{ 
                      backgroundColor: diag.bgColor, 
                      border: `1px solid ${diag.borderColor}`, 
                      padding: '0.85rem 1rem', 
                      borderRadius: '8px'
                    }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.25rem' }}>실시간 AI 학습 행동 진단</div>
                      <div style={{ fontWeight: 900, color: diag.color, fontSize: '1.1rem', margin: '0.15rem 0' }}>
                        {diag.badge}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#475569', lineHeight: '1.4', marginTop: '0.25rem' }}>
                        {diag.desc}
                      </div>
                    </div>
                  );
                })()}

                {/* 과정중심 탐구 역량 지표 */}
                <div className="card" style={{ padding: '0.85rem 1rem', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, borderBottom: '1px solid var(--border-card)', paddingBottom: '0.35rem', marginBottom: '0.5rem' }}>
                    📊 과정중심 탐구 역량 지표
                  </div>
                  {renderCompetencyGauges(activeStudent, keywords)}
                </div>

                {/* Key stats layout with Relative Deviation Badges */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                  <div className="card" style={{ padding: '0.65rem 0.35rem', textAlign: 'center', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>글자 수</div>
                    <strong style={{ fontSize: '1.1rem', margin: '0.15rem 0' }}>{activeStudent.charCount}자</strong>
                    {renderDeviationBadge(activeStudent.charCount - avgChars, '자')}
                  </div>
                  <div className="card" style={{ padding: '0.65rem 0.35rem', textAlign: 'center', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>슬라이드</div>
                    <strong style={{ fontSize: '1.1rem', margin: '0.15rem 0' }}>{activeStudent.slideCount}장</strong>
                    {renderDeviationBadge(activeStudent.slideCount - Number(avgSlides), '장')}
                    {activeStudent.blankSlideCount > 0 && (
                      <div style={{ fontSize: '0.6rem', color: '#ef4444', marginTop: '0.15rem' }}>({activeStudent.blankSlideCount}장 빈 슬라이드)</div>
                    )}
                  </div>
                  <div className="card" style={{ padding: '0.65rem 0.35rem', textAlign: 'center', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>이미지</div>
                    <strong style={{ fontSize: '1.1rem', margin: '0.15rem 0' }}>{activeStudent.imageCount}개</strong>
                    {renderDeviationBadge(activeStudent.imageCount - Number(avgImages), '개')}
                  </div>
                </div>

                {/* SVG Student Activity Analysis Chart */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <h4 style={{ fontWeight: 800, fontSize: '0.9rem', color: '#475569', margin: 0 }}>
                      📊 학생 활동 분석 그래프
                    </h4>
                    <button 
                      onClick={() => {
                        setChartSelectedDate('all');
                        setChartTimeFilter('all');
                        setSelectedPoint(null);
                        setShowChartModal(true);
                      }}
                      style={{ 
                        fontSize: '0.7rem', 
                        fontWeight: 800, 
                        color: 'var(--brand-green-dark)', 
                        backgroundColor: 'var(--bg-light-green)', 
                        border: '1px solid var(--border-light-green)', 
                        borderRadius: '4px', 
                        padding: '0.15rem 0.45rem', 
                        cursor: 'pointer' 
                      }}
                    >
                      🔍 크게 보기
                    </button>
                  </div>
                  {/* Drawer Date Selector Chips */}
                  {(() => {
                    const personalLogs = logs.filter(l => l.name === activeStudent.name);
                    const dateGroupMap = {};
                    personalLogs.forEach(log => {
                      const dStr = new Date(log.timestamp).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short' });
                      if (!dateGroupMap[dStr]) dateGroupMap[dStr] = [];
                      dateGroupMap[dStr].push(log);
                    });
                    const activeDateKeys = Object.keys(dateGroupMap);
                    if (activeDateKeys.length <= 1) return null;

                    return (
                      <div style={{ display: 'flex', gap: '0.25rem', overflowX: 'auto', paddingBottom: '0.35rem', marginBottom: '0.35rem' }}>
                        <button
                          type="button"
                          onClick={() => setChartSelectedDate('all')}
                          style={{
                            padding: '0.15rem 0.45rem',
                            fontSize: '0.68rem',
                            fontWeight: chartSelectedDate === 'all' ? 800 : 600,
                            backgroundColor: chartSelectedDate === 'all' ? 'var(--brand-green-dark)' : 'white',
                            color: chartSelectedDate === 'all' ? 'white' : '#475569',
                            border: '1px solid #cbd5e1',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          전체 ({activeDateKeys.length}일)
                        </button>
                        {activeDateKeys.map(dKey => (
                          <button
                            type="button"
                            key={dKey}
                            onClick={() => setChartSelectedDate(dKey)}
                            style={{
                              padding: '0.15rem 0.45rem',
                              fontSize: '0.68rem',
                              fontWeight: chartSelectedDate === dKey ? 800 : 600,
                              backgroundColor: chartSelectedDate === dKey ? '#2563eb' : 'white',
                              color: chartSelectedDate === dKey ? 'white' : '#1e293b',
                              border: `1px solid ${chartSelectedDate === dKey ? '#2563eb' : '#cbd5e1'}`,
                              borderRadius: '4px',
                              cursor: 'pointer',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {dKey}
                          </button>
                        ))}
                      </div>
                    );
                  })()}

                  {renderSVGChart(activeStudent.name, false, null, null, 'all', chartSelectedDate, setChartSelectedDate)}
                </div>

                {/* Target Keywords tracking checklist */}
                {keywords.length > 0 && (
                  <div>
                    <h4 style={{ fontWeight: 800, fontSize: '0.9rem', color: '#475569', margin: '0 0 0.5rem 0' }}>
                      핵심 키워드 도달 현황 ({activeStudent.keywordCount}개 / {keywords.length}개 완료)
                    </h4>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                      {keywords.map(kw => {
                        const isUsed = activeStudent.keywordsUsed.includes(kw);
                        return (
                          <span 
                            key={kw} 
                            style={{
                              fontSize: '0.72rem',
                              fontWeight: 800,
                              padding: '0.2rem 0.5rem',
                              borderRadius: '4px',
                              border: `1px solid ${isUsed ? 'var(--border-light-green)' : '#cbd5e1'}`,
                              backgroundColor: isUsed ? 'var(--bg-light-green)' : '#f1f5f9',
                              color: isUsed ? 'var(--text-light-green)' : '#94a3b8'
                            }}
                          >
                            {kw}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Copy-Paste Log Timeline */}
                {logs.filter(l => l.name === activeStudent.name && l.copiedText).length > 0 && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <h4 style={{ fontWeight: 800, fontSize: '0.9rem', color: '#ef4444', margin: 0, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        ⚠️ 감지된 붙여넣기(복붙) 내역
                      </h4>
                      <button 
                        onClick={() => setShowCopyPasteModal(true)}
                        style={{ 
                          fontSize: '0.7rem', 
                          fontWeight: 800, 
                          color: '#ef4444', 
                          backgroundColor: '#fef2f2', 
                          border: '1px solid #fee2e2', 
                          borderRadius: '4px', 
                          padding: '0.15rem 0.45rem', 
                          cursor: 'pointer' 
                        }}
                      >
                        🔍 크게 보기
                      </button>
                    </div>
                    <div style={{ 
                      maxHeight: '120px', 
                      overflowY: 'auto', 
                      border: '1px solid #fecaca', 
                      borderRadius: '8px', 
                      padding: '0.65rem', 
                      backgroundColor: '#fff5f5',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.5rem'
                    }}>
                      {logs
                        .filter(l => l.name === activeStudent.name && l.copiedText)
                        .map((log, index) => (
                          <div key={index} style={{ fontSize: '0.75rem', borderBottom: '1px solid #fee2e2', paddingBottom: '0.35rem' }}>
                            <div style={{ color: '#b91c1c', fontWeight: 800, marginBottom: '0.15rem' }}>
                              [{new Date(log.timestamp).toLocaleTimeString()}] 감지된 텍스트:
                            </div>
                            <div style={{ 
                              fontFamily: 'monospace', 
                              color: '#374151', 
                              backgroundColor: 'white', 
                              padding: '0.35rem 0.5rem', 
                              borderRadius: '4px',
                              border: '1px solid #fecaca',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-all'
                            }}>
                              {log.copiedText}
                            </div>
                          </div>
                        ))
                      }
                    </div>
                  </div>
                )}

                {/* 실시간 상세 활동 기록 타임라인 (최신순 정렬) */}
                <div style={{ marginTop: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <h4 style={{ fontWeight: 800, fontSize: '0.9rem', color: '#475569', margin: 0 }}>
                      ⏳ 실시간 상세 활동 기록 (최신순)
                    </h4>
                    <button 
                      onClick={() => setShowTimelineModal(true)}
                      style={{ 
                        fontSize: '0.7rem', 
                        fontWeight: 800, 
                        color: 'var(--brand-green-dark)', 
                        backgroundColor: 'var(--bg-light-green)', 
                        border: '1px solid var(--border-light-green)', 
                        borderRadius: '4px', 
                        padding: '0.15rem 0.45rem', 
                        cursor: 'pointer' 
                      }}
                    >
                      🔍 크게 보기
                    </button>
                  </div>
                  {(() => {
                    const studentLogs = logs
                      .filter(l => l.name === activeStudent.name)
                      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

                    if (studentLogs.length === 0) {
                      return <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>수집된 실시간 활동 로그가 아직 없습니다.</div>;
                    }

                    return (
                      <div style={{ 
                        maxHeight: '150px', 
                        overflowY: 'auto', 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: '0.45rem',
                        paddingRight: '0.2rem',
                        fontSize: '0.75rem'
                      }}>
                        {studentLogs.map((log, index) => {
                          const timeStr = new Date(log.timestamp).toLocaleTimeString();
                          
                          // Parse differential text if fused into copiedText
                          let isCopied = false;
                          let displaySnippet = '';
                          
                          if (log.copiedText) {
                            if (log.copiedText.startsWith('[추가]')) {
                              displaySnippet = log.copiedText.replace('[추가]', '').trim();
                            } else {
                              isCopied = true;
                              displaySnippet = log.copiedText;
                            }
                          }

                          // Calculate char diff from the log item (or fallback)
                          const diff = log.charDiff !== undefined ? log.charDiff : 0;
                          const diffSign = diff > 0 ? `+${diff}` : `${diff}`;
                          const diffColor = diff > 0 ? '#16a34a' : (diff < 0 ? '#ef4444' : '#64748b');

                          return (
                            <div key={index} style={{ padding: '0.45rem 0.65rem', backgroundColor: '#f8fafc', border: '1px solid var(--border-card)', borderRadius: '6px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: '#475569', marginBottom: '0.15rem' }}>
                                <span>{timeStr}</span>
                                <span style={{ color: diffColor }}>
                                  {diff !== 0 ? `✍️ ${diffSign}자` : '변화 없음'} ({log.charCount}자)
                                </span>
                              </div>
                              <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', wordBreak: 'break-all' }}>
                                {isCopied ? (
                                  <span style={{ color: '#ef4444', fontWeight: 800 }}>⚠️ 복붙 의심 적발 ({diffSign}자 급증)</span>
                                ) : (
                                  displaySnippet ? (
                                    <span style={{ fontStyle: 'italic', color: '#475569' }}>"{displaySnippet}"</span>
                                  ) : (
                                    <span>슬라이드 개조 및 레이아웃 수정 감지</span>
                                  )
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Fixed Bottom Action Panel */}
              <div style={{ borderTop: '1px solid var(--border-card)', paddingTop: '1rem', marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', backgroundColor: 'white' }}>
                <div>
                  <label style={{ fontWeight: 800, fontSize: '0.85rem', color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                    교사 피드백 메모 (구글 시트에 동기화됨)
                  </label>
                  <textarea 
                    className="horizontal-form-input" 
                    rows={2} 
                    placeholder="학생에게 제공할 피드백이나 나이스 생활기록부 기재 요약본을 작성하세요."
                    style={{ width: '100%', resize: 'none', fontSize: '0.82rem', padding: '0.5rem' }}
                    value={teacherFeedback}
                    onChange={(e) => setTeacherFeedback(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.35rem' }}>
                    <button 
                      className="btn-primary" 
                      style={{ flex: 1, padding: '0.45rem', fontSize: '0.82rem', border: 'none', cursor: 'pointer' }}
                      onClick={handleSaveFeedback}
                      disabled={isLoading}
                    >
                      피드백 저장
                    </button>
                    <a 
                      href={activeStudent.slideUrl} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="text-card-btn"
                      style={{ 
                        flex: 1,
                        justifyContent: 'center', 
                        backgroundColor: '#fee2e2', 
                        color: '#b91c1c', 
                        borderColor: '#fca5a5',
                        fontSize: '0.82rem',
                        padding: '0.45rem'
                      }}
                    >
                      슬라이드 열기 ➔
                    </a>
                  </div>
                </div>
              </div>

            </div>
          </div>
        );
      })()}

      {/* 1) 복붙 내역 상세 확대 모달 */}
      {showCopyPasteModal && activeStudent && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 3000, padding: '1rem'
        }} onClick={() => setShowCopyPasteModal(false)}>
          <div style={{
            backgroundColor: 'white', borderRadius: '12px', padding: '1.5rem 2rem',
            width: '90%', maxWidth: '750px', maxHeight: '80vh', overflowY: 'auto',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', position: 'relative'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-card)', paddingBottom: '0.75rem', marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 900, color: '#b91c1c', display: 'flex', alignItems: 'center', gap: '0.35rem', margin: 0 }}>
                ⚠️ [{activeStudent.name}] 학생 감지된 붙여넣기(복붙) 전체 내역
              </h2>
              <button onClick={() => setShowCopyPasteModal(false)} style={{ border: 'none', background: 'none', fontSize: '1.5rem', fontWeight: 700, cursor: 'pointer', color: '#94a3b8' }}>&times;</button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {logs.filter(l => l.name === activeStudent.name && l.copiedText && !l.copiedText.startsWith('[추가]')).length === 0 ? (
                <div style={{ textAlign: 'center', color: '#64748b', padding: '3rem 0' }}>복붙 의심 적발 내역이 없습니다.</div>
              ) : (
                logs.filter(l => l.name === activeStudent.name && l.copiedText && !l.copiedText.startsWith('[추가]')).map((log, index) => (
                  <div key={index} style={{ padding: '1rem', backgroundColor: '#fff8f8', border: '1px solid #fee2e2', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, color: '#b91c1c', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                      <span>⏰ 감지 시간: {new Date(log.timestamp).toLocaleString()}</span>
                      <span>글자 수: {log.charCount}자</span>
                    </div>
                    <div style={{ 
                      fontFamily: 'monospace', fontSize: '0.82rem', color: '#334155',
                      backgroundColor: 'white', padding: '0.75rem 1rem', borderRadius: '6px',
                      border: '1px solid #fee2e2', whiteSpace: 'pre-wrap', maxHeight: '200px', overflowY: 'auto',
                      lineHeight: '1.5', wordBreak: 'break-all'
                    }}>
                      {log.copiedText}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2) 실시간 상세 활동 타임라인 확대 모달 */}
      {showTimelineModal && activeStudent && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 3000, padding: '1rem'
        }} onClick={() => setShowTimelineModal(false)}>
          <div style={{
            backgroundColor: 'white', borderRadius: '12px', padding: '1.5rem 2rem',
            width: '90%', maxWidth: '850px', maxHeight: '80vh', overflowY: 'auto',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', position: 'relative'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-card)', paddingBottom: '0.75rem', marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 900, color: 'var(--brand-green-dark)', display: 'flex', alignItems: 'center', gap: '0.35rem', margin: 0 }}>
                ⏳ [{activeStudent.name}] 학생 전체 탐구 활동 기록 타임라인
              </h2>
              <button onClick={() => setShowTimelineModal(false)} style={{ border: 'none', background: 'none', fontSize: '1.5rem', fontWeight: 700, cursor: 'pointer', color: '#94a3b8' }}>&times;</button>
            </div>

            {(() => {
              const studentLogs = logs
                .filter(l => l.name === activeStudent.name)
                .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

              if (studentLogs.length === 0) {
                return <div style={{ textAlign: 'center', color: '#64748b', padding: '3rem 0' }}>활동 기록이 없습니다.</div>;
              }

              return (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid var(--border-card)', textAlign: 'left' }}>
                      <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 800 }}>활동 시각</th>
                      <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 800 }}>작업 유형 / 텍스트 스크랩</th>
                      <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 800, textAlign: 'right' }}>글자수 증분</th>
                      <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 800, textAlign: 'right' }}>누적 글자수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentLogs.map((log, index) => {
                      const dateStr = new Date(log.timestamp).toLocaleString();
                      const diff = log.charDiff !== undefined ? log.charDiff : 0;
                      const diffSign = diff > 0 ? `+${diff}` : `${diff}`;
                      const diffColor = diff > 0 ? '#16a34a' : (diff < 0 ? '#ef4444' : '#64748b');

                      let isCopied = false;
                      let displaySnippet = '';
                      if (log.copiedText) {
                        if (log.copiedText.startsWith('[추가]')) {
                          displaySnippet = log.copiedText.replace('[추가]', '').trim();
                        } else {
                          isCopied = true;
                          displaySnippet = log.copiedText;
                        }
                      }

                      return (
                        <tr key={index} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 700 }}>{dateStr}</td>
                          <td style={{ padding: '0.75rem 1rem', color: '#334155', wordBreak: 'break-all' }}>
                            {isCopied ? (
                              <span style={{ color: '#ef4444', fontWeight: 800 }}>⚠️ 복붙 의심 감지: "{displaySnippet.substring(0, 150)}{displaySnippet.length > 150 ? '...' : ''}"</span>
                            ) : (
                              displaySnippet ? (
                                <span style={{ fontStyle: 'italic', color: '#475569' }}>"{displaySnippet}"</span>
                              ) : (
                                <span style={{ color: '#64748b' }}>슬라이드 수정 / 버전 갱신</span>
                              )
                            )}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 800, color: diffColor }}>{diff !== 0 ? diffSign : '-'}</td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: '#334155' }}>{log.charCount}자</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              );
            })()}
          </div>
        </div>
      )}

      {/* 3) 학생 활동 분석 그래프 확대 모달 (시간대 정밀 탐색 & 줌 지원) */}
      {showChartModal && activeStudent && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 3000, padding: '1rem'
        }} onClick={() => { setShowChartModal(false); setSelectedPoint(null); }}>
          <div style={{
            backgroundColor: 'white', borderRadius: '12px', padding: '1.5rem 2rem',
            width: '95%', maxWidth: '980px', maxHeight: '85vh', overflowY: 'auto',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', position: 'relative'
          }} onClick={(e) => e.stopPropagation()}>
            
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-card)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 900, color: 'var(--brand-green-dark)', display: 'flex', alignItems: 'center', gap: '0.35rem', margin: 0 }}>
                📊 [{activeStudent.name}] 학생 활동 분석 그래프 (정밀 줌 & 행위 매핑)
              </h2>
              <button onClick={() => { setShowChartModal(false); setSelectedPoint(null); }} style={{ border: 'none', background: 'none', fontSize: '1.5rem', fontWeight: 700, cursor: 'pointer', color: '#94a3b8' }}>&times;</button>
            </div>

            {/* Modal Interactive Controls Toolbar */}
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column',
              gap: '0.75rem',
              backgroundColor: '#f8fafc', 
              padding: '0.85rem 1.1rem', 
              borderRadius: '10px', 
              marginBottom: '1rem',
              border: '1px solid #e2e8f0'
            }}>
              {/* Row 1: 활동 일자별 바로가기 (장기 프로젝트 날짜별 딥다이브) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 900, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  활동 일자별 바로가기:
                </span>
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  {(() => {
                    const personalLogs = logs.filter(l => l.name === activeStudent.name);
                    const dateGroupMap = {};
                    personalLogs.forEach(log => {
                      const dStr = new Date(log.timestamp).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short' });
                      if (!dateGroupMap[dStr]) dateGroupMap[dStr] = [];
                      dateGroupMap[dStr].push(log);
                    });
                    const activeDateKeys = Object.keys(dateGroupMap);

                    return (
                      <>
                        <button
                          type="button"
                          onClick={() => setChartSelectedDate('all')}
                          style={{
                            padding: '0.3rem 0.65rem',
                            fontSize: '0.75rem',
                            fontWeight: chartSelectedDate === 'all' ? 900 : 600,
                            backgroundColor: chartSelectedDate === 'all' ? 'var(--brand-green-dark)' : 'white',
                            color: chartSelectedDate === 'all' ? 'white' : '#475569',
                            border: `1px solid ${chartSelectedDate === 'all' ? 'var(--brand-green-dark)' : '#cbd5e1'}`,
                            borderRadius: '6px',
                            cursor: 'pointer',
                            boxShadow: chartSelectedDate === 'all' ? '0 2px 4px rgba(22, 101, 52, 0.2)' : 'none',
                            transition: 'all 0.15s ease',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          전체 기간 ({activeDateKeys.length > 0 ? `${activeDateKeys.length}일간` : '전체'})
                        </button>

                        {activeDateKeys.map(dKey => (
                          <button
                            type="button"
                            key={dKey}
                            onClick={() => setChartSelectedDate(dKey)}
                            style={{
                              padding: '0.3rem 0.65rem',
                              fontSize: '0.75rem',
                              fontWeight: chartSelectedDate === dKey ? 900 : 600,
                              backgroundColor: chartSelectedDate === dKey ? '#2563eb' : 'white',
                              color: chartSelectedDate === dKey ? 'white' : '#1e293b',
                              border: `1px solid ${chartSelectedDate === dKey ? '#2563eb' : '#cbd5e1'}`,
                              borderRadius: '6px',
                              cursor: 'pointer',
                              boxShadow: chartSelectedDate === dKey ? '0 2px 4px rgba(37, 99, 235, 0.25)' : 'none',
                              transition: 'all 0.15s ease',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {dKey} ({dateGroupMap[dKey].length}건)
                          </button>
                        ))}
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Row 2: 시간대 필터 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', borderTop: '1px solid #e2e8f0', paddingTop: '0.65rem' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#475569', display: 'flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  시간대 구간:
                </span>
                <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                  {[
                    { label: '전체 시간', value: 'all' },
                    { label: '최근 60분', value: '60m' },
                    { label: '최근 30분', value: '30m' },
                    { label: '최근 15분', value: '15m' }
                  ].map(btn => (
                    <button
                      type="button"
                      key={btn.value}
                      onClick={() => setChartTimeFilter(btn.value)}
                      style={{
                        padding: '0.25rem 0.55rem',
                        fontSize: '0.72rem',
                        fontWeight: chartTimeFilter === btn.value ? 800 : 600,
                        backgroundColor: chartTimeFilter === btn.value ? 'var(--brand-green-dark)' : 'white',
                        color: chartTimeFilter === btn.value ? 'white' : '#475569',
                        border: `1px solid ${chartTimeFilter === btn.value ? 'var(--brand-green-dark)' : '#cbd5e1'}`,
                        borderRadius: '4px',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Vertical Stack Layout */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              
              {/* 1st Tier: Horizontal-spanning large SVG chart with click callbacks */}
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#334155', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="20" x2="18" y2="10" />
                      <line x1="12" y1="20" x2="12" y2="4" />
                      <line x1="6" y1="20" x2="6" y2="14" />
                    </svg>
                    학생 활동 분석 그래프
                  </span>
                  <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 700 }}>차트 위의 점을 클릭하면 아래에 실제 작성 내용이 나타납니다.</span>
                </div>
                {renderSVGChart(activeStudent.name, true, setSelectedPoint, selectedPoint?.timestamp, chartTimeFilter, chartSelectedDate, setChartSelectedDate)}
              </div>

              {/* 2nd Tier: Dynamic detail mapping card for the clicked node */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#334155' }}>선택한 시점의 작성 내용 매핑</span>
                
                {selectedPoint ? (() => {
                  const diff = selectedPoint.charDiff !== undefined ? selectedPoint.charDiff : 0;
                  const diffSign = diff > 0 ? `+${diff}` : `${diff}`;
                  const diffColor = diff > 0 ? '#16a34a' : (diff < 0 ? '#ef4444' : '#64748b');
                  const isSuspicious = selectedPoint.copiedText && !selectedPoint.copiedText.startsWith('[추가]');

                  let displaySnippet = '';
                  if (selectedPoint.copiedText) {
                    displaySnippet = selectedPoint.copiedText.startsWith('[추가]') 
                      ? selectedPoint.copiedText.replace('[추가]', '').trim() 
                      : selectedPoint.copiedText;
                  }

                  return (
                    <div style={{ 
                      padding: '1.25rem', 
                      backgroundColor: isSuspicious ? '#fff5f5' : '#f0fdf4', 
                      border: `1px solid ${isSuspicious ? '#fca5a5' : 'var(--border-light-green)'}`, 
                      borderRadius: '10px',
                      boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
                      animation: 'fadeIn 0.2s ease-out'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, fontSize: '0.88rem', borderBottom: '1px dashed #cbd5e1', paddingBottom: '0.5rem', marginBottom: '0.75rem' }}>
                        <span style={{ color: '#475569' }}>감지 시각: {new Date(selectedPoint.timestamp).toLocaleString()}</span>
                        <span style={{ color: diffColor }}>
                          변화량: {diff !== 0 ? `${diffSign}자` : '구조 수정'} (현재 누적 {selectedPoint.charCount}자)
                        </span>
                      </div>
                      
                      <div style={{ fontSize: '0.85rem', color: '#1e293b' }}>
                        {isSuspicious ? (
                          <div style={{ color: '#b91c1c', fontWeight: 800, marginBottom: '0.35rem' }}>[외부 텍스트 붙여넣기 의심 감지]</div>
                        ) : (
                          <div style={{ color: 'var(--brand-green-dark)', fontWeight: 800, marginBottom: '0.35rem' }}>[직접 작성 내용]</div>
                        )}
                        <div style={{ 
                          fontFamily: 'monospace', fontSize: '0.82rem', color: '#334155',
                          backgroundColor: 'white', padding: '0.75rem 1rem', borderRadius: '6px',
                          border: `1px solid ${isSuspicious ? '#fee2e2' : '#dcfce7'}`, whiteSpace: 'pre-wrap', maxHeight: '140px', overflowY: 'auto',
                          lineHeight: '1.5', wordBreak: 'break-all'
                        }}>
                          {displaySnippet || '슬라이드 레이아웃 조작 또는 단순 슬라이드 순서 이동입니다. (작성 텍스트 없음)'}
                        </div>
                      </div>
                    </div>
                  );
                })() : (
                  <div style={{ 
                    padding: '1.5rem', 
                    border: '2px dashed #cbd5e1', 
                    borderRadius: '10px', 
                    textAlign: 'center', 
                    color: '#94a3b8', 
                    fontSize: '0.82rem',
                    backgroundColor: '#fafafa'
                  }}>
                    차트 위의 <strong>동그라미 점</strong>을 클릭하시면, 그 순간 학생이 입력했던 실제 상세 글자 내용이 이곳에 표시됩니다.
                  </div>
                )}
              </div>

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
                  const cb = alertConfig.onConfirm;
                  closeAlert();
                  if (alertConfig.isConfirm && cb) {
                    cb();
                  }
                }}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
