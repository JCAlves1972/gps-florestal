/* GPS Florestal - Navegação automática pelas estradas disponíveis.
   Os destinos são salvos por fazenda. Não altera inventário, PDF, pontos ou medições. */
(function(){
'use strict';
const css = `#navCard .nav-hint{background:#eef6ee;border-radius:9px;padding:10px;font-size:13px;margin:8px 0}
#navCard .nav-status{font-size:13px;color:#435548;margin:8px 0;min-height:18px;white-space:pre-line}
#navCard .nav-metric{background:#f5f8f4;border-radius:9px;padding:10px}
#navCard .nav-metric span{display:block;color:#617064;font-size:12px}
#navCard .nav-metric strong{font-size:16px}
#navCard .nav-steps{padding-left:22px;font-size:13px;line-height:1.45}
#navCard .nav-steps li{margin:5px 0}
#navCard button:disabled{opacity:.45;cursor:not-allowed}`;
const ui = `<section class="card" id="navCard">
<h2>🧭 Navegação Florestal</h2>
<p class="nav-hint">Escolha um destino salvo ou marque um novo ponto no mapa. O aplicativo usa sua posição GPS e procura um caminho pelas estradas disponíveis no mapa-base. O PDF continua visível como referência.</p>
<h3>1. Escolher o destino</h3>
<label>Destino salvo ou ponto de campo<select id="navDestinationSelect"><option value="">Selecione um destino</option></select></label>
<label>Ou cadastrar um novo destino<input id="navDestinationName" placeholder="Ex.: Módulo 12, Talhão 003-01, oficina"></label>
<div class="actions"><button id="navPickDestination">Marcar destino no mapa/PDF</button><button id="navSaveDestination" class="secondary" disabled>Salvar destino</button></div>
<p class="nav-status" id="navDestinationStatus">Selecione um ponto salvo ou marque o local final no mapa/PDF.</p>
<div class="actions"><button id="navDeleteDestination" class="danger" disabled>Excluir destino salvo</button></div>
<h3>2. Calcular rota automaticamente</h3>
<div class="grid2"><div class="nav-metric"><span>Distância pela estrada</span><strong id="navDistance">—</strong></div><div class="nav-metric"><span>Tempo estimado</span><strong id="navDuration">—</strong></div></div>
<div class="actions"><button id="navCalculateRoute">Calcular rota</button><button id="navClearRoute" class="secondary">Limpar rota</button></div>
<p class="nav-status" id="navRouteStatus">Aguardando destino e posição GPS.</p>
<h3>Orientações do trajeto</h3><ol id="navSteps" class="nav-steps"><li>A rota aparecerá aqui após o cálculo.</li></ol>
<p class="small">O cálculo precisa de internet e utiliza as estradas existentes na base cartográfica. Caminhos particulares ou estradas que aparecem somente no PDF podem não estar disponíveis para o cálculo. O PDF é uma referência visual, não uma rede de estradas automática. Confira sempre o trajeto no terreno.</p>
</section>`;
document.head.insertAdjacentHTML('beforeend','<style>'+css+'</style>');
const mapCard=document.getElementById('map')?.closest('.card');
if(!mapCard || !window.L) return;
mapCard.insertAdjacentHTML('afterend',ui);
const $=id=>document.getElementById(id);
let selected=null,pending=null,pickMode=false,routeLayer=null,destLayer=null,busy=false;
function farm(){return activeFarm();}
function ensure(){(farms||[]).forEach(f=>{if(!Array.isArray(f.destinations))f.destinations=[];});}
function clearRoute(){
 if(routeLayer)routeLayer.clearLayers();
 $('navDistance').textContent='—';$('navDuration').textContent='—';
 $('navSteps').innerHTML='<li>A rota aparecerá aqui após o cálculo.</li>';
}
function drawDest(){
 if(!destLayer)return;destLayer.clearLayers();
 (farm().destinations||[]).forEach(d=>L.marker([d.lat,d.lon]).addTo(destLayer).bindTooltip(d.name||'Destino'));
 if(pending)L.marker([pending.lat,pending.lon]).addTo(destLayer).bindPopup('Novo destino').openPopup();
}
function render(){
 ensure();const s=$('navDestinationSelect');s.replaceChildren();
 const first=document.createElement('option');first.value='';first.textContent='Selecione um destino';s.append(first);
 const ds=farm().destinations||[];
 if(ds.length){const g=document.createElement('optgroup');g.label='Destinos cadastrados';ds.forEach(d=>{const x=document.createElement('option');x.value='dest:'+d.id;x.textContent=d.name;g.append(x);});s.append(g);}
 const ps=typeof farmPoints==='function'?farmPoints():[];
 if(ps.length){const g=document.createElement('optgroup');g.label='Pontos de campo salvos';ps.forEach(p=>{const x=document.createElement('option');x.value='point:'+p.id;x.textContent=p.name+' • '+p.type;g.append(x);});s.append(g);}
 if(selected){s.value=(selected.source==='point'?'point:':'dest:')+selected.id;if(!s.value)selected=null;}
 $('navDeleteDestination').disabled=!(selected&&selected.source==='dest');drawDest();
}
function choose(value){
 selected=null;clearRoute();
 if(!value){$('navDeleteDestination').disabled=true;$('navDestinationStatus').textContent='Selecione um destino cadastrado ou marque um novo no mapa.';return;}
 const [kind,id]=value.split(':',2);
 if(kind==='dest'){const d=(farm().destinations||[]).find(x=>x.id===id);if(d)selected={...d,source:'dest'};}
 else if(kind==='point'){const p=(typeof farmPoints==='function'?farmPoints():[]).find(x=>x.id===id);if(p)selected={...p,source:'point'};}
 $('navDeleteDestination').disabled=!(selected&&selected.source==='dest');
 $('navDestinationStatus').textContent=selected?'Destino selecionado: '+selected.name:'Destino não encontrado.';
 if(selected&&map)map.setView([selected.lat,selected.lon],Math.max(map.getZoom(),15));
}
$('navDestinationSelect').onchange=e=>choose(e.target.value);
$('navPickDestination').onclick=()=>{
 if(!map){alert('O mapa ainda não está pronto.');return;}
 if(!$('navDestinationName').value.trim()){alert('Digite o nome do destino antes de marcar no mapa.');return;}
 if(typeof measureMode!=='undefined'&&measureMode){measureMode=false;const b=document.getElementById('startMeasure');if(b)b.textContent='Começar a marcar no mapa';const st=document.getElementById('measureStatus');if(st)st.textContent='Medição pausada para marcar o destino.';}
 pending=null;pickMode=true;$('navPickDestination').disabled=true;$('navPickDestination').textContent='Toque no destino no mapa';
 $('navSaveDestination').disabled=true;$('navDestinationStatus').textContent='Agora toque no local exato do destino no mapa ou PDF.';
};
$('navSaveDestination').onclick=()=>{
 if(!pending)return;
 const rec={...pending,id:uid(),createdAt:new Date().toISOString()};
 farm().destinations.push(rec);saveFarms();selected={...rec,source:'dest'};pending=null;
 $('navDestinationName').value='';$('navSaveDestination').disabled=true;$('navPickDestination').disabled=false;
 $('navPickDestination').textContent='Marcar destino no mapa/PDF';render();
 $('navDestinationStatus').textContent='Destino salvo e selecionado. Agora toque em “Calcular rota”.';
};
$('navDeleteDestination').onclick=()=>{
 if(!selected||selected.source!=='dest')return;
 if(!confirm('Excluir o destino '+selected.name+'?'))return;
 farm().destinations=farm().destinations.filter(d=>d.id!==selected.id);selected=null;saveFarms();render();clearRoute();
 $('navDestinationStatus').textContent='Destino excluído.';
};
function onMapClick(e){
 if(!pickMode)return;
 const name=$('navDestinationName').value.trim();
 if(!name){$('navDestinationStatus').textContent='Digite o nome do destino antes de marcar no mapa.';return;}
 pending={name,lat:Number(e.latlng.lat),lon:Number(e.latlng.lng)};pickMode=false;
 $('navSaveDestination').disabled=false;$('navPickDestination').disabled=false;
 $('navPickDestination').textContent='Marcar destino no mapa/PDF';
 $('navDestinationStatus').textContent='Local marcado. Toque em “Salvar destino” para guardar este ponto.';
 drawDest();
}
function dist(m){return m<1000?Math.round(m)+' m':(m/1000).toFixed(2).replace('.',',')+' km';}
function duration(s){const m=Math.round(s/60);return m<60?m+' min':Math.floor(m/60)+' h '+m%60+' min';}
function instruction(step){
 const m=step.maneuver||{};
 const names={depart:'Siga',arrive:'Chegada ao destino',turn:'Vire',merge:'Entre',fork:'Mantenha-se','on ramp':'Acesse a via','off ramp':'Saia da via',roundabout:'Na rotatória, siga',rotary:'Na rotatória, siga',continue:'Continue','end of road':'No final da via, vire'};
 const directions={left:'à esquerda',right:'à direita','slight left':'levemente à esquerda','slight right':'levemente à direita','sharp left':'acentuadamente à esquerda','sharp right':'acentuadamente à direita',straight:'em frente',uturn:'faça o retorno'};
 let t=names[m.type]||'Continue';if(m.modifier)t+=' '+(directions[m.modifier]||m.modifier);if(step.name)t+=' pela '+step.name;return t;
}
async function calculate(){
 if(busy)return;
 if(!currentPosition){$('navRouteStatus').textContent='Aguardando posição GPS. Ative a localização e aguarde a posição aparecer.';return;}
 if(!selected){$('navRouteStatus').textContent='Selecione um destino na lista ou salve o novo destino marcado no mapa.';return;}
 if(!navigator.onLine){$('navRouteStatus').textContent='Sem conexão com a internet. Esta versão precisa de conexão para calcular o caminho.';return;}
 const start=currentPosition,end=selected;
 if(![start.lat,start.lon,end.lat,end.lon].every(Number.isFinite)){$('navRouteStatus').textContent='As coordenadas da posição ou do destino são inválidas.';return;}
 busy=true;$('navCalculateRoute').disabled=true;$('navRouteStatus').textContent='Procurando um caminho pelas estradas disponíveis…';clearRoute();
 try{
  const url='https://router.project-osrm.org/route/v1/driving/'+start.lon+','+start.lat+';'+end.lon+','+end.lat+'?overview=full&geometries=geojson&steps=true&alternatives=false';
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);let response;
  try{response=await fetch(url,{signal:controller.signal,headers:{Accept:'application/json'}});}finally{clearTimeout(timer);}
  if(!response.ok)throw new Error('O serviço de cálculo de rotas está indisponível (código HTTP '+response.status+').');
  const data=await response.json();
  if(data.code!=='Ok'||!data.routes?.length)throw new Error(data.message||'Não foi encontrado um caminho conectado entre sua posição e o destino.');
  const r=data.routes[0],ll=r.geometry.coordinates.map(c=>[c[1],c[0]]);
  routeLayer.clearLayers();L.polyline(ll,{color:'#1769d2',weight:7,opacity:.94,lineCap:'round',lineJoin:'round'}).addTo(routeLayer);
  L.circleMarker([start.lat,start.lon],{radius:8,color:'#fff',weight:3,fillColor:'#1677ee',fillOpacity:1}).addTo(routeLayer).bindPopup('Sua posição GPS');
  L.marker([end.lat,end.lon]).addTo(routeLayer).bindPopup('Destino: '+(end.name||'Destino'));
  map.fitBounds(L.latLngBounds(ll),{padding:[35,35],maxZoom:17});
  $('navDistance').textContent=dist(r.distance);$('navDuration').textContent=duration(r.duration);
  const steps=(r.legs||[]).flatMap(l=>l.steps||[]).filter(s=>s.distance>2),list=$('navSteps');list.replaceChildren();
  steps.forEach(s=>{const li=document.createElement('li');li.textContent=instruction(s)+' — '+dist(s.distance);list.append(li);});
  if(!steps.length){const li=document.createElement('li');li.textContent='Siga a linha azul até o destino.';list.append(li);}
  $('navRouteStatus').textContent='Rota calculada pelas estradas disponíveis no mapa-base. Confira as condições e o acesso no local.';
 }catch(err){
  $('navRouteStatus').textContent=err.name==='AbortError'?'O cálculo demorou demais. Verifique a conexão e tente novamente.':'Não foi possível calcular a rota: '+err.message;
 }finally{busy=false;$('navCalculateRoute').disabled=false;}
}
$('navCalculateRoute').onclick=calculate;
$('navClearRoute').onclick=()=>{clearRoute();$('navRouteStatus').textContent='Rota limpa. Os destinos salvos foram mantidos.';};
const oldRefresh=refreshFarmUI;
refreshFarmUI=function(){selected=null;pending=null;pickMode=false;clearRoute();oldRefresh();render();};
const oldSetPoints=setPoints;
setPoints=function(p){oldSetPoints(p);render();};
ensure();routeLayer=L.layerGroup().addTo(map);destLayer=L.layerGroup().addTo(map);
map.off('click',onMapClick);map.on('click',onMapClick);
map.whenReady(()=>{$('navDestinationStatus').textContent='Mapa pronto. Escolha ou marque o destino.';});
render();
})();