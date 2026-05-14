// Plumberry Trail — cute trader game
const { useState, useEffect, useRef, useMemo, useCallback } = React;

const TILE = 40;
const COLS = 32;
const ROWS = 18;

// ---------- world data ----------
// road network: list of cells that are road
const ROAD_CELLS = (() => {
  const set = new Set();
  const add = (x,y)=> set.add(`${x},${y}`);
  // horizontal main road y=10 from x=2..30
  for(let x=2;x<=30;x++) add(x,10);
  // vertical to plumberry hollow
  for(let y=4;y<=10;y++) add(8,y);
  // vertical to stonebrook
  for(let y=4;y<=10;y++) add(16,y);
  // vertical to willowmere
  for(let y=10;y<=15;y++) add(24,y);
  // small loop near hollow
  for(let x=6;x<=10;x++) add(x,4);
  // approach to stonebrook
  for(let x=14;x<=18;x++) add(x,4);
  // willowmere dock
  for(let x=22;x<=26;x++) add(x,15);
  return set;
})();

const WATER_CELLS = (() => {
  const set = new Set();
  for(let x=27;x<=31;x++) for(let y=14;y<=17;y++) set.add(`${x},${y}`);
  for(let x=28;x<=31;x++) set.add(`${x},13`);
  return set;
})();

const CITIES = [
  { id:'hollow', name:'Plumberry Hollow', x:8, y:3, color:'#b07ec3', deep:'#8a5aa3', tag:'Sweet · Cozy · Bustling',
    rumors:['Honey runs low here lately.','Iron Tools sell brisk to weary travelers.'],
    mods:{ jam:-25, honey:+20, tools:+25, ore:+15, grain:-10, herbs:-15 } },
  { id:'stonebrook', name:'Stonebrook Forge', x:16, y:3, color:'#7c95b8', deep:'#4a6080', tag:'Sturdy · Industrial · Loud',
    rumors:['Ore is dirt cheap at the Forge.','Folk here would trade gold for sweet jam.'],
    mods:{ ore:-35, tools:-15, jam:+30, herbs:+10, honey:+5 } },
  { id:'willowmere', name:'Willowmere Wharf', x:24, y:16, color:'#5fa8b8', deep:'#2f7080', tag:'Salty · Misty · Curious',
    rumors:['Fresh herbs trade well by the docks.','Old tomes turn up here from far ports.'],
    mods:{ tomes:-30, herbs:+25, grain:+5, honey:-10, jam:+10 } },
];

const ITEMS = [
  { id:'jam', name:'Plum Jam', emoji:'🍇', base:14, wt:1, hint:'Sweet & sticky' },
  { id:'honey', name:'Wild Honey', emoji:'🍯', base:18, wt:1, hint:'From mossy hives' },
  { id:'grain', name:'Golden Grain', emoji:'🌾', base:9, wt:1, hint:'Loaf-ready' },
  { id:'herbs', name:'Garden Herbs', emoji:'🌿', base:12, wt:1, hint:'Fragrant bundles' },
  { id:'ore',  name:'Iron Ore',   emoji:'⛏️', base:22, wt:2, hint:'Dense & heavy' },
  { id:'tools',name:'Iron Tools', emoji:'🔨', base:34, wt:2, hint:'Forged & sharp' },
  { id:'tomes',name:'Old Tomes',  emoji:'📚', base:46, wt:2, hint:'Whisper of legend' },
];

// scatter trees / flowers for decoration
const DECO = (() => {
  const out = [];
  const rng = (seed=>()=>(seed=(seed*16807)%2147483647)/2147483647)(7);
  const k = (x,y)=>`${x},${y}`;
  for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++){
    if(ROAD_CELLS.has(k(x,y))||WATER_CELLS.has(k(x,y))) continue;
    if(Math.abs(x-8)<2 && Math.abs(y-3)<2) continue; // hollow zone
    if(Math.abs(x-16)<2 && Math.abs(y-3)<2) continue;
    if(Math.abs(x-24)<2 && Math.abs(y-16)<2) continue;
    const r = rng();
    if(r<0.04) out.push({x,y,kind:'🌳'});
    else if(r<0.06) out.push({x,y,kind:'🌲'});
    else if(r<0.08) out.push({x,y,kind:'🌸'});
    else if(r<0.095) out.push({x,y,kind:'🍄'});
    else if(r<0.105) out.push({x,y,kind:'🌼'});
  }
  return out;
})();

const NPCS = [
  { id:'wren', x:11, y:11, color:'#e57389', shirt:'#f4d186', skin:'#fad4b3', hair:'#7c4a2f', hat:'flower',
    name:'Wren', line:"Try the jam at the Hollow — it's heavenly!" },
  { id:'pip',  x:14, y:9,  color:'#7fbf83', shirt:'#a8cef0', skin:'#f9c89b', hair:'#3b2a1d', hat:'cap',
    name:'Pip',  line:"Stonebrook needs sweet things. Bring jam!" },
  { id:'ora',  x:24, y:14, color:'#b07ec3', shirt:'#fad4b3', skin:'#e9b889', hair:'#b07ec3', hat:'sailor',
    name:'Ora',  line:"A ship rolled in with strange old books..." },
  { id:'bram', x:5,  y:10, color:'#f0a830', shirt:'#bce6a8', skin:'#f5c79a', hair:'#a87432', hat:'straw',
    name:'Bram', line:"Mind the wolves on the high road, friend." },
];

