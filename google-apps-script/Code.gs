/**
 * EE Research Studio — Google Sheets bridge (v3)
 * -------------------------------------------------------
 * Paste this entire file into the Apps Script editor (Extensions > Apps Script)
 * of the Google Sheet you want responses saved to. This REPLACES the entire
 * previous file content — select all, delete, paste this in.
 *
 * This version uses FOUR tabs (auto-created on first run if missing):
 *   Roster     | StudentID | StudentName |
 *   Students   | StudentID | PinHash | FailedAttempts | Locked | UpdatedAt |
 *   Responses  | Timestamp | StudentID | Day | FormID | DataJSON |
 *   Feedback   | Timestamp | StudentID | Day | FormID | Comment | Score |   <- NEW
 *
 * ONE-TIME SETUP YOU MUST DO BEFORE STUDENTS USE THE SITE:
 *   1. Fill the "Roster" tab with all 21 students' StudentID (학번) + StudentName.
 *      Only IDs listed here are allowed to register — this stops outsiders
 *      from creating fake accounts.
 *   2. Set a teacher passcode: Project Settings (gear icon) > Script Properties
 *      > Add property > name = TEACHER_PASSCODE, value = (choose your own).
 *      This passcode is NOT stored in the public website code — only here.
 */

const MAX_ATTEMPTS = 5;

function getSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  return sheet;
}
function getRosterSheet_()    { return getSheet_("Roster",    ["StudentID", "StudentName"]); }
function getStudentsSheet_()  { return getSheet_("Students",  ["StudentID", "PinHash", "FailedAttempts", "Locked", "UpdatedAt"]); }
function getResponsesSheet_() { return getSheet_("Responses", ["Timestamp", "StudentID", "Day", "FormID", "DataJSON"]); }
function getFeedbackSheet_()  { return getSheet_("Feedback",  ["Timestamp", "StudentID", "Day", "FormID", "Comment", "Score"]); }

function hashPin_(id, pin) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, id + ":" + pin + ":ee-studio-salt");
  return raw.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0")).join("");
}

function findRosterName_(id) {
  const rows = getRosterSheet_().getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) return rows[i][1];
  }
  return null;
}

