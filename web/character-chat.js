"use strict";
/* 대화는 브라우저 메모리에만 보관하며 팀 업무 이벤트와 분리한다. */
window.CharacterChat=(()=>{
  const chats=new Map();let pendingName='';
  function open(name){
    const a=A(name);if(!a)return;
    window.OfficeLife?.interrupt();
    const greeting=`네, ${a.def.label}입니다. 무엇을 도와드릴까요?`;
    a.say(greeting,6000);if(!chats.has(name))chats.set(name,[]);
    if(pendingName){toast('이전 질문에 답변 중이에요. 잠시 후 다시 말 걸어 주세요.','info');return;}
    const transcript=el('div',{class:'character-transcript',role:'log','aria-label':`${a.def.label}와의 대화`});
    const status=el('p',{class:'muted small',role:'status'});
    const input=el('textarea',{id:'characterQuestion',class:'key-input',rows:2,maxlength:4000,placeholder:`${a.def.label}에게 질문하기…`,'aria-label':`${a.def.label}에게 보낼 질문`});
    const send=el('button',{class:'btn',type:'submit',text:'보내기'});
    const add=(role,text)=>{transcript.append(el('div',{class:`character-message ${role}`},el('strong',{text:role==='user'?'나':a.def.label}),role==='assistant'?md(text):el('p',{text})));transcript.scrollTop=transcript.scrollHeight;};
    add('assistant',greeting);for(const m of chats.get(name))add(m.role,m.content);
    const form=el('form',{id:'characterChat',class:'sheet-form',onsubmit:async e=>{
      e.preventDefault();const message=input.value.trim();if(!message||pendingName)return;
      if(NET.mode!=='live'){status.textContent='서버에 연결하면 해당 팀원이 직접 답할 수 있어요.';return;}
      if(D.running||UI.submitting){status.textContent='팀 업무를 진행 중이에요. 업무가 끝나면 질문해 주세요.';a.say('지금 업무 중이에요. 끝나면 바로 이야기해요!',5000);return;}
      const history=chats.get(name).slice(-10);while(history.reduce((n,m)=>n+m.content.length,0)>22000)history.shift();
      pendingName=name;send.disabled=input.disabled=true;updateInput();
      add('user',message);input.value='';status.textContent='답변을 생각하고 있어요…';a.say('네, 확인하고 답해 드릴게요.',7000);
      try{
        const r=await api('/api/ask',{method:'POST',body:JSON.stringify({name,message,history})});
        const data=await r.json();if(!r.ok)throw new Error(typeof data.detail==='string'?data.detail:'답변을 받지 못했어요.');
        const answer=String(data.answer||'응답 내용이 없습니다.');
        chats.get(name).push({role:'user',content:message},{role:'assistant',content:answer});
        if(chats.get(name).length>20)chats.set(name,chats.get(name).slice(-20));
        add('assistant',answer);status.textContent=data.mock?'모의 답변 · 실제 실행에서는 연결된 모델이 응답합니다.':'';
        a.say(clip(answer.replace(/[#*_`]/g,''),160),12000);
        if(!form.isConnected)toast(`${a.def.label}의 답변이 도착했어요. 다시 클릭하면 볼 수 있어요.`,'info',6000);
      }catch(error){status.textContent=error.message;input.value=message;a.say('답변 연결을 확인해 주세요.',5000);}
      finally{pendingName='';send.disabled=input.disabled=false;updateInput();if(form.isConnected)input.focus({preventScroll:true});}
    }},el('div',{class:'sheet-body'},transcript,
      el('div',{class:'character-quick'},
        el('button',{type:'button',class:'tbtn',text:'지금 뭐 해?',onclick:()=>{const s=a.card?.st||IDLE;const text=s.task&&s.task!=='—'?`지금은 ${s.task} 중이에요.`:'다음 업무를 기다리고 있어요. 편하게 말 걸어 주세요.';add('assistant',text);a.say(text,7000);}}),
        el('button',{type:'button',class:'tbtn',text:'어떤 일을 맡고 있어?',onclick:()=>{const text=`저는 ${a.def.role} 역할을 맡고 있어요.`;add('assistant',text);a.say(text,7000);}}),
        el('button',{type:'button',class:'tbtn',text:'대화 지우기',onclick:()=>{if(pendingName)return;chats.set(name,[]);transcript.replaceChildren();add('assistant',greeting);}})),input,status),el('footer',{class:'sheet-foot'},send));
    openModal([sheetHead(`${a.def.label}에게 말 걸기`,`${a.def.role} · ${NET.mode!=='live'?'서버 연결 필요':D.mock?'모의 대화':'팀원과 직접 대화'}`),form],true);
    input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();form.requestSubmit();}});
    if(!matchMedia('(pointer: coarse)').matches)input.focus({preventScroll:true});
  }
  return {open,get pending(){return !!pendingName;},get isOpen(){return !!document.getElementById('characterChat');}};
})();
