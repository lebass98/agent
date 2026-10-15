"use strict";
/* 외형은 모델·역할과 독립적이며 이 브라우저에만 저장한다. */
window.CharacterLooks = (() => {
  const list = [
    { id: "claude", label: "클로드", age: null },
    { id: "gpt", label: "지피티", age: null },
    { id: "gemini", label: "제미니", age: null },
    {"id":"hana","label":"하나","age":24},
    {"id":"jun","label":"준","age":27},
    {"id":"sora","label":"소라","age":31},
    {"id":"min","label":"민","age":29},
    {"id":"doyoon","label":"도윤","age":34},
    {"id":"jiyu","label":"지유","age":26},
    {"id":"hyunwoo","label":"현우","age":38},
    { id: "seojin", label: "서진", age: 43 },
    { id: "taeho", label: "태호", age: 48 },
    { id: "sungwoo", label: "성우", age: 45 },
  ];
  const valid = id => list.some(p => p.id === id);
  const storageKey = name => `agentOffice.appearance.${name}`;
  function get(name) {
    let saved;
    try { saved = localStorage.getItem(storageKey(name)); } catch {}
    return valid(saved) ? saved : name;
  }
  function set(name, id) {
    if (!valid(id)) return false;
    overrides.set(name, id);
    try { localStorage.setItem(storageKey(name), id); } catch {}
    return true;
  }
  const overrides = new Map();
  return { list, get: name => overrides.get(name) || get(name), set };
})();
