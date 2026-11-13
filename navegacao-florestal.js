/* GPS Florestal - módulo de Navegação Florestal
   Cadastro manual da rede viária e cálculo offline de rotas por Dijkstra.
   Os dados ficam dentro do cadastro de cada fazenda (localStorage existente). */
(function () {
  'use strict';

  const STYLE = `
  #navCard .nav-hint{background:#eef6ee;border-radius:9px;padding:10px;font-size:13px;margin:8px 0}
  #navCard .nav-status{font-size:13px;color:#435548;margin:8px 0;min-height:18px}
  #navCard .nav-metric{background:#f5f8f4;border-radius:9px;padding:10px}
  #navCard .nav-metric span{display:block;color:#617064;font-size:12px}
  #navCard .nav-metric strong{font-size:16px}
  #navCard .nav-list{margin-top:6px}
  #navCard .nav-item{border-top:1px solid #d8e1d8;padding:8px 0;font-size:13px}
  #navCard button:disabled{opacity:.45;cursor:not-allowed}
  .nav-road-label{background:#fff;border:1px solid #24583d;color:#173d2b;padding:2px 5px;border-radius:5px;font-size:11px}
  `;

  const markup = `
  <section class="card" id="navCard">
    <h2>🧭 Navegação Florestal</h2>
    <p class="nav-hint">Cadastre as estradas e caminhos uma vez, desenhando seus trajetos sobre o mapa ou PDF. Depois, o GPS calcula a rota pela rede cadastrada, mesmo sem internet. A rota não é calculada automaticamente a partir da imagem do PDF.</p>

    <h3>1. Cadastrar estradas e caminhos</h3>
    <label>Nome da estrada / caminho<input id="navRoadName" type="text" placeholder="Ex.: Estrada principal, acesso módulo 12"></label>
    <div class="actions">
      <button id="navStartRoad">＋ Iniciar cadastro</button>
      <button id="navFinishRoad" class="secondary" disabled>Concluir e salvar</button>
    </div>
    <div class="actions">
      <button id="navUndoRoad" class="secondary" disabled>Desfazer último ponto</button>
      <button id="navCancelRoad" class="danger" disabled>Cancelar desenho</button>
    </div>
    <p class="nav-status" id="navRoadStatus">Nenhuma estrada em edição. Toque em “Iniciar cadastro” para começar.</p>
    <div class="small" id="navRoadCount">Estradas cadastradas: 0</div>
    <div class="nav-list" id="navRoadList"></div>

    <h3>2. Cadastrar destino</h3>
    <label>Nome do destino<input id="navDestinationName" type="text" placeholder="Ex.: Módulo 12, Talhão 003-01, oficina"></label>
    <div class="actions">
      <button id="navPickDestination">Marcar destino no mapa</button>
      <button id="navSaveDestination" class="secondary" disabled>Salvar destino</button>
    </div>
    <p class="nav-status" id="navDestinationStatus">Escolha um destino no mapa ou selecione um destino já cadastrado.</p>
    <label>Destino para navegação<select id="navDestinationSelect"><option value="">Selecione um destino</option></select></label>
    <button id="navDeleteDestination" class="danger" disabled>Excluir destino selecionado</button>

    <h3>3. Calcular rota pelo GPS</h3>
    <div class="grid2">
      <div class="nav-metric"><span>Distância estimada da rota</span><strong id="navDistance">—</strong></div>
      <div class="nav-metric"><span>Trechos da rede</span><strong id="navSegments">—</strong></div>
    </div>
    <div class="actions">
      <button id="navCalculateRoute">Calcular rota</button>
      <button id="navClearRoute" class="secondary">Limpar rota</button>
    </div>
    <p class="nav-status" id="navRouteStatus">A rota parte da posição GPS atual e segue somente as estradas cadastradas.</p>
    <p class="small">A precisão depende do desenho da rede viária. Marque as estradas pelo centro do caminho e inclua cruzamentos, bifurcações e acessos. A linha entre o GPS e a estrada mais próxima, ou entre a estrada e o destino, é apenas um conector de aproximação.</p>
  </section>`;

  document.head.insertAdjacentHTML('beforeend', '<style>' + STYLE + '</style>');
  const mapCard = document.getElementById('map')?.closest('.card');
  if (!mapCard) return;
  mapCard.insertAdjacentHTML('afterend', markup);
  const $n = id => document.getElementById(id);

  let roadMode = false;
  let roadDraft = [];
  let destinationMode = false;
  let pendingDestination = null;
  let selectedDestination = null;
  let roadLayer = null;
  let draftLayer = null;
  let destinationLayer = null;
  let routeLayer = null;

  function ensureFarmNavigationData() {
    (farms || []).forEach(f => {
      if (!Array.isArray(f.roads)) f.roads = [];
      if (!Array.isArray(f.destinations)) f.destinations = [];
    });
  }

  function activeNavigationFarm() {
    ensureFarmNavigationData();
    return activeFarm();
  }

  function clearDraftLayer() {
    if (draftLayer) draftLayer.clearLayers();
  }

  function clearRoute() {
    if (routeLayer) routeLayer.clearLayers();
    $n('navDistance').textContent = '—';
    $n('navSegments').textContent = '—';
  }

  function stopRoadMode() {
    roadMode = false;
    roadDraft = [];
    clearDraftLayer();
    $n('navStartRoad').disabled = false;
    $n('navFinishRoad').disabled = true;
    $n('navUndoRoad').disabled = true;
    $n('navCancelRoad').disabled = true;
  }

  function stopDestinationMode() {
    destinationMode = false;
    $n('navPickDestination').disabled = false;
    $n('navPickDestination').textContent = 'Marcar destino no mapa';
  }

  function renderRoads() {
    const farm = activeNavigationFarm();
    $n('navRoadCount').textContent = 'Estradas cadastradas: ' + farm.roads.length;
    const root = $n('navRoadList');
    root.replaceChildren();
    if (!farm.roads.length) {
      const p = document.createElement('p'); p.className = 'small'; p.textContent = 'Nenhuma estrada cadastrada nesta fazenda.'; root.append(p);
    }
    farm.roads.forEach(road => {
      const item = document.createElement('div'); item.className = 'nav-item';
      const name = document.createElement('b'); name.textContent = road.name || 'Estrada sem nome';
      const detail = document.createElement('div'); detail.className = 'small'; detail.textContent = (road.vertices || []).length + ' pontos marcados';
      const actions = document.createElement('div'); actions.className = 'actions';
      const view = document.createElement('button'); view.className = 'secondary'; view.textContent = 'Ver no mapa';
      view.onclick = () => {
        if (!map || !road.vertices?.length) return;
        const bounds = L.latLngBounds(road.vertices.map(v => [v.lat, v.lon]));
        map.fitBounds(bounds, {padding:[25,25], maxZoom:17});
      };
      const del = document.createElement('button'); del.className = 'danger'; del.textContent = 'Excluir';
      del.onclick = () => {
        if (!confirm('Excluir a estrada “' + (road.name || 'sem nome') + '”?')) return;
        farm.roads = farm.roads.filter(r => r.id !== road.id);
        saveFarms(); redrawRoadLayer(); renderRoads(); clearRoute();
      };
      actions.append(view, del); item.append(name, detail, actions); root.append(item);
    });
    redrawRoadLayer();
  }

  function redrawRoadLayer() {
    if (!map || !roadLayer) return;
    roadLayer.clearLayers();
    const farm = activeNavigationFarm();
    farm.roads.forEach(road => {
      if (!Array.isArray(road.vertices) || road.vertices.length < 2) return;
      L.polyline(road.vertices.map(v => [v.lat, v.lon]), {
        color: '#16804a', weight: 5, opacity: .88, lineCap: 'round', lineJoin: 'round'
      }).addTo(roadLayer).bindTooltip(road.name || 'Estrada cadastrada');
    });
  }

  function drawRoadDraft() {
    if (!draftLayer) return;
    draftLayer.clearLayers();
    if (!roadDraft.length) return;
    const points = roadDraft.map(v => [v.lat, v.lon]);
    if (points.length >= 2) L.polyline(points, {color:'#f07800',weight:5,dashArray:'7 6'}).addTo(draftLayer);
    roadDraft.forEach((v, i) => L.circleMarker([v.lat,v.lon], {
      radius:6,color:'#fff',weight:2,fillColor:'#f07800',fillOpacity:1
    }).addTo(draftLayer).bindTooltip('Ponto ' + (i + 1)));
    $n('navUndoRoad').disabled = roadDraft.length === 0;
    $n('navFinishRoad').disabled = roadDraft.length < 2;
  }

  function renderDestinations() {
    const farm = activeNavigationFarm();
    const select = $n('navDestinationSelect');
    select.replaceChildren();
    const first = document.createElement('option'); first.value = ''; first.textContent = 'Selecione um destino'; select.append(first);
    if (farm.destinations.length) {
      const group = document.createElement('optgroup'); group.label = 'Destinos cadastrados';
      farm.destinations.forEach(d => {
        const o = document.createElement('option'); o.value = 'dest:' + d.id; o.textContent = d.name; group.append(o);
      });
      select.append(group);
    }
    const points = typeof farmPoints === 'function' ? farmPoints() : [];
    if (points.length) {
      const group = document.createElement('optgroup'); group.label = 'Pontos de campo salvos';
      points.forEach(p => {
        const o = document.createElement('option'); o.value = 'point:' + p.id; o.textContent = p.name + ' • ' + p.type; group.append(o);
      });
      select.append(group);
    }
    if (selectedDestination) {
      const prefix = selectedDestination.source === 'point' ? 'point:' : 'dest:';
      select.value = prefix + selectedDestination.id;
      if (!select.value) selectedDestination = null;
    }
    $n('navDeleteDestination').disabled = !(selectedDestination && selectedDestination.source === 'dest');
    redrawDestinationLayer();
  }

  function redrawDestinationLayer() {
    if (!destinationLayer) return;
    destinationLayer.clearLayers();
    const farm = activeNavigationFarm();
    (farm.destinations || []).forEach(d => {
      L.circleMarker([d.lat,d.lon], {radius:7,color:'#fff',weight:2,fillColor:'#a34ac1',fillOpacity:1})
        .addTo(destinationLayer).bindTooltip(d.name || 'Destino');
    });
    if (pendingDestination) {
      L.marker([pendingDestination.lat,pendingDestination.lon]).addTo(destinationLayer)
        .bindPopup('Destino ainda não salvo: ' + pendingDestination.name).openPopup();
    }
  }

  function chooseDestination(value) {
    selectedDestination = null;
    if (!value) { $n('navDeleteDestination').disabled = true; return; }
    const [kind, id] = value.split(':', 2);
    const farm = activeNavigationFarm();
    if (kind === 'dest') {
      const d = farm.destinations.find(x => x.id === id);
      if (d) selectedDestination = {...d, source:'dest'};
    } else if (kind === 'point') {
      const p = (typeof farmPoints === 'function' ? farmPoints() : []).find(x => x.id === id);
      if (p) selectedDestination = {...p, source:'point'};
    }
    $n('navDeleteDestination').disabled = !(selectedDestination && selectedDestination.source === 'dest');
    if (selectedDestination && map) map.setView([selectedDestination.lat, selectedDestination.lon], Math.max(map.getZoom(), 15));
    $n('navDestinationStatus').textContent = selectedDestination ? 'Destino selecionado: ' + selectedDestination.name : 'Destino não encontrado.';
    clearRoute();
  }

  function addRoadVertex(lat, lon) {
    roadDraft.push({lat:Number(lat), lon:Number(lon)});
    drawRoadDraft();
    $n('navRoadStatus').textContent = roadDraft.length + ' ponto(s) marcado(s). Continue tocando no caminho; marque curvas e cruzamentos.';
  }

  function onMapTap(e) {
    if (roadMode) {
      addRoadVertex(e.latlng.lat, e.latlng.lng);
      return;
    }
    if (destinationMode) {
      const name = $n('navDestinationName').value.trim();
      if (!name) { alert('Informe o nome do destino antes de marcar no mapa.'); stopDestinationMode(); return; }
      pendingDestination = {id:null,name,lat:e.latlng.lat,lon:e.latlng.lng};
      stopDestinationMode();
      redrawDestinationLayer();
      $n('navSaveDestination').disabled = false;
      $n('navDestinationStatus').textContent = 'Local marcado. Confira a posição e toque em “Salvar destino”.';
    }
  }

  $n('navStartRoad').onclick = () => {
    if (typeof measureMode !== 'undefined' && measureMode) {
      measureMode = false;
      const measureButton = document.getElementById('startMeasure');
      if (measureButton) measureButton.textContent = 'Começar a marcar no mapa';
      const status = document.getElementById('measureStatus');
      if (status) status.textContent = 'Medição pausada para cadastrar estrada.';
    }
    const name = $n('navRoadName').value.trim();
    if (!name) { alert('Informe um nome para a estrada ou caminho.'); return; }
    stopDestinationMode(); pendingDestination = null; redrawDestinationLayer();
    roadDraft = []; roadMode = true; clearDraftLayer();
    $n('navStartRoad').disabled = true; $n('navFinishRoad').disabled = true;
    $n('navUndoRoad').disabled = true; $n('navCancelRoad').disabled = false;
    $n('navRoadStatus').textContent = 'Cadastro ativo: toque no mapa sobre o centro da estrada. Marque curvas, bifurcações e cruzamentos.';
  };

  $n('navFinishRoad').onclick = () => {
    if (roadDraft.length < 2) { alert('Marque pelo menos dois pontos para formar uma estrada.'); return; }
    const farm = activeNavigationFarm();
    farm.roads.push({id:uid(),name:$n('navRoadName').value.trim(),vertices:roadDraft.map(v=>({...v})),createdAt:new Date().toISOString()});
    saveFarms(); stopRoadMode(); renderRoads(); clearRoute();
    $n('navRoadStatus').textContent = 'Estrada salva nesta fazenda. Você pode cadastrar outro caminho.';
    $n('navRoadName').value = '';
  };
  $n('navUndoRoad').onclick = () => { roadDraft.pop(); drawRoadDraft(); };
  $n('navCancelRoad').onclick = () => { stopRoadMode(); $n('navRoadStatus').textContent = 'Cadastro cancelado; nenhuma estrada nova foi salva.'; };

  $n('navPickDestination').onclick = () => {
    if (typeof measureMode !== 'undefined' && measureMode) {
      measureMode = false;
      const measureButton = document.getElementById('startMeasure');
      if (measureButton) measureButton.textContent = 'Começar a marcar no mapa';
    }
    if (roadMode) { stopRoadMode(); $n('navRoadStatus').textContent = 'Cadastro de estrada pausado.'; }
    if (!$n('navDestinationName').value.trim()) { alert('Informe o nome do destino.'); return; }
    pendingDestination = null; redrawDestinationLayer();
    destinationMode = true; $n('navPickDestination').disabled = true;
    $n('navPickDestination').textContent = 'Toque no local do destino no mapa';
    $n('navSaveDestination').disabled = true;
    $n('navDestinationStatus').textContent = 'Agora toque no local exato do módulo, talhão ou acesso no mapa/PDF.';
  };

  $n('navSaveDestination').onclick = () => {
    if (!pendingDestination) { alert('Marque primeiro o destino no mapa.'); return; }
    const farm = activeNavigationFarm();
    const saved = {...pendingDestination,id:uid(),createdAt:new Date().toISOString()};
    farm.destinations.push(saved); saveFarms(); pendingDestination = null;
    selectedDestination = {...saved,source:'dest'};
    renderDestinations();
    $n('navSaveDestination').disabled = true;
    $n('navDestinationName').value = '';
    $n('navDestinationStatus').textContent = 'Destino salvo nesta fazenda e disponível para próximas rotas.';
  };

  $n('navDestinationSelect').onchange = e => chooseDestination(e.target.value);
  $n('navDeleteDestination').onclick = () => {
    if (!selectedDestination || selectedDestination.source !== 'dest') return;
    if (!confirm('Excluir o destino “' + selectedDestination.name + '”?')) return;
    const farm = activeNavigationFarm();
    farm.destinations = farm.destinations.filter(d => d.id !== selectedDestination.id);
    selectedDestination = null; saveFarms(); renderDestinations(); clearRoute();
    $n('navDestinationStatus').textContent = 'Destino excluído.';
  };

  function distanceMeters(a,b) {
    const R=6371000, rad=Math.PI/180, p1=a.lat*rad, p2=b.lat*rad;
    const dp=(b.lat-a.lat)*rad, dl=(b.lon-a.lon)*rad;
    const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
    return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
  }
  function formatDistance(m) {
    return m < 1000 ? Math.round(m).toLocaleString('pt-BR') + ' m' : (m/1000).toFixed(2).replace('.',',') + ' km';
  }
  function buildRoadGraph(roads, extraPoints) {
    const all=[];
    roads.forEach(r => (r.vertices || []).forEach(v => { if (Number.isFinite(+v.lat)&&Number.isFinite(+v.lon)) all.push({lat:+v.lat,lon:+v.lon}); }));
    if (all.length < 2) throw new Error('Cadastre pelo menos uma estrada com dois ou mais pontos.');
    const refLat=all.reduce((s,p)=>s+p.lat,0)/all.length;
    const refLon=all.reduce((s,p)=>s+p.lon,0)/all.length;
    const cos=Math.max(.01,Math.cos(refLat*Math.PI/180));
    const project=p=>({x:(p.lon-refLon)*111320*cos,y:(p.lat-refLat)*110540});
    const unproject=p=>({lat:refLat+p.y/110540,lon:refLon+p.x/(111320*cos)});
    const segments=[];
    roads.forEach(road => {
      const v=road.vertices || [];
      for(let i=0;i<v.length-1;i++){
        const a=project(v[i]),b=project(v[i+1]);
        if(Math.hypot(b.x-a.x,b.y-a.y)>.25) segments.push({a,b,splits:[{t:0,x:a.x,y:a.y},{t:1,x:b.x,y:b.y}]});
      }
    });
    const cross=(ax,ay,bx,by)=>ax*by-ay*bx;
    function addNearEndpointToSegment(endpoint, seg) {
      const dx=seg.b.x-seg.a.x,dy=seg.b.y-seg.a.y,l2=dx*dx+dy*dy;
      if(l2<.01)return;
      const t=Math.max(0,Math.min(1,((endpoint.x-seg.a.x)*dx+(endpoint.y-seg.a.y)*dy)/l2));
      const q={x:seg.a.x+t*dx,y:seg.a.y+t*dy};
      if(Math.hypot(endpoint.x-q.x,endpoint.y-q.y)<=5)seg.splits.push({t,...q});
    }
    for(let i=0;i<segments.length;i++) for(let j=i+1;j<segments.length;j++){
      const A=segments[i],B=segments[j],rx=A.b.x-A.a.x,ry=A.b.y-A.a.y,sx=B.b.x-B.a.x,sy=B.b.y-B.a.y;
      const den=cross(rx,ry,sx,sy);
      if(Math.abs(den)>=1e-7){
        const qx=B.a.x-A.a.x,qy=B.a.y-A.a.y;
        const t=cross(qx,qy,sx,sy)/den,u=cross(qx,qy,rx,ry)/den;
        if(t>=-1e-8&&t<=1+1e-8&&u>=-1e-8&&u<=1+1e-8){
          const pt={x:A.a.x+t*rx,y:A.a.y+t*ry};
          A.splits.push({t:Math.max(0,Math.min(1,t)),...pt}); B.splits.push({t:Math.max(0,Math.min(1,u)),...pt});
        }
      }
      // Aceita pequenas diferenças de toque em junções em T ou cruzamentos.
      addNearEndpointToSegment(A.a,B); addNearEndpointToSegment(A.b,B);
      addNearEndpointToSegment(B.a,A); addNearEndpointToSegment(B.b,A);
    }
    const nodes=[],grid=new Map(),cell=5;
    function addNodeXY(pt){
      const gx=Math.floor(pt.x/cell),gy=Math.floor(pt.y/cell);
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
        const ids=grid.get((gx+dx)+','+(gy+dy))||[];
        for(const id of ids){const n=nodes[id];if(Math.hypot(n.x-pt.x,n.y-pt.y)<=5)return id;}
      }
      const id=nodes.length,geo=unproject(pt);nodes.push({id,x:pt.x,y:pt.y,lat:geo.lat,lon:geo.lon});
      const key=gx+','+gy;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(id);return id;
    }
    const edges=[],edgeSet=new Set();
    function addEdge(a,b){if(a===b)return;const key=Math.min(a,b)+'-'+Math.max(a,b);if(edgeSet.has(key))return;edgeSet.add(key);const weight=distanceMeters(nodes[a],nodes[b]);if(weight>.1)edges.push({a,b,weight});}
    segments.forEach(seg=>{
      seg.splits.sort((a,b)=>a.t-b.t);
      const ids=[];
      seg.splits.forEach(pt=>{const id=addNodeXY(pt);if(ids[ids.length-1]!==id)ids.push(id);});
      for(let i=0;i<ids.length-1;i++)addEdge(ids[i],ids[i+1]);
    });
    if(!edges.length)throw new Error('A rede viária não formou segmentos conectados.');
    return {nodes,edges,project,unproject,grid,addNodeXY};
  }
  function attachToNearestRoad(graph, point) {
    const p=graph.project(point); let best=null;
    graph.edges.forEach((edge,index)=>{
      const a=graph.nodes[edge.a],b=graph.nodes[edge.b],dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;
      if(l2<.01)return;
      const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l2));
      const q={x:a.x+t*dx,y:a.y+t*dy};const d=Math.hypot(p.x-q.x,p.y-q.y);
      if(!best||d<best.d)best={index,edge,t,q,d};
    });
    if(!best)throw new Error('Não há segmentos válidos na rede viária.');
    if(best.t<.00001)return {nodeId:best.edge.a,connector:best.d};
    if(best.t>.99999)return {nodeId:best.edge.b,connector:best.d};
    const original=graph.edges.splice(best.index,1)[0];
    const id=graph.nodes.length,geo=graph.unproject(best.q);
    graph.nodes.push({id,x:best.q.x,y:best.q.y,lat:geo.lat,lon:geo.lon});
    const w1=distanceMeters(graph.nodes[original.a],graph.nodes[id]),w2=distanceMeters(graph.nodes[id],graph.nodes[original.b]);
    graph.edges.push({a:original.a,b:id,weight:w1},{a:id,b:original.b,weight:w2});
    return {nodeId:id,connector:best.d};
  }
  class MinHeap {
    constructor(){this.a=[];}
    push(v){const a=this.a;a.push(v);let i=a.length-1;while(i>0){const p=(i-1)>>1;if(a[p].score<=v.score)break;a[i]=a[p];i=p;}a[i]=v;}
    pop(){const a=this.a;if(!a.length)return null;const top=a[0],last=a.pop();if(a.length){let i=0;while(true){let l=i*2+1,r=l+1,s=i;if(l<a.length&&a[l].score<last.score)s=l;if(r<a.length&&a[r].score<(s===i?last.score:a[l].score))s=r;if(s===i)break;a[i]=a[s];i=s;}a[i]=last;}return top;}
  }
  function shortestPath(graph,startId,endId){
    const adj=Array.from({length:graph.nodes.length},()=>[]);
    graph.edges.forEach(e=>{adj[e.a].push({to:e.b,w:e.weight});adj[e.b].push({to:e.a,w:e.weight});});
    const dist=new Array(graph.nodes.length).fill(Infinity),prev=new Array(graph.nodes.length).fill(-1),heap=new MinHeap();
    dist[startId]=0;heap.push({id:startId,score:0});
    while(true){const cur=heap.pop();if(!cur)break;if(cur.score!==dist[cur.id])continue;if(cur.id===endId)break;
      for(const edge of adj[cur.id]){const nd=dist[cur.id]+edge.w;if(nd<dist[edge.to]){dist[edge.to]=nd;prev[edge.to]=cur.id;heap.push({id:edge.to,score:nd});}}
    }
    if(!Number.isFinite(dist[endId]))return null;
    const path=[];for(let at=endId;at!==-1;at=prev[at]){path.push(at);if(at===startId)break;}
    if(path[path.length-1]!==startId)return null;
    return {ids:path.reverse(),distance:dist[endId]};
  }

  $n('navCalculateRoute').onclick = () => {
    try {
      if (!currentPosition) { alert('Aguarde o GPS receber sua posição antes de calcular a rota.'); return; }
      if (!selectedDestination) { alert('Selecione ou cadastre um destino.'); return; }
      const farm = activeNavigationFarm();
      if (!farm.roads.length) { alert('Cadastre as estradas e caminhos desta fazenda primeiro.'); return; }
      clearRoute();
      const graph=buildRoadGraph(farm.roads);
      const startSnap=attachToNearestRoad(graph,currentPosition);
      const endSnap=attachToNearestRoad(graph,selectedDestination);
      const path=shortestPath(graph,startSnap.nodeId,endSnap.nodeId);
      if(!path)throw new Error('Não existe ligação entre a estrada mais próxima do GPS e a estrada mais próxima do destino. Confira se os caminhos se encontram nos cruzamentos.');
      const coords=[ [currentPosition.lat,currentPosition.lon] ];
      path.ids.forEach(id=>coords.push([graph.nodes[id].lat,graph.nodes[id].lon]));
      coords.push([selectedDestination.lat,selectedDestination.lon]);
      const total=path.distance+startSnap.connector+endSnap.connector;
      L.polyline(coords,{color:'#1769d2',weight:7,opacity:.92,lineCap:'round',lineJoin:'round'}).addTo(routeLayer);
      L.circleMarker([currentPosition.lat,currentPosition.lon],{radius:8,color:'#fff',weight:3,fillColor:'#1677ee',fillOpacity:1}).addTo(routeLayer).bindPopup('Início: posição GPS');
      L.marker([selectedDestination.lat,selectedDestination.lon]).addTo(routeLayer).bindPopup('Destino: '+selectedDestination.name);
      const bounds=L.latLngBounds(coords);map.fitBounds(bounds,{padding:[35,35],maxZoom:17});
      $n('navDistance').textContent=formatDistance(total);
      $n('navSegments').textContent=String(Math.max(0,path.ids.length-1));
      let msg='Rota calculada seguindo os caminhos cadastrados.';
      if(startSnap.connector>25)msg+=' GPS está a '+formatDistance(startSnap.connector)+' da estrada mais próxima.';
      if(endSnap.connector>25)msg+=' Destino está a '+formatDistance(endSnap.connector)+' da estrada mais próxima.';
      msg+=' Confira os conectores e o acesso real no terreno.';
      $n('navRouteStatus').textContent=msg;
    } catch(err) {
      clearRoute(); $n('navRouteStatus').textContent='Não foi possível calcular: '+err.message;
      alert('Navegação Florestal: '+err.message);
    }
  };
  $n('navClearRoute').onclick = () => { clearRoute(); $n('navRouteStatus').textContent='Rota limpa. O destino e as estradas cadastradas foram mantidos.'; };

  // Integra o módulo à troca de fazenda e à atualização da lista de pontos.
  const originalRefreshFarmUI = refreshFarmUI;
  refreshFarmUI = function () {
    stopRoadMode(); stopDestinationMode(); pendingDestination=null; selectedDestination=null; clearRoute();
    originalRefreshFarmUI(); ensureFarmNavigationData(); renderRoads(); renderDestinations();
  };
  const originalSetPoints = setPoints;
  setPoints = function (points) { originalSetPoints(points); renderDestinations(); };

  ensureFarmNavigationData();
  if (typeof map !== 'undefined' && map && window.L) {
    roadLayer=L.layerGroup().addTo(map);
    draftLayer=L.layerGroup().addTo(map);
    destinationLayer=L.layerGroup().addTo(map);
    routeLayer=L.layerGroup().addTo(map);
    map.on('click', onMapTap);
  }
  renderRoads(); renderDestinations();
})();
