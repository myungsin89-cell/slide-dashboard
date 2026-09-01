// Client-side Google API wrapper for SlideSight

// Load config from process.env or localStorage
export function getGoogleConfig() {
  if (typeof window === 'undefined') return { clientId: '', apiKey: '' };
  return {
    clientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || localStorage.getItem('slidesight_client_id') || '',
    apiKey: process.env.NEXT_PUBLIC_GOOGLE_API_KEY || localStorage.getItem('slidesight_api_key') || ''
  };
}

export function saveGoogleConfig(clientId, apiKey) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('slidesight_client_id', clientId);
  localStorage.setItem('slidesight_api_key', apiKey);
}

// Global instances
let tokenClient = null;
let googleAccessToken = null;

// Initialize gapi and accounts
export function initGoogleSDKs(onSuccess, onFailure) {
  if (typeof window === 'undefined') return;

  const config = getGoogleConfig();
  if (!config.clientId || !config.apiKey) {
    onFailure && onFailure('config_missing');
    return;
  }

  // Load GAPI
  window.gapi.load('client', async () => {
    try {
      await window.gapi.client.init({
        discoveryDocs: [
          'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
          'https://www.googleapis.com/discovery/v1/apis/slides/v1/rest',
          'https://www.googleapis.com/discovery/v1/apis/sheets/v4/rest'
        ],
      });

      // Load GIS
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: config.clientId,
        scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/presentations https://www.googleapis.com/auth/spreadsheets',
        callback: (resp) => {
          if (resp.error) {
            console.error('Auth error:', resp);
            return;
          }
          googleAccessToken = resp.access_token;
          // Store token in session storage for refreshing within session
          sessionStorage.setItem('slidesight_access_token', googleAccessToken);
          onSuccess && onSuccess(googleAccessToken);
        },
      });

      // Restore session token if valid
      const cachedToken = sessionStorage.getItem('slidesight_access_token');
      if (cachedToken) {
        googleAccessToken = cachedToken;
        window.gapi.client.setToken({ access_token: googleAccessToken });
        onSuccess && onSuccess(googleAccessToken);
      } else {
        onSuccess && onSuccess(null); // Loaded but not authenticated yet
      }

    } catch (err) {
      console.error('Failed to initialize Google API client', err);
      onFailure && onFailure(err);
    }
  });
}

// Request access token (Sign-In)
export function signInTeacher() {
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      reject('Google Identity Services SDK not initialized');
      return;
    }
    
    // Set custom callback to resolve promise
    const originalCallback = tokenClient.callback;
    tokenClient.callback = (resp) => {
      if (resp.error) {
        reject(resp.error);
        return;
      }
      googleAccessToken = resp.access_token;
      sessionStorage.setItem('slidesight_access_token', googleAccessToken);
      window.gapi.client.setToken({ access_token: googleAccessToken });
      if (originalCallback) originalCallback(resp);
      resolve(googleAccessToken);
    };

    // Request token with prompt option
    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

// Check if authenticated
export function getAccessToken() {
  return googleAccessToken || sessionStorage.getItem('slidesight_access_token');
}

export function signOutTeacher() {
  googleAccessToken = null;
  sessionStorage.removeItem('slidesight_access_token');
  if (typeof window !== 'undefined' && window.gapi?.client) {
    window.gapi.client.setToken(null);
  }
}

/**
 * 1. 수업용 DB 구글 스프레드시트 생성
 */
