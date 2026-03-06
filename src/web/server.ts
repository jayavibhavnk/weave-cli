import * as http from "node:http";
import type { MemoryFabric } from "../core/fabric.js";

export async function startWebViewer(
  fabric: MemoryFabric,
  port = 3333
): Promise<void> {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/graph") {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      const graph = fabric.getGraph();
      const { nodes, edges } = graph.serialize();
      const data = {
        nodes: nodes.map((n) => ({
          id: n.id,
          content: n.content,
          agent: n.agentId,
          tier: n.tier,
          importance: n.importance,
          type: n.memoryType,
        })),
        edges: edges.map((e) => ({
          source: e.sourceId,
          target: e.targetId,
          type: e.edgeType,
          weight: e.weight,
        })),
        stats: fabric.getStats(),
      };
      res.end(JSON.stringify(data));
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML_PAGE);
  });

  server.listen(port, () => {
    console.log(`  Memory graph viewer at http://localhost:${port}`);
  });

  try {
    const { exec } = await import("node:child_process");
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    exec(`${cmd} http://localhost:${port}`);
  } catch {}
}

const HTML_PAGE = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><title>weave — memory graph</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0f;color:#e5e7eb;font-family:system-ui,sans-serif;overflow:hidden}
canvas{display:block}
#info{position:fixed;top:16px;left:16px;z-index:10}
#info h1{font-size:18px;color:#7c5cfc;margin-bottom:4px}
#info p{font-size:12px;color:#6b7280}
#stats{position:fixed;top:16px;right:16px;font-size:12px;color:#6b7280;text-align:right}
#tooltip{position:fixed;display:none;background:#1f1f2e;border:1px solid #333;border-radius:8px;padding:10px 14px;max-width:320px;font-size:13px;color:#e5e7eb;pointer-events:none;z-index:20}
#tooltip .agent{color:#f472b6;font-size:11px;margin-bottom:4px}
#tooltip .tier{color:#6b7280;font-size:11px}
#legend{position:fixed;bottom:16px;left:16px;font-size:11px;display:flex;gap:16px}
.leg{display:flex;align-items:center;gap:4px}
.leg span{width:10px;height:10px;border-radius:50%;display:inline-block}
</style>
</head><body>
<div id="info"><h1>◈ weave memory graph</h1><p>drag to pan · scroll to zoom · hover for details</p></div>
<div id="stats"></div>
<div id="tooltip"><div class="agent"></div><div class="content"></div><div class="tier"></div></div>
<div id="legend">
<div class="leg"><span style="background:#60a5fa"></span>semantic</div>
<div class="leg"><span style="background:#6b7280"></span>temporal</div>
<div class="leg"><span style="background:#fb923c"></span>causal</div>
<div class="leg"><span style="background:#34d399"></span>entity</div>
</div>
<canvas id="c"></canvas>
<script>
const C=document.getElementById('c'),X=C.getContext('2d');
let W=C.width=innerWidth,H=C.height=innerHeight;
onresize=()=>{W=C.width=innerWidth;H=C.height=innerHeight};
const agentColors=['#f472b6','#60a5fa','#34d399','#fbbf24','#fb923c','#a78bfa'];
const edgeColors={semantic:'#60a5fa',temporal:'#4b5563',causal:'#fb923c',entity:'#34d399'};
let nodes=[],edges=[],agentMap={},ox=W/2,oy=H/2,scale=1,drag=null,hover=null;
async function load(){
  const r=await fetch('/api/graph');const d=await r.json();
  const ac=Object.keys(d.nodes.reduce((a,n)=>(a[n.agent]=1,a),{}));
  ac.forEach((a,i)=>agentMap[a]=agentColors[i%agentColors.length]);
  nodes=d.nodes.map((n,i)=>{const a=2*Math.PI*i/d.nodes.length;
    return{...n,x:Math.cos(a)*200+Math.random()*50,y:Math.sin(a)*200+Math.random()*50,vx:0,vy:0,r:4+n.importance*8}});
  edges=d.edges;
  document.getElementById('stats').innerHTML=
    d.stats.nodes+' nodes · '+d.stats.edges+' edges · '+d.stats.agents+' agents';
}
function tick(){
  for(const n of nodes){n.vx*=.9;n.vy*=.9;n.vx+=(Math.random()-.5)*.1;n.vy+=(Math.random()-.5)*.1}
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
    let dx=nodes[j].x-nodes[i].x,dy=nodes[j].y-nodes[i].y,d=Math.sqrt(dx*dx+dy*dy)||1;
    if(d<80){const f=(80-d)/d*.3;nodes[i].vx-=dx*f;nodes[i].vy-=dy*f;nodes[j].vx+=dx*f;nodes[j].vy+=dy*f}}
  const nm=new Map(nodes.map(n=>[n.id,n]));
  for(const e of edges){const s=nm.get(e.source),t=nm.get(e.target);if(!s||!t)continue;
    let dx=t.x-s.x,dy=t.y-s.y,d=Math.sqrt(dx*dx+dy*dy)||1;
    const f=(d-100)/d*.02*e.weight;s.vx+=dx*f;s.vy+=dy*f;t.vx-=dx*f;t.vy-=dy*f}
  for(const n of nodes){n.x+=n.vx;n.y+=n.vy}
}
function draw(){
  X.clearRect(0,0,W,H);X.save();X.translate(ox,oy);X.scale(scale,scale);
  const nm=new Map(nodes.map(n=>[n.id,n]));
  for(const e of edges){const s=nm.get(e.source),t=nm.get(e.target);if(!s||!t)continue;
    X.beginPath();X.moveTo(s.x,s.y);X.lineTo(t.x,t.y);
    X.strokeStyle=edgeColors[e.type]||'#333';X.globalAlpha=.15+e.weight*.2;X.lineWidth=.5+e.weight;X.stroke();X.globalAlpha=1}
  for(const n of nodes){
    X.beginPath();X.arc(n.x,n.y,n.r,0,Math.PI*2);
    const c=agentMap[n.agent]||'#888';X.fillStyle=c;X.globalAlpha=.3+n.importance*.7;X.fill();
    if(n===hover){X.strokeStyle='#fff';X.lineWidth=2;X.stroke()}
    X.globalAlpha=1}
  X.restore()
}
function loop(){tick();draw();requestAnimationFrame(loop)}
C.onmousedown=e=>{drag={x:e.clientX-ox,y:e.clientY-oy}};
C.onmouseup=()=>drag=null;
C.onmousemove=e=>{
  if(drag){ox=e.clientX-drag.x;oy=e.clientY-drag.y;return}
  const mx=(e.clientX-ox)/scale,my=(e.clientY-oy)/scale;
  hover=null;const tt=document.getElementById('tooltip');
  for(const n of nodes){const dx=n.x-mx,dy=n.y-my;if(dx*dx+dy*dy<(n.r+4)*(n.r+4)){hover=n;break}}
  if(hover){tt.style.display='block';tt.style.left=e.clientX+12+'px';tt.style.top=e.clientY+12+'px';
    tt.querySelector('.agent').textContent='@'+hover.agent;
    tt.querySelector('.content').textContent=hover.content;
    tt.querySelector('.tier').textContent=hover.tier+' · importance: '+hover.importance.toFixed(2)}
  else tt.style.display='none'
};
C.onwheel=e=>{e.preventDefault();const z=e.deltaY>0?.9:1.1;
  ox=e.clientX-(e.clientX-ox)*z;oy=e.clientY-(e.clientY-oy)*z;scale*=z};
load().then(loop);
</script></body></html>`;