// ---------- pathfinding (BFS over road tiles + city tiles) ----------
function findPath(start, goal){
  const k = (x,y)=>`${x},${y}`;
  const passable = (x,y)=> ROAD_CELLS.has(k(x,y)) || CITIES.some(c=>c.x===x&&c.y===y) || (x===start.x&&y===start.y) || (x===goal.x&&y===goal.y);
  if(!passable(goal.x,goal.y)) {
    // snap goal to nearest road
    let best=null, bd=Infinity;
    for(const cell of ROAD_CELLS){
      const [cx,cy]=cell.split(',').map(Number);
      const d=Math.abs(cx-goal.x)+Math.abs(cy-goal.y);
      if(d<bd){bd=d; best={x:cx,y:cy}}
    }
    if(best) goal = best;
  }
  const q=[start];
  const came=new Map(); came.set(k(start.x,start.y), null);
  while(q.length){
    const cur=q.shift();
    if(cur.x===goal.x && cur.y===goal.y) break;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=cur.x+dx, ny=cur.y+dy;
      if(nx<0||ny<0||nx>=COLS||ny>=ROWS) continue;
      if(!passable(nx,ny)) continue;
      const kk=k(nx,ny);
      if(came.has(kk)) continue;
      came.set(kk, cur);
      q.push({x:nx,y:ny});
    }
  }
  // reconstruct
  const path=[];
  let cur=goal;
  while(cur){
    path.unshift(cur);
    cur = came.get(k(cur.x,cur.y));
  }
  return path.length>1 ? path : [];
}

// ---------- price calc ----------
function priceFor(city, item, side){
  const mod = (city.mods[item.id]||0)/100;
  const buy = Math.max(1, Math.round(item.base * (1+mod)));
  const sell = Math.max(1, Math.round(item.base * (1+mod) * 0.92));
  return side==='buy' ? buy : sell;
}
function modLabel(city, item){
  const m = city.mods[item.id] || 0;
  if(m === 0) return { kind:'flat', text:'• 0%' };
  if(m < 0)  return { kind:'down', text:`▼ ${m}%` };
  return { kind:'up', text:`▲ +${m}%` };
}

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "season": "spring",
  "showNpcs": true,
  "showLabels": true,
  "characterColor": "#b07ec3",
  "difficulty": "cozy"
}/*EDITMODE-END*/;