export async function createDatabaseSpreadsheet(className, assignmentName) {
  if (!getAccessToken()) throw new Error('Not authenticated');

  const title = `SlideSight_DB_[${className}]_[${assignmentName}]`;
  
  // 1) 스프레드시트 파일 생성
  const response = await window.gapi.client.sheets.spreadsheets.create({
    resource: {
      properties: { title: title },
      sheets: [
        {
          properties: {
            title: 'students',
            gridProperties: { rowCount: 100, columnCount: 15 }
          }
        },
        {
          properties: {
            title: 'activity_logs',
            gridProperties: { rowCount: 2000, columnCount: 8 }
          }
        }
      ]
    }
  });

  const spreadsheetId = response.result.spreadsheetId;

  // 2) sheets 헤더 작성
  await window.gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: 'students!A1:N1',
    valueInputOption: 'RAW',
    resource: {
      values: [[
        'student_number',
        'student_name',
        'slide_id',
        'slide_url',
        'status',
        'last_active_at',
        'current_char_count',
        'current_slide_count',
        'image_count',
        'keyword_count',
        'keywords_used',
        'blank_slide_count',
        'focus_ratio',
        'teacher_feedback'
      ]]
    }
  });

  await window.gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: 'activity_logs!A1:G1',
    valueInputOption: 'RAW',
    resource: {
      values: [[
        'student_name',
        'timestamp',
        'char_count',
        'slide_count',
        'image_count',
        'keyword_count',
        'copied_text'
      ]]
    }
  });

  // 3) 스프레드시트를 "링크가 있는 누구나 뷰어 가능"으로 설정 (학생 진입용)
  await window.gapi.client.drive.permissions.create({
    fileId: spreadsheetId,
    resource: {
      role: 'reader',
      type: 'anyone'
    }
  });

  return spreadsheetId;
}

/**
 * 2. 슬라이드 템플릿 복사 및 권한 부여
 */
export async function duplicateSlideForStudents(templateId, studentsList, spreadsheetId, onProgress) {
  if (!getAccessToken()) throw new Error('Not authenticated');

  const studentsResults = [];
  const total = studentsList.length;

  for (let i = 0; i < total; i++) {
    const student = studentsList[i];
    const studentName = student.name;
    const studentNum = student.number || '';
    
    if (onProgress) {
      onProgress({
        current: i + 1,
        total: total,
        studentName: studentName,
        studentNumber: studentNum,
        percent: Math.round((i / total) * 100)
      });
    }

    // 1) 사본 만들기 (교사 드라이브 내)
    const copyResponse = await window.gapi.client.drive.files.copy({
      fileId: templateId,
      resource: {
        name: `[${studentNum ? studentNum + '번 ' : ''}${studentName}] SlideSight 과제`
      }
    });

    const newSlideId = copyResponse.result.id;
    const newSlideUrl = `https://docs.google.com/presentation/d/${newSlideId}/edit`;

    // 2) 공유 권한 설정 ("링크가 있는 누구나 편집 가능")
    await window.gapi.client.drive.permissions.create({
      fileId: newSlideId,
      resource: {
        role: 'writer',
        type: 'anyone'
      }
    });

    studentsResults.push({
      number: studentNum,
      name: studentName,
      slideId: newSlideId,
      slideUrl: newSlideUrl
    });

    if (onProgress) {
      onProgress({
        current: i + 1,
        total: total,
        studentName: studentName,
        studentNumber: studentNum,
        percent: Math.round(((i + 1) / total) * 100)
      });
    }
  }

  // 3) 스프레드시트에 기입
  const rowValues = studentsResults.map(s => [
    s.number,
    s.name,
    s.slideId,
    s.slideUrl,
    'disconnected', // status
    new Date().toISOString(), // last_active_at
    0, // current_char_count
    0, // current_slide_count
    0, // image_count
    0, // keyword_count
    '', // keywords_used
    0, // blank_slide_count
    100, // focus_ratio
    '' // teacher_feedback
  ]);

  await window.gapi.client.sheets.spreadsheets.values.append({
    spreadsheetId: spreadsheetId,
    range: 'students!A2',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    resource: {
      values: rowValues
    }
  });

  return studentsResults;
}

/**
 * 3. 개별 학생 구글 슬라이드 상세 데이터 분석
 */
