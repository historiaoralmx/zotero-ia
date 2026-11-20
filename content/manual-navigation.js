/* The same controller runs in Zotero's chrome window and an ordinary browser. */
(function () {
  const q=document.getElementById("manual-search");
  const sections=[...document.querySelectorAll("[data-chapter]")];
  const count=document.getElementById("search-count"),empty=document.getElementById("search-empty");
  const norm=s=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  function filter(){
    const terms=norm(q.value).trim().split(/\s+/).filter(Boolean);let found=0;
    for(const section of sections){section.hidden=!terms.every(t=>norm(section.textContent).includes(t));if(!section.hidden)found++;}
    count.textContent=terms.length?found+" apartados encontrados":sections.length+" apartados · Manual completo";
    empty.hidden=found>0;
  }
  q.addEventListener("input",filter);
  document.getElementById("reset-search").addEventListener("click",()=>{q.value="";filter();q.focus();});
  // Fragment navigation is suppressed in Zotero's privileged HTML windows.
  // Reveal filtered chapters first, then scroll/focus the actual target node.
  for(const link of document.querySelectorAll('a[href^="#"]')){
    link.addEventListener("click",event=>{
      const id=link.getAttribute("href").slice(1),target=document.getElementById(id);
      if(!target)return;
      event.preventDefault();q.value="";filter();
      for(const a of document.querySelectorAll("nav a")){
        if(a.getAttribute("href")==="#"+id)a.setAttribute("aria-current","location");else a.removeAttribute("aria-current");
      }
      target.setAttribute("tabindex","-1");target.focus({preventScroll:true});
      target.scrollIntoView({behavior:"instant",block:"start",inline:"nearest"});
    });
  }
  document.getElementById("print-manual").addEventListener("click",()=>window.print());
  filter();
})();
