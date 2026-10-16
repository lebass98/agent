'use strict';
/* 공간 테마는 화면의 라이트/다크와 독립적이다. 장면 좌표·길찾기를 함께 바꾸므로 전환 시 새로고침한다. */
window.SpaceTheme = (() => {
  const key = 'agentOffice.spaceTheme';
  const valid = value => ['office', 'zoo'].includes(value);
  let saved = 'office';
  try { const value = localStorage.getItem(key); if (valid(value)) saved = value; } catch {}
  const query = new URLSearchParams(location.search).get('space');
  const current = valid(query) ? query : saved;
  document.documentElement.dataset.spaceTheme = current;
  let dialog, status, skip = false, previousFocus;
  try { skip = sessionStorage.getItem('agentOffice.enterSpace') === current; sessionStorage.removeItem('agentOffice.enterSpace'); } catch {}
  function show() {
    previousFocus = document.activeElement;
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.className = 'space-picker';
      dialog.setAttribute('aria-labelledby', 'spaceTitle');
      dialog.innerHTML = `<form method="dialog"><header><span class="space-eyebrow">AGENT · YOUR WORKSPACE</span><h1 id="spaceTitle">어디에서 함께 일할까요?</h1><p>공간이 바뀌어도 함께 일하는 AI 팀은 그대로예요.</p></header><div class="space-options"><button type="button" data-space="office"><span class="space-picture office-picture" aria-hidden="true">🏢</span><strong>사무실</strong><span>익숙한 작업 공간과 사람 팀원</span></button><button type="button" data-space="zoo"><span class="space-picture zoo-picture" aria-hidden="true">🦊 🐼 🦦</span><strong>동물원</strong><span>입체 동물 세 마리와 작은 협업 광장</span></button></div><p class="space-note">선택은 이 브라우저에 기억됩니다. 설정에서 다시 바꿀 수 있어요.<br>다른 공간으로 바꾸면 화면을 새로 불러옵니다.</p><p class="space-status" role="status"></p></form>`;
      document.body.append(dialog); status = dialog.querySelector('.space-status');
      for (const button of dialog.querySelectorAll('[data-space]')) {
        button.setAttribute('aria-pressed', String(button.dataset.space === current));
        button.onclick = () => select(button.dataset.space);
      }
      dialog.addEventListener('close', () => previousFocus?.focus?.({preventScroll:true}));
    }
    status.textContent = '';
    if (!dialog.open) dialog.showModal();
  }
  function select(next) {
    if (!valid(next)) return;
    if (next !== current) {
      let busy = false;
      try { busy = D.running || UI.submitting || window.CharacterChat?.pending; } catch {}
      if (busy) { status.textContent = '업무나 답변이 끝나면 공간을 바꿀 수 있어요.'; return; }
    }
    try { localStorage.setItem(key, next); } catch {}
    if (next === current) { dialog.close(); return; }
    try { sessionStorage.setItem('agentOffice.enterSpace', next); sessionStorage.setItem('agentOffice.spaceDraft', document.getElementById('goal')?.value || ''); } catch {}
    const url = new URL(location.href); url.searchParams.set('space', next); location.replace(url.href);
  }
  function control() { const button = document.createElement('button'); button.type='button'; button.className='tbtn'; button.textContent=current === 'zoo' ? '동물원 · 변경' : '사무실 · 변경'; button.onclick=show; return button; }
  document.addEventListener('DOMContentLoaded', () => {
    try { const draft = sessionStorage.getItem('agentOffice.spaceDraft'); sessionStorage.removeItem('agentOffice.spaceDraft'); if (draft && document.getElementById('goal')) { document.getElementById('goal').value=draft; document.getElementById('goal').dispatchEvent(new Event('input',{bubbles:true})); } } catch {}
    if (current === 'zoo') {
      const roomNames={all:'전체 보기',lobby:'입구',pantry:'차 한 잔',work:'작업실',exec:'여우 작업실',meeting:'협업 광장',lounge:'쉼터',balcony:'연못'};
      for (const button of document.querySelectorAll('[data-room]')) button.textContent=roomNames[button.dataset.room] || button.textContent;
      document.querySelector('.room-switch')?.setAttribute('aria-label','동물원 공간');
      const home=document.querySelector('[data-view="office"]');if(home){home.title='동물원';const text=home.querySelector('span');if(text)text.textContent='동물원';}
      document.querySelector('.rail-logo')?.setAttribute('aria-label','WordNCode Agent Zoo 홈');
      document.getElementById('officeFrame')?.setAttribute('aria-label','동물원 뷰포트');
      const reset=document.getElementById('cameraReset');if(reset)reset.setAttribute('aria-label','전체 동물원 보기');
      const badge=document.querySelector('.office-live');if(badge)for(const child of badge.childNodes)if(child.nodeType===3)child.textContent='실시간 동물원';
      document.title='WordNCode Agent · 동물원';
      for (const brand of document.querySelectorAll('.brand')) for (const child of brand.childNodes) if (child.nodeType===3 && child.textContent.includes('WordNCode Agent Office')) child.textContent=child.textContent.replace('WordNCode Agent Office','WordNCode Agent Zoo');
    }
    if (!skip) show();
  });
  return {current, isZoo:current === 'zoo', show, control, get reduce(){try{return mqReduce.matches;}catch{return false;}}};
})();