function App(){
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [pos, setPos] = useState({ x: 12, y: 10 });
  const [path, setPath] = useState([]);
  const [walking, setWalking] = useState(false);
  const [facingLeft, setFacingLeft] = useState(false);
  const [gold, setGold] = useState(640);
  const [day, setDay] = useState(7);
  const [hold, setHold] = useState({ jam:2, honey:1, grain:5, herbs:0, ore:1, tools:0, tomes:0 });
  const cap = 24;
  const carried = Object.entries(hold).reduce((s,[k,n])=> s + n*(ITEMS.find(i=>i.id===k).wt), 0);
  const [openCity, setOpenCity] = useState(null);
  const [tab, setTab] = useState('buy');
  const [bubble, setBubble] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [arrived, setArrived] = useState(null);
  const [view, setView] = useState('Roam');
  const stageRef = useRef();

  // walk along path
  useEffect(()=>{
    if(!path.length){ setWalking(false); return }
    setWalking(true);
    let idx = 0;
    const timer = setInterval(()=>{
      idx++;
      if(idx >= path.length){
        clearInterval(timer);
        setWalking(false);
        setPath([]);
        return;
      }
      const cur = path[idx-1], next = path[idx];
      setFacingLeft(next.x < cur.x);
      setPos(next);
    }, 220);
    return ()=> clearInterval(timer);
  }, [path]);

  // arriving at a city
  useEffect(()=>{
    if(walking) return;
    const c = CITIES.find(c=>c.x===pos.x && c.y===pos.y);
    if(c && arrived !== c.id){
      setArrived(c.id);
      setDay(d=>d+1);
      // city banner
      setBannerCity(c);
      setTimeout(()=>setBannerCity(null), 2200);
      // auto-open market shortly after arrival
      setTimeout(()=>setOpenCity(c.id), 1100);
    }
    if(!c) setArrived(null);
  }, [pos, walking]);

  const [bannerCity, setBannerCity] = useState(null);

  function handleStageClick(e){
    if(openCity) return;
    if(walking) return;
    const r = stageRef.current.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const x = Math.max(0, Math.min(COLS-1, Math.floor(sx / TILE)));
    const y = Math.max(0, Math.min(ROWS-1, Math.floor(sy / TILE)));
    // city hit?
    const c = CITIES.find(c=> Math.abs(c.x-x)<=1 && Math.abs(c.y-y)<=1);
    if(c){
      const p = findPath(pos, {x:c.x, y:c.y});
      if(p.length>1) setPath(p);
      else if(c.x===pos.x && c.y===pos.y) setOpenCity(c.id);
      return;
    }
    const p = findPath(pos, {x,y});
    if(p.length>1) setPath(p);
  }

  function showToast(text, kind='info'){
    const id = Math.random();
    setToasts(ts=>[...ts, {id, text, kind}]);
    setTimeout(()=> setToasts(ts=> ts.filter(t=>t.id!==id)), 1700);
  }

  function buyItem(city, item, qty){
    qty = Math.min(qty, Math.floor((cap - carried)/item.wt));
    const p = priceFor(city, item, 'buy') * qty;
    qty = Math.min(qty, Math.floor(gold / priceFor(city, item, 'buy')));
    if(qty<=0){ showToast('No room or no coin', 'loss'); return }
    setGold(g=> g - priceFor(city,item,'buy')*qty);
    setHold(h=> ({...h, [item.id]: (h[item.id]||0)+qty}));
    showToast(`+${qty} ${item.name}`, 'gain');
  }
  function sellItem(city, item, qty){
    qty = Math.min(qty, hold[item.id]||0);
    if(qty<=0){ showToast(`No ${item.name} to sell`, 'loss'); return }
    setGold(g=> g + priceFor(city, item, 'sell')*qty);
    setHold(h=> ({...h, [item.id]: h[item.id]-qty}));
    showToast(`+${priceFor(city,item,'sell')*qty}g`, 'gain');
  }

  function npcTalk(npc){
    setBubble({ npc, line: npc.line });
    setTimeout(()=> setBubble(null), 2400);
  }

  // tile map (memoized)
  const tiles = useMemo(()=>{
    const arr = [];
    for(let y=0;y<ROWS;y++){
      for(let x=0;x<COLS;x++){
        const k = `${x},${y}`;
        let cls='grass';
        if((x+y)%3===0) cls='grass b';
        if((x*7+y)%5===0) cls='grass c';
        if(ROAD_CELLS.has(k)) cls = ((x+y)%2===0 ? 'road' : 'road b');
        if(WATER_CELLS.has(k)) cls = 'water';
        arr.push(<div key={k} className={`tile ${cls}`} style={{left:x*TILE, top:y*TILE, width:TILE, height:TILE}} />);
      }
    }
    return arr;
  },[]);

  const city = CITIES.find(c=>c.id===openCity);

  // tweaks affect only flavor: season swaps grass tones via CSS var (we'll use inline)
  const seasonStyle = {
    spring:{ filter:'none' },
    summer:{ filter:'hue-rotate(-8deg) saturate(1.05)'},
    autumn:{ filter:'hue-rotate(-30deg) saturate(1.1) brightness(0.97)'},
    winter:{ filter:'hue-rotate(170deg) saturate(0.5) brightness(1.1)'},
  }[t.season] || {};

  return (
    <>
      {/* drifting clouds */}
      <div className="cloud" style={{top:'8%', left:'10%', width:80, height:24, animationDuration:'70s'}}></div>
      <div className="cloud" style={{top:'18%', left:'40%', width:60, height:20, animationDuration:'90s', animationDelay:'-30s'}}></div>
      <div className="cloud" style={{top:'5%', left:'70%', width:100, height:28, animationDuration:'80s', animationDelay:'-50s'}}></div>

      <header className="topbar">
        <div className="logo">
          <div className="logo-mark">P</div>
          <h1>Plumberry Trail</h1>
          <span className="tag">EARLY BLOOM</span>
        </div>
        <div className="nav">
          {['Roam','Trade','Survive'].map(v=>(
            <button key={v} className={view===v?'active':''} onClick={()=>setView(v)}>{v}</button>
          ))}
        </div>
        <div className="stats">
          <div className="stat" title="Gold">
            <div className="icon gold">✦</div>
            {gold}<small>g</small>
          </div>
          <div className="stat" title="Cargo">
            <div className="icon cargo">🎒</div>
            {carried}<small>/{cap}</small>
          </div>
          <div className="stat" title="Day">
            <div className="icon day">☀</div>
            <small>Day</small>{day}
          </div>
        </div>
      </header>

      <main className="stage" ref={stageRef}>
        <div className="world" onClick={handleStageClick} style={seasonStyle}>
          <div className="tile-grid" style={{width: COLS*TILE, height: ROWS*TILE}}>
            {tiles}

            {/* decorations */}
            {DECO.map((d,i)=>(
              <div key={i} className="deco" style={{
                left: d.x*TILE + 8 + (i%3)*4,
                top: d.y*TILE + 6 + (i%2)*4,
                fontSize: d.kind==='🌸'||d.kind==='🌼'||d.kind==='🍄' ? 14 : 22
              }}>{d.kind}</div>
            ))}

            {/* ambient butterflies */}
            <div className="flutter" style={{left: 80, top: 120, animationDelay:'-3s'}}>🦋</div>
            <div className="flutter" style={{left: 320, top: 280, animationDelay:'-11s', animationDuration:'26s'}}>🦋</div>
            <div className="flutter" style={{left: 640, top: 200, animationDelay:'-18s', animationDuration:'30s'}}>🐝</div>

            {/* cities/buildings */}
            {CITIES.map(c=>{
              const w = 110, h = 110;
              return (
                <div key={c.id} className="building"
                  style={{ left: c.x*TILE - w/2 + TILE/2, top: c.y*TILE - h + TILE/2 + 6, width:w, height:h }}
                  onClick={(e)=>{ e.stopPropagation();
                    if(pos.x===c.x && pos.y===c.y){ setOpenCity(c.id); return }
                    const p = findPath(pos,{x:c.x,y:c.y}); if(p.length>1) setPath(p);
                  }}>
                  <CitySprite city={c}/>
                  <div className="blabel">{c.name}</div>
                </div>
              );
            })}

            {/* npcs */}
            {t.showNpcs && NPCS.map(n=>(
              <div key={n.id} className="npc" style={{ left: n.x*TILE + TILE/2, top: n.y*TILE + TILE/2 + 4 }}
                onClick={(e)=>{ e.stopPropagation(); npcTalk(n); }}>
                <NpcSprite npc={n}/>
                <div className="npc-shadow"></div>
              </div>
            ))}

            {/* speech bubble */}
            {bubble && (
              <div className="bubble" style={{ left: bubble.npc.x*TILE + TILE/2, top: bubble.npc.y*TILE - 4 }}>
                <b style={{color:bubble.npc.color}}>{bubble.npc.name}: </b>{bubble.line}
              </div>
            )}

            {/* destination marker */}
            {path.length>1 && (
              <div className="quest-marker" style={{ left: path[path.length-1].x*TILE + TILE/2, top: path[path.length-1].y*TILE - 4 }}>
                <div className="pin">★ Heading here</div>
              </div>
            )}

            {/* player */}
            <div className={`player ${walking?'walking':''} ${facingLeft?'flip':''}`}
              style={{ left: pos.x*TILE + TILE/2, top: pos.y*TILE + TILE/2 - 4 }}>
              <PlayerSprite color={t.characterColor}/>
              <div className="player-shadow"></div>
            </div>
          </div>
        </div>

        {/* HUD: minimap + quest card */}
        <div className="hud-quest">
          <div className="minimap">
            {/* roads as little strokes */}
            <div className="mm-road" style={{left:'8%', right:'4%', top:'58%', height:5, borderRadius:3}}></div>
            <div className="mm-road" style={{left:'24%', top:'18%', width:5, height:'42%', borderRadius:3}}></div>
            <div className="mm-road" style={{left:'50%', top:'18%', width:5, height:'42%', borderRadius:3}}></div>
            <div className="mm-road" style={{left:'76%', top:'58%', width:5, height:'30%', borderRadius:3}}></div>
            {CITIES.map(c=>(
              <div key={c.id} className="mm-city" style={{
                left:`${(c.x/COLS)*100}%`, top:`${(c.y/ROWS)*100}%`,
                background: c.color
              }}/>
            ))}
            <div className="mm-you" style={{ left:`${(pos.x/COLS)*100}%`, top:`${(pos.y/ROWS)*100}%` }}/>
          </div>
          <div className="quest-card">
            <div className="qhead"><span className="qdot"></span> {walking?'On the trail':city?city.name:nearestCityName(pos)}</div>
            <div className="qsub">{walking?'Hooves on cobble. Watch for mushrooms.':'Tap a town to visit. Tap a wanderer to chat.'}</div>
          </div>
        </div>

        {/* HUD actions */}
        <div className="hud-actions">
          <button className="actbtn" onClick={()=>showToast('Saved your trail ✿','gain')}>
            <div className="ab-icon">💾</div> Save
          </button>
          <button className="actbtn" onClick={()=>showToast('Map open soon!','info')}>
            <div className="ab-icon">🗺️</div> Map
          </button>
        </div>

        <div className="hud-tip">
          <span><span className="kbd">Click</span> to roll</span>
          <span><span className="kbd">Tap</span> a townsfolk</span>
          <span><span className="kbd">Visit</span> a town</span>
        </div>

        {/* toasts */}
        <div className="toast-zone">
          {toasts.map(t=> <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind==='gain'?'✿':t.kind==='loss'?'✗':'·'} {t.text}
          </div>)}
        </div>

        {/* arrival banner */}
        {bannerCity && (
          <div className="citybanner">
            <div className="b1">Welcome to {bannerCity.name}!</div>
            <div className="b2">{bannerCity.tag}</div>
          </div>
        )}

        {/* Market modal */}
        {city && (
          <div className="scrim" onClick={()=>setOpenCity(null)}>
            <div className="modal" onClick={e=>e.stopPropagation()}>
              <div className="mhead">
                <div>
                  <h2>{city.name} Market</h2>
                  <div className="msub">{city.tag}</div>
                </div>
                <button className="closebtn" onClick={()=>setOpenCity(null)}>✕</button>
              </div>
              <div className="tabs">
                <button className={`tab ${tab==='buy'?'active':''}`} onClick={()=>setTab('buy')}>Buy</button>
                <button className={`tab sell ${tab==='sell'?'active sell':''}`} onClick={()=>setTab('sell')}>Sell</button>
                <button className={`tab gear ${tab==='gear'?'active gear':''}`} onClick={()=>setTab('gear')}>✦ Gear</button>
              </div>
              <div className="mbody">
                {tab!=='gear' && (
                  <div className="rumors">
                    <h4>🪶 Whispers around the well</h4>
                    <ul>
                      {city.rumors.map((r,i)=> <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                )}
                {tab==='gear' ? (
                  <GearList />
                ) : ITEMS.map(item=>{
                  const tag = modLabel(city,item);
                  const series = priceHistory(city, item, day, 10);
                  return (
                    <div key={item.id} className="item">
                      <div className="item-icon">{item.emoji}</div>
                      <div className="item-info">
                        <h4>{item.name} <span className="pricetag" style={{
                          background: tag.kind==='up'?'#ffd2d2':tag.kind==='down'?'#cdf0c4':'#e6e2da',
                          color: tag.kind==='up'?'#a02828':tag.kind==='down'?'#2f6b34':'#6b4f3a',
                          boxShadow: tag.kind==='up'?'0 2px 0 #a02828':tag.kind==='down'?'0 2px 0 #2f6b34':'0 2px 0 #6b4f3a'
                        }}>{tag.text}</span></h4>
                        <div className="meta">Have {hold[item.id]||0} · Wt {item.wt} · {item.hint}</div>
                        <div className="price">
                          {tab==='buy' ? <>Buy <b>{priceFor(city,item,'buy')}g</b></> : <>Sell <b>{priceFor(city,item,'sell')}g</b></>}
                          <span className="mute">{tab==='buy'?'sell '+priceFor(city,item,'sell')+'g':'buy '+priceFor(city,item,'buy')+'g'}</span>
                        </div>
                      </div>
                      <div className="spark-wrap">
                        <div className="spark-cap">10-day trend</div>
                        <Spark series={series} kind={tag.kind}/>
                      </div>
                      <div className="qty">
                        <button onClick={()=> tab==='buy' ? buyItem(city,item,1) : sellItem(city,item,1)}>+1</button>
                        <button onClick={()=> tab==='buy' ? buyItem(city,item,5) : sellItem(city,item,5)}>+5</button>
                        <button className="max" onClick={()=> tab==='buy'
                          ? buyItem(city,item, Math.min(Math.floor((cap-carried)/item.wt), Math.floor(gold/priceFor(city,item,'buy'))))
                          : sellItem(city,item, hold[item.id]||0)}>Max</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Tweaks */}
      <TweaksPanel title="Tweaks">
        <TweakSection label="World" />
        <TweakRadio label="Season" value={t.season}
          options={['spring','summer','autumn','winter']}
          onChange={v=>setTweak('season', v)} />
        <TweakRadio label="Difficulty" value={t.difficulty}
          options={['cozy','steady','spicy']}
          onChange={v=>setTweak('difficulty', v)} />
        <TweakSection label="Visuals" />
        <TweakColor label="Cart paint" value={t.characterColor}
          options={['#b07ec3','#e57389','#7fbf83','#f0a830','#7c95b8']}
          onChange={v=>setTweak('characterColor', v)} />
        <TweakToggle label="Show wanderers" value={t.showNpcs}
          onChange={v=>setTweak('showNpcs', v)} />
        <TweakSection label="Cheats ✿" />
        <TweakButton label="Pocket money" onClick={()=>{ setGold(g=>g+250); }}>+250g</TweakButton>
        <TweakButton label="Skip a day" onClick={()=>setDay(d=>d+1)}>Next day</TweakButton>
      </TweaksPanel>
    </>
  );
}

function GearList(){
  const items = [
    { name:'Sturdier Cart', desc:'+8 cargo capacity', cost:180, emoji:'🛒' },
    { name:'Swift Hooves', desc:'Travel one extra tile per click', cost:240, emoji:'🐎' },
    { name:'Trader\'s Spyglass', desc:'See prices from afar', cost:320, emoji:'🔭' },
    { name:'Lucky Coin', desc:'+5% sell prices, just because', cost:140, emoji:'🪙' },
  ];
  return (
    <>
      {items.map((it,i)=>(
        <div key={i} className="item">
          <div className="item-icon">{it.emoji}</div>
          <div className="item-info">
            <h4>{it.name}</h4>
            <div className="meta">{it.desc}</div>
            <div className="price">Buy <b>{it.cost}g</b></div>
          </div>
          <div className="qty">
            <button className="max">Get</button>
          </div>
        </div>
      ))}
    </>
  );
}

function CitySprite({city}){
  const roof = city.color, roofDeep = city.deep;
  // shared parts: chimney smoke
  return (
    <svg width="110" height="110" viewBox="0 0 110 110">
      <defs>
        <linearGradient id={"roof-"+city.id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={roof}/>
          <stop offset="1" stopColor={roofDeep}/>
        </linearGradient>
      </defs>

      {/* back tree silhouette for hollow */}
      {city.id==='hollow' && (
        <g opacity=".75">
          <ellipse cx="14" cy="62" rx="12" ry="14" fill="#7fbf83" stroke="#3b2a1d" strokeWidth="2"/>
          <ellipse cx="96" cy="62" rx="12" ry="14" fill="#7fbf83" stroke="#3b2a1d" strokeWidth="2"/>
        </g>
      )}
      {city.id==='willowmere' && (
        <g opacity=".75">
          <rect x="6" y="86" width="98" height="14" rx="2" fill="#9ad6e8" stroke="#3b2a1d" strokeWidth="2"/>
          <path d="M10 92 Q20 90 30 92 Q40 94 50 92 Q60 90 70 92 Q80 94 90 92 Q100 90 104 92" stroke="#fff" strokeWidth="1.5" fill="none" opacity=".7"/>
        </g>
      )}

      {/* main body */}
      <rect x="20" y="55" width="70" height="45" rx="3" fill="#fffaef" stroke="#3b2a1d" strokeWidth="2.5"/>
      {/* timber accents */}
      <path d="M20 70 L90 70" stroke="#8a6440" strokeWidth="2.4" opacity=".65"/>
      <path d="M30 55 L30 70 M55 70 L55 100 M80 55 L80 70" stroke="#8a6440" strokeWidth="2.4" opacity=".55"/>

      {/* chimney */}
      <rect x="68" y="22" width="10" height="20" fill="#c08866" stroke="#3b2a1d" strokeWidth="2"/>
      <rect x="66" y="20" width="14" height="5" fill="#a06f55" stroke="#3b2a1d" strokeWidth="2"/>
      {/* smoke */}
      <g className="smoke">
        <circle cx="73" cy="14" r="4" fill="rgba(255,255,255,.85)"/>
        <circle cx="78" cy="8" r="3" fill="rgba(255,255,255,.7)"/>
        <circle cx="84" cy="3" r="2.4" fill="rgba(255,255,255,.55)"/>
      </g>

      {/* roof */}
      <path d="M12 55 L55 24 L98 55 Z" fill={"url(#roof-"+city.id+")"} stroke="#3b2a1d" strokeWidth="2.5" strokeLinejoin="round"/>
      {/* roof shingles hint */}
      <path d="M22 50 L88 50" stroke="rgba(0,0,0,.18)" strokeWidth="1.4"/>
      <path d="M30 44 L80 44" stroke="rgba(0,0,0,.14)" strokeWidth="1.2"/>
      <path d="M38 38 L72 38" stroke="rgba(0,0,0,.12)" strokeWidth="1"/>

      {/* roof finial flag */}
      <line x1="55" y1="24" x2="55" y2="14" stroke="#3b2a1d" strokeWidth="2"/>
      <path d="M55 14 L66 17 L55 20 Z" fill={roof} stroke="#3b2a1d" strokeWidth="1.6"/>

      {/* windows */}
      <g>
        <rect x="28" y="76" width="14" height="14" rx="2" fill="#a8cef0" stroke="#3b2a1d" strokeWidth="2"/>
        <path d="M35 76 L35 90 M28 83 L42 83" stroke="#3b2a1d" strokeWidth="1.5"/>
        <rect x="68" y="76" width="14" height="14" rx="2" fill="#a8cef0" stroke="#3b2a1d" strokeWidth="2"/>
        <path d="M75 76 L75 90 M68 83 L82 83" stroke="#3b2a1d" strokeWidth="1.5"/>
        {/* window box w/ flowers */}
        <rect x="26" y="89" width="18" height="4" fill="#8a6440" stroke="#3b2a1d" strokeWidth="1.4"/>
        <circle cx="30" cy="88" r="2" fill="#e57389" stroke="#3b2a1d" strokeWidth="1"/>
        <circle cx="35" cy="88" r="2" fill="#f0a830" stroke="#3b2a1d" strokeWidth="1"/>
        <circle cx="40" cy="88" r="2" fill="#b07ec3" stroke="#3b2a1d" strokeWidth="1"/>
      </g>

      {/* door */}
      <rect x="50" y="78" width="14" height="22" rx="2" fill="#7a4f30" stroke="#3b2a1d" strokeWidth="2"/>
      <circle cx="61" cy="89" r="1.2" fill="#f0a830"/>

      {/* hanging sign with icon */}
      <g>
        <line x1="57" y1="62" x2="57" y2="68" stroke="#3b2a1d" strokeWidth="1.4"/>
        <rect x="46" y="68" width="22" height="14" rx="3" fill="#fffaef" stroke="#3b2a1d" strokeWidth="2"/>
        <rect x="46" y="68" width="22" height="4" fill={roof}/>
        {city.id==='hollow' && (
          <g transform="translate(57 76)">
            {/* plum cluster */}
            <circle cx="-3" cy="0" r="3" fill="#b07ec3" stroke="#3b2a1d" strokeWidth="1.2"/>
            <circle cx="3" cy="0" r="3" fill="#8a5aa3" stroke="#3b2a1d" strokeWidth="1.2"/>
            <circle cx="0" cy="-3" r="2.4" fill="#b07ec3" stroke="#3b2a1d" strokeWidth="1.2"/>
            <path d="M0 -5 L2 -7" stroke="#4f9e5b" strokeWidth="1.4" strokeLinecap="round"/>
          </g>
        )}
        {city.id==='stonebrook' && (
          <g transform="translate(57 76)">
            {/* anvil + hammer */}
            <path d="M-5 1 L5 1 L4 -2 L-4 -2 Z" fill="#5a6b80" stroke="#3b2a1d" strokeWidth="1.2"/>
            <rect x="-2" y="1" width="4" height="3" fill="#5a6b80" stroke="#3b2a1d" strokeWidth="1.2"/>
            <rect x="-4" y="-5" width="6" height="3" rx="1" fill="#8a6440" stroke="#3b2a1d" strokeWidth="1.2"/>
            <rect x="2" y="-4.5" width="3" height="2" fill="#3b2a1d"/>
          </g>
        )}
        {city.id==='willowmere' && (
          <g transform="translate(57 76)">
            {/* anchor */}
            <circle cx="0" cy="-3" r="1.6" fill="none" stroke="#3b2a1d" strokeWidth="1.4"/>
            <line x1="0" y1="-1.5" x2="0" y2="3.5" stroke="#3b2a1d" strokeWidth="1.6"/>
            <path d="M-4 2 Q0 6 4 2" fill="none" stroke="#3b2a1d" strokeWidth="1.6" strokeLinecap="round"/>
            <line x1="-2.5" y1="0" x2="2.5" y2="0" stroke="#3b2a1d" strokeWidth="1.4"/>
          </g>
        )}
      </g>
    </svg>
  );
}

function PlayerSprite({color}){
  const dark = shadeColor(color, -25);
  return (
    <svg width="64" height="56" viewBox="0 0 64 56">
      {/* horse */}
      <g>
        {/* back leg */}
        <rect x="13" y="32" width="4" height="14" fill="#7c5237" stroke="#3b2a1d" strokeWidth="1.6"/>
        <rect x="22" y="32" width="4" height="14" fill="#7c5237" stroke="#3b2a1d" strokeWidth="1.6"/>
        {/* body */}
        <path d="M8 28 Q8 20 18 20 L28 20 Q32 20 32 26 L32 36 Q32 40 28 40 L12 40 Q8 40 8 36 Z"
              fill="#7c5237" stroke="#3b2a1d" strokeWidth="2"/>
        {/* head */}
        <path d="M2 18 Q2 12 8 12 L12 12 Q14 12 14 16 L14 26 Q14 30 10 30 L4 30 Q2 30 2 26 Z"
              fill="#7c5237" stroke="#3b2a1d" strokeWidth="2"/>
        {/* mane */}
        <path d="M10 12 Q12 8 16 10 Q14 14 12 16 Q10 16 10 12 Z" fill="#3b2a1d"/>
        <path d="M14 18 Q18 18 18 22" stroke="#3b2a1d" strokeWidth="1.6" fill="none"/>
        {/* eye */}
        <circle cx="6" cy="20" r="1.2" fill="#3b2a1d"/>
        <circle cx="6.2" cy="19.6" r="0.4" fill="#fff"/>
        {/* nostril */}
        <circle cx="3" cy="24" r="0.7" fill="#3b2a1d"/>
        {/* harness */}
        <rect x="2" y="22" width="14" height="2" fill="#c87a2a" stroke="#3b2a1d" strokeWidth="1"/>
        {/* tail */}
        <path d="M32 24 Q40 22 38 32 Q36 32 33 30" fill="#3b2a1d"/>
      </g>

      {/* cart */}
      <g>
        {/* shaft */}
        <line x1="14" y1="30" x2="30" y2="34" stroke="#3b2a1d" strokeWidth="2"/>
        {/* body */}
        <rect x="28" y="22" width="32" height="20" rx="3" fill={color} stroke="#3b2a1d" strokeWidth="2"/>
        <rect x="28" y="22" width="32" height="5" fill="rgba(255,255,255,.25)"/>
        <rect x="30" y="29" width="28" height="11" rx="2" fill={dark} opacity=".5"/>
        {/* cargo crate */}
        <rect x="36" y="14" width="18" height="11" rx="2" fill="#d99657" stroke="#3b2a1d" strokeWidth="2"/>
        <line x1="36" y1="19.5" x2="54" y2="19.5" stroke="#3b2a1d" strokeWidth="1.4"/>
        <line x1="45" y1="14" x2="45" y2="25" stroke="#3b2a1d" strokeWidth="1.4"/>
        {/* canopy ribs */}
        <circle cx="36" cy="22" r="1.6" fill="#fdecc4" stroke="#3b2a1d" strokeWidth="1"/>
        <circle cx="52" cy="22" r="1.6" fill="#fdecc4" stroke="#3b2a1d" strokeWidth="1"/>
        {/* wheels */}
        <g className="wheel">
          <circle cx="34" cy="44" r="6" fill="#3b2a1d"/>
          <circle cx="34" cy="44" r="4" fill="#8a6440"/>
          <circle cx="34" cy="44" r="1.4" fill="#3b2a1d"/>
          <line x1="30" y1="44" x2="38" y2="44" stroke="#3b2a1d" strokeWidth="1.2"/>
          <line x1="34" y1="40" x2="34" y2="48" stroke="#3b2a1d" strokeWidth="1.2"/>
        </g>
        <g className="wheel">
          <circle cx="54" cy="44" r="6" fill="#3b2a1d"/>
          <circle cx="54" cy="44" r="4" fill="#8a6440"/>
          <circle cx="54" cy="44" r="1.4" fill="#3b2a1d"/>
          <line x1="50" y1="44" x2="58" y2="44" stroke="#3b2a1d" strokeWidth="1.2"/>
          <line x1="54" y1="40" x2="54" y2="48" stroke="#3b2a1d" strokeWidth="1.2"/>
        </g>
      </g>
    </svg>
  );
}

function NpcSprite({npc}){
  const { skin, hair, shirt, hat } = npc;
  return (
    <svg className="npc-svg" width="40" height="48" viewBox="0 0 40 48" aria-hidden="true">
      {/* body */}
      <path d="M8 36 Q8 28 20 28 Q32 28 32 36 L32 44 Q32 46 30 46 L10 46 Q8 46 8 44 Z"
            fill={shirt} stroke="#3b2a1d" strokeWidth="2" strokeLinejoin="round"/>
      {/* arms */}
      <ellipse cx="7" cy="36" rx="3.6" ry="3" fill={skin} stroke="#3b2a1d" strokeWidth="1.6"/>
      <ellipse cx="33" cy="36" rx="3.6" ry="3" fill={skin} stroke="#3b2a1d" strokeWidth="1.6"/>
      {/* collar */}
      <path d="M16 28 L20 32 L24 28" fill="none" stroke="#3b2a1d" strokeWidth="1.4" strokeLinecap="round"/>
      {/* head */}
      <circle cx="20" cy="18" r="11" fill={skin} stroke="#3b2a1d" strokeWidth="2"/>
      {/* hair */}
      <path d="M10 16 Q10 6 20 6 Q30 6 30 16 Q28 12 24 13 Q22 9 18 12 Q14 11 12 14 Q11 15 10 16 Z"
            fill={hair} stroke="#3b2a1d" strokeWidth="1.6" strokeLinejoin="round"/>
      {/* hat variants */}
      {hat==='straw' && (
        <g>
          <ellipse cx="20" cy="9" rx="14" ry="2.6" fill="#e6c07b" stroke="#3b2a1d" strokeWidth="1.6"/>
          <path d="M13 9 Q13 3 20 3 Q27 3 27 9 Z" fill="#f0d28e" stroke="#3b2a1d" strokeWidth="1.6"/>
          <path d="M13 8 Q20 7 27 8" stroke="#a87432" strokeWidth="1" fill="none"/>
        </g>
      )}
      {hat==='cap' && (
        <g>
          <path d="M11 12 Q11 4 20 4 Q29 4 29 12 Z" fill="#5d8fb8" stroke="#3b2a1d" strokeWidth="1.6"/>
          <path d="M11 12 Q15 14 20 14 Q25 14 31 12 L31 14 Q24 16 20 16 Q15 16 11 14 Z"
                fill="#3a6a90" stroke="#3b2a1d" strokeWidth="1.4"/>
        </g>
      )}
      {hat==='flower' && (
        <g>
          <circle cx="13" cy="8" r="2" fill="#e57389" stroke="#3b2a1d" strokeWidth="1.2"/>
          <circle cx="13" cy="8" r="0.8" fill="#fff3c2"/>
        </g>
      )}
      {hat==='sailor' && (
        <g>
          <ellipse cx="20" cy="10" rx="11" ry="2" fill="#fdfaf0" stroke="#3b2a1d" strokeWidth="1.6"/>
          <path d="M12 10 Q12 4 20 4 Q28 4 28 10 Z" fill="#fdfaf0" stroke="#3b2a1d" strokeWidth="1.6"/>
          <rect x="15" y="6" width="10" height="2" fill="#5d8fb8"/>
        </g>
      )}
      {/* cheeks */}
      <ellipse cx="13.5" cy="20.5" rx="2.2" ry="1.4" fill="#f29ab0" opacity="0.7"/>
      <ellipse cx="26.5" cy="20.5" rx="2.2" ry="1.4" fill="#f29ab0" opacity="0.7"/>
      {/* eyes */}
      <circle cx="16" cy="18" r="1.6" fill="#3b2a1d"/>
      <circle cx="24" cy="18" r="1.6" fill="#3b2a1d"/>
      <circle cx="16.5" cy="17.4" r="0.5" fill="#fff"/>
      <circle cx="24.5" cy="17.4" r="0.5" fill="#fff"/>
      {/* smile */}
      <path d="M17 22.5 Q20 24.5 23 22.5" fill="none" stroke="#3b2a1d" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  );
}

function priceHistory(city, item, day, len=10){
  // deterministic pseudo-random walk seeded by city+item
  const seed = (city.id+item.id).split('').reduce((s,c)=> (s*131 + c.charCodeAt(0))>>>0, 7);
  const rng = (n)=>{ let s = (seed + n*9301 + 49297) % 233280; return s/233280; };
  const mod = (city.mods[item.id]||0)/100;
  const arr = [];
  let cur = item.base * (1 + mod * 0.6);
  for(let i=0;i<len-1;i++){
    cur += (rng(i+day) - 0.5) * item.base * 0.18;
    cur = Math.max(item.base*0.55, Math.min(item.base*1.55, cur));
    arr.push(cur);
  }
  arr.push(item.base * (1 + mod)); // current
  return arr;
}

function Spark({series, kind}){
  const W=120, H=34, P=3;
  const min = Math.min(...series), max = Math.max(...series);
  const span = Math.max(1, max-min);
  const stroke = kind==='up' ? '#a02828' : kind==='down' ? '#2f6b34' : '#6b4f3a';
  const fill   = kind==='up' ? 'rgba(229,115,137,.18)' : kind==='down' ? 'rgba(127,191,131,.22)' : 'rgba(107,79,58,.12)';
  const pts = series.map((v,i)=>{
    const x = P + (i/(series.length-1)) * (W - P*2);
    const y = P + (1 - (v-min)/span) * (H - P*2);
    return [x,y];
  });
  const d = pts.map((p,i)=> (i===0?'M':'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = `${d} L ${pts[pts.length-1][0].toFixed(1)} ${H-P} L ${pts[0][0].toFixed(1)} ${H-P} Z`;
  const last = pts[pts.length-1];
  return (
    <svg className="spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <defs>
        <pattern id={"dots-"+kind} x="0" y="0" width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.6" fill="rgba(59,42,29,.10)"/>
        </pattern>
      </defs>
      <rect x="0" y="0" width={W} height={H} rx="8" fill={"url(#dots-"+kind+")"}/>
      <path d={area} fill={fill}/>
      <path d={d} fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx={last[0]} cy={last[1]} r="3.4" fill="white" stroke={stroke} strokeWidth="2"/>
    </svg>
  );
}

function nearestCityName(pos){
  let best=CITIES[0], bd=Infinity;
  for(const c of CITIES){
    const d = Math.abs(c.x-pos.x)+Math.abs(c.y-pos.y);
    if(d<bd){bd=d; best=c}
  }
  return `On the trail · near ${best.name}`;
}

function shadeColor(hex, p){
  // simple darken
  const h = hex.replace('#','');
  const r = parseInt(h.substr(0,2),16), g=parseInt(h.substr(2,2),16), b=parseInt(h.substr(4,2),16);
  const f = 1 + p/100;
  const cl = v=> Math.max(0,Math.min(255,Math.round(v*f)));
  return `rgb(${cl(r)},${cl(g)},${cl(b)})`;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
