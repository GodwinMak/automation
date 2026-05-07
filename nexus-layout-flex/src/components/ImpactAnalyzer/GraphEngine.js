import { ifaceCapacity, trafficUtil, ifaceLabel } from './formatters';
import { isAGGNode, isPENode, isBNGNode, isCoreNode } from './Constants';


// ─────────────────────────────────────────────────────────────────────────────
//  GRAPH ENGINE  (edge tuple: [a,b,lvl,iface,metric,portSpeed,state,in_bps,out_bps])
// ─────────────────────────────────────────────────────────────────────────────
export class Graph {
    constructor(edges){
        this.adj={}; 
        this.nodes=new Set(); 
        this.linkCap={};
        edges.forEach(edge=>{
            const[a,b,lvl,iface,metric,portSpeed,,input_bps,output_bps]=edge;
            const key=a<b?`${a}|${b}`:`${b}|${a}`;
            const cap=ifaceCapacity(iface,portSpeed);
            const rawM=Number(metric);
            const m=(isFinite(rawM)&&rawM>0)?rawM:(lvl===3?1:10);
            const ibps = parseFloat(input_bps)  || 0;
            const obps = parseFloat(output_bps) || 0;
            if(!this.adj[a])this.adj[a]=[];
            if(!this.adj[b])this.adj[b]=[];
            this.adj[a].push({n:b,lvl,iface,cap,metric:m,portSpeed,input_bps:ibps,output_bps:obps});
            this.adj[b].push({n:a,lvl,iface,cap,metric:m,portSpeed,input_bps:obps,output_bps:ibps}); // flip for reverse direction
            if(!this.linkCap[key]){
                this.linkCap[key]={iface,cap,totalCap:cap,count:1,metric:m,portSpeed,
                input_bps:ibps,output_bps:obps,
                ifaces:[{iface,cap,metric:m,portSpeed,input_bps:ibps,output_bps:obps}]};
            } else {
                const lc=this.linkCap[key];
                lc.count++;lc.totalCap+=cap;
                lc.input_bps=(lc.input_bps||0)+ibps;   // aggregate parallel iface traffic
                lc.output_bps=(lc.output_bps||0)+obps;
                lc.ifaces.push({iface,cap,metric:m,portSpeed,input_bps:ibps,output_bps:obps});
                if(cap>lc.cap){lc.cap=cap;lc.iface=iface;}
                if(m<lc.metric)lc.metric=m;
            }
            this.nodes.add(a);
            this.nodes.add(b);
        });
    }
    
