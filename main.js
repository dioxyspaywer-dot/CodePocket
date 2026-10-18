import './style.css';
import {EditorView,basicSetup} from 'codemirror';
import {EditorState} from '@codemirror/state';
import {undo,redo} from '@codemirror/commands';
import {oneDark} from '@codemirror/theme-one-dark';
import {javascript} from '@codemirror/lang-javascript';
import {html} from '@codemirror/lang-html';
import {css} from '@codemirror/lang-css';
import {json} from '@codemirror/lang-json';
import {python} from '@codemirror/lang-python';
import {markdown} from '@codemirror/lang-markdown';
import JSZip from 'jszip';
import {get,set} from 'idb-keyval';
import {Filesystem,Directory} from '@capacitor/filesystem';
import {Share} from '@capacitor/share';

const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let S={files:{},commits:[],objs:{},pushed:{},base:'',cfg:{token:'',repo:'',branch:'main'},theme:'rouge',open:null,collapsed:[],tab:'f'};
let timer;const save=()=>{clearTimeout(timer);timer=setTimeout(()=>set('s',S),400)};
const hash=s=>{let h=5381;for(let i=0;i<s.length;i++)h=(h*33^s.charCodeAt(i))>>>0;return h.toString(36)+s.length};
const val=f=>f.t!==undefined?f.t:f.b, hf=f=>hash(val(f));
const toast=m=>{const t=$('#toast');t.textContent=m;t.classList.add('on');setTimeout(()=>t.classList.remove('on'),2800)};
const bytesToFile=u=>{try{const t=new TextDecoder('utf-8',{fatal:true}).decode(u);if(!t.includes('\0'))return{t}}catch{}let s='';for(let i=0;i<u.length;i+=8192)s+=String.fromCharCode(...u.subarray(i,i+8192));return{b:btoa(s)}};

/* Éditeur */
const LG={js:javascript(),mjs:javascript(),jsx:javascript({jsx:true}),ts:javascript({typescript:true}),tsx:javascript({jsx:true,typescript:true}),html:html(),htm:html(),css:css(),json:json(),py:python(),md:markdown()};
const lang=p=>LG[(p.split('.').pop()||'').toLowerCase()]||[];
const mk=(doc,p)=>EditorState.create({doc,extensions:[basicSetup,oneDark,lang(p),EditorView.lineWrapping,EditorView.updateListener.of(u=>{if(u.docChanged&&S.open){S.files[S.open]={t:u.state.doc.toString()};save()}})]});
const view=new EditorView({parent:$('#cm'),state:mk('','')});
const ins=t=>{view.dispatch(view.state.replaceSelection(t));view.focus()};

/* Fenêtres */
const M=()=>$('#modal');
const ask=(title,v,ok='OK')=>new Promise(res=>{const m=M();m.onclick=null;m.innerHTML=`<div class="box"><h3>${esc(title)}</h3>${v!==null?`<input id="qi" value="${esc(v)}" autocapitalize="off" spellcheck="false">`:''}<button class="pr" id="qo">${ok}</button><button id="qc">Annuler</button></div>`;m.classList.add('on');const d=x=>{m.classList.remove('on');res(x)};$('#qo').onclick=()=>d(v!==null?$('#qi').value.trim():true);$('#qc').onclick=()=>d(null);if(v!==null)$('#qi').focus()});
const sheet=(title,items)=>{const m=M();m.innerHTML=`<div class="box"><h3>${esc(title)}</h3>${items.map((x,i)=>`<button data-i="${i}">${x[0]}</button>`).join('')}<button id="qc">Fermer</button></div>`;m.classList.add('on');m.onclick=e=>{if(e.target===m||e.target.id==='qc')return m.classList.remove('on');const b=e.target.closest('[data-i]');if(b){m.classList.remove('on');items[b.dataset.i][1]()}}};