// Core login/registration logic. First-ever correct-format request for an
// ID creates the account with that PIN; every later request must match it.
function authenticate_(id, pin) {
  if (!/^[0-9]{4,6}$/.test(String(id))) return { ok: false, message: "학번 형식을 확인해주세요." };
  if (!/^[0-9]{4}$/.test(String(pin)))  return { ok: false, message: "비밀번호는 숫자 4자리여야 합니다." };

  const name = findRosterName_(id);
  if (!name) return { ok: false, message: "명단에 없는 학번입니다. 선생님께 문의해주세요." };

  const sheet = getStudentsSheet_();
  const rows = sheet.getDataRange().getValues();
  const hash = hashPin_(id, pin);

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      const rowNum = i + 1;
      const [ , storedHash, failedAttempts, locked ] = rows[i];

      if (locked === true || locked === "TRUE") {
        return { ok: false, locked: true, message: "5회 오답으로 잠겼습니다. 선생님께 문의해주세요." };
      }
      if (storedHash === hash) {
        sheet.getRange(rowNum, 3, 1, 1).setValue(0); // reset FailedAttempts
        sheet.getRange(rowNum, 5, 1, 1).setValue(new Date());
        return { ok: true, name };
      } else {
        const attempts = Number(failedAttempts || 0) + 1;
        sheet.getRange(rowNum, 3, 1, 1).setValue(attempts);
        if (attempts >= MAX_ATTEMPTS) {
          sheet.getRange(rowNum, 4, 1, 1).setValue(true);
          return { ok: false, locked: true, message: "5회 오답으로 잠겼습니다. 선생님께 문의해주세요." };
        }
        return { ok: false, message: `비밀번호가 일치하지 않습니다. (${attempts}/${MAX_ATTEMPTS})` };
      }
    }
  }

  // No existing account for this ID yet -> register it with the given PIN
  sheet.appendRow([id, hash, 0, false, new Date()]);
  return { ok: true, name, isNewAccount: true };
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ info: "EE Research Studio API — use POST." }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  const action = body.action;

  if (action === "verify") {
    return json_(authenticate_(body.id, body.pin));
  }

  if (action === "save") {
    const auth = authenticate_(body.id, body.pin);
    if (!auth.ok) return json_(auth);

    const sheet = getResponsesSheet_();
    const rows = sheet.getDataRange().getValues();
    let targetRow = -1;
    for (let i = rows.length - 1; i >= 1; i--) {
      const [ , rId, rDay, rFormId ] = rows[i];
      if (String(rId) === String(body.id) && rDay === body.day && rFormId === body.formId) {
        targetRow = i + 1;
        break;
      }
    }
    const rowValues = [new Date(), body.id, body.day, body.formId, JSON.stringify(body.data)];
    if (targetRow > 0) sheet.getRange(targetRow, 1, 1, 5).setValues([rowValues]);
    else sheet.appendRow(rowValues);

    return json_({ ok: true, name: auth.name });
  }

  if (action === "load") {
    const auth = authenticate_(body.id, body.pin);
    if (!auth.ok) return json_(auth);

    const rows = getResponsesSheet_().getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      const [ , rId, rDay, rFormId, dataJson ] = rows[i];
      if (String(rId) === String(body.id) && rDay === body.day && rFormId === body.formId) {
        return json_({ ok: true, found: true, data: JSON.parse(dataJson), name: auth.name });
      }
    }
    return json_({ ok: true, found: false, name: auth.name });
  }

  if (action === "teacher_roster") {
    if (!checkTeacherPass_(body.teacherPass)) return json_({ ok: false, message: "교사 암호가 올바르지 않습니다." });
    const rows = getRosterSheet_().getDataRange().getValues();
    const students = rows.slice(1).map(r => ({ id: String(r[0]), name: r[1] }));
    return json_({ ok: true, students });
  }

  if (action === "teacher_view") {
    if (!checkTeacherPass_(body.teacherPass)) return json_({ ok: false, message: "교사 암호가 올바르지 않습니다." });

    const rows = getResponsesSheet_().getDataRange().getValues();
    const results = rows.slice(1)
      .filter(r => String(r[1]) === String(body.studentId))
      .map(r => ({ timestamp: r[0], day: r[2], formId: r[3], data: JSON.parse(r[4]) }));

    // NEW: attach any existing teacher feedback (comment/score) for each response
    const feedbackRows = getFeedbackSheet_().getDataRange().getValues();
    results.forEach(r => {
      for (let i = feedbackRows.length - 1; i >= 1; i--) {
        const [ , fId, fDay, fFormId, comment, score ] = feedbackRows[i];
        if (String(fId) === String(body.studentId) && fDay === r.day && fFormId === r.formId) {
          r.comment = comment;
          r.score = score;
          break;
        }
      }
    });

    return json_({ ok: true, results });
  }

  // NEW: teacher saves/updates a comment + score for one student's response
  if (action === "teacher_save_feedback") {
    if (!checkTeacherPass_(body.teacherPass)) return json_({ ok: false, message: "교사 암호가 올바르지 않습니다." });

    const sheet = getFeedbackSheet_();
    const rows = sheet.getDataRange().getValues();
    let targetRow = -1;
    for (let i = rows.length - 1; i >= 1; i--) {
      const [ , rId, rDay, rFormId ] = rows[i];
      if (String(rId) === String(body.studentId) && rDay === body.day && rFormId === body.formId) {
        targetRow = i + 1;
        break;
      }
    }
    const rowValues = [new Date(), body.studentId, body.day, body.formId, body.comment || "", body.score || ""];
    if (targetRow > 0) sheet.getRange(targetRow, 1, 1, 6).setValues([rowValues]);
    else sheet.appendRow(rowValues);

    return json_({ ok: true });
  }

  return json_({ ok: false, message: "unknown action" });
}

function checkTeacherPass_(pass) {
  const stored = PropertiesService.getScriptProperties().getProperty("TEACHER_PASSCODE");
  return stored && pass && stored === pass;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