export async function fetchSlideStats(slideId, keywords = []) {
  // 교사 토큰 또는 학생 공개 조회용 (학생은 구글 API 키 및 공개 보기 권한을 통해 조회)
  const response = await window.gapi.client.slides.presentations.get({
    presentationId: slideId
  });

  const presentation = response.result;
  const slides = presentation.slides || [];
  const slideCount = slides.length;

  let totalCharCount = 0;
  let imageCount = 0;
  let blankSlideCount = 0;
  let allText = '';
  const foundKeywords = new Set();

  slides.forEach(slide => {
    let slideHasContent = false;
    const pageElements = slide.pageElements || [];

    pageElements.forEach(element => {
      // 1) 텍스트 추출 (텍스트 상자 또는 도형 텍스트)
      if (element.shape && element.shape.text) {
        const textElements = element.shape.text.textElements || [];
        textElements.forEach(te => {
          if (te.textRun && te.textRun.content) {
            const content = te.textRun.content;
            allText += content + '\n';
            // 공백과 개행 제외한 글자 수 카운팅
            const cleanText = content.replace(/\s/g, '');
            if (cleanText.length > 0) {
              totalCharCount += cleanText.length;
              slideHasContent = true;

              // 키워드 매칭
              keywords.forEach(keyword => {
                if (content.toLowerCase().includes(keyword.toLowerCase())) {
                  foundKeywords.add(keyword);
                }
              });
            }
          }
        });
      }

      // 2) 테이블 텍스트 추출
      if (element.table) {
        slideHasContent = true;
        const tableRows = element.table.tableRows || [];
        tableRows.forEach(row => {
          const cells = row.tableCells || [];
          cells.forEach(cell => {
            if (cell.text) {
              const textElements = cell.text.textElements || [];
              textElements.forEach(te => {
                if (te.textRun && te.textRun.content) {
                  const content = te.textRun.content;
                  allText += content + '\n';
                  const cleanText = content.replace(/\s/g, '');
                  totalCharCount += cleanText.length;
                  keywords.forEach(keyword => {
                    if (content.toLowerCase().includes(keyword.toLowerCase())) {
                      foundKeywords.add(keyword);
                    }
                  });
                }
              });
            }
          });
        });
      }

      // 3) 이미지 카운트
      if (element.image) {
        imageCount++;
        slideHasContent = true;
      }
    });

    if (!slideHasContent) {
      blankSlideCount++;
    }
  });

  return {
    slideCount,
    charCount: totalCharCount,
    imageCount,
    blankSlideCount,
    keywordsUsed: Array.from(foundKeywords),
    revisionId: presentation.revisionId || '',
    fullText: allText
  };
}

/**
 * 4. 스프레드시트 DB 목록 로드 (교사의 기존 과제 리스트)
 */