/* Rendu */
const status=()=>{const head=S.commits.at(-1)?.tree||{},cur={},ch=[];for(const p in S.files)cur[p]=hf(S.files[p]);for(const p in cur)if(!(p in head))ch.push([p,'A']);else if(head[p]!==cur[p])ch.push([p,'M']);for(const p in head)if(!(p in cur))ch.push([p,'D']);return{cur,ch}};
const nodeHtml=(n,base,d)=>{let h='';const pad=`style="padding-left:${8+d*14}px"`;for(const k of Object.keys(n.d).sort()){const p=base+k,c=S.collapsed.includes(p);h+=`<div class="row" ${pad}><span data-a="tog" data-v="${esc(p)}">${c?'▸':'▾'} ${esc(k)}</span><button class="m" data-a="md" data-v="${esc(p)}">⋯</button></div>`;if(!c)h+=nodeHtml(n.d[k],p+'/',d+1)}for(const p of n.f)h+=`<div class="row${p===S.open?' sel':''}" ${pad}><span data-a="open" data-v="${esc(p)}">${esc(p.split('/').pop())}</span><button class="m" data-a="mf" data-v="${esc(p)}">⋯</button></div>`;return h};
const rF=()=>{const root={d:{},f:[]};for(const p of Object.keys(S.files).sort()){let n=root;const ps=p.split('/');for(const k of ps.slice(0,-1))n=n.d[k]??={d:{},f:[]};n.f.push(p)}
$('#p-f').innerHTML=`<div class="grid"><button data-a="nf">Nouveau fichier</button><button data-a="nd">Nouveau dossier</button><button data-a="up">Importer des fichiers</button><button data-a="zi">Importer un ZIP</button><button class="wide" data-a="ze">Exporter en ZIP</button></div>`+(Object.keys(S.files).length?nodeHtml(root,'',0):'<p class="mu">Aucun fichier. Crée un fichier ou importe un ZIP pour commencer.</p>')};
const rS=()=>{$('#p-s').innerHTML=`<input id="q" placeholder="Rechercher dans tous les fichiers"><input id="r" placeholder="Remplacer par"><button data-a="rep">Tout remplacer</button><div id="sres"></div>`};
const rG=()=>{const{ch}=status();$('#p-g').innerHTML=`<input id="msg" placeholder="Message du commit"><button class="pr" data-a="com">Valider (commit)</button><h4>Modifications (${ch.length})</h4>`+(ch.map(c=>`<div class="row" data-a="dif" data-v="${esc(c[0])}"><b class="k ${c[1]}">${c[1]}</b><span>${esc(c[0])}</span></div>`).join('')||'<p class="mu">Rien à valider.</p>')+`<h4>Historique</h4>`+(S.commits.map((c,i)=>`<div class="row"><span>${esc(c.msg)}<br><small class="mu">${c.id}</small><br><small class="mu">${new Date(c.time).toLocaleString('fr-FR')}</small></span><button class="m" data-a="rst" data-v="${i}">Restaurer</button></div>`).reverse().join('')||'<p class="mu">Aucun commit.</p>')};
const rH=()=>{$('#p-h').innerHTML=`<p class="mu">Crée un token « fine-grained » (GitHub, Settings, Developer settings). Choisis « Only select repositories » et ton dépôt. Permissions : Contents en lecture et écriture, Metadata en lecture.</p><input id="tk" type="password" placeholder="Token GitHub" value="${esc(S.cfg.token)}"><input id="rp" placeholder="URL du dépôt ou propriétaire/dépôt" value="${esc(S.cfg.repo)}"><input id="br" placeholder="Branche" value="${esc(S.cfg.branch)}"><div class="grid"><button class="wide pr" data-a="tst">Tester le token</button><button data-a="pull">Pull</button><button data-a="push">Push</button></div><pre id="ghs" class="mu"></pre>`};
const render=()=>{$('#title').textContent=S.open||'Aucun fichier ouvert';document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.v===S.tab));document.querySelectorAll('.pane').forEach(p=>p.classList.toggle('on',p.id==='p-'+S.tab));({f:rF,g:rG,h:rH,s:rS})[S.tab]()};
const refresh=()=>{render();save()};
const openFile=p=>{const f=S.files[p];if(!f)return;if(f.b!==undefined)return toast('Fichier binaire, non modifiable');S.open=p;view.setState(mk(f.t,p));document.body.classList.remove('menu');refresh()};
const closeEd=()=>{S.open=null;view.setState(mk('',''))};

