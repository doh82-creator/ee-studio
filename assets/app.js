// ============================================================
// EE Research Studio — shared config & Google Sheets bridge (v2)
// Auth model: 5-digit StudentID (학번) + 4-digit PIN chosen on first use.
// ============================================================
const CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbzUUf2m6WDiZPUi15Yqy5x4XE1nyZwxctmhP0Pxqnxwxbq0cGSoNzXtiPkWhh2l2dkk2w/exec"
};

function ee_getSavedAuth(){
  return {
    id: localStorage.getItem("ee_student_id") || "",
    pin: localStorage.getItem("ee_student_pin") || ""
  };
}
function ee_setSavedAuth(id, pin){
  localStorage.setItem("ee_student_id", id);
  localStorage.setItem("ee_student_pin", pin);
}

async function ee_apiCall(payload){
  const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids CORS preflight
    body: JSON.stringify(payload)
  });
  return await res.json();
}

// Verify (or silently register, on first use) an ID+PIN pair.
// Returns { ok, name, isNewAccount, locked, message }
async function ee_verify(id, pin, statusEl){
  if(CONFIG.APPS_SCRIPT_URL.includes("PASTE_YOUR")){
    ee_setStatus(statusEl, "⚠ 아직 서버 연결 전입니다 (교사용 설정 필요).", true);
    return { ok:false };
  }
  try{
    const result = await ee_apiCall({ action:"verify", id, pin });
    if(result.ok){
      ee_setSavedAuth(id, pin);
      ee_setStatus(statusEl, result.isNewAccount
        ? `✓ ${result.name}님, 비밀번호가 처음 등록되었습니다. 잊지 않도록 기억해주세요.`
        : `✓ ${result.name}님, 확인되었습니다.`, false);
    } else {
      ee_setStatus(statusEl, result.message || "확인에 실패했습니다.", true);
    }
    return result;
  }catch(err){
    ee_setStatus(statusEl, "서버 연결 실패: 인터넷 연결을 확인해주세요.", true);
    return { ok:false };
  }
}

async function ee_saveResponse(day, formId, data, statusEl){
  const { id, pin } = ee_getSavedAuth();
  if(!id || !pin){ ee_setStatus(statusEl, "먼저 학번과 비밀번호를 확인해주세요.", true); return false; }
  if(CONFIG.APPS_SCRIPT_URL.includes("PASTE_YOUR")){
    ee_setStatus(statusEl, "⚠ 서버 연결 전이라 이 기기에만 임시 저장됩니다.", true);
    localStorage.setItem(`ee_local_${day}_${formId}_${id}`, JSON.stringify(data));
    return false;
  }
  ee_setStatus(statusEl, "저장 중…", false);
  try{
    const result = await ee_apiCall({ action:"save", id, pin, day, formId, data });
    if(result.ok) ee_setStatus(statusEl, "✓ 저장되었습니다. (" + new Date().toLocaleTimeString() + ")", false);
    else ee_setStatus(statusEl, result.message || "저장 실패", true);
    return result.ok;
  }catch(err){
    ee_setStatus(statusEl, "저장 실패: 인터넷 연결을 확인해주세요.", true);
    return false;
  }
}

async function ee_loadResponse(day, formId, statusEl){
  const { id, pin } = ee_getSavedAuth();
  if(!id || !pin) return null;
  if(CONFIG.APPS_SCRIPT_URL.includes("PASTE_YOUR")){
    const local = localStorage.getItem(`ee_local_${day}_${formId}_${id}`);
    return local ? JSON.parse(local) : null;
  }
  try{
    const result = await ee_apiCall({ action:"load", id, pin, day, formId });
    if(!result.ok){ ee_setStatus(statusEl, result.message || "불러오기 실패", true); return null; }
    if(result.found){ ee_setStatus(statusEl, "이전 답변을 불러왔습니다.", false); return result.data; }
    ee_setStatus(statusEl, "저장된 이전 답변이 없습니다. 새로 작성해주세요.", false);
    return null;
  }catch(err){
    ee_setStatus(statusEl, "불러오기 실패: 인터넷 연결을 확인해주세요.", true);
    return null;
  }
}

function ee_setStatus(el, msg, isError){
  if(!el) return;
  el.textContent = msg;
  el.style.color = isError ? "#8B2E2E" : "#3F6659";
}
