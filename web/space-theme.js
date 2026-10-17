'use strict';
/* 공간 테마는 화면의 라이트/다크와 독립적이다. 장면 좌표·길찾기를 함께 바꾸므로 전환 시 새로고침한다.
   테마 목록·이름은 theme-kit.js(ThemeKit.THEMES)에서 온다 — 새 테마를 더해도 이 파일은 그대로다.
   바꾸는 곳: 처음 진입 때 한 번 뜨는 고르기 창 · 상단 경로 단추(#spaceBtn) · 설정 '공간 테마'. */
window.SpaceTheme = (() => {
  const key = 'agentOffice.spaceTheme';
  const KIT = window.ThemeKit || { THEMES: [{ id: 'office', label: '사무실', icon: '🏢', blurb: '', brand: 'WordNCode Agent Office', title: 'WordNCode Agent Office', picture: '🏢' }], valid: id => id === 'office', get: () => KIT.THEMES[0] };
  const valid = value => KIT.valid(value);
  let saved = 'office', chosen = false; // chosen: 이 브라우저에 고른 공간이 저장되어 있다(처음 한 번만 묻는다)
  try { const value = localStorage.getItem(key); if (valid(value)) { saved = value; chosen = true; } } catch {}
  const query = new URLSearchParams(location.search).get('space');
  const current = valid(query) ? query : saved;
  const theme = KIT.get(current);
  document.documentElement.dataset.spaceTheme = current;
  let dialog, status, skip = false, previousFocus;
  try { skip = sessionStorage.getItem('agentOffice.enterSpace') === current; sessionStorage.removeItem('agentOffice.enterSpace'); } catch {}
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function show() {
    previousFocus = document.activeElement;
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.className = 'space-picker';
      dialog.setAttribute('aria-labelledby', 'spaceTitle');
      const options = KIT.THEMES.map(t => `<button type="button" data-space="${esc(t.id)}"><span class="space-picture ${esc(t.id)}-picture" aria-hidden="true">${esc(t.picture || t.icon)}</span><strong>${esc(t.label)}</strong><span>${esc(t.blurb)}</span></button>`).join('');
      dialog.innerHTML = `<form method="dialog"><header><span class="space-eyebrow">AGENT · YOUR WORKSPACE</span><h1 id="spaceTitle">어디에서 함께 일할까요?</h1><p>공간이 바뀌어도 함께 일하는 AI 팀과 자리·조연·대화 구조는 그대로예요. 모양만 달라져요.</p></header><div class="space-options">${options}</div><p class="space-note">선택은 이 브라우저에 기억됩니다. 왼쪽 위 공간 이름이나 설정에서 다시 바꿀 수 있어요.<br>다른 공간으로 바꾸면 화면을 새로 불러옵니다.</p><p class="space-status" role="status"></p></form>`;
      status = dialog.querySelector('.space-status');
      for (const button of dialog.querySelectorAll('[data-space]')) {
        button.setAttribute('aria-pressed', String(button.dataset.space === current));
        button.onclick = () => select(button.dataset.space);
      }
      dialog.addEventListener('close', () => previousFocus?.focus?.({preventScroll:true}));
      document.body.append(dialog);
    }
    if (status) status.textContent = '';
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
  function control() { const button = document.createElement('button'); button.type='button'; button.className='tbtn'; button.textContent=`${theme.label} · 변경`; button.onclick=show; return button; }
  document.addEventListener('DOMContentLoaded', () => {
    try { const draft = sessionStorage.getItem('agentOffice.spaceDraft'); sessionStorage.removeItem('agentOffice.spaceDraft'); if (draft && document.getElementById('goal')) { document.getElementById('goal').value=draft; document.getElementById('goal').dispatchEvent(new Event('input',{bubbles:true})); } } catch {}
    // 상단 경로의 공간 단추: '워크스페이스 / 🏢 사무실 ▾' — 누르면 공간 고르기 창
    const crumb = document.getElementById('spaceBtn');
    if (crumb) { crumb.textContent = `${theme.icon} ${theme.label}`; crumb.setAttribute('aria-label', `공간: ${theme.label} (눌러서 바꾸기)`); crumb.title = '공간 바꾸기'; crumb.onclick = show; }
    // 방 단추 이름은 테마 지도(Decor.rooms)의 이름 하나만 쓴다(키·역할은 theme-kit.js 공통)
    for (const b of document.querySelectorAll('.room-switch [data-room]')) { const r = window.Decor?.rooms?.[b.dataset.room]; if (r?.label) b.textContent = r.label; }
    // 공간 이름이 들어가는 화면 문구
    const home=document.querySelector('[data-view="office"]');if(home){home.title=theme.label;const text=home.querySelector('span');if(text)text.textContent=theme.label;}
    document.querySelector('.rail-logo')?.setAttribute('aria-label',`${theme.brand} 홈`);
    document.getElementById('officeFrame')?.setAttribute('aria-label',`${theme.label} 뷰포트`);
    document.querySelector('.room-switch')?.setAttribute('aria-label',`${theme.label} 공간`);
    const reset=document.getElementById('cameraReset');if(reset)reset.setAttribute('aria-label',`전체 ${theme.label} 보기`);
    const badge=document.querySelector('.office-live');if(badge)for(const child of badge.childNodes)if(child.nodeType===3)child.textContent=`실시간 ${theme.label}`;
    document.title=theme.title;
    for (const brand of document.querySelectorAll('.brand')) for (const child of brand.childNodes) if (child.nodeType===3 && child.textContent.includes('WordNCode Agent Office')) child.textContent=child.textContent.replace('WordNCode Agent Office',theme.brand);
    if (!skip && !chosen && !valid(query)) show(); // 처음 진입(저장값·주소 지정 없음)일 때만 묻는다. 이후 변경은 경로 단추·설정 '공간 테마'
  });
  return {current, theme, isZoo:current === 'zoo', show, control, get reduce(){try{return mqReduce.matches;}catch{return false;}}};
})();