/* GitHub */
const repoPath=()=>{const m=S.cfg.repo.match(/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);if(!m)throw new Error('URL du dépôt invalide');return`/repos/${m[1]}/${m[2]}`};
const nice=e=>{const s=e.message;return s.startsWith('401')?'Token invalide ou expiré.':s.startsWith('403')?'Permission manquante : ajoute Contents en lecture et écriture au token.':s.startsWith('404')?'Introuvable : vérifie le dépôt, la branche, et que le token a accès à ce dépôt.':s.startsWith('409')?'Dépôt vide : crée d’abord un premier commit (un README) sur GitHub.':s};
const gh=async(path,o={})=>{const r=await fetch('https://api.github.com'+path,{...o,headers:{Authorization:'Bearer '+S.cfg.token,Accept:'application/vnd.github+json'},body:o.body&&JSON.stringify(o.body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(r.status+' '+(j.message||''));return j};
const log=m=>{const e=$('#ghs');if(e)e.textContent=m};
const doCommit=msg=>{const{cur,ch}=status();if(!ch.length)return false;for(const p in cur)S.objs[cur[p]]=S.files[p];S.commits.push({id:hash(JSON.stringify(cur)+Date.now()).slice(0,7),msg,time:Date.now(),tree:cur});return true};

const A={
menu:()=>document.body.classList.toggle('menu'),
tab:v=>{S.tab=v;render()},
open:v=>openFile(v),
tog:v=>{const i=S.collapsed.indexOf(v);i<0?S.collapsed.push(v):S.collapsed.splice(i,1);refresh()},
nf:async(base='')=>{let p=await ask('Nouveau fichier',base+'nom.js');if(!p)return;p=p.replace(/^\/+/,'');if(S.files[p])return toast('Ce fichier existe déjà');S.files[p]={t:''};openFile(p)},
nd:async()=>{const p=await ask('Nouveau dossier','src/components');if(p){S.files[p.replace(/\/+$/,'')+'/.gitkeep']={t:''};refresh()}},
mf:v=>sheet(v,[['Renommer',()=>A.ren(v)],['Supprimer',()=>A.del(v)]]),
md:v=>sheet(v,[['Nouveau fichier ici',()=>A.nf(v+'/')],['Renommer le dossier',()=>A.rend(v)],['Supprimer le dossier',()=>A.deld(v)]]),
ren:async v=>{const n=await ask('Renommer',v);if(n&&n!==v){S.files[n]=S.files[v];delete S.files[v];if(S.open===v)S.open=n;refresh()}},
rend:async v=>{const n=await ask('Renommer le dossier',v);if(!n||n===v)return;for(const p of Object.keys(S.files))if(p.startsWith(v+'/')){const q=n+p.slice(v.length);S.files[q]=S.files[p];delete S.files[p];if(S.open===p)S.open=q}refresh()},
del:async v=>{if(await ask('Supprimer '+v+' ?',null,'Supprimer')){delete S.files[v];if(S.open===v)closeEd();refresh()}},
deld:async v=>{if(await ask('Supprimer le dossier '+v+' et son contenu ?',null,'Supprimer')){for(const p of Object.keys(S.files))if(p.startsWith(v+'/')){delete S.files[p];if(S.open===p)closeEd()}refresh()}},
up:()=>pick(true,async fs=>{for(const f of fs)S.files[f.name]=bytesToFile(new Uint8Array(await f.arrayBuffer()));toast(fs.length+' fichier(s) importé(s)');refresh()}),
zi:()=>pick(false,async([f])=>{if(!f)return;try{const z=await JSZip.loadAsync(f);let ns=Object.keys(z.files).filter(n=>!z.files[n].dir&&!/^__MACOSX|(^|\/)\.git\//.test(n));const top=ns[0]?.split('/')[0];const strip=ns.length>1&&ns.every(n=>n.startsWith(top+'/'));for(const n of ns)S.files[strip?n.slice(top.length+1):n]=bytesToFile(await z.files[n].async('uint8array'));toast(ns.length+' fichiers extraits');refresh()}catch(e){toast('ZIP illisible')}}),
ze:async()=>{try{const z=new JSZip();for(const p in S.files){const f=S.files[p];z.file(p,val(f),f.t!==undefined?{}:{base64:true})}const data=await z.generateAsync({type:'base64'});const r=await Filesystem.writeFile({path:'projet.zip',data,directory:Directory.Cache});await Share.share({title:'projet.zip',url:r.uri})}catch(e){toast('Export impossible : '+e.message)}},
theme:()=>sheet('Thème',[['Rouge','rouge'],['Vert','vert'],['Bleu','bleu'],['Violet','violet'],['Ambre','ambre']].map(([l,t])=>[l,()=>{S.theme=t;document.documentElement.dataset.theme=t;save()}])),
prev:()=>{const f=S.files[S.open];if(!f||!/\.html?$/.test(S.open))return toast('L’aperçu fonctionne avec un fichier HTML');const n=u=>S.files[u.replace(/^\.?\//,'')]?.t;let h=f.t.replace(/<link[^>]+href="([^"]+\.css)"[^>]*>/g,(m,u)=>n(u)!==undefined?`<style>${n(u)}</style>`:m).replace(/<script([^>]*) src="([^"]+)"([^>]*)><\/script>/g,(m,a,u)=>n(u)!==undefined?`<script>${n(u)}<\/script>`:m);const m=M();m.onclick=null;m.innerHTML='<div class="box big"><button id="qc">Fermer</button><iframe sandbox="allow-scripts"></iframe></div>';m.querySelector('iframe').srcdoc=h;m.classList.add('on');$('#qc').onclick=()=>m.classList.remove('on')},
com:()=>{const msg=$('#msg').value.trim()||'Mise à jour';toast(doCommit(msg)?'Commit créé':'Rien à valider');refresh()},
dif:v=>{const head=S.commits.at(-1)?.tree||{};const o=(S.objs[head[v]]?.t||'').split('\n'),n=(S.files[v]?.t||'').split('\n');const so=new Set(o),sn=new Set(n);const out=[...o.filter(l=>!sn.has(l)).map(l=>'<span class="D">- '+esc(l)+'</span>'),...n.filter(l=>!so.has(l)).map(l=>'<span class="A">+ '+esc(l)+'</span>')].slice(0,300).join('\n');const m=M();m.onclick=null;m.innerHTML=`<div class="box"><h3>${esc(v)}</h3><pre>${out||'Fichier binaire ou vide'}</pre><button id="qc">Fermer</button></div>`;m.classList.add('on');$('#qc').onclick=()=>m.classList.remove('on')},
rst:async i=>{const c=S.commits[i];if(await ask('Restaurer le commit '+c.id+' dans l’espace de travail ?',null,'Restaurer')){S.files={};for(const p in c.tree)S.files[p]=S.objs[c.tree[p]];closeEd();refresh()}},
goto:v=>{const i=v.lastIndexOf(':');openFile(v.slice(0,i));try{view.dispatch({selection:{anchor:view.state.doc.line(+v.slice(i+1)).from},scrollIntoView:true})}catch{}},
rep:async()=>{const q=$('#q').value,r=$('#r').value;if(!q)return;let c=0;for(const p in S.files){const f=S.files[p];if(f.t!==undefined&&f.t.includes(q)){c++;S.files[p]={t:f.t.split(q).join(r)}}}if(S.open&&S.files[S.open])view.setState(mk(S.files[S.open].t,S.open));toast(c+' fichier(s) modifié(s)');save()},
tst:async()=>{try{log('Test en cours…');const u=await gh('/user'),R=repoPath(),r=await gh(R),b=await gh(R+'/branches/'+S.cfg.branch);log(`Connecté : ${u.login}\nDépôt : ${r.full_name}\nLecture : oui\nÉcriture : ${r.permissions?.push?'oui':'non (ajoute Contents en lecture et écriture)'}\nBranche ${b.name} : trouvée\n${S.base?(b.commit.sha===S.base?'À jour avec GitHub':'GitHub a de nouveaux changements : fais un Pull'):'Pas encore de Pull'}`)}catch(e){log(nice(e))}},
push:async()=>{try{const hd=S.commits.at(-1);if(!hd)return log('Fais d’abord un commit (onglet Git).');log('Envoi en cours…');const R=repoPath(),br=S.cfg.branch;const ref=await gh(`${R}/git/ref/heads/${br}`),sha=ref.object.sha;if(S.base&&sha!==S.base&&!await ask('GitHub a changé depuis ton dernier Pull. Envoyer quand même ? Tes fichiers modifiés écraseront ceux de GitHub.',null,'Envoyer'))return log('Push annulé. Fais un Pull d’abord.');const c=await gh(`${R}/git/commits/${sha}`),tree=[];let n=0;for(const p in hd.tree){if(S.pushed[p]===hd.tree[p])continue;const f=S.objs[hd.tree[p]];const b=await gh(`${R}/git/blobs`,{method:'POST',body:{content:val(f),encoding:f.t!==undefined?'utf-8':'base64'}});tree.push({path:p,mode:'100644',type:'blob',sha:b.sha});n++}for(const p in S.pushed)if(!(p in hd.tree)){tree.push({path:p,mode:'100644',type:'blob',sha:null});n++}if(!n)return log('Rien de nouveau à envoyer.');const t=await gh(`${R}/git/trees`,{method:'POST',body:{base_tree:c.tree.sha,tree}}),nc=await gh(`${R}/git/commits`,{method:'POST',body:{message:hd.msg,tree:t.sha,parents:[sha]}});await gh(`${R}/git/refs/heads/${br}`,{method:'PATCH',body:{sha:nc.sha}});S.pushed={...hd.tree};S.base=nc.sha;save();log(`Push réussi : ${n} changement(s) sur ${br}.`)}catch(e){log(nice(e))}},
pull:async()=>{try{if(!await ask('Remplacer les fichiers locaux par ceux de GitHub ?',null,'Pull'))return;log('Téléchargement…');const R=repoPath(),ref=await gh(`${R}/git/ref/heads/${S.cfg.branch}`),c=await gh(`${R}/git/commits/${ref.object.sha}`),t=await gh(`${R}/git/trees/${c.tree.sha}?recursive=1`),fs={};for(const it of t.tree.filter(x=>x.type==='blob')){const b=await gh(`${R}/git/blobs/${it.sha}`);fs[it.path]=bytesToFile(Uint8Array.from(atob(b.content.replace(/\n/g,'')),ch=>ch.charCodeAt(0)))}S.files=fs;S.base=ref.object.sha;closeEd();doCommit('Pull depuis GitHub');S.pushed={...S.commits.at(-1).tree};refresh();log(Object.keys(fs).length+' fichiers récupérés.')}catch(e){log(nice(e))}}
};
const pick=(multi,cb)=>{const i=document.createElement('input');i.type='file';i.multiple=multi;i.onchange=()=>cb([...i.files]);i.click()};

document.addEventListener('click',e=>{const x=e.target.closest('[data-a]');if(x&&A[x.dataset.a])A[x.dataset.a](x.dataset.v)});
$('#side').addEventListener('input',e=>{const id=e.target.id,v=e.target.value;if(id==='tk')S.cfg.token=v.trim();else if(id==='rp')S.cfg.repo=v.trim();else if(id==='br')S.cfg.branch=v.trim()||'main';else if(id==='q'){let h='',n=0;if(v)for(const p in S.files){const f=S.files[p];if(f.t===undefined)continue;f.t.split('\n').forEach((l,i)=>{if(n<100&&l.includes(v)){n++;h+=`<div class="row" data-a="goto" data-v="${esc(p)}:${i+1}"><span>${esc(p)}:${i+1}  ${esc(l.trim().slice(0,60))}</span></div>`}})}$('#sres').innerHTML=h||(v?'<p class="mu">Aucun résultat.</p>':'');return}save()});
const KEYS=[['Tab','  '],['{','{'],['}','}'],['(','('],[')',')'],['[','['],[']',']'],[';',';'],['"','"'],["'","'"],['<','<'],['>','>'],['=','='],['/','/'],['↶',0],['↷',1]];
$('#keys').innerHTML=KEYS.map((k,i)=>`<button data-k="${i}">${esc(k[0])}</button>`).join('');
$('#keys').addEventListener('pointerdown',e=>e.preventDefault());
$('#keys').addEventListener('click',e=>{const b=e.target.closest('[data-k]');if(!b)return;const k=KEYS[b.dataset.k][1];if(k===0)undo(view);else if(k===1)redo(view);else ins(k);view.focus()});

let told='';const checkRemote=async()=>{try{if(!S.cfg.token||!S.cfg.repo||!S.base)return;const r=await gh(`${repoPath()}/git/ref/heads/${S.cfg.branch}`);if(r.object.sha===S.base||r.object.sha===told)return;told=r.object.sha;if(await ask('GitHub a changé depuis ton dernier Pull. Fais un Pull avant de continuer à modifier.',null,'Aller au Pull')){S.tab='h';document.body.classList.add('menu');render()}}catch{}};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkRemote()});
(async()=>{const x=await get('s');if(x)S={...S,...x};document.documentElement.dataset.theme=S.theme;S.open&&S.files[S.open]?openFile(S.open):render();checkRemote()})();
