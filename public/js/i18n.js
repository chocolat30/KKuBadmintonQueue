const translations = {
  en: {
    'courts-title': 'Courts',
    'add-court-label': 'Add Court',
    'add-court-btn': 'Add',
    'history-btn': 'Match History',
    'delete-court-btn': 'Delete Court',
    'queue-title': 'Waiting Queue (Pairs) - Drag to reorder',
    'join-queue-placeholder': 'Pair Name',
    'join-queue-btn': 'Add Pair',
    'start-match-btn': 'Start Match',
    'reset-match-btn': 'Reset Match',
    'clear-queue-btn': 'Clear All Queue',
    'clear-history-btn': 'Clear History',
    'undo-btn': 'Undo',
    'active-match-title': 'Active Match',
    'court-empty': 'Court Empty',
    'team-a': 'Team A',
    'team-b': 'Team B',
    'played-rounds': 'Played: {n} rounds',
    'win-a-btn': 'Team A Wins',
    'win-b-btn': 'Team B Wins',
    'started-at': 'Started at: {date}',
    'edit-name-btn': 'Edit Name',
    'save-name-btn': 'Save',
    'remove-btn': 'Remove',
    'estimated-min': '~{n} min',
    'lang-btn': 'TH',
    'back-btn': 'Back',
    'queue-empty': 'Queue Empty',
    'disconnected-msg': 'Server disconnected, please wait',
    'all-history-btn': 'All court match history',
    'no-courts': 'No courts in system',
    'open-court-btn': 'Open',
    'court-name-placeholder': 'Court Name (e.g. Court 1, Court 2)',
    'history-title': 'Match History',
    'no-history': 'No match history',
    'vs': 'vs',
    'winning-team': 'Winning Team',
    'match-number': 'Match #{n}',
    'play-time': 'Play Time',
    'confirm-clear-queue': 'Delete the entire queue?',
    'confirm-clear-history': "Delete this court's match history?",
    'confirm-undo': 'Undo the last queue change?',
    'delete-court-data': 'Delete this court and all its queue data?'
  },
  th: {
    'courts-title': 'คอร์ท',
    'add-court-label': 'เพิ่มคอร์ท',
    'add-court-btn': 'เพิ่ม',
    'history-btn': 'ดูประวัติแมตช์',
    'all-history-btn': 'ดูประวัติแมตช์ทุกคอร์ท',
    'delete-court-btn': 'ลบคอร์ด',
    'queue-title': 'คิวที่กำลังต่อ (คู่) - ลากเพื่อจัดลำดับ',
    'join-queue-placeholder': 'ชื่อคู่',
    'join-queue-btn': 'เพิ่มคู่',
    'start-match-btn': 'เริ่มแมตช์',
    'reset-match-btn': 'รีเซ็ตแมตช์',
    'clear-queue-btn': 'ล้างคิวทั้งหมด',
    'clear-history-btn': 'ล้างประวัติ',
    'undo-btn': 'Undo',
    'active-match-title': 'แมตช์ที่กำลังเล่น',
    'court-empty': 'คอร์ทว่าง',
    'team-a': 'ทีม A',
    'team-b': 'ทีม B',
    'played-rounds': 'เล่นแล้ว: {n} รอบ',
    'win-a-btn': 'ทีม A ชนะ',
    'win-b-btn': 'ทีม B ชนะ',
    'started-at': 'เริ่มแมตช์เมื่อ: {date}',
    'edit-name-btn': 'แก้ชื่อ',
    'save-name-btn': 'แก้',
    'remove-btn': 'ลบ',
    'estimated-min': '~{n} นาที',
    'lang-btn': 'EN',
    'back-btn': 'ย้อนกลับ',
    'queue-empty': 'คิววาง',
    'disconnected-msg': 'เซิร์ฟเวอร์หลุดการเชื่อมต่อ โปรดรอสักครู่',
    'all-history-btn': 'ดูประวัติแมตช์ทุกคอร์ท',
    'no-courts': 'ไม่มีคอร์ทในระบบ',
    'open-court-btn': 'เปิด',
    'court-name-placeholder': 'ชื่อคอร์ท (เช่น คอร์ทไอ้ปาม, คอร์ท 6)',
    'history-title': 'ดูประวัติแมตช์',
    'no-history': 'ไม่มีประวัติแมตช์',
    'vs': 'vs',
    'winning-team': 'ทีมที่ชนะ',
    'match-number': 'แมตช์ที่ #{n}',
    'play-time': 'เวลาเล่น',
    'confirm-clear-queue': 'ต้องการลบคิวทั้งหมดใช่หรือไม่?',
    'confirm-clear-history': 'ต้องการลบประวัติแมตช์ของคอร์ทนี้ใช่หรือไม่?',
    'confirm-undo': 'ต้องการย้อนกลับคิวเมื่อครั้งก่อนใช่หรือไม่?',
    'delete-court-data': 'ต้องการลบคอร์ทและข้อมูลคิวทั้งหมดใช่หรือไม่?'
  }
};

function applyTranslations() {
  const lang = localStorage.getItem('lang') || 'th';
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    let text = translations[lang][key] || key;

    // Handle simple placeholders like {n} or {date}
    if (el.dataset.i18nValue) {
      text = text.replace('{n}', el.dataset.i18nValue).replace('{date}', el.dataset.i18nValue);
    }

    if (el.tagName === 'INPUT' && el.placeholder) {
      el.placeholder = text;
    } else {
      el.textContent = text;
    }
  });

  const btn = document.getElementById('langToggle');
  if (btn) {
    btn.textContent = translations[lang]['lang-btn'];
  }
  const sel = document.getElementById('langSelect');
  if (sel) {
    sel.value = lang;
  }
}

function toggleLanguage() {
  // Deprecated: original toggle function; kept for backward compatibility.
  const currentLang = localStorage.getItem('lang') || 'th';
  const newLang = currentLang === 'th' ? 'en' : 'th';
  localStorage.setItem('lang', newLang);
  applyTranslations();
}

// New language setter used by the <select> dropdowns.
function setLanguage(lang) {
  localStorage.setItem('lang', lang);
  applyTranslations();
}

function t(key) {
  const lang = localStorage.getItem('lang') || 'th';
  return translations[lang][key] || key;
}

document.addEventListener('DOMContentLoaded', () => {
  applyTranslations();
});
