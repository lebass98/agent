/* 휴대폰 앱(Android WebView)에 화면 테마를 알려 상단 상태바 글자·아이콘 색을 맞춘다.
   앱의 AgentApp 다리가 있을 때만 동작한다(브라우저에서는 아무것도 하지 않음). <html data-theme> 또는 시스템 설정을 따른다. */
(() => {
  const app = window.AgentApp;
  if (!app || typeof app.setDarkUi !== "function") return;
  const mq = matchMedia("(prefers-color-scheme: dark)");
  let last = null;
  const tell = () => {
    const t = document.documentElement.dataset.theme;
    const dark = t ? t === "dark" : mq.matches;
    if (dark !== last) { last = dark; try { app.setDarkUi(dark); } catch {} }
  };
  new MutationObserver(tell).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  mq.addEventListener?.("change", tell);
  tell();
})();