    neighbors(n){const s=new Set();return(this.adj[n]||[]).filter(e=>{if(s.has(e.n))return false;s.add(e.n);return true;}).map(e=>e.n);}
    degree(n){return new Set((this.adj[n]||[]).map(e=>e.n)).size;}
    edgeCount(n) {return(this.adj[n]||[]).length;}
    maxLevel(n)  {return Math.max(...(this.adj[n]||[]).map(e=>e.lvl||1));}
    minCapacity(n){return Math.min(...(this.adj[n]||[]).map(e=>e.cap||1));}
    linkCapacity(a,b){const k=a<b?`${a}|${b}`:`${b}|${a}`;return this.linkCap[k]||{iface:null,cap:1,totalCap:1,count:1,metric:10,input_bps:0,output_bps:0,ifaces:[]};}
    allNodes(){return[...this.nodes];}
    aggNodes(){return this.allNodes().filter(n=>isAGGNode(n));}
    peNodes() {return this.allNodes().filter(n=>isPENode(n));}
    bfs(start){
        if(!this.adj[start])return{};
        const dist={[start]:0},q=[start];let i=0;
        while(i<q.length){const cur=q[i++];for(const nb of this.neighbors(cur)){if(!(nb in dist)){dist[nb]=dist[cur]+1;q.push(nb);}}}
        return dist;
    }
    dijkstra(start){
        if(!this.adj[start])return{};
        const INF=Infinity,cost={[start]:0},hops={[start]:0},visited=new Set();
        const pq=[{n:start,c:0,h:0}];
        while(pq.length){
        pq.sort((a,b)=>a.c-b.c);
        const{n:cur,c:curC,h:curH}=pq.shift();
        if(visited.has(cur))continue;visited.add(cur);
        for(const e of(this.adj[cur]||[])){
            const nc=curC+e.metric,nh=curH+1;
            if(nc<(cost[e.n]??INF)){cost[e.n]=nc;hops[e.n]=nh;pq.push({n:e.n,c:nc,h:nh});}
        }
        }
        const r={};for(const n of Object.keys(cost))r[n]={hops:hops[n],cost:cost[n]};return r;
    }
    dijkstraWithPath(start){
        if(!this.adj[start])return{};
        const INF=Infinity,cost={[start]:0},hops={[start]:0};
        const prev={[start]:null};
        const visited=new Set();
        const pq=[{n:start,c:0,h:0}];
        while(pq.length){
        pq.sort((a,b)=>a.c-b.c);
        const{n:cur,c:curC,h:curH}=pq.shift();
        if(visited.has(cur))continue;visited.add(cur);
        for(const e of(this.adj[cur]||[])){
            const nc=curC+e.metric,nh=curH+1;
            if(nc<(cost[e.n]??INF)){cost[e.n]=nc;hops[e.n]=nh;prev[e.n]=cur;pq.push({n:e.n,c:nc,h:nh});}
        }
        }
        const getPath=dest=>{
        if(!(dest in cost))return null;
        const p=[];let cur=dest;
        while(cur!==null){p.unshift(cur);cur=prev[cur]??null;}
        return p;
        };
        const r={};
        for(const n of Object.keys(cost))r[n]={hops:hops[n],cost:cost[n],path:getPath(n)};
        return r;
    }
    components(){
        const vis=new Set(),comps=[];
        for(const n of this.allNodes()){if(!vis.has(n)){const c=Object.keys(this.bfs(n));c.forEach(x=>vis.add(x));comps.push(c);}}
        return comps;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ISIS IMPACT ANALYZER
// ─────────────────────────────────────────────────────────────────────────────
export class ISISImpactAnalyzer {
  constructor(edges,downLinks=[]){
    const dk=new Set(downLinks.map(({a,b,iface})=>{const p=a<b?`${a}|${b}`:`${b}|${a}`;return iface?`${p}|${iface}`:p;}));
    const active=edges.filter(([a,b,,iface,,,status])=>{
      const p=a<b?`${a}|${b}`:`${b}|${a}`;
      const ik=iface?`${p}|${iface}`:p;
      return status==='Up'&&!dk.has(ik)&&!dk.has(p);
    });
    this.baseGraph=new Graph(active);
    this.allEdges=edges;
    this.activeEdges=active;
    this.downLinks=downLinks;
  }

  _isolationForLink(linkKey){
    const trimmed=this.allEdges.filter(([x,y])=>{const k=x<y?`${x}|${y}`:`${y}|${x}`;return k!==linkKey;});
    const g0=new Graph(this.allEdges),g1=new Graph(trimmed);
    const baseCompCount=g0.components().length;
    const comps1=g1.components();
    const mainSize=comps1.length>0?Math.max(...comps1.map(c=>c.length)):0;
    const mainSet=new Set(comps1.find(c=>c.length===mainSize)||[]);
    const partitioned=comps1.length>baseCompCount;
    const isolated=[];
    for(const n of g0.allNodes()){if((!g1.adj[n]||g1.degree(n)===0)&&g0.degree(n)>0)isolated.push({node:n,reason:"sole link removed — completely unreachable"});}
    if(partitioned){const caught=new Set(isolated.map(i=>i.node));for(const n of g0.allNodes()){if(caught.has(n))continue;if(g1.adj[n]&&g1.degree(n)>0&&!mainSet.has(n))isolated.push({node:n,reason:"partitioned from main topology"});}}
    const partitionGroups=partitioned?comps1.filter(c=>c.length<mainSize):[];
    return{isolated,partitioned,partitionGroups};
  }

  computeAGGPEImpact(g,rg,failedNode=null){
    const allAGGs=g.aggNodes(),allPEs=g.peNodes();
    const survivingAGGs=failedNode?allAGGs.filter(n=>n!==failedNode):allAGGs;
    const failedAGGs=failedNode&&isAGGNode(failedNode)?[failedNode]:[];
    const l1NodesLosingAGG=[];
    if(failedAGGs.length>0){g.allNodes().filter(n=>!isAGGNode(n)&&!isPENode(n)&&!isBNGNode(n)&&!isCoreNode(n)).forEach(node=>{if(!(g.adj[node]||[]).some(e=>isAGGNode(e.n)))return;const ad=rg.bfs(node);if(!survivingAGGs.some(agg=>(ad[agg]??Infinity)<=2))l1NodesLosingAGG.push(node);});}
    let aggCrossLinkBroken=false;
    if(survivingAGGs.length>=2){for(let i=0;i<survivingAGGs.length;i++)for(let j=i+1;j<survivingAGGs.length;j++){if(rg.bfs(survivingAGGs[i])[survivingAGGs[j]]===undefined)aggCrossLinkBroken=true;}}
    else if(survivingAGGs.length<allAGGs.length)aggCrossLinkBroken=true;
    const pePairsDisrupted=[],pePairsInflated=[],pePairsAll=[];
    for(let i=0;i<allPEs.length;i++)for(let j=i+1;j<allPEs.length;j++){
      const[pa,pb]=[allPEs[i],allPEs[j]];if(pa===failedNode||pb===failedNode)continue;
      const bD=g.dijkstra(pa),aD=rg.dijkstra(pa);
      const bc=bD[pb]?.cost??null,ac=aD[pb]?.cost??null,bh=bD[pb]?.hops??null,ah=aD[pb]?.hops??null;
      if(bc===null)continue;
      if(ac===null)pePairsDisrupted.push({from:pa,to:pb,beforeCost:bc,afterCost:null,costDiff:null,beforeHops:bh,afterHops:null});
      else{pePairsAll.push({from:pa,to:pb,beforeCost:bc,afterCost:ac,costDiff:ac-bc,beforeHops:bh,afterHops:ah});if(ac>bc*3||(ac-bc)>50000)pePairsInflated.push({from:pa,to:pb,beforeCost:bc,afterCost:ac,costDiff:ac-bc,beforeHops:bh,afterHops:ah});}
    }
    return{allAGGs,survivingAGGs,failedAGGs,l1NodesLosingAGG,aggCrossLinkBroken,pePairsDisrupted,pePairsInflated,pePairsAll,peFullyDisrupted:pePairsDisrupted.length>0,peMetricDegraded:pePairsInflated.length>0&&pePairsDisrupted.length===0,isAGGFailure:failedAGGs.length>0};
  }

  computeAGGReachability(g,rg,sources){
    const aggs=g.aggNodes();if(aggs.length===0)return[];
    return sources.filter(src=>g.adj[src]).map(src=>{
      const bD=g.dijkstraWithPath(src),aD=rg.adj[src]?rg.dijkstraWithPath(src):{};
      const paths=aggs.map(agg=>{
        const before=bD[agg]||null,after=aD[agg]||null;
        const bottleneck=(pathArr,graph)=>{if(!pathArr||pathArr.length<2)return null;let minCap=Infinity;for(let k=0;k<pathArr.length-1;k++){const lc=graph.linkCapacity(pathArr[k],pathArr[k+1]);if(lc.totalCap<minCap)minCap=lc.totalCap;}return minCap===Infinity?null:minCap;};
        return{agg,before,after,beforeBottleneck:before?bottleneck(before.path,g):null,afterBottleneck:after?bottleneck(after.path,rg):null,disrupted:!!before&&!after,inflated:!!(before&&after&&(after.cost>before.cost||after.hops>before.hops)),sameRoute:!!(before&&after&&JSON.stringify(before.path)===JSON.stringify(after.path)),hopDiff:(before&&after)?after.hops-before.hops:null,costDiff:(before&&after)?after.cost-before.cost:null};
      });
      return{source:src,paths};
    });
  }

  computeLinkCongestion(g,rg,failedNode=null,failedLinkKey=null,failedLinkKeys=null){
    const keySet=new Set();
    if(failedLinkKey)keySet.add(failedLinkKey);
    if(failedLinkKeys)failedLinkKeys.forEach(k=>keySet.add(k));
    const allNodes=g.allNodes().filter(n=>n!==failedNode);
    const sample=allNodes.length>40?allNodes.sort((a,b)=>g.degree(b)-g.degree(a)).slice(0,40):allNodes;
    const redirected=[],bDijkCache={};
    for(let i=0;i<sample.length;i++){
      const src=sample[i];
      if(!bDijkCache[src])bDijkCache[src]=g.dijkstraWithPath(src);
      const bD=bDijkCache[src];
      for(let j=i+1;j<sample.length;j++){
        const dest=sample[j];const pathData=bD[dest];if(!pathData?.path||pathData.path.length<2)continue;
        const path=pathData.path;let usedFailed=false;
        if(failedNode){usedFailed=path.includes(failedNode);}
        else if(keySet.size>0){for(let k=0;k<path.length-1;k++){const a=path[k],b=path[k+1];const key=a<b?`${a}|${b}`:`${b}|${a}`;if(keySet.has(key)){usedFailed=true;break;}}}
        if(usedFailed)redirected.push({src,dest});
      }
    }
    if(redirected.length===0)return{flows:[],total:0};
    const aDijkCache={},uniqueSources=[...new Set(redirected.map(f=>f.src))];
    for(const src of uniqueSources){if(rg.adj[src])aDijkCache[src]=rg.dijkstraWithPath(src);}
    const linkFlows={};
    for(const{src,dest}of redirected){const aD=aDijkCache[src]||{};const newPath=aD[dest]?.path;if(!newPath||newPath.length<2)continue;for(let k=0;k<newPath.length-1;k++){const a=newPath[k],b=newPath[k+1];const key=a<b?`${a}|${b}`:`${b}|${a}`;linkFlows[key]=(linkFlows[key]||0)+1;}}
    const results=[];
    for(const[key,count]of Object.entries(linkFlows)){
      const lc=rg.linkCap[key]||g.linkCap[key];if(!lc)continue;
      const[nodeA,nodeB]=key.split('|');
      const capGbps=lc.totalCap||1;
      const satThreshold=Math.max(1,capGbps*50);
      const satPct=Math.min(100,Math.round((count/satThreshold)*100));
      const risk=satPct>=90?'CRITICAL':satPct>=60?'HIGH':satPct>=30?'MEDIUM':'LOW';
      const coveragePct=Math.round((count/redirected.length)*100);
      // Current utilisation of this link (from live traffic data)
      const currentUtil=trafficUtil(lc.input_bps,lc.output_bps,lc.portSpeed);
      const currentInBps=lc.input_bps||0,currentOutBps=lc.output_bps||0;
      results.push({key,nodeA,nodeB,count,total:redirected.length,coveragePct,capGbps,capLabel:capGbps>=100?'100G':capGbps>=10?'10G':'1G',satPct,risk,currentUtil,currentInBps,currentOutBps});
    }
    return{flows:results.sort((a,b)=>b.satPct-a.satPct||b.count-a.count).slice(0,12),total:redirected.length};
  }

  analyzeNode(target){
    const g=this.baseGraph;if(!g.adj[target])return null;
    const nb=g.neighbors(target),maxLvl=g.maxLevel(target),degree=nb.length;
    const re=this.activeEdges.filter(([a,b])=>a!==target&&b!==target);
    const rg=new Graph(re);
    const ps=[],pSeen=new Set();
    for(const e of(g.adj[target]||[])){const pk=target<e.n?`${target}|${e.n}`:`${e.n}|${target}`;if(pSeen.has(pk))continue;pSeen.add(pk);const lc=g.linkCapacity(target,e.n);if(lc.count>1)ps.push({neighbor:e.n,count:lc.count,totalCap:lc.totalCap});}
    const isolated=[],rc=rg.components(),mcs=Math.max(...rc.map(c=>c.length)),mc=rc.find(c=>c.length===mcs);
    for(const n of nb){if(!rg.adj[n]||rg.degree(n)===0)isolated.push({node:n,reason:"zero remaining adjacencies"});else if(mc&&!mc.includes(n))isolated.push({node:n,reason:"partitioned from main topology"});}
    if(degree===1)isolated.unshift({node:target,reason:"single-homed",self:true});
    const bc=g.components().length,nc=rg.components().length,partitioned=nc>bc;
    const pg=partitioned?rc.filter(c=>!mc||c.length<mc.length):[];
    const aggpe=this.computeAGGPEImpact(g,rg,target);
    const pathImpact=[],aon=g.allNodes().filter(n=>n!==target),st=aon.length>60?aon.filter(n=>g.degree(n)>1).slice(0,60):aon;
    for(const src of nb){const bD=g.dijkstra(src),aD=rg.dijkstra(src),aff=[];for(const dest of st){if(dest===src||dest===target)continue;const bd=bD[dest],ad=aD[dest];if(!bd)continue;if(!ad)aff.push({dest,beforeHops:bd.hops,afterHops:null,beforeCost:bd.cost,afterCost:null,hopDiff:null,costDiff:null,type:"unreachable"});else if(ad.cost>bd.cost||ad.hops>bd.hops)aff.push({dest,beforeHops:bd.hops,afterHops:ad.hops,beforeCost:bd.cost,afterCost:ad.cost,hopDiff:ad.hops-bd.hops,costDiff:ad.cost-bd.cost,type:"inflated"});}if(aff.length>0){aff.sort((x,y)=>(y.costDiff??999999)-(x.costDiff??999999));pathImpact.push({source:src,affected:aff.slice(0,10),totalAffected:aff.length});}}
    const lb={},la={},ss=aon.slice(0,30);for(const n of aon){lb[n]=0;la[n]=0;}
    for(let i=0;i<ss.length;i++){const dB=g.bfs(ss[i]),dA=rg.bfs(ss[i]);for(let j=i+1;j<ss.length;j++){const dest=ss[j];if(dest===target)continue;const db=dB[dest];if(db!==undefined&&db>1){for(const mid of aon){if(mid===ss[i]||mid===dest||mid===target)continue;const dm=dB[mid],dm2=g.bfs(mid)[dest];if(dm!==undefined&&dm2!==undefined&&dm+dm2===db)lb[mid]++;}}const da=dA[dest];if(da!==undefined&&da>1){for(const mid of aon){if(mid===ss[i]||mid===dest)continue;const dm=dA[mid],dm2=rg.adj[mid]?rg.bfs(mid)[dest]:undefined;if(dm!==undefined&&dm2!==undefined&&dm+dm2===da)la[mid]++;}}}}
    const li=aon.map(n=>{const mc2=g.minCapacity(n),inc=(la[n]||0)-(lb[n]||0);return{node:n,before:lb[n]||0,after:la[n]||0,increase:inc,minCap:mc2,capLabel:mc2<=1?"1G":mc2<=10?"10G":"100G",risk:mc2<=1&&inc>2?"HIGH":mc2<=10&&inc>5?"MEDIUM":"LOW"};}).filter(x=>x.increase>0).sort((a,b)=>b.increase-a.increase).slice(0,8);
    const allHD=pathImpact.flatMap(p=>p.affected.filter(a=>a.hopDiff!==null).map(a=>a.hopDiff));
    const allCD=pathImpact.flatMap(p=>p.affected.filter(a=>a.costDiff!==null).map(a=>a.costDiff));
    const avgHopInf=allHD.length?allHD.reduce((s,v)=>s+v,0)/allHD.length:0;
    const maxHopInf=allHD.length?Math.max(...allHD):0;
    const avgCostInf=allCD.length?Math.round(allCD.reduce((s,v)=>s+v,0)/allCD.length):0;
    const maxCostInf=allCD.length?Math.max(...allCD):0;
    let severity="LOW",score=0;
    score+=isolated.length*40;score+=pg.reduce((s,g)=>s+g.length,0)*30;score+=pathImpact.reduce((s,p)=>s+p.totalAffected,0)*0.5;score+=(maxLvl-1)*20;score+=Math.min(degree*3,30);score+=li.slice(0,3).reduce((s,x)=>s+x.increase*.1,0);if(aggpe.isAGGFailure)score+=25;if(aggpe.aggCrossLinkBroken)score+=20;if(aggpe.peFullyDisrupted)score+=40;score=Math.min(score,100);
    if(isolated.length>0||partitioned||aggpe.peFullyDisrupted||aggpe.l1NodesLosingAGG.length>0)severity="CRITICAL";
    else if(score>=60||(maxLvl>=2&&degree>=4)||aggpe.peMetricDegraded)severity="HIGH";
    else if(score>=30||degree>=4||maxLvl>=2)severity="MEDIUM";
    const aggReach=this.computeAGGReachability(g,rg,nb);
    const linkCong=this.computeLinkCongestion(g,rg,target,null);
    return{target,degree,neighbors:nb,maxLvl,edgeCount:g.edgeCount(target),parallelSummary:ps,severity,score:Math.round(score),isolated,partitioned,partitionedGroups:pg,pathImpact,avgHopInf,maxHopInf,avgCostInf,maxCostInf,loadIncrease:li,recs:this.buildRecs(target,degree,maxLvl,isolated,partitioned,pg,pathImpact,avgHopInf,maxHopInf,avgCostInf,li,aggpe),aggpe,aggReach,linkCong,baseComponents:bc,newComponents:nc};
  }

  analyzeLink(a,b){
    const g=this.baseGraph,lc=g.linkCapacity(a,b),pI=lc.ifaces||[],pC=lc.count||1;
    const edge=this.allEdges.find(([x,y])=>(x===a&&y===b)||(x===b&&y===a));
    const level=edge?edge[2]:1,li=edge?edge[3]:null,lCap=ifaceCapacity(li),lMetric=edge?(edge[4]||null):null;
    const rg=new Graph(this.activeEdges.filter(([x,y])=>{const k1=x<y?`${x}|${y}`:`${y}|${x}`,k2=a<b?`${a}|${b}`:`${b}|${a}`;return k1!==k2;}));
    const bc=g.components().length;const rgComps=rg.components();const nc=rgComps.length,partitioned=nc>bc;const rgMainSize=rgComps.length>0?Math.max(...rgComps.map(c=>c.length)):0;const rgMainSet=new Set(rgComps.find(c=>c.length===rgMainSize)||[]);
    const isolated=[];const aI=!rg.adj[a]||rg.degree(a)===0;const bI=!rg.adj[b]||rg.degree(b)===0;
    if(aI)isolated.push({node:a,reason:"no remaining adjacencies after link removal"});
    if(bI)isolated.push({node:b,reason:"no remaining adjacencies after link removal"});
    if(partitioned){const alreadyCaught=new Set(isolated.map(i=>i.node));for(const n of g.allNodes()){if(alreadyCaught.has(n))continue;if(rg.adj[n]&&rg.degree(n)>0&&!rgMainSet.has(n))isolated.push({node:n,reason:"partitioned from main topology by this link removal"});}}
    const pathImpact=[];
    for(const src of[a,b]){const bD=g.dijkstra(src),aD=rg.dijkstra(src),other=src===a?b:a,bdo=bD[other],ado=aD[other];if(bdo){if(!ado)pathImpact.push({source:src,affected:[{dest:other,beforeHops:bdo.hops,afterHops:null,beforeCost:bdo.cost,afterCost:null,hopDiff:null,costDiff:null,type:"unreachable"}],totalAffected:1});else if(ado.cost>bdo.cost||ado.hops>bdo.hops)pathImpact.push({source:src,affected:[{dest:other,beforeHops:bdo.hops,afterHops:ado.hops,beforeCost:bdo.cost,afterCost:ado.cost,hopDiff:ado.hops-bdo.hops,costDiff:ado.cost-bdo.cost,type:"inflated"}],totalAffected:1});}}
    const isAGGCL=isAGGNode(a)&&isAGGNode(b);
    const aggpe=this.computeAGGPEImpact(g,rg,null);if(isAGGCL)Object.assign(aggpe,{aggCrossLinkBroken:true});
    const allHD=pathImpact.flatMap(p=>p.affected.filter(a=>a.hopDiff!==null).map(a=>a.hopDiff));
    const allCD=pathImpact.flatMap(p=>p.affected.filter(a=>a.costDiff!==null).map(a=>a.costDiff));
    const avgHopInf=allHD.length?allHD.reduce((s,v)=>s+v,0)/allHD.length:0;
    const avgCostInf=allCD.length?Math.round(allCD.reduce((s,v)=>s+v,0)/allCD.length):0;
    let severity="LOW",score=0;score+=isolated.length*40;score+=partitioned?50:0;score+=(level-1)*25;score+=avgHopInf*10;if(aggpe.aggCrossLinkBroken)score+=30;if(aggpe.peFullyDisrupted)score+=40;if(aggpe.peMetricDegraded)score+=20;score=Math.min(score,100);
    if(isolated.length>0||partitioned||aggpe.peFullyDisrupted)severity="CRITICAL";else if(score>=50||level>=2||aggpe.aggCrossLinkBroken)severity="HIGH";else if(score>=25)severity="MEDIUM";
    const recs=[];
    if(pC>1)recs.push({priority:"MEDIUM",type:"parallel",text:`This pair has ${pC} parallel interfaces (total ${lc.totalCap}G). Analysis simulates ALL ${pC} links failing simultaneously.`,action:`Single-interface failure preserves connectivity — capacity drops to ${lc.totalCap-lCap}G.`});
    if(isAGGCL&&(aggpe.peFullyDisrupted||aggpe.peMetricDegraded))recs.push({priority:aggpe.peFullyDisrupted?"CRITICAL":"HIGH",type:"agg_crosslink",text:`This is the AGG-to-AGG backbone cross-link.${aggpe.pePairsInflated.length>0?" PE-to-PE metric cost increases by up to "+fmtMetric(Math.max(...aggpe.pePairsInflated.map(p=>p.costDiff)))+" ("+Math.round(Math.max(...aggpe.pePairsInflated.map(p=>p.afterCost/p.beforeCost)))+"× worse).":""}`,action:`Add a second AGG-to-AGG link on a physically diverse path.`});
    if(aI)recs.push({priority:"CRITICAL",type:"single_homed",text:`${a} becomes fully isolated.`,action:`Add a second ISIS adjacency for ${a}.`});
    if(bI)recs.push({priority:"CRITICAL",type:"single_homed",text:`${b} becomes fully isolated.`,action:`Add a second ISIS adjacency for ${b}.`});
    if(partitioned)recs.push({priority:"CRITICAL",type:"partition",text:`Network partitions when this link fails.`,action:`Add an alternate path between ${a} and ${b}'s clusters.`});
    if(level>=2&&!partitioned&&!isAGGCL)recs.push({priority:"HIGH",type:"backbone",text:`Level-${level} backbone link${lMetric?" (metric "+fmtMetric(lMetric)+")":""}.`,action:`Ensure alternate Level-${level} paths have sufficient capacity.`});
    if(!aI&&!bI&&!partitioned&&level===1&&recs.length===0)recs.push({priority:"LOW",type:"ok",text:`Both endpoints retain other adjacencies. Limited impact.`,action:`Monitor for increased load on remaining paths.`});
    const failedLinkKey=a<b?`${a}|${b}`:`${b}|${a}`;
    const aggReach=this.computeAGGReachability(g,rg,[a,b]);
    const linkCong=this.computeLinkCongestion(g,rg,null,failedLinkKey);
    // Include current traffic on the failing link
    const linkTrafficUtil=trafficUtil(lc.input_bps,lc.output_bps,lc.portSpeed);
    return{target:`${a} ↔ ${b}`,linkMode:true,nodeA:a,nodeB:b,level,linkIface:li,linkCap:lCap,linkCapLabel:ifaceLabel(li),linkMetric:lMetric,parallelCount:pC,parallelIfaces:pI,totalLinkCap:lc.totalCap,degree:null,neighbors:[],maxLvl:level,severity,score:Math.round(score),isolated,partitioned,partitionedGroups:partitioned?rgComps.filter(c=>c.length<rgMainSize):[],pathImpact,avgHopInf,maxHopInf:avgHopInf,avgCostInf,maxCostInf:avgCostInf,loadIncrease:[],recs,aggpe,aggReach,linkCong,baseComponents:bc,newComponents:nc,linkTrafficUtil,linkInputBps:lc.input_bps||0,linkOutputBps:lc.output_bps||0};
  }

  buildRecs(target,degree,maxLvl,isolated,partitioned,partGroups,pathImpact,avgHopInf,maxHopInf,avgCostInf,li,aggpe){
    const recs=[];
    if(aggpe.isAGGFailure&&aggpe.l1NodesLosingAGG.length>0){const n=aggpe.l1NodesLosingAGG.length;recs.push({priority:"CRITICAL",type:"agg_uplink_lost",text:`${target} is an AGG node. ${n} L1 device(s) lose ALL AGG uplinks: ${aggpe.l1NodesLosingAGG.slice(0,5).join(", ")}${n>5?` … +${n-5} more`:""}.`,action:`Add direct connections from listed devices to ${aggpe.survivingAGGs[0]||"the alternate AGG"}.`});}
    if(aggpe.isAGGFailure&&aggpe.l1NodesLosingAGG.length===0&&aggpe.survivingAGGs.length>0)recs.push({priority:"HIGH",type:"agg_failure",text:`${target} is an AGG node. All L1 traffic will failover to ${aggpe.survivingAGGs.join(", ")}.`,action:`Verify all L1-to-AGG links on ${aggpe.survivingAGGs.join(", ")} have sufficient capacity.`});
    if(aggpe.peFullyDisrupted&&aggpe.pePairsDisrupted.length>0)recs.push({priority:"CRITICAL",type:"pe_partition",text:`PE PARTITION: ${aggpe.pePairsDisrupted.map(p=>`${p.from} ↔ ${p.to}`).join(", ")} cannot communicate at all.`,action:`IMMEDIATE: Add a direct PE-to-PE ISIS adjacency (Level 2 or 3).`});
    if(aggpe.peMetricDegraded&&aggpe.pePairsInflated.length>0){const w=aggpe.pePairsInflated.reduce((a,b)=>b.costDiff>a.costDiff?b:a);recs.push({priority:"HIGH",type:"pe_metric_degraded",text:`PE-to-PE metric explosion: ${w.from} → ${w.to} jumps ${fmtMetric(w.beforeCost)} → ${fmtMetric(w.afterCost)} (+${fmtMetric(w.costDiff)}, ${Math.round(w.afterCost/w.beforeCost)}× worse).`,action:`Add a second AGG-to-AGG link or a direct PE-to-PE ISIS adjacency.`});}
    if(aggpe.aggCrossLinkBroken&&!aggpe.isAGGFailure&&!aggpe.peFullyDisrupted&&!aggpe.peMetricDegraded)recs.push({priority:"HIGH",type:"agg_crosslink",text:`The AGG-to-AGG cross-link is broken. Inter-area traffic must detour through L1 devices.`,action:`Add a redundant AGG-to-AGG link on a physically diverse path.`});
    isolated.filter(i=>!i.self).forEach(({node})=>recs.push({priority:"CRITICAL",type:"single_homed",text:`${node} becomes completely ISIS-isolated.`,action:`Provision a second ISIS adjacency for ${node}.`}));
    if(maxLvl>=2&&!aggpe.isAGGFailure)recs.push({priority:"HIGH",type:"backbone",text:`${target} runs ISIS Level ${maxLvl}. Failure removes inter-area route advertisements.`,action:`Verify all Level-${maxLvl} destinations have two independent paths.`});
    if(degree>=8&&maxLvl===1)recs.push({priority:"HIGH",type:"hub",text:`${target} connects ${degree} L1 devices.`,action:`Add direct secondary paths for critical devices to an AGG node.`});
    const ti=pathImpact.reduce((s,p)=>s+p.totalAffected,0);
    if(avgHopInf>=2||maxHopInf>=3||avgCostInf>5000)recs.push({priority:"MEDIUM",type:"latency",text:`Average path inflation: +${avgHopInf.toFixed(1)} hops / +${fmtMetric(avgCostInf)} metric across ${ti} pairs.`,action:`Review ISIS metric assignments.`});
    if(li.length>=3){const t=li[0],cw=t.minCap<=1?" (1G — HIGH risk)":t.minCap<=10?" (10G)":" (100G)";recs.push({priority:t.risk==="HIGH"?"HIGH":"MEDIUM",type:"congestion",text:`${li.length} nodes carry more transit traffic. Most impacted: ${t.node}${cw} (+${t.increase} flows).`,action:`Check capacity on ${t.node}.`});}
    if(partitioned)recs.push({priority:"CRITICAL",type:"partition",text:`Topology partitions. ${partGroups.reduce((s,g)=>s+g.length,0)} nodes lose all connectivity.`,action:`IMMEDIATE: Add an alternate path from each isolated group.`});
    if(recs.length===0)recs.push({priority:"LOW",type:"ok",text:`${target} has limited blast radius — all neighbors retain alternate paths.`,action:`No immediate design changes required.`});
    return recs;
  }

  analyzeCurrentDown(){
    if(this.downLinks.length===0)return null;
    const fg=new Graph(this.allEdges),dg=this.baseGraph;
    const fc=fg.components().length,dc=dg.components().length,partitioned=dc>fc;
    const isolated=[];
    for(const n of fg.allNodes()){if((!dg.adj[n]||dg.degree(n)===0)&&fg.degree(n)>0)isolated.push({node:n,reason:"All adjacencies DOWN — completely unreachable"});}
    const dgComps=dg.components();const dgMainSize=dgComps.length>0?Math.max(...dgComps.map(c=>c.length)):0;const dgMainSet=new Set(dgComps.find(c=>c.length===dgMainSize)||[]);
    const alreadyCaught=new Set(isolated.map(i=>i.node));
    for(const n of fg.allNodes()){if(alreadyCaught.has(n))continue;if(dg.adj[n]&&dg.degree(n)>0&&!dgMainSet.has(n))isolated.push({node:n,reason:"Partitioned from main topology by current outage"});}
    const pg=[];if(partitioned){dgComps.filter(c=>c.length<dgMainSize).forEach(c=>pg.push(c));}
    const an=fg.allNodes(),sn=an.length>50?an.filter(n=>fg.degree(n)>1).slice(0,50):an;
    const aff=new Set();this.downLinks.forEach(({a,b})=>{aff.add(a);aff.add(b);});
    const pathImpact=[];
    for(const src of aff){if(!fg.adj[src])continue;const fd=fg.dijkstra(src),dd=dg.adj[src]?dg.dijkstra(src):{},affected=[];for(const dest of sn){if(dest===src)continue;const f=fd[dest],d=dd[dest];if(!f)continue;if(!d)affected.push({dest,beforeHops:f.hops,afterHops:null,beforeCost:f.cost,afterCost:null,hopDiff:null,costDiff:null,type:"unreachable"});else if(d.cost>f.cost||d.hops>f.hops)affected.push({dest,beforeHops:f.hops,afterHops:d.hops,beforeCost:f.cost,afterCost:d.cost,hopDiff:d.hops-f.hops,costDiff:d.cost-f.cost,type:"inflated"});}if(affected.length>0){affected.sort((a,b)=>(b.costDiff??999999)-(a.costDiff??999999));pathImpact.push({source:src,affected:affected.slice(0,10),totalAffected:affected.length});}}
    const allH=pathImpact.flatMap(p=>p.affected.filter(a=>a.hopDiff!==null).map(a=>a.hopDiff));
    const avgInf=allH.length?allH.reduce((s,v)=>s+v,0)/allH.length:0,maxInf=allH.length?Math.max(...allH):0;
    const lf={},ld={},cs=sn.slice(0,30);for(const n of an){lf[n]=0;ld[n]=0;}
    for(let i=0;i<cs.length;i++){const df=fg.bfs(cs[i]),dd2=dg.adj[cs[i]]?dg.bfs(cs[i]):{};for(let j=i+1;j<cs.length;j++){const dest=cs[j];const vf=df[dest];if(vf!==undefined&&vf>1){for(const mid of an){if(mid===cs[i]||mid===dest)continue;const dm=df[mid],dm2=fg.bfs(mid)[dest];if(dm!==undefined&&dm2!==undefined&&dm+dm2===vf)lf[mid]++;}}const vd=dd2[dest];if(vd!==undefined&&vd>1){for(const mid of an){if(mid===cs[i]||mid===dest||!dg.adj[mid])continue;const dm=dd2[mid],dm2=dg.bfs(mid)[dest];if(dm!==undefined&&dm2!==undefined&&dm+dm2===vd)ld[mid]++;}}}}
    const li=an.map(n=>{const inc=(ld[n]||0)-(lf[n]||0),mc=dg.adj[n]?dg.minCapacity(n):(fg.adj[n]?fg.minCapacity(n):1);return{node:n,before:lf[n]||0,after:ld[n]||0,increase:inc,minCap:mc,capLabel:mc<=1?"1G":mc<=10?"10G":"100G",risk:mc<=1&&inc>2?"HIGH":mc<=10&&inc>5?"MEDIUM":"LOW"};}).filter(x=>x.increase>0).sort((a,b)=>b.increase-a.increase).slice(0,8);
    const perLink=this.downLinks.map(({a,b,iface:di,port_speed,since,duration})=>{
      const e=this.allEdges.find(([x,y])=>(x===a&&y===b)||(x===b&&y===a));
      const level=e?e[2]:null,iface=di||(e?e[3]:null),cap=ifaceCapacity(iface,port_speed),metric=e?e[4]:null;
      // Extract traffic data from the edge at the time it was up (stored in allEdges)
      const edgeInputBps  = e ? (parseFloat(e[7])||0) : 0;
      const edgeOutputBps = e ? (parseFloat(e[8])||0) : 0;
      const trafficUtilPct = trafficUtil(edgeInputBps, edgeOutputBps, port_speed);
      const flc=fg.linkCapacity(a,b),dlc=dg.linkCapacity(a,b);
      const pC=flc.count||1,rC=dlc.count||0,rCap=dlc.totalCap||0;
      const aI=!dg.adj[a]||dg.degree(a)===0,bI=!dg.adj[b]||dg.degree(b)===0;
      const fd2=fg.dijkstra(a),dd3=dg.adj[a]?dg.dijkstra(a):{};
      const pb=fd2[b],pa=dd3[b],hopInf=(pb&&pa)?pa.hops-pb.hops:null,costInf=(pb&&pa)?pa.cost-pb.cost:null;
      let impact="LOW";
      if(aI||bI)impact="CRITICAL";else if(!pa&&pb)impact="CRITICAL";else if(hopInf&&hopInf>=2)impact="HIGH";else if(level>=2)impact="HIGH";else if(hopInf&&hopInf>=1)impact="MEDIUM";
      const linkKey=a<b?`${a}|${b}`:`${b}|${a}`;
      const{isolated:linkIsolated,partitioned:linkPartitioned,partitionGroups:linkPartitionGroups}=this._isolationForLink(linkKey);
      if(linkIsolated.length>0||linkPartitioned){if(impact==="LOW"||impact==="MEDIUM")impact="CRITICAL";}
      return{a,b,since,duration,level,iface,cap,capLabel:ifaceLabel(iface,port_speed),metric,
        parallelCount:pC,remainingCount:rC,remainingCap:rCap,aIsolated:aI,bIsolated:bI,
        pathBefore:pb,pathAfter:pa,hopInflation:hopInf,costInflation:costInf,impact,
        linkIsolated,linkPartitioned,linkPartitionGroups,
        // traffic at time of failure
        trafficUtilPct,edgeInputBps,edgeOutputBps};
    });
    let severity="LOW";
    if(isolated.length>0||partitioned)severity="CRITICAL";
    else if(perLink.some(l=>l.impact==="CRITICAL"))severity="CRITICAL";
    else if(perLink.some(l=>l.impact==="HIGH")||maxInf>=3)severity="HIGH";
    else if(avgInf>=1||li.length>=3)severity="MEDIUM";
    if(perLink.some(l=>l.linkIsolated?.length>0||l.linkPartitioned))severity="CRITICAL";
    const aggpe=this.computeAGGPEImpact(fg,dg,null);
    const sources=[...aff].filter(n=>fg.adj[n]);
    const aggReach=this.computeAGGReachability(fg,dg,sources);
    const downLinkKeys=this.downLinks.map(({a,b})=>a<b?`${a}|${b}`:`${b}|${a}`);
    const linkCong=this.computeLinkCongestion(fg,dg,null,null,downLinkKeys);
    const recs=[];
    if(aggpe.peFullyDisrupted&&aggpe.pePairsDisrupted.length>0)recs.push({priority:"CRITICAL",type:"pe_partition",text:`PE PARTITION: ${aggpe.pePairsDisrupted.map(p=>`${p.from} ↔ ${p.to}`).join(", ")} cannot communicate at all.`,action:`IMMEDIATE: Add a direct PE-to-PE ISIS adjacency (Level 2 or 3).`});
    if(aggpe.peMetricDegraded&&aggpe.pePairsInflated.length>0){const w=aggpe.pePairsInflated.reduce((a,b)=>b.costDiff>a.costDiff?b:a);recs.push({priority:"HIGH",type:"pe_metric_degraded",text:`PE-to-PE metric explosion: ${w.from} → ${w.to} now costs ${fmtMetric(w.afterCost)} (was ${fmtMetric(w.beforeCost)}).`,action:`Restore the down links. Long-term: add a direct PE-to-PE ISIS adjacency.`});}
    if(aggpe.aggCrossLinkBroken&&!aggpe.peFullyDisrupted&&!aggpe.peMetricDegraded)recs.push({priority:"HIGH",type:"agg_crosslink",text:`AGG cross-link is currently broken. Inter-area routing is detouring through L1 devices.`,action:`Restore the AGG-to-AGG link immediately.`});
    if(aggpe.l1NodesLosingAGG.length>0){const n=aggpe.l1NodesLosingAGG.length;recs.push({priority:"CRITICAL",type:"agg_uplink_lost",text:`${n} L1 device(s) have lost all AGG uplinks: ${aggpe.l1NodesLosingAGG.slice(0,5).join(", ")}${n>5?` … +${n-5} more`:""}. Cannot reach internet.`,action:`Restore the down links immediately.`});}
    isolated.forEach(({node,reason})=>recs.push({priority:"CRITICAL",type:"single_homed",text:`${node} is currently unreachable: ${reason}.`,action:`Restore the down link(s) touching ${node}.`}));
    perLink.forEach(l=>{if(l.linkIsolated&&l.linkIsolated.length>0){const names=l.linkIsolated.map(i=>i.node).slice(0,4).join(", ");const more=l.linkIsolated.length>4?` … +${l.linkIsolated.length-4} more`:"";recs.push({priority:"CRITICAL",type:"link_isolation",text:`Link ${l.a} ↔ ${l.b} is a bridge: its failure alone isolates ${l.linkIsolated.length} node(s): ${names}${more}.`,action:`Add a redundant path for the isolated nodes.`});}else if(l.linkPartitioned&&(!l.linkIsolated||l.linkIsolated.length===0)){recs.push({priority:"CRITICAL",type:"link_partition",text:`Link ${l.a} ↔ ${l.b} alone partitions the network into ${l.linkPartitionGroups.length+1} disconnected groups.`,action:`Add an alternate path between the partitioned segments immediately.`});}});
    const criticalCapLinks=linkCong.flows.filter(f=>f.risk==="CRITICAL");
    if(criticalCapLinks.length>0)recs.push({priority:"HIGH",type:"congestion",text:`${criticalCapLinks.length} alternate-path link(s) are near saturation: ${criticalCapLinks.slice(0,3).map(f=>`${f.nodeA}↔${f.nodeB} (${f.satPct}%)`).join(", ")}.`,action:`Monitor these links for drops.`});
    if(perLink.some(l=>l.level>=2))recs.push({priority:"HIGH",type:"backbone",text:`One or more backbone (Level 2+) links are currently down. Inter-area routing is affected.`,action:`Prioritise restoring backbone links.`});
    if(recs.length===0)recs.push({priority:"LOW",type:"ok",text:`Current outage has limited impact.`,action:`Monitor for congestion during restoration.`});
    return{downCount:this.downLinks.length,severity,isolated,partitioned,partGroups:pg,pathImpact,avgInf,maxInf,loadIncrease:li,perLink,aggpe,aggReach,linkCong,recs};
  }
}