export async function fetchAssignmentsList(className = null) {
  if (!getAccessToken()) throw new Error('Not authenticated');

  const query = className 
    ? `name contains 'SlideSight_DB_[${className}]' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`
    : `name contains 'SlideSight_DB_' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;

  const response = await window.gapi.client.drive.files.list({
    q: query,
    fields: 'files(id, name, createdTime)',
    orderBy: 'createdTime desc'
  });

  return response.result.files.map(file => {
    // Extract assignmentName from "SlideSight_DB_[className]_[assignmentName]"
    const parts = file.name.split('_');
    let displayTitle = file.name;
    
    if (parts.length >= 4) {
      const assignmentPart = parts.slice(3).join('_');
      // Remove square brackets [assignmentName] -> assignmentName
      const match = assignmentPart.match(/^\[(.*?)\]$/) || [null, assignmentPart];
      displayTitle = match[1];
    } else {
      // Fallback
      displayTitle = file.name.replace('SlideSight_DB_', '');
    }

    return {
      id: file.id,
      name: displayTitle,
      fullName: file.name,
      createdTime: file.createdTime
    };
  });
}

/**
 * 5. 스프레드시트 DB로부터 전체 학생 데이터 및 로그 데이터 로드
 */
export async function loadSpreadsheetData(spreadsheetId) {
  // students 시트 조회 (A1:N100 범위)
  const studentResp = await window.gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'students!A2:N100'
  });

  const studentRows = studentResp.result.values || [];
  const students = studentRows.map(row => ({
    number: row[0] ? parseInt(row[0]) : '',
    name: row[1] || '',
    slideId: row[2] || '',
    slideUrl: row[3] || '',
    status: row[4] || 'disconnected',
    lastActiveAt: row[5] || '',
    charCount: row[6] ? parseInt(row[6]) : 0,
    slideCount: row[7] ? parseInt(row[7]) : 0,
    imageCount: row[8] ? parseInt(row[8]) : 0,
    keywordCount: row[9] ? parseInt(row[9]) : 0,
    keywordsUsed: row[10] ? row[10].split(',').filter(Boolean) : [],
    blankSlideCount: row[11] ? parseInt(row[11]) : 0,
    focusRatio: row[12] ? parseInt(row[12]) : 100,
    teacherFeedback: row[13] || ''
  }));

  // activity_logs 시트 조회 (A2:G5000 범위)
  const logsResp = await window.gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'activity_logs!A2:G5000'
  });

  const logRows = logsResp.result.values || [];
  const logs = logRows.map(row => ({
    name: row[0] || '',
    timestamp: row[1] || '',
    charCount: row[2] ? parseInt(row[2]) : 0,
    slideCount: row[3] ? parseInt(row[3]) : 0,
    imageCount: row[4] ? parseInt(row[4]) : 0,
    keywordCount: row[5] ? parseInt(row[5]) : 0,
    copiedText: row[6] || ''
  }));

  return { students, logs };
}

/**
 * 6. 스프레드시트 DB에 분석된 학생 상태 일괄 업데이트
 */
export async function saveStudentsStatus(spreadsheetId, students) {
  if (!getAccessToken()) throw new Error('Not authenticated');

  // students 시트 로드해서 행 번호 찾아서 덮어쓰거나, 전체 정렬해서 한 번에 덮어쓰기
  // 간단히 students 시트를 헤더를 제외하고 전체 덮어쓰기
  const range = `students!A2:N${students.length + 1}`;
  const values = students.map(s => [
    s.number || '',
    s.name,
    s.slideId,
    s.slideUrl,
    s.status,
    s.lastActiveAt,
    s.charCount,
    s.slideCount,
    s.imageCount,
    s.keywordCount,
    s.keywordsUsed ? s.keywordsUsed.join(',') : '',
    s.blankSlideCount,
    s.focusRatio,
    s.teacherFeedback || ''
  ]);

  await window.gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: range,
    valueInputOption: 'RAW',
    resource: {
      values: values
    }
  });
}

/**
 * 7. 스프레드시트 DB에 새로운 활동 로그 추가
 */
export async function appendActivityLogs(spreadsheetId, logs) {
  if (!getAccessToken()) throw new Error('Not authenticated');
  if (logs.length === 0) return;

  const values = logs.map(l => [
    l.name,
    l.timestamp,
    l.charCount,
    l.slideCount,
    l.imageCount,
    l.keywordCount,
    l.copiedText || ''
  ]);

  await window.gapi.client.sheets.spreadsheets.values.append({
    spreadsheetId: spreadsheetId,
    range: 'activity_logs!A2',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    resource: {
      values: values
    }
  });
}

/**
 * 8. 학급 명단 저장소 파일 검색 및 생성
 */
async function getOrCreateRosterSpreadsheet() {
  // 1) "슬라이드대시보드_학급명단_저장소" 파일이 드라이브에 있는지 검색
  const listResp = await window.gapi.client.drive.files.list({
    q: "name = '슬라이드대시보드_학급명단_저장소' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false",
    fields: 'files(id)'
  });

  const files = listResp.result.files || [];
  if (files.length > 0) {
    return files[0].id;
  }

  // 2) 없으면 새로 만들기
  const createResp = await window.gapi.client.sheets.spreadsheets.create({
    resource: {
      properties: { title: '슬라이드대시보드_학급명단_저장소' }
    }
  });
  return createResp.result.spreadsheetId;
}

/**
 * 9. 학급 명단 저장 (스프레드시트에 학급 이름 탭 추가/덮어쓰기)
 */
export async function saveClassRoster(rosterName, students) {
  if (!getAccessToken()) throw new Error('Not authenticated');
  if (!rosterName.trim()) throw new Error('Roster name is required');

  const spreadsheetId = await getOrCreateRosterSpreadsheet();

  // 1) 기존 스프레드시트 정보(시트 탭 목록) 가져오기
  const ssResp = await window.gapi.client.sheets.spreadsheets.get({
    spreadsheetId: spreadsheetId
  });
  const sheets = ssResp.result.sheets || [];
  const existingSheet = sheets.find(s => s.properties.title === rosterName);

  // 2) 해당 학급 탭이 없으면 새로 추가
  if (!existingSheet) {
    await window.gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId: spreadsheetId,
      resource: {
        requests: [
          {
            addSheet: {
              properties: { title: rosterName }
            }
          }
        ]
      }
    });
  }

  // 3) 해당 탭 내용 비우기 (기존 명단 덮어쓰기용)
  await window.gapi.client.sheets.spreadsheets.values.clear({
    spreadsheetId: spreadsheetId,
    range: `'${rosterName}'!A1:B100`
  });

  // 4) 새 명단 작성
  const values = [
    ['student_number', 'student_name'],
    ...students.map(s => [s.number || '', s.name])
  ];

  await window.gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: `'${rosterName}'!A1`,
    valueInputOption: 'RAW',
    resource: {
      values: values
    }
  });
}

/**
 * 10. 등록된 전체 학급 목록(시트 탭 이름들) 가져오기
 */
export async function fetchClassRosters() {
  if (!getAccessToken()) throw new Error('Not authenticated');

  const listResp = await window.gapi.client.drive.files.list({
    q: "name = '슬라이드대시보드_학급명단_저장소' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false",
    fields: 'files(id)'
  });

  const files = listResp.result.files || [];
  if (files.length === 0) return []; // 파일이 아직 없음

  const spreadsheetId = files[0].id;
  const ssResp = await window.gapi.client.sheets.spreadsheets.get({
    spreadsheetId: spreadsheetId
  });

  const sheets = ssResp.result.sheets || [];
  // 기본 시트인 'Sheet1'이 비어있으면 목록에서 제외
  return sheets
    .map(s => s.properties.title)
    .filter(title => title !== 'Sheet1');
}

/**
 * 11. 특정 학급의 학생 명단 불러오기
 */
export async function loadClassRoster(rosterName) {
  if (!getAccessToken()) throw new Error('Not authenticated');

  const listResp = await window.gapi.client.drive.files.list({
    q: "name = '슬라이드대시보드_학급명단_저장소' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false",
    fields: 'files(id)'
  });

  const files = listResp.result.files || [];
  if (files.length === 0) return [];

  const spreadsheetId = files[0].id;
  const valuesResp = await window.gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: `'${rosterName}'!A2:B100` // 헤더 제외하고 번호와 이름만 로드
  });

  const rows = valuesResp.result.values || [];
  return rows.map((row, idx) => ({
    number: row[0] ? parseInt(row[0]) : idx + 1,
    name: row[1] || ''
  })).filter(s => s.name);
}

/**
 * 12. 특정 학급 명단 삭제 (해당 탭 제거)
 */
export async function deleteClassRoster(rosterName) {
  if (!getAccessToken()) throw new Error('Not authenticated');

  const listResp = await window.gapi.client.drive.files.list({
    q: "name = '슬라이드대시보드_학급명단_저장소' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false",
    fields: 'files(id)'
  });

  const files = listResp.result.files || [];
  if (files.length === 0) return;

  const spreadsheetId = files[0].id;
  const ssResp = await window.gapi.client.sheets.spreadsheets.get({
    spreadsheetId: spreadsheetId
  });

  const sheets = ssResp.result.sheets || [];
  const targetSheet = sheets.find(s => s.properties.title === rosterName);
  if (!targetSheet) return;

  const sheetId = targetSheet.properties.sheetId;

  // Google Sheets requires at least one sheet to remain visible
  if (sheets.length === 1) {
    await window.gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId: spreadsheetId,
      resource: {
        requests: [
          {
            addSheet: {
              properties: { title: 'Sheet1' }
            }
          },
          {
            deleteSheet: {
              sheetId: sheetId
            }
          }
        ]
      }
    });
    return;
  }

  await window.gapi.client.sheets.spreadsheets.batchUpdate({
    spreadsheetId: spreadsheetId,
    resource: {
      requests: [
        {
          deleteSheet: {
            sheetId: sheetId
          }
        }
      ]
    }
  });
}

/**
 * 13. 수업 과제 삭제 (DB 스프레드시트 파일 휴지통 이동)
 */
export async function deleteAssignment(spreadsheetId) {
  if (!getAccessToken()) throw new Error('Not authenticated');

  await window.gapi.client.drive.files.update({
    fileId: spreadsheetId,
    resource: { trashed: true }
  });
}
