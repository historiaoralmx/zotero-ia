/* global Zotero, ZoteroIA, Services */
(function () {
  const Z=ZoteroIA;
  const H=Z.help={
    window:null,
    openManual(){
      if(this.window&&!this.window.closed){this.window.focus();return this.window;}
      const w=Services.ww.openWindow(null,"chrome://zotero-ia/content/manual.html","zotero-ia-help","chrome,dialog=no,resizable,width=1080,height=780",null);
      this.window=w;
      w.addEventListener("load",()=>{
        w.addEventListener("unload",()=>{if(H.window===w)H.window=null;},{once:true});
      },{once:true});
      return w;
    },
    bindPreferences(document){
      const $=id=>document.getElementById("zia-"+id);
      $("help-manual").addEventListener("click",()=>H.openManual());
    }
  };
})();